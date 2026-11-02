import {beforeEach,expect,it} from 'vitest';
import {readPhoneCheckinIntent,persistPhoneCheckinIntent,settlePhoneCheckinIntent,phoneCheckinJournalKey,phoneCheckinReceipt,type DealerPhoneCheckinIntent} from './dealerPhoneCheckinIntent';
const intent:DealerPhoneCheckinIntent={actorId:'11111111-1111-4111-8111-111111111111',clubId:'22222222-2222-4222-8222-222222222222',requestId:'33333333-3333-4333-8333-333333333333',
 entries:[{entry_id:'44444444-4444-4444-8444-444444444444',mode:'unscheduled',input_method:'manual_list',user_id:null,dealer_id:'55555555-5555-4555-8555-555555555555',shift_assignment_id:null,reason:'TEST'}],
 labels:[{entryId:'44444444-4444-4444-8444-444444444444',dealerId:'55555555-5555-4555-8555-555555555555',name:'TEST dealer'}]};
let values:Map<string,string>;
const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
const receipt=()=>({outcome:'completed',request_id:intent.requestId,club_id:intent.clubId,results:[{entry_id:intent.entries[0].entry_id,dealer_id:intent.labels[0].dealerId,code:'checked_in_available'}]});
beforeEach(()=>{values=new Map();});
it('persists exact payload, rejects changed nonce/payload and scopes actor/club',()=>{
 persistPhoneCheckinIntent(storage,intent);expect(readPhoneCheckinIntent(storage,intent)).toEqual(intent);
 expect(()=>persistPhoneCheckinIntent(storage,{...intent,requestId:crypto.randomUUID()})).toThrow();
 expect(()=>persistPhoneCheckinIntent(storage,{...intent,entries:[{...intent.entries[0],reason:'changed'}]})).toThrow();
 expect(readPhoneCheckinIntent(storage,{...intent,actorId:crypto.randomUUID()})).toBeNull();
 values.set(phoneCheckinJournalKey(intent),JSON.stringify({...intent,clubId:crypto.randomUUID()}));
 expect(()=>readPhoneCheckinIntent(storage,intent)).toThrow();
});
it('does not send through corrupt/readback-denied storage',()=>{
 values.set(phoneCheckinJournalKey(intent),'{');expect(()=>readPhoneCheckinIntent(storage,intent)).toThrow();
 values.clear();expect(()=>persistPhoneCheckinIntent({...storage,setItem:()=>{}},intent)).toThrow();
});
it('accepts correlated complete/partial and clears only exact intent',()=>{
 expect(phoneCheckinReceipt(receipt(),intent)?.outcome).toBe('completed');
 expect(phoneCheckinReceipt({...receipt(),outcome:'partial',results:[{...receipt().results[0],code:'dealer_inactive'}]},intent)?.outcome).toBe('partial');
 persistPhoneCheckinIntent(storage,intent);settlePhoneCheckinIntent(storage,intent);expect(readPhoneCheckinIntent(storage,intent)).toBeNull();
});
it.each(['request','club','entry','dealer','unknownCode','missing','duplicate','falseComplete','falsePartial','null'])('does not accept %s as verified mutation',kind=>{
 const r=receipt();
 if(kind==='request')r.request_id=crypto.randomUUID();if(kind==='club')r.club_id=crypto.randomUUID();
 if(kind==='entry')r.results[0].entry_id=crypto.randomUUID();if(kind==='dealer')r.results[0].dealer_id=crypto.randomUUID();
 if(kind==='unknownCode')r.results[0].code='new_unknown_success';if(kind==='missing')r.results=[];
 if(kind==='duplicate')r.results.push(r.results[0]);if(kind==='falseComplete')r.results[0].code='failed';
 if(kind==='falsePartial')r.outcome='partial';expect(phoneCheckinReceipt(kind==='null'?null:r,intent)).toBeNull();
});
