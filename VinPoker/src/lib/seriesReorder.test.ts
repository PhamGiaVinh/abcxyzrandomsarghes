import {describe,expect,it,vi} from 'vitest';
import {readSeriesReorderJournal,recoverSeriesReorder,SeriesReorderError,submitSeriesReorder,type SeriesReorderRequest} from './seriesReorder';
const actor='ee920000-0000-4000-8000-000000000001';
const request:SeriesReorderRequest={p_expected_actor_id:actor,p_club_id:'ee920000-0000-4000-8000-000000000002',p_request_id:'ee920000-0000-4000-8000-000000000010',p_order:['ee920000-0000-4000-8000-000000000003'],p_expected:[{id:'ee920000-0000-4000-8000-000000000003',position:0}]};
const success={ok:true,actor_id:actor,club_id:request.p_club_id,request_id:request.p_request_id,order:request.p_order};
describe('series reorder durable boundary',()=>{
 it('reads only a structurally valid request for the exact actor',()=>{
  expect(readSeriesReorderJournal(JSON.stringify(request),actor)).toEqual(request);
  for(const delta of [{p_expected_actor_id:'other'},{p_club_id:'bad'},{p_request_id:null},{p_order:[]},{p_expected:[{id:request.p_order[0],position:'0'}]}])expect(()=>readSeriesReorderJournal(JSON.stringify({...request,...delta}),actor)).toThrow();
 });
 it('known database rejection is not retried or replaced by a new key',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:null,error:{code:'42501'}});
  await expect(submitSeriesReorder(rpc,request,actor)).rejects.toMatchObject({unknownOutcome:false});
  expect(rpc).toHaveBeenCalledTimes(1);
 });
 it('lost response reads the exact receipt once, without replay',async()=>{
  const rpc=vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce({data:success,error:null});
  await submitSeriesReorder(rpc,request,actor);
  expect(rpc.mock.calls.map(x=>x[0])).toEqual(['reorder_club_series_images_v1','get_club_series_reorder_receipt_v1']);
  expect(rpc.mock.calls[0][1]).toEqual(rpc.mock.calls[1][1]);
 });
 it('unavailable receipt is unknown, not rollback proof',async()=>{
  const rpc=vi.fn().mockRejectedValue(new TypeError('network'));
  await expect(submitSeriesReorder(rpc,request,actor)).rejects.toMatchObject({unknownOutcome:true});
  expect(rpc).toHaveBeenCalledTimes(2);
 });
 it('missing receipt remains unknown and recovery never calls writer',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:{ok:false,error:'receipt_not_found'},error:null});
  await expect(recoverSeriesReorder(rpc,request,actor)).rejects.toMatchObject({unknownOutcome:true});
  expect(rpc).toHaveBeenCalledExactlyOnceWith('get_club_series_reorder_receipt_v1',request);
 });
 it('rejects success for another actor, club, key or order',async()=>{
  for(const delta of [{actor_id:'other'},{club_id:'other'},{request_id:'other'},{order:[]}]){
   const rpc=vi.fn().mockResolvedValue({data:{...success,...delta},error:null});
   await expect(submitSeriesReorder(rpc,request,actor)).rejects.toBeInstanceOf(SeriesReorderError);
   expect(rpc).toHaveBeenCalledTimes(1);
  }
 });
});
