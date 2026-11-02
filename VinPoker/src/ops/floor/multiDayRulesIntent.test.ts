import {expect,it} from 'vitest';
import {parseRulesIntent,persistRulesIntent,readRulesIntent,clearRulesIntent} from './multiDayRulesIntent';
import {parseApprovalIntent,persistApprovalIntent} from './multiDayApprovalIntent';
const actor='actor',event='event',id='10000000-0000-4000-8000-000000000001';
const value={actorId:actor,eventId:event,itmPercent:25,args:{p_event_id:event,p_policy:'SUM_STACKS',p_min_cash_x:1.5,p_day2_percent:50}};
function storage(){const rows=new Map<string,string>();return {getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v);},removeItem:(k:string)=>{rows.delete(k);}};}
it('retains exact immutable rules, prevents replacement and preserves scoped storage',()=>{
 const s=storage(),i=parseRulesIntent(value,actor,event);persistRulesIntent(s,i);
 expect(readRulesIntent(s,actor,event)).toEqual(i);expect(readRulesIntent(s,'other',event)).toBeNull();
 const other={...i,args:{...i.args,p_min_cash_x:2}};
 expect(()=>persistRulesIntent(s,other)).toThrow('PENDING');expect(()=>clearRulesIntent(s,other)).toThrow('CHANGED');
 clearRulesIntent(s,i);expect(readRulesIntent(s,actor,event)).toBeNull();
});
it('blocks approval while rules are unresolved and vice versa',()=>{
 const s=storage(),i=parseRulesIntent(value,actor,event),a=parseApprovalIntent({actorId:actor,eventId:event,args:{p_request_id:id,p_approval_request_id:id}},actor,event);
 persistRulesIntent(s,i);expect(()=>persistApprovalIntent(s,a)).toThrow('PENDING');clearRulesIntent(s,i);
 persistApprovalIntent(s,a);expect(()=>persistRulesIntent(s,i)).toThrow('PENDING');
});
it('rejects invalid scope, nonfinite values, unsupported policy and Day2 below ITM',()=>{
 for(const bad of [{...value,actorId:'other'},{...value,args:{...value.args,p_event_id:'other'}},
  {...value,args:{...value.args,p_policy:'unknown'}},{...value,args:{...value.args,p_min_cash_x:NaN}},
  {...value,args:{...value.args,p_day2_percent:24}},{...value,args:{...value.args,p_day2_percent:101}},
  {...value,itmPercent:0},{...value,args:{...value.args,p_min_cash_x:-1}}])
  expect(()=>parseRulesIntent(bad,actor,event)).toThrow();
});
