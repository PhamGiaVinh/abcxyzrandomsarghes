import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {authorizeInternalTrigger,authorizeSwingWorkerRequest,getIdempotencyKey,parseDealerReadyPayload} from '../../supabase/functions/_shared/internal-trigger-auth.ts';
import {getDealerOperationalTables} from '../../supabase/functions/_shared/dealerOperationalTables.ts';
import {getReadySwingDuration,getReadyRestThreshold} from '../../supabase/functions/_shared/readySwingDuration.ts';
import {loadEligibleDealerAttendance} from '../../supabase/functions/_shared/dealerPoolEligibility.ts';
import {fillEmptyTables} from '../../supabase/functions/_shared/fillEmptyTables.ts';
import {createPaidJourneyFixture} from '../cashier/paidJourney.fixture.mjs';

// Actual fill + picker + SQL writes. Only Auth/PostgREST transport is modeled.
// No date override, shortened rest, production connection or external delivery.
export async function runCanonicalFillNative(sql) {
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 assert.equal(sql("SELECT host(inet_server_addr())||'|'||inet_server_port();"),'127.0.0.1|55441');
 const tableCount=process.argv.includes('--canonical-fill-40')?40:2;
 const f=createPaidJourneyFixture(sql),shift=randomUUID();
 let fill=fillEmptyTables;
 if(process.argv.includes('--canonical-fill-before')){
  const raw=execFileSync('git',['show','HEAD:VinPoker/supabase/functions/_shared/fillEmptyTables.ts'],{encoding:'utf8'});
  const js=stripTypeScriptTypes(raw).replace(/from "\.\/([^"\n]+)"/g,(_all,path)=>'from '+JSON.stringify(new URL('../../supabase/functions/_shared/'+path,import.meta.url).href));
  fill=(await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))).fillEmptyTables;
 }
 const role='native_fill_'+randomUUID().replaceAll('-','');
 sql(`CREATE ROLE ${role} NOLOGIN INHERIT BYPASSRLS;GRANT service_role TO ${role};`);
 const service=`SET request.jwt.claims='{"role":"service_role"}';SET request.jwt.claim.role='service_role';SET ROLE ${role};`;
 const quote=v=>v===null?'NULL':typeof v==='boolean'?String(v):`'${String(v).replaceAll("'","''")}'`;
 const ident=v=>(assert.match(v,/^[a-z_]+$/),v);
 const failures=[],writes=[];let fillStarted=0,failDurationTable=null;
 const signatures={get_dealer_pool_eligible_attendance_v1:true,get_dealer_operational_tables_v1:true,worker_assign_dealer_to_session_v1:true,atomic_dealer_ready_check:true,worker_perform_swing:true};
 const allowed=new Set(['dealer_assignments','dealer_attendance','dealers','dealer_shift_metrics','dealer_breaks','dealer_meal_breaks',
  'app_settings','dealer_table_profiles','dealer_table_pool_members','tournaments','swing_configs','swing_config','club_settings','cron_metrics']);
 const admin={async rpc(name,args){assert.ok(signatures[name],name);
  try{const params=Object.entries(args).map(([k,v])=>ident(k)+'=>'+(Array.isArray(v)?`ARRAY[${v.map(quote).join(',')}]::uuid[]`:quote(v))).join(',');
   const query=['get_dealer_operational_tables_v1','get_dealer_pool_eligible_attendance_v1'].includes(name)
    ?`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.${name}(${params}) r;`
    :`SELECT to_jsonb(public.${name}(${params}));`;
   const data=JSON.parse(sql(service+query));if(['worker_assign_dealer_to_session_v1','worker_perform_swing'].includes(name))writes.push({args,data,fillStarted});return {data,error:null};
  }catch(e){failures.push(String(e.stderr??e));return {data:null,error:{message:String(e.stderr??e)}};}
 },from(table){assert.ok(allowed.has(table),table);let filters=[],order='',limit='',single=false,selection='*';
  let joins='',value='to_jsonb(b)';
  if(table==='dealer_attendance'){joins=' LEFT JOIN public.dealers d ON d.id=b.dealer_id';value="to_jsonb(b)||jsonb_build_object('dealers',to_jsonb(d))";}
  if(table==='dealer_assignments'){joins=' LEFT JOIN public.game_tables g ON g.id=b.table_id';value="to_jsonb(b)||jsonb_build_object('game_tables',to_jsonb(g))";}
  if(table==='dealer_breaks'){joins=' LEFT JOIN public.dealer_assignments da ON da.id=b.assignment_id';value="to_jsonb(b)||jsonb_build_object('dealer_assignments',to_jsonb(da))";}
  if(table==='tournaments'){joins=' LEFT JOIN LATERAL (SELECT jsonb_agg(to_jsonb(tt)) AS rows FROM public.tournament_tables tt WHERE tt.tournament_id=b.id) tt ON true';value="to_jsonb(b)||jsonb_build_object('tournament_tables',coalesce(tt.rows,'[]'::jsonb))";}
  const field=k=>{const parts=k.split('.');if(parts.length===1)return 'b.'+ident(k);
   assert.equal(parts.length,2);const alias={dealers:'d',game_tables:'g',dealer_assignments:'da'}[parts[0]];assert.ok(alias,k);return alias+'.'+ident(parts[1]);};
  const q={select(s){selection=s;return q;},eq(k,v){filters.push(field(k)+'='+quote(v));return q;},
   neq(k,v){filters.push(field(k)+'<>'+quote(v));return q;},
   in(k,vs){filters.push(vs.length?field(k)+' IN ('+vs.map(quote).join(',')+')':'false');return q;},
   is(k,v){assert.equal(v,null);filters.push(field(k)+' IS NULL');return q;},
   not(k,op,v){assert.equal(op,'is');assert.equal(v,null);filters.push(field(k)+' IS NOT NULL');return q;},
   gt(k,v){filters.push(field(k)+'>'+quote(v));return q;},gte(k,v){filters.push(field(k)+'>='+quote(v));return q;},
   lt(k,v){filters.push(field(k)+'<'+quote(v));return q;},lte(k,v){filters.push(field(k)+'<='+quote(v));return q;},
   or(s){assert.equal(s,'current_state.eq.available,current_state.eq.on_break');filters.push("b.current_state IN ('available','on_break')");return q;},
   order(k,o){order=' ORDER BY '+field(k)+(o?.ascending===false?' DESC':' ASC');return q;},limit(n){assert.ok(Number.isInteger(n)&&n<=2000);limit=' LIMIT '+n;return q;},
   async read(){try{
    if(table===failDurationTable&&selection==='swing_duration_minutes')return {data:null,error:{code:'PGRST002',message:'local duration-read fault'}};
    let actualJoins=joins;
    for(const [name,alias] of [['dealers','d'],['game_tables','g'],['dealer_assignments','da']])if(selection.includes(name+'!inner('))actualJoins=actualJoins.replace('LEFT JOIN public.'+name+' '+alias,'INNER JOIN public.'+name+' '+alias);
    const conditions=[...filters];if(table==='tournaments'&&selection.includes('tournament_tables!inner('))conditions.push('tt.rows IS NOT NULL');
    const rows=JSON.parse(sql(service+`SELECT coalesce(jsonb_agg(x.value),'[]') FROM (SELECT ${value} AS value FROM public.${table} b${actualJoins}${conditions.length?' WHERE '+conditions.join(' AND '):''}${order}${limit}) x;`));
    if(single)assert.ok(rows.length<=1);return {data:single?rows[0]??null:rows,error:null};
   }catch(e){failures.push(String(e.stderr??e));return {data:null,error:{message:String(e.stderr??e)}};}},
   maybeSingle(){single=true;return q.read();},then(resolve,reject){return q.read().then(resolve,reject);}
   ,async insert(row){assert.equal(table,'cron_metrics');const keys=Object.keys(row);keys.forEach(ident);
    sql(service+`INSERT INTO public.cron_metrics(${keys.join(',')}) VALUES(${keys.map(k=>quote(row[k])).join(',')});`);return {data:null,error:null};}
  };return q;
 }};
 try{
  const prelive=process.argv.includes('--prelive-duration-contract');
  if(prelive){assert.notEqual(sql(`SELECT status FROM public.tournaments WHERE id='${f.tour}';`),'live');console.log('PRELIVE_CANONICAL_FILL_FIXTURE',JSON.stringify(f));}
  sql(`UPDATE public.tournaments SET ${prelive?'':"status='live',"}swing_duration_minutes=20 WHERE id='${f.tour}';
   INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES('${f.club}',true);
   INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES('${shift}','${f.club}','Canonical fill local TEST','00:00','23:59');`);
  if(tableCount>2)sql(`BEGIN;
   INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
    SELECT gen_random_uuid(),'${f.club}','Canonical capacity TEST '||n,n,'tournament','inactive','available' FROM generate_series(3,${tableCount}) n;
   SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL ROLE authenticated;
   DO $$ DECLARE physical uuid;r jsonb;BEGIN
    FOR physical IN SELECT id FROM public.game_tables WHERE club_id='${f.club}' AND table_number BETWEEN 3 AND ${tableCount} LOOP
     r:=public.floor_open_tournament_table_v3('${f.tour}',physical,'manual',gen_random_uuid());
     IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'capacity_floor_open_failed:%',r;END IF;
    END LOOP;
   END $$;COMMIT;`);
  const readyTest=process.argv.includes('--ready-duration-contract');assert.ok(!readyTest||tableCount===2);
  const mixedDuration=process.argv.includes('--cash-vip-duration-contract');
  assert.ok(!mixedDuration||!readyTest&&tableCount===2);
  for(let n=0;n<tableCount+(readyTest||mixedDuration?2:0);n++){
   const dealer=randomUUID(),key=randomUUID();
   sql(`INSERT INTO public.dealers(id,club_id,full_name,status) VALUES('${dealer}','${f.club}','Canonical fill TEST ${n}','active');`);
   const checked=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL ROLE authenticated;
    SELECT public.operator_check_in_dealer_v1('${dealer}','${f.club}','${shift}','${key}');COMMIT;`));
   assert.equal(checked.ok,true,JSON.stringify(checked));
  }
  assert.equal(sql(`SELECT count(*) FROM public.tournament_tables WHERE tournament_id='${f.tour}' AND table_id IS NULL AND game_table_id IS NOT NULL;`),String(tableCount));
  const passes=[];let assigned=0;
  while(assigned<tableCount){
   assert.ok(passes.length<tableCount,'bounded retry cannot loop indefinitely');fillStarted=Date.now();
   const result=await fill(admin,f.club,undefined,'',undefined,new Date(fillStarted+30*60000).toISOString(),15,true);
   assert.deepEqual(failures,[]);assert.ok(result.status==='ok'||result.status==='degraded'&&result.error_code==='fill_budget_exceeded',JSON.stringify(result));
   assert.ok(result.assignments.length>0,'no progress with sufficient eligible supply');
   assigned+=result.assignments.length;passes.push({status:result.status,assigned:result.assignments.length,durationMs:Date.now()-fillStarted});
   console.log('CANONICAL_FILL_CAPACITY_PROGRESS',JSON.stringify({club:f.club,assigned,target:tableCount,pass:passes.length,status:result.status}));
  }
  const rows=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(a)) FROM public.dealer_assignments a WHERE club_id='${f.club}' AND released_at IS NULL;`));
  assert.equal(rows.length,tableCount);assert.equal(new Set(rows.map(r=>r.attendance_id)).size,tableCount);
  for(const row of rows){const write=writes.find(w=>w.args.p_table_session_id===row.table_session_id);assert.ok(write);
   assert.ok(Date.parse(row.swing_due_at)>=write.fillStarted+20*60000&&Date.parse(row.swing_due_at)<write.fillStarted+21*60000,
   `canonical tournament duration expected 20m; actual ${((Date.parse(row.swing_due_at)-write.fillStarted)/60000).toFixed(2)}m; assignment ${row.id}`);
   assert.equal(sql(`SELECT count(*) FROM public.table_sessions WHERE id='${row.table_session_id}' AND game_table_id='${row.table_id}' AND club_id='${f.club}' AND closed_at IS NULL;`),'1');}
  assert.equal(writes.length,tableCount);assert.ok(writes.every(w=>w.data.outcome==='ok'));
  const repeat=await fill(admin,f.club,undefined,'',undefined,new Date().toISOString(),15,true);
  assert.equal(repeat.status,'ok');assert.equal(repeat.assignments.length,0);assert.equal(writes.length,tableCount);assert.deepEqual(failures,[]);
  if(mixedDuration){
   const financial=()=>sql(`SELECT md5(jsonb_build_object('cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x WHERE tournament_id='${f.tour}'),
    'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x WHERE tournament_id='${f.tour}'),
    'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x WHERE tournament_id='${f.tour}'))::text);`);
   const before=financial(),expected=[];
   for(const [type,minutes] of [['cash',35],['vip',40]]){
    const physical=randomUUID(),request=randomUUID();
    sql(`INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
     VALUES('${physical}','${f.club}','Configured ${type} local TEST',${type==='cash'?3:4},'${type}','inactive','available');`);
    if(type==='cash')sql(`INSERT INTO public.swing_config(club_id,table_type,swing_duration_minutes) VALUES('${f.club}','cash',${minutes})
     ON CONFLICT(club_id,table_type) DO UPDATE SET swing_duration_minutes=excluded.swing_duration_minutes;`);
    else sql(`INSERT INTO public.swing_configs(club_id,scope_type,scope_id,swing_duration_minutes) VALUES('${f.club}','table','${physical}',${minutes});`);
    const opened=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL ROLE authenticated;
     SELECT public.operator_open_club_tables_v2(ARRAY['${physical}'::uuid],'${type}','${request}');COMMIT;`));
    assert.equal(opened.ok,true,JSON.stringify(opened));expected.push({physical,type,minutes});
   }
   fillStarted=Date.now();
   const filled=await fill(admin,f.club,undefined,'',undefined,new Date(fillStarted+30*60000).toISOString(),15,true);
   assert.equal(filled.status,'ok',JSON.stringify(filled));assert.equal(filled.assignments.length,2);
   for(const item of expected){
    const row=JSON.parse(sql(`SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE table_id='${item.physical}' AND released_at IS NULL;`));
    const write=writes.find(w=>w.args.p_table_id===item.physical);assert.ok(write);
    assert.equal(row.table_session_id,write.args.p_table_session_id);
    const duration=(Date.parse(row.swing_due_at)-write.fillStarted)/60000;
    assert.ok(duration>=item.minutes&&duration<item.minutes+1,JSON.stringify({item,duration}));
    const inventory=await getDealerOperationalTables(admin,f.club),table=inventory.find(t=>t.id===item.physical);assert.ok(table);
    assert.equal(await getReadySwingDuration(admin,f.club,table),item.minutes);
   }
   assert.equal(sql(`SELECT count(*)||'|'||count(DISTINCT attendance_id) FROM public.dealer_assignments WHERE club_id='${f.club}' AND released_at IS NULL;`),'4|4');
   const repeated=await fill(admin,f.club,undefined,'',undefined,new Date().toISOString(),15,true);
   assert.equal(repeated.assignments.length,0);assert.equal(writes.length,4);assert.equal(financial(),before);assert.deepEqual(failures,[]);
   console.log('CASH35_VIP40_CANONICAL_OPEN_FILL_READY_SQL_EXACT_SESSION_REPLAY_FINANCIAL_UNCHANGED_PASS',JSON.stringify({fixture:f,expected}));
  }
  if(readyTest){
   // Deadline fault injection in this separate fixture, NOT a real-time soak.
   // Incoming check-in/rest history is not rewound; existing rest compensation stays.
   const target=rows[0],incoming=sql(`SELECT a.id FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${f.club}' AND a.current_state='available' ORDER BY a.id LIMIT 1;`);
   sql(`UPDATE public.dealer_assignments SET swing_due_at=clock_timestamp()-interval '1 second' WHERE id='${target.id}';
    UPDATE public.swing_config SET rotation_planner_enabled=false WHERE club_id='${f.club}' AND table_type='tournament';`);
   let handler;
   const source=stripTypeScriptTypes(readFileSync('supabase/functions/process-swing-on-dealer-ready/index.ts','utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,''));
   runInNewContext(source,{Request,Response,Date,console,getIdempotencyKey,parseDealerReadyPayload,getDealerOperationalTables,getReadySwingDuration,getReadyRestThreshold,loadEligibleDealerAttendance,
    authorizeInternalTrigger:req=>authorizeInternalTrigger(req,'LOCAL_READY'),authorizeSwingWorkerRequest:req=>authorizeSwingWorkerRequest(req,'LOCAL_WORKER','LOCAL_READY'),
    createClient:()=>admin,Deno:{env:{get:k=>({SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'LOCAL_WORKER'})[k]},serve:fn=>handler=fn}});
   const key=randomUUID();
   const invoke=(attendance=incoming)=>handler(new Request('https://test.invalid/ready',{method:'POST',headers:{authorization:'Bearer LOCAL_WORKER','content-type':'application/json','x-idempotency-key':key},body:JSON.stringify({club_id:f.club,attendance_id:attendance})}));
   const response=await invoke();
   const body=await response.json();assert.equal(response.status,200,JSON.stringify({body,failures}));assert.equal(body.outcome,'swung',JSON.stringify(body));
   const write=writes.find(w=>w.args.p_assignment_id===target.id);assert.ok(write);
   const actual=JSON.parse(sql(`SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE id='${body.new_assignment_id}';`));
   const elapsed=(Date.parse(actual.swing_due_at)-Date.parse(actual.assigned_at))/60000;
   console.log('READY_DURATION_ACTUAL_SQL',JSON.stringify({club:f.club,tour:f.tour,requested:write.args.p_duration_minutes,elapsed,restDeficit:body.rest_deficit_minutes,assignment:actual.id}));
   assert.equal(write.args.p_duration_minutes,20,'Ready must honor exact tournament duration, not hardcoded30');
   assert.ok(Math.abs(elapsed-(20+body.rest_deficit_minutes))<0.1,'SQL due honors tour duration plus unchanged rest compensation');
   const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a WHERE club_id='${f.club}'),
    'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${f.club}'))::text);`);
   const committed=fingerprint(),count=writes.length;
   const replay=await invoke();assert.equal(replay.status,200);assert.equal((await replay.json()).skipped,'state_changed');assert.equal(fingerprint(),committed);assert.equal(writes.length,count);
   sql(`UPDATE public.dealer_assignments SET swing_due_at=clock_timestamp()-interval '1 second' WHERE id='${rows[1].id}';`);
   const other=sql(`SELECT a.id FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${f.club}' AND a.current_state='available' AND a.id<>'${target.attendance_id}' ORDER BY a.id LIMIT 1;`);
   assert.match(other,/^[a-f0-9-]{36}$/);const beforeFault=fingerprint();failDurationTable='tournaments';
   const failed=await invoke(other);assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{error:'swing_duration_unverified'});
   assert.equal(fingerprint(),beforeFault);assert.equal(writes.length,count);failDurationTable=null;
   assert.deepEqual(failures,[]);console.log('READY_DURATION_CANONICAL_TOUR_SQL_REPLAY_READ_FAILURE_NO_MUTATION_PASS');
  }
  console.log('CANONICAL_AUTOFILL_REAL_PICKER_SQL_DURATION_SESSION_REPEAT_PASS',JSON.stringify({fixture:f,tableCount,passes,assignments:rows.map(r=>({id:r.id,session:r.table_session_id,attendance:r.attendance_id,due:r.swing_due_at})),writes:writes.length}));
 }finally{
  sql(`UPDATE public.club_settings SET auto_swing_enabled=false WHERE club_id='${f.club}';DROP ROLE ${role};`);
 }
}
