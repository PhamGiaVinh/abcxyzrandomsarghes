import { useEffect, useMemo, useRef, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { PublicSnapshotCoordinator, normalizeVisibleTableIds } from "./publicSnapshotCoordinator";
import type { PublicSnapshotSection, PublicSpectatorSnapshot } from "./publicSnapshotTypes";

const VERIFY_INTERVAL_MS = 5_000;
const TABLE_REFRESH_FLOOR_MS = 1_000;
const SUMMARY_REFRESH_FLOOR_MS = 2_000;

export function usePublicSpectatorSnapshot(
  tournamentId: string | undefined,
  enabled: boolean,
  requestedTableIds: readonly string[] = [],
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
    let interval: ReturnType<typeof setInterval> | null = null;
    let coordinator: PublicSnapshotCoordinator | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let lastSummaryRequestAt = 0;

    const refresh = async () => {
      const now = Date.now();
      const includeSummaries = lastSummaryRequestAt === 0 || now - lastSummaryRequestAt >= SUMMARY_REFRESH_FLOOR_MS;
      const sections: PublicSnapshotSection[] = includeSummaries ? ["tables", "ranking", "payout"] : ["tables"];
      if (includeSummaries) lastSummaryRequestAt = now;
      const { data, error } = await supabase.rpc("get_public_tournament_viewer_snapshot_v2" as never, {
        p_tournament_id: tournamentId,
        p_table_ids: tableIds,
        p_sections: sections,
        p_known_revisions: trustedRevisions.current,
      } as never);
      if (!active) return;
      if (error || !data) {
        setNetworkError(true);
        setLoading(false);
        return;
      }
      const next = data as unknown as PublicSpectatorSnapshot;
      if (next.access === "revoked") {
        trustedRevisions.current = {};
        setSnapshot(next);
        active = false;
        coordinator?.stop();
        if (interval) clearInterval(interval);
        interval = null;
        if (channel) void supabase.removeChannel(channel);
      } else if (next.ok) {
        for (const section of ["tables", "ranking", "payout"] as const) {
          const revision = next.sections[section]?.revision;
          if (revision) trustedRevisions.current[section] = revision;
        }
        setSnapshot((previous) => mergeSnapshot(previous, next));
      }
      setNetworkError(false);
      setLoading(false);
    };

    coordinator = new PublicSnapshotCoordinator(refresh, TABLE_REFRESH_FLOOR_MS);
    channel = supabase
      .channel(`public:tournament-viewer-v2:${tournamentId}`, { config: { private: false } })
      .on("broadcast", { event: "changed" }, () => coordinator?.request())
      .subscribe();
    const start = () => {
      if (!interval) interval = setInterval(() => coordinator?.request(), VERIFY_INTERVAL_MS);
    };
    const stop = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };
    const onVisibility = () => document.visibilityState === "hidden" ? stop() : (coordinator?.request(), start());

    coordinator?.request();
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      coordinator?.stop();
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [enabled, tournamentId, tableKey, tableIds, supabase]);

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
