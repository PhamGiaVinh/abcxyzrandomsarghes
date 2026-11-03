import { classifyTrackerPlayerAnalytics, type TrackerAnalyticsHand } from '../_shared/trackerPlayerAnalytics.ts';
import { publicStreetMetrics } from './metrics.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.105.4';
import type { ActionRow } from '../_shared/trackerEngine/types.ts';
type HudHand={id:string;tournament_id:string;status:string;is_voided:boolean;source_revision:number;button_seat:number;community_cards:unknown;hand_time:string|null;hand_number:number;tournament_table_id:string|null;table_session_id:string|null};
type HudPlayer={hand_id:string;player_id:string;player_name:string|null;avatar_url:string|null;seat_number:number;starting_stack:number};
type RankingPlayer={playerId:string;name:string;avatarUrl:string|null};
type PublicResult={tournament_name:string;event_date:string;position:number|null;total_entries:number|null;prize:number};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PUBLIC_HUD_PAGE_SIZE = 50;
// The entrypoint constructs an anon-only client, never a caller's credentials.
export interface PublicHudPageOptions { mode?: 'lifetime'; after?: string; asOf?: string }
export async function readPublicPlayerHud(client: SupabaseClient, tournamentId: string, playerId: string, options:PublicHudPageOptions={}) {
  const lifetime=options.mode==='lifetime';
  if(options.after && !UUID.test(options.after)) throw new Error('PUBLIC_CURSOR_INVALID');
  if(options.asOf && (!Number.isFinite(Date.parse(options.asOf)) || new Date(options.asOf).toISOString()!==options.asOf || Date.parse(options.asOf)>Date.now())) throw new Error('PUBLIC_CURSOR_INVALID');
  const asOf=options.asOf ?? new Date().toISOString();
  if (!UUID.test(tournamentId) || !UUID.test(playerId)) throw new Error('PUBLIC_SCOPE_INVALID');
  const { data: snapshot, error: snapshotError } = await client.rpc('get_public_tournament_viewer_snapshot_v2', {
    p_tournament_id: tournamentId, p_table_ids: [], p_sections: ['ranking'], p_known_revisions: {},
  });
  if (snapshotError || !snapshot?.ok || snapshot.access !== 'public' || snapshot.tournamentId !== tournamentId) throw new Error('PUBLIC_SCOPE_UNAVAILABLE');
  let handQuery = client.from('tournament_hands')
    .select('id,tournament_id,status,is_voided,button_seat,community_cards,hand_time,source_revision,hand_number,tournament_table_id,table_session_id,participation:hand_players!hand_players_hand_id_fkey!inner(player_id)')
    .eq('participation.player_id',playerId)
    .eq('status', 'completed').or('is_voided.is.null,is_voided.eq.false');
  if(lifetime) {
    handQuery=handQuery.lte('created_at',asOf).order('id',{ascending:true});
    if(options.after) handQuery=handQuery.gt('id',options.after);
  } else handQuery=handQuery.eq('tournament_id',tournamentId).order('hand_time',{ascending:false}).order('id',{ascending:false});
  const {data:hands,error:handError}=await handQuery.limit(PUBLIC_HUD_PAGE_SIZE+1);
  if (handError) throw new Error('PUBLIC_HANDS_UNAVAILABLE');
  const candidates = (hands ?? []).slice(0, PUBLIC_HUD_PAGE_SIZE);
  const allowed=new Set([tournamentId]);
  if(lifetime) {
    // Every source tournament independently authorizes its public projection.
    const tours=[...new Set<string>(candidates.map((h:HudHand)=>h.tournament_id))].filter(t=>t!==tournamentId);
    for(let offset=0;offset<tours.length;offset+=5) await Promise.all(tours.slice(offset,offset+5).map(async id=>{
      const reply=await client.rpc('get_public_tournament_viewer_snapshot_v2',{p_tournament_id:id,p_table_ids:[],p_sections:['ranking'],p_known_revisions:{}});
      if(reply.error) throw new Error('PUBLIC_LIFETIME_SCOPE_UNAVAILABLE');
      if(reply.data?.ok && reply.data.access==='public' && reply.data.tournamentId===id) allowed.add(id);
    }));
  }
  const sample=lifetime?candidates.filter((h:HudHand)=>allowed.has(h.tournament_id)):candidates;
  const ids = sample.map((h: HudHand) => h.id);
  const playerRead = ids.length ? await client.from('hand_players')
    .select('hand_id,player_id,player_name,avatar_url,seat_number,starting_stack')
    .in('hand_id', ids) : { data: [], error: null };
  if (playerRead.error) throw new Error('PUBLIC_PLAYERS_UNAVAILABLE');
  const publicPlayer = snapshot.sections?.ranking?.items?.find((p: RankingPlayer) => p.playerId === playerId);
  const observedPlayer = playerRead.data?.find((p: HudPlayer) => p.player_id === playerId);
  if(lifetime && !publicPlayer) {
    const context=await client.from('hand_players').select('player_id').eq('tournament_id',tournamentId).eq('player_id',playerId).limit(1);
    if(context.error || !context.data?.some((row:{player_id:string})=>row.player_id===playerId)) throw new Error('PUBLIC_PLAYER_NOT_FOUND');
  } else if (!publicPlayer && !observedPlayer) throw new Error('PUBLIC_PLAYER_NOT_FOUND');
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
  const stacks = new Map<string,{endingStack:number;netDelta:number}>();
  // Use the existing freshness-checked public result, never a private outcome table.
  for (let offset=0; offset<sample.length; offset+=5) {
    await Promise.all(sample.slice(offset,offset+5).filter((h:HudHand)=>!lifetime || (Array.isArray(h.community_cards)&&h.community_cards.length>=3)).map(async (h: HudHand) => {
      const reply = await client.rpc('get_public_tournament_settlement',{p_hand_id:h.id});
      const p = reply.error ? null : reply.data;
      if (p?.schemaVersion !== 'settlement-outcome-v1' || p.status !== 'verified' || !Array.isArray(p.pots) || !Array.isArray(p.handRanks)) return;
      if (p.pots.some((pot: {winnerIds:string[]}) => !Array.isArray(pot.winnerIds)) || p.handRanks.some((rank: {playerId:string}) => typeof rank.playerId !== 'string')) return;
      proofs.set(h.id,{verified:true,current:true,winnerPlayerIds:[...new Set<string>(p.pots.flatMap((pot: {winnerIds:string[]}) => pot.winnerIds))],
        eligiblePlayerIds:p.handRanks.map((rank: {playerId:string}) => rank.playerId),showdown:p.handRanks.length >= 2});
      const outcome=Array.isArray(p.players) ? p.players.find((row:{playerId:string})=>row.playerId===playerId) : null;
      const delta=outcome?.netDelta,external=outcome?.externalDelta,ending=outcome?.endingStack;
      const seed=playerRead.data?.find((row:HudPlayer)=>row.hand_id===h.id && row.player_id===playerId)?.starting_stack;
      if(typeof seed==='number' && Number.isSafeInteger(seed) && seed>=0 && outcome?.startingStack===seed
        && typeof delta==='number' && Number.isSafeInteger(delta) && typeof external==='number' && Number.isSafeInteger(external)
        && typeof ending==='number' && Number.isSafeInteger(ending) && ending>=0 && seed+delta+external===ending) stacks.set(h.id,{endingStack:ending,netDelta:delta});
    }));
  }
  const historyReply = lifetime ? {data:null,error:null,count:null} : await client.from('player_results')
    .select('tournament_name,event_date,position,total_entries,prize',{count:'exact'})
    .eq('player_id',playerId).eq('verified_by_admin',true).order('event_date',{ascending:false}).order('id').limit(1001);
  const history = !historyReply.error && Array.isArray(historyReply.data)
    && historyReply.data.every((r: PublicResult) => Number.isSafeInteger(r.prize) && r.prize >= 0) ? historyReply.data : null;
  const winnings = history?.length && historyReply.count === history.length
    ? history.reduce((sum: number,r: PublicResult) => sum+r.prize,0) : null;
  // A concurrent void/edit invalidates this multi-read sample.
  if (ids.length) {
    const checked = await client.from('tournament_hands').select('id,status,is_voided,source_revision')
      .in('id', ids);
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
    scope:lifetime?'all-public-tournaments':'current-tournament',asOf,
    nextCursor:(hands?.length??0)>PUBLIC_HUD_PAGE_SIZE ? candidates.at(-1)?.id ?? null : null,
    sampledTournamentHands: sample.length, truncated: (hands?.length ?? 0) > PUBLIC_HUD_PAGE_SIZE,
    omittedHands,
    handHistory:(lifetime?[]:[...sample].reverse()).filter((h:HudHand)=>playerRead.data?.some((row:HudPlayer)=>row.hand_id===h.id && row.player_id===playerId)).map((h:HudHand)=>({
      handId:h.id,tableId:h.tournament_table_id,tableSessionId:h.table_session_id,handNumber:h.hand_number,playedAt:h.hand_time,
      endingStack:stacks.get(h.id)?.endingStack ?? null,netDelta:stacks.get(h.id)?.netDelta ?? null,
    })),
    // Only admin-verified, already-public result amounts; never profit or stack deltas.
    totalWinnings: Number.isSafeInteger(winnings) ? winnings : null,
    recentResults: history?.slice(0,5) ?? null,
    analytics: { ...analytics, metrics: {...analytics.metrics,...publicStreetMetrics(playerId,complete)} },
  };
}

// Before/after manifests guard the entire multi-request scan, not just each page.
export async function readPublicPlayerHudManifest(client:SupabaseClient,tournamentId:string,playerId:string,asOf=new Date().toISOString()) {
  if(!UUID.test(tournamentId)||!UUID.test(playerId)||!Number.isFinite(Date.parse(asOf))||new Date(asOf).toISOString()!==asOf||Date.parse(asOf)>Date.now()) throw new Error('PUBLIC_SCOPE_INVALID');
  const context=await client.rpc('get_public_tournament_viewer_snapshot_v2',{p_tournament_id:tournamentId,p_table_ids:[],p_sections:['ranking'],p_known_revisions:{}});
  if(context.error || !context.data?.ok || context.data.access!=='public' || context.data.tournamentId!==tournamentId) throw new Error('PUBLIC_SCOPE_UNAVAILABLE');
  if(!context.data.sections?.ranking?.items?.some((row:RankingPlayer)=>row.playerId===playerId)) {
    const membership=await client.from('hand_players').select('player_id').eq('tournament_id',tournamentId).eq('player_id',playerId).limit(1);
    if(membership.error || !membership.data?.some((row:{player_id:string})=>row.player_id===playerId)) throw new Error('PUBLIC_PLAYER_NOT_FOUND');
  }
  const facts:Array<{id:string;tournament_id:string;source_revision:number;status:string;is_voided:boolean|null}>=[];
  for(let offset=0;;offset+=1000) {
    const page=await client.from('tournament_hands').select('id,tournament_id,source_revision,status,is_voided,participation:hand_players!hand_players_hand_id_fkey!inner(player_id)')
      .eq('participation.player_id',playerId).lte('created_at',asOf).order('id').range(offset,offset+999);
    if(page.error) throw new Error('PUBLIC_MANIFEST_UNAVAILABLE');
    facts.push(...page.data);if(page.data.length<1000)break;
  }
  const allowed=new Set([tournamentId]);
  const tours=[...new Set(facts.map(row=>row.tournament_id))].filter(id=>id!==tournamentId);
  for(let offset=0;offset<tours.length;offset+=5) await Promise.all(tours.slice(offset,offset+5).map(async id=>{
    const scope=await client.rpc('get_public_tournament_viewer_snapshot_v2',{p_tournament_id:id,p_table_ids:[],p_sections:[],p_known_revisions:{}});
    if(scope.error) throw new Error('PUBLIC_MANIFEST_UNAVAILABLE');
    if(scope.data?.ok && scope.data.access==='public' && scope.data.tournamentId===id) allowed.add(id);
  }));
  const publicFacts=facts.filter(row=>allowed.has(row.tournament_id)).map(row=>[row.id,row.tournament_id,row.source_revision,row.status,row.is_voided]);
  const bytes=new TextEncoder().encode(JSON.stringify(publicFacts));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  const digest=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
  return {tournamentId,playerId,asOf,digest};
}
