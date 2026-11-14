import {it,expect,vi} from 'vitest';
import {instrumentSpectatorWorker,parseSpectatorTrace,summarizeSpectatorTrace} from './scale.spectator-trace.mjs';
const event={batch:'12345678-1234-1234-1234-123456789abc',rpc:'publish_public_spectator_projection_v2',component:'tables',startedAt:10,endedAt:20,outcome:'published'};
it('forwards explicit source mode through short-run instrumentation',async()=>{
 const source='export async function processPublicSpectatorJobs(client,deadline,sourceMode="single"){await client.rpc("get_public_spectator_projection_sources_v2",{});return {sourceMode};}';
 const worker=await import(/* @vite-ignore */ 'data:text/javascript,'+encodeURIComponent(instrumentSpectatorWorker(source)));
 const log=vi.spyOn(console,'log').mockImplementation(()=>{});
 try{
  const result=await worker.processPublicSpectatorJobs({rpc:vi.fn().mockResolvedValue({data:[],error:null})},Date.now()+5000,'batch');
  expect(result.sourceMode).toBe('batch');
  expect(parseSpectatorTrace(log.mock.calls.map(([line])=>line).join('\n')).map(row=>row.rpc)).toEqual(['get_public_spectator_projection_sources_v2']);
 }finally{log.mockRestore();}
});
it('keeps only allowlisted fields and drops malformed or unrelated log records',()=>{
 const log=['secret outside trace','VINPOKER_SPECTATOR_RPC_TRACE '+JSON.stringify({...event,authorization:'never export'}),'VINPOKER_SPECTATOR_RPC_TRACE invalid','VINPOKER_SPECTATOR_RPC_TRACE '+JSON.stringify({...event,rpc:'unknown'})].join('\n');
 expect(parseSpectatorTrace(log)).toEqual([event]);
});
it('rejects reversed timing and invalid components',()=>{
 expect(parseSpectatorTrace('VINPOKER_SPECTATOR_RPC_TRACE '+JSON.stringify({...event,endedAt:1}))).toEqual([]);
 expect(parseSpectatorTrace('VINPOKER_SPECTATOR_RPC_TRACE '+JSON.stringify({...event,component:'private'}))).toEqual([]);
});
it('retains only bounded fixture scope and numeric generation correlation',()=>{
 const parse=(extra:Record<string,unknown>)=>parseSpectatorTrace('VINPOKER_SPECTATOR_RPC_TRACE '+JSON.stringify({...event,...extra}));
 expect(parse({scopeIndex:20,generation:'123',tournament_id:'private'})).toEqual([{...event,scopeIndex:20,generation:'123'}]);
 for(const scopeIndex of [0,21,1.5,'1',null])expect(parse({scopeIndex,generation:'123'})).toEqual([event]);
 for(const generation of ['private','-1','1.2','1'.repeat(21),123])expect(parse({scopeIndex:1,generation})).toEqual([{...event,scopeIndex:1}]);
});
it('correlates only the fixed synthetic tournament namespace without exporting identifiers',async()=>{
 const source='export async function processPublicSpectatorJobs(client,deadline){return client.rpc("publish_public_spectator_projection_v2",deadline);}';
 const worker=await import(/* @vite-ignore */ 'data:text/javascript,'+encodeURIComponent(instrumentSpectatorWorker(source)));
 const log=vi.spyOn(console,'log').mockImplementation(()=>{});
 try{
  const rpc=vi.fn().mockResolvedValue({data:true,error:null});
  const args={p_tournament_id:'10000000-0000-4000-8000-000000000014',p_component:'tables',p_source_vector:{generation:'456',secret:'never export'},p_fencing_token:'never export'};
  await worker.processPublicSpectatorJobs({rpc},args);
  expect(rpc).toHaveBeenLastCalledWith('publish_public_spectator_projection_v2',args);
  expect(parseSpectatorTrace(log.mock.calls.flat().join('\n'))[0]).toMatchObject({scopeIndex:20,generation:'456'});
  expect(log.mock.calls.flat().join('')).not.toContain('never export');
  expect(log.mock.calls.flat().join('')).not.toContain(args.p_tournament_id);
  log.mockClear();
  await worker.processPublicSpectatorJobs({rpc},{...args,p_tournament_id:'private'});
  const parsed=parseSpectatorTrace(log.mock.calls.flat().join('\n'))[0];
  expect(parsed).not.toHaveProperty('scopeIndex');expect(parsed).not.toHaveProperty('generation');
 }finally{log.mockRestore();}
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
it('measures observed overlap and claim queue without borrowing another batch claim',()=>{
 const claim={...event,rpc:'claim_public_spectator_projection_v2',component:null,outcome:'ok',startedAt:0,endedAt:10};
 const source={...event,rpc:'get_public_spectator_projection_source_v2',outcome:'ok',startedAt:15,endedAt:30};
 const second='87654321-1234-1234-1234-123456789abc';
 const value=summarizeSpectatorTrace([claim,source,{...source,batch:second,startedAt:25,endedAt:40}]).workerBatches;
 expect(value.observed).toBe(2);expect(value.maxObservedOverlappingBatches).toBe(2);
 expect(value.claimAckToSourceStart).toEqual({samples:1,p95Ms:5,maxMs:5});expect(value.unpairedSources).toBe(1);
 expect(summarizeSpectatorTrace([claim,source,{...source,batch:second,startedAt:30,endedAt:40}]).workerBatches.maxObservedOverlappingBatches).toBe(1);
 expect(summarizeSpectatorTrace([]).workerBatches.maxObservedOverlappingBatches).toBeNull();
});
