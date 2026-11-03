import {supabase} from '@/integrations/supabase/client';
import type {PublicPlayerHand,PublicPlayerHudData} from './publicPlayerHud';
import {observePublicHudAccess} from '@/components/cashier/tournament-live/viewer-hub/publicHudAccess';

export function observePublicHudRevocation(tournamentId:string,revalidate:(reason:'verify'|'revoked')=>void){
  return observePublicHudAccess(supabase,revalidate);
}

export interface PublicHudHistoryCursor {playedAt:string|null;handId:string}
export interface PreparedPublicPlayerHudData extends PublicPlayerHudData {
  revision:string;accessSnapshot:string;accessChanged:boolean;metricVersion:string;computedAt:string;updateState:'current'|'updating';
  nextHistoryCursor:PublicHudHistoryCursor|null;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keys=['vpip','pfr','threeBet','foldToThreeBet','fourBet','fiveBet','wtsd','wsd','wwsf','flopCbet','turnCbet','foldToCbet','checkRaise','aggressionFrequency','ats','flopFoldCbet','flopCallCbet','flopRaiseCbet','turnFoldCbet','turnCallCbet','turnRaiseCbet','riverAggression'];
async function read(tournamentId:string,playerId:string,mode:'summary'|'history',signal:AbortSignal,cursor?:PublicHudHistoryCursor,accessSnapshot?:string){
  if(signal.aborted)throw Error('aborted');
  const {data,error}=await supabase.functions.invoke('public-player-hud',{body:{tournament_id:tournamentId,player_id:playerId,mode,cursor,access_snapshot:accessSnapshot},signal});
  if(error)throw error;
  if(signal.aborted)throw Error('aborted');
  if(data?.access==='revoked')throw Error('PUBLIC_HUD_ACCESS_REVOKED');
  if(data?.access==='public'&&data.state==='warming')throw Error('PUBLIC_HUD_PREPARING');
  if(data?.access!=='public'||!['current','updating'].includes(data.state)||data.tournamentId!==tournamentId||data.playerId!==playerId||typeof data.name!=='string')throw Error('PUBLIC_HUD_SCOPE_UNAVAILABLE');
  return data;
}
export async function loadPublicHudHistoryPage(tournamentId:string,playerId:string,signal:AbortSignal,cursor?:PublicHudHistoryCursor):Promise<{hands:PublicPlayerHand[];nextCursor:PublicHudHistoryCursor|null}>{
  const data=await read(tournamentId,playerId,'history',signal,cursor);
  if(!Array.isArray(data.handHistory)||data.handHistory.length>50||new Set(data.handHistory.map((h:PublicPlayerHand)=>h.handId)).size!==data.handHistory.length||
    data.handHistory.some((h:PublicPlayerHand)=>!uuid.test(h.handId)||!Number.isSafeInteger(h.handNumber)||h.handNumber<1||
      (h.playedAt!==null&&(typeof h.playedAt!=='string'||!Number.isFinite(Date.parse(h.playedAt))))||
      (h.tableId!==null&&!uuid.test(h.tableId))||(h.tableSessionId!==null&&!uuid.test(h.tableSessionId))||
      (h.endingStack!==null&&(!Number.isSafeInteger(h.endingStack)||h.endingStack<0))||(h.netDelta!==null&&!Number.isSafeInteger(h.netDelta))))throw Error('PUBLIC_HUD_INVALID_HISTORY');
  const next=data.nextCursor;
  if(next!==null&&(!next||!uuid.test(next.handId)||(next.playedAt!==null&&(typeof next.playedAt!=='string'||!Number.isFinite(Date.parse(next.playedAt))))))throw Error('PUBLIC_HUD_INVALID_CURSOR');
  if(next&&cursor&&next.handId===cursor.handId&&next.playedAt===cursor.playedAt)throw Error('PUBLIC_HUD_REPEATED_CURSOR');
  return {hands:data.handHistory,nextCursor:next};
}
export async function loadPreparedPublicPlayerHud(tournamentId:string,playerId:string,requestSignal:AbortSignal,frozen?:PreparedPublicPlayerHudData):Promise<PreparedPublicPlayerHudData>{
  if(requestSignal.aborted)throw Error('aborted');
  const controller=new AbortController(),abort=()=>controller.abort();
  requestSignal.addEventListener('abort',abort,{once:true});
  try{
    // A new window loads two bounded reads. Reconnect only checks access; an
    // unchanged scope must not fetch history or replace the frozen revision.
    const initial=frozen?null:await Promise.all([read(tournamentId,playerId,'summary',controller.signal),loadPublicHudHistoryPage(tournamentId,playerId,controller.signal)]);
    const summary=initial?.[0]??await read(tournamentId,playerId,'summary',controller.signal,undefined,frozen?.accessSnapshot);
    if(summary.scope!=='all-public-tournaments'||summary.coverageComplete!==true||summary.version!=='public-hud-projection-v1'||
      !/^\d+$/.test(summary.revision)||typeof summary.accessSnapshot!=='string'||!/^\d+:\d+:(\d+(,\d+)*)?$/.test(summary.accessSnapshot)||typeof summary.accessChanged!=='boolean'||!Number.isFinite(Date.parse(summary.computedAt))||!Number.isSafeInteger(summary.analytics?.handsObserved)||summary.analytics.handsObserved<0||
      !Number.isSafeInteger(summary.counters?.publicHands)||summary.counters.publicHands<0||!Number.isSafeInteger(summary.counters?.omittedHands)||
      summary.counters.omittedHands<0||summary.counters.publicHands!==summary.analytics.handsObserved+summary.counters.omittedHands)throw Error('PUBLIC_HUD_INVALID_SUMMARY');
    for(const key of keys){const m=summary.analytics.metrics?.[key];
      if(!m||!Number.isSafeInteger(m.numerator)||!Number.isSafeInteger(m.denominator)||m.numerator<0||m.denominator<m.numerator||
        !(m.percentage===null||(Number.isFinite(m.percentage)&&m.percentage>=0&&m.percentage<=100)))throw Error('PUBLIC_HUD_INVALID_METRIC');
    }
    if(summary.totalWinnings!==null&&(!Number.isSafeInteger(summary.totalWinnings)||summary.totalWinnings<0))throw Error('PUBLIC_HUD_INVALID_WINNINGS');
    if(!Array.isArray(summary.recentResults)||summary.recentResults.length>5||!Array.isArray(summary.analytics.unavailableMetrics))throw Error('PUBLIC_HUD_INVALID_SUMMARY');
    if(frozen&&!summary.accessChanged)return frozen;
    const history=initial?.[1]??await loadPublicHudHistoryPage(tournamentId,playerId,controller.signal);
    return {tournamentId,playerId,name:summary.name,avatarUrl:summary.avatarUrl??null,
      sampledTournamentHands:history.hands.length,truncated:history.nextCursor!==null,handHistory:history.hands,
      totalWinnings:summary.totalWinnings,recentResults:summary.recentResults,analytics:summary.analytics,
      lifetimeHands:summary.counters.publicHands,omittedHands:summary.counters.omittedHands,lifetimeAsOf:summary.computedAt,
      metricVersion:summary.version,revision:summary.revision,accessSnapshot:summary.accessSnapshot,accessChanged:summary.accessChanged,computedAt:summary.computedAt,updateState:summary.state,nextHistoryCursor:history.nextCursor};
  }finally{controller.abort();requestSignal.removeEventListener('abort',abort);}
}
