import { classifyTrackerPlayerAnalytics, type TrackerAnalyticsHand } from '../_shared/trackerPlayerAnalytics.ts';
import { publicStreetMetrics } from './metrics.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.105.4';
import type { ActionRow } from '../_shared/trackerEngine/types.ts';
type HudHand={id:string;status:string;is_voided:boolean;source_revision:number;button_seat:number;community_cards:unknown};
type HudPlayer={hand_id:string;player_id:string;player_name:string|null;avatar_url:string|null;seat_number:number;starting_stack:number};
type RankingPlayer={playerId:string;name:string;avatarUrl:string|null};
type PublicResult={tournament_name:string;event_date:string;position:number|null;total_entries:number|null;prize:number};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PUBLIC_HUD_HAND_LIMIT = 50;
// The entrypoint constructs an anon-only client, never a caller's credentials.
export async function readPublicPlayerHud(client: SupabaseClient, tournamentId: string, playerId: string) {
  if (!UUID.test(tournamentId) || !UUID.test(playerId)) throw new Error('PUBLIC_SCOPE_INVALID');
  const { data: snapshot, error: snapshotError } = await client.rpc('get_public_tournament_viewer_snapshot_v2', {
    p_tournament_id: tournamentId, p_table_ids: [], p_sections: ['ranking'], p_known_revisions: {},
  });
  if (snapshotError || !snapshot?.ok || snapshot.access !== 'public' || snapshot.tournamentId !== tournamentId) throw new Error('PUBLIC_SCOPE_UNAVAILABLE');
  const { data: hands, error: handError } = await client.from('tournament_hands')
    .select('id,status,is_voided,button_seat,community_cards,hand_time,source_revision')
    .eq('tournament_id', tournamentId).eq('status', 'completed').or('is_voided.is.null,is_voided.eq.false')
    .order('hand_time', { ascending: false }).order('id', { ascending: false }).limit(PUBLIC_HUD_HAND_LIMIT + 1);
  if (handError) throw new Error('PUBLIC_HANDS_UNAVAILABLE');
  const sample = (hands ?? []).slice(0, PUBLIC_HUD_HAND_LIMIT);
  const ids = sample.map((h: HudHand) => h.id);
  const playerRead = ids.length ? await client.from('hand_players')
    .select('hand_id,player_id,player_name,avatar_url,seat_number,starting_stack')
    .eq('tournament_id', tournamentId).in('hand_id', ids) : { data: [], error: null };
  if (playerRead.error) throw new Error('PUBLIC_PLAYERS_UNAVAILABLE');
  const publicPlayer = snapshot.sections?.ranking?.items?.find((p: RankingPlayer) => p.playerId === playerId);
  const observedPlayer = playerRead.data?.find((p: HudPlayer) => p.player_id === playerId);
  if (!publicPlayer && !observedPlayer) throw new Error('PUBLIC_PLAYER_NOT_FOUND');
  const actions: Array<ActionRow & {hand_id:string}> = [];
  // PostgREST caps must not silently truncate a hand's action sequence.
  if (ids.length) for (let offset = 0; ; offset += 1000) {
    const page = await client.from('hand_actions').select('hand_id,player_id,street,action_type,action_amount,action_order')
      .in('hand_id', ids).order('hand_id').order('action_order').order('id').range(offset, offset + 999);
    if (page.error) throw new Error('PUBLIC_ACTIONS_UNAVAILABLE');
    actions.push(...page.data);
    if (page.data.length < 1000) break;
    if (offset >= 9000) throw new Error('PUBLIC_SAMPLE_TOO_LARGE');
  }
  const proofs = new Map<string, TrackerAnalyticsHand['settlement']>();
  // Use the existing freshness-checked public result, never a private outcome table.
  for (let offset=0; offset<sample.length; offset+=5) {
    await Promise.all(sample.slice(offset,offset+5).filter((h: HudHand) => Array.isArray(h.community_cards) && h.community_cards.length >= 3).map(async (h: HudHand) => {
      const reply = await client.rpc('get_public_tournament_settlement',{p_hand_id:h.id});
      const p = reply.error ? null : reply.data;
      if (p?.schemaVersion !== 'settlement-outcome-v1' || p.status !== 'verified' || !Array.isArray(p.pots) || !Array.isArray(p.handRanks)) return;
      if (p.pots.some((pot: {winnerIds:string[]}) => !Array.isArray(pot.winnerIds)) || p.handRanks.some((rank: {playerId:string}) => typeof rank.playerId !== 'string')) return;
      proofs.set(h.id,{verified:true,current:true,winnerPlayerIds:[...new Set<string>(p.pots.flatMap((pot: {winnerIds:string[]}) => pot.winnerIds))],
        eligiblePlayerIds:p.handRanks.map((rank: {playerId:string}) => rank.playerId),showdown:p.handRanks.length >= 2});
    }));
  }
  const historyReply = await client.from('player_results')
    .select('tournament_name,event_date,position,total_entries,prize',{count:'exact'})
    .eq('player_id',playerId).eq('verified_by_admin',true).order('event_date',{ascending:false}).order('id').limit(1001);
  const history = !historyReply.error && Array.isArray(historyReply.data)
    && historyReply.data.every((r: PublicResult) => Number.isSafeInteger(r.prize) && r.prize >= 0) ? historyReply.data : null;
  const winnings = history?.length && historyReply.count === history.length
    ? history.reduce((sum: number,r: PublicResult) => sum+r.prize,0) : null;
  // A concurrent void/edit invalidates this multi-read sample.
  if (ids.length) {
    const checked = await client.from('tournament_hands').select('id,status,is_voided,source_revision')
      .eq('tournament_id', tournamentId).in('id', ids);
    if (checked.error || checked.data?.length !== sample.length || sample.some((h: HudHand) => !checked.data.some((v: Pick<HudHand,'id'|'status'|'is_voided'|'source_revision'>) =>
      v.id === h.id && v.status === 'completed' && !v.is_voided && v.source_revision === h.source_revision))) throw new Error('PUBLIC_SAMPLE_CHANGED');
  }
  const input: TrackerAnalyticsHand[] = sample.map((h: HudHand) => ({
    handId: h.id, status: h.status, isVoided: h.is_voided === true, buttonSeat: h.button_seat,
    boardCardCount: Array.isArray(h.community_cards) ? h.community_cards.length : 0,
    players: (playerRead.data ?? []).filter((p: HudPlayer) => p.hand_id === h.id),
    actions: actions.filter(a => a.hand_id === h.id), settlement: proofs.get(h.id) ?? null,
  }));
  // A legacy completed/result-only hand is not evidence of a 0% VPIP/PFR.
  const complete = input.filter(h => h.actions.some(a=>a.action_type==='post_sb')
    && h.actions.some(a=>a.action_type==='post_bb')
    && h.actions.some(a=>a.street==='preflop' && !['post_sb','post_bb','post_ante'].includes(a.action_type)));
  const omittedHands = input.filter(h=>h.players.some(p=>p.player_id===playerId) && !complete.includes(h)).length;
  const analytics = classifyTrackerPlayerAnalytics(playerId,complete);
  return {
    tournamentId, playerId, name: publicPlayer?.name ?? observedPlayer?.player_name ?? 'Người chơi',
    avatarUrl: publicPlayer?.avatarUrl ?? observedPlayer?.avatar_url ?? null,
    sampledTournamentHands: sample.length, truncated: (hands?.length ?? 0) > PUBLIC_HUD_HAND_LIMIT,
    omittedHands,
    // Only admin-verified, already-public result amounts; never profit or stack deltas.
    totalWinnings: Number.isSafeInteger(winnings) ? winnings : null,
    recentResults: history?.slice(0,5) ?? null,
    analytics: { ...analytics, metrics: {...analytics.metrics,...publicStreetMetrics(playerId,complete)} },
  };
}
