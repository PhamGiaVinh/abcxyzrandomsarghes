import { useEffect, useState } from 'react';
import { useSupabaseClient } from '@/integrations/supabase/SupabaseClientContext';
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

type PublicRpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

/** Check every public table until a real live/completed hand is found. */
export async function loadTvStackRange(rpc: PublicRpc, tournamentId: string, remaining: number, totalChips: number | undefined) {
  const args = { p_tournament_id: tournamentId, p_table_ids: [], p_sections: ['tables', 'ranking'], p_known_revisions: {} };
  const response = await rpc('get_public_tournament_viewer_snapshot_v2', args);
  const snapshot = response.data as PublicSpectatorSnapshot;
  if (response.error || !verifiedStackRange(snapshot, tournamentId, remaining, totalChips)
    || snapshot.sections.tables?.freshness?.state !== 'current') return null;
  for (const table of snapshot.sections.tables.catalog) {
    const result = await rpc('get_public_tournament_table_live_or_last_hand_v2', {
      p_tournament_id: tournamentId, p_tournament_table_id: table.tableId,
    });
    const value = result.data as { access?: string; tableId?: string; state?: string; hand?: { id?: string } } | null;
    if (result.error || value?.access !== 'public' || value.tableId !== table.tableId) return null;
    if ((value.state === 'live' || value.state === 'last_completed') && value.hand?.id) {
      // Revalidate the ranking after reading the hand, including any intervening invalidation.
      const latest = await rpc('get_public_tournament_viewer_snapshot_v2', args);
      return latest.error ? null : verifiedStackRange(latest.data as PublicSpectatorSnapshot, tournamentId, remaining, totalChips);
    }
  }
  return null;
}
/** Existing public projection only; no private entry/seat rows on paired TVs. */
export function useTvStackRange(tournamentId: string | undefined, remaining: number, totalChips: number | undefined) {
  const supabase = useSupabaseClient();
  const [result,setResult] = useState<{scope: string; largest: number; smallest: number} | null>(null);
  const scope = JSON.stringify([tournamentId,remaining,totalChips]);
  useEffect(() => {
    if (!tournamentId) return;
    let active = true;
    let pending = false;
    let controller = new AbortController();
    const refresh = async () => {
      if (pending) return;
      if (!navigator.onLine) { setResult(null); return; }
      pending = true;
      controller = new AbortController();
      const timeout = setTimeout(() => { controller.abort(); if (active) setResult(null); }, 15000);
      try {
        const range = await loadTvStackRange(
          (name, args) => supabase.rpc(name as never, args as never).abortSignal(controller.signal),
          tournamentId, remaining, totalChips,
        );
        if (!active || controller.signal.aborted || !navigator.onLine) return;
        setResult(range ? {...range,scope} : null);
      } catch { if (active) setResult(null); }
      finally { clearTimeout(timeout); pending = false; }
    };
    void refresh();
    const offline = () => { controller.abort(); setResult(null); };
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('offline', offline);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); },10000);
    return () => {
      active=false;controller.abort();clearInterval(timer);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  },[supabase,tournamentId,remaining,totalChips,scope]);
  return result?.scope === scope ? result : null;
}
