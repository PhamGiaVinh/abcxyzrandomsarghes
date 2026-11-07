import {describe,it,expect} from 'vitest';
import {classifyTrackerPlayerAnalytics,type TrackerAnalyticsHand} from '../../supabase/functions/_shared/trackerPlayerAnalytics';
import {publicStreetMetrics} from '../../supabase/functions/public-player-hud/metrics';
import {classifyPublicHudHand,emptyPublicHudCounters,publicHudAnalyticsFromCounters,PUBLIC_HUD_METRIC_KEYS,validatePublicHudCounters,type PublicHudCounters} from '../../supabase/functions/_shared/publicHudContribution';

function hand(id='h',proof=true):TrackerAnalyticsHand {
  return {handId:id,status:'completed',isVoided:false,buttonSeat:1,boardCardCount:5,
    players:[{player_id:'a',seat_number:1,starting_stack:1000},{player_id:'b',seat_number:2,starting_stack:1000}],
    actions:[['preflop','a','post_sb',50],['preflop','b','post_bb',100],['preflop','a','raise',250],['preflop','b','call',200],
      ['flop','a','bet',100],['flop','b','call',100],['turn','a','check',0],['turn','b','check',0],['river','a','check',0],['river','b','check',0]]
      .map(([street,player_id,action_type,action_amount],action_order)=>({street,player_id,action_type,action_amount,action_order})) as TrackerAnalyticsHand['actions'],
    settlement:proof?{verified:true,current:true,winnerPlayerIds:['a'],eligiblePlayerIds:['a','b'],showdown:true}:null};
}
function add(...rows:PublicHudCounters[]):PublicHudCounters {
  const total=emptyPublicHudCounters();
  for(const row of rows){for(const key of ['numerators','denominators','missingProof'] as const) row[key].forEach((n,i)=>{total[key][i]+=n;});
    total.publicHands+=row.publicHands;total.handsObserved+=row.handsObserved;total.omittedHands+=row.omittedHands;}
  return total;
}
describe('incremental public HUD contribution contract',()=>{
  it('matches both existing classifiers across all 22 metrics for every player',()=>{
    const hands=[hand('1'),hand('2'),hand('3')];
    for(const playerId of ['a','b']) {
      const total=add(...hands.map(h=>classifyPublicHudHand(h).find(c=>c.playerId===playerId)!));
      const expected=classifyTrackerPlayerAnalytics(playerId,hands);
      expect(publicHudAnalyticsFromCounters(total)).toEqual({handsObserved:expected.handsObserved,
        metrics:{...expected.metrics,...publicStreetMetrics(playerId,hands)},unavailableMetrics:expected.unavailableMetrics});
    }
  });
  it('counts unavailable proof so removing/replacing the missing hand restores known percentages',()=>{
    const verified=classifyPublicHudHand(hand('verified'))[0],missing=classifyPublicHudHand(hand('missing',false))[0];
    expect(publicHudAnalyticsFromCounters(add(verified,missing)).metrics.wsd.percentage).toBeNull();
    expect(publicHudAnalyticsFromCounters(verified).metrics.wsd.percentage).toBe(100);
    expect(publicHudAnalyticsFromCounters(add(verified,verified)).metrics.wsd.percentage).toBe(100);
  });
  it('retains public hand coverage while omitting result-only legacy hands from the sample',()=>{
    const h=hand();h.actions=[];
    const row=classifyPublicHudHand(h)[0];
    expect(row).toMatchObject({publicHands:1,handsObserved:0,omittedHands:1});
    expect(publicHudAnalyticsFromCounters(row).metrics.vpip.percentage).toBeNull();
  });
  it.each(['in_progress','voided'])('does not contribute %s hands',status=>{
    expect(classifyPublicHudHand({...hand(),status})).toEqual([]);
  });
  it('does not contribute voided completed hands or count duplicate player identities twice',()=>{
    expect(classifyPublicHudHand({...hand(),isVoided:true})).toEqual([]);
    const h=hand();h.players.push({...h.players[0]});expect(classifyPublicHudHand(h)).toHaveLength(2);
  });
  it('supports one million hands with integer opportunity counts, no averaging or sample cap',()=>{
    const row=classifyPublicHudHand(hand())[0];
    const total={...row,numerators:row.numerators.map(n=>n*1_000_000),denominators:row.denominators.map(n=>n*1_000_000),missingProof:row.missingProof.map(n=>n*1_000_000),publicHands:1_000_000,handsObserved:1_000_000,omittedHands:0};
    expect(publicHudAnalyticsFromCounters(total).metrics.vpip).toMatchObject({numerator:1_000_000,denominator:1_000_000,percentage:100});
  });
  it('rejects corrupted counters and unsafe integer sums',()=>{
    const row=classifyPublicHudHand(hand())[0];
    expect(()=>validatePublicHudCounters({...row,numerators:[]})).toThrow('INVALID_COUNTERS');
    expect(()=>validatePublicHudCounters({...row,publicHands:0})).toThrow('INVALID_COUNTERS');
    expect(()=>validatePublicHudCounters({...row,denominators:PUBLIC_HUD_METRIC_KEYS.map(()=>Number.MAX_SAFE_INTEGER+1)})).toThrow('INVALID_COUNTERS');
  });
});
