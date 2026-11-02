import {beforeEach,describe,expect,it} from 'vitest';
import {fnbShiftBackend,fnbShiftJournalKey,parseFnbShiftIntent,parseFnbShiftCash,persistFnbShiftIntent,readFnbShiftJournal,
 settleFnbShiftIntent,resolveFnbShiftResult,resolveFnbShiftReceipt,fnbShiftPayload,type FnbShiftIntent} from './fnbShiftIntent';
const i:FnbShiftIntent={actorId:'10000000-0000-4000-8000-000000000001',clubId:'20000000-0000-4000-8000-000000000001',
 backend:'http://127.0.0.1:54329',requestId:'40000000-0000-4000-8000-000000000001',operation:'open',shiftId:null,amount:1000,note:null};
const shift='30000000-0000-4000-8000-000000000001';
const envelope=(intent=i)=>({actor_id:intent.actorId,club_id:intent.clubId,request_id:intent.requestId,operation:intent.operation});
describe('F&B shift intent journal and authoritative result',()=>{
 beforeEach(()=>localStorage.clear());
 it('normalizes the backend but never retains credentials/query secrets',()=>{
  expect(fnbShiftBackend(i.backend+'/')).toBe(i.backend);
  for(const url of ['https://u:pass@test.invalid','https://test.invalid?token=x','javascript:test'])expect(()=>fnbShiftBackend(url)).toThrow();
 });
 it('scopes the journal by backend, actor and club',()=>{
  const key=fnbShiftJournalKey(i.actorId,i.clubId,i.backend);
  expect(fnbShiftJournalKey(i.actorId,i.clubId,'http://127.0.0.1:54330')).not.toBe(key);
  expect(fnbShiftJournalKey('10000000-0000-4000-8000-000000000002',i.clubId,i.backend)).not.toBe(key);
  expect(()=>parseFnbShiftIntent(JSON.stringify({...i,clubId:shift}),i.actorId,i.clubId,i.backend)).toThrow();
 });
 it('preserves pending identity and fences replaced/late settlement',()=>{
  persistFnbShiftIntent(localStorage,i);expect(readFnbShiftJournal(localStorage,i.actorId,i.clubId,i.backend)?.intent).toEqual(i);
  const next={...i,requestId:'40000000-0000-4000-8000-000000000002'};
  expect(()=>persistFnbShiftIntent(localStorage,next)).toThrow();
  settleFnbShiftIntent(localStorage,i);persistFnbShiftIntent(localStorage,next);
  expect(()=>settleFnbShiftIntent(localStorage,i)).toThrow();
  expect(readFnbShiftJournal(localStorage,i.actorId,i.clubId,i.backend)?.intent.requestId).toBe(next.requestId);
 });
 it('fails closed if storage silently fails',()=>{
  expect(()=>persistFnbShiftIntent({getItem:()=>null,setItem:()=>{}},i)).toThrow('WRITE_FAILED');
 });
 it.each(['abc','-1','1.5','1,2','1 22','9007199254740992'])('rejects invalid/unsafe cash %s',raw=>expect(parseFnbShiftCash(raw)).toBeNull());
 it('accepts integer cash and intentional grouped thousands only',()=>{
  expect(parseFnbShiftCash('')).toBeNull();expect(parseFnbShiftCash('',true)).toBe(0);
  for(const raw of ['1000','1.000','1,000','1 000'])expect(parseFnbShiftCash(raw)).toBe(1000);
 });
 it('requires scoped open proof, not HTTP success or bare ok',()=>{
  const r={...envelope(),status:'ok',shift_id:shift,already_open:false,opening_float_vnd:1000};
  expect(resolveFnbShiftResult(i,r).status).toBe('applied');
  for(const bad of [null,{status:'ok'},{...r,actor_id:shift},{...r,opening_float_vnd:0},{...r,already_open:'false'}])expect(resolveFnbShiftResult(i,bad).status).toBe('unknown');
  expect(resolveFnbShiftResult(i,{...r,already_open:true,opening_float_vnd:2000}).status).toBe('applied');
 });
 it('checks close identity and cash conservation including variance',()=>{
  const close:FnbShiftIntent={...i,operation:'close',shiftId:shift,amount:6000};
  const r={...envelope(close),status:'ok',shift_id:shift,sales_vnd:5000,refunds_vnd:0,opening_float_vnd:1000,expected_cash_vnd:5000,counted_cash_vnd:6000,variance_vnd:0};
  expect(resolveFnbShiftResult(close,r).status).toBe('applied');
  for(const bad of [{...r,variance_vnd:1},{...r,counted_cash_vnd:0},{...r,expected_cash_vnd:0},{...r,shift_id:i.actorId}])expect(resolveFnbShiftResult(close,bad).status).toBe('unknown');
 });
 it('checks receipt payload before accepting stored core result without redundant context',()=>{
  const r={...envelope(),status:'found',intent:fnbShiftPayload(i),result:{status:'ok',shift_id:shift,already_open:false,opening_float_vnd:1000}};
  expect(resolveFnbShiftReceipt(i,r).status).toBe('applied');
  expect(resolveFnbShiftReceipt(i,{...r,intent:{...r.intent,float:0}}).status).toBe('unknown');
  expect(resolveFnbShiftReceipt(i,{...r,result:{...r.result,actor_id:shift}}).status).toBe('unknown');
  expect(resolveFnbShiftReceipt(i,{...envelope(),status:'not_found'}).status).toBe('not_found');
  expect(resolveFnbShiftResult(i,{...envelope(),status:'cancelled'}).status).toBe('cancelled');
 });
});
