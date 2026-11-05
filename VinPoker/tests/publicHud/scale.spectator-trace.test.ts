import {it,expect,vi} from 'vitest';
import {instrumentSpectatorWorker,parseSpectatorTrace} from './scale.spectator-trace.mjs';
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
