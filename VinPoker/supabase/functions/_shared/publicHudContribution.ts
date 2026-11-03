import { classifyTrackerPlayerAnalytics, TRACKER_PLAYER_ANALYTICS_VERSION, type TrackerAnalyticsHand,type TrackerAnalyticsMetric } from './trackerPlayerAnalytics.ts';
import { publicStreetMetrics } from '../public-player-hud/metrics.ts';

// The order is a storage contract. Changing it requires a new projection version
// and shadow backfill, never relabeling rows from the preceding version.
export const PUBLIC_HUD_PROJECTION_VERSION = 'public-hud-projection-v1';
export const PUBLIC_HUD_METRIC_KEYS = [
  'vpip','pfr','threeBet','foldToThreeBet','fourBet','fiveBet','wtsd','wsd','wwsf',
  'flopCbet','turnCbet','foldToCbet','checkRaise','aggressionFrequency',
  'ats','flopFoldCbet','flopCallCbet','flopRaiseCbet','turnFoldCbet','turnCallCbet','turnRaiseCbet','riverAggression',
] as const;
export type PublicHudMetricKey = typeof PUBLIC_HUD_METRIC_KEYS[number];
export interface PublicHudCounters {
  numerators: number[];
  denominators: number[];
  missingProof: number[];
  handsObserved: number;
  publicHands: number;
  omittedHands: number;
}
export interface PublicHudHandContribution extends PublicHudCounters {
  playerId: string;
}

export function emptyPublicHudCounters(): PublicHudCounters {
  return {numerators:PUBLIC_HUD_METRIC_KEYS.map(()=>0),denominators:PUBLIC_HUD_METRIC_KEYS.map(()=>0),
    missingProof:PUBLIC_HUD_METRIC_KEYS.map(()=>0),handsObserved:0,publicHands:0,omittedHands:0};
}

export function classifyPublicHudHand(hand: TrackerAnalyticsHand): PublicHudHandContribution[] {
  if(hand.status!=='completed'||hand.isVoided) return [];
  const complete=hand.actions.some(a=>a.action_type==='post_sb')
    &&hand.actions.some(a=>a.action_type==='post_bb')
    &&hand.actions.some(a=>a.street==='preflop'&&!['post_sb','post_bb','post_ante'].includes(a.action_type));
  return [...new Set(hand.players.map(p=>p.player_id))].sort().map(playerId=>{
    const counters=emptyPublicHudCounters();
    counters.publicHands=1;
    if(!complete) return {...counters,playerId,omittedHands:1};
    const base=classifyTrackerPlayerAnalytics(playerId,[hand]);
    const metrics:Record<string,TrackerAnalyticsMetric>={...base.metrics,...publicStreetMetrics(playerId,[hand])};
    for(const [index,key] of PUBLIC_HUD_METRIC_KEYS.entries()) {
      const value=metrics[key];
      if(!value) throw new Error('PUBLIC_HUD_CLASSIFIER_VERSION_MISMATCH');
      counters.numerators[index]=value.numerator;
      counters.denominators[index]=value.denominator;
      counters.missingProof[index]=base.unavailableMetrics.includes(key as typeof base.unavailableMetrics[number])?1:0;
    }
    return {...counters,playerId,handsObserved:base.handsObserved};
  });
}

export function publicHudAnalyticsFromCounters(counters: PublicHudCounters) {
  validatePublicHudCounters(counters);
  const unavailableMetrics=PUBLIC_HUD_METRIC_KEYS.filter((_,i)=>counters.missingProof[i]>0);
  const metrics=Object.fromEntries(PUBLIC_HUD_METRIC_KEYS.map((key,i)=>{
    const missing=counters.missingProof[i]>0;
    const numerator=missing?0:counters.numerators[i],denominator=missing?0:counters.denominators[i];
    return [key,{numerator,denominator,sampleSize:denominator,
      percentage:denominator?Math.round(numerator/denominator*10_000)/100:null,
      metricVersion:i<14?TRACKER_PLAYER_ANALYTICS_VERSION:'public-hud-v1'}];
  }));
  return {handsObserved:counters.handsObserved,metrics,unavailableMetrics};
}

export function validatePublicHudCounters(value: PublicHudCounters): void {
  const integer=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
  if(!value||![value.numerators,value.denominators,value.missingProof].every(v=>Array.isArray(v)&&v.length===PUBLIC_HUD_METRIC_KEYS.length&&v.every(integer))
    ||![value.handsObserved,value.publicHands,value.omittedHands].every(integer)
    ||value.handsObserved+value.omittedHands!==value.publicHands
    ||value.numerators.some((n,i)=>n>value.denominators[i])
    ||value.missingProof.some(n=>n>value.handsObserved)) throw new Error('PUBLIC_HUD_INVALID_COUNTERS');
}
