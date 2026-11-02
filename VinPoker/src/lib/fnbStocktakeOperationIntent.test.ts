import {beforeEach,expect,it} from 'vitest';
import {readStocktakeOperation,writeStocktakeOperation,rejectStocktakeOperationCountsChanged,stocktakeOperationKey,type StocktakeOperationIntent} from './fnbStocktakeOperationIntent';
const scope={actorId:'10000000-0000-4000-8000-000000000001',clubId:'20000000-0000-4000-8000-000000000001',backend:'http://127.0.0.1:54329',requestId:'50000000-0000-4000-8000-000000000001'};
const open:StocktakeOperationIntent={...scope,kind:'open'};
const commit:StocktakeOperationIntent={...scope,requestId:'50000000-0000-4000-8000-000000000002',kind:'commit',sessionId:'30000000-0000-4000-8000-000000000001',counts:{'40000000-0000-4000-8000-000000000001':'0'}};
const read=()=>readStocktakeOperation(localStorage,scope.actorId,scope.clubId,scope.backend);
beforeEach(()=>localStorage.clear());
it('retains the rejected snapshot separately from success, without permitting the same request again',()=>{
 writeStocktakeOperation(localStorage,commit);rejectStocktakeOperationCountsChanged(localStorage,commit);expect(read()).toEqual({state:'counts_changed',intent:commit});
 expect(()=>writeStocktakeOperation(localStorage,commit)).toThrow();expect(()=>writeStocktakeOperation(localStorage,commit,true)).toThrow();
 const fresh={...commit,requestId:'50000000-0000-4000-8000-000000000003',counts:{'40000000-0000-4000-8000-000000000001':'4'}};writeStocktakeOperation(localStorage,fresh);expect(read()).toEqual({state:'pending',intent:fresh});
});
it('cannot reject an open request, altered frozen counts, or a newer pending intent',()=>{
 writeStocktakeOperation(localStorage,open);expect(()=>rejectStocktakeOperationCountsChanged(localStorage,open)).toThrow();expect(read()?.state).toBe('pending');writeStocktakeOperation(localStorage,open,true);writeStocktakeOperation(localStorage,commit);
 expect(()=>rejectStocktakeOperationCountsChanged(localStorage,{...commit,counts:{}})).toThrow();
 expect(()=>rejectStocktakeOperationCountsChanged(localStorage,{...commit,requestId:open.requestId})).toThrow();expect(read()).toEqual({state:'pending',intent:commit});
});
it('keeps pending when the rejection cannot be durably stored',()=>{
 writeStocktakeOperation(localStorage,commit);expect(()=>rejectStocktakeOperationCountsChanged({getItem:key=>localStorage.getItem(key),setItem:()=>{}},commit)).toThrow('STOCKTAKE_OPERATION_WRITE_FAILED');expect(read()?.state).toBe('pending');
});
it('rejects a corrupt rejected-open journal',()=>{
 localStorage.setItem(stocktakeOperationKey(scope.actorId,scope.clubId,scope.backend),JSON.stringify({state:'counts_changed',intent:open}));expect(read).toThrow();
});
it('freezes open and refuses switching to a different operation while pending',()=>{
 writeStocktakeOperation(localStorage,open);expect(read()).toEqual({state:'pending',intent:open});expect(()=>writeStocktakeOperation(localStorage,commit)).toThrow();
});
it('keeps exact session/count snapshot including zero and refuses stale settlement',()=>{
 writeStocktakeOperation(localStorage,open);writeStocktakeOperation(localStorage,open,true);writeStocktakeOperation(localStorage,commit);expect(read()?.intent).toEqual(commit);expect(()=>writeStocktakeOperation(localStorage,open,true)).toThrow();expect(()=>writeStocktakeOperation(localStorage,{...commit,counts:{}},true)).toThrow();writeStocktakeOperation(localStorage,commit,true);expect(read()?.state).toBe('settled');expect(()=>writeStocktakeOperation(localStorage,commit)).toThrow();
});
it.each([{state:['pending'],intent:open},{state:'pending',intent:{...commit,counts:[]}},{state:'pending',intent:{...commit,counts:{'40000000-0000-4000-8000-000000000001':'-1'}}},{state:'pending',intent:{...open,backend:'https://another.invalid'}},{state:'pending',intent:{...open,extra:true}}])('rejects corrupted or mixed-scope journal %j',value=>{
 localStorage.setItem(stocktakeOperationKey(scope.actorId,scope.clubId,scope.backend),JSON.stringify(value));expect(read).toThrow();
});
it('does not permit an operation when the journal write is ignored',()=>{
 expect(()=>writeStocktakeOperation({getItem:()=>null,setItem:()=>{}},open)).toThrow('STOCKTAKE_OPERATION_WRITE_FAILED');
});
