import { reduceHand } from '../_shared/trackerEngine/handState.ts';
import type { ActionRow } from '../_shared/trackerEngine/types.ts';
import type { TrackerAnalyticsHand } from '../_shared/trackerPlayerAnalytics.ts';

type Counter = {numerator:number;denominator:number};
const metric = (c:Counter) => ({...c,percentage:c.denominator ? Math.round(c.numerator/c.denominator*10000)/100 : null,
  sampleSize:c.denominator,metricVersion:'public-hud-v1'});
const forced = new Set(['post_sb','post_bb','post_ante']);
function aggression(hand:TrackerAnalyticsHand, actions:ActionRow[], action:ActionRow) {
  if (!['bet','raise','all_in'].includes(action.action_type)) return {raised:false,full:false};
  const state = reduceHand(hand.players,actions.slice(0,actions.indexOf(action)),hand.buttonSeat);
  const player = state.players.find(p=>p.player_id===action.player_id);
  if (!player) return {raised:false,full:false};
  const increment = player.street_bet + Math.min(Math.max(0,action.action_amount),player.stack)-state.highestBet;
  return {raised:increment>0,full:increment>0 && increment>=state.minRaise};
}
export function publicStreetMetrics(playerId:string,hands:TrackerAnalyticsHand[]) {
  const counters:Record<string,Counter> = Object.fromEntries(['ats','flopFoldCbet','flopCallCbet','flopRaiseCbet','turnFoldCbet','turnCallCbet','turnRaiseCbet','riverAggression'].map(k=>[k,{numerator:0,denominator:0}]));
  for(const hand of hands) {
    if(hand.isVoided || hand.status!=='completed' || !hand.players.some(p=>p.player_id===playerId)) continue;
    const actions=[...hand.actions].sort((a,b)=>a.action_order-b.action_order);
    const pre=actions.filter(a=>a.street==='preflop');
    const seats=hand.players.map(p=>p.seat_number).sort((a,b)=>a-b);
    const button=seats.indexOf(hand.buttonSeat);
    const actorSeat=hand.players.find(p=>p.player_id===playerId)?.seat_number;
    const late=button>=0 && (actorSeat===hand.buttonSeat || actorSeat===seats[(button+1)%seats.length]
      || (seats.length>=4 && actorSeat===seats[(button+seats.length-1)%seats.length]));
    const first=pre.find(a=>a.player_id===playerId && !forced.has(a.action_type));
    if(late && first && pre.slice(0,pre.indexOf(first)).every(a=>forced.has(a.action_type)||a.action_type==='fold')) {
      counters.ats.denominator++;
      if(aggression(hand,actions,first).raised) counters.ats.numerator++;
    }
    const opener=pre.filter(a=>aggression(hand,actions,a).full).at(-1)?.player_id;
    let flopCbet=false;
    for(const street of ['flop','turn'] as const) {
      const streetActions=actions.filter(a=>a.street===street);
      const firstBet=streetActions.find(a=>aggression(hand,actions,a).raised);
      const isCbet=firstBet && firstBet.player_id===opener && (street==='flop'||flopCbet);
      if(street==='flop') flopCbet=Boolean(isCbet);
      if(!isCbet || opener===playerId) continue;
      const after=streetActions.slice(streetActions.indexOf(firstBet)+1);
      const response=after.find(a=>a.player_id===playerId);
      if(!response || after.slice(0,after.indexOf(response)).some(a=>aggression(hand,actions,a).raised)) continue;
      const prefix=street==='flop'?'flop':'turn';
      for(const kind of ['Fold','Call','Raise']) counters[`${prefix}${kind}Cbet`].denominator++;
      if(response.action_type==='fold') counters[`${prefix}FoldCbet`].numerator++;
      else if(aggression(hand,actions,response).raised) counters[`${prefix}RaiseCbet`].numerator++;
      else if(['call','all_in'].includes(response.action_type)) counters[`${prefix}CallCbet`].numerator++;
    }
    for(const action of actions.filter(a=>a.player_id===playerId&&a.street==='river')) {
      if(aggression(hand,actions,action).raised) {counters.riverAggression.numerator++;counters.riverAggression.denominator++;}
      else if(['call','fold','all_in'].includes(action.action_type)) counters.riverAggression.denominator++;
    }
  }
  return Object.fromEntries(Object.entries(counters).map(([k,c])=>[k,metric(c)]));
}
