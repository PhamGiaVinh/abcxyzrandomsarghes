import {expect,it} from 'vitest';
import {parseCorrectionIntent,persistCorrectionIntent,readCorrectionIntent,clearCorrectionIntent} from './multiDayCorrectionIntent';
import {parseApprovalIntent,persistApprovalIntent} from './multiDayApprovalIntent';
const actor='actor',event='event',id='10000000-0000-4000-8000-000000000001';
const value={actorId:actor,eventId:event,args:{p_event_id:event,p_kind:'OBLIGATION_DELTA',p_participation_id:id,
 p_original_payment_id:null,p_delta_vnd:-1,p_expected_revision:'a'.repeat(32),p_reason:'TEST correction',p_evidence_ref:'TEST evidence',p_request_id:id}};
function storage(){const rows=new Map<string,string>();return {getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v);},removeItem:(k:string)=>{rows.delete(k);}};}
it('freezes correction payload, rejects replacement and protects actor scope',()=>{
 const s=storage(),i=parseCorrectionIntent(value,actor,event);persistCorrectionIntent(s,i);
 expect(readCorrectionIntent(s,actor,event)).toEqual(i);expect(readCorrectionIntent(s,'other',event)).toBeNull();
 const changed={...i,args:{...i.args,p_delta_vnd:-2}};
 expect(()=>persistCorrectionIntent(s,changed)).toThrow('PENDING');expect(()=>clearCorrectionIntent(s,changed)).toThrow('CHANGED');
 clearCorrectionIntent(s,i);expect(readCorrectionIntent(s,actor,event)).toBeNull();
});
it('excludes approval and correction journals in both directions',()=>{
 const s=storage(),i=parseCorrectionIntent(value,actor,event),a=parseApprovalIntent({actorId:actor,eventId:event,args:{p_request_id:id,p_approval_request_id:id}},actor,event);
 persistCorrectionIntent(s,i);expect(()=>persistApprovalIntent(s,a)).toThrow('PENDING');clearCorrectionIntent(s,i);
 persistApprovalIntent(s,a);expect(()=>persistCorrectionIntent(s,i)).toThrow('PENDING');
});
it('rejects bad scope, unsafe amounts, malformed revision and inconsistent reversal identity',()=>{
 for(const bad of [{...value,actorId:'other'},{...value,args:{...value.args,p_event_id:'other'}},
  {...value,args:{...value.args,p_delta_vnd:0}},{...value,args:{...value.args,p_delta_vnd:1.1}},
  {...value,args:{...value.args,p_delta_vnd:Number.MAX_SAFE_INTEGER+1}},{...value,args:{...value.args,p_expected_revision:'bad'}},
  {...value,args:{...value.args,p_kind:'PAYMENT_REVERSAL'}},{...value,args:{...value.args,p_original_payment_id:id}}])
  expect(()=>parseCorrectionIntent(bad,actor,event)).toThrow();
});
