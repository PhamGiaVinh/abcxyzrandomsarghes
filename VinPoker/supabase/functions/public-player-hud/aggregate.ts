import {publicHudAnalyticsFromCounters,validatePublicHudCounters} from '../_shared/publicHudContribution.ts';
import type {PublicHudCounters} from '../_shared/publicHudContribution.ts';

interface RpcClient {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function readPublicHudAggregate(client:RpcClient,tournamentId:string,playerId:string,mode:'summary'|'history',cursor?:unknown,accessSnapshot?:unknown):Promise<Record<string,unknown>>{
  if(typeof tournamentId!=='string'||typeof playerId!=='string'||!UUID.test(tournamentId)||!UUID.test(playerId))throw Error('PUBLIC_SCOPE_INVALID');
  const args:Record<string,unknown>={p_tournament_id:tournamentId,p_player_id:playerId};
  if(mode==='summary'&&accessSnapshot!==undefined){
    if(typeof accessSnapshot!=='string'||accessSnapshot.length>8192||!/^\d+:\d+:(\d+(,\d+)*)?$/.test(accessSnapshot))throw Error('PUBLIC_ACCESS_SNAPSHOT_INVALID');
    args.p_access_snapshot=accessSnapshot;
  }
  if(mode==='history'&&cursor!==undefined&&cursor!==null){
    if(typeof cursor!=='object')throw Error('PUBLIC_CURSOR_INVALID');
    const value=cursor as {playedAt?:unknown;handId?:unknown};
    if(typeof value.handId!=='string'||!UUID.test(value.handId)||
      (value.playedAt!==null&&(typeof value.playedAt!=='string'||!Number.isFinite(Date.parse(value.playedAt)))))throw Error('PUBLIC_CURSOR_INVALID');
    args.p_after_hand=value.handId;args.p_after_time=value.playedAt;
  }
  const reply=await client.rpc(mode==='summary'?'get_public_player_hud_summary_v1':'get_public_player_hud_history_v1',args);
  if(reply.error||!reply.data||typeof reply.data!=='object'){
    const code=(reply.error as {code?:unknown}|null)?.code;
    if(typeof code==='string'&&/^[A-Z0-9_]{5,24}$/.test(code))console.warn('public-player-hud RPC unavailable',mode,code);
    throw Error('PUBLIC_HUD_UNAVAILABLE');
  }
  const value=reply.data as Record<string,unknown>;
  if(value.access!=='public'||!['current','updating'].includes(String(value.state)))return value;
  if(value.tournamentId!==tournamentId||value.playerId!==playerId)throw Error('PUBLIC_SCOPE_MISMATCH');
  if(mode==='summary'){
    const counters=value.counters as PublicHudCounters;
    validatePublicHudCounters(counters);
    return {...value,analytics:publicHudAnalyticsFromCounters(counters)};
  }
  if(!Array.isArray(value.handHistory)||value.handHistory.length>50)throw Error('PUBLIC_HISTORY_INVALID');
  return value;
}

/** Compatibility for already-open old bundles; every read remains bounded. */
export async function readPublicHudCompatibility(client:RpcClient,input:{tournament_id:string;player_id:string;mode?:string;after?:unknown;as_of?:unknown}){
  if(input.after!==undefined&&input.after!==null)throw Error('PUBLIC_HUD_RELOAD_REQUIRED');
  if(input.as_of!==undefined&&(typeof input.as_of!=='string'||!Number.isFinite(Date.parse(input.as_of))||new Date(input.as_of).toISOString()!==input.as_of||Date.parse(input.as_of)>Date.now()))throw Error('PUBLIC_CURSOR_INVALID');
  const summary=await readPublicHudAggregate(client,input.tournament_id,input.player_id,'summary');
  if(summary.access!=='public'||!summary.analytics)throw Error('PUBLIC_HUD_PREPARING_OR_REVOKED');
  const asOf=input.as_of??new Date().toISOString();
  if(input.mode==='manifest'){
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([input.tournament_id,input.player_id,summary.version,summary.revision])));
    return {tournamentId:input.tournament_id,playerId:input.player_id,asOf,digest:[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('')};
  }
  const lifetime=input.mode==='lifetime';
  const history=lifetime?null:await readPublicHudAggregate(client,input.tournament_id,input.player_id,'history');
  if(history&&(!Array.isArray(history.handHistory)||history.access!=='public'))throw Error('PUBLIC_HUD_RELOAD_REQUIRED');
  const counters=summary.counters as PublicHudCounters;
  return {...summary,scope:lifetime?'all-public-tournaments':'current-tournament',asOf,nextCursor:null,
    sampledTournamentHands:lifetime?counters.publicHands:(history?.handHistory as unknown[]).length,
    omittedHands:counters.omittedHands,truncated:!!history?.nextCursor,handHistory:history?.handHistory??[]};
}
