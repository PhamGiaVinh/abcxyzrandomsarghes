import { supabase } from '@/integrations/supabase/client';
import type { TrackerAnalyticsMetric } from '@/lib/trackerVoice/analytics';

export interface PublicPlayerHudData {
  tournamentId: string; playerId: string; name: string; avatarUrl: string | null;
  sampledTournamentHands: number; truncated: boolean;
  omittedHands?: number;
  totalWinnings: number | null;
  recentResults: Array<{tournament_name: string; event_date: string; position: number | null; total_entries: number | null; prize: number}> | null;
  analytics: { handsObserved: number; metrics: Record<string, TrackerAnalyticsMetric> };
}
export async function loadPublicPlayerHud(tournamentId: string, playerId: string, signal: AbortSignal): Promise<PublicPlayerHudData> {
  const { data, error } = await supabase.functions.invoke('public-player-hud', {
    body: { tournament_id: tournamentId, player_id: playerId }, signal,
  });
  if (error) throw error;
  if (data?.tournamentId !== tournamentId || data?.playerId !== playerId || typeof data.name !== 'string'
    || !Number.isSafeInteger(data.sampledTournamentHands) || !Number.isSafeInteger(data.analytics?.handsObserved)
    || !data.analytics?.metrics) throw new Error('PUBLIC_HUD_SCOPE_MISMATCH');
  for (const key of ['vpip','pfr','threeBet','flopCbet','turnCbet','foldToCbet','wtsd','wsd','aggressionFrequency','ats','flopFoldCbet','flopCallCbet','flopRaiseCbet','turnFoldCbet','turnCallCbet','turnRaiseCbet','riverAggression']) {
    const m = data.analytics.metrics[key];
    if (!m || !(m.percentage === null || (Number.isFinite(m.percentage) && m.percentage >= 0 && m.percentage <= 100))
      || !Number.isSafeInteger(m.denominator) || m.denominator < 0 || !Number.isSafeInteger(m.numerator)
      || m.numerator < 0 || m.numerator > m.denominator) throw new Error('PUBLIC_HUD_INVALID_METRIC');
  }
  return data;
}
