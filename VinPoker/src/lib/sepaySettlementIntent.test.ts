import {expect,it} from 'vitest';
import {parseSePayReceipt,parseSePayJournal,saveSePayJournal,sepayPayload,type SePayIntent} from './sepaySettlementIntent';
const i:SePayIntent={actorId:'00000000-0000-4000-8000-000000000001',requestId:'00000000-0000-4000-8000-000000000002',
 bankId:'00000000-0000-4000-8000-000000000003',registrationId:'00000000-0000-4000-8000-000000000004',clubId:'00000000-0000-4000-8000-000000000005',operation:'confirm',reason:null};
const envelope=(receipt:unknown)=>({ok:true,status:'receipt_found',actor_id:i.actorId,request_id:i.requestId,club_id:i.clubId,
 payload:sepayPayload(i),request_hash:'a'.repeat(64),replayed:false,receipt});
it('does not accept bare legacy success without actor/request/payload',()=>{
 expect(()=>parseSePayReceipt({ok:true,outcome:'manual_confirmed'},i)).toThrow();
});
it('distinguishes partial and waiting instead of claiming seating',()=>{
 expect(parseSePayReceipt(envelope({ok:true,outcome:'partial_received',registration_id:i.registrationId,club_id:i.clubId,payment_state:'partial',received:40000,remaining:60000,applied:40000,surplus:0}),i)).toEqual({status:'partial',received:40000,remaining:60000,surplus:0});
 expect(parseSePayReceipt(envelope({ok:true,outcome:'paid_waiting_seat',registration_id:i.registrationId,club_id:i.clubId,payment_state:'paid',applied:60000,surplus:20000,confirm:{ok:true,payment_state:'paid',seating_state:'waiting'}}),i)).toEqual({status:'waiting',surplus:20000});
});
for(const change of [{actor_id:i.bankId},{request_id:i.bankId},{club_id:i.bankId},{payload:{...sepayPayload(i),reason:'changed'}},{request_hash:null}])
 it(`keeps mismatched receipt unknown ${JSON.stringify(change)}`,()=>expect(()=>parseSePayReceipt({...envelope({ok:false,error:'already_settled'}),...change},i)).toThrow());
it('absence is not a committed or rejected receipt',()=>{
 expect(parseSePayReceipt({...envelope(null),status:'receipt_not_found'},i)).toEqual({status:'missing'});
});
it('rejects malformed numeric and seat results',()=>{
 expect(()=>parseSePayReceipt(envelope({ok:true,outcome:'partial_received',registration_id:i.registrationId,club_id:i.clubId,payment_state:'partial',received:NaN,remaining:1,applied:0,surplus:0}),i)).toThrow();
 expect(()=>parseSePayReceipt(envelope({ok:true,outcome:'manual_confirmed',registration_id:i.registrationId,club_id:i.clubId,confirm:{ok:true}}),i)).toThrow();
});
it('binds journal actor and refuses corrupt/foreign intent',()=>{
 expect(parseSePayJournal(JSON.stringify(i),i.actorId)).toEqual(i);
 expect(()=>parseSePayJournal(JSON.stringify(i),i.bankId)).toThrow();
 expect(()=>parseSePayJournal('{',i.actorId)).toThrow();
});
it('does not overwrite a different pending intent or ignore failed storage',()=>{
 const map=new Map<string,string>();const storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);}};
 saveSePayJournal(storage,'test',i);saveSePayJournal(storage,'test',i);
 expect(()=>saveSePayJournal(storage,'test',{...i,requestId:i.bankId})).toThrow();
 expect(()=>saveSePayJournal({getItem:()=>null,setItem:()=>{}},'test',i)).toThrow();
});
it('binds the viewed amount snapshot to receipt and journal identity',()=>{
 const withSnapshot={...i,snapshot:{bank_amount:40000,total_pay:100000}};
 const result={ok:true,outcome:'partial_received',registration_id:i.registrationId,club_id:i.clubId,payment_state:'partial',received:40000,remaining:60000,applied:40000,surplus:0};
 expect(parseSePayReceipt({...envelope(result),payload:sepayPayload(withSnapshot)},withSnapshot).status).toBe('partial');
 expect(()=>parseSePayReceipt({...envelope(result),payload:{...sepayPayload(withSnapshot),snapshot:{bank_amount:80000,total_pay:100000}}},withSnapshot)).toThrow();
 const map=new Map<string,string>();const storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);}};
 saveSePayJournal(storage,'snapshot',withSnapshot);
 expect(()=>saveSePayJournal(storage,'snapshot',{...withSnapshot,snapshot:{bank_amount:80000,total_pay:100000}})).toThrow();
});
