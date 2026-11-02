import {beforeEach,expect,it,vi} from 'vitest';
import {clearChipSetCreationIntent,parseChipSetCreationReceipt,persistChipSetCreationIntent,readChipSetCreationIntent} from './chipSetCreationIntent';
const scope={actorId:'11111111-1111-4111-8111-111111111111',clubId:'22222222-2222-4222-8222-222222222222',tournamentId:'33333333-3333-4333-8333-333333333333'};
beforeEach(()=>{sessionStorage.clear();vi.restoreAllMocks();});
it('preserves scope/name/nonce and rejects a changed payload',()=>{
 const i=persistChipSetCreationIntent(sessionStorage,scope,' TEST ');
 expect(readChipSetCreationIntent(sessionStorage,scope)).toEqual(i);
 expect(persistChipSetCreationIntent(sessionStorage,scope,'TEST')).toEqual(i);
 expect(()=>persistChipSetCreationIntent(sessionStorage,scope,'OTHER')).toThrow('PENDING');
 expect(readChipSetCreationIntent(sessionStorage,{...scope,actorId:'44444444-4444-4444-8444-444444444444'})).toBeNull();
});
it.each(['created_bound','cancelled','rejected'])('requires a complete %s receipt before clearing',outcome=>{
 const i=persistChipSetCreationIntent(sessionStorage,scope,'TEST');
 const r={actor_id:i.actorId,club_id:i.clubId,tournament_id:i.tournamentId,request_id:i.requestId,set_name:i.name,
  status:outcome==='rejected'?'rejected':'ok',outcome,chip_set_id:outcome==='created_bound'?'44444444-4444-4444-8444-444444444444':null,error:outcome==='rejected'?'NAME_EXISTS':null};
 expect(parseChipSetCreationReceipt(r,i)).toEqual(r);
 expect(()=>clearChipSetCreationIntent(sessionStorage,i,{...r,request_id:'55555555-5555-4555-8555-555555555555'})).toThrow();
 expect(readChipSetCreationIntent(sessionStorage,scope)).toEqual(i);
 clearChipSetCreationIntent(sessionStorage,i,r);expect(readChipSetCreationIntent(sessionStorage,scope)).toBeNull();
});
it('does not accept null, incomplete or contradictory packets',()=>{
 const i=persistChipSetCreationIntent(sessionStorage,scope,'TEST');
 for(const v of [null,{},[],{status:'ok'},{outcome:'cancelled',chip_set_id:'44444444-4444-4444-8444-444444444444'}])expect(()=>parseChipSetCreationReceipt(v,i)).toThrow();
});
it('fails closed when storage does not retain the exact serialized intent',()=>{
 const fake={getItem:vi.fn().mockReturnValueOnce(null).mockReturnValueOnce('{}'),setItem:vi.fn()};
 expect(()=>persistChipSetCreationIntent(fake,scope,'TEST')).toThrow('SAVE_FAILED');
});
