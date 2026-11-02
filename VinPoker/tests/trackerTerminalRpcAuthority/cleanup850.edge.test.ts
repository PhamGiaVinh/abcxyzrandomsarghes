import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {execFileSync} from 'node:child_process';
import {expect,it,vi} from 'vitest';

// Execute the actual product handler. Auth and RPC are modeled here, not DB proof.
function harness(data: unknown = {status:'success',voided_count:0}, error: unknown = null,
 native?: {actor:string;rpc:(name:string,args:{p_older_than:string})=>Promise<{data:unknown;error:null}>}) {
 const rpc=vi.fn(native?.rpc ?? (async()=>({data,error})));
 const getUser=vi.fn(async()=>({data:{user:{id:native?.actor??'LOCAL_TEST_ACTOR'}},error:null}));
 let handler!: (request:Request)=>Promise<Response>;
 const source=readFileSync(resolve('supabase/functions/tournament-live-cleanup/index.ts'),'utf8')
  .replace(/^import[^\n]+\n/gm,'');
 runInNewContext(stripTypeScriptTypes(source),{
  Response,Number,JSON,createClient:()=>({auth:{getUser},rpc}),
  Deno:{env:{get:()=> 'LOCAL_TEST_ONLY'},serve:(value:typeof handler)=>{handler=value;}},
 });
 const request=(body:string,method='POST')=>handler(new Request('http://localhost/cleanup',{
  method,headers:{Authorization:'Bearer LOCAL_TEST_ONLY','Content-Type':'application/json'},
  ...(method==='GET'?{}:{body}),
 }));
 return {request,rpc,getUser};
}

it.each([0,-1,9,61,null,'10',false,{},[]].map(value=>[value]))('rejects invalid explicit cleanup window %j without RPC',async value=>{
 const h=harness();
 const response=await h.request(JSON.stringify({older_than_minutes:value}));
 expect(response.status).toBe(400);
 expect(await response.json()).toMatchObject({error:'invalid_cleanup_window'});
 expect(h.rpc).not.toHaveBeenCalled();
});

it.skipIf(process.env.VINPOKER_CLEANUP850_NATIVE!=='1')('runs actual handler with native cleanup RPC; completed original/proof and all facts remain unchanged',async()=>{
 const facts=`SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_settlement_outcomes x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY hand_id,source_revision) FROM public.tracker_historical_display_queue x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_eliminations x)
 )::text)`;
 for(const actor of ['675fe35e-60a8-4452-bb90-e79486d54da6','00000000-0000-4000-8000-000000000099']) {
  const h=harness(undefined,null,{actor,rpc:async(name,args)=>{
   expect(name).toBe('cleanup_orphan_hands');
   expect(args).toEqual({p_older_than:'10 minutes'});
   const result=execFileSync('wsl.exe',['-d','PokerVision-P16-4C-Eval','--','env',
    'PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c',
    'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{encoding:'utf8',timeout:15000,input:`
    BEGIN;SET LOCAL lock_timeout='1s';SET LOCAL statement_timeout='8s';
    DO $$ BEGIN
     ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
     ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
     ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','dblink'));
     ASSERT md5(pg_get_functiondef('public.cleanup_orphan_hands(interval)'::regprocedure))='a77e3b0782be759ab66230258f6dd041';
     ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id
       WHERE t.club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND h.status='in_progress');
    END $$;
    CREATE TEMP VIEW facts850 AS ${facts};
    CREATE TEMP TABLE before850 AS SELECT * FROM facts850;
    SET LOCAL request.jwt.claim.sub='${actor}';
    SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';
    SET LOCAL ROLE authenticated;
    SELECT public.cleanup_orphan_hands(interval '10 minutes');
    RESET ROLE;
    DO $$ BEGIN
     ASSERT (SELECT * FROM before850)=(SELECT * FROM facts850),'cleanup850 business delta';
     ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='31c2e710-590f-4e82-b8ff-c8e887c5b314'
       AND status='completed' AND NOT is_voided AND source_revision=15);
     ASSERT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes o
       CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(o.hand_id) h
       WHERE o.hand_id='31c2e710-590f-4e82-b8ff-c8e887c5b314' AND o.status='verified'
        AND o.verification_scope='historical_display' AND o.source_revision=h.source_revision AND o.source_chain_hash=h.source_chain_hash);
    END $$;
    ROLLBACK;`});
   return {data:JSON.parse(result.trim()),error:null};
  }});
  const response=await h.request('{}');
  expect(response.status).toBe(actor.startsWith('675f')?200:403);
  expect(await response.json()).toEqual(actor.startsWith('675f')?{status:'success',voided_count:0}:{error:'actor_not_allowed'});
  expect(h.rpc).toHaveBeenCalledTimes(1);
 }
});
it.each(['{','null','[]','42'])('rejects malformed/non-object body %s without RPC',async body=>{
 const h=harness();
 const response=await h.request(body);
 expect(response.status).toBe(400);
 expect(h.rpc).not.toHaveBeenCalled();
});
it.each([10,15.5,60])('passes valid window %s unchanged exactly once',async minutes=>{
 const h=harness();
 expect((await h.request(JSON.stringify({older_than_minutes:minutes}))).status).toBe(200);
 expect(h.rpc).toHaveBeenCalledExactlyOnceWith('cleanup_orphan_hands',{p_older_than:`${minutes} minutes`});
});
it('defaults only an omitted window, not an explicit zero/null',async()=>{
 const h=harness();
 expect((await h.request('{}')).status).toBe(200);
 expect(h.rpc).toHaveBeenCalledExactlyOnceWith('cleanup_orphan_hands',{p_older_than:'10 minutes'});
});
it('does not accept GET as cleanup mutation',async()=>{
 const h=harness();
 expect((await h.request('', 'GET')).status).toBe(405);
 expect(h.rpc).not.toHaveBeenCalled();
});
it.each([['actor_not_allowed',403],['invalid_cleanup_window',400]])('preserves business denial %s',async(error,status)=>{
 const h=harness({error});
 const response=await h.request('{}');
 expect(response.status).toBe(status);
 expect(await response.json()).toEqual({error});
 expect(h.rpc).toHaveBeenCalledTimes(1);
});
