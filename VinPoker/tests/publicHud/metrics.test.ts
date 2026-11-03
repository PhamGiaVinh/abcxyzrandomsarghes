import { describe,it,expect } from 'vitest';
import { publicStreetMetrics } from '../../supabase/functions/public-player-hud/metrics';
import type { TrackerAnalyticsHand } from '../../supabase/functions/_shared/trackerPlayerAnalytics';

const A='a',B='b';
function hand(short=A):TrackerAnalyticsHand {
  const rows=[['preflop',A,'post_sb',50],['preflop',B,'post_bb',100],['preflop',A,'call',50],['preflop',B,'check',0],
    ['flop',A,'bet',100],['flop',B,'call',100],['turn',A,'check',0],['turn',B,'check',0],
    ['river',short===A?B:A,'bet',100],['river',short,'all_in',100]];
  return {handId:'h',status:'completed',isVoided:false,buttonSeat:1,boardCardCount:5,settlement:null,
    players:[{player_id:A,seat_number:1,starting_stack:short===A?300:1000},{player_id:B,seat_number:2,starting_stack:short===B?300:1000}],
    actions:rows.map(([street,player_id,action_type,action_amount],action_order)=>({street,player_id,action_type,action_amount,action_order})) as TrackerAnalyticsHand['actions']};
}
describe('public street metrics',()=>{
  it('counts nonraising all-in calls in river aggression denominator',()=>{
    const result=publicStreetMetrics(A,[hand(A),hand(B)]);
    expect(result.riverAggression).toMatchObject({numerator:1,denominator:2,percentage:50});
  });
  it('does not manufacture 0% without opportunities',()=>{
    expect(publicStreetMetrics(A,[]).ats.percentage).toBeNull();
  });
  it('excludes voided and unfinished hands',()=>{
    expect(publicStreetMetrics(A,[{...hand(),isVoided:true},{...hand(),status:'in_progress'}]).riverAggression.denominator).toBe(0);
  });
  it('counts an unopened button raise as ATS but not a blind post or limp',()=>{
    const h=hand();
    h.players[0].starting_stack=1000;
    h.actions=h.actions.slice(0,2).concat({player_id:A,street:'preflop',action_type:'raise',action_amount:250,action_order:2});
    expect(publicStreetMetrics(A,[h]).ats).toMatchObject({numerator:1,denominator:1,percentage:100});
    h.actions[2]={...h.actions[2],action_type:'call',action_amount:50};
    expect(publicStreetMetrics(A,[h]).ats).toMatchObject({numerator:0,denominator:1,percentage:0});
  });
  it('keeps flop call and turn fold to continuation bets separate',()=>{
    const h=hand();h.players.forEach(p=>p.starting_stack=1000);
    const rows=[['preflop',A,'post_sb',50],['preflop',B,'post_bb',100],['preflop',A,'raise',200],['preflop',B,'call',150],['flop',A,'bet',100],['flop',B,'call',100],['turn',A,'bet',100],['turn',B,'fold',0]];
    h.actions=rows.map(([street,player_id,action_type,action_amount],action_order)=>({street,player_id,action_type,action_amount,action_order})) as TrackerAnalyticsHand['actions'];
    const result=publicStreetMetrics(B,[h]);
    expect(result.flopCallCbet.percentage).toBe(100);
    expect(result.flopFoldCbet.percentage).toBe(0);
    expect(result.turnFoldCbet.percentage).toBe(100);
    expect(result.turnCallCbet.percentage).toBe(0);
  });
});
