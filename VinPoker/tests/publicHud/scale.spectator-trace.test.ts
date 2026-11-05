import {it,expect,vi} from 'vitest';
import {instrumentSpectatorWorker,parseSpectatorTrace,summarizeSpectatorTrace} from './scale.spectator-trace.mjs';
const event={batch:'12345678-1234-1234-1234-123456789abc',rpc:'publish_public_spectator_projection_v2',component:'tables',startedAt:10,endedAt:20,outcome:'published'};
it('keeps only allowlisted fields and drops malformed or unrelated log records',()=>{
 const log=['secret outside trace','VINPOKER_SPECTATOR_RPC_TRACE '+JSON.stringify({...event,authorization:'never export'}),'VINPOKER_SPECTATOR_RPC_TRACE invalid','VINPOKER_SPECTATOR_RPC_TRACE '+JSON.stringify({...event,rpc:'unknown'})].join('\n');
 expect(parseSpectatorTrace(log)).toEqual([event]);
});
it('rejects reversed timing and invalid components',()=>{
 expect(parseSpectatorTrace('VINPOKER_SPECTATOR_RPC_TRACE '+JSON.stringify({...event,endedAt:1}))).toEqual([]);
 expect(parseSpectatorTrace('VINPOKER_SPECTATOR_RPC_TRACE '+JSON.stringify({...event,component:'private'}))).toEqual([]);
});
it('preserves RPC arguments, return identity and thrown errors',async()=>{
 const source='export async function processPublicSpectatorJobs(client,deadline){return client.rpc("publish_public_spectator_projection_v2",{p_component:"tables",deadline});}';
 const worker=await import(/* @vite-ignore */ 'data:text/javascript,'+encodeURIComponent(instrumentSpectatorWorker(source)));
 const log=vi.spyOn(console,'log').mockImplementation(()=>{});
 try{
  const reply={data:true,error:null},rpc=vi.fn().mockResolvedValue(reply);
  expect(await worker.processPublicSpectatorJobs({rpc},123)).toBe(reply);
  expect(rpc).toHaveBeenCalledWith('publish_public_spectator_projection_v2',{p_component:'tables',deadline:123});
  const failure=new Error('private failure');rpc.mockRejectedValueOnce(failure);
  await expect(worker.processPublicSpectatorJobs({rpc},123)).rejects.toBe(failure);
  expect(log.mock.calls.flat().join('')).not.toContain('private failure');
  log.mockImplementation(()=>{throw Error('telemetry unavailable');});
  expect(await worker.processPublicSpectatorJobs({rpc},123)).toBe(reply);
 }finally{log.mockRestore();}
});
it('refuses to instrument a changed worker boundary',()=>{expect(()=>instrumentSpectatorWorker('export const changed=true;')).toThrow();});
it('pairs publications only with later successful flushes in the same batch',()=>{
 const flush={...event,rpc:'flush_public_spectator_broadcast_v2',component:null,outcome:'ok'};
 const result=summarizeSpectatorTrace([{...flush,startedAt:0,endedAt:15},event,{...flush,startedAt:40,endedAt:50},
  {...event,batch:'87654321-1234-1234-1234-123456789abc'},
  {...event,outcome:'fenced'}, {...event,startedAt:60,endedAt:70}]);
 expect(result.published).toBe(3);expect(result.withoutFollowingFlush).toBe(2);
 expect(result.publishAckToNextSuccessfulFlushStart).toEqual({samples:1,p95Ms:20,maxMs:20});
 expect(result.publishAckToNextSuccessfulFlushEnd).toEqual({samples:1,p95Ms:30,maxMs:30});
});
it('keeps empty trace unavailable rather than reporting zero latency',()=>{
 expect(summarizeSpectatorTrace([]).publishAckToNextSuccessfulFlushStart).toEqual({samples:0,p95Ms:null,maxMs:null});
});
