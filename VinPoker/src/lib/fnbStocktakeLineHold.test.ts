import {beforeEach,expect,it} from 'vitest';
import {readStocktakeLineHold,writeStocktakeLineHold,stocktakeLineHoldKey,type StocktakeLineHold} from './fnbStocktakeLineHold';
const intent:StocktakeLineHold={actorId:'10000000-0000-4000-8000-000000000001',clubId:'20000000-0000-4000-8000-000000000001',backend:'http://127.0.0.1:54329',requestId:'50000000-0000-4000-8000-000000000001',sessionId:'30000000-0000-4000-8000-000000000001',ingredientId:'40000000-0000-4000-8000-000000000001',countedQty:0};
const read=()=>readStocktakeLineHold(localStorage,intent.actorId,intent.clubId,intent.backend);
beforeEach(()=>localStorage.clear());
it('preserves a pending zero count and refuses replacing it with a different operation',()=>{
 writeStocktakeLineHold(localStorage,intent);expect(read()).toEqual({state:'pending',intent});expect(()=>writeStocktakeLineHold(localStorage,{...intent,countedQty:1.25})).toThrow();expect(read()?.intent).toEqual(intent);
});
it('only settles the exact pending local identity and fences old acknowledgements after a newer request',()=>{
 writeStocktakeLineHold(localStorage,intent);expect(()=>writeStocktakeLineHold(localStorage,{...intent,countedQty:99},true)).toThrow();writeStocktakeLineHold(localStorage,intent,true);expect(read()?.state).toBe('settled');expect(()=>writeStocktakeLineHold(localStorage,intent)).toThrow();
 const newer={...intent,requestId:'50000000-0000-4000-8000-000000000002',countedQty:1.25};writeStocktakeLineHold(localStorage,newer);expect(()=>writeStocktakeLineHold(localStorage,intent,true)).toThrow();expect(read()?.intent).toEqual(newer);
});
it.each([null,{state:['pending'],intent},{state:'pending',intent:{...intent,countedQty:-1}},{state:'pending',intent:{...intent,backend:'https://another.invalid'}},{state:'pending',intent:{...intent,extra:true}}])('rejects malformed or mixed-scope saved intent %j',value=>{
 localStorage.setItem(stocktakeLineHoldKey(intent.actorId,intent.clubId,intent.backend),JSON.stringify(value));expect(read).toThrow();
});
it('rejects ignored journal writes rather than allowing an unrecorded operation',()=>{
 expect(()=>writeStocktakeLineHold({getItem:()=>null,setItem:()=>{}},intent)).toThrow('STOCKTAKE_HOLD_WRITE_FAILED');
});
