import {describe, expect, it, vi} from 'vitest';
import {saveTournamentConfig, recoverTournamentConfigSave, readTournamentConfigJournal, tournamentConfigJournalKey,
 persistTournamentConfigJournal,clearTournamentConfigJournal,type TournamentConfigSaveRequest} from './tournamentConfigSave';

const request: TournamentConfigSaveRequest = {
 p_expected_actor_id:'actor',
 p_tournament_id:null,p_club_id:'club',p_config:{name:'TEST',description:null,swing_duration_minutes:45,warn_at_minutes:5,crit_at_minutes:2},
 p_table_ids:[],p_expected_updated_at:null,p_expected_active_table_ids:[],p_request_id:'stable-key',
};
const success={ok:true,tournament:{id:'tour',club_id:'club',updated_at:'2026-10-15T00:00:00Z'}};
describe('atomic config client contract',()=>{
 it('preserves a changed request and requires durable readback before dispatch',()=>{
  sessionStorage.clear();const intent={...request,p_request_id:'ee800000-0000-4000-8000-000000000081'};
  const key=tournamentConfigJournalKey(intent.p_expected_actor_id,intent.p_club_id,null);
  persistTournamentConfigJournal(sessionStorage,intent);
  const changed={...intent,p_config:{...intent.p_config,name:'Changed TEST'}};
  expect(()=>persistTournamentConfigJournal(sessionStorage,changed)).toThrow(/CHANGED/);
  expect(()=>clearTournamentConfigJournal(sessionStorage,changed)).toThrow(/CHANGED/);
  expect(readTournamentConfigJournal(sessionStorage.getItem(key)!,intent.p_club_id,null,intent.p_expected_actor_id)).toEqual(intent);
  clearTournamentConfigJournal(sessionStorage,intent);expect(sessionStorage.getItem(key)).toBeNull();
 });
 it('preserves unknown commit identity when receipt permission is temporarily revoked',async()=>{
  const rpc=vi.fn().mockResolvedValueOnce({error:{message:'lost'},data:null})
   .mockResolvedValueOnce({error:null,data:{ok:false,error:'actor_not_allowed'}})
   .mockResolvedValueOnce({error:null,data:success});
  await expect(saveTournamentConfig(rpc,request)).rejects.toMatchObject({outcomeUnknown:true});
  expect((await recoverTournamentConfigSave(rpc,request)).id).toBe('tour');
  expect(rpc.mock.calls.filter(c=>c[0]==='save_tournament_config_v1')).toHaveLength(1);
 });
 it('does not trap a definitively rolled-back business rejection in receipt recovery',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:null,error:{code:'P0001',message:'configuration_table_close_rejected'}});
  await expect(saveTournamentConfig(rpc,request)).rejects.toMatchObject({code:'configuration_table_close_rejected',outcomeUnknown:false});
  expect(rpc).toHaveBeenCalledTimes(1);
 });
 it('bounds hung mutation and receipt reads without retrying mutation',async()=>{
  vi.useFakeTimers();
  try {
   const rpc=vi.fn().mockImplementation(()=>new Promise(()=>{}));
   const pending=saveTournamentConfig(rpc,request);
   const assertion=expect(pending).rejects.toMatchObject({outcomeUnknown:true});
   await vi.advanceTimersByTimeAsync(40001);
   await assertion;
   expect(rpc.mock.calls.map(c=>c[0])).toEqual(['save_tournament_config_v1','get_tournament_config_save_receipt_v1']);
  } finally {vi.useRealTimers();}
 });
 it('scopes durable pending intent by actor, club and tournament',()=>{
  const durable={...request,p_request_id:'ee800000-0000-4000-8000-000000000081'};
  expect(readTournamentConfigJournal(JSON.stringify(durable),'club',null,'actor')).toEqual(durable);
  expect(()=>readTournamentConfigJournal(JSON.stringify(durable),'other',null,'actor')).toThrow();
  expect(()=>readTournamentConfigJournal(JSON.stringify(durable),'club','tour','actor')).toThrow();
  expect(()=>readTournamentConfigJournal(JSON.stringify(durable),'club',null,'other-actor')).toThrow();
  expect(tournamentConfigJournalKey('actor-a','club',null)).not.toBe(tournamentConfigJournalKey('actor-b','club',null));
  expect(tournamentConfigJournalKey('actor-a','club',null)).not.toBe(tournamentConfigJournalKey('actor-a','club','tour'));
 });
 it('blocks corrupt pending intent instead of creating a replacement',()=>{
  for(const raw of ['{', 'null', JSON.stringify({...request,p_request_id:'not-uuid'})]) {
   expect(()=>readTournamentConfigJournal(raw,'club',null,'actor')).toThrow();
  }
 });
 it('calls only the atomic mutation on success',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:success,error:null});
  expect((await saveTournamentConfig(rpc,request)).id).toBe('tour');
  expect(rpc.mock.calls).toEqual([['save_tournament_config_v1',request]]);
 });
 it('recovers lost response without issuing another mutation or key',async()=>{
  const rpc=vi.fn().mockRejectedValueOnce(new TypeError('fetch')).mockResolvedValueOnce({data:success,error:null});
  expect((await saveTournamentConfig(rpc,request)).id).toBe('tour');
  expect(rpc.mock.calls[1]).toEqual(['get_tournament_config_save_receipt_v1',{p_request_id:'stable-key',p_expected_actor_id:'actor'}]);
  expect(rpc).toHaveBeenCalledTimes(2);
 });
 it('does not mistake missing receipt for proven rollback',async()=>{
  const rpc=vi.fn().mockResolvedValueOnce({error:{message:'network'},data:null})
   .mockResolvedValueOnce({error:null,data:{ok:false,error:'receipt_not_found'}});
  await expect(saveTournamentConfig(rpc,request)).rejects.toMatchObject({outcomeUnknown:true});
  expect(rpc).toHaveBeenCalledTimes(2);
 });
 it('preserves explicit CAS conflict, without retry',async()=>{
  const rpc=vi.fn().mockResolvedValue({error:null,data:{ok:false,error:'STALE_CONFIG'}});
  await expect(saveTournamentConfig(rpc,request)).rejects.toMatchObject({code:'STALE_CONFIG',outcomeUnknown:false});
  expect(rpc).toHaveBeenCalledTimes(1);
 });
 it('rejects mismatched receipt scope and malformed success',async()=>{
  for(const data of [{ok:true}, {...success,tournament:{...success.tournament,club_id:'other'}}]){
   const rpc=vi.fn().mockResolvedValue({error:null,data});
   await expect(saveTournamentConfig(rpc,request)).rejects.toMatchObject({outcomeUnknown:true});
  }
 });
});
