import {afterEach,expect,it,vi} from 'vitest';
import {createTournament,recoverTournamentCreate,readTournamentCreateJournal,type TournamentCreateRequest} from './tournamentCreate';
const request:TournamentCreateRequest={p_club_id:'e9100000-0000-4000-8000-000000000011',p_expected_actor_id:'e9100000-0000-4000-8000-000000000001',p_request_id:'e9100000-0000-4000-8000-000000000021',p_config:{name:'TEST'},p_levels:[]};
const committed={ok:true,tournament_id:'e9100000-0000-4000-8000-000000000031',actor_id:request.p_expected_actor_id,club_id:request.p_club_id,request_id:request.p_request_id,level_count:0};
afterEach(()=>{vi.useRealTimers();});
it('sends one canonical writer and accepts its exact receipt',async()=>{
 const rpc=vi.fn().mockResolvedValue({data:committed,error:null});
 expect(await createTournament(rpc,request)).toBe(committed.tournament_id);
 expect(rpc).toHaveBeenCalledExactlyOnceWith('create_tournament_with_levels_v1',request);
});
it('recovers a lost response without retrying the writer or minting a key',async()=>{
 const rpc=vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce({data:committed,error:null});
 expect(await createTournament(rpc,request)).toBe(committed.tournament_id);
 expect(rpc.mock.calls.map(c=>c[0])).toEqual(['create_tournament_with_levels_v1','get_tournament_create_receipt_v1']);
 expect(rpc.mock.calls[1][1]).toEqual(request);
});
it('treats missing or denied recovery as unknown, not permission for a fresh create',async()=>{
 const rpc=vi.fn().mockResolvedValue({data:{ok:false,error:'receipt_not_found'},error:null});
 await expect(recoverTournamentCreate(rpc,request)).rejects.toMatchObject({unknownOutcome:true});
 expect(rpc).toHaveBeenCalledTimes(1);
});
it.each(['actor_id','club_id','request_id','level_count'])('does not accept a mismatched %s receipt',async(field)=>{
 const rpc=vi.fn().mockResolvedValue({data:{...committed,[field]:'wrong'},error:null});
 await expect(createTournament(rpc,request)).rejects.toMatchObject({unknownOutcome:true});
});
it('keeps business conflict distinct from a transport outcome',async()=>{
 const rpc=vi.fn().mockResolvedValue({data:{ok:false,error:'IDEMPOTENCY_CONFLICT'},error:null});
 await expect(createTournament(rpc,request)).rejects.toMatchObject({unknownOutcome:false,message:'IDEMPOTENCY_CONFLICT'});
});
it('rejects a journal from another actor or club',()=>{
 expect(()=>readTournamentCreateJournal(JSON.stringify(request),'other',request.p_club_id)).toThrow();
 expect(()=>readTournamentCreateJournal(JSON.stringify(request),request.p_expected_actor_id,'other')).toThrow();
 expect(readTournamentCreateJournal(JSON.stringify(request),request.p_expected_actor_id,request.p_club_id)).toEqual(request);
});
it('bounds a hung writer, reads the same receipt, and ignores the late writer response',async()=>{
 vi.useFakeTimers();let respond!:(value:unknown)=>void;
 const rpc=vi.fn().mockReturnValueOnce(new Promise(resolve=>{respond=resolve;})).mockResolvedValueOnce({data:committed,error:null});
 const pending=createTournament(rpc,request);
 await vi.advanceTimersByTimeAsync(20_001);
 expect(await pending).toBe(committed.tournament_id);expect(rpc).toHaveBeenCalledTimes(2);
 respond({data:committed,error:null});await vi.advanceTimersByTimeAsync(20_000);
 expect(rpc).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
});
