// LOCAL ONLY: actual SDK -> actual Edge create/read handler -> modeled
// Auth/PostgREST HTTP adapter -> real native PostgreSQL commits. Not hosted Auth.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {loadCreateAction} from './createAction.fixture.mjs';
import {parseOnlineCreateReceipt,parseOnlineCreateResolution} from '../../src/lib/onlinePoker/createReceipt.ts';
assert.equal(process.env.VINPOKER_ONLINE778_NATIVE,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_fnb719_gate_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000,maxBuffer:3e6,stdio:['pipe','pipe','pipe']}).trim();
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_fnb719_gate_local|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
assert.equal(sql("SELECT to_regclass('floor_private.online778_http') IS NULL;"),'t','consumed evidence; do not reset');
assert.equal(sql('SELECT count(*) FROM public.online_poker_config;'),'0');
assert.equal(sql("SELECT md5(pg_get_functiondef('public.op_create_open_table_v2(text,bigint,bigint,bigint,integer,uuid)'::regprocedure));"),'44a816ef45c75b8d49307989932a6da2');
assert.equal(sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend' AND state<>'idle';"),'0');
const actor='675fe35e-60a8-4452-bb90-e79486d54da6',other='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
assert.equal(sql(`SELECT count(*) FROM auth.users WHERE id IN('${actor}','${other}');`),'2');
const identities=new Map([['LOCAL778_TEST_A',actor],['LOCAL778_TEST_B',other]]);
const key=randomUUID(),payload={name:'LOCAL778-HTTP',sb:'25',bb:'50',buyin:'5000',maxSeats:9};
const protectedNames=JSON.parse(sql("SELECT jsonb_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'fnb\\_%' ESCAPE '\\' OR tablename IN('cashier_buyin_movements','tournament_prize_payments','tournament_entries','tournament_seats'));"));
const proof=()=>sql(`SELECT md5(jsonb_build_array(${protectedNames.map(n=>`(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public."${n.replaceAll('"','""')}" t)`).join(',')})::text);`);
const before=proof();
const originalOnline=()=>sql(`SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.online_poker_tables t WHERE name<>'LOCAL778-HTTP'),
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY to_jsonb(s)::text) FROM public.online_poker_seats s WHERE table_id NOT IN(SELECT id FROM public.online_poker_tables WHERE name='LOCAL778-HTTP')),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM private.online_create_requests_v1 r WHERE request_id<>${quote(key)}::uuid))::text);`);
assert.equal(sql("SELECT count(*) FROM public.online_poker_tables WHERE name='LOCAL778-HTTP';"),'0');
const oldOnline=originalOnline(),logs=[],counts={auth:0,create:0,read:0,gate:0};
sql(`CREATE TABLE floor_private.online778_http(stage text PRIMARY KEY,evidence jsonb NOT NULL);ALTER TABLE floor_private.online778_http ENABLE ROW LEVEL SECURITY;REVOKE ALL ON floor_private.online778_http FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO floor_private.online778_http VALUES('start',jsonb_build_object('protected',${quote(before)},'originalOnline',${quote(oldOnline)},'requestId',${quote(key)}));`);
const record=(stage,evidence)=>sql(`INSERT INTO floor_private.online778_http VALUES(${quote(stage)},${quote(JSON.stringify(evidence))}::jsonb);`);
let configured=null,drop=true,handler;
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  const token=String(req.headers.authorization??'').replace(/^Bearer /,'');
  const uid=identities.get(token);
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(url.pathname==='/auth/v1/user'&&req.method==='GET'){
   counts.auth++;return uid?send(200,{id:uid,aud:'authenticated',role:'authenticated',created_at:'2026-10-01T00:00:00Z',app_metadata:{},user_metadata:{}}):send(401,{message:'LOCAL778_AUTH_DENIED'});
  }
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const raw=Buffer.concat(chunks).toString('utf8');
  if(url.pathname==='/functions/v1/online-poker-action'&&req.method==='POST'){
   const response=await handler(new Request(base+url.pathname,{method:'POST',headers:req.headers,body:raw}));
   // Drop AFTER the handler returns, i.e. after the real RPC committed.
   if(drop&&JSON.parse(raw).op==='create_open_table'&&response.status===200){drop=false;res.destroy();return;}
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
  }
  const name=url.pathname.replace('/rest/v1/rpc/','');
  if(req.method!=='POST'||!url.pathname.startsWith('/rest/v1/rpc/'))return send(404,{message:'LOCAL778_ROUTE_DENIED'});
  const body=JSON.parse(raw);let expression,role;
  if(name==='op_is_enabled'&&token==='SERVICE_TEST'){
   counts.gate++;role='service_role';expression='public.op_is_enabled()';
  }else if(uid&&name==='op_create_open_table_v2'){
   counts.create++;role='authenticated';
   assert.deepEqual(Object.keys(body).sort(),['p_name','p_sb','p_bb','p_buyin','p_max_seats','p_request_id'].sort());
   expression=`public.op_create_open_table_v2(${quote(body.p_name)}::text,${quote(body.p_sb)}::bigint,${quote(body.p_bb)}::bigint,${quote(body.p_buyin)}::bigint,${quote(body.p_max_seats)}::integer,${quote(body.p_request_id)}::uuid)`;
  }else if(uid&&name==='op_get_create_receipt_v1'){
   counts.read++;role='authenticated';assert.deepEqual(Object.keys(body),['p_request_id']);
   expression=`public.op_get_create_receipt_v1(${quote(body.p_request_id)}::uuid)`;
  }else return send(403,{message:'LOCAL778_RPC_DENIED'});
  try{
   const value=sql(`BEGIN;SET LOCAL statement_timeout='5s';${uid?`SET LOCAL request.jwt.claim.sub=${quote(uid)};SET LOCAL request.jwt.claims=${quote(JSON.stringify({sub:uid,role:'authenticated'}))};`:''}SET LOCAL ROLE ${role};SELECT to_jsonb(${expression});COMMIT;`);
   return send(200,JSON.parse(value));
  }catch{return send(400,{code:'P0001',message:'LOCAL778_RPC_REJECTED'});}
 }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end('{"message":"LOCAL778_ADAPTER_ERROR"}');}
});
let base;
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 base=`http://127.0.0.1:${server.address().port}`;
 handler=loadCreateAction(createClient,logs,base);
 const client=createClient(base,'ANON_TEST',{auth:{persistSession:false,autoRefreshToken:false}});
 const invoke=(body,token='LOCAL778_TEST_A')=>client.functions.invoke('online-poker-action',{headers:{Authorization:`Bearer ${token}`},body});
 const create={op:'create_open_table',...payload,requestId:key,expectedActorId:actor};
 const denied=await invoke(create,'LOCAL778_UNKNOWN');assert.ok(denied.error);assert.equal(counts.create,0);
 sql('INSERT INTO public.online_poker_config(id,enabled) VALUES(true,true);');
 configured=sql('SELECT to_jsonb(g) FROM public.online_poker_config g WHERE id;');
 const lost=await invoke(create);assert.ok(lost.error,'postcommit response must be lost');assert.equal(counts.create,1);
 const found=await invoke({op:'get_create_receipt',requestId:key,expectedActorId:actor});assert.equal(found.error,null);
 const resolution=parseOnlineCreateResolution(found.data,key,payload);assert.equal(resolution.state,'resolved');
 const table=resolution.receipt.table_id;
 const replay=await invoke(create);assert.equal(replay.error,null);assert.equal(parseOnlineCreateReceipt(replay.data,key).table_id,table);assert.equal(replay.data.replayed,true);
 const conflict=await invoke({...create,buyin:'6000'});assert.ok(conflict.error);
 const beforeMismatch=counts.create;const mismatch=await invoke(create,'LOCAL778_TEST_B');assert.ok(mismatch.error);assert.equal(counts.create,beforeMismatch);
 const otherRead=await invoke({op:'get_create_receipt',requestId:key,expectedActorId:other},'LOCAL778_TEST_B');assert.equal(otherRead.error,null);assert.equal(otherRead.data.outcome,'not_found');
 const removed=sql(`WITH r AS(DELETE FROM public.online_poker_config g WHERE g.id AND to_jsonb(g)=${quote(configured)}::jsonb RETURNING 1)SELECT count(*) FROM r;`);assert.equal(removed,'1');configured=null;
 const disabled=await invoke({...create,requestId:randomUUID()});assert.ok(disabled.error);assert.equal(counts.create,beforeMismatch);
 const recoveredOff=await invoke({op:'get_create_receipt',requestId:key,expectedActorId:actor});assert.equal(recoveredOff.error,null);assert.equal(parseOnlineCreateResolution(recoveredOff.data,key,payload).state,'resolved');
 assert.equal(sql("SELECT count(*) FROM public.online_poker_tables WHERE name='LOCAL778-HTTP';"),'1');
 assert.equal(sql(`SELECT count(*) FROM public.online_poker_seats WHERE table_id=${quote(table)}::uuid AND user_id='${actor}' AND seat_no=1 AND stack=5000;`),'1');
 record('accepted',{counts,requestId:key,table,lostResponse:true,replayed:true,crossActorDenied:true,readWhileOff:true});
 assert.ok(!JSON.stringify(logs).includes('LOCAL778_TEST_'),'auth fixture token leaked in actual logs');
 console.log('ONLINE778_ACTUAL_SDK_HTTP_HANDLER_PG_POSTCOMMIT_LOSS_RECOVERY_REPLAY_ACTOR_OFF_READ_PASS');
}catch(error){record('failure',{message:String(error.message),counts});throw error;}
finally{
 await new Promise(resolve=>server.close(resolve));server.closeAllConnections();
 if(configured){assert.equal(sql(`WITH r AS(DELETE FROM public.online_poker_config g WHERE g.id AND to_jsonb(g)=${quote(configured)}::jsonb RETURNING 1)SELECT count(*) FROM r;`),'1');}
 assert.equal(sql('SELECT count(*) FROM public.online_poker_config;'),'0');
 assert.equal(proof(),before);assert.equal(originalOnline(),oldOnline);
 record('protected-final',{protected:proof(),originalOnline:originalOnline(),configRows:0});
 console.log('ONLINE778_PROTECTED_FNB_MONEY_ENTRIES_SEATS_OLD_ONLINE_UNCHANGED_NEW_RECEIPT_KEPT_CONFIG_OFF');
}
