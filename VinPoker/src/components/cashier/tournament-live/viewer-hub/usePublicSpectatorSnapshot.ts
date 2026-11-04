import { useEffect, useMemo, useRef, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { PublicSnapshotCoordinator, PUBLIC_SPECTATOR_READ_INTERVAL_MS, normalizeVisibleTableIds } from "./publicSnapshotCoordinator";
import type { PublicSnapshotSection, PublicSpectatorSnapshot } from "./publicSnapshotTypes";
import {observePublicTournament,publicReadEpoch,publicReadEpochIsCurrent} from './publicTournamentRealtime';
import {sharePublicTournamentRead} from './sharedPublicTournamentRead';


export function usePublicSpectatorSnapshot(
  tournamentId: string | undefined,
  enabled: boolean,
  requestedTableIds: readonly string[] = [],
  liveTableUpdates = true,
) {
  const supabase = useSupabaseClient();
  const [snapshot, setSnapshot] = useState<PublicSpectatorSnapshot | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [networkError, setNetworkError] = useState(false);
  const trustedRevisions = useRef<Partial<Record<PublicSnapshotSection, string>>>({});
  const trustedTableScope = useRef("");
  const trustedTournamentId = useRef<string | undefined>(undefined);
  const trustedClient = useRef(supabase);
  const requestedTableKey = requestedTableIds.join(":");
  const tableIds = useMemo(
    () => normalizeVisibleTableIds(requestedTableKey ? requestedTableKey.split(":") : []),
    [requestedTableKey],
  );
  const tableKey = tableIds.join(":");

  useEffect(() => {
    if (!enabled || !tournamentId) {
      setSnapshot(null);
      trustedTableScope.current = "";
      setLoading(false);
      return;
    }
    if (trustedTournamentId.current !== tournamentId || trustedClient.current !== supabase) {
      trustedClient.current = supabase;
      trustedTournamentId.current = tournamentId;
      trustedRevisions.current = {};
      trustedTableScope.current = "";
      setSnapshot(null);
      if (tableKey) return;
    }
    if (trustedTableScope.current !== tableKey) {
      delete trustedRevisions.current.tables;
      trustedTableScope.current = tableKey;
      // A hand belongs to a table/session context. Preserve ranking and payout
      // and the table catalog while visible details reload. Clearing the catalog
      // makes the grid request no tables, which can loop between both scopes.
      // Never flash a prior table's hand while its details are reloading.
      setSnapshot((previous) => previous ? {
        ...previous,
        sections: { ...previous.sections, tables: previous.sections.tables
          ? { ...previous.sections.tables, items: [], removed: [] }
          : undefined },
      } : previous);
      setLoading(true);
    }
    let active = true;
    let coordinator: PublicSnapshotCoordinator | null = null;
    let observation:ReturnType<typeof observePublicTournament>|null=null;
    let controller=new AbortController(),epoch=0;
    const dirty=new Set<PublicSnapshotSection>(['tables','ranking','payout']);

    const refresh = async () => {
      const requestEpoch=epoch;controller=new AbortController();
      const sections=[...dirty];dirty.clear();if(!sections.length)return;
      const epochs=Object.fromEntries(sections.map(s=>[s,publicReadEpoch(supabase,tournamentId,s)]));
      const args={
        p_tournament_id: tournamentId,
        p_table_ids: tableIds,
        p_sections: sections,
        p_known_revisions: trustedRevisions.current,
      };
      let reply:{data:unknown;error:unknown};
      try{reply=await sharePublicTournamentRead(supabase,JSON.stringify(['snapshot',args,epochs]),controller.signal,signal=>supabase.rpc('get_public_tournament_viewer_snapshot_v2' as never,args as never).abortSignal(signal));}
      catch{reply={data:null,error:true};}
      const {data,error}=reply;
      if (!active||requestEpoch!==epoch) return;
      if (error || !data) {
        observation?.reportResult(false);for(const section of sections)dirty.add(section);
        setNetworkError(true);
        setLoading(false);
        return;
      }
      const incoming=data as PublicSpectatorSnapshot;
      if(incoming.tournamentId!==tournamentId||!incoming.sections||typeof incoming.sections!=='object'){
        observation?.reportResult(false);setNetworkError(true);setLoading(false);for(const section of sections)dirty.add(section);return;
      }
      const next = {...incoming,sections:{...incoming.sections}};
      if(next.access==='public'&&next.ok){
        for(const section of sections)if((section!=='tables'||liveTableUpdates)&&!publicReadEpochIsCurrent(supabase,tournamentId,section,epochs[section])){
          delete next.sections[section];dirty.add(section);coordinator?.request();
        }
        if(!Object.keys(next.sections).length)return;
      }
      if (next.access === "revoked") {
        trustedRevisions.current = {};
        setSnapshot(next);
        active = false;
        coordinator?.stop();
        observation?.unsubscribe();
      } else if (next.ok) {
        for (const section of ["tables", "ranking", "payout"] as const) {
          const revision = next.sections[section]?.revision;
          if (revision) trustedRevisions.current[section] = revision;
        }
        setSnapshot((previous) => mergeSnapshot(previous, next));
      }
      setNetworkError(false);
      observation?.reportResult(true);
      setLoading(false);
    };

    coordinator = new PublicSnapshotCoordinator(refresh, PUBLIC_SPECTATOR_READ_INTERVAL_MS);
    observation=observePublicTournament(supabase,tournamentId,event=>{
      if(event.reason==='status')return;
      if(event.invalidatePending){epoch++;controller.abort();trustedRevisions.current={};dirty.clear();}
      if(event.reason==='changed'&&event.components.includes('visibility')){epoch++;controller.abort();trustedRevisions.current={};setSnapshot(null);}
      for(const section of ['tables','ranking','payout'] as const){
        if(section==='tables'&&!liveTableUpdates&&event.reason==='changed'&&!event.components.includes('visibility'))continue;
        if(event.components.includes(section)||event.components.includes('visibility'))dirty.add(section);
      }
      if(dirty.size)coordinator?.request();
    });

    coordinator?.request();
    return () => {
      active = false;
      coordinator?.stop();
      controller.abort();observation?.unsubscribe();
    };
  }, [enabled, tournamentId, tableKey, tableIds, supabase, liveTableUpdates]);

  const currentScope = trustedClient.current === supabase && snapshot?.tournamentId === tournamentId;
  return { snapshot: currentScope ? snapshot : null, loading, networkError };
}

function mergeSnapshot(previous: PublicSpectatorSnapshot | null, next: PublicSpectatorSnapshot): PublicSpectatorSnapshot {
  if (!previous || next.access !== "public" || previous.tournamentId !== next.tournamentId) return next;
  const sections = { ...previous.sections };
  const tables = next.sections.tables;
  if (tables) sections.tables = !tables.unchanged || !sections.tables ? tables : { ...sections.tables, freshness: tables.freshness, revision: tables.revision };
  const ranking = next.sections.ranking;
  if (ranking) sections.ranking = !ranking.unchanged || !sections.ranking ? ranking : { ...sections.ranking, freshness: ranking.freshness, revision: ranking.revision };
  const payout = next.sections.payout;
  if (payout) sections.payout = !payout.unchanged || !sections.payout ? payout : { ...sections.payout, freshness: payout.freshness, revision: payout.revision };
  return { ...next, sections };
}
