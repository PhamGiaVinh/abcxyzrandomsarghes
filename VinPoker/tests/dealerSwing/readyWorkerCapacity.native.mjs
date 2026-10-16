// Actual ready Edge + auth/inventory helpers + actual PG17 RPC/query effects.
// Replaces HTTP/PostgREST with guarded psql, not a deployed worker/cron proof.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {execFileSync,spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import {stripTypeScriptTypes} from 'node:module';import {runInNewContext} from 'node:vm';
import {getDealerOperationalTables} from '../../supabase/functions/_shared/dealerOperationalTables.ts';
import {authorizeInternalTrigger,authorizeSwingWorkerRequest,getIdempotencyKey,parseDealerReadyPayload} from '../../supabase/functions/_shared/internal-trigger-auth.ts';
import ts from 'typescript';
import {resolve,dirname} from 'node:path';import {pathToFileURL} from 'node:url';
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
if(process.argv.includes('--planner')||process.argv.includes('--main-worker')){
 const size=Number(process.argv.find(a=>a.startsWith('--planner-size='))?.split('=')[1]??2);assert.ok([2,10,40].includes(size));
 const resumeClub=process.argv.find(a=>a.startsWith('--main-resume-club='))?.split('=')[1];let fixture;
 if(resumeClub){assert.ok(process.argv.includes('--main-worker')&&process.argv.includes('--main-execute'));assert.match(resumeClub,/^[a-f0-9-]{36}$/);
  fixture=JSON.parse(sql(`SELECT jsonb_build_object('club',c.id,'owner',c.owner_id,'rows',(SELECT jsonb_agg(jsonb_build_object('table',r.table_id,'session',r.table_session_id,'oldAttendance',r.out_attendance_id,'nextAttendance',r.in_attendance_id) ORDER BY r.table_id) FROM (SELECT DISTINCT ON(s.table_id) s.table_id,a.table_session_id,s.out_attendance_id,s.in_attendance_id FROM public.dealer_rotation_schedule s JOIN public.dealer_assignments a ON a.id=s.assignment_id WHERE s.club_id=c.id AND s.slot_index=0 AND s.status IN ('announced','executing','executed') ORDER BY s.table_id,s.created_at,s.id) r),'resumeOriginals',(SELECT jsonb_agg(jsonb_build_object('schedule',r.id,'assignment',r.assignment_id,'table',r.table_id,'session',r.table_session_id,'incoming',r.in_attendance_id,'outgoing',r.out_attendance_id,'relief',r.planned_relief_at,'announce',r.announce_at) ORDER BY r.table_id) FROM (SELECT DISTINCT ON(s.table_id) s.*,a.table_session_id FROM public.dealer_rotation_schedule s JOIN public.dealer_assignments a ON a.id=s.assignment_id WHERE s.club_id=c.id AND s.slot_index=0 AND s.status IN ('announced','executing','executed') ORDER BY s.table_id,s.created_at,s.id) r)) FROM public.clubs c WHERE c.id='${resumeClub}' AND c.name='Ready capacity TEST ${size}';`));
  assert.ok(fixture);assert.equal(fixture.rows.length,size);assert.equal(fixture.resumeOriginals.length,size);
 }else fixture=seed(size);
 fixture.shortage=process.argv.includes('--planner-shortage');
 if(process.argv.includes('--main-worker')){
  // Schema-only bootstrap creates this matview WITH NO DATA. Initialize the
  // owned local read model so the actual concurrent refresh RPC can execute.
  sql('REFRESH MATERIALIZED VIEW public.dealer_pool_summary;');
  fixture.mainOff=process.argv.includes('--main-off');
  fixture.shortageScope=process.argv.includes('--main-shortage-scope');assert.ok(!(fixture.mainOff&&fixture.shortageScope));
  fixture.executeMain=process.argv.includes('--main-execute');assert.ok(!(fixture.executeMain&&(fixture.mainOff||fixture.shortageScope)));
  if(fixture.mainOff)sql(`UPDATE public.club_settings SET auto_swing_enabled=false WHERE club_id='${fixture.club}';`);
  if(!resumeClub)sql(`INSERT INTO public.swing_config(club_id,table_type,rotation_planner_enabled,swing_duration_minutes,break_duration_minutes,min_inter_swing_rest_minutes) VALUES('${fixture.club}','tournament',true,45,15,15) ON CONFLICT(club_id,table_type) DO UPDATE SET rotation_planner_enabled=true,swing_duration_minutes=45,break_duration_minutes=15,min_inter_swing_rest_minutes=15;`);
  const file=resolve('supabase/functions/process-swing/index.ts'),workerSource=readFileSync(file,'utf8'),tree=ts.createSourceFile(file,workerSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const imports=[];for(const statement of tree.statements){if(!ts.isImportDeclaration(statement)||statement.importClause?.isTypeOnly)continue;
   const module=statement.moduleSpecifier.text,clause=statement.importClause;assert.ok(clause&&!clause.name&&clause.namedBindings&&ts.isNamedImports(clause.namedBindings));
   const names=clause.namedBindings.elements.filter(e=>!e.isTypeOnly).map(e=>({local:e.name.text,exported:(e.propertyName??e.name).text}));
   if(module==='https://esm.sh/@supabase/supabase-js@2'){assert.deepEqual(names,[{local:'createClient',exported:'createClient'}]);continue;}
   imports.push({module:pathToFileURL(resolve(dirname(file),module)).href,names});
  }
  const noImports=ts.factory.updateSourceFile(tree,tree.statements.filter(s=>!ts.isImportDeclaration(s)));
  fixture.mainWorker={source:ts.transpileModule(ts.createPrinter().printFile(noImports),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,imports};
 }
 fixture.adopt=process.argv.includes('--planner-adopt');assert.ok(!(fixture.adopt&&fixture.shortage));
 fixture.fault=process.argv.find(a=>a.startsWith('--planner-fault='))?.split('=')[1];assert.ok(fixture.fault===undefined||['dealer-inventory','persist','lock'].includes(fixture.fault));assert.ok(!(fixture.shortage&&fixture.fault));
 assert.ok(!(fixture.adopt&&fixture.fault));
 assert.ok(!(fixture.executeMain&&(fixture.adopt||fixture.shortage)));
 assert.ok(!(fixture.executeMain&&fixture.fault));
 if(fixture.adopt)sql(service+fixture.rows.map(r=>`UPDATE public.dealer_attendance SET current_state='pre_assigned',pre_assigned_table_id='${r.table}',pre_assigned_at=now() WHERE id='${r.nextAttendance}';UPDATE public.dealer_assignments SET pre_assigned_attendance_id='${r.nextAttendance}',pre_assigned_at=now() WHERE table_id='${r.table}' AND released_at IS NULL;`).join('\n'));
 if(fixture.shortage)sql(service+`UPDATE public.dealer_attendance SET status='checked_out',check_out_time=now(),current_state='checked_out' WHERE id IN (${fixture.rows.map(r=>quote(r.nextAttendance)).join(',')});`);
 console.log('ACTUAL_PASSR_NATIVE_START '+size+(fixture.shortage?' shortage':''));
 let output;try{output=execFileSync('deno',['run','--cached-only','--no-config','--no-lock','--node-modules-dir=none','--deny-net','--allow-read=./supabase/functions,./tests/dealerSwing','--allow-env=PGHOST,PGPORT,PGUSER,PGDATABASE,PATH,SystemRoot,PASS15_RPC_TIMEOUT_MS,PASS15_MAX_PAIRS',`--allow-run=${process.platform==='win32'?'wsl':'psql'}`,'tests/dealerSwing/passR.native.mjs','--native'],{
  input:JSON.stringify({...fixture,role:testRole}),encoding:'utf8',timeout:fixture.executeMain?(size===40?600000:360000):120000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe'],env:{...process.env,PASS15_RPC_TIMEOUT_MS:'5000',PASS15_MAX_PAIRS:'10'},
 });}catch(e){console.log(String(e.stdout??'').split(/\r?\n/).filter(line=>line.startsWith('{"passR_actual_result"')).join('\n'));console.error(String(e.stderr??'').slice(-1400));throw new Error('actual PassR native qualification failed');}
 console.log(output.split(/\r?\n/).filter(line=>line.startsWith('{"passR_actual_result"')||line.startsWith('ACTUAL_PASSR_')).join('\n'));
}
if(process.argv.includes('--completion-auth')){
 const c=seed(1),t=c.rows[0],outsider=randomUUID();sql(`INSERT INTO auth.users(id) VALUES('${outsider}');`);
 const id=sql(`SELECT id FROM public.dealer_assignments WHERE table_id='${t.table}' AND released_at IS NULL;`);
 sql(`${service}UPDATE public.dealer_attendance SET current_state='pre_assigned',pre_assigned_table_id='${t.table}',pre_assigned_at=now() WHERE id='${t.nextAttendance}';UPDATE public.dealer_assignments SET pre_assigned_attendance_id='${t.nextAttendance}',pre_assigned_at=now() WHERE id='${id}';`);
 const version=sql(`SELECT version FROM public.dealer_assignments WHERE id='${id}';`);
 const adopted=JSON.parse(sql(service+`SELECT public.worker_adopt_legacy_preassignment_v1('${c.club}','${t.table}','${t.session}','${id}',${version},'${t.nextAttendance}','${randomUUID()}');`));assert.equal(adopted.outcome,'adopted');
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('assignment',(SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE id='${id}'),'schedule',(SELECT to_jsonb(s) FROM public.dealer_rotation_schedule s WHERE id='${adopted.schedule_id}'),'incoming',(SELECT to_jsonb(d) FROM public.dealer_attendance d WHERE id='${t.nextAttendance}'))::text);`);
 for(const actor of [{role:'anon',uid:null},{role:'authenticated',uid:outsider},{role:'authenticated',uid:c.owner},{role:'authenticated',uid:outsider,jwtRole:'service_role'}]){
  const before=fingerprint();let denied=false,receipt=null,insideStatus=null;
  try{
   const claims=JSON.stringify({role:actor.jwtRole??actor.role,...(actor.uid?{sub:actor.uid}:{})});
   const actorCheck=actor.uid?`DO $$ BEGIN IF auth.uid() IS DISTINCT FROM '${actor.uid}'::uuid THEN RAISE EXCEPTION 'completion_probe_actor_claim_missing';END IF;END $$;`:'';
   const output=sql(`BEGIN;SET LOCAL request.jwt.claim.role='${actor.jwtRole??actor.role}';SET LOCAL request.jwt.claim.sub='${actor.uid??''}';SET LOCAL request.jwt.claims='${claims}';SET LOCAL ROLE ${actor.role};${actorCheck}SELECT public.complete_rotation_slot('${adopted.schedule_id}',NULL);RESET ROLE;SELECT status FROM public.dealer_rotation_schedule WHERE id='${adopted.schedule_id}';ROLLBACK;`).split(/\r?\n/);
   receipt=JSON.parse(output[0]);insideStatus=output[1];denied=receipt.sqlstate==='42501';
  }catch(e){if(/ERROR:\s+42501:/.test(String(e.stderr??e)))denied=true;else throw e;}
  assert.equal(fingerprint(),before,'actor probe is fully rolled back');
  console.log(JSON.stringify({completion_auth:{role:actor.role,claimedRole:actor.jwtRole??actor.role,actor:actor.uid===c.owner?'owner':actor.uid?'outsider':'anonymous',denied,receipt,insideStatus,rolledBack:true}}));
  assert.equal(denied,true,'browser actors must not directly complete worker-owned rotation schedules');
 }
 const before=fingerprint();
 const positive=sql(`BEGIN;${service}SELECT public.complete_rotation_slot('${adopted.schedule_id}',NULL);SELECT public.complete_rotation_slot('${adopted.schedule_id}',NULL);ROLLBACK;`).split(/\r?\n/).map(line=>JSON.parse(line));assert.equal(positive[0].outcome,'executed');assert.equal(positive[1].outcome,'noop');assert.equal(fingerprint(),before);
 console.log('ROTATION_COMPLETION_BROWSER_DENY_SERVICE_POSITIVE_PASS');
}
if(process.argv.includes('--emergency-stale')){
 const c=seed(2),t=c.rows[0],replacement=c.rows[1].nextAttendance;
 const id=sql(`SELECT id FROM public.dealer_assignments WHERE table_id='${t.table}' AND released_at IS NULL;`);
 sql(`${service}UPDATE public.dealer_attendance SET current_state='pre_assigned',pre_assigned_table_id='${t.table}',pre_assigned_at=now() WHERE id='${t.nextAttendance}';
 UPDATE public.dealer_assignments SET pre_assigned_attendance_id='${t.nextAttendance}',pre_assigned_at=now() WHERE id='${id}';`);
 const fingerprint=()=>sql(`SELECT md5(to_jsonb(a)::text) FROM public.dealer_assignments a WHERE id='${id}';`);
 const raw=readFileSync('supabase/functions/process-swing/passes/passR-rotation-planner.ts','utf8'),entry=raw.slice(raw.indexOf('export async function replanSingleTable(')).replace('export async function','async function');
 const definitions=readFileSync('supabase/functions/_shared/pickNextDealer.ts','utf8'),first=definitions.indexOf('export class CandidateSnapshotFailure'),last=definitions.indexOf('function requireCandidateSnapshot',first);
 const failureCode=ts.transpileModule(definitions.slice(first,last).replaceAll('export ',''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const failures=new Function(failureCode+';return {CandidateSnapshotFailure,isCandidateSnapshotFailure};')();
 const replan=new Function('fetchTournamentInfo','buildRotationSupply','CandidateSnapshotFailure','isCandidateSnapshotFailure',stripTypeScriptTypes(entry)+';return replanSingleTable;')(
  async()=>({tournamentInfo:new Map(),rejectedTables:new Map()}),async()=>{throw new Error('test_boundary_after_clear');},failures.CandidateSnapshotFailure,failures.isCandidateSnapshotFailure);
 assert.equal(sql(`SELECT count(*) FROM public.table_sessions WHERE id='${t.session}' AND game_table_id='${t.table}' AND club_id='${c.club}' AND closed_at IS NULL AND session_type='cash';`),'1');
 let afterConcurrentLock=null;
 const admin={rpc:async(name,args)=>{
  assert.equal(name,'worker_prepare_emergency_replan_v1');
  // A different writer commits AFTER the snapshot and before RPC dispatch.
  sql(`${service}UPDATE public.dealer_attendance SET current_state='pre_assigned',pre_assigned_table_id='${t.table}',pre_assigned_at=now() WHERE id='${replacement}';
   UPDATE public.dealer_assignments SET pre_assigned_attendance_id='${replacement}',pre_assigned_at=now(),planned_relief_at=now()+interval '4 minutes' WHERE id='${id}';`);
  afterConcurrentLock=fingerprint();
  try{
   sql(service+`SELECT public.worker_prepare_emergency_replan_v1(${Object.entries(args).map(([k,v])=>column(k)+'=>'+(k==='p_schedule_ids'?quote('{'+v.join(',')+'}')+'::uuid[]':quote(v))).join(',')});`);
   assert.fail('stale RPC unexpectedly accepted');
  }catch(e){assert.match(String(e.stderr),/EMERGENCY_REPLAN_SNAPSHOT_CHANGED/);return {data:null,error:{message:'EMERGENCY_REPLAN_SNAPSHOT_CHANGED'}};}
 },from(table){assert.ok(['dealer_assignments','dealer_rotation_schedule'].includes(table));
  const q={select(){return q;},eq(){return q;},update(){assert.fail('split assignment write');},
   async in(){assert.equal(table,'dealer_rotation_schedule');return {data:JSON.parse(sql(service+`SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM public.dealer_rotation_schedule s WHERE assignment_id='${id}';`)),error:null};},
   async maybeSingle(){return {data:JSON.parse(sql(service+`SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE id='${id}';`)),error:null};},
  };return q;}};
 await assert.rejects(replan(admin,{clubId:c.club},id,new Set(),'race_lost'),e=>failures.isCandidateSnapshotFailure(e));
 assert.ok(afterConcurrentLock);assert.equal(fingerprint(),afterConcurrentLock,'late emergency request must not clear a newer incoming lock');
 console.log('EMERGENCY106_ACTUAL_PLANNER_NATIVE_STALE_LOCK_ZERO_DELTA_PASS');
 for(const mode of ['legacy','legacy-checked-out','scheduled','no_show','fault']){
  const f=seed(1),r=f.rows[0],assignment=sql(`SELECT id FROM public.dealer_assignments WHERE table_id='${r.table}' AND released_at IS NULL;`);
  sql(`${service}UPDATE public.dealer_attendance SET current_state='pre_assigned',pre_assigned_table_id='${r.table}',pre_assigned_at=now() WHERE id='${r.nextAttendance}';
   UPDATE public.dealer_assignments SET pre_assigned_attendance_id='${r.nextAttendance}',pre_assigned_at=now() WHERE id='${assignment}';`);
  if(mode==='legacy-checked-out')sql(service+`UPDATE public.dealer_attendance SET status='checked_out',check_out_time=now() WHERE id='${r.nextAttendance}';`);
  const slots=[];
  if(['scheduled','no_show','fault'].includes(mode)){
   const v=sql(`SELECT version FROM public.dealer_assignments WHERE id='${assignment}';`);
   const adopted=JSON.parse(sql(service+`SELECT public.worker_adopt_legacy_preassignment_v1('${f.club}','${r.table}','${r.session}','${assignment}',${v},'${r.nextAttendance}','${randomUUID()}');`));
   assert.equal(adopted.outcome,'adopted');slots.push(adopted.schedule_id);
  }
  let faultSlot=null;
  if(mode==='fault'){
   faultSlot='ffffffff-ffff-4fff-8fff-'+randomUUID().slice(-12);assert.ok(faultSlot>slots[0]);slots.push(faultSlot);
   sql(service+`INSERT INTO public.dealer_rotation_schedule(id,club_id,table_id,assignment_id,slot_index,out_attendance_id,in_attendance_id,planned_relief_at,status,is_shortage,plan_run_id,solver_version,reason)
    VALUES('${faultSlot}','${f.club}','${r.table}','${assignment}',1,'${r.oldAttendance}',NULL,now()+interval '30 minutes','predicted',true,'${randomUUID()}','native-emergency-test','{}');`);
  }
  const version=sql(`SELECT version FROM public.dealer_assignments WHERE id='${assignment}';`);
  const call=`SELECT public.worker_prepare_emergency_replan_v1('${f.club}','${r.table}','${r.session}','${assignment}',${version},'${r.nextAttendance}',${quote('{'+slots.sort().join(',')+'}')}::uuid[],'${mode==='no_show'?'no_show':'race_lost'}');`;
  const snapshot=()=>sql(`SELECT md5(jsonb_build_object('assignment',(SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE id='${assignment}'),'incoming',(SELECT to_jsonb(d) FROM public.dealer_attendance d WHERE id='${r.nextAttendance}'),'schedule',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.dealer_rotation_schedule s WHERE assignment_id='${assignment}'))::text);`);
  if(mode==='legacy'){
   const signature='public.worker_prepare_emergency_replan_v1(uuid,uuid,uuid,uuid,integer,uuid,uuid[],text)';
   assert.equal(sql(`SELECT has_function_privilege('anon','${signature}','EXECUTE') OR has_function_privilege('authenticated','${signature}','EXECUTE');`),'f');
   assert.equal(sql(`SELECT has_function_privilege('service_role','${signature}','EXECUTE');`),'t');
   const before=snapshot(),intent=[f.club,r.table,r.session,assignment,Number(version),r.nextAttendance,[],'race_lost'];
   const serialize=values=>values.map((v,i)=>i===6?quote('{'+v.join(',')+'}')+'::uuid[]':quote(v)).join(',');
   const repeatedId=randomUUID();
   for(const [index,value] of [[0,c.club],[1,t.table],[2,t.session],[3,id],[4,Number(version)+1],[5,replacement],[6,[randomUUID()]],[6,[repeatedId,repeatedId]],[7,'unsupported'],[2,null]]){
    const bad=[...intent];bad[index]=value;
    sql(service+`DO $$ BEGIN BEGIN PERFORM public.worker_prepare_emergency_replan_v1(${serialize(bad)});RAISE EXCEPTION 'negative accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;END $$;`);
    assert.equal(snapshot(),before);
   }
   sql(service+`SET request.jwt.claim.role='authenticated';SET request.jwt.claims='{"role":"authenticated"}';DO $$ BEGIN BEGIN PERFORM public.worker_prepare_emergency_replan_v1(${serialize(intent)});RAISE EXCEPTION 'role accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;`);
   assert.equal(snapshot(),before);
  }
  if(mode==='fault'){
   const before=snapshot();
   assert.throws(()=>sql(`BEGIN;CREATE FUNCTION pg_temp.reject_second_cancel() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'native_second_cancel_fault';END $$;
    CREATE TRIGGER native_second_cancel_fault BEFORE UPDATE ON public.dealer_rotation_schedule FOR EACH ROW WHEN (OLD.id='${faultSlot}'::uuid) EXECUTE FUNCTION pg_temp.reject_second_cancel();${service}${call}ROLLBACK;`),e=>/EMERGENCY_REPLAN_CANCEL_FAILED/.test(String(e.stderr)));
   assert.equal(snapshot(),before,'second cancellation error rolls back FIRST cancellation and both marker releases');
  }else{
   const result=JSON.parse(sql(service+call));assert.equal(result.outcome,'prepared');assert.deepEqual(result.schedule_ids,slots);assert.equal(result.cancelled_count,slots.length);
   assert.equal(result.expected_version,Number(version));assert.ok(result.assignment_version>=Number(version));
   assert.equal(sql(`SELECT pre_assigned_attendance_id IS NULL AND planned_relief_at IS NULL FROM public.dealer_assignments WHERE id='${assignment}';`),'t');
   assert.equal(sql(`SELECT current_state||'|'||(pre_assigned_table_id IS NULL)::text FROM public.dealer_attendance WHERE id='${r.nextAttendance}';`),`${mode==='legacy-checked-out'?'checked_out':'available'}|true`);
   if(slots.length)assert.equal(sql(`SELECT status FROM public.dealer_rotation_schedule WHERE id='${slots[0]}';`),mode==='no_show'?'no_show':'cancelled');
  }
 }
 console.log('EMERGENCY106_NATIVE_LEGACY_SCHEDULE_NO_SHOW_AND_MULTI_CANCEL_ROLLBACK_PASS');
}
if(process.argv.includes('--adoption')){
 const c=seed(1),r=c.rows[0];
 const id=sql(`SELECT id FROM public.dealer_assignments WHERE table_id='${r.table}' AND released_at IS NULL;`);
 sql(`${service}UPDATE public.dealer_attendance SET current_state='pre_assigned',pre_assigned_table_id='${r.table}',pre_assigned_at=now() WHERE id='${r.nextAttendance}';
 UPDATE public.dealer_assignments SET pre_assigned_attendance_id='${r.nextAttendance}',pre_assigned_at=now() WHERE id='${id}';`);
 const a=JSON.parse(sql(`SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE id='${id}';`));
 const snapshot=()=>sql(`SELECT md5(jsonb_build_object('assignment',(SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE id='${id}'),'schedule',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.dealer_rotation_schedule s WHERE club_id='${c.club}'))::text);`);
 const before=snapshot(),raw=readFileSync('supabase/functions/process-swing/passes/passR-rotation-planner.ts','utf8');
 const signature='public.worker_adopt_legacy_preassignment_v1(uuid,uuid,uuid,uuid,integer,uuid,uuid)';
 assert.equal(sql(`SELECT has_function_privilege('anon','${signature}','EXECUTE') OR has_function_privilege('authenticated','${signature}','EXECUTE');`),'f');
 assert.equal(sql(`SELECT has_function_privilege('service_role','${signature}','EXECUTE');`),'t');
 const foreign=seed(1),intent=[c.club,r.table,r.session,id,a.version,r.nextAttendance,randomUUID()];
 for(const [index,value] of [[0,foreign.club],[1,foreign.rows[0].table],[2,foreign.rows[0].session],[3,randomUUID()],[4,a.version+1],[2,null],[6,null]]){
  const bad=[...intent];bad[index]=value;
  sql(service+`DO $$ BEGIN BEGIN PERFORM public.worker_adopt_legacy_preassignment_v1(${bad.map(quote).join(',')});RAISE EXCEPTION 'negative accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;END $$;`);
  assert.equal(snapshot(),before);
 }
 sql(service+`SET request.jwt.claim.role='authenticated';SET request.jwt.claims='{"role":"authenticated"}';DO $$ BEGIN BEGIN PERFORM public.worker_adopt_legacy_preassignment_v1(${intent.map(quote).join(',')});RAISE EXCEPTION 'role accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;`);
 assert.equal(snapshot(),before);
 const first=raw.indexOf('async function reconcileAndAdopt('),last=raw.indexOf('// ─── Build solver inputs',first);
 const reconcile=new Function('console','ANNOUNCE_LEAD_MS',stripTypeScriptTypes(raw.slice(first,last))+';return reconcileAndAdopt;')(console,180000);
 const writes=[];let faultAdoption=true;
 const admin={rpc:async(name,args)=>{
  assert.equal(name,'worker_adopt_legacy_preassignment_v1');
  assert.deepEqual({...args,p_plan_run_id:undefined},{p_club_id:c.club,p_table_id:r.table,p_table_session_id:r.session,p_assignment_id:id,p_expected_version:a.version,p_incoming_attendance_id:r.nextAttendance,p_plan_run_id:undefined});
  const call=`SELECT public.worker_adopt_legacy_preassignment_v1(${Object.entries(args).map(([k,v])=>column(k)+'=>'+quote(v)).join(',')});`;
  try{
   const output=sql((faultAdoption?`BEGIN;CREATE FUNCTION pg_temp.reject_adoption_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'native_adoption_second_write_fault';END $$;
   CREATE TRIGGER native_adoption_second_write_fault BEFORE UPDATE ON public.dealer_assignments FOR EACH ROW WHEN (OLD.id='${id}'::uuid) EXECUTE FUNCTION pg_temp.reject_adoption_update();`:'')+service+call+(faultAdoption?'ROLLBACK;':''));
   return {data:JSON.parse(output),error:null};
  }catch(e){assert.match(String(e.stderr),/native_adoption_second_write_fault/);return {data:null,error:{message:'native_adoption_second_write_fault'}};}
 },from(table){
  assert.ok(['dealer_attendance','dealer_assignments','dealer_rotation_schedule'].includes(table));
  const q={select(){return q;},eq(){return q;},update(){writes.push(table);return q;},
   async in(k,values){assert.equal(table,'dealer_attendance');assert.equal(k,'id');return {data:JSON.parse(sql(service+`SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]') FROM public.dealer_attendance d WHERE id IN (${values.map(quote).join(',')});`)),error:null};},
   async insert(row){assert.equal(table,'dealer_rotation_schedule');writes.push(table);const keys=Object.keys(row).map(column);
    sql(service+`INSERT INTO public.dealer_rotation_schedule(${keys.join(',')}) SELECT ${keys.map(k=>'r.'+k).join(',')} FROM jsonb_populate_record(NULL::public.dealer_rotation_schedule,${quote(JSON.stringify(row))}::jsonb) r;`);return {data:null,error:null};},
   then(resolve,reject){return Promise.resolve({data:null,error:{message:'synthetic assignment-update transport failure'}}).then(resolve,reject);},
  };return q;}};
 await assert.rejects(reconcile(admin,{clubId:c.club},[a],[],randomUUID()),/rotation_legacy_adoption_unverified/);
 assert.equal(snapshot(),before,'second-write SQL fault rolls back inserted schedule');assert.deepEqual(writes,[]);
 faultAdoption=false;
 const result=await reconcile(admin,{clubId:c.club},[a],[],randomUUID());
 assert.equal(result.adopted,1);assert.equal(result.cancelled,0);
 assert.equal(sql(`SELECT count(*) FROM public.dealer_rotation_schedule s JOIN public.dealer_assignments a ON a.id=s.assignment_id WHERE a.id='${id}' AND s.status='announced' AND s.planned_relief_at=a.planned_relief_at;`),'1');
 const committed=snapshot();
 const replay=await reconcile(admin,{clubId:c.club},[a],[],randomUUID());
 assert.equal(replay.adopted,0);assert.equal(snapshot(),committed,'response-loss retry does not create another schedule or shift relief');
 const wrongVersion=[...intent];wrongVersion[4]=a.version+99;
 assert.equal(JSON.parse(sql(service+`SELECT public.worker_adopt_legacy_preassignment_v1(${wrongVersion.map(quote).join(',')});`)).outcome,'repair_required');
 assert.equal(snapshot(),committed,'different source version is not the committed adoption proof');
 console.log('LEGACY105_ACTUAL_PLANNER_NATIVE_ATOMIC_FAULT_POSITIVE_REPLAY_PASS');
}
if(process.argv.includes('--legacy')){
 const c=seed(1),r=c.rows[0];
 const a=JSON.parse(sql(`SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE table_id='${r.table}' AND released_at IS NULL;`));
 sql(`${service}UPDATE public.dealer_attendance SET current_state='pre_assigned',pre_assigned_table_id='${r.table}',pre_assigned_at=now() WHERE id='${r.nextAttendance}';
 UPDATE public.dealer_assignments SET pre_assigned_attendance_id='${r.nextAttendance}',pre_assigned_at=now(),planned_relief_at=now()+interval '3 minutes' WHERE id='${a.id}';
 UPDATE public.dealer_attendance SET status='checked_out',check_out_time=now() WHERE id='${r.nextAttendance}';`);
 const actual=JSON.parse(sql(`SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE id='${a.id}';`));
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('assignment',(SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE id='${a.id}'),'incoming',(SELECT to_jsonb(d) FROM public.dealer_attendance d WHERE id='${r.nextAttendance}'))::text);`);
 const before=fingerprint(),raw=readFileSync('supabase/functions/process-swing/passes/passR-rotation-planner.ts','utf8');
 const signature='public.worker_clear_legacy_preassignment_v1(uuid,uuid,uuid,uuid,integer,uuid)';
 assert.equal(sql(`SELECT has_function_privilege('anon','${signature}','EXECUTE') OR has_function_privilege('authenticated','${signature}','EXECUTE');`),'f');
 assert.equal(sql(`SELECT has_function_privilege('service_role','${signature}','EXECUTE');`),'t');
 const wrong=seed(1);
 const intent=[c.club,r.table,r.session,a.id,actual.version,r.nextAttendance];
 for(const [index,value] of [[0,wrong.club],[1,wrong.rows[0].table],[2,wrong.rows[0].session],[3,randomUUID()],[4,actual.version+1],[5,wrong.rows[0].nextAttendance],[2,null]]){
  const args=[...intent];args[index]=value;
  sql(service+`DO $$ BEGIN BEGIN PERFORM public.worker_clear_legacy_preassignment_v1(${args.map(quote).join(',')});RAISE EXCEPTION 'negative accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;END $$;`);
  assert.equal(fingerprint(),before,'invalid scope/version has zero effect');
 }
 sql(service+`SET request.jwt.claim.role='authenticated';SET request.jwt.claims='{"role":"authenticated"}';DO $$ BEGIN BEGIN PERFORM public.worker_clear_legacy_preassignment_v1(${intent.map(quote).join(',')});RAISE EXCEPTION 'role accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;`);
 assert.equal(fingerprint(),before);
 sql(`BEGIN;${service}UPDATE public.dealer_attendance SET status='checked_in',check_out_time=NULL WHERE id='${r.nextAttendance}';
 DO $$ DECLARE result jsonb;BEGIN result:=public.worker_clear_legacy_preassignment_v1(${intent.map(quote).join(',')});
 IF result->>'outcome' IS DISTINCT FROM 'legacy_lock_valid' OR NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='${a.id}' AND pre_assigned_attendance_id='${r.nextAttendance}') THEN RAISE EXCEPTION 'valid_legacy_lock_changed';END IF;END $$;ROLLBACK;`);
 sql(`BEGIN;${service}INSERT INTO public.dealer_rotation_schedule(club_id,table_id,assignment_id,slot_index,out_attendance_id,in_attendance_id,planned_relief_at,status,is_shortage,plan_run_id,solver_version,reason)
 VALUES('${c.club}','${r.table}','${a.id}',0,'${r.oldAttendance}',NULL,now()+interval '3 minutes','predicted',true,'${randomUUID()}','legacy104-native-test','{}');
 DO $$ DECLARE result jsonb;BEGIN result:=public.worker_clear_legacy_preassignment_v1(${intent.map(quote).join(',')});
 IF result->>'outcome' IS DISTINCT FROM 'repair_required' OR NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='${a.id}' AND pre_assigned_attendance_id='${r.nextAttendance}') THEN RAISE EXCEPTION 'scheduled_legacy_lock_changed';END IF;END $$;ROLLBACK;`);
 assert.equal(fingerprint(),before);
 const first=raw.indexOf('async function reconcileAndAdopt('),last=raw.indexOf('// ─── Build solver inputs',first);assert.ok(first>0&&last>first);
 const reconcile=new Function('console','ANNOUNCE_LEAD_MS',stripTypeScriptTypes(raw.slice(first,last))+';return reconcileAndAdopt;')(console,180000);
 const writes=[];let faultCleanup=true;
 const admin={rpc:async(name,args)=>{
  assert.equal(name,'worker_clear_legacy_preassignment_v1');
  assert.deepEqual(args,{p_club_id:c.club,p_table_id:r.table,p_table_session_id:r.session,p_assignment_id:a.id,p_expected_version:actual.version,p_incoming_attendance_id:r.nextAttendance});
  const call=`SELECT public.worker_clear_legacy_preassignment_v1(${Object.entries(args).map(([k,v])=>column(k)+'=>'+quote(v)).join(',')});`;
  try{
   const output=sql((faultCleanup?`BEGIN;CREATE FUNCTION pg_temp.reject_legacy_clear() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'native_legacy_second_write_fault';END $$;
   CREATE TRIGGER native_legacy_second_write_fault BEFORE UPDATE ON public.dealer_attendance FOR EACH ROW WHEN (OLD.id='${r.nextAttendance}'::uuid) EXECUTE FUNCTION pg_temp.reject_legacy_clear();`: '')+service+call+(faultCleanup?'ROLLBACK;':''));
   return {data:JSON.parse(output),error:null};
  }catch(e){assert.match(String(e.stderr),/native_legacy_second_write_fault/);return {data:null,error:{message:'native_legacy_second_write_fault'}};}
 },from(table){assert.ok(['dealer_attendance','dealer_assignments'].includes(table));let patch=null,where=[];
  const q={select(){return q;},update(value){patch=value;return q;},eq(k,v){where.push(`${column(k)}=${quote(v)}`);return q;},
   async in(k,values){assert.equal(table,'dealer_attendance');assert.equal(k,'id');return {data:JSON.parse(sql(service+`SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]') FROM public.dealer_attendance d WHERE id IN (${values.map(quote).join(',')});`)),error:null};},
   then(resolve,reject){const perform=async()=>{assert.ok(patch);writes.push(table);
    // Fault the SECOND request before DB dispatch; the first is a real COMMIT.
    if(table==='dealer_attendance')return {data:null,error:{message:'synthetic second-request transport failure'}};
    sql(service+`UPDATE public.${table} SET ${Object.entries(patch).map(([k,v])=>column(k)+'='+quote(v)).join(',')} WHERE ${where.join(' AND ')};`);return {data:null,error:null};};return perform().then(resolve,reject);},
  };return q;}};
 await assert.rejects(reconcile(admin,{clubId:c.club},[actual],[],randomUUID()),/rotation_legacy_cleanup_unverified/);
 assert.equal(fingerprint(),before,'second-write SQL fault rolls back the first assignment write');
 assert.deepEqual(writes,[],'planner no longer sends split table writes');
 faultCleanup=false;
 const result=await reconcile(admin,{clubId:c.club},[actual],[],randomUUID());
 assert.equal(result.cancelled,1);assert.equal(result.adopted,0);
 assert.equal(sql(`SELECT pre_assigned_attendance_id IS NULL FROM public.dealer_assignments WHERE id='${a.id}';`),'t');
 assert.equal(sql(`SELECT current_state||'|'||(pre_assigned_table_id IS NULL)::text FROM public.dealer_attendance WHERE id='${r.nextAttendance}';`),'checked_out|true');
 const after=fingerprint();
 sql(service+`DO $$ BEGIN BEGIN PERFORM public.worker_clear_legacy_preassignment_v1(${intent.map(quote).join(',')});RAISE EXCEPTION 'stale retry accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;END $$;`);
 assert.equal(fingerprint(),after,'stale retry cannot release a new lifecycle');
 console.log('LEGACY104_ACTUAL_PLANNER_NATIVE_ATOMIC_FAULT_AND_POSITIVE_PASS');
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
 // Verify the cancellation contract used by PassR against the actual catalog,
 // including its atomic response when the schedule update itself fails.
 const cancellation=seed(1),cr=cancellation.rows[0],slot=randomUUID();
 const ca=JSON.parse(sql(`SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE table_id='${cr.table}' AND released_at IS NULL;`));
 const cancelSetup=`UPDATE public.dealer_attendance SET current_state='pre_assigned',pre_assigned_table_id='${cr.table}',pre_assigned_at=now() WHERE id='${cr.nextAttendance}';
 UPDATE public.dealer_assignments SET pre_assigned_attendance_id='${cr.nextAttendance}',pre_assigned_at=now(),planned_relief_at=now()+interval '3 minutes' WHERE id='${ca.id}';
 INSERT INTO public.dealer_rotation_schedule(id,club_id,table_id,assignment_id,slot_index,out_attendance_id,in_attendance_id,planned_relief_at,announce_at,status,is_shortage,is_emergency,plan_run_id,solver_version,reason)
 VALUES('${slot}','${cancellation.club}','${cr.table}','${ca.id}',0,'${cr.oldAttendance}','${cr.nextAttendance}',now()+interval '3 minutes',now(),'announced',false,false,'${randomUUID()}','native-contract-test','{}');`;
 for(const inject of [false,true]){
  sql(`BEGIN;${service}${cancelSetup}RESET ROLE;
  ${inject?`CREATE FUNCTION pg_temp.reject_cancel_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'native_cancel_update_fault';END $$;
  CREATE TRIGGER native_cancel_update_fault BEFORE UPDATE ON public.dealer_rotation_schedule FOR EACH ROW WHEN (OLD.id='${slot}'::uuid) EXECUTE FUNCTION pg_temp.reject_cancel_update();`:''}
  ${service} DO $$ DECLARE result jsonb;BEGIN
  result:=public.cancel_rotation_slot('${slot}','reconcile_lock_lost');
  IF ${inject?'true':'false'} THEN
   IF result->>'outcome' IS DISTINCT FROM 'error' OR result->>'detail' IS DISTINCT FROM 'native_cancel_update_fault' THEN RAISE EXCEPTION 'wrong_cancel_fault:%',result;END IF;
   IF NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='${ca.id}' AND pre_assigned_attendance_id='${cr.nextAttendance}')
    OR NOT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='${cr.nextAttendance}' AND current_state='pre_assigned')
    OR NOT EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE id='${slot}' AND status='announced') THEN RAISE EXCEPTION 'cancel_fault_partial_write';END IF;
  ELSE
   IF result->>'outcome' IS DISTINCT FROM 'cancelled' OR result->>'schedule_id' IS DISTINCT FROM '${slot}' THEN RAISE EXCEPTION 'wrong_cancel_contract:%',result;END IF;
   IF NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='${ca.id}' AND pre_assigned_attendance_id IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='${cr.nextAttendance}' AND current_state='available' AND pre_assigned_table_id IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE id='${slot}' AND status='cancelled') THEN RAISE EXCEPTION 'cancel_positive_postcondition';END IF;
   result:=public.cancel_rotation_slot('${slot}','reconcile_lock_lost');
   IF result->>'outcome' IS DISTINCT FROM 'noop' THEN RAISE EXCEPTION 'cancel_replay_contract';END IF;
  END IF;END $$;ROLLBACK;`);
 }
 console.log('READY_NATIVE_CANCEL_CONTRACT_AND_INNER_FAULT_ATOMICITY_PASS');
}
if(process.argv.includes('--overlap')||process.argv.includes('--anchor-overlap')){
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
 if(process.argv.includes('--anchor-overlap')){
 for(const order of ['duplicate','cancel-first','persist-first-cancel','close-first','persist-first-close','version-first']){
  const c=seed(1),t=c.rows[0],id=sql(`SELECT id FROM public.dealer_assignments WHERE table_id='${t.table}' AND released_at IS NULL;`);
  sql(`${service}UPDATE public.dealer_attendance SET current_state='pre_assigned',pre_assigned_table_id='${t.table}',pre_assigned_at=now() WHERE id='${t.nextAttendance}';
   UPDATE public.dealer_assignments SET pre_assigned_attendance_id='${t.nextAttendance}',pre_assigned_at=now() WHERE id='${id}';`);
  const version=sql(`SELECT version FROM public.dealer_assignments WHERE id='${id}';`);
  const adopted=JSON.parse(sql(service+`SELECT public.worker_adopt_legacy_preassignment_v1('${c.club}','${t.table}','${t.session}','${id}',${version},'${t.nextAttendance}','${randomUUID()}');`));assert.equal(adopted.outcome,'adopted');
  const locked=JSON.parse(sql(`SELECT to_jsonb(s) FROM public.dealer_rotation_schedule s WHERE id='${adopted.schedule_id}';`));
  const rows=[{table_id:t.table,assignment_id:id,table_session_id:t.session,slot_index:0,out_attendance_id:t.oldAttendance,in_attendance_id:t.nextAttendance,planned_relief_at:locked.planned_relief_at,announce_at:locked.announce_at,locked_anchor:true,locked_schedule_id:locked.id,locked_schedule_version:locked.version,is_shortage:false,is_emergency:false,solver_version:'native-anchor107'},
   {table_id:t.table,assignment_id:null,slot_index:1,out_attendance_id:t.nextAttendance,in_attendance_id:null,planned_relief_at:new Date(Date.parse(locked.planned_relief_at)+45*60000).toISOString(),is_shortage:true,is_emergency:false,solver_version:'native-anchor107'}];
  const persist=`SELECT public.upsert_rotation_plan('${c.club}','${randomUUID()}',${quote(JSON.stringify(rows))}::jsonb,ARRAY['${t.table}'::uuid]);`;
  const cancel=`SELECT public.cancel_rotation_slot('${locked.id}','reconcile_lock_lost');`;
  const revision=sql(`SELECT revision FROM public.table_sessions WHERE id='${t.session}';`);
  const close=`RESET ROLE;SET request.jwt.claim.role='authenticated';SET request.jwt.claim.sub='${c.owner}';SET request.jwt.claims='{"role":"authenticated","sub":"${c.owner}"}';SET ROLE authenticated;SELECT public.operator_close_club_table_v2('${t.session}',${revision},'${randomUUID()}');`;
  const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_assignments a WHERE club_id='${c.club}'),'schedule',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.dealer_rotation_schedule s WHERE club_id='${c.club}'),'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.table_sessions s WHERE club_id='${c.club}'),'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${c.club}'))::text);`);
  const before=fingerprint();let holder,waiter;
  const lastJson=out=>JSON.parse(out.trim().split(/\r?\n/).at(-1));
  try{
   const scheduleFirst=order==='cancel-first'||order==='version-first';
   holder=tx('anchor107_holder',scheduleFirst?`SELECT id FROM public.dealer_rotation_schedule WHERE id='${locked.id}' FOR UPDATE;`:order==='close-first'?close:persist,true);
   await barrier('anchor107_holder',"wait_event='ClientRead' AND xact_start IS NOT NULL");
   waiter=tx('anchor107_waiter',order==='persist-first-cancel'?cancel:order==='persist-first-close'?close:persist);
   await barrier('anchor107_waiter',"wait_event_type='Lock'");
   assert.equal(fingerprint(),before,'uncommitted overlap is invisible');
   if(scheduleFirst)sql(`BEGIN;SELECT id FROM public.dealer_assignments WHERE id='${id}' FOR UPDATE NOWAIT;ROLLBACK;`);
   holder.end(order==='cancel-first'?cancel+'COMMIT':order==='version-first'?`UPDATE public.dealer_rotation_schedule SET version=version+1 WHERE id='${locked.id}';COMMIT`:'COMMIT');
   const h=await holder.result,w=await waiter.result;assert.equal(h.code,0,h.error);assert.equal(w.code,0,w.error);
   if(['cancel-first','close-first','version-first'].includes(order)){
    assert.equal(lastJson(w.out).outcome,'ok');assert.deepEqual(lastJson(w.out).rejected_table_ids,[t.table]);
    assert.equal(sql(`SELECT count(*) FROM public.dealer_rotation_schedule WHERE club_id='${c.club}' AND slot_index=1;`),'0');
   }else{
    assert.equal(lastJson(h.out).outcome,'ok');assert.deepEqual(lastJson(h.out).rejected_table_ids,[]);
    if(order==='duplicate'){assert.deepEqual(lastJson(w.out).rejected_table_ids,[]);assert.equal(lastJson(w.out).unchanged,1);}
    if(order==='persist-first-cancel')assert.equal(lastJson(w.out).outcome,'cancelled');
    if(order==='persist-first-close')assert.equal(lastJson(w.out).ok,true);
   }
   if(order.includes('close')){
    assert.equal(sql(`SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id='${t.session}';`),'t');
    assert.equal(sql(`SELECT count(*) FROM public.dealer_rotation_schedule WHERE club_id='${c.club}' AND status IN ('predicted','announced','executing');`),'0','close must cancel forecast rows with NULL assignment too');
   }else if(order==='duplicate'){
    assert.equal(sql(`SELECT count(*) FROM public.dealer_rotation_schedule WHERE club_id='${c.club}' AND slot_index=1 AND status='predicted';`),'1');
    assert.equal(sql(`SELECT planned_relief_at=${quote(locked.planned_relief_at)}::timestamptz FROM public.dealer_rotation_schedule WHERE id='${locked.id}';`),'t');
   }
   if(order!=='duplicate'){
    const committed=fingerprint(),stale=JSON.parse(sql(service+persist));assert.deepEqual(stale.rejected_table_ids,[t.table]);assert.equal(fingerprint(),committed,'late stale plan cannot alter committed winner state');
   }
  }finally{holder?.end('ROLLBACK');waiter?.end('ROLLBACK');await Promise.all([holder?.result,waiter?.result]);}
 }
 console.log('ANCHOR107_DUPLICATE_CANCEL_CLOSE_VERSION_BOTH_ORDER_OVERLAP_PASS');
 }else{
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
 for(const order of ['duplicate','off-first','cleanup-first']){
  const c=seed(1),t=c.rows[0];
  const a=JSON.parse(sql(`SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE table_id='${t.table}' AND released_at IS NULL;`));
  sql(`${service}UPDATE public.dealer_attendance SET current_state='pre_assigned',pre_assigned_table_id='${t.table}',pre_assigned_at=now() WHERE id='${t.nextAttendance}';
   UPDATE public.dealer_assignments SET pre_assigned_attendance_id='${t.nextAttendance}',pre_assigned_at=now(),planned_relief_at=now()+interval '3 minutes' WHERE id='${a.id}';
   UPDATE public.dealer_attendance SET status='checked_out',check_out_time=now() WHERE id='${t.nextAttendance}';`);
  const version=sql(`SELECT version FROM public.dealer_assignments WHERE id='${a.id}';`);
  const clear=`SELECT public.worker_clear_legacy_preassignment_v1('${c.club}','${t.table}','${t.session}','${a.id}',${version},'${t.nextAttendance}');`;
  const off=`RESET ROLE;UPDATE public.club_settings SET auto_swing_enabled=false WHERE club_id='${c.club}';`;
  const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('assignment',(SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE id='${a.id}'),'incoming',(SELECT to_jsonb(d) FROM public.dealer_attendance d WHERE id='${t.nextAttendance}'))::text);`);
  const before=fingerprint();let holder,waiter;
  try{
   holder=tx('legacy104_holder',order==='off-first'?off:clear,true);
   await barrier('legacy104_holder',"wait_event='ClientRead' AND xact_start IS NOT NULL");
   waiter=tx('legacy104_waiter',order==='cleanup-first'?off:clear);
   await barrier('legacy104_waiter',"wait_event_type='Lock'");
   assert.equal(fingerprint(),before,'cleanup is invisible before commit');
   holder.end('COMMIT');const h=await holder.result,w=await waiter.result;
   assert.equal(h.code,0,h.error);
   if(order==='off-first'){
    assert.notEqual(w.code,0);assert.match(w.error,/AUTO_SWING_OFF/);assert.equal(fingerprint(),before);
   }else{
    assert.equal(JSON.parse(h.out).outcome,'cleared');
    if(order==='duplicate'){assert.notEqual(w.code,0);assert.match(w.error,/LEGACY_PREASSIGN_SNAPSHOT_CHANGED/);}
    else assert.equal(w.code,0,w.error);
    assert.equal(sql(`SELECT pre_assigned_attendance_id IS NULL FROM public.dealer_assignments WHERE id='${a.id}';`),'t');
    assert.equal(sql(`SELECT current_state||'|'||(pre_assigned_table_id IS NULL)::text FROM public.dealer_attendance WHERE id='${t.nextAttendance}';`),'checked_out|true');
   }
   if(order!=='duplicate')assert.equal(sql(`SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${c.club}';`),'f');
   assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_id='${t.table}';`),'1');
  }finally{holder?.end('ROLLBACK');waiter?.end('ROLLBACK');await Promise.all([holder?.result,waiter?.result]);}
 }
 console.log('LEGACY104_DUPLICATE_AND_OFF_BOTH_ORDER_OVERLAP_PASS');
 for(const order of ['duplicate','off-first','adoption-first-off','close-first','adoption-first-close']){
  const c=seed(1),t=c.rows[0];
  const id=sql(`SELECT id FROM public.dealer_assignments WHERE table_id='${t.table}' AND released_at IS NULL;`);
  sql(`${service}UPDATE public.dealer_attendance SET current_state='pre_assigned',pre_assigned_table_id='${t.table}',pre_assigned_at=now() WHERE id='${t.nextAttendance}';
   UPDATE public.dealer_assignments SET pre_assigned_attendance_id='${t.nextAttendance}',pre_assigned_at=now() WHERE id='${id}';`);
  const version=sql(`SELECT version FROM public.dealer_assignments WHERE id='${id}';`),revision=sql(`SELECT revision FROM public.table_sessions WHERE id='${t.session}';`);
  const adopt=`SELECT public.worker_adopt_legacy_preassignment_v1('${c.club}','${t.table}','${t.session}','${id}',${version},'${t.nextAttendance}','${randomUUID()}');`;
  const off=`RESET ROLE;UPDATE public.club_settings SET auto_swing_enabled=false WHERE club_id='${c.club}';`;
  const close=`RESET ROLE;SET request.jwt.claim.role='authenticated';SET request.jwt.claim.sub='${c.owner}';SET request.jwt.claims='{"role":"authenticated","sub":"${c.owner}"}';SET ROLE authenticated;SELECT public.operator_close_club_table_v2('${t.session}',${revision},'${randomUUID()}');`;
  const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('assignment',(SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE id='${id}'),'schedule',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.dealer_rotation_schedule s WHERE assignment_id='${id}'),'incoming',(SELECT to_jsonb(d) FROM public.dealer_attendance d WHERE id='${t.nextAttendance}'))::text);`);
  const before=fingerprint();let holder,waiter;
  try{
   holder=tx('adoption105_holder',order==='off-first'?off:order==='close-first'?close:adopt,true);
   await barrier('adoption105_holder',"wait_event='ClientRead' AND xact_start IS NOT NULL");
   waiter=tx('adoption105_waiter',order==='adoption-first-off'?off:order==='adoption-first-close'?close:adopt);
   await barrier('adoption105_waiter',"wait_event_type='Lock'");
   assert.equal(fingerprint(),before,'adoption/close invisible until commit');
   holder.end('COMMIT');const h=await holder.result,w=await waiter.result;
   assert.equal(h.code,0,h.error);
   if(order==='off-first'){
    assert.notEqual(w.code,0);assert.match(w.error,/AUTO_SWING_OFF/);assert.equal(fingerprint(),before);
   }else if(order==='close-first'){
    assert.equal(JSON.parse(h.out).ok,true,h.out);assert.notEqual(w.code,0);assert.match(w.error,/LEGACY_ADOPTION_SESSION_CHANGED/);
   }else{
    const adopted=JSON.parse(h.out);assert.equal(adopted.outcome,'adopted');assert.equal(w.code,0,w.error);
    if(order==='duplicate'){
     const replay=JSON.parse(w.out);assert.equal(replay.outcome,'already_adopted');assert.equal(replay.schedule_id,adopted.schedule_id);assert.equal(replay.planned_relief_at,adopted.planned_relief_at);
    }else if(order==='adoption-first-close')assert.equal(JSON.parse(w.out).ok,true,w.out);
   }
   if(order.includes('close')){
    assert.equal(sql(`SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id='${t.session}';`),'t');
    assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_id='${t.table}' AND released_at IS NULL;`),'0');
    assert.equal(sql(`SELECT count(*) FROM public.dealer_rotation_schedule WHERE assignment_id='${id}' AND status IN ('predicted','announced','executing');`),'0');
    assert.equal(sql(`SELECT current_state||'|'||(pre_assigned_table_id IS NULL)::text FROM public.dealer_attendance WHERE id='${t.nextAttendance}';`),'available|true');
   }else if(order!=='off-first')assert.equal(sql(`SELECT count(*) FROM public.dealer_rotation_schedule s JOIN public.dealer_assignments a ON a.id=s.assignment_id WHERE a.id='${id}' AND s.status='announced' AND s.planned_relief_at=a.planned_relief_at;`),'1');
   if(order.includes('off'))assert.equal(sql(`SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${c.club}';`),'f');
  }finally{holder?.end('ROLLBACK');waiter?.end('ROLLBACK');await Promise.all([holder?.result,waiter?.result]);}
 }
 console.log('LEGACY105_DUPLICATE_OFF_CLOSE_BOTH_ORDER_OVERLAP_PASS');
 for(const order of ['duplicate','raw-first','prepare-first-raw','off-first','prepare-first-off','close-first','prepare-first-close']){
  const c=seed(1),t=c.rows[0],id=sql(`SELECT id FROM public.dealer_assignments WHERE table_id='${t.table}' AND released_at IS NULL;`);
  sql(`${service}UPDATE public.dealer_attendance SET current_state='pre_assigned',pre_assigned_table_id='${t.table}',pre_assigned_at=now() WHERE id='${t.nextAttendance}';
   UPDATE public.dealer_assignments SET pre_assigned_attendance_id='${t.nextAttendance}',pre_assigned_at=now() WHERE id='${id}';`);
  const initialVersion=sql(`SELECT version FROM public.dealer_assignments WHERE id='${id}';`);
  const adopted=JSON.parse(sql(service+`SELECT public.worker_adopt_legacy_preassignment_v1('${c.club}','${t.table}','${t.session}','${id}',${initialVersion},'${t.nextAttendance}','${randomUUID()}');`));
  assert.equal(adopted.outcome,'adopted');
  const version=sql(`SELECT version FROM public.dealer_assignments WHERE id='${id}';`),revision=sql(`SELECT revision FROM public.table_sessions WHERE id='${t.session}';`);
  const prepare=`SELECT public.worker_prepare_emergency_replan_v1('${c.club}','${t.table}','${t.session}','${id}',${version},'${t.nextAttendance}',ARRAY['${adopted.schedule_id}'::uuid],'race_lost');`;
  const raw=`SELECT public.cancel_rotation_slot('${adopted.schedule_id}','race_lost');`;
  const off=`RESET ROLE;UPDATE public.club_settings SET auto_swing_enabled=false WHERE club_id='${c.club}';`;
  const close=`RESET ROLE;SET request.jwt.claim.role='authenticated';SET request.jwt.claim.sub='${c.owner}';SET request.jwt.claims='{"role":"authenticated","sub":"${c.owner}"}';SET ROLE authenticated;SELECT public.operator_close_club_table_v2('${t.session}',${revision},'${randomUUID()}');`;
  const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('assignment',(SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE id='${id}'),'schedule',(SELECT to_jsonb(s) FROM public.dealer_rotation_schedule s WHERE id='${adopted.schedule_id}'),'incoming',(SELECT to_jsonb(d) FROM public.dealer_attendance d WHERE id='${t.nextAttendance}'))::text);`);
  const before=fingerprint();let holder,waiter;
  try{
   const first=order==='raw-first'?`SELECT 1 FROM public.dealer_rotation_schedule WHERE id='${adopted.schedule_id}' FOR UPDATE;`:order==='off-first'?off:order==='close-first'?close:prepare;
   holder=tx('emergency106_holder',first,true);
   await barrier('emergency106_holder',"wait_event='ClientRead' AND xact_start IS NOT NULL");
   waiter=tx('emergency106_waiter',order==='prepare-first-raw'?raw:order==='prepare-first-off'?off:order==='prepare-first-close'?close:prepare);
   await barrier('emergency106_waiter',"wait_event_type='Lock'");
   assert.equal(fingerprint(),before,'preparation is invisible until commit');
   if(order==='raw-first'){
    // While preparation waits on the raw caller's schedule lock, it MUST NOT
    // hold assignment yet; otherwise raw cancel's next UPDATE deadlocks.
    sql(`BEGIN;SELECT id FROM public.dealer_assignments WHERE id='${id}' FOR UPDATE NOWAIT;ROLLBACK;`);
   }
   holder.end(order==='raw-first'?raw+'COMMIT':'COMMIT');const h=await holder.result,w=await waiter.result;
   assert.equal(h.code,0,h.error);
   const lastJson=out=>JSON.parse(out.trim().split(/\r?\n/).at(-1));
   if(order==='off-first'){
    assert.notEqual(w.code,0);assert.match(w.error,/AUTO_SWING_OFF/);assert.equal(fingerprint(),before);
   }else if(order==='raw-first'){
    assert.equal(lastJson(h.out).outcome,'cancelled');assert.notEqual(w.code,0);assert.match(w.error,/EMERGENCY_REPLAN_SCHEDULE_CHANGED|EMERGENCY_REPLAN_SNAPSHOT_CHANGED/);
   }else if(order==='close-first'){
    assert.equal(lastJson(h.out).ok,true);assert.notEqual(w.code,0);assert.match(w.error,/EMERGENCY_REPLAN_SESSION_CHANGED/);
   }else{
    assert.equal(lastJson(h.out).outcome,'prepared');
    if(order==='duplicate'){assert.notEqual(w.code,0);assert.match(w.error,/EMERGENCY_REPLAN_SCHEDULE_CHANGED|EMERGENCY_REPLAN_SNAPSHOT_CHANGED/);}
    else{assert.equal(w.code,0,w.error);if(order==='prepare-first-raw')assert.equal(lastJson(w.out).outcome,'noop');if(order==='prepare-first-close')assert.equal(lastJson(w.out).ok,true);}
   }
   if(order!=='off-first'){
    assert.equal(sql(`SELECT count(*) FROM public.dealer_rotation_schedule WHERE assignment_id='${id}' AND status IN ('predicted','announced','executing');`),'0');
    assert.equal(sql(`SELECT pre_assigned_attendance_id IS NULL FROM public.dealer_assignments WHERE id='${id}';`),'t');
    assert.equal(sql(`SELECT current_state||'|'||(pre_assigned_table_id IS NULL)::text FROM public.dealer_attendance WHERE id='${t.nextAttendance}';`),'available|true');
   }
   if(order.includes('close'))assert.equal(sql(`SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id='${t.session}';`),'t');
   if(order.includes('off'))assert.equal(sql(`SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${c.club}';`),'f');
  }finally{holder?.end('ROLLBACK');waiter?.end('ROLLBACK');await Promise.all([holder?.result,waiter?.result]);}
 }
 console.log('EMERGENCY106_DUPLICATE_RAW_CANCEL_OFF_CLOSE_OVERLAP_AND_LOCK_ORDER_PASS');
 }
}
const sizes=['--negative','--overlap','--anchor-overlap','--completion-auth','--legacy','--adoption','--emergency-stale','--planner','--main-worker'].some(flag=>process.argv.includes(flag))?[]:process.argv.includes('--small')?[2]:[2,10,40];
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
