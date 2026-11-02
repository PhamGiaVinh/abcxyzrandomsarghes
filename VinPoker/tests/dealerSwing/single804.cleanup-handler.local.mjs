import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {manualDealerIntentHeaders} from '../../supabase/functions/_shared/dealerMutationIntent.ts';

assert.equal(process.env.VINPOKER_SINGLE804_EVIDENCED_CLEANUP,'1');
const apply=process.argv.includes('--apply-evidenced');assert.ok(apply||process.argv.includes('--rollback-only'));
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:15000}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
const club='d4427834-5f5f-48ef-bde5-e2dc388ed00b',owner='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
const expected=new Map([
 ['47323bd1-60a3-42a8-99c6-ede1c33f5f90','2026-10-24T09:53:49.584198+07:00'],
 ['e03c9a69-7c3d-4431-aa98-a801015dfae5','2026-10-24T13:13:21.691889+07:00'],
 ['6b2ea4bd-67d4-47ef-94e2-5cfe7e5a6c4a','2026-10-24T11:40:15.021818+07:00'],
]);
const held='1f3f1e56-db9d-46b9-9e3b-531845da5802',ids=[...expected.keys(),held];
const quote=v=>`'${String(v).replaceAll("'","''")}'`;
const list=ids.map(quote).join(',');
const facts=()=>JSON.parse(sql(`SELECT jsonb_build_object(
 'rows',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_attendance x WHERE id IN(${list})),
 'audit',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.audit_logs x WHERE entity_id::text IN(${ids.map(quote).join(',')}) AND action='administrative_stale_checkout'),
 'protected',md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_attendance x WHERE id NOT IN(${list})),
 ${['dealer_assignments','dealer_rotation_schedule','payroll_periods','dealer_payroll','cashier_buyin_movements','tournament_entries','tournament_seats','tournament_prize_payments','chip_inventory_ledger','chip_bank_ledger'].map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text));`));
const before=facts();assert.equal(before.rows.length,4);assert.ok(before.rows.every(r=>r.status==='checked_in'&&r.current_state==='available'&&r.check_out_time===null));
assert.equal(before.audit.length,0,'consumed apply: never reseed or erase audit');
assert.equal(sql("SELECT md5(pg_get_functiondef('public.administrative_close_stale_dealer_attendance(uuid[],uuid)'::regprocedure));"),'f1e5ee016ea66530d9f8644e86721997','reviewed exact cleanup definition');
const service="BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{\"role\":\"service_role\"}';SET LOCAL ROLE service_role;";
let actor=owner,handler,cleanupCalls=0;
const admin={from(table){assert.equal(table,'dealer_attendance');return {select(columns){assert.equal(columns,'id, dealer_id, dealers!inner(club_id)');return {in(column,requested){assert.equal(column,'id');assert.deepEqual([...requested].sort(),[...ids].sort());
 // Managed service-role metadata read model only; business writer below runs
 // as actual native service_role. This does not claim hosted RLS/Auth parity.
 return Promise.resolve({data:JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('id',a.id,'dealer_id',a.dealer_id,'dealers',jsonb_build_object('club_id',d.club_id))) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE a.id IN(${list});`)),error:null});
}};}};},async rpc(name,a){
 if(name==='is_club_dealer_control'){assert.equal(a._user_id,actor);assert.equal(a._club_id,club);return {data:JSON.parse(sql(service+`SELECT to_jsonb(public.is_club_dealer_control('${actor}','${club}'));ROLLBACK;`)),error:null};}
 assert.equal(name,'administrative_close_stale_dealer_attendance');assert.equal(a.p_actor_id,owner);assert.deepEqual([...a.p_attendance_ids].sort(),[...ids].sort());cleanupCalls++;
 return {data:JSON.parse(sql(service+`SELECT public.administrative_close_stale_dealer_attendance(ARRAY[${list}]::uuid[],'${owner}');${apply?'COMMIT':'ROLLBACK'};`)),error:null};
}};
const source=readFileSync(new URL('../../supabase/functions/checkout-dealer/index.ts',import.meta.url),'utf8').replace(/^import[\s\S]*?;\r?\n/gm,'');
runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
 Deno:{env:{get:k=>({SUPABASE_URL:'http://native.local',SUPABASE_SERVICE_ROLE_KEY:'LOCAL_MODEL_NOT_SECRET',TELEGRAM_BOT_TOKEN:''})[k]},serve:fn=>handler=fn},
 authenticateUser:async()=>({uid:actor}),manualDealerIntentHeaders,createClient:(_url,_key,options)=>{assert.deepEqual({...options.global.headers},manualDealerIntentHeaders(actor));return admin;},
 jsonResponse:(value,status=200)=>new Response(JSON.stringify(value),{status}),Response,Request,console,
 fetch:()=>{throw Error('external delivery forbidden');},
});
const invoke=()=>handler(new Request('http://native.local/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'stale_cleanup',attendance_ids:ids})}));
actor='40b8f243-bf3b-4aaa-962b-db788380207c';const denied=await invoke();assert.equal(denied.status,403,await denied.text());assert.equal(cleanupCalls,0);assert.deepEqual(facts(),before);
actor=owner;const response=await invoke();assert.equal(response.status,200);const result=await response.json();
assert.equal(result.mode,'stale_cleanup');assert.equal(result.results.length,4);
for(const r of result.results){if(r.attendance_id===held){assert.equal(r.success,false);assert.equal(r.error_code,'NO_END_EVIDENCE');}else{assert.equal(r.success,true);assert.equal(r.check_out_time,expected.get(r.attendance_id));assert.equal(r.payroll_recalculated,false);assert.equal(r.overtime_recalculated,false);}}
const after=facts();assert.equal(after.protected,before.protected);
if(apply){
 assert.equal(after.audit.length,3);
 for(const row of after.rows){const old=before.rows.find(r=>r.id===row.id);if(row.id===held){assert.deepEqual(row,old);continue;}
  assert.equal(row.status,'checked_out');assert.equal(row.current_state,'checked_out');assert.equal(row.check_out_time,expected.get(row.id));
  for(const key of ['check_in_time','total_worked_minutes_today','overtime_minutes'])assert.equal(row[key],old[key]);
 }
 const replay=await invoke();assert.equal(replay.status,200);const r=await replay.json();assert.equal(r.results.filter(x=>x.idempotent===true).length,3);assert.deepEqual(facts(),after);
 console.log('SINGLE804_THREE_EVIDENCED_CANONICAL_CHECKOUT_COMMITS_THREE_AUDITS_REPLAY_NO_DELTA_ONE_NO_EVIDENCE_HELD_PASS');
}else{assert.deepEqual(after,before);console.log('SINGLE804_ACTUAL_EDGE_NATIVE_ROLLBACK_THREE_EVIDENCED_ONE_HELD_FOREIGN_DENIED_NO_DELTA_PASS');}
