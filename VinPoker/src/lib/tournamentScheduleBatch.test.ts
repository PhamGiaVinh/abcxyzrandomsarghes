import {beforeEach,expect,it,vi} from 'vitest';
import {createScheduleBatch,cancelScheduleBatch,isScheduleBatchCancelled,persistScheduleBatchJournal,readScheduleBatchJournal,recoverScheduleBatch,
 resolveScheduleBatchResult,scheduleBatchJournalKey,settleScheduleBatchJournal,type ScheduleBatchRequest} from './tournamentScheduleBatch';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const request:ScheduleBatchRequest={p_expected_actor_id:id(1),p_request_id:id(2),p_rows:[{club_id:id(3),name:'TEST',start_time:'2026-10-18T10:00:00+07:00',buy_in:100000,starting_stack:20000,game_type:'nlh',location:null}]};
const receipt={ok:true,actor_id:id(1),request_id:id(2),count:1,tournaments:[{ok:true,actor_id:id(1),request_id:id(4),club_id:id(3),tournament_id:id(5),level_count:0}]};
beforeEach(()=>sessionStorage.clear());
it('persists exact intent and rejects another actor or changed payload',()=>{
 persistScheduleBatchJournal(sessionStorage,request);expect(readScheduleBatchJournal(sessionStorage.getItem(scheduleBatchJournalKey(id(1)))!,id(1))).toEqual(request);
 expect(()=>readScheduleBatchJournal(JSON.stringify(request),id(9))).toThrow();
 expect(()=>persistScheduleBatchJournal(sessionStorage,{...request,p_rows:[{...request.p_rows[0],buy_in:0}]})).toThrow();
 settleScheduleBatchJournal(sessionStorage,request);expect(sessionStorage.length).toBe(0);
});
it('does one writer then receipt READ on response loss, never a new mutation',async()=>{
 const rpc=vi.fn().mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce({data:receipt,error:null});
 await expect(createScheduleBatch(rpc,request)).resolves.toEqual([id(5)]);
 expect(rpc.mock.calls.map(c=>c[0])).toEqual(['create_tournament_schedule_batch_v1','get_tournament_schedule_batch_receipt_v1']);
 expect(rpc.mock.calls[0][1]).toEqual(rpc.mock.calls[1][1]);
});
it.each([null,{ok:true},{...receipt,actor_id:id(9)},{...receipt,count:2},{...receipt,tournaments:[{...receipt.tournaments[0],club_id:id(9)}]}])('rejects unconfirmed receipt: %j',data=>{
 expect(()=>resolveScheduleBatchResult(data,request)).toThrow();
});
it('keeps a missing receipt unknown rather than proof of rollback',async()=>{
 const rpc=vi.fn().mockResolvedValue({data:{ok:false,error:'receipt_not_found'},error:null});
 await expect(recoverScheduleBatch(rpc,request)).rejects.toMatchObject({unknownOutcome:true});expect(rpc).toHaveBeenCalledTimes(1);
});
it('accepts only an exact cancellation tombstone and never treats it as created tours',async()=>{
 const cancelled={ok:true,outcome:'cancelled',actor_id:id(1),request_id:id(2),count:1};
 expect(isScheduleBatchCancelled({...cancelled,actor_id:id(9)},request)).toBe(false);
 expect(isScheduleBatchCancelled({...cancelled,count:0},request)).toBe(false);
 const rpc=vi.fn().mockResolvedValue({data:cancelled,error:null});
 await expect(cancelScheduleBatch(rpc,request)).resolves.toEqual([]);
 await expect(recoverScheduleBatch(rpc,request)).resolves.toEqual([]);
});
it('returns the original created IDs when cancellation loses to commit',async()=>{
 const rpc=vi.fn().mockResolvedValue({data:receipt,error:null});await expect(cancelScheduleBatch(rpc,request)).resolves.toEqual([id(5)]);
 expect(rpc).toHaveBeenCalledExactlyOnceWith('cancel_tournament_schedule_batch_v1',request);
});
