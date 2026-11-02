// Owned-clone browser adapter, not hosted Auth/PostgREST/Realtime. Product page,
// SDK and Edge create/read source stay real. Only explicit TEST login is modeled.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHmac} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {loadCreateAction} from './createAction.fixture.mjs';
assert.equal(process.env.VINPOKER_ONLINE780_BROWSER,'1');
const checkpoint=process.env.VINPOKER_ONLINE_BROWSER_CHECKPOINT??'780';
assert.ok(['780','781','782','783'].includes(checkpoint));
const evidenceTable=`online${checkpoint}_browser`,tableName=`LOCAL${checkpoint}-BROWSER`;
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_fnb719_gate_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000,maxBuffer:3e6,stdio:['pipe','pipe','pipe']}).trim();
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_fnb719_gate_local|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
assert.equal(sql(`SELECT to_regclass('floor_private.${evidenceTable}') IS NULL;`),'t','consumed evidence; no reset');
assert.equal(sql("SELECT proacl::text FROM pg_proc WHERE oid='public.op_create_open_table(text,bigint,bigint,bigint,integer)'::regprocedure;"),'{postgres=X/postgres}');
assert.equal(sql('SELECT count(*) FROM public.online_poker_config;'),'0');
assert.equal(sql(`SELECT count(*) FROM public.online_poker_tables WHERE name=${quote(tableName)};`),'0');
const actor='675fe35e-60a8-4452-bb90-e79486d54da6',base='http://127.0.0.1:54336',origin='http://127.0.0.1:5189';
const tables=JSON.parse(sql("SELECT jsonb_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'fnb\\_%' ESCAPE '\\' OR tablename IN('cashier_buyin_movements','tournament_prize_payments','tournament_entries','tournament_seats'));"));
const protectedProof=()=>sql(`SELECT md5(jsonb_build_array(${tables.map(n=>`(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public."${n.replaceAll('"','""')}" t)`).join(',')})::text);`);
let requestId=null;
const oldOnline=()=>sql(`SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.online_poker_tables t WHERE name<>${quote(tableName)}),
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY to_jsonb(s)::text) FROM public.online_poker_seats s WHERE table_id NOT IN(SELECT id FROM public.online_poker_tables WHERE name=${quote(tableName)})),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM private.online_create_requests_v1 r ${requestId?`WHERE request_id<>${quote(requestId)}::uuid`:''}))::text);`);
const before=protectedProof(),oldBefore=oldOnline(),logs=[],counts={create:0,receipt:0,faultRead:0};
const sessions=new Map(),signingKey=randomUUID();let drop=true,allowRecovery=false,configured=null,stopping=false;
const trace=[];let outerSequence=0;
// This Auth service is explicitly modeled, like the existing Main browser
// adapter. Minimal native auth.users has no hosted email-confirmation columns.
// Supply the verified TEST user's contract; never disable the product guard.
const user={id:actor,email:`online${checkpoint}@example.invalid`,aud:'authenticated',role:'authenticated',created_at:'2026-10-01T00:00:00Z',email_confirmed_at:'2026-10-01T00:00:00Z',app_metadata:{},user_metadata:{display_name:`LOCAL${checkpoint} TEST`}};
const authSql=(expression,uid=actor,role='authenticated')=>JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL request.jwt.claim.sub=${quote(uid)};SET LOCAL request.jwt.claims=${quote(JSON.stringify({sub:uid,role}))};SET LOCAL ROLE ${role};SELECT to_jsonb(${expression});COMMIT;`));
const handler=loadCreateAction(createClient,logs,base);
const server=createServer(async(req,res)=>{
 const send=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept-profile,content-profile');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
 if(req.headers.host!=='127.0.0.1:54336'||(req.headers.origin&&req.headers.origin!==origin))return send(403,{message:'LOCAL780_ORIGIN_DENIED'});
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 try{
  const url=new URL(req.url,base),token=String(req.headers.authorization??'').replace(/^Bearer /,'');
  const session=sessions.get(token),uid=session?.user.id;
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString('utf8');
  if(url.pathname==='/auth/v1/token'&&req.method==='POST'){
   const input=JSON.parse(raw);if(input.email!==user.email||input.password!=='Local780Only!')return send(401,{message:'LOCAL780_TEST_LOGIN_ONLY'});
   const exp=Math.floor(Date.now()/1000)+3600;
   const unsigned=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,aud:'authenticated',role:'authenticated',exp,iat:exp-3600,iss:base+'/auth/v1'})).toString('base64url');
   const access_token=unsigned+'.'+createHmac('sha256',signingKey).update(unsigned).digest('base64url');
   const value={access_token,refresh_token:randomUUID(),token_type:'bearer',expires_in:3600,expires_at:exp,user};sessions.set(access_token,value);return send(200,value);
  }
  if(url.pathname==='/auth/v1/user'&&req.method==='GET')return uid?send(200,user):send(401,{message:'LOCAL780_AUTH_REQUIRED'});
  if(url.pathname==='/auth/v1/logout'&&req.method==='POST'){sessions.delete(token);return send(200,{});}
  if(url.pathname==='/functions/v1/online-poker-action'&&req.method==='POST'){
   if(!uid)return send(401,{message:'LOCAL780_AUTH_REQUIRED'});
   const body=JSON.parse(raw);if(!['create_open_table','get_create_receipt','ping'].includes(body.op))return send(403,{message:'LOCAL780_CREATE_READ_ONLY_SCOPE'});
   const sequence=++outerSequence;
   trace.push({kind:'outer_begin',sequence,op:body.op,requestId:body.requestId??null});
   if(body.op==='create_open_table'){
    assert.equal(body.name,tableName);assert.equal(body.sb,'25');assert.equal(body.bb,'50');assert.equal(body.buyin,'5000');assert.equal(body.maxSeats,9);assert.equal(body.expectedActorId,actor);assert.ok(uuid(body.requestId));
    if(requestId)assert.equal(body.requestId,requestId);else requestId=body.requestId;
   }
   if(body.op==='get_create_receipt'&&!allowRecovery){counts.faultRead++;return send(503,{message:'LOCAL780_RECEIPT_READ_HELD'});}
   const response=await handler(new Request(base+url.pathname,{method:'POST',headers:req.headers,body:raw}));
   trace.push({kind:'outer_done',sequence,op:body.op,status:response.status,cid:response.headers.get('x-correlation-id')});
   if(drop&&body.op==='create_open_table'&&response.status===200){
    drop=false;
    // Distinguish the original pre-header connection loss from deterministic
    // truncated-body loss. Chromium may replay a reused socket before headers;
    // keep that prior evidence and its strict count failure, not a changed oracle.
    if(checkpoint==='783'){
     res.writeHead(200,Object.fromEntries(response.headers));res.flushHeaders();res.write('{');
     trace.push({kind:'headers_flushed_body_truncated',sequence});
     setTimeout(()=>res.destroy(),50);
    }else{trace.push({kind:'outer_response_dropped',sequence});res.destroy();}
    console.log('LOCAL780_COMMITTED_RESPONSE_DROPPED');return;
   }
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
  }
  const rpc=url.pathname.replace('/rest/v1/rpc/','');
  if(req.method==='POST'&&url.pathname.startsWith('/rest/v1/rpc/')){
   const body=JSON.parse(raw);let expression,role='authenticated';
   if(rpc==='op_is_enabled'&&token==='SERVICE_TEST'){expression='public.op_is_enabled()';role='service_role';}
   else if(uid&&rpc==='op_create_open_table_v2'){
    counts.create++;assert.equal(body.p_request_id,requestId);
    expression=`public.op_create_open_table_v2(${quote(body.p_name)}::text,${quote(body.p_sb)}::bigint,${quote(body.p_bb)}::bigint,${quote(body.p_buyin)}::bigint,${quote(body.p_max_seats)}::integer,${quote(body.p_request_id)}::uuid)`;
   }else if(uid&&rpc==='op_get_create_receipt_v1'){
    counts.receipt++;assert.equal(body.p_request_id,requestId);expression=`public.op_get_create_receipt_v1(${quote(body.p_request_id)}::uuid)`;
   }else return send(403,{message:'LOCAL780_RPC_DENIED'});
   const value=authSql(expression,uid??actor,role);
   trace.push({kind:'rpc_done',rpc,requestId:body.p_request_id??null,outcome:value?.outcome??null,replayed:value?.replayed??null});
   return send(200,value);
  }
  if(req.method==='GET'&&url.pathname.startsWith('/rest/v1/')){
   const table=url.pathname.slice('/rest/v1/'.length),params=url.searchParams;
   if(!uid)return send(401,{message:'LOCAL780_AUTH_REQUIRED'});
   let query;
   if(table==='user_roles')query=`SELECT role FROM public.user_roles WHERE user_id='${actor}'`;
   else if(table==='clubs'&&params.get('owner_id')===`eq.${actor}`)query=`SELECT id FROM public.clubs WHERE owner_id='${actor}' LIMIT 1`;
   else if(table==='dealers'&&params.get('user_id')===`eq.${actor}`)query=`SELECT id FROM public.dealers WHERE user_id='${actor}' AND deleted_at IS NULL LIMIT 1`;
   else if(table==='profiles')query=`SELECT id,display_name FROM public.profiles WHERE id='${actor}'`;
   else if(table==='online_poker_tables'){
    const id=params.get('id')?.replace(/^eq\./,'');if(id)assert.ok(uuid(id));
    query=`SELECT id,name,sb,bb,max_seats,status,min_buyin,max_buyin,starting_stack_default,host_user_id FROM public.online_poker_tables WHERE ${id?`id=${quote(id)}::uuid`:`status<>'closed'`} ORDER BY name`;
   }else if(table==='online_poker_seats'){
    const id=params.get('table_id')?.replace(/^eq\./,'');if(id)assert.ok(uuid(id));
    query=`SELECT table_id,seat_no,user_id,stack,status FROM public.online_poker_seats WHERE ${id?`table_id=${quote(id)}::uuid`:`status='sitting'`}`;
   }else if(table==='online_poker_hands'){
    const id=params.get('table_id')?.replace(/^eq\./,'');assert.ok(uuid(id));
    query=`SELECT state,state_version FROM public.online_poker_hands WHERE table_id=${quote(id)}::uuid AND status IN('dealing','betting','complete') ORDER BY hand_no DESC LIMIT 1`;
   }else return send(403,{message:'LOCAL780_READ_NOT_IN_SCOPE'});
   const rows=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL ROLE authenticated;SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM (${query}) t;ROLLBACK;`));
   if(String(req.headers.accept).includes('vnd.pgrst.object+json'))return rows.length===1?send(200,rows[0]):send(406,{code:'PGRST116',message:'LOCAL780_NOT_ONE_ROW'});
   return send(200,rows);
  }
  return send(403,{message:'LOCAL780_ENDPOINT_NOT_IN_SCOPE'});
  }catch{trace.push({kind:'adapter_rejected'});return send(400,{message:'LOCAL780_REQUEST_REJECTED'});}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54336,'127.0.0.1',resolve);});
sql(`CREATE TABLE floor_private.${evidenceTable}(stage text PRIMARY KEY,evidence jsonb NOT NULL);ALTER TABLE floor_private.${evidenceTable} ENABLE ROW LEVEL SECURITY;REVOKE ALL ON floor_private.${evidenceTable} FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO floor_private.${evidenceTable} VALUES('start',jsonb_build_object('protected',${quote(before)},'oldOnline',${quote(oldBefore)},'checkpoint',${quote(checkpoint)}));`);
sql('INSERT INTO public.online_poker_config(id,enabled) VALUES(true,true);');configured=sql('SELECT to_jsonb(g) FROM public.online_poker_config g WHERE id;');
const record=(stage,value)=>sql(`INSERT INTO floor_private.${evidenceTable} VALUES(${quote(stage)},${quote(JSON.stringify(value))}::jsonb);`);
async function stop(){if(stopping)return;stopping=true;
 await new Promise(resolve=>server.close(resolve));server.closeAllConnections();
 assert.equal(sql(`WITH r AS(DELETE FROM public.online_poker_config g WHERE g.id AND to_jsonb(g)=${quote(configured)}::jsonb RETURNING 1)SELECT count(*) FROM r;`),'1');configured=null;
 assert.equal(protectedProof(),before);assert.equal(oldOnline(),oldBefore);
 record('final',{counts,requestId,trace,protected:protectedProof(),oldOnline:oldOnline(),configRows:Number(sql('SELECT count(*) FROM public.online_poker_config;'))});
 assert.ok(requestId&&counts.create===1&&counts.receipt>=1&&counts.faultRead>=1,'browser journey not complete');
 assert.equal(sql(`SELECT count(*) FROM private.online_create_requests_v1 WHERE request_id=${quote(requestId)}::uuid AND actor_id='${actor}';`),'1');
 console.log('LOCAL780_FINAL_ONE_CREATE_RECEIPT_RECOVERED_OLD_BUSINESS_PRESERVED_CONFIG_OFF_PASS');process.exit(0);
}
process.stdin.setEncoding('utf8');process.stdin.on('data',async value=>{
 try{for(const command of value.trim().split(/\r?\n/)){
  if(command==='recover'){allowRecovery=true;console.log('LOCAL780_RECEIPT_READ_RELEASED');}
  else if(command==='status')console.log(JSON.stringify({counts,requestId,recoveryEnabled:allowRecovery,dropPending:drop,trace}));
  else if(command==='stop')await stop();
 }}catch(error){record('failure',{message:String(error.message),counts,requestId});console.error('LOCAL780_FINAL_FAILED_EVIDENCE_RETAINED');process.exit(1);}
});
process.on('SIGINT',()=>void stop().catch(error=>{console.error(String(error.message));process.exit(1);}));
console.log(`LOCAL${checkpoint}_READY_LOOPBACK54336_TEST_LOGIN_${user.email}_ONLY_RECOVER_STATUS_STOP`);
