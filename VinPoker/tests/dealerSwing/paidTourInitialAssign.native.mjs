import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parseSync,transformSync} from '@swc/core';
import {computeSwingDuration} from '../../supabase/functions/_shared/computeSwingDuration.ts';
import {manualDealerIntentHeaders} from '../../supabase/functions/_shared/dealerMutationIntent.ts';
import {OPEN_TABLE_GRACE_MINUTES} from '../../supabase/functions/_shared/openTableGrace.ts';

// Called only after the parent paid fixture has verified exact local PG identity.
// Actual assign-dealer handler/RPC/audit; modeled Auth and PostgREST, no Telegram.
export function createPaidInitialAssignmentHandler(sql,f){
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 const role='paid_initial_'+crypto.randomUUID().replaceAll('-','');
 sql(`CREATE ROLE ${role} NOLOGIN INHERIT BYPASSRLS;GRANT service_role TO ${role};`);
 const quote=v=>v===null?'NULL':typeof v==='object'?`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`:`'${String(v).replaceAll("'","''")}'`;
 const signatures={is_club_dealer_control:{_user_id:'uuid',_club_id:'uuid'},club_local_date:{p_club_id:'uuid'},
  worker_read_initial_assignment_receipt_v1:{p_request_key:'text',p_club_id:'uuid',p_table_id:'uuid',p_table_session_id:'uuid',p_dealer_id:'uuid'},
  resolve_dealer_initial_assignment_intent_v1:{p_actor_user_id:'uuid',p_club_id:'uuid',p_table_id:'uuid',p_table_session_id:'uuid',p_dealer_id:'uuid',p_request_id:'uuid'},
  worker_assign_dealer_to_session_v1:{p_attendance_id:'uuid',p_table_id:'uuid',p_table_session_id:'uuid',p_swing_due_at:'timestamptz',p_club_id:'uuid',p_idempotency_key:'text'}};
 let actor=f.actor,writes=0,headers;
 const service=()=>`BEGIN;SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL request.headers=${quote(JSON.stringify(headers))};SET LOCAL ROLE ${role};`;
 const admin={rpc:async(name,args)=>{assert.ok(signatures[name],name);assert.deepEqual(Object.keys(args).sort(),Object.keys(signatures[name]).sort());
  if(name==='worker_assign_dealer_to_session_v1')writes++;
  try{return {data:JSON.parse(sql(service()+`SELECT coalesce(to_jsonb(public.${name}(${Object.entries(args).map(([k,v])=>k+'=>'+quote(v)+'::'+signatures[name][k]).join(',')})),'null'::jsonb);COMMIT;`)),error:null};}
  catch(error){return {data:null,error:{message:String(error.stderr??error)}};}
 },from(name){assert.ok(['game_tables','dealer_assignments','swing_config','dealer_attendance','audit_logs'].includes(name));let cols,where=[],order='',limit='';
  const column=k=>{assert.match(k,/^[a-z_]+$/);return (name==='dealer_attendance'?'a.':'')+k;};
  const q={select:value=>{cols=value;return q;},eq:(k,v)=>{where.push(column(k)+'='+quote(v));return q;},
   in:(k,v)=>{where.push(column(k)+' IN ('+v.map(quote).join(',')+')');return q;},is:(k,v)=>{assert.equal(v,null);where.push(column(k)+' IS NULL');return q;},
   order:(k,o)=>{order=' ORDER BY '+column(k)+(o?.ascending===false?' DESC':' ASC');return q;},limit:n=>{assert.equal(n,1);limit=' LIMIT 1';return q;},
   async read(){let from='public.'+name;
    if(name==='dealer_attendance'){
     assert.equal(cols,'id, shift_id, dealers!inner(full_name, telegram_username, telegram_user_id)');
     cols="a.id,a.shift_id,jsonb_build_object('full_name',d.full_name,'telegram_username',d.telegram_username,'telegram_user_id',d.telegram_user_id) AS dealers";
     from='public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id';
    }else assert.match(cols,/^(\*|[a-z_, ]+)$/);
    try{return {data:JSON.parse(sql(service()+`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (SELECT ${cols} FROM ${from}${where.length?' WHERE '+where.join(' AND '):''}${order}${limit}) x;COMMIT;`)),error:null};}
    catch(error){return {data:null,error:{message:String(error.stderr??error)}};}
   },async maybeSingle(){const r=await q.read();assert.ok(!r.data||r.data.length<=1);return {data:r.data?.[0]??null,error:r.error};},
   then(resolve,reject){return q.read().then(resolve,reject);},
   async insert(row){assert.equal(name,'audit_logs');const keys=Object.keys(row);keys.forEach(k=>assert.match(k,/^[a-z_]+$/));
    sql(service()+`INSERT INTO public.audit_logs(${keys.join(',')}) VALUES(${keys.map(k=>quote(row[k])).join(',')});COMMIT;`);return {data:null,error:null};}
  };return q;
 }};
 try{
  const source=readFileSync(new URL('../../supabase/functions/assign-dealer/index.ts',import.meta.url),'utf8'),tree=parseSync(source,{syntax:'typescript'});
  const stripped=tree.body.filter(n=>n.type!=='ImportDeclaration').map(n=>Buffer.from(source).subarray(n.span.start-tree.span.start,n.span.end-tree.span.start).toString()).join('\n');
  const code=transformSync(stripped,{jsc:{parser:{syntax:'typescript'},target:'es2022'}}).code;
  let handler;
  runInNewContext(code,{Request,Response,Error,Date,Promise,console,corsHeaders:{},computeSwingDuration,OPEN_TABLE_GRACE_MINUTES,manualDealerIntentHeaders,
   authenticateUser:async()=>({uid:actor}),createClient:(_url,_key,options)=>{headers=options.global.headers;assert.deepEqual({...headers},manualDealerIntentHeaders(actor));return admin;},
   Deno:{serve:fn=>handler=fn,env:{get:k=>({SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'TEST_ONLY'})[k]}},
   jsonResponse:(body,status)=>new Response(JSON.stringify(body),{status}),fetch:()=>{throw Error('external delivery forbidden in local canary');}});
  assert.ok(handler);
  return {quote,invoke:body=>handler(new Request('https://test.invalid/assign-dealer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})),
   setActor:value=>{actor=value;},get writes(){return writes;},cleanup:()=>sql(`DROP ROLE ${role};`)};
 }catch(error){sql(`DROP ROLE ${role};`);throw error;}
}

export async function runPaidTourInitialAssignments(sql,f,tables,targetDealerIds){
 assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 const native=createPaidInitialAssignmentHandler(sql,f),{quote,invoke}=native;
 try{
  if(targetDealerIds)assert.ok(targetDealerIds.length===4&&new Set(targetDealerIds).size===4&&targetDealerIds.every(id=>/^[a-f0-9-]{36}$/.test(id)));
  const dealerFilter=targetDealerIds?` AND id IN (${targetDealerIds.map(quote).join(',')})`:'';
  const dealers=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.dealers d WHERE club_id='${f.club}'${dealerFilter};`));assert.equal(dealers.length,4);
  const linkedFinalThree=tables.length===3&&f.tour==='4cd3af4d-7e1d-4042-855f-04fb6777e580';
  assert.ok(tables.length===1||tables.length===2||linkedFinalThree,'exact paid journey table scope required');
  const assignmentCount=tables.length;
  const sessionIds=tables.map(t=>{assert.match(t.table_session_id,/^[a-f0-9-]{36}$/);return quote(t.table_session_id);}).join(',');
  const beforeAudit=Number(sql(`SELECT count(*) FROM public.audit_logs WHERE club_id='${f.club}' AND action='assign' AND entity_type='dealer_assignment';`));
  const intents=tables.map((t,i)=>({mode:'assign',table_id:sql(`SELECT game_table_id FROM public.tournament_tables WHERE id='${t.id}';`),table_session_id:t.table_session_id,
   force_dealer_id:dealers[i].id,expected_actor_id:f.actor,expected_club_id:f.club,idempotency_key:crypto.randomUUID()}));
  const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a WHERE club_id='${f.club}'),
   'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${f.club}'),
   'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_key) FROM floor_private.dealer_initial_assign_receipts r WHERE payload->>'club'='${f.club}'),
   'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.audit_logs a WHERE club_id='${f.club}'))::text);`);
  const before=fingerprint();native.setActor(f.player);assert.equal((await invoke(intents[0])).status,403);native.setActor(f.actor);
  assert.equal(fingerprint(),before);assert.equal(native.writes,0);
  for(const intent of intents){const response=await invoke(intent),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.status,'success');}
  assert.equal(native.writes,assignmentCount);const committed=fingerprint();
  for(const intent of intents){const response=await invoke(intent),body=await response.json();assert.equal(response.status,200);assert.equal(body.idempotent_replay,true);}
  assert.equal(native.writes,assignmentCount);assert.equal(fingerprint(),committed);
  assert.equal(sql(`SELECT count(*)||'|'||count(DISTINCT attendance_id)||'|'||count(DISTINCT table_session_id) FROM public.dealer_assignments WHERE club_id='${f.club}' AND table_session_id IN (${sessionIds}) AND status='assigned' AND released_at IS NULL;`),`${assignmentCount}|${assignmentCount}|${assignmentCount}`);
  for(const intent of intents)assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE club_id='${f.club}' AND table_id='${intent.table_id}' AND table_session_id='${intent.table_session_id}' AND dealer_id='${intent.force_dealer_id}' AND status='assigned' AND released_at IS NULL;`),'1');
  assert.equal(Number(sql(`SELECT count(*) FROM public.audit_logs WHERE club_id='${f.club}' AND action='assign' AND entity_type='dealer_assignment';`)),beforeAudit+assignmentCount);
  assert.equal(sql(`SELECT count(*) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${f.club}'${targetDealerIds?` AND d.id IN (${targetDealerIds.map(quote).join(',')})`:''} AND a.current_state='available';`),String(4-assignmentCount));
  assert.equal(sql(`SELECT count(*) FROM public.club_settings WHERE club_id='${f.club}' AND auto_swing_enabled;`),'0');
  console.log('NATIVE_PAID_TOUR_INITIAL_ASSIGN_EDGE_RPC_AUDIT_REPLAY_PASS');
 }finally{native.cleanup();}
}
