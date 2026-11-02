import {expect,it} from 'vitest';
import type {StocktakeOperationIntent} from './fnbStocktakeOperationIntent';
import {resolveStocktakeOperationReceipt as resolve} from './fnbStocktakeOperationReceipt';
const actor='10000000-0000-4000-8000-000000000001',club='20000000-0000-4000-8000-000000000001',id='30000000-0000-4000-8000-000000000001',ingredient='40000000-0000-4000-8000-000000000001',request='50000000-0000-4000-8000-000000000001';
const open:StocktakeOperationIntent={actorId:actor,clubId:club,backend:'http://127.0.0.1:54329',requestId:request,kind:'open'};
const commit:StocktakeOperationIntent={...open,kind:'commit',sessionId:id,counts:{[ingredient]:'1.250'}};
const session={id,club_id:club,client_request_id:request,note:null,status:'open',created_by:actor,created_at:'2026-10-27T01:00:00Z',committed_by:null,committed_at:null};
const closed={...session,status:'committed',committed_by:actor,committed_at:'2026-10-27T02:00:00Z'};
const row={stocktake_id:id,club_id:club,ingredient_id:ingredient,counted_qty:'1.25',expected_qty:'2.5',delta_applied:'-1.25'};
it('recognizes only the exact created open request, including when that session has since closed',()=>{
 expect(resolve(open,session).status).toBe('found');expect(resolve(open,closed).status).toBe('found');expect(resolve(open,{...session,client_request_id:'another'})).toEqual({status:'unknown'});
});
it.each([null,{...session,status:['open']},{...session,club_id:actor},{...session,created_by:club},{...session,note:'changed'},{...session,created_at:'invalid'}])('keeps missing or inconsistent request record unknown %j',value=>{
 expect(resolve(open,value)).toEqual({status:'unknown'});
});
it('recognizes an exact committed snapshot with numeric text and recorded operator, not a new write',()=>{
 expect(resolve(commit,closed,{rows:[row],count:1})).toEqual({status:'found',proof:{sessionId:id,status:'committed',recordedBy:actor}});
});
it.each([{rows:[row],count:null},{rows:[row],count:2},{rows:[],count:0},{rows:[row,row],count:2},{rows:[{...row,counted_qty:1.25}],count:1},{rows:[{...row,delta_applied:'0'}],count:1},{rows:[{...row,stocktake_id:club}],count:1},{rows:[{...row,ingredient_id:actor}],count:1},{rows:[{...row,counted_qty:'1.25000000000000001'}],count:1}])('requires a complete exact saved count set and consistent delta %j',lines=>{
 expect(resolve(commit,closed,lines)).toEqual({status:'unknown'});
});
it('does not settle a still-open session or an unknown recorded commit operator',()=>{
 expect(resolve(commit,session,{rows:[row],count:1})).toEqual({status:'unknown'});expect(resolve(commit,{...closed,committed_by:null},{rows:[row],count:1})).toEqual({status:'unknown'});
});
it('permits explicit zero and exponent formatting without floating-point arithmetic',()=>{
 const zero={...commit,counts:{[ingredient]:'0'}};expect(resolve(zero,closed,{rows:[{...row,counted_qty:'0.000',expected_qty:'2.5',delta_applied:'-2.50'}],count:1}).status).toBe('found');
 expect(resolve({...commit,counts:{[ingredient]:'1.25e0'}},closed,{rows:[row],count:1}).status).toBe('found');
});
