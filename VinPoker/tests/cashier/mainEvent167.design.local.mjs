import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export function createMainEvent167Design({sql,actor,club,log,lifecycleFlight=null,qualification=false,finalLifecycle=false}){
 const event='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';
 const final='4cd3af4d-7e1d-4042-855f-04fb6777e580';
 assert.equal(actor,'675fe35e-60a8-4452-bb90-e79486d54da6');
 assert.equal(club,'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
 if(finalLifecycle){assert.equal(lifecycleFlight,final);assert.equal(qualification,true);}
 if(lifecycleFlight)assert.ok(['782a5196-5ea1-44ed-8a27-1b872d5f88d9','fdf91018-09f3-4cdc-b76a-f688eb216cee',...(finalLifecycle?[final]:[])].includes(lifecycleFlight));
 if(qualification){
  assert.equal(lifecycleFlight,finalLifecycle?final:'782a5196-5ea1-44ed-8a27-1b872d5f88d9');
  assert.equal(sql(`SELECT count(*) FROM public.multi_day_flight_ends_v1 WHERE event_id='${event}' AND status='locked' AND roster_count=8;`),'2');
  assert.equal(sql(`SELECT count(*) FROM public.tournament_seats s JOIN public.tournaments t ON t.id=s.tournament_id
   WHERE t.event_id='${event}' AND t.phase='flight' AND s.is_active;`),'0');
  if(finalLifecycle)assert.equal(sql(`SELECT count(*) FROM public.multi_day_final_participations_v1 WHERE event_id='${event}';`),'15');
 }
 assert.equal(sql(`SELECT count(*) FROM public.tournament_events WHERE id='${event}' AND club_id='${club}'
  AND name='Main Event browser local TEST 164' AND guarantee_amount=2500000;`),'1');
 const invariant=()=>sql(`SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(${lifecycleFlight?`CASE WHEN t.id='${lifecycleFlight}' THEN to_jsonb(t)-ARRAY['current_players','updated_at','current_level','current_level_id','clock_started_at','clock_paused_at','pause_accumulated','clock_control_revision','live_status'${finalLifecycle?",'status','players_remaining','average_stack','bust_seq','itm_places'":''}] ELSE to_jsonb(t) END`:'to_jsonb(t)'} ORDER BY id)
   FROM public.tournaments t WHERE event_id='${event}'),
  (SELECT to_jsonb(e) FROM public.tournament_events e WHERE id='${event}'),
  (SELECT count(*) FROM public.tournament_registrations r JOIN public.tournaments t ON t.id=r.tournament_id
   WHERE t.event_id='${event}' ${lifecycleFlight&&!finalLifecycle?`AND r.tournament_id<>'${lifecycleFlight}'`:''}),
  (SELECT count(*) FROM public.tournament_entries e JOIN public.tournaments t ON t.id=e.tournament_id
   WHERE t.event_id='${event}' ${lifecycleFlight?`AND e.tournament_id<>'${lifecycleFlight}'`:''}),
  (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m
   ${lifecycleFlight&&!finalLifecycle?`WHERE m.tournament_id IS DISTINCT FROM '${lifecycleFlight}'::uuid`:''}),
  (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p),
  (SELECT jsonb_agg(to_jsonb(g)) FROM public.multi_day_package_release_v1 g),
  (SELECT jsonb_agg(to_jsonb(g)) FROM public.centerpoint_tournament_ops_release g)
  ${finalLifecycle?`,(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.tournament_entries e JOIN public.tournaments t ON t.id=e.tournament_id WHERE t.event_id='${event}' AND t.phase='flight'),
   (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.tournament_seats s JOIN public.tournaments t ON t.id=s.tournament_id WHERE t.event_id='${event}' AND t.phase='flight'),
   (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM public.chip_bag b JOIN public.tournaments t ON t.id=b.tournament_id WHERE t.event_id='${event}'),
   (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.multi_day_final_participations_v1 p WHERE p.event_id='${event}')`:''})::text);`);
 const before=invariant();let dropRules=true,dropEnd=true,dropRelease=true,dropQualification=true,configurationOutcome=null;
 const itmBefore=finalLifecycle?Number(sql(`SELECT itm_places FROM public.tournaments WHERE id='${final}';`)):null;
 const run=(statement,rollback=false)=>JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='10s';
  CREATE TEMP TABLE main167_gate ON COMMIT DROP AS SELECT * FROM public.multi_day_package_release_v1 WHERE id FOR UPDATE;
  DO $$ BEGIN ASSERT (SELECT count(*) FROM main167_gate)=1; END $$;
  UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY['${club}'::uuid] WHERE id;
  ${finalLifecycle?`CREATE TEMP TABLE main184_ops ON COMMIT DROP AS SELECT * FROM public.centerpoint_tournament_ops_release WHERE id FOR UPDATE;
  UPDATE public.centerpoint_tournament_ops_release SET enabled=true,allowed_club_ids=ARRAY['${club}'::uuid] WHERE id;`:''}
  CREATE TEMP TABLE main167_auth ON COMMIT DROP AS SELECT has_schema_privilege('authenticated','auth','USAGE') prior;
  DO $$ BEGIN IF NOT (SELECT prior FROM main167_auth) THEN GRANT USAGE ON SCHEMA auth TO authenticated; END IF; END $$;
  SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';
  SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
  ${statement}
  RESET ROLE;
  DO $$ BEGIN IF NOT (SELECT prior FROM main167_auth) THEN REVOKE USAGE ON SCHEMA auth FROM authenticated; END IF; END $$;
  UPDATE public.multi_day_package_release_v1 SET (enabled,allowed_club_ids,updated_at)=
   (SELECT enabled,allowed_club_ids,updated_at FROM main167_gate) WHERE id;
  DO $$ BEGIN ASSERT (SELECT to_jsonb(g) FROM public.multi_day_package_release_v1 g WHERE id)=
   (SELECT to_jsonb(g) FROM main167_gate g); END $$;
  ${finalLifecycle?`UPDATE public.centerpoint_tournament_ops_release SET (enabled,allowed_club_ids,updated_at)=
   (SELECT enabled,allowed_club_ids,updated_at FROM main184_ops) WHERE id;
   DO $$ BEGIN ASSERT (SELECT to_jsonb(g) FROM public.centerpoint_tournament_ops_release g WHERE id)=
    (SELECT to_jsonb(g) FROM main184_ops g); END $$;`:''}${rollback?'ROLLBACK':'COMMIT'};`));
 return {event,
  runFinal(statement){assert.equal(finalLifecycle,true);assert.match(statement,/^SELECT /);return run(statement);},
  runBagging(statement){
   assert.ok(lifecycleFlight);
   assert.match(statement,/^SELECT public\.multi_day_(bagging_state_v1|record_bag_v1|seal_bag_v1|close_bagging_v1|get_bagging_receipt_v2)\('/);
   assert.ok(statement.includes(`('${lifecycleFlight}'`),'exact linked flight bagging only');
   return run(statement);
  },
  handle(name,body){
   if(finalLifecycle&&['multi_day_prize_configuration_receipt_v1','multi_day_save_prize_configuration_v1'].includes(name)){
    assert.equal(body.p_event_id,event);assert.match(body.p_request_id??'',/^[a-f0-9-]{36}$/i);
    assert.equal(sql("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.multi_day_save_prize_configuration_v1(uuid,jsonb,text,text,text,text,text,uuid,text)');"),
     '8158f411a20d20f2c66aae6cd2bd67f3','exact retained local217 backend required');
    let statement;
    if(name==='multi_day_prize_configuration_receipt_v1'){
     assert.deepEqual(Object.keys(body).sort(),['p_event_id','p_request_id']);
     statement=`SELECT public.multi_day_prize_configuration_receipt_v1('${event}','${body.p_request_id}');`;
    }else{
     const hashes=['p_expected_configuration_revision','p_expected_rules_version','p_expected_funding_revision','p_expected_qualification_revision','p_expected_payout_input_hash'];
     assert.deepEqual(Object.keys(body).sort(),['p_event_id','p_rows','p_request_id','p_reason',...hashes].sort());
     for(const key of hashes)assert.match(body[key]??'',/^[a-f0-9]{32}$/);
     assert.ok(Array.isArray(body.p_rows)&&body.p_rows.length>0&&body.p_rows.length<=15);
     for(const row of body.p_rows){assert.deepEqual(Object.keys(row).sort(),['amount','position']);
      assert.ok(Number.isSafeInteger(row.position)&&row.position>0&&Number.isSafeInteger(row.amount)&&row.amount>=0);}
     assert.ok(typeof body.p_reason==='string'&&body.p_reason.trim().length>0&&body.p_reason.length<=500);
     const rows=JSON.stringify(body.p_rows).replaceAll("'","''"),reason=body.p_reason.replaceAll("'","''");
     statement=`SELECT public.multi_day_save_prize_configuration_v1('${event}','${rows}'::jsonb,
      ${hashes.map(key=>`'${body[key]}'`).join(',')},'${body.p_request_id}','${reason}');`;
    }
    const value=run(statement);
    if(name==='multi_day_save_prize_configuration_v1'){
     assert.equal(value.state,'CONFIGURED');assert.equal(value.eventId,event);
     configurationOutcome=value;
    }
    log.push({rpc:name,event,requestId:body.p_request_id,result:value,
     localReleaseScope:'TRANSACTION_ONLY_RESTORED_BEFORE_COMMIT'});
    return {status:200,value};
   }
   if(finalLifecycle&&name==='multi_day_payout_configuration_preview_v1'){
    assert.deepEqual(Object.keys(body).sort(),['p_event_id','p_proposed_rows']);assert.equal(body.p_event_id,event);
    assert.ok(Array.isArray(body.p_proposed_rows)&&body.p_proposed_rows.length>0&&body.p_proposed_rows.length<=15);
    for(const row of body.p_proposed_rows){
     assert.deepEqual(Object.keys(row).sort(),['amount','position']);
     assert.ok(Number.isSafeInteger(row.position)&&row.position>0);
     assert.ok(Number.isSafeInteger(row.amount)&&row.amount>=0);
    }
    const absent=()=>sql("SELECT to_regprocedure('public.multi_day_payout_configuration_preview_v1(uuid,jsonb)') IS NULL;");
    const rows=JSON.stringify(body.p_proposed_rows).replaceAll("'","''");
    if(absent()==='f'){
     assert.equal(sql("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.multi_day_payout_configuration_preview_v1(uuid,jsonb)'::regprocedure;"),
      '7610ff472c03e70f3bd170ce0b71afd4','exact retained local216 preview required');
     const value=run(`SELECT public.multi_day_payout_configuration_preview_v1('${event}','${rows}'::jsonb);`);
     log.push({rpc:name,event,result:value,localScope:'REAL_PG_RETAINED_LOCAL_CANDIDATE_READ_ONLY'});
     return {status:200,value};
    }
    const candidate=readFileSync(new URL('../../supabase/migrations/20270128000216_multiday_payout_configuration_preview_v1.sql',import.meta.url),'utf8')
     .replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
    const value=run(`RESET ROLE;${candidate}\nSET LOCAL ROLE authenticated;
      SELECT public.multi_day_payout_configuration_preview_v1('${event}','${rows}'::jsonb);`,true);
    assert.equal(absent(),'t');
    log.push({rpc:name,event,result:value,localScope:'REAL_PG_CANDIDATE_AND_ALL_WRITES_ROLLED_BACK'});
    return {status:200,value};
   }
   if(qualification&&name==='get_public_tournament_redraw_v1'){
    assert.deepEqual(body,{p_tournament_id:'4cd3af4d-7e1d-4042-855f-04fb6777e580'});
    const value=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
     SELECT public.get_public_tournament_redraw_v1('4cd3af4d-7e1d-4042-855f-04fb6777e580');ROLLBACK;`));
    log.push({rpc:name,role:'anon',result:value});return {status:200,value};
   }
   if(qualification&&name==='multi_day_lock_qualification_v1'){
    assert.deepEqual(Object.keys(body).sort(),['p_event_id','p_bag_ids','p_expected_source_hash','p_request_id'].sort());
    assert.equal(body.p_event_id,event);assert.match(body.p_expected_source_hash,/^[a-f0-9]{32}$/);
    assert.match(body.p_request_id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
    assert.ok(Array.isArray(body.p_bag_ids)&&body.p_bag_ids.length===16&&new Set(body.p_bag_ids).size===16);
    for(const id of body.p_bag_ids)assert.match(id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
    const ids=body.p_bag_ids.map(id=>`'${id}'::uuid`).join(',');
    assert.equal(sql(`SELECT count(*) FROM public.chip_bag b JOIN public.tournaments t ON t.id=b.tournament_id
     WHERE t.event_id='${event}' AND b.id=ANY(ARRAY[${ids}]);`),'16');
    const value=run(`SELECT public.multi_day_lock_qualification_v1('${event}',ARRAY[${ids}],'${body.p_expected_source_hash}','${body.p_request_id}');`);
    log.push({rpc:name,event,request:body.p_request_id,result:value,localReleaseScope:'TRANSACTION_ONLY_RESTORED_BEFORE_COMMIT'});
    if(dropQualification&&value.ok===true&&value.idempotent===false){dropQualification=false;return {status:503,value:{message:'LOCAL_QUALIFICATION_RESPONSE_LOST_AFTER_COMMIT'}};}
    return {status:200,value};
   }
   if(qualification&&['multi_day_final_roster_v1','multi_day_payout_preview_v1','multi_day_payout_postfinal_state_v1'].includes(name)){
    assert.deepEqual(body,{p_event_id:event});
    const value=run(`SELECT public.${name}('${event}');`);
    log.push({rpc:name,event,result:value});return {status:200,value};
   }
   if(lifecycleFlight&&name==='get_bagged_flight_tables_v1'){
    assert.deepEqual(Object.keys(body),['p_flight_tournament_id']);assert.equal(body.p_flight_tournament_id,lifecycleFlight);
    const value=run(`SELECT public.get_bagged_flight_tables_v1('${lifecycleFlight}');`);
    log.push({rpc:name,flight:lifecycleFlight,result:value});return {status:200,value};
   }
   if(lifecycleFlight&&name==='release_bagged_flight_table_v1'){
    assert.deepEqual(Object.keys(body).sort(),['p_tournament_table_id','p_table_session_id','p_expected_revision',
     'p_expected_roster_hash','p_expected_day_version','p_request_id'].sort());
    for(const key of ['p_tournament_table_id','p_table_session_id','p_request_id'])assert.match(body[key],/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
    assert.match(body.p_expected_roster_hash,/^[a-f0-9]{32}$/);
    assert.ok(Number.isSafeInteger(body.p_expected_revision)&&body.p_expected_revision>=0);
    assert.ok(Number.isSafeInteger(body.p_expected_day_version)&&body.p_expected_day_version>=0);
    assert.equal(sql(`SELECT count(*) FROM public.multi_day_flight_roster_v1 WHERE flight_tournament_id='${lifecycleFlight}'
     AND tournament_table_id='${body.p_tournament_table_id}' AND table_session_id='${body.p_table_session_id}';`),'8');
    const value=run(`SELECT public.release_bagged_flight_table_v1('${body.p_tournament_table_id}','${body.p_table_session_id}',
     ${body.p_expected_revision},'${body.p_expected_roster_hash}',${body.p_expected_day_version},'${body.p_request_id}');`);
    log.push({rpc:name,flight:lifecycleFlight,request:body.p_request_id,result:value,localReleaseScope:'TRANSACTION_ONLY_RESTORED_BEFORE_COMMIT'});
    if(dropRelease){dropRelease=false;return {status:503,value:{message:'LOCAL_RELEASE_RESPONSE_LOST_AFTER_COMMIT'}};}
    return {status:200,value};
   }
   if(lifecycleFlight&&name==='multi_day_end_flight_v1'){
    assert.deepEqual(Object.keys(body).sort(),['p_flight_tournament_id','p_day_number','p_request_id'].sort());
    assert.equal(body.p_flight_tournament_id,lifecycleFlight);assert.ok(Number.isSafeInteger(body.p_day_number)&&body.p_day_number>0);
    assert.match(body.p_request_id,/^[a-f0-9-]{36}$/i);
    const value=run(`SELECT public.multi_day_end_flight_v1('${lifecycleFlight}',${body.p_day_number},'${body.p_request_id}');`);
    log.push({rpc:name,flight:lifecycleFlight,request:body.p_request_id,result:value,localReleaseScope:'TRANSACTION_ONLY_RESTORED_BEFORE_COMMIT'});
    if(dropEnd&&value.ok===true&&value.idempotent===false){dropEnd=false;return {status:503,value:{message:'LOCAL_END_FLIGHT_RESPONSE_LOST_AFTER_COMMIT'}};}
    return {status:200,value};
   }
   if(!['multi_day_floor_read_v1','multi_day_qualification_preview_v1','multi_day_set_qualification_rules_v2'].includes(name))return null;
   assert.equal(body.p_event_id,event);let statement;
   if(name==='multi_day_set_qualification_rules_v2'){
    assert.deepEqual(Object.keys(body).sort(),['p_event_id','p_policy','p_min_cash_x','p_day2_percent'].sort());
    // Explicit TEST inputs, never production defaults.
    assert.equal(body.p_policy,'SELECT_LARGEST');assert.equal(body.p_min_cash_x,1);assert.equal(body.p_day2_percent,100);
    statement=`SELECT public.multi_day_set_qualification_rules_v2('${event}','SELECT_LARGEST',1,100);`;
   }else{assert.deepEqual(Object.keys(body),['p_event_id']);statement=`SELECT public.${name}('${event}');`;}
   const value=run(statement);
   log.push({rpc:name,event,result:value,localReleaseScope:'TRANSACTION_ONLY_RESTORED_BEFORE_COMMIT'});
   if(name==='multi_day_set_qualification_rules_v2'&&dropRules&&value.ok===true){
    dropRules=false;log.at(-1).responseDropped=true;return {status:503,value:{message:'LOCAL_FRESH_RULES_RESPONSE_LOST_AFTER_COMMIT'}};
   }
   return {status:200,value};
  },
  // An explicit linked lifecycle permits canonical registration/payment/seating
  // of that flight only, including its player count and canonical clock state;
  // other flights, all prize payments, prices and gates
  // remain protected. Per-operation receipts prove the intended flight writes.
  verify(){
   if(finalLifecycle){
    const actualItm=Number(sql(`SELECT itm_places FROM public.tournaments WHERE id='${final}';`));
    if(configurationOutcome){
     assert.equal(sql(`SELECT md5(coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.position,q.id),'[]'::jsonb)::text)
      FROM public.tournament_prizes q WHERE q.tournament_id='${final}';`),configurationOutcome.configurationRevision,
      'retained prize rows must match the exact canonical configuration receipt');
     assert.equal(actualItm,Math.max(...configurationOutcome.requestPayload.rows.map(row=>row.position)),
      'derived ITM projection must match the saved configuration receipt');
    }else assert.equal(actualItm,itmBefore,'ITM changed without a configuration writer receipt');
   }
   assert.equal(invariant(),before,'unexpected event/config/other-flight financial or release-scope delta');
   console.log(lifecycleFlight?'MAIN_EVENT_LINKED_OTHER_SCOPE_CONFIG_PRIZES_GATES_UNCHANGED_PASS'
    :'MAIN_EVENT167_RULES_NO_EVENT_ENTRY_MONEY_OR_GATE_DELTA_PASS');},
 };
}
