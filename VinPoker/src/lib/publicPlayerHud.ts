import { supabase } from '@/integrations/supabase/client';
import type { TrackerAnalyticsMetric } from '@/lib/trackerVoice/analytics';

export interface PublicPlayerHudData {
  tournamentId: string; playerId: string; name: string; avatarUrl: string | null;
  sampledTournamentHands: number; truncated: boolean;
  omittedHands?: number;
  handHistory: PublicPlayerHand[];
  totalWinnings: number | null;
  recentResults: Array<{tournament_name: string; event_date: string; position: number | null; total_entries: number | null; prize: number}> | null;
  analytics: { handsObserved: number; metrics: Record<string, TrackerAnalyticsMetric> };
}
export interface PublicPlayerHand {
  handId:string;tableId:string|null;tableSessionId:string|null;handNumber:number;playedAt:string|null;
  endingStack:number|null;netDelta:number|null;
}
export async function loadPublicPlayerHud(tournamentId: string, playerId: string, signal: AbortSignal): Promise<PublicPlayerHudData> {
  const { data, error } = await supabase.functions.invoke('public-player-hud', {
    body: { tournament_id: tournamentId, player_id: playerId }, signal,
  });
  if (error) throw error;
  if (data?.tournamentId !== tournamentId || data?.playerId !== playerId || typeof data.name !== 'string'
    || !Number.isSafeInteger(data.sampledTournamentHands) || !Number.isSafeInteger(data.analytics?.handsObserved)
    || !data.analytics?.metrics) throw new Error('PUBLIC_HUD_SCOPE_MISMATCH');
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(!Array.isArray(data.handHistory) || data.handHistory.length>50 || new Set(data.handHistory.map((h:PublicPlayerHand)=>h.handId)).size!==data.handHistory.length
    || data.handHistory.some((h:PublicPlayerHand)=>!uuid.test(h.handId) || (h.tableId!==null&&!uuid.test(h.tableId))
      || (h.tableSessionId!==null&&!uuid.test(h.tableSessionId)) || !Number.isSafeInteger(h.handNumber) || h.handNumber<1
      || (h.playedAt!==null&&(typeof h.playedAt!=='string'||!Number.isFinite(Date.parse(h.playedAt))))
      || (h.endingStack!==null&&(!Number.isSafeInteger(h.endingStack)||h.endingStack<0))
      || (h.netDelta!==null&&!Number.isSafeInteger(h.netDelta)))) throw new Error('PUBLIC_HUD_INVALID_HISTORY');
  for (const key of ['vpip','pfr','threeBet','flopCbet','turnCbet','foldToCbet','wtsd','wsd','aggressionFrequency','ats','flopFoldCbet','flopCallCbet','flopRaiseCbet','turnFoldCbet','turnCallCbet','turnRaiseCbet','riverAggression']) {
    const m = data.analytics.metrics[key];
    if (!m || !(m.percentage === null || (Number.isFinite(m.percentage) && m.percentage >= 0 && m.percentage <= 100))
      || !Number.isSafeInteger(m.denominator) || m.denominator < 0 || !Number.isSafeInteger(m.numerator)
      || m.numerator < 0 || m.numerator > m.denominator) throw new Error('PUBLIC_HUD_INVALID_METRIC');
  }
  return data;
}
