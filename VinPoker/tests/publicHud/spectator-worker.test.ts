import {afterEach,expect,it,vi} from 'vitest';
import {processPublicSpectatorJobs} from '../../supabase/functions/public-spectator-projector-v2/worker';

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
