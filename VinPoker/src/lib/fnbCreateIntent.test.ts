import {beforeEach,describe,expect,it} from 'vitest';
import {fnbCreateJournalKey,parseFnbCreateIntent,persistFnbCreateIntent,readFnbCreateJournal,resolveFnbCreateReceipt,fnbCreateWrite,type FnbCreateIntent} from './fnbCreateIntent';
const i:FnbCreateIntent={actorId:'10000000-0000-4000-8000-000000000001',clubId:'20000000-0000-4000-8000-000000000001',backend:'http://127.0.0.1:54329',requestId:'30000000-0000-4000-8000-000000000001',operation:'order',
 payload:{source:'counter',table:null,customer:'TEST name',note:null,lines:[{menu_item_id:'40000000-0000-4000-8000-000000000001',qty:1}],table_ref:null,player_ref:null}};
const receipt={status:'found',actor_id:i.actorId,club_id:i.clubId,request_id:i.requestId,operation:'order',intent:i.payload,
 order:{id:'50000000-0000-4000-8000-000000000001',status:'pending',subtotal_vnd:5000,is_comp:false}};
describe('create journal and exact canonical receipt',()=>{
 beforeEach(()=>localStorage.clear());
 it('binds scope/backend and rejects hidden credentials',()=>{
  expect(()=>parseFnbCreateIntent(JSON.stringify(i),i.actorId,i.clubId,'http://127.0.0.1:54330')).toThrow();
  expect(()=>fnbCreateJournalKey(i.actorId,i.clubId,'https://user:secret@test.invalid')).toThrow();
  expect(()=>parseFnbCreateIntent(JSON.stringify({...i,token:'secret'}),i.actorId,i.clubId,i.backend)).toThrow();
 });
 it('retains exact pending payload, fences new keys and late settlement',()=>{
  persistFnbCreateIntent(localStorage,i);expect(readFnbCreateJournal(localStorage,i.actorId,i.clubId,i.backend)?.intent).toEqual(i);
  const next={...i,requestId:'30000000-0000-4000-8000-000000000002'};
  expect(()=>persistFnbCreateIntent(localStorage,next)).toThrow();
  persistFnbCreateIntent(localStorage,i,true);expect(()=>persistFnbCreateIntent(localStorage,i)).toThrow();
  persistFnbCreateIntent(localStorage,next);expect(()=>persistFnbCreateIntent(localStorage,i,true)).toThrow();
 });
 it('fails closed on silent storage failure and corrupt data',()=>{
  expect(()=>persistFnbCreateIntent({getItem:()=>null,setItem:()=>{}},i)).toThrow('WRITE_FAILED');
  localStorage.setItem(fnbCreateJournalKey(i.actorId,i.clubId,i.backend),'null');
  expect(()=>readFnbCreateJournal(localStorage,i.actorId,i.clubId,i.backend)).toThrow();
 });
 it('validates lines without inventing quantity/amount or normalizing the payload',()=>{
  for(const bad of [[],[{menu_item_id:'bad',qty:1}],[{menu_item_id:i.payload.lines[0].menu_item_id,qty:0}]]){
   expect(()=>parseFnbCreateIntent(JSON.stringify({...i,payload:{...i.payload,lines:bad}}),i.actorId,i.clubId,i.backend)).toThrow();
  }
  expect(fnbCreateWrite(i).args.p_lines).toEqual(i.payload.lines);
 });
 it('requires actor/club/key/operation/full-payload and correct result identity',()=>{
  expect(resolveFnbCreateReceipt(i,receipt).status).toBe('found');
  for(const value of [null,{status:'ok'}, {...receipt,actor_id:i.clubId},{...receipt,request_id:i.actorId},
   {...receipt,intent:{...i.payload,customer:'different'}},{...receipt,order:{...receipt.order,is_comp:true}},
   {...receipt,order:{...receipt.order,id:'not-a-uuid'}},{...receipt,order:{...receipt.order,subtotal_vnd:-1}}])expect(resolveFnbCreateReceipt(i,value).status).toBe('unknown');
 });
 it('does not turn not_found, unresolved or legacy into proof of cancellation/success',()=>{
  const context={actor_id:i.actorId,club_id:i.clubId,request_id:i.requestId};
  expect(resolveFnbCreateReceipt(i,{...context,status:'not_found'}).status).toBe('not_found');
  for(const status of ['unresolved','legacy_unverified','cancelled'])expect(resolveFnbCreateReceipt(i,{...context,status}).status).toBe('unknown');
  expect(resolveFnbCreateReceipt(i,{...context,status:'not_found',order:receipt.order}).status).toBe('unknown');
 });
 it('binds comp reason and does not treat it as a normal create',()=>{
  const {table_ref:_table,player_ref:_player,...base}=i.payload;
  const comp:FnbCreateIntent={...i,operation:'comp',payload:{...base,reason:'TEST comp'}};
  const r={...receipt,operation:'comp',intent:comp.payload,order:{...receipt.order,status:'paid',is_comp:true}};
  expect(resolveFnbCreateReceipt(comp,r).status).toBe('found');
  expect(resolveFnbCreateReceipt(comp,{...r,intent:{...comp.payload,reason:'changed'}}).status).toBe('unknown');
  expect(fnbCreateWrite(comp)).toMatchObject({name:'fnb_create_comp_order',args:{p_comp_reason:'TEST comp',p_client_request_id:i.requestId}});
 });
 it('requires a full cancellation fence and rejects a contradictory error or committed order',()=>{
  const cancelled={status:'cancelled',actor_id:i.actorId,club_id:i.clubId,request_id:i.requestId,operation:i.operation,intent:i.payload};
  expect(resolveFnbCreateReceipt(i,cancelled).status).toBe('cancelled');
  for(const bad of [{...cancelled,intent:{...i.payload,customer:'changed'}},{...cancelled,actor_id:i.clubId},
   {...cancelled,order:receipt.order},{...cancelled,order_id:receipt.order.id},{...receipt,error:'Forbidden'},{...cancelled,error:'Forbidden'}]){
   expect(resolveFnbCreateReceipt(i,bad).status).toBe('unknown');
  }
 });
});
