import {beforeEach,expect,it} from 'vitest';
import {fnbStockInJournalKey,parseFnbStockInIntent,persistFnbStockInIntent,readFnbStockInJournal,
  resolveFnbStockInReceipt,fnbStockInWrite,type FnbStockInIntent} from './fnbStockInIntent';
const i:FnbStockInIntent={actorId:'10000000-0000-4000-8000-000000000001',clubId:'20000000-0000-4000-8000-000000000001',
  backend:'http://127.0.0.1:54329',requestId:'30000000-0000-4000-8000-000000000001',
  payload:{ingredient_id:'40000000-0000-4000-8000-000000000001',qty_purchase:0.5,unit_cost_purchase:1000}};
const row={id:'50000000-0000-4000-8000-000000000001',club_id:i.clubId,actor:i.actorId,client_request_id:i.requestId,
  ingredient_id:i.payload.ingredient_id,reason:'stock_in',ref_type:'manual',delta:0.5,unit_cost:1000,balance_after:14.5,
  details:{stock_in_intent_v1:{version:1,club_id:i.clubId,...i.payload}}};
beforeEach(()=>localStorage.clear());
it('persists before dispatch, survives a new read, and retains exact fractional quantity and explicit zero cost',()=>{
  const free={...i,payload:{...i.payload,unit_cost_purchase:0}};
  persistFnbStockInIntent(localStorage,free);
  const resumed=readFnbStockInJournal(localStorage,i.actorId,i.clubId,i.backend)!;
  expect(resumed).toEqual({state:'pending',intent:free});
  expect(fnbStockInWrite(resumed.intent)).toEqual({p_club_id:i.clubId,p_ingredient_id:i.payload.ingredient_id,
    p_qty_purchase:0.5,p_unit_cost_purchase:0,p_client_request_id:i.requestId});
});
it('does not replace unresolved payload or request and does not let a late settlement erase a newer intent',()=>{
  persistFnbStockInIntent(localStorage,i);
  const next={...i,requestId:'30000000-0000-4000-8000-000000000002'};
  expect(()=>persistFnbStockInIntent(localStorage,next)).toThrow();
  expect(()=>persistFnbStockInIntent(localStorage,{...i,payload:{...i.payload,qty_purchase:999}})).toThrow();
  persistFnbStockInIntent(localStorage,i,true);
  expect(()=>persistFnbStockInIntent(localStorage,i)).toThrow();
  persistFnbStockInIntent(localStorage,next);
  expect(()=>persistFnbStockInIntent(localStorage,i,true)).toThrow();
  expect(readFnbStockInJournal(localStorage,i.actorId,i.clubId,i.backend)?.intent).toEqual(next);
});
it('leaves corrupt or unavailable storage blocked instead of replacing it with a fresh request',()=>{
  expect(()=>persistFnbStockInIntent({getItem:()=>null,setItem:()=>{}},i)).toThrow('WRITE_FAILED');
  const key=fnbStockInJournalKey(i.actorId,i.clubId,i.backend);localStorage.setItem(key,'null');
  expect(()=>readFnbStockInJournal(localStorage,i.actorId,i.clubId,i.backend)).toThrow();
  expect(()=>persistFnbStockInIntent(localStorage,i)).toThrow();expect(localStorage.getItem(key)).toBe('null');
});
it.each([{qty_purchase:0},{qty_purchase:Infinity},{unit_cost_purchase:-1},{unit_cost_purchase:NaN}])('rejects invalid input without clamping or rounding %j',patch=>{
  expect(()=>parseFnbStockInIntent(JSON.stringify({...i,payload:{...i.payload,...patch}}),i.actorId,i.clubId,i.backend)).toThrow();
});
it('accepts only the exact stored movement receipt, without inventing average cost',()=>{
  expect(resolveFnbStockInReceipt(i,[row])).toEqual({status:'found',receipt:{movementId:row.id,delta:0.5,balanceAfter:14.5}});
  expect(resolveFnbStockInReceipt(i,[])).toEqual({status:'not_found'});
  expect(resolveFnbStockInReceipt(i,null)).toEqual({status:'unknown'});
  expect(resolveFnbStockInReceipt(i,[row,row])).toEqual({status:'unknown'});
});
it.each([{client_request_id:i.clubId},{actor:i.clubId},{club_id:i.actorId},{ingredient_id:i.actorId},{reason:'sale'},
  {details:{stock_in_intent_v1:{version:1,club_id:i.clubId,...i.payload,qty_purchase:999}}},
  {details:{stock_in_intent_v1:{version:1,club_id:i.clubId,...i.payload,unexpected:true}}},
  {delta:NaN},{balance_after:null}])('keeps mismatched, legacy or malformed receipts unresolved %j',patch=>{
  expect(resolveFnbStockInReceipt(i,[{...row,...patch}])).toEqual({status:'unknown'});
});
it.each([{},null,{stock_in_intent_v1:null}])('keeps a matching movement without its original intent unresolved and identifies the recovery hold %j',details=>{
  expect(resolveFnbStockInReceipt(i,[{...row,details}])).toEqual({status:'unknown',reason:'missing_intent'});
  expect(resolveFnbStockInReceipt(i,[{...row,actor:i.clubId,details}])).toEqual({status:'unknown'});
});
