import {parseMultiDayBaggingState,validBaggingReceipt,type BagState} from './multiDayBaggingState';

export type BaggingIntent={actorId:string;flightId:string;requestId:string;name:string;args:Record<string,unknown>;snapshot:BagState;success:string};
const actions:Record<string,string>={multi_day_record_bag_v1:'edit',multi_day_seal_bag_v1:'seal',multi_day_close_bagging_v1:'close'};
export const baggingJournalKey=(actor:string,flight:string)=>`vinpoker:bagging:v1:${actor}:${flight}`;
export function parseBaggingIntent(raw:string,actor:string,flight:string):BaggingIntent {
 const v:unknown=JSON.parse(raw);
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('BAGGING_JOURNAL_INVALID');
 const i=v as BaggingIntent;
 if(i.actorId!==actor||i.flightId!==flight||typeof i.requestId!=='string'||!i.requestId
   ||!Object.prototype.hasOwnProperty.call(actions,i.name)||typeof i.success!=='string'||!i.args||typeof i.args!=='object'
   ||Array.isArray(i.args)||i.args.p_flight_tournament_id!==flight)throw Error('BAGGING_JOURNAL_INVALID');
 const snapshot=parseMultiDayBaggingState(i.snapshot);
 const close=i.name==='multi_day_close_bagging_v1',edit=i.name==='multi_day_record_bag_v1';
 const expectedKeys=close?['p_flight_tournament_id','p_expected_day_version']
  :edit?['p_flight_tournament_id','p_player_id','p_bag_code','p_total_value','p_expected_revision']
  :['p_flight_tournament_id','p_player_id','p_expected_revision'];
 if(Object.keys(i.args).length!==expectedKeys.length||expectedKeys.some(key=>!Object.prototype.hasOwnProperty.call(i.args,key)))throw Error('BAGGING_JOURNAL_INVALID');
 const revision=close?i.args.p_expected_day_version:i.args.p_expected_revision;
 if(!Number.isSafeInteger(revision)||Number(revision)<(i.name==='multi_day_seal_bag_v1'?1:0)
  ||(!close&&!snapshot.rows.some(row=>row.playerId===i.args.p_player_id))
  ||(edit&&(typeof i.args.p_bag_code!=='string'||!i.args.p_bag_code.trim()
    ||!Number.isSafeInteger(i.args.p_total_value)||Number(i.args.p_total_value)<0)))throw Error('BAGGING_JOURNAL_INVALID');
 return i;
}
export function persistBaggingIntent(storage:Pick<Storage,'getItem'|'setItem'>,i:BaggingIntent) {
 const key=baggingJournalKey(i.actorId,i.flightId),raw=JSON.stringify(i),prior=storage.getItem(key);
 if(prior!==null&&prior!==raw)throw Error('BAGGING_JOURNAL_PENDING');
 storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error('BAGGING_JOURNAL_SAVE_FAILED');
}
export function clearBaggingIntent(storage:Pick<Storage,'getItem'|'removeItem'>,i:BaggingIntent) {
 const key=baggingJournalKey(i.actorId,i.flightId);
 if(storage.getItem(key)!==JSON.stringify(i))throw Error('BAGGING_JOURNAL_CHANGED');
 storage.removeItem(key);if(storage.getItem(key)!==null)throw Error('BAGGING_JOURNAL_CLEAR_FAILED');
}
export function validRecoveredBaggingReceipt(i:BaggingIntent,v:unknown):boolean {
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const r=v as Record<string,unknown>;
 const payload=r.payload;
 if(!payload||typeof payload!=='object'||Array.isArray(payload)
  ||Object.keys(payload).length!==Object.keys(i.args).length
  ||Object.entries(i.args).some(([key,value])=>(payload as Record<string,unknown>)[key]!==value))return false;
 return r.found===true&&r.actorId===i.actorId&&r.flightTournamentId===i.flightId&&r.requestId===i.requestId
  &&r.action===actions[i.name]&&(r.playerId??null)===(i.args.p_player_id??null)
  &&validBaggingReceipt(i.name,i.args,i.snapshot,r.result);
}
