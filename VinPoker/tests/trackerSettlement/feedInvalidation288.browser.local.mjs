import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Exact retained native TEST hand. All perturbations and Auth-model grants roll back.
export async function createFeedInvalidation288({ sql, scope, log }) {
 assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');
 assert.deepEqual(scope,{tour:'46cab483-91e7-4220-aacf-e17bdf05269c',club:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor:'675fe35e-60a8-4452-bb90-e79486d54da6',hand:'4aa376ee-4a27-4963-9c69-dd0a2cd17abf',table:'d294f4a4-082b-4efc-a6ca-1f96579ea344',sourceRevision:'24'});
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','dblink'));"),'f');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE id='${scope.hand}' AND tournament_id='${scope.tour}' AND tournament_table_id='${scope.table}' AND source_revision=24 AND status='completed' AND NOT is_voided;`),'1');
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
  'hands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
  'players',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x),
  'actions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
  'proofs',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_settlement_outcomes x),
  'queues',(SELECT jsonb_agg(to_jsonb(x) ORDER BY hand_id,source_revision) FROM public.tracker_historical_display_queue x),
  'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
  'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
  'prizes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
  'notices',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.notifications x),
  'auth_usage',has_schema_privilege('authenticated','auth','USAGE'))::text);`);
 const before=fingerprint();
 const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
 let output='',waiting=null,queue=Promise.resolve(),invalidated=false;
 const closed=new Promise(resolve=>child.once('close',code=>{if(waiting){clearTimeout(waiting.timer);waiting.reject(new Error('feed288 transaction closed'));waiting=null;}resolve(code);}));
 child.on('error',()=>{waiting?.reject(new Error('feed288 native process unavailable'));});
 child.stderr.on('data',()=>{}); // Do not expose SQL/context or private rows.
 child.stdout.on('data',chunk=>{
  output+=String(chunk);
  if(output.length>2e6){waiting?.reject(new Error('feed288 output limit'));child.stdin.end();return;}
  if(waiting&&output.includes(waiting.marker+'\n')){
   const index=output.indexOf(waiting.marker+'\n'),lines=output.slice(0,index).trim().split('\n').filter(Boolean);
   output=output.slice(index+waiting.marker.length+1);const done=waiting;waiting=null;clearTimeout(done.timer);
   try{assert.equal(lines.length,1);done.resolve(JSON.parse(lines[0]));}catch(error){done.reject(error);}
  }
 });
 const execute=statement=>{
  const task=queue.then(()=>new Promise((resolve,reject)=>{
   const marker=`FEED288_${randomUUID()}`;
   const timer=setTimeout(()=>{waiting=null;reject(new Error('feed288 deadline'));child.stdin.end();},10000);
   waiting={marker,timer,resolve,reject};child.stdin.write(`${statement}\n\\echo ${marker}\n`);
  }));queue=task.catch(()=>{});return task;
 };
 const anon="RESET ROLE;SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{\"role\":\"anon\"}';SET LOCAL ROLE anon;";
 try{
  const initial=await execute(`BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='2s';SET LOCAL idle_in_transaction_session_timeout='15min';GRANT USAGE ON SCHEMA auth TO authenticated;SAVEPOINT source288;${anon}SELECT public.get_public_tournament_settlement('${scope.hand}');RESET ROLE;`);
  assert.equal(initial.status,'verified');
 }catch(error){child.stdin.end();await closed;assert.equal(fingerprint(),before);throw error;}
 return {
  async handle(url,method,body){
   if(method!=='POST')return {status:401,value:{code:'LOCAL_FEED288_PUBLIC_READ_ONLY'}};
   const name=url.pathname.split('/').at(-1);let args;
   if(name==='get_public_tournament_hand_catalog_v2'){
    assert.deepEqual(Object.keys(body).sort(),['p_limit','p_tournament_id','p_tournament_table_id']);
    assert.equal(body.p_tournament_id,scope.tour);assert.equal(body.p_tournament_table_id,scope.table);
    assert.ok(Number.isSafeInteger(body.p_limit)&&body.p_limit>=1&&body.p_limit<=101);
    args=`'${scope.tour}','${scope.table}',${body.p_limit}`;
   }else if(['get_public_tournament_hand_v2','get_public_tournament_settlement'].includes(name)){
    assert.match(body.p_hand_id,/^[a-f0-9-]{36}$/i);
    assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='${body.p_hand_id}' AND tournament_id='${scope.tour}' AND tournament_table_id='${scope.table}');`),'t');
    if(name==='get_public_tournament_hand_v2'){assert.equal(body.p_tournament_id,scope.tour);args=`'${scope.tour}','${body.p_hand_id}'`;}
    else args=`'${body.p_hand_id}'`;
   }else return {status:401,value:{code:'LOCAL_FEED288_PUBLIC_READ_ONLY'}};
   const value=await execute(`${anon}SELECT public.${name}(${args});RESET ROLE;`);
   log.push({rpc:name,role:'anon',hand:body.p_hand_id??null,status:name==='get_public_tournament_settlement'?value.status:null,invalidated});
   return {status:200,value};
  },
  async invalidate(){
   assert.equal(invalidated,false,'one rollback-only perturbation, no repeated correction');
   const value=await execute(`RESET ROLE;SET LOCAL request.jwt.claim.sub='${scope.actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${scope.actor}"}';SET LOCAL ROLE authenticated;
    UPDATE public.hand_actions SET action_amount=action_amount+1 WHERE id='4a87e786-b21d-4074-9250-85e28fbb8386' AND hand_id='${scope.hand}' AND action_amount=100;
    RESET ROLE;SELECT jsonb_build_object('revision',(SELECT source_revision FROM public.tournament_hands WHERE id='${scope.hand}'),'verified',(SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${scope.hand}' AND status='verified'));`);
   assert.deepEqual(value,{revision:25,verified:0});invalidated=true;
   log.push({feed288:'AUTHENTICATED_SOURCE_INVALIDATION_ROLLBACK_ONLY',...value});return value;
  },
  async cleanup(){
   try{await execute("ROLLBACK;SELECT 'true'::jsonb;");}
   finally{child.stdin.end();assert.equal(await closed,0);assert.equal(fingerprint(),before);}
   console.log('LOCAL_FEED288_GLOBAL_HAND_PROOF_QUEUE_SEAT_CASH_PRIZE_NOTICE_AUTH_UNCHANGED_PASS');
  },
 };
}
