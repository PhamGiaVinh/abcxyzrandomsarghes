import {beforeEach,expect,it,vi} from 'vitest';
import {chipSetupMetadataArgs,clearChipSetupMetadataIntent,parseChipSetupMetadataReceipt,persistChipSetupMetadataIntent,readChipSetupMetadataIntent,type ChipSetupMetadataPayload} from './chipSetupMetadataIntent';
const scope={actorId:'11111111-1111-4111-8111-111111111111',clubId:'22222222-2222-4222-8222-222222222222',tournamentId:'33333333-3333-4333-8333-333333333333'},set='44444444-4444-4444-8444-444444444444',denom='55555555-5555-4555-8555-555555555555';
const payloads:ChipSetupMetadataPayload[]=[{operation:'bind',chip_set_id:set,expected_chip_set_id:null},{operation:'add',chip_set_id:set,value:100,color:'red',label:null,display_order:0},{operation:'delete',chip_set_id:set,denomination_id:denom}];
const packet=(i:ReturnType<typeof persistChipSetupMetadataIntent>)=>({status:'ok',outcome:'applied',actor_id:i.actorId,club_id:i.clubId,tournament_id:i.tournamentId,request_id:i.requestId,payload:i.payload,error:null,result:i.payload.operation==='bind'?{status:'ok',action:'bound',chip_set_id:set}:{status:'ok',denomination_id:denom}});
beforeEach(()=>{vi.restoreAllMocks();sessionStorage.clear();});
it.each(payloads)('retains original $operation nonce and payload across reload and validates commit before clear',p=>{
 const i=persistChipSetupMetadataIntent(sessionStorage,scope,p);
 expect(persistChipSetupMetadataIntent(sessionStorage,scope,p)).toEqual(i);expect(readChipSetupMetadataIntent(sessionStorage,scope)).toEqual(i);
 expect(chipSetupMetadataArgs(i)).toEqual({p_tournament_id:scope.tournamentId,p_payload:p,p_request_id:i.requestId,p_expected_actor:scope.actorId});
 expect(()=>clearChipSetupMetadataIntent(sessionStorage,i,{...packet(i),request_id:denom})).toThrow();expect(readChipSetupMetadataIntent(sessionStorage,scope)).toEqual(i);
 clearChipSetupMetadataIntent(sessionStorage,i,packet(i));expect(readChipSetupMetadataIntent(sessionStorage,scope)).toBeNull();
});
it('cannot replace unknown operation or payload with a new request',()=>{
 const i=persistChipSetupMetadataIntent(sessionStorage,scope,payloads[0]);
 for(const p of [payloads[1],{...payloads[0],chip_set_id:denom}])expect(()=>persistChipSetupMetadataIntent(sessionStorage,scope,p)).toThrow('PENDING');
 expect(readChipSetupMetadataIntent(sessionStorage,scope)).toEqual(i);
});
it.each(payloads)('rejects unknown canonical $operation result and mismatched receipt payload',p=>{
 const i=persistChipSetupMetadataIntent(sessionStorage,scope,p),r=packet(i);
 for(const bad of [null,{},[],{...r,result:{}},{...r,actor_id:denom},{...r,club_id:denom},{...r,tournament_id:denom},{...r,payload:{...p,chip_set_id:denom}}])expect(()=>parseChipSetupMetadataReceipt(bad,i)).toThrow();
 expect(readChipSetupMetadataIntent(sessionStorage,{...scope,actorId:denom})).toBeNull();
});
it.each(['cancelled','rejected'])('requires a complete terminal %s before clearing',outcome=>{
 const i=persistChipSetupMetadataIntent(sessionStorage,scope,payloads[1]);
 clearChipSetupMetadataIntent(sessionStorage,i,{...packet(i),status:outcome==='rejected'?'rejected':'ok',outcome,result:null,error:outcome==='rejected'?'VALUE_EXISTS':null});
 expect(readChipSetupMetadataIntent(sessionStorage,scope)).toBeNull();
});
it('rejects invalid and extra payload fields before persistence',()=>{
 for(const p of [{...payloads[1],value:0.5},{...payloads[1],value:Number.MAX_SAFE_INTEGER+1},{...payloads[1],display_order:-1},{...payloads[0],unexpected:true}])expect(()=>persistChipSetupMetadataIntent(sessionStorage,scope,p as ChipSetupMetadataPayload)).toThrow();
 expect(readChipSetupMetadataIntent(sessionStorage,scope)).toBeNull();
});
it('fails closed on storage denial and corruption',()=>{
 expect(()=>persistChipSetupMetadataIntent({getItem:()=>null,setItem:()=>{}},scope,payloads[0])).toThrow('SAVE_FAILED');
 expect(()=>readChipSetupMetadataIntent({getItem:()=>'{broken'},scope)).toThrow();
});
