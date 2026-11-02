import {expect,it} from 'vitest';
import {parseQualificationIntent,persistQualificationIntent,readQualificationIntent,clearQualificationIntent} from './multiDayQualificationIntent';
import {persistFinalizationIntent,parseFinalizationIntent} from './multiDayFinalizationIntent';
const actor='actor',event='event',request='10000000-0000-4000-8000-000000000001';
const value={actorId:actor,eventId:event,policy:'SUM_STACKS',args:{p_event_id:event,p_request_id:request,p_expected_source_hash:'a'.repeat(32),p_bag_ids:['80000000-0000-4000-8000-000000000001']}};
const final=()=>parseFinalizationIntent({actorId:actor,eventId:event,args:{p_event_id:event,p_request_id:request,p_expected_rules_version:'a'.repeat(32),
 p_expected_funding_revision:'b'.repeat(32),p_expected_qualification_revision:'c'.repeat(32),p_expected_payout_input_hash:'d'.repeat(32)}},actor,event);
function storage(){const rows=new Map<string,string>();return {getItem:(key:string)=>rows.get(key)??null,setItem:(key:string,raw:string)=>{rows.set(key,raw);},removeItem:(key:string)=>{rows.delete(key);}};}
it('retains exact selected bags/source/request and refuses a different payload',()=>{
 const s=storage(),i=parseQualificationIntent(value,actor,event);persistQualificationIntent(s,i);
 expect(readQualificationIntent(s,actor,event)).toEqual(i);expect(readQualificationIntent(s,'other',event)).toBeNull();
 expect(()=>persistQualificationIntent(s,{...i,args:{...i.args,p_expected_source_hash:'e'.repeat(32)}})).toThrow('PENDING');
 clearQualificationIntent(s,i);expect(readQualificationIntent(s,actor,event)).toBeNull();
});
it('mutually excludes retained qualification and finalization before any request can be sent',()=>{
 const s=storage(),i=parseQualificationIntent(value,actor,event);persistQualificationIntent(s,i);
 expect(()=>persistFinalizationIntent(s,final())).toThrow('PENDING');clearQualificationIntent(s,i);
 persistFinalizationIntent(s,final());expect(()=>persistQualificationIntent(s,i)).toThrow('PENDING');
});
it('rejects empty/duplicate bag selections and actor/event/policy corruption',()=>{
 for(const bad of [{...value,actorId:'other'},{...value,eventId:'other'},{...value,policy:'invented'},
  {...value,args:{...value.args,p_bag_ids:[]}},{...value,args:{...value.args,p_bag_ids:[...value.args.p_bag_ids,...value.args.p_bag_ids]}}])
  expect(()=>parseQualificationIntent(bad,actor,event)).toThrow();
});
