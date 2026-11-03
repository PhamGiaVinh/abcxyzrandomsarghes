import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { PublicSpectatorSnapshot } from '@/components/cashier/tournament-live/viewer-hub/publicSnapshotTypes';

export function verifiedStackRange(snapshot: PublicSpectatorSnapshot, tournamentId: string, remaining: number, totalChips: number | undefined) {
  const ranking = snapshot?.sections?.ranking;
  if (!snapshot?.ok || snapshot.access !== 'public' || snapshot.tournamentId !== tournamentId
    || ranking?.freshness?.state !== 'current' || ranking.items.length !== remaining || remaining === 0) return null;
  const values = ranking.items.map(p => p.chips);
  if (values.some(v => !Number.isSafeInteger(v) || v < 0) || totalChips == null
    || values.reduce((sum,v) => sum + v,0) !== totalChips) return null;
  return { largest: Math.max(...values), smallest: Math.min(...values) };
}
/** Existing public projection only; no private entry/seat rows on paired TVs. */
export function useTvStackRange(tournamentId: string | undefined, remaining: number, totalChips: number | undefined) {
  const [result,setResult] = useState<{scope: string; largest: number; smallest: number} | null>(null);
  const scope = JSON.stringify([tournamentId,remaining,totalChips]);
  useEffect(() => {
    if (!tournamentId) return;
    let active = true;
    let pending = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const {data,error} = await supabase.rpc('get_public_tournament_viewer_snapshot_v2',{
          p_tournament_id:tournamentId,p_table_ids:[],p_sections:['ranking'],p_known_revisions:{},
        }).abortSignal(controller.signal);
        if (!active) return;
        const range = !error && verifiedStackRange(data as unknown as PublicSpectatorSnapshot,tournamentId,remaining,totalChips);
        setResult(range ? {...range,scope} : null);
      } catch { if (active) setResult(null); }
      finally { pending = false; }
    };
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); },10000);
    return () => {active=false;controller.abort();clearInterval(timer);};
  },[tournamentId,remaining,totalChips,scope]);
  return result?.scope === scope ? result : null;
}
