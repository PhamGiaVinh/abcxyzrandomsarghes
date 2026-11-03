import { supabase } from '@/integrations/supabase/client';
import type { TrackerAnalyticsMetric } from '@/lib/trackerVoice/analytics';

export interface PublicPlayerHudData {
  tournamentId: string; playerId: string; name: string; avatarUrl: string | null;
  sampledTournamentHands: number; truncated: boolean;
  omittedHands?: number;
  handHistory: PublicPlayerHand[];
  totalWinnings: number | null;
  recentResults: Array<{tournament_name: string; event_date: string; position: number | null; total_entries: number | null; prize: number}> | null;
  analytics: { handsObserved: number; metrics: Record<string, TrackerAnalyticsMetric>; unavailableMetrics?:string[] };
  lifetimeHands?:number; lifetimeAsOf?:string;
}
export interface PublicPlayerHand {
  handId:string;tableId:string|null;tableSessionId:string|null;handNumber:number;playedAt:string|null;
  endingStack:number|null;netDelta:number|null;
}
async function loadPublicPlayerHudPage(tournamentId: string, playerId: string, signal: AbortSignal, page?:{mode:'lifetime'|'manifest';after?:string;asOf?:string}): Promise<PublicPlayerHudData & {scope:string;asOf:string;nextCursor:string|null}> {
  const { data, error } = await supabase.functions.invoke('public-player-hud', {
    body: { tournament_id: tournamentId, player_id: playerId, mode:page?.mode, after:page?.after, as_of:page?.asOf }, signal,
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
  if(!['current-tournament','all-public-tournaments'].includes(data.scope) || typeof data.asOf!=='string' || !Number.isFinite(Date.parse(data.asOf))
    || (data.nextCursor!==null&&!uuid.test(data.nextCursor)) || !Array.isArray(data.analytics.unavailableMetrics)) throw new Error('PUBLIC_HUD_INVALID_PAGE');
  return data;
}

// Sum server-classified opportunities; never average percentages or truncate the sample.
export function combinePublicHudAnalytics(pages:PublicPlayerHudData['analytics'][]) {
  const unavailable=new Set(pages.flatMap(p=>p.unavailableMetrics??[]));
  const metrics:Record<string,TrackerAnalyticsMetric>={};
  for(const page of pages) for(const [key,value] of Object.entries(page.metrics)) {
    const previous=metrics[key];
    const numerator=(previous?.numerator??0)+value.numerator,denominator=(previous?.denominator??0)+value.denominator;
    if(!Number.isSafeInteger(numerator)||!Number.isSafeInteger(denominator)) throw new Error('PUBLIC_HUD_COUNT_OVERFLOW');
    metrics[key]={...value,numerator,denominator,sampleSize:denominator,percentage:denominator?Math.round(numerator/denominator*10000)/100:null};
  }
  for(const key of unavailable) if(metrics[key]) metrics[key]={...metrics[key],numerator:0,denominator:0,sampleSize:0,percentage:null};
  return {handsObserved:pages.reduce((n,p)=>n+p.handsObserved,0),metrics,unavailableMetrics:[...unavailable]};
}
export async function loadPublicPlayerHud(tournamentId:string,playerId:string,requestSignal:AbortSignal,onProgress?:(hands:number)=>void,onCurrent?:(data:PublicPlayerHudData)=>void):Promise<PublicPlayerHudData> {
  if(requestSignal.aborted) throw new Error('aborted');
  const controller=new AbortController();
  const signal=controller.signal;
  const abort=()=>controller.abort();
  requestSignal.addEventListener('abort',abort,{once:true});
  try {
    // These independent reads share no cursor. Publish only the current-tour
    // history early; lifetime counters remain hidden until both manifests agree.
    const currentTask=loadPublicPlayerHudPage(tournamentId,playerId,signal).then(current=>{
      if(current.scope!=='current-tournament') throw new Error('PUBLIC_HUD_PAGE_MISMATCH');
      if(signal.aborted) throw new Error('aborted');
      onCurrent?.(current);
      return current;
    });
    const lifetimeTask=(async()=>{
      const manifest=async(asOf?:string)=>{
        const {data,error}=await supabase.functions.invoke('public-player-hud',{body:{tournament_id:tournamentId,player_id:playerId,mode:'manifest',as_of:asOf},signal});
        if(error) throw error;
        if(data?.tournamentId!==tournamentId||data?.playerId!==playerId||!Number.isFinite(Date.parse(data.asOf))||(asOf&&data.asOf!==asOf)||!/^[a-f0-9]{64}$/.test(data.digest)) throw new Error('PUBLIC_HUD_INVALID_MANIFEST');
        return data as {asOf:string;digest:string};
      };
      if(signal.aborted) throw new Error('aborted');
      const before=await manifest();
      let analytics:PublicPlayerHudData['analytics']={handsObserved:0,metrics:{},unavailableMetrics:[]};
      let after:string|undefined,asOf=before.asOf,total=0,omitted=0;
      do {
        if(signal.aborted) throw new Error('aborted');
        const page=await loadPublicPlayerHudPage(tournamentId,playerId,signal,{mode:'lifetime',after,asOf});
        if(page.scope!=='all-public-tournaments' || (asOf && page.asOf!==asOf) || (page.nextCursor && after && page.nextCursor<=after)) throw new Error('PUBLIC_HUD_PAGE_MISMATCH');
        asOf=page.asOf;
        analytics=combinePublicHudAnalytics([analytics,page.analytics]);
        if(signal.aborted) throw new Error('aborted');
        total+=page.sampledTournamentHands;omitted+=page.omittedHands??0;onProgress?.(total);
        after=page.nextCursor??undefined;
      } while(after);
      const checked=await manifest(asOf);
      if(checked.digest!==before.digest) throw new Error('PUBLIC_HUD_HISTORY_CHANGED');
      if(signal.aborted) throw new Error('aborted');
      return {analytics,lifetimeHands:total,lifetimeAsOf:asOf,omittedHands:omitted};
    })();
    const [current,lifetime]=await Promise.all([currentTask,lifetimeTask]);
    return {...current,...lifetime};
  } finally {
    // A failure in either branch must cancel the sibling read too.
    controller.abort();
    requestSignal.removeEventListener('abort',abort);
  }
}
