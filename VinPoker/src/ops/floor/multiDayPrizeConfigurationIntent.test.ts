import {expect,it,vi} from 'vitest';
import {parsePrizeConfigurationIntent,readPrizeConfigurationIntent,persistPrizeConfigurationIntent,clearPrizeConfigurationIntent,
 prizeConfigurationJournalKey,parsePrizeConfigurationSaveReceipt,parsePrizeConfigurationReceiptRead,
 submitPrizeConfiguration,reconcilePrizeConfiguration} from './multiDayPrizeConfigurationIntent';
import {eventJournalKey,persistEventJournal,clearEventJournal} from './multiDayEventJournal';
const actor='10000000-0000-4000-8000-000000000001',event='10000000-0000-4000-8000-000000000002';
const backend='http://127.0.0.1:54329',request='10000000-0000-4000-8000-000000000003';
const value=()=>({actorId:actor,eventId:event,backendScope:backend,args:{p_event_id:event,p_rows:[{position:1,amount:120000},{position:2,amount:110000}],
 p_expected_configuration_revision:'a'.repeat(32),p_expected_rules_version:'b'.repeat(32),p_expected_funding_revision:'c'.repeat(32),
 p_expected_qualification_revision:'d'.repeat(32),p_expected_payout_input_hash:'e'.repeat(32),p_request_id:request,p_reason:'TEST explicit owner proposal'}});
const intent=()=>parsePrizeConfigurationIntent(value(),actor,event,backend);
const receipt=()=>({ok:true,state:'CONFIGURED',idempotent:false,eventId:event,requestId:request,configurationRevision:'f'.repeat(32),
 previousConfigurationRevision:'a'.repeat(32),payoutInputHash:'e'.repeat(32),requiredShortfallVnd:160000,
 fundingExecution:'NOT_PERFORMED',paymentExecution:'NOT_PERFORMED',obligationFinalization:'NOT_PERFORMED',
 requestPayload:{event,rows:value().args.p_rows,configuration:'a'.repeat(32),rules:'b'.repeat(32),funding:'c'.repeat(32),
  qualification:'d'.repeat(32),proposal:'e'.repeat(32),reason:value().args.p_reason}});
function storage(){const data=new Map<string,string>();return {getItem:(key:string)=>data.get(key)??null,
 setItem:(key:string,raw:string)=>{data.set(key,raw);},removeItem:(key:string)=>{data.delete(key);}};}
it('persists before sending, keeps unknown outcomes and reconciles the original request after reload',async()=>{
 const s=storage(),i=intent();
 const send=vi.fn(async()=>{expect(readPrizeConfigurationIntent(s,actor,event,backend)).toEqual(i);throw Error('response lost');});
 await expect(submitPrizeConfiguration(s,i,send)).rejects.toThrow('response lost');
 const restored=readPrizeConfigurationIntent(s,actor,event,backend)!;
 const absent=vi.fn(async()=>({ok:true,state:'NOT_FOUND',eventId:event,requestId:request}));
 expect((await reconcilePrizeConfiguration(s,restored,absent)).state).toBe('NOT_FOUND');
 expect(readPrizeConfigurationIntent(s,actor,event,backend)).toEqual(i);
 const lookup=vi.fn(async()=>({...receipt(),idempotent:true}));
 expect((await reconcilePrizeConfiguration(s,restored,lookup)).state).toBe('CONFIGURED');
 expect(lookup).toHaveBeenCalledWith('multi_day_prize_configuration_receipt_v1',{p_event_id:event,p_request_id:request});
 expect(readPrizeConfigurationIntent(s,actor,event,backend)).toBeNull();
});
it('does not send if durable persistence fails or discard an unverified successful response',async()=>{
 const send=vi.fn(async()=>receipt());
 await expect(submitPrizeConfiguration({getItem:()=>null,setItem:()=>{},removeItem:()=>{}},intent(),send)).rejects.toThrow('SAVE_FAILED');
 expect(send).not.toHaveBeenCalled();
 const s=storage(),i=intent();
 await expect(submitPrizeConfiguration(s,i,async()=>({ok:true}))).rejects.toThrow('unverified');
 expect(readPrizeConfigurationIntent(s,actor,event,backend)).toEqual(i);
 await expect(reconcilePrizeConfiguration(s,i,async()=>({...receipt(),requestPayload:{...receipt().requestPayload,reason:'changed'}}))).rejects.toThrow('unverified');
 expect(readPrizeConfigurationIntent(s,actor,event,backend)).toEqual(i);
});
it('retries exactly the retained intent and clears only a fully verified commit',async()=>{
 const s=storage(),i=intent();persistPrizeConfigurationIntent(s,i);
 const send=vi.fn(async()=>({...receipt(),idempotent:true}));
 expect((await submitPrizeConfiguration(s,i,send)).idempotent).toBe(true);
 expect(send).toHaveBeenCalledOnce();
 expect(send).toHaveBeenCalledWith('multi_day_save_prize_configuration_v1',i.args);
 expect(readPrizeConfigurationIntent(s,actor,event,backend)).toBeNull();
});
it('retains the request after a retry rejection, malformed lookup or failed journal clear',async()=>{
 const s=storage(),i=intent();persistPrizeConfigurationIntent(s,i);
 await expect(submitPrizeConfiguration(s,i,async()=>{throw {code:'40001'};})).rejects.toEqual({code:'40001'});
 await expect(reconcilePrizeConfiguration(s,i,async()=>null)).rejects.toThrow('unverified');
 expect(readPrizeConfigurationIntent(s,actor,event,backend)).toEqual(i);
 await expect(reconcilePrizeConfiguration({...s,removeItem:()=>{}},i,async()=>receipt())).rejects.toThrow('CLEAR_FAILED');
 expect(readPrizeConfigurationIntent(s,actor,event,backend)).toEqual(i);
});
it('retains exact rows, all source revisions and nonce through reload; clear cannot remove another payload',()=>{
 const s=storage(),i=intent();persistPrizeConfigurationIntent(s,i);
 expect(readPrizeConfigurationIntent(s,actor,event,backend)).toEqual(i);
 expect(()=>clearPrizeConfigurationIntent(s,{...i,args:{...i.args,p_reason:'Different owner decision'}})).toThrow('CHANGED');
 expect(()=>persistPrizeConfigurationIntent(s,{...i,args:{...i.args,p_request_id:'10000000-0000-4000-8000-000000000004'}})).toThrow('PENDING');
 clearPrizeConfigurationIntent(s,i);expect(readPrizeConfigurationIntent(s,actor,event,backend)).toBeNull();
});
it('does not replay or erase a retained clone request against a different backend',()=>{
 const s=storage(),i=intent();persistPrizeConfigurationIntent(s,i);
 expect(()=>readPrizeConfigurationIntent(s,actor,event,'http://127.0.0.1:54330')).toThrow('SCOPE_CONFLICT');
 expect(readPrizeConfigurationIntent(s,actor,event,backend)).toEqual(i);
 expect(readPrizeConfigurationIntent(s,'other-actor',event,backend)).toBeNull();
});
it.each(['finalize','qualify','approve','correction','rules','end-flight','bag-release'] as const)('excludes unresolved %s in both directions',kind=>{
 const s=storage(),i=intent();persistPrizeConfigurationIntent(s,i);
 expect(()=>persistEventJournal(s,kind,actor,event,'EXISTING_INTENT_TEST')).toThrow('PENDING');
 clearPrizeConfigurationIntent(s,i);persistEventJournal(s,kind,actor,event,'EXISTING_INTENT_TEST');
 expect(()=>persistPrizeConfigurationIntent(s,i)).toThrow('PENDING');
 clearEventJournal(s,kind,actor,event,'EXISTING_INTENT_TEST');
 expect(s.getItem(eventJournalKey(kind,actor,event))).toBeNull();
});
it('fails closed for malformed journals, dropped persistence and silently failed removal',()=>{
 const s=storage(),i=intent();s.setItem(prizeConfigurationJournalKey(actor,event),'bad-json');
 expect(()=>readPrizeConfigurationIntent(s,actor,event,backend)).toThrow();
 expect(()=>persistPrizeConfigurationIntent({getItem:()=>null,setItem:vi.fn()},i)).toThrow('SAVE_FAILED');
 const raw=JSON.stringify(i);expect(()=>clearPrizeConfigurationIntent({getItem:()=>raw,removeItem:vi.fn()},i)).toThrow('CLEAR_FAILED');
});
it.each([
 [{position:1,amount:110000},{position:1,amount:110000}],
 [{position:1,amount:110000},{position:3,amount:110000}],
 [{position:1,amount:110000},{position:2,amount:120000}],
 [{position:1,amount:-1}],[{position:1,amount:1.5}],[{position:1,amount:10000000000}],
])('rejects malformed or noncanonical rows %j',rows=>{
 const v=value();expect(()=>parsePrizeConfigurationIntent({...v,args:{...v.args,p_rows:rows}},actor,event,backend)).toThrow();
});
it('rejects changed event/actor, unknown payload fields, malformed proof or unsafe backend identity',()=>{
 const v=value();
 for(const bad of [{...v,actorId:event},{...v,eventId:actor},{...v,args:{...v.args,p_event_id:actor}},
  {...v,args:{...v.args,p_expected_configuration_revision:'unknown'}},{...v,args:{...v.args,p_reason:''}},
  {...v,args:{...v.args,amount:10}},{...v,backendScope:'http://outside.test.invalid'},
  {...v,backendScope:'https://example.test.invalid/?token=TEST_ONLY'}])
  expect(()=>parsePrizeConfigurationIntent(bad,actor,event,backend)).toThrow();
});
it('accepts only a bound configured receipt, including idempotent replay without payment',()=>{
 const i=intent(),r=receipt();expect(parsePrizeConfigurationSaveReceipt(r,i.args)).toEqual(r);
 expect(parsePrizeConfigurationReceiptRead({...r,idempotent:true},i)).toEqual({...r,idempotent:true});
 for(const bad of [null,{ok:true},{...r,state:'READY'},{...r,idempotent:'true'},{...r,eventId:actor},
  {...r,requestId:actor},{...r,previousConfigurationRevision:'0'.repeat(32)},{...r,payoutInputHash:'0'.repeat(32)},
  {...r,configurationRevision:'bad'},{...r,requiredShortfallVnd:-1},{...r,paymentExecution:'PERFORMED'},
  {...r,fundingExecution:'PERFORMED'},{...r,obligationFinalization:'PERFORMED'}])
  expect(()=>parsePrizeConfigurationSaveReceipt(bad,i.args)).toThrow('unverified');
});
it('does not reconcile a stored receipt against an intent whose reason was changed',()=>{
 const i=intent();expect(()=>parsePrizeConfigurationSaveReceipt(receipt(),{...i.args,p_reason:'Different owner decision'})).toThrow('unverified');
});
it('treats NOT_FOUND only as recovery evidence and keeps the unknown original request',()=>{
 const s=storage(),i=intent(),missing={ok:true,state:'NOT_FOUND',eventId:event,requestId:request};persistPrizeConfigurationIntent(s,i);
 expect(parsePrizeConfigurationReceiptRead(missing,i)).toEqual(missing);
 expect(()=>parsePrizeConfigurationSaveReceipt(missing,i.args)).toThrow('unverified');
 expect(()=>parsePrizeConfigurationReceiptRead({...missing,requestId:actor},i)).toThrow('unverified');
 expect(readPrizeConfigurationIntent(s,actor,event,backend)).toEqual(i);
});
