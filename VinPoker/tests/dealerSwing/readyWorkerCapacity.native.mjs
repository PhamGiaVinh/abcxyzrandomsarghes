// Actual ready Edge + auth/inventory helpers + actual PG17 RPC/query effects.
// Replaces HTTP/PostgREST with guarded psql, not a deployed worker/cron proof.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {execFileSync,spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import {stripTypeScriptTypes} from 'node:module';import {runInNewContext} from 'node:vm';
import {getDealerOperationalTables} from '../../supabase/functions/_shared/dealerOperationalTables.ts';
import {authorizeInternalTrigger,authorizeSwingWorkerRequest,getIdempotencyKey,parseDealerReadyPayload} from '../../supabase/functions/_shared/internal-trigger-auth.ts';
assert.equal(process.env.VINPOKER_NATIVE_READY_CAPACITY,'1');assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55441');assert.equal(process.env.PGUSER,'postgres');assert.equal(process.env.PGDATABASE,'vinpoker_ops_ready_capacity_ci');
for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[k]);
function sql(input){const flags=['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];const options={input,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']};return (process.platform==='win32'?execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_ready_capacity_ci','psql',...flags],options):execFileSync('psql',flags,options)).trim();}
assert.equal(sql("SELECT current_database()||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000"),'vinpoker_ops_ready_capacity_ci|55441|17');
const dir=sql('SHOW data_directory');assert.ok(dir==='/tmp/vinpoker-sol-local-20261016-0e79a729/data'||process.env.GITHUB_ACTIONS==='true'&&dir==='/var/lib/postgresql/data');
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net')"),'f','no external network worker in this fixture');
// The schema-only bootstrap omits hosted service_role's BYPASSRLS attribute.
// Model that server-only capability in a disposable NOLOGIN role, inheriting
// actual service grants, without altering any application role or RLS policy.
const testRole='ready_capacity_'+randomUUID().replaceAll('-','');
sql(`CREATE ROLE ${testRole} NOLOGIN INHERIT BYPASSRLS;GRANT service_role TO ${testRole};`);
process.on('exit',()=>{sql(`DROP ROLE ${testRole};`);});
assert.equal(sql(`SELECT rolcanlogin||'|'||rolsuper||'|'||rolbypassrls FROM pg_roles WHERE rolname='${testRole}';`),'false|false|true');
const service=`SET request.jwt.claim.role='service_role';SET request.jwt.claims='{"role":"service_role"}';SET ROLE ${testRole};`;
const quote=v=>v===null?'NULL':typeof v==='boolean'?(v?'true':'false'):typeof v==='number'?(assert.ok(Number.isFinite(v)),String(v)):`'${String(v).replaceAll("'","''")}'`;
const column=v=>(assert.match(v,/^[a-z_]+$/),v);
const rpcArgs={get_dealer_operational_tables_v1:['p_club_id'],atomic_dealer_ready_check:['p_club_id','p_attendance_id'],worker_perform_swing:['p_assignment_id','p_table_id','p_table_session_id','p_expected_version','p_next_attendance_id','p_send_to_break','p_break_duration_minutes','p_duration_minutes','p_rest_deficit_minutes']};
const rpcCalls=[],rpcResults=[];let failRpc=null;
function rpc(name,args){assert.ok(rpcArgs[name],name);assert.deepEqual(Object.keys(args).sort(),[...rpcArgs[name]].sort());rpcCalls.push({name,args});
 const params=Object.entries(args).map(([k,v])=>`${column(k)}=>${quote(v)}`).join(',');
 const query=name==='get_dealer_operational_tables_v1'?`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM public.${name}(${params}) r;`:`SELECT coalesce(to_jsonb(public.${name}(${params})),'null'::jsonb);`;
 const result=JSON.parse(sql(service+query));rpcResults.push({name,result});return result;
}
function client(){return {rpc:async(name,args)=>{if(name===failRpc)return {data:null,error:{message:'synthetic transport failure before dispatch'}};try{return {data:rpc(name,args),error:null};}catch(e){const pg=String(e.stderr??'').match(/ERROR:\s+([A-Z0-9]{5}):\s*([^\r\n]+)/);return {data:null,error:{code:pg?.[1],message:pg?.[2]??String(e)}};}},
 from(table){assert.ok(['club_settings','swing_config','dealer_assignments','cron_metrics'].includes(table));let columns=[],conditions=[],ordering='',maximum='';
  const q={select(value){columns=value.split(',').map(x=>column(x.trim()));return q;},eq(k,v){conditions.push(`${column(k)}=${quote(v)}`);return q;},
   in(k,values){assert.ok(Array.isArray(values)&&values.length<=100);conditions.push(`${column(k)} IN (${values.map(quote).join(',')})`);return q;},
   is(k,v){assert.equal(v,null);conditions.push(`${column(k)} IS NULL`);return q;},lt(k,v){conditions.push(`${column(k)}<${quote(v)}`);return q;},
   order(k,options={}){ordering=` ORDER BY ${column(k)} ${options.ascending===false?'DESC':'ASC'}`;return q;},limit(n){assert.ok(Number.isInteger(n)&&n>=0&&n<=100);maximum=` LIMIT ${n}`;return q;},
   async maybeSingle(){try{assert.ok(columns.length);const rows=JSON.parse(sql(service+`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM (SELECT ${columns.join(',')} FROM public.${table}${conditions.length?' WHERE '+conditions.join(' AND '):''}${ordering}${maximum}) r;`));return rows.length<=1?{data:rows[0]??null,error:null}:{data:null,error:{message:'multiple rows'}};}catch(e){return {data:null,error:{message:String(e)}};}},
   async insert(row){assert.equal(table,'cron_metrics');const allowed=['cron_name','club_id','duration_ms','status','error_count','processed_count','error_message'];assert.ok(Object.keys(row).every(k=>allowed.includes(k)));
    try{const keys=Object.keys(row);sql(service+`INSERT INTO public.cron_metrics(${keys.join(',')}) SELECT ${keys.map(k=>'r.'+k).join(',')} FROM jsonb_populate_record(NULL::public.cron_metrics,${quote(JSON.stringify(row))}::jsonb) r;`);return {data:null,error:null};}catch(e){return {data:null,error:{message:String(e)}};}},
  };return q;},
 };}
const source=stripTypeScriptTypes(readFileSync('supabase/functions/process-swing-on-dealer-ready/index.ts','utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,''));let handler;
runInNewContext(source,{Request,Response,Date,console,getDealerOperationalTables,getIdempotencyKey,parseDealerReadyPayload,
 authorizeInternalTrigger:req=>authorizeInternalTrigger(req,'synthetic-secret'),authorizeSwingWorkerRequest:req=>authorizeSwingWorkerRequest(req,'synthetic-worker','synthetic-internal'),createClient:client,
 Deno:{env:{get:k=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-worker'})[k]},serve:fn=>{handler=fn;}}});
async function dispatch(club,attendance,key=randomUUID()){
 const r=await handler(new Request('https://synthetic.invalid/functions/v1/process-swing-on-dealer-ready',{method:'POST',headers:{Authorization:'Bearer synthetic-worker','Content-Type':'application/json','x-idempotency-key':key},body:JSON.stringify({club_id:club,attendance_id:attendance})}));
 return {status:r.status,body:await r.json()};
}
function seed(size){const owner=randomUUID(),club=randomUUID(),shift=randomUUID(),rows=Array.from({length:size},()=>({table:randomUUID(),session:randomUUID(),oldDealer:randomUUID(),oldAttendance:randomUUID(),nextDealer:randomUUID(),nextAttendance:randomUUID()}));
 sql(`INSERT INTO auth.users(id) VALUES('${owner}');INSERT INTO public.clubs(id,owner_id,name,region) VALUES('${club}','${owner}','Ready capacity TEST ${size}','TEST');
 INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES('${club}',true);
 UPDATE public.swing_config SET rotation_planner_enabled=false WHERE club_id='${club}' AND table_type='tournament';
 INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES('${shift}','${club}','Ready capacity TEST','00:00','23:59');
 ${rows.map((r,n)=>`INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES('${r.table}','${club}','Ready TEST ${n}',${n+1},'cash','inactive','available');
 INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,control_mode,control_epoch,revision,opened_by) VALUES('${r.session}','${club}','${r.table}','cash','manual',1,1,'${owner}');
 INSERT INTO public.dealers(id,club_id,full_name,status) VALUES('${r.oldDealer}','${club}','Old TEST ${n}','active'),('${r.nextDealer}','${club}','Next TEST ${n}','active');
 INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state) VALUES('${r.oldAttendance}','${r.oldDealer}','${shift}',current_date,'checked_in',now()-interval '90 minutes','available'),('${r.nextAttendance}','${r.nextDealer}','${shift}',current_date,'checked_in',now()-interval '90 minutes','available');`).join('\n')}
 ${service} DO $$ DECLARE result jsonb;BEGIN ${rows.map(r=>`result:=public.worker_assign_dealer_to_session_v1('${club}','${r.table}','${r.session}','${r.oldAttendance}',now()+interval '45 minutes','capacity_old_${r.oldAttendance}');IF result->>'outcome' IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'capacity_seed_assignment_failed:%',result;END IF;`).join('\n')}END $$;
 RESET ROLE;UPDATE public.dealer_assignments SET assigned_at=now()-interval '90 minutes',swing_due_at=now()-interval '1 minute' WHERE club_id='${club}' AND released_at IS NULL;`);
 return {club,owner,rows};
}
if(process.argv.includes('--negative')){
 const c=seed(2);
 const initial=await dispatch(c.club,c.rows[0].nextAttendance);
 assert.equal(initial.body.outcome,'swung',JSON.stringify(initial));
 const incoming=sql(`SELECT attendance_id FROM public.dealer_assignments WHERE id='${initial.body.assignment_id}' AND released_at IS NOT NULL;`);
 assert.ok(c.rows.some(r=>r.oldAttendance===incoming));
 const before=sql(`SELECT md5(string_agg(to_jsonb(a)::text,',' ORDER BY a.id)) FROM public.dealer_assignments a WHERE club_id='${c.club}';`);
 const attendanceBefore=sql(`SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${c.club}';`);
 const result=await dispatch(c.club,incoming);
 assert.notEqual(result.body.outcome,'swung','recently released dealer must not acquire another overdue table: '+JSON.stringify(result));
 const rejection=rpcResults.filter(r=>r.name==='worker_perform_swing').at(-1).result;
 assert.equal(rejection.outcome,'error');assert.equal(rejection.detail,'DEALER_REST_REQUIRED');assert.equal(rejection.sqlstate,'P0001');
 assert.equal(result.status,500,JSON.stringify(result));
 assert.equal(result.body.error,'non_success_outcome');
 assert.equal(sql(`SELECT md5(string_agg(to_jsonb(a)::text,',' ORDER BY a.id)) FROM public.dealer_assignments a WHERE club_id='${c.club}';`),before,'rejected insufficient-rest intent has no assignment delta');
 assert.equal(sql(`SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${c.club}';`),attendanceBefore,'rest rejection does not mutate attendance');
 for(const [name,error] of [['atomic_dealer_ready_check','verify_failed'],['worker_perform_swing','swing_failed']]){
  failRpc=name;
  const failed=await dispatch(c.club,c.rows[1].nextAttendance);
  failRpc=null;
  assert.equal(failed.status,500,JSON.stringify({name,failed}));assert.equal(failed.body.error,error);
  assert.equal(sql(`SELECT md5(string_agg(to_jsonb(a)::text,',' ORDER BY a.id)) FROM public.dealer_assignments a WHERE club_id='${c.club}';`),before,'pre-dispatch transport fault has no assignment delta');
 }
 sql(`UPDATE public.club_settings SET auto_swing_enabled=false WHERE club_id='${c.club}';`);
 const off=await dispatch(c.club,c.rows[1].nextAttendance);
 assert.equal(off.status,200);assert.equal(off.body.skipped,'auto_swing_off');
 assert.equal(sql(`SELECT md5(string_agg(to_jsonb(a)::text,',' ORDER BY a.id)) FROM public.dealer_assignments a WHERE club_id='${c.club}';`),before);
 console.log('READY_EDGE_NATIVE_INSUFFICIENT_REST_PASS');
 // Explicit shortage is a pre-existing OT result, not a rejected partial swing.
 // Characterize it separately; no payroll rate or policy is changed here.
 const shortage=seed(2),target=shortage.rows[0];
 sql(`UPDATE public.dealer_attendance SET status='checked_out',check_out_time=now(),current_state='checked_out' WHERE id IN (${shortage.rows.map(r=>quote(r.nextAttendance)).join(',')});`);
 const assignment=JSON.parse(sql(`SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE table_id='${target.table}' AND released_at IS NULL;`));
 const shortageArgs={p_assignment_id:assignment.id,p_table_id:target.table,p_table_session_id:target.session,p_expected_version:assignment.version,p_next_attendance_id:null,p_send_to_break:false,p_break_duration_minutes:15,p_duration_minutes:30,p_rest_deficit_minutes:0};
 const shortageResult=rpc('worker_perform_swing',shortageArgs);
 assert.equal(shortageResult.outcome,'no_dealer',JSON.stringify(shortageResult));
 const afterShortage=JSON.parse(sql(`SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE id='${assignment.id}';`));
 assert.ok(afterShortage.overtime_started_at);assert.equal(afterShortage.released_at,null);assert.equal(afterShortage.status,'assigned');
 assert.equal(afterShortage.attendance_id,assignment.attendance_id);assert.equal(afterShortage.version,assignment.version+1,'existing assignment update trigger advances version for first OT marker');
 assert.equal(sql(`SELECT current_state FROM public.dealer_attendance WHERE id='${assignment.attendance_id}';`),'assigned');
 const repeatedShortage=rpc('worker_perform_swing',{...shortageArgs,p_expected_version:afterShortage.version});
 assert.equal(repeatedShortage.outcome,'no_dealer');
 assert.equal(sql(`SELECT overtime_started_at::text FROM public.dealer_assignments WHERE id='${assignment.id}';`),sql(`SELECT ${quote(afterShortage.overtime_started_at)}::timestamptz::text;`));
 console.log('READY_WORKER_NATIVE_SHORTAGE_OT_PRESERVED_PASS');
 const fault=seed(1),f=fault.rows[0];
 const faultAssignment=JSON.parse(sql(`SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE table_id='${f.table}' AND released_at IS NULL;`));
 const snapshot=`SELECT jsonb_build_object('assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_assignments a WHERE club_id='${fault.club}'),'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${fault.club}'),'breaks',(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM public.dealer_breaks b JOIN public.dealer_assignments a ON a.id=b.assignment_id WHERE a.club_id='${fault.club}'))`;
 sql(`BEGIN;
 CREATE FUNCTION pg_temp.reject_capacity_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'native_capacity_insert_fault';END $$;
 CREATE TRIGGER native_capacity_insert_fault AFTER INSERT ON public.dealer_assignments FOR EACH ROW WHEN (NEW.club_id='${fault.club}'::uuid) EXECUTE FUNCTION pg_temp.reject_capacity_insert();
 ${service}
 DO $$ DECLARE before_state jsonb;after_state jsonb;result jsonb;BEGIN
 ${snapshot} INTO before_state;
 result:=public.worker_perform_swing(p_table_id:='${f.table}',p_table_session_id:='${f.session}',p_assignment_id:='${faultAssignment.id}',p_expected_version:=${faultAssignment.version},p_next_attendance_id:='${f.nextAttendance}');
 IF result->>'outcome' IS DISTINCT FROM 'error' OR result->>'detail' IS DISTINCT FROM 'native_capacity_insert_fault' THEN RAISE EXCEPTION 'unexpected_nested_fault_result:%',result;END IF;
 ${snapshot} INTO after_state;
 IF before_state IS DISTINCT FROM after_state THEN RAISE EXCEPTION 'nested_fault_partial_write';END IF;
 END $$;ROLLBACK;`);
 console.log('READY_WORKER_NATIVE_NESTED_INSERT_FAULT_ROLLBACK_PASS');
}
if(process.argv.includes('--overlap')){
 function tx(name,query,hold=false){
  const flags=['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
  const child=process.platform==='win32'?spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_ready_capacity_ci','psql',...flags]):spawn('psql',flags);
  let out='',error='';child.stdin.on('error',()=>{});
  const result=new Promise(resolve=>{child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>error+=v);child.on('error',e=>resolve({code:-1,out,error:String(e)}));child.on('close',code=>resolve({code,out,error}));});
  const end=command=>{if(!child.stdin.writableEnded&&!child.stdin.destroyed)child.stdin.end(command+';\n');};
  child.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL idle_in_transaction_session_timeout='15s';${service}${query}\n`);
  if(!hold)end('COMMIT');return {result,end};
 }
 async function barrier(name,condition){for(let i=0;i<60;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition})`)==='t')return;await new Promise(r=>setTimeout(r,25));}assert.fail('missing actual overlap '+name);}
 for(const first of [0,1]){
  const c=seed(2),target=c.rows[0];
  const a=JSON.parse(sql(`SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE table_id='${target.table}' AND released_at IS NULL;`));
  const query=n=>`SELECT public.worker_perform_swing(p_table_id:='${target.table}',p_table_session_id:='${target.session}',p_assignment_id:='${a.id}',p_expected_version:=${a.version},p_next_attendance_id:='${c.rows[n].nextAttendance}');`;
  const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_assignments a WHERE club_id='${c.club}'),'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${c.club}'))::text);`);
  const before=fingerprint();let holder,waiter;
  try{
   holder=tx('ready103_holder',query(first),true);
   await barrier('ready103_holder',"wait_event='ClientRead' AND xact_start IS NOT NULL");
   waiter=tx('ready103_waiter',query(1-first));
   await barrier('ready103_waiter',"wait_event_type='Lock'");
   assert.equal(fingerprint(),before,'uncommitted swing remains invisible');
   holder.end('COMMIT');const h=await holder.result,w=await waiter.result;
   assert.equal(h.code,0,h.error);assert.equal(JSON.parse(h.out).outcome,'swung');
   assert.notEqual(w.code,0,'stale competing worker cannot succeed');assert.match(w.error,/SWING_ASSIGNMENT_CONTEXT_MISMATCH/);
   assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE club_id='${c.club}' AND released_at IS NULL AND status='assigned';`),'2');
   assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE club_id='${c.club}' AND released_at IS NOT NULL;`),'1');
   assert.equal(sql(`SELECT current_state FROM public.dealer_attendance WHERE id='${c.rows[1-first].nextAttendance}';`),'available');
   assert.equal(sql(`SELECT count(*) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${c.club}' AND a.current_state='in_transition';`),'0');
  }finally{holder?.end('ROLLBACK');waiter?.end('ROLLBACK');await Promise.all([holder?.result,waiter?.result]);}
 }
 console.log('READY_WORKER103_TWO_SESSION_BOTH_CANDIDATE_ORDERS_PASS');
 for(const closeFirst of [true,false]){
  const c=seed(1),t=c.rows[0];
  const a=JSON.parse(sql(`SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE table_id='${t.table}' AND released_at IS NULL;`));
  const revision=sql(`SELECT revision FROM public.table_sessions WHERE id='${t.session}';`);
  const close=`RESET ROLE;SET request.jwt.claim.role='authenticated';SET request.jwt.claim.sub='${c.owner}';SET request.jwt.claims='{"role":"authenticated","sub":"${c.owner}"}';SET ROLE authenticated;SELECT public.operator_close_club_table_v2('${t.session}',${revision},'${randomUUID()}');`;
  const write=`SELECT public.worker_perform_swing(p_table_id:='${t.table}',p_table_session_id:='${t.session}',p_assignment_id:='${a.id}',p_expected_version:=${a.version},p_next_attendance_id:='${t.nextAttendance}');`;
  let holder,waiter;
  try{
   holder=tx('ready103_close_holder',closeFirst?close:write,true);
   await barrier('ready103_close_holder',"wait_event='ClientRead' AND xact_start IS NOT NULL");
   waiter=tx('ready103_close_waiter',closeFirst?write:close);
   await barrier('ready103_close_waiter',"wait_event_type='Lock'");
   holder.end('COMMIT');const h=await holder.result,w=await waiter.result;
   assert.equal(h.code,0,h.error);
   if(closeFirst){assert.equal(JSON.parse(h.out).ok,true,h.out);assert.notEqual(w.code,0);assert.match(w.error,/SWING_ASSIGNMENT_CONTEXT_MISMATCH|TABLE_SESSION_STALE/);}
   else{assert.equal(JSON.parse(h.out).outcome,'swung');assert.equal(w.code,0,w.error);assert.equal(JSON.parse(w.out).ok,true,w.out);}
   assert.equal(sql(`SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id='${t.session}';`),'t');
   assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_id='${t.table}' AND released_at IS NULL;`),'0');
   assert.equal(sql(`SELECT count(*) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${c.club}' AND a.current_state IN ('assigned','in_transition');`),'0');
  }finally{holder?.end('ROLLBACK');waiter?.end('ROLLBACK');await Promise.all([holder?.result,waiter?.result]);}
 }
 console.log('READY_WORKER103_CANONICAL_CLOSE_BOTH_ORDER_OVERLAP_PASS');
}
const sizes=process.argv.includes('--negative')||process.argv.includes('--overlap')?[]:process.argv.includes('--small')?[2]:[2,10,40];
for(const size of sizes){const c=seed(size),start=Date.now();let count=0;
 for(const row of c.rows){const result=await dispatch(c.club,row.nextAttendance);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.outcome,'swung',JSON.stringify(result));count++;
  assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE id='${result.body.new_assignment_id}' AND club_id='${c.club}' AND table_id='${result.body.table_id}' AND released_at IS NULL AND attendance_id='${row.nextAttendance}';`),'1');
  const replay=await dispatch(c.club,row.nextAttendance);assert.equal(replay.status,200);assert.equal(replay.body.skipped,'state_changed');
  if(count%10===0)console.log(JSON.stringify({phase:size,completed:count}));
 }
 assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE club_id='${c.club}' AND status='assigned' AND released_at IS NULL;`),String(size));
 assert.equal(sql(`SELECT count(DISTINCT attendance_id)||'|'||count(DISTINCT table_session_id) FROM public.dealer_assignments WHERE club_id='${c.club}' AND status='assigned' AND released_at IS NULL;`),`${size}|${size}`);
 assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE club_id='${c.club}' AND released_at IS NOT NULL;`),String(size));
 assert.equal(sql(`SELECT count(*) FROM public.cron_metrics WHERE club_id='${c.club}' AND cron_name='process-swing-on-dealer-ready' AND status='success' AND processed_count=1;`),String(size));
 console.log(JSON.stringify({ready_capacity:size,actual_swings:count,replays:count,elapsed_ms:Date.now()-start,scope:'isolated-native-psql-not-HTTP'}));
}
console.log('READY_EDGE_NATIVE_CAPACITY_PASS');
