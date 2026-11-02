import {beforeEach,expect,it,vi} from 'vitest';
import {chipTemplateSaveArgs,clearChipTemplateSaveIntent,parseChipTemplateSaveReceipt,persistChipTemplateSaveIntent,readChipTemplateSaveIntent} from './chipTemplateSaveIntent';
const scope={actorId:'11111111-1111-4111-8111-111111111111',clubId:'22222222-2222-4222-8222-222222222222',tournamentId:'33333333-3333-4333-8333-333333333333'};
const set='44444444-4444-4444-8444-444444444444',denom='55555555-5555-4555-8555-555555555555',other='66666666-6666-4666-8666-666666666666';
const draft={chipSetId:set,name:' TEST ',stackValue:20000,lines:[{denomination_id:denom,count:200}]};
const packet=(i:ReturnType<typeof persistChipTemplateSaveIntent>)=>({actor_id:i.actorId,club_id:i.clubId,tournament_id:i.tournamentId,request_id:i.requestId,chip_set_id:i.chipSetId,status:'ok',outcome:'saved',error:null,result:{status:'ok',stack_template_id:other,stack_value:i.stackValue,sum:i.stackValue}});
beforeEach(()=>{sessionStorage.clear();vi.restoreAllMocks();});
it('retains one exact nonce/payload across reload and only clears with a matching receipt',()=>{
 const i=persistChipTemplateSaveIntent(sessionStorage,scope,draft);
 expect(readChipTemplateSaveIntent(sessionStorage,scope)).toEqual(i);expect(persistChipTemplateSaveIntent(sessionStorage,scope,draft)).toEqual(i);
 expect(chipTemplateSaveArgs(i)).toEqual({p_tournament_id:scope.tournamentId,p_chip_set_id:set,p_name:'TEST',p_stack_value:20000,p_lines:draft.lines,p_request_id:i.requestId,p_expected_actor:scope.actorId});
 expect(()=>clearChipTemplateSaveIntent(sessionStorage,i,{...packet(i),request_id:other})).toThrow();
 expect(readChipTemplateSaveIntent(sessionStorage,scope)).toEqual(i);
 clearChipTemplateSaveIntent(sessionStorage,i,packet(i));expect(readChipTemplateSaveIntent(sessionStorage,scope)).toBeNull();
});
it.each([{name:'OTHER'},{chipSetId:other},{stackValue:30000},{lines:[{denomination_id:denom,count:300}]}])('does not replace an unresolved payload (%j)',change=>{
 const i=persistChipTemplateSaveIntent(sessionStorage,scope,draft);
 expect(()=>persistChipTemplateSaveIntent(sessionStorage,scope,{...draft,...change})).toThrow('PENDING');expect(readChipTemplateSaveIntent(sessionStorage,scope)).toEqual(i);
});
it('canonicalizes line order without treating a retry as a different intent',()=>{
 const first=persistChipTemplateSaveIntent(sessionStorage,scope,{...draft,lines:[{denomination_id:other,count:1},...draft.lines]});
 expect(persistChipTemplateSaveIntent(sessionStorage,scope,{...draft,lines:[...draft.lines,{denomination_id:other,count:1}]})).toEqual(first);
});
it.each([null,{},[],{status:'ok'},{status:'ok',outcome:'saved',result:{}}])('never clears from an incomplete result (%j)',value=>{
 const i=persistChipTemplateSaveIntent(sessionStorage,scope,draft);expect(()=>clearChipTemplateSaveIntent(sessionStorage,i,value)).toThrow();expect(readChipTemplateSaveIntent(sessionStorage,scope)).toEqual(i);
});
it('rejects wrong recipient scope and contradictory saved totals',()=>{
 const i=persistChipTemplateSaveIntent(sessionStorage,scope,draft),r=packet(i);
 for(const bad of [{...r,actor_id:other},{...r,club_id:other},{...r,tournament_id:other},{...r,chip_set_id:other},{...r,result:{...r.result,sum:0}}])expect(()=>parseChipTemplateSaveReceipt(bad,i)).toThrow();
 expect(readChipTemplateSaveIntent(sessionStorage,{...scope,actorId:other})).toBeNull();
});
it.each(['cancelled','rejected'])('accepts a complete terminal %s receipt',outcome=>{
 const i=persistChipTemplateSaveIntent(sessionStorage,scope,draft),r={...packet(i),status:outcome==='rejected'?'rejected':'ok',outcome,error:outcome==='rejected'?'NAME_EXISTS':null,result:null};
 clearChipTemplateSaveIntent(sessionStorage,i,r);expect(readChipTemplateSaveIntent(sessionStorage,scope)).toBeNull();
});
it('does not dispatch a new intent when persistence is unavailable or corrupt',()=>{
 expect(()=>persistChipTemplateSaveIntent({getItem:()=>null,setItem:()=>{}},scope,draft)).toThrow('SAVE_FAILED');
 expect(()=>readChipTemplateSaveIntent({getItem:()=>'{broken'},scope)).toThrow();
});
it.each([0,-1,1.5,Number.MAX_SAFE_INTEGER+1])('rejects invalid stack %s before journaling',stackValue=>{
 expect(()=>persistChipTemplateSaveIntent(sessionStorage,scope,{...draft,stackValue})).toThrow();
 expect(readChipTemplateSaveIntent(sessionStorage,scope)).toBeNull();
});
it('rejects duplicate and fractional denomination counts',()=>{
 for(const lines of [[...draft.lines,...draft.lines],[{denomination_id:denom,count:0.5}]])expect(()=>persistChipTemplateSaveIntent(sessionStorage,scope,{...draft,lines})).toThrow();
});
