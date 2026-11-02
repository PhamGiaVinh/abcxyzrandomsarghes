import {expect,it} from 'vitest';
import {parseApprovalIntent,persistApprovalIntent,readApprovalIntent,clearApprovalIntent} from './multiDayApprovalIntent';
import {parseQualificationIntent,persistQualificationIntent,clearQualificationIntent} from './multiDayQualificationIntent';
const actor='actor',event='event',request='10000000-0000-4000-8000-000000000001';
const value={actorId:actor,eventId:event,args:{p_request_id:request,p_approval_request_id:'10000000-0000-4000-8000-000000000002'}};
function storage(){const rows=new Map<string,string>();return {getItem:(key:string)=>rows.get(key)??null,setItem:(key:string,raw:string)=>{rows.set(key,raw);},removeItem:(key:string)=>{rows.delete(key);}};}
it('retains exact correction and approval keys with scope and CAS protection',()=>{
 const s=storage(),intent=parseApprovalIntent(value,actor,event);persistApprovalIntent(s,intent);
 expect(readApprovalIntent(s,actor,event)).toEqual(intent);expect(readApprovalIntent(s,'other',event)).toBeNull();
 const different={...intent,args:{...intent.args,p_request_id:intent.args.p_approval_request_id}};
 expect(()=>persistApprovalIntent(s,different)).toThrow('PENDING');expect(()=>clearApprovalIntent(s,different)).toThrow('CHANGED');
 clearApprovalIntent(s,intent);expect(readApprovalIntent(s,actor,event)).toBeNull();
});
it('excludes qualification in both directions while approval remains unresolved',()=>{
 const s=storage(),a=parseApprovalIntent(value,actor,event),q=parseQualificationIntent({actorId:actor,eventId:event,policy:'SUM_STACKS',
  args:{p_event_id:event,p_bag_ids:[request],p_expected_source_hash:'a'.repeat(32),p_request_id:request}},actor,event);
 persistApprovalIntent(s,a);expect(()=>persistQualificationIntent(s,q)).toThrow('PENDING');clearApprovalIntent(s,a);
 persistQualificationIntent(s,q);expect(()=>persistApprovalIntent(s,a)).toThrow('PENDING');clearQualificationIntent(s,q);
});
it('rejects malformed or mismatched approval journals',()=>{
 for(const bad of [{...value,actorId:'other'},{...value,eventId:'other'},{...value,args:{...value.args,p_request_id:'bad'}},
  {...value,args:{...value.args,p_approval_request_id:'bad'}},{...value,args:{...value.args,amount:100}}])
  expect(()=>parseApprovalIntent(bad,actor,event)).toThrow();
});
