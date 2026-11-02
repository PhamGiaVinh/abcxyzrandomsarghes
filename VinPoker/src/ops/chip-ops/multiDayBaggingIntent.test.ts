import {beforeEach,expect,it} from 'vitest';
import {baggingJournalKey,parseBaggingIntent,persistBaggingIntent,clearBaggingIntent,validRecoveredBaggingReceipt,type BaggingIntent} from './multiDayBaggingIntent';
const snapshot={status:'bagging' as const,dayNumber:1,dayVersion:0,rosterHash:'hash',manager:true,
 rows:[{playerId:'player',seatNumber:1,trackedStack:100,bagCode:null,bagTotal:null,bagRevision:0,sealed:false,sealedVersion:null}]};
const intent:BaggingIntent={actorId:'actor',flightId:'flight',requestId:'request',name:'multi_day_record_bag_v1',
 args:{p_flight_tournament_id:'flight',p_player_id:'player',p_expected_revision:0,p_bag_code:'bag',p_total_value:100},snapshot,success:'Saved'};
const receipt={found:true,actorId:'actor',flightTournamentId:'flight',requestId:'request',action:'edit',playerId:'player',
 payload:intent.args,result:{ok:true,idempotent:false,bagId:'70000000-0000-0000-0000-000000000001',revision:1,trackedStack:100,bagTotal:100,variance:0,sealed:false}};
beforeEach(()=>sessionStorage.clear());
it('keeps exact intent across reload and prevents overwrite or wrong-scope reuse',()=>{
 persistBaggingIntent(sessionStorage,intent);
 const raw=sessionStorage.getItem(baggingJournalKey('actor','flight'))!;
 expect(parseBaggingIntent(raw,'actor','flight')).toEqual(intent);
 expect(()=>parseBaggingIntent(raw,'other','flight')).toThrow();
 expect(()=>persistBaggingIntent(sessionStorage,{...intent,requestId:'other'})).toThrow();
 expect(()=>clearBaggingIntent(sessionStorage,{...intent,requestId:'other'})).toThrow();
 clearBaggingIntent(sessionStorage,intent);expect(sessionStorage.length).toBe(0);
});
it('requires matching actor, flight, request, operation, player and complete result',()=>{
 expect(validRecoveredBaggingReceipt(intent,receipt)).toBe(true);
 for(const invalid of [{...receipt,found:false},{...receipt,actorId:'other'},{...receipt,flightTournamentId:'other'},
  {...receipt,requestId:'other'},{...receipt,action:'seal'},{...receipt,playerId:'other'}, {...receipt,result:{ok:true}},
  {...receipt,payload:{...intent.args,p_bag_code:'other'}}]) {
  expect(validRecoveredBaggingReceipt(intent,invalid)).toBe(false);
 }
});
it('fails closed when storage does not persist a request',()=>{
 expect(()=>persistBaggingIntent({getItem:()=>null,setItem:()=>{}},intent)).toThrow('BAGGING_JOURNAL_SAVE_FAILED');
});
it('rejects malformed stored payload rather than dispatching it on retry',()=>{
 for(const args of [{...intent.args,p_extra:true},{...intent.args,p_expected_revision:-1},
  {...intent.args,p_expected_revision:'0'},{...intent.args,p_total_value:null},
  {...intent.args,p_player_id:'other'},{...intent.args,p_bag_code:''}]) {
  expect(()=>parseBaggingIntent(JSON.stringify({...intent,args}),'actor','flight')).toThrow('BAGGING_JOURNAL_INVALID');
 }
});
