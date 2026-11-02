import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

// Reuses the guarded native runner's SQL/session/barrier, never a hosted URL.
export async function pool255Concurrency({sql,session,until}) {
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 assert.equal(sql('SHOW data_directory;'),'/tmp/vinpoker-sol-local-20261016-0e79a729/data');
 assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
 assert.equal(sql('SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();'),'0','stop browser API before committed fixtures');
 const signatures=['public._enter_dealer_pool(uuid,uuid,timestamptz)','public._dealer_record_checkin(uuid,text)',
  'public.bridge_shift_checkins_to_pool()','public.operator_check_in_dealers(uuid,uuid,jsonb)'];
 const oldDigest='6c007683d2c7df2949e70adb8cd06dac';
 const digest=()=>sql(`SELECT md5(replace(pg_get_functiondef('${signatures[0]}'::regprocedure),chr(13),''));`);
 const source=readFileSync('supabase/migrations/20270128000222_dealer_pool_club_operating_day_v1.sql','utf8');
 const body=source.replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');
 if(digest()===oldDigest) {
  assert.equal(sql("SELECT to_regclass('floor_private.pool255_definition_backup') IS NULL;"),'t');
  assert.equal(sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000222';"),'0');
  const signatureValues=signatures.map(s=>`('${s}')`).join(',');
  sql(`BEGIN;CREATE TABLE floor_private.pool255_definition_backup(signature text PRIMARY KEY,definition text NOT NULL,old_digest text NOT NULL,new_digest text);
   REVOKE ALL ON floor_private.pool255_definition_backup FROM PUBLIC,anon,authenticated,service_role;
   INSERT INTO floor_private.pool255_definition_backup(signature,definition,old_digest)
    SELECT s,pg_get_functiondef(s::regprocedure),md5(replace(pg_get_functiondef(s::regprocedure),chr(13),'')) FROM (VALUES ${signatureValues}) v(s);
   ${body}
   UPDATE floor_private.pool255_definition_backup SET new_digest=md5(replace(pg_get_functiondef(signature::regprocedure),chr(13),''));COMMIT;`);
  console.log('POOL255_CANDIDATE222_LOCAL_APPLY_NO_LEDGER',digest());
 } else {
  assert.equal(sql(`SELECT new_digest FROM floor_private.pool255_definition_backup WHERE signature='${signatures[0]}';`),digest(),'do not reapply unknown definition');
 }
 // Prove exact recovery without retaining the old faulty functions.
 const recovery=readFileSync('tests/dealerSwing/pool255.recovery.pg17.sql','utf8');
 const current=digest();
 sql(recovery.replace(/^COMMIT;\r?$/m,()=>"DO $$ BEGIN ASSERT md5(replace(pg_get_functiondef('public._enter_dealer_pool(uuid,uuid,timestamptz)'::regprocedure),chr(13),''))='6c007683d2c7df2949e70adb8cd06dac'; END $$;ROLLBACK;"));
 assert.equal(digest(),current);
 console.log('POOL255_EXACT_DEFINITION_RECOVERY_ROLLBACK_PASS');

 const club=randomUUID(),actor=randomUUID(),shift=randomUUID(),outsider=randomUUID();
 const before=sql(`SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_attendance x))::text);`);
 const authUsage=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");
 sql(`BEGIN;INSERT INTO auth.users(id) VALUES('${actor}'),('${outsider}');
  INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${club}','${actor}','Pool255 concurrent TEST','TEST','approved');
  INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES('${shift}','${club}','Pool255 single TEST','08:00','23:00');
  INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES('${club}',false);
  ${authUsage==='f'?'GRANT USAGE ON SCHEMA auth TO authenticated;':''}COMMIT;`);
 const auth=id=>`SET LOCAL request.jwt.claim.sub='${id}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${id}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
 try {
  for(const order of ['helper-helper','helper-operator','operator-helper']) {
   const dealer=randomUUID(),request=randomUUID(),key=randomUUID().slice(0,8),app=`pool255_${key}`;
   sql(`INSERT INTO public.dealers(id,club_id,full_name,status) VALUES('${dealer}','${club}','Pool255 ${order} TEST','active');`);
   const helper=`public._enter_dealer_pool('${dealer}','${club}',statement_timestamp())`;
   const operator=`public.operator_check_in_dealer_v1('${dealer}','${club}','${shift}','${request}')`;
   const firstOperator=order==='operator-helper',secondOperator=order==='helper-operator';
   const a=session(app+'_a'),b=session(app+'_b');
   try {
    a.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='12s';${firstOperator?auth(actor):''}SELECT 'RESULT:'||(${firstOperator?operator:helper})::text;SELECT 'POOL255_HELD';\n`);
    await until(()=>a.output().includes('POOL255_HELD'));
    b.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='12s';${secondOperator?auth(actor):''}SELECT 'RESULT:'||(${secondOperator?operator:helper})::text;SELECT 'POOL255_RETURNED';\n`);
    await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${app}_b' AND cardinality(pg_blocking_pids(pid))>0);`)==='t');
    assert.ok(!b.output().includes('POOL255_RETURNED'),'must overlap, not sequentially pass');
    a.child.stdin.end('COMMIT;\n');await a.closed;
    await until(()=>b.output().includes('POOL255_RETURNED'));
    b.child.stdin.end('COMMIT;\n');await b.closed;
    const result=h=>h.output().split('\n').find(l=>l.startsWith('RESULT:')).slice(7);
    if(firstOperator)assert.equal(JSON.parse(result(a)).outcome,'checked_in');else assert.equal(result(a),'true');
    if(secondOperator)assert.equal(JSON.parse(result(b)).outcome,'already_checked_in');else assert.equal(result(b),'false');
    assert.equal(sql(`SELECT count(*) FROM public.dealer_attendance WHERE dealer_id='${dealer}' AND status='checked_in';`),'1');
    assert.equal(sql(`SELECT shift_date=(check_in_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AND shift_id='${shift}'::uuid FROM public.dealer_attendance WHERE dealer_id='${dealer}';`),'t');
    if(firstOperator||secondOperator) {
     const original=JSON.parse(result(firstOperator?a:b));
     assert.deepEqual(JSON.parse(sql(`BEGIN;${auth(actor)}SELECT ${operator};COMMIT;`)),original);
     assert.equal(JSON.parse(sql(`BEGIN;${auth(outsider)}SELECT ${operator};ROLLBACK;`)).error,'actor_not_allowed');
    }
    console.log('POOL255_TRUE_OVERLAP_ONE_ATTENDANCE_PASS',JSON.stringify({order,club,dealer,request}));
   } finally {
    for(const h of [a,b])if(!h.child.stdin.writableEnded&&!h.child.stdin.destroyed)h.child.stdin.end('ROLLBACK;\n');
    await Promise.allSettled([a.closed,b.closed]);
   }
  }
 } finally {
  if(authUsage==='f')sql('REVOKE USAGE ON SCHEMA auth FROM authenticated;');
  assert.equal(sql("SELECT has_schema_privilege('authenticated','auth','USAGE');"),authUsage);
  assert.equal(sql(`SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${club}';`),'f');
  const after=sql(`SELECT md5(jsonb_build_array(
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.dealer_attendance x JOIN public.dealers d ON d.id=x.dealer_id WHERE d.club_id<>'${club}'))::text);`);
  assert.equal(after,before,'money/chips/prior attendance changed');
 }
 console.log('POOL255_RETAINED_TEST_ONLY_NO_EXTERNAL_SCHEDULER',JSON.stringify({club,actor,shift,sourceDigest:current}));
}

export async function pool256PhoneOverlap({sql,session,until}) {
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 assert.equal(sql('SHOW data_directory;'),'/tmp/vinpoker-sol-local-20261016-0e79a729/data');
 assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
 assert.equal(sql('SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();'),'0');
 assert.equal(sql("SELECT md5(replace(pg_get_functiondef('public._dealer_record_checkin(uuid,text)'::regprocedure),chr(13),''));"),'c252ef43856bc608b99315375400bdbf');
 assert.equal(sql('SELECT count(*) FROM public.dealer_swing_phone_rollout;'),'0');
 assert.equal(sql('SELECT count(*) FROM public.dealer_selfcheckin_config;'),'0');
 const club='b28cd621-2e17-4376-906f-6d55eef8077b',actor='cfcecd60-76d5-4997-83be-d1cfe734edf0';
 assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.clubs c JOIN public.club_settings s ON s.club_id=c.id WHERE c.id='${club}' AND c.owner_id='${actor}' AND c.name='Pool255 concurrent TEST' AND NOT s.auto_swing_enabled);`),'t');
 const created=[];
 const facts=(exclude=false)=>sql(`SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_attendance x
   ${exclude&&created.length?`WHERE dealer_id NOT IN(${created.map(id=>`'${id}'::uuid`).join(',')})`:''}))::text);`);
 const before=facts();
 sql(`BEGIN;INSERT INTO public.dealer_selfcheckin_config(id,scheduled_pool_enabled) VALUES(true,true);
  INSERT INTO public.dealer_swing_phone_rollout(id,enabled,all_clubs_enabled,allowed_club_ids) VALUES(true,true,false,ARRAY['${club}'::uuid]);COMMIT;`);
 try {
  for(const order of ['phone-first','self-first']) {
   const dealer=randomUUID(),assignment=randomUUID(),request=randomUUID(),entry=randomUUID(),key=randomUUID().slice(0,8),app=`pool256_${key}`;
   created.push(dealer);
   sql(`BEGIN;INSERT INTO public.dealers(id,club_id,full_name,status) VALUES('${dealer}','${club}','Pool256 ${order} TEST','active');
    INSERT INTO public.dealer_shift_assignments(id,club_id,dealer_id,work_date,scheduled_start_at,scheduled_end_at,status)
     VALUES('${assignment}','${club}','${dealer}',(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,now()-interval '5 minutes',now()+interval '8 hours','confirmed');COMMIT;`);
   const payload=JSON.stringify([{entry_id:entry,mode:'scheduled',input_method:'manual_list',user_id:null,dealer_id:dealer,shift_assignment_id:assignment,reason:null}]);
   const phone=`public.operator_check_in_dealers('${request}','${club}','${payload}'::jsonb)`;
   const self=`public._dealer_record_checkin('${assignment}','pool256_self_local')`;
   const claims=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';`;
   const firstPhone=order==='phone-first';
   const a=session(app+'_a'),b=session(app+'_b');
   try {
    a.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='12s';${claims}${firstPhone?'SET LOCAL ROLE authenticated;':''}SELECT 'RESULT:'||(${firstPhone?phone:self})::text;SELECT 'POOL256_HELD';\n`);
    await until(()=>a.output().includes('POOL256_HELD'));
    b.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='12s';${claims}${!firstPhone?'SET LOCAL ROLE authenticated;':''}SELECT 'RESULT:'||(${firstPhone?self:phone})::text;SELECT 'POOL256_RETURNED';\n`);
    await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${app}_b' AND cardinality(pg_blocking_pids(pid))>0);`)==='t');
    assert.ok(!b.output().includes('POOL256_RETURNED'));
    a.child.stdin.end('COMMIT;\n');await a.closed;
    await until(()=>b.output().includes('POOL256_RETURNED'));
    b.child.stdin.end('COMMIT;\n');await b.closed;
    const result=h=>JSON.parse(h.output().split('\n').find(l=>l.startsWith('RESULT:')).slice(7));
    const phoneResult=result(firstPhone?a:b),selfResult=result(firstPhone?b:a);
    assert.equal(phoneResult.results[0].code,firstPhone?'checked_in_available':'already_checked_in');
    assert.equal(selfResult.pool_entry_reason,firstPhone?'already_in_pool':'entered_now');
    assert.equal(sql(`SELECT count(*) FROM public.dealer_attendance WHERE dealer_id='${dealer}' AND status='checked_in';`),'1');
    assert.equal(sql(`SELECT count(*) FROM public.dealer_shift_events WHERE assignment_id='${assignment}' AND event_type='checked_in';`),'1');
    assert.equal(sql(`SELECT count(*) FROM public.operator_dealer_checkin_requests WHERE request_id='${request}';`),'1');
    console.log('POOL256_PHONE_SELF_TRUE_OVERLAP_ONE_ATTENDANCE_EVENT_RECEIPT_PASS',JSON.stringify({order,club,dealer,assignment,request}));
   } finally {
    for(const h of [a,b])if(!h.child.stdin.writableEnded&&!h.child.stdin.destroyed)h.child.stdin.end('ROLLBACK;\n');
    await Promise.allSettled([a.closed,b.closed]);
   }
  }
 } finally {
  sql(`BEGIN;DO $$ BEGIN
   ASSERT (SELECT count(*) FROM public.dealer_selfcheckin_config)=1;
   ASSERT (SELECT scheduled_pool_enabled FROM public.dealer_selfcheckin_config WHERE id);
   ASSERT (SELECT count(*) FROM public.dealer_swing_phone_rollout)=1;
   ASSERT (SELECT enabled AND NOT all_clubs_enabled AND allowed_club_ids=ARRAY['${club}'::uuid] FROM public.dealer_swing_phone_rollout WHERE id);
   END $$;DELETE FROM public.dealer_swing_phone_rollout WHERE id;DELETE FROM public.dealer_selfcheckin_config WHERE id;COMMIT;`);
  assert.equal(facts(true),before,'prior attendance and all money/chips unchanged');
 }
 console.log('POOL256_CONFIG_RESTORED_OFF_NO_SCHEDULER_PASS');
}
