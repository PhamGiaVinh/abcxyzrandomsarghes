import {afterEach,expect,it,vi} from 'vitest';
import {processPublicSpectatorJobs} from '../../supabase/functions/public-spectator-projector-v2/worker';
import {decodeSourceBatch} from '../../supabase/functions/public-spectator-projector-v2/sourceBatch';

const batchJobs=[1,2].map(i=>({tournament_id:`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`,component:'tables',fencing_token:`20000000-0000-4000-8000-${String(i).padStart(12,'0')}`}));
const batchSource=()=>({sourceVector:{generation:'1'},payload:{items:[]}});
it('matches reordered complete source receipts to the original job order',()=>{
 const raw=[{...batchJobs[1],requiresIndividual:true},{...batchJobs[0],source:batchSource()}];
 expect(decodeSourceBatch(batchJobs,raw)).toEqual([{source:batchSource()},{requiresIndividual:true}]);
});
it('keeps exact fencing and source errors distinct from individual-read requests',()=>{
 expect(decodeSourceBatch(batchJobs,[{...batchJobs[0],source:{fenced:true}},{...batchJobs[1],error:'source_failed',sqlstate:'42501'}]))
  .toEqual([{source:{fenced:true}},{error:'source_failed',sqlstate:'42501'}]);
});
it.each([
 [],[{...batchJobs[0],source:batchSource()}],
 [{...batchJobs[0],source:batchSource()},{...batchJobs[0],source:batchSource()}],
 [{...batchJobs[0],source:batchSource()},{...batchJobs[1],fencing_token:batchJobs[0].fencing_token,source:batchSource()}],
 [{...batchJobs[0],source:batchSource()},{...batchJobs[1],tournament_id:'10000000-0000-4000-8000-000000000099',source:batchSource()}],
 ...[{fenced:true,extra:true},{fenced:false},{sourceVector:{generation:'-1'},payload:{}},{sourceVector:{generation:'9223372036854775808'},payload:{}},{sourceVector:{generation:'1'},payload:null}]
  .map(source=>[{...batchJobs[0],source},{...batchJobs[1],source:batchSource()}]),
 [{...batchJobs[0],requiresIndividual:true,source:batchSource()},{...batchJobs[1],source:batchSource()}],
 [{...batchJobs[0],error:'other',sqlstate:'42501'},{...batchJobs[1],source:batchSource()}],
].map(raw=>({raw})))('rejects the entire malformed receipt envelope before any payload use: %#',({raw})=>{
 expect(()=>decodeSourceBatch(batchJobs,raw)).toThrow('invalid_source_batch_receipt');
});
it('counts UTF8 bytes and rejects oversized batch responses',()=>{
 const raw=[{...batchJobs[0],source:{sourceVector:{generation:'1'},payload:{name:'é'.repeat(530000)}}},{...batchJobs[1],source:batchSource()}];
 expect(()=>decodeSourceBatch(batchJobs,raw)).toThrow('invalid_source_batch_receipt');
});

function batchWorkerFixture(count=2){
 const jobs=Array.from({length:count},(_,i)=>({...batchJobs[0],tournament_id:`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,fencing_token:`20000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,group_key:'component'}));
 let response:(jobs:typeof batchJobs)=>unknown=items=>items.map(job=>({...job,source:batchSource()}));
 let batchError:unknown=null;
 const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>{
  if(name==='claim_public_spectator_projection_v2')return {data:jobs,error:null};
  if(name==='get_public_spectator_projection_sources_v2')return {data:response(args.p_jobs as typeof batchJobs),error:batchError};
  if(name==='get_public_spectator_projection_source_v2')return {data:batchSource(),error:null};
  if(name==='publish_public_spectator_projection_v2')return {data:true,error:null};
  return {data:0,error:null};
 });
 return {jobs,rpc,setResponse:(value:typeof response)=>{response=value;},setError:(value:unknown)=>{batchError=value;}};
}
it('uses bounded source waves and preserves exact publish identities',async()=>{
 const f=batchWorkerFixture(8);f.setResponse(items=>items.toReversed().map(job=>({...job,source:batchSource()})));
 const result=await processPublicSpectatorJobs(f,Date.now()+5000,'batch');
 expect(result.processed).toBe(8);expect(result.results.every(row=>row.published)).toBe(true);
 const sources=f.rpc.mock.calls.filter(([name])=>name==='get_public_spectator_projection_sources_v2');
 expect(sources.map(([,args])=>(args.p_jobs as unknown[]).length)).toEqual([6,2]);
 expect(f.rpc.mock.calls.filter(([name])=>name==='get_public_spectator_projection_source_v2')).toHaveLength(0);
 for(const job of f.jobs)expect(f.rpc).toHaveBeenCalledWith('publish_public_spectator_projection_v2',expect.objectContaining({p_tournament_id:job.tournament_id,p_fencing_token:job.fencing_token}));
});
it('reads individually only for the exact size-budget marker, retaining source errors',async()=>{
 const f=batchWorkerFixture();f.setResponse(items=>[{...items[0],requiresIndividual:true},{...items[1],error:'source_failed',sqlstate:'42501'}]);
 const result=await processPublicSpectatorJobs(f,Date.now()+5000,'batch');
 expect(f.rpc.mock.calls.filter(([name])=>name==='get_public_spectator_projection_source_v2')).toEqual([
  ['get_public_spectator_projection_source_v2',{p_tournament_id:f.jobs[0].tournament_id,p_component:'tables',p_fencing_token:f.jobs[0].fencing_token}],
 ]);
 expect(result.results.filter(row=>row.published)).toHaveLength(1);
 expect(result.results.find(row=>row.key.startsWith(f.jobs[1].tournament_id))?.error).toBe('source_failed');
});
it.each(['transport','missing','wrong-token'] as const)('rejects the whole %s batch before publishing or falling back',async kind=>{
 const f=batchWorkerFixture();
 if(kind==='transport')f.setError({code:'XX000'});
 if(kind==='missing')f.setResponse(items=>[{...items[0],source:batchSource()}]);
 if(kind==='wrong-token')f.setResponse(items=>items.map(job=>({...job,fencing_token:batchJobs[0].fencing_token,source:batchSource()})));
 const result=await processPublicSpectatorJobs(f,Date.now()+5000,'batch');
 expect(result.processed).toBe(2);expect(result.results.every(row=>!row.published&&row.error)).toBe(true);
 expect(f.rpc.mock.calls.filter(([name])=>['publish_public_spectator_projection_v2','get_public_spectator_projection_source_v2'].includes(name))).toHaveLength(0);
 expect(f.rpc.mock.calls.filter(([name])=>name==='fail_public_spectator_projection_v2')).toHaveLength(2);
});
it('does not start an individual fallback after the original deadline',async()=>{
 let now=100;vi.spyOn(Date,'now').mockImplementation(()=>now);
 const f=batchWorkerFixture();f.setResponse(items=>{now=200;return items.map(job=>({...job,requiresIndividual:true}));});
 const result=await processPublicSpectatorJobs(f,200,'batch');
 expect(result.results.every(row=>row.error==='deadline_exceeded')).toBe(true);
 expect(f.rpc.mock.calls.filter(([name])=>['get_public_spectator_projection_source_v2','publish_public_spectator_projection_v2','fail_public_spectator_projection_v2'].includes(name))).toHaveLength(0);
});

afterEach(()=>vi.restoreAllMocks());
function fixture(count=8){
 let now=0,flushes=0,active=0,maxActive=0;const flushStarts:number[]=[];
 vi.spyOn(Date,'now').mockImplementation(()=>now);
 let hold:Promise<{data:unknown;error:unknown}>|null=null;
 let flushError:'throw'|'reply'|null=null;
 let published=true;
 const jobs=Array.from({length:count},(_,i)=>({tournament_id:'tour-'+i,component:'payout' as const,group_key:'component',fencing_token:'token-'+i}));
 const rpc=vi.fn(async(name:string,_args:Record<string,unknown>):Promise<{data:unknown;error:unknown}>=>{
  if(name==='flush_public_spectator_broadcast_v2'){
   flushStarts.push(now);
   flushes++;active++;maxActive=Math.max(maxActive,active);
   try{
    if(flushes===2){
     if(flushError==='throw')throw Error('flush unavailable');
     if(flushError==='reply')return {data:null,error:{code:'failure'}};
     if(hold)return await hold;
    }
    return {data:1,error:null};
   }finally{active--;}
  }
  if(name==='claim_public_spectator_projection_v2')return {data:jobs,error:null};
  if(name==='get_public_spectator_projection_source_v2'){now+=25;return {data:{sourceVector:{generation:'1'},payload:{items:[]}},error:null};}
  if(name==='publish_public_spectator_projection_v2'){now+=25;return {data:published,error:null};}
  return {data:0,error:null};
 });
 return {rpc,jobs,setNow:(value:number)=>{now=value;},hold:(value:typeof hold)=>{hold=value;},error:(value:typeof flushError)=>{flushError=value;},
  fenced:()=>{published=false;},flushStarts,get flushes(){return flushes;},get maxActive(){return maxActive;}};
}
async function settle(){for(let i=0;i<100;i++)await Promise.resolve();}

it('bounds job concurrency at six and finishes claimed work once without overlapping each job',async()=>{
 const jobs=Array.from({length:21},(_,i)=>({tournament_id:'tour-'+i,component:'tables',group_key:'component',fencing_token:'token-'+i}));
 let active=0,maxActive=0,started=0;
 const releases:Array<()=>void>=[],published=new Set<string>(),sourceReady=new Set<string>();
 const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>{
  if(name==='claim_public_spectator_projection_v2')return {data:jobs,error:null};
  if(name==='get_public_spectator_projection_source_v2'){
   active++;started++;maxActive=Math.max(maxActive,active);
   await new Promise<void>(resolve=>releases.push(resolve));
   sourceReady.add(String(args.p_tournament_id));
   return {data:{sourceVector:{generation:'1'},payload:{items:[]}},error:null};
  }
  if(name==='publish_public_spectator_projection_v2'){
   const key=String(args.p_tournament_id);expect(sourceReady.has(key)).toBe(true);expect(published.has(key)).toBe(false);
   published.add(key);active--;return {data:true,error:null};
  }
  return {data:0,error:null};
 });
 const running=processPublicSpectatorJobs({rpc});await settle();
 expect(started).toBe(6);expect(active).toBe(6);
 for(let wave=0;wave<jobs.length&&published.size<jobs.length;wave++){
  for(const release of releases.splice(0))release();await settle();
 }
 expect(published.size).toBe(jobs.length);
 const result=await running;
 expect(maxActive).toBe(6);expect(active).toBe(0);expect(result.processed).toBe(21);
 expect(result.results.every(row=>row.published&&!row.error)).toBe(true);
});

function startupFixture(){
 let absorbResolve!:(value:{data:unknown;error:unknown})=>void,flushResolve!:(value:{data:unknown;error:unknown})=>void;
 let absorbReject!:(error:Error)=>void,flushReject!:(error:Error)=>void;
 const absorb=new Promise<{data:unknown;error:unknown}>((resolve,reject)=>{absorbResolve=resolve;absorbReject=reject;});
 const flush=new Promise<{data:unknown;error:unknown}>((resolve,reject)=>{flushResolve=resolve;flushReject=reject;});
 let flushes=0;
 const rpc=vi.fn(async(name:string)=>{
  if(name==='absorb_public_spectator_generations_v2')return absorb;
  if(name==='flush_public_spectator_broadcast_v2'&&++flushes===1)return flush;
  return {data:name==='claim_public_spectator_projection_v2'?[]:0,error:null};
 });
 return {rpc,absorbResolve,flushResolve,absorbReject,flushReject};
}
it.each(['absorb','flush'] as const)('overlaps startup but waits for both commits when %s finishes first',async first=>{
 const f=startupFixture(),running=processPublicSpectatorJobs(f);
 await settle();expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(['absorb_public_spectator_generations_v2','flush_public_spectator_broadcast_v2']);
 if(first==='absorb')f.absorbResolve({data:1,error:null});else f.flushResolve({data:1,error:null});
 await settle();expect(f.rpc).toHaveBeenCalledTimes(2);
 if(first==='absorb')f.flushResolve({data:1,error:null});else f.absorbResolve({data:1,error:null});
 expect((await running).claimed).toBe(0);
 expect(f.rpc.mock.calls[2][0]).toBe('claim_public_spectator_projection_v2');
});
it.each(['absorb','flush'] as const)('drains the other startup RPC after a returned %s error and never claims',async failed=>{
 const f=startupFixture();let ended=false;
 const running=processPublicSpectatorJobs(f).catch(error=>{ended=true;return error;});
 await settle();
 if(failed==='absorb')f.absorbResolve({data:null,error:{code:'failure'}});else f.flushResolve({data:null,error:{code:'failure'}});
 await settle();expect(ended).toBe(false);expect(f.rpc).toHaveBeenCalledTimes(2);
 if(failed==='absorb')f.flushResolve({data:1,error:null});else f.absorbResolve({data:1,error:null});
 expect((await running).message).toBe(failed==='absorb'?'generation_absorb_failed':'broadcast_flush_failed');
 expect(f.rpc).toHaveBeenCalledTimes(2);
});
it.each(['absorb','flush'] as const)('drains the other startup RPC after a thrown %s error',async failed=>{
 const f=startupFixture(),cause=Error('transport failure');let ended=false;
 const running=processPublicSpectatorJobs(f).catch(error=>{ended=true;return error;});
 await settle();if(failed==='absorb')f.absorbReject(cause);else f.flushReject(cause);
 await settle();expect(ended).toBe(false);
 if(failed==='absorb')f.flushResolve({data:1,error:null});else f.absorbResolve({data:1,error:null});
 expect(await running).toBe(cause);expect(f.rpc).toHaveBeenCalledTimes(2);
});
it('preserves absorb error precedence while draining both startup failures',async()=>{
 const f=startupFixture(),running=processPublicSpectatorJobs(f).catch(error=>error);
 await settle();f.flushReject(Error('flush failed'));f.absorbResolve({data:null,error:{code:'failure'}});
 expect((await running).message).toBe('generation_absorb_failed');expect(f.rpc).toHaveBeenCalledTimes(2);
});
it('drains startup at deadline and leaves new outbox work for the next dispatch',async()=>{
 let now=0;vi.spyOn(Date,'now').mockImplementation(()=>now);
 const f=startupFixture();let ended=false;
 const running=processPublicSpectatorJobs(f,1000).catch(error=>{ended=true;return error;});
 await settle();f.flushResolve({data:0,error:null});now=1000;
 await settle();expect(ended).toBe(false);
 f.absorbResolve({data:1,error:null});expect((await running).message).toBe('deadline_exceeded');
 expect(f.rpc).toHaveBeenCalledTimes(2);
});

it('does not publish or fail a claim explicitly fenced by the source RPC',async()=>{
 const f=fixture(1);
 const original=f.rpc.getMockImplementation()!;
 f.rpc.mockImplementation(async(name,args)=>name==='get_public_spectator_projection_source_v2'
  ?{data:{fenced:true},error:null}:original(name,args));
 const result=await processPublicSpectatorJobs(f,5000);
 expect(result.results).toEqual([{key:'tour-0:payout:component',published:false}]);
 expect(f.rpc.mock.calls.some(([name])=>name==='publish_public_spectator_projection_v2'||name==='fail_public_spectator_projection_v2')).toBe(false);
});
it.each([null,{fenced:false},{fenced:true,payload:null}])('does not silently accept malformed source fence %j',async data=>{
 const f=fixture(1),original=f.rpc.getMockImplementation()!;
 f.rpc.mockImplementation(async(name,args)=>name==='get_public_spectator_projection_source_v2'
  ?{data,error:null}:original(name,args));
 // Malformed non-null data is not a fence and goes through normal validation/publication.
 await processPublicSpectatorJobs(f,5000);
 expect(f.rpc.mock.calls.some(([name])=>name==='fail_public_spectator_projection_v2'||name==='publish_public_spectator_projection_v2')).toBe(true);
});
it('retains real source RPC failures rather than interpreting error text as a fence',async()=>{
 const f=fixture(1),original=f.rpc.getMockImplementation()!;
 f.rpc.mockImplementation(async(name,args)=>name==='get_public_spectator_projection_source_v2'
  ?{data:null,error:{code:'P0001',message:'lease_expired'}}:original(name,args));
 const result=await processPublicSpectatorJobs(f,5000);
 expect(result.results[0].error).toBe('source_failed');
 expect(f.rpc.mock.calls.some(([name])=>name==='fail_public_spectator_projection_v2')).toBe(true);
});

it('streams committed publications with one held flush and awaits it before the final flush',async()=>{
 const f=fixture();let release!:(value:{data:unknown;error:unknown})=>void;
 f.hold(new Promise(resolve=>{release=resolve;}));let returned=false;
 const running=processPublicSpectatorJobs(f,5000).then(result=>{returned=true;return result;});
 await settle();expect(f.flushes).toBe(2);expect(f.maxActive).toBe(1);expect(returned).toBe(false);
 expect(f.rpc.mock.calls.filter(([name])=>name==='publish_public_spectator_projection_v2')).toHaveLength(8);
 release({data:1,error:null});const result=await running;
 expect(f.flushes).toBe(3);expect(f.maxActive).toBe(1);expect(result.results.every(row=>row.published&&!row.error)).toBe(true);
 expect(f.rpc).toHaveBeenCalledWith('claim_public_spectator_projection_v2',{p_limit:50});
 for(const job of f.jobs)expect(f.rpc).toHaveBeenCalledWith('publish_public_spectator_projection_v2',{
  p_tournament_id:job.tournament_id,p_component:job.component,p_group_key:job.group_key,p_fencing_token:job.fencing_token,
  p_source_vector:{generation:'1'},p_payload:{items:[]},
 });
});
it.each(['throw','reply'] as const)('keeps committed publications successful after early flush %s and retries the outbox at return',async failure=>{
 const f=fixture(4);f.error(failure);const result=await processPublicSpectatorJobs(f,5000);
 expect(result.processed).toBe(4);expect(result.results.every(row=>row.published&&!row.error)).toBe(true);
 expect(f.rpc.mock.calls.some(([name])=>name==='fail_public_spectator_projection_v2')).toBe(false);
 expect(f.flushes).toBe(3);
});
it('does not flush fenced publications early or report them as a new publish failure',async()=>{
 const f=fixture();f.fenced();const result=await processPublicSpectatorJobs(f,5000);
 expect(result.results.every(row=>!row.published&&!row.error)).toBe(true);expect(f.flushes).toBe(2);
 expect(f.rpc.mock.calls.some(([name])=>name==='fail_public_spectator_projection_v2')).toBe(false);
});
it('awaits an in-flight flush at the deadline and does not start a final RPC after it',async()=>{
 const f=fixture();let release!:(value:{data:unknown;error:unknown})=>void;
 f.hold(new Promise(resolve=>{release=resolve;}));let returned=false;
 const running=processPublicSpectatorJobs(f,1000).then(value=>{returned=true;return value;});
 await settle();expect(f.flushes).toBe(2);expect(returned).toBe(false);const calls=f.rpc.mock.calls.length;
 f.setNow(1000);release({data:1,error:null});await running;
 expect(f.rpc).toHaveBeenCalledTimes(calls);expect(f.flushes).toBe(2);
});
it('coalesces a full fifty-job batch by actual flush start time without adding timers',async()=>{
 const f=fixture(50);const result=await processPublicSpectatorJobs(f,5000);
 expect(result.processed).toBe(50);expect(f.maxActive).toBe(1);
 const timed=f.flushStarts.slice(0,-1);
 for(let i=1;i<timed.length;i++)expect(timed[i]-timed[i-1]).toBeGreaterThanOrEqual(100);
 expect(f.flushes).toBeLessThan(50);
});
