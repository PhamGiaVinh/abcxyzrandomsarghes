import {expect,it,vi} from 'vitest';
import {parseFinalizationIntent,persistFinalizationIntent,readFinalizationIntent,clearFinalizationIntent,finalizationJournalKey,definitiveFirstFinalizationFailure} from './multiDayFinalizationIntent';
const actor='actor',event='event';
const intent=()=>parseFinalizationIntent({actorId:actor,eventId:event,args:{p_event_id:event,p_request_id:'10000000-0000-4000-8000-000000000001',
 p_expected_rules_version:'a'.repeat(32),p_expected_funding_revision:'b'.repeat(32),p_expected_qualification_revision:'c'.repeat(32),p_expected_payout_input_hash:'d'.repeat(32)}},actor,event);
function storage(){const rows=new Map<string,string>();return {getItem:(key:string)=>rows.get(key)??null,setItem:(key:string,value:string)=>{rows.set(key,value);},removeItem:(key:string)=>{rows.delete(key);}};}
it('never treats transport, SDK or malformed receipt errors as database rejections',()=>{
 for(const value of [null,new TypeError('Failed to fetch'),{code:'08006'},{code:'PGRST000'},new Error('unverified')])expect(definitiveFirstFinalizationFailure(value)).toBe(false);
 expect(definitiveFirstFinalizationFailure({code:'40001'})).toBe(true);
});
it('roundtrips frozen arguments without changing the nonce and clears only the exact journal',()=>{
 const s=storage(),i=intent();persistFinalizationIntent(s,i);expect(readFinalizationIntent(s,actor,event)).toEqual(i);
 expect(readFinalizationIntent(s,'other',event)).toBeNull();
 expect(()=>clearFinalizationIntent(s,{...i,args:{...i.args,p_expected_payout_input_hash:'e'.repeat(32)}})).toThrow('CHANGED');
 clearFinalizationIntent(s,i);expect(readFinalizationIntent(s,actor,event)).toBeNull();
});
it('refuses to replace a pending request with changed payload',()=>{
 const s=storage(),i=intent();persistFinalizationIntent(s,i);
 expect(()=>persistFinalizationIntent(s,{...i,args:{...i.args,p_expected_payout_input_hash:'e'.repeat(32)}})).toThrow('PENDING');
 expect(readFinalizationIntent(s,actor,event)).toEqual(i);
});
it('fails closed for corrupt scope, payload or storage that silently drops writes',()=>{
 expect(()=>parseFinalizationIntent({...intent(),actorId:'other'},actor,event)).toThrow();
 expect(()=>parseFinalizationIntent({...intent(),args:{...intent().args,p_request_id:'bad'}},actor,event)).toThrow();
 const s=storage();s.setItem(finalizationJournalKey(actor,event),'broken');expect(()=>readFinalizationIntent(s,actor,event)).toThrow();
 expect(()=>persistFinalizationIntent({getItem:()=>null,setItem:vi.fn()},intent())).toThrow('SAVE_FAILED');
});
