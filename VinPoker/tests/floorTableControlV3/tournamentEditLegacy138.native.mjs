import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Existing empty TEST canary, actual two psql connections, no retained writes.
export async function runTournamentEditLegacy138({sql,session,until,legacyFirst=false,writer='replace'}){
 assert.ok(['replace','import','upsert'].includes(writer));
 const tour='c19ee5c2-68c7-4627-842a-06a3a2348d6f',club='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',actor='f793a5b3-6025-4766-bc1b-49f16aa1b44a';
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 assert.equal(sql(`SELECT count(*) FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id WHERE t.id='${tour}' AND c.id='${club}' AND c.owner_id='${actor}' AND t.name='Tour edit121 partial local TEST config committed' AND NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id=t.id) AND NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE tournament_id=t.id);`),'1');
 const auth=`SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
 const context=JSON.parse(sql(`BEGIN READ ONLY;${auth}SELECT public.get_tournament_edit_context_v1('${tour}','${actor}');ROLLBACK;`));
 assert.equal(context.ok,true);assert.equal(context.can_edit_blinds,true);assert.equal(context.state.levels.length,2);
 const levels=context.state.levels.map(({level_number,small_blind,big_blind,ante,duration_minutes,is_break})=>({level_number,small_blind,big_blind,ante,duration_minutes,is_break}));
 const legacyLevels=levels.map((row,index)=>({...row,small_blind:row.small_blind+(index===0?1:0)}));
 const quote=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('tournament',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='${tour}'),'levels',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tournament_levels l WHERE tournament_id='${tour}'),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_id,operation_type,request_id) FROM public.table_operation_receipts r),'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m))::text);`);
 const before=fingerprint(),a=session('edit138_parent_first'),b=session('edit138_legacy_child');
 const atomic=`SELECT public.edit_tournament_with_levels_v1('${tour}','${club}',${quote(context.state)},${quote({...context.state.config,description:'TEST edit138 lock overlap'})},${quote(levels)},'${randomUUID()}','${actor}');`;
 const csv=legacyLevels.map(l=>[l.small_blind,l.big_blind,l.ante,l.duration_minutes,l.is_break].join(',')).join('\n');
 const legacy=writer==='import'?`SELECT public.import_blind_structure('${tour}','${csv.replaceAll("'","''")}');`
  :writer==='upsert'?`SELECT public.update_tournament_blinds('${tour}',${quote(legacyLevels)});`
  :`SELECT public.update_blind_structure('${tour}',${quote(legacyLevels)});`;
 console.log('EDIT138_WRITER_UNDER_TEST',writer,legacyFirst?'legacy_first':'editor_first');
 let results;
 try{
  a.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='12s';SET LOCAL lock_timeout='8s';${auth}${legacyFirst?legacy:`SELECT id FROM public.tournaments WHERE id='${tour}' FOR UPDATE;`}SELECT 'EDIT138_PARENT_HELD';\n`);
  await until(()=>a.output().includes('EDIT138_PARENT_HELD'));
  b.child.stdin.end(`BEGIN;SET LOCAL statement_timeout='12s';SET LOCAL lock_timeout='8s';${auth}${legacyFirst?atomic:legacy}ROLLBACK;\n`);
  await until(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='edit138_legacy_child' AND a.application_name='edit138_parent_first');")==='t');
  console.log(legacyFirst?'EDIT138_ACTUAL_EDITOR_WAITING_ON_LEGACY_PARENT_BARRIER':'EDIT138_ACTUAL_LEGACY_WAITING_ON_EDITOR_PARENT_BARRIER');
  a.child.stdin.end(`${legacyFirst?'':atomic}ROLLBACK;\n`);
  results=await Promise.allSettled([a.closed,b.closed]);
 }finally{
  for(const s of [a,b])if(!s.child.stdin.writableEnded)s.child.stdin.end('ROLLBACK;\n');
  await Promise.allSettled([a.closed,b.closed]);
  assert.equal(fingerprint(),before,'overlap must not retain tournament, blind, receipt or cash changes');
 }
 console.log('EDIT138_ACTUAL_OVERLAP_RESULTS',JSON.stringify(results.map(r=>r.status==='fulfilled'?{status:r.status,atomicSuccess:r.value.includes('"ok": true'),legacySuccess:r.value.includes('"status": "success"')}:{status:r.status,error:String(r.reason)})));
 assert.ok(results.every(r=>r.status==='fulfilled'),'legacy/editor parent-child lock order must complete without deadlock or timeout');
 assert.match((legacyFirst?b:a).output(),/"ok": true/);assert.match((legacyFirst?a:b).output(),/"status": "success"/);
 console.log('EDIT138_LEGACY_AND_ATOMIC_EDITOR_OVERLAP_ROLLBACK_NO_DEADLOCK_PASS');
}

// Actual committed predecessor, not the rollback-only overlap cases above.
// Compensation uses201 and retains its receipt; it never restores row IDs or
// overwrites unexpected state to manufacture a passing result.
export async function runTournamentBlindCommitCAS140({sql,session,until}){
 const tour='c19ee5c2-68c7-4627-842a-06a3a2348d6f',club='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',actor='f793a5b3-6025-4766-bc1b-49f16aa1b44a';
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 assert.equal(sql(`SELECT count(*) FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id WHERE t.id='${tour}' AND c.id='${club}' AND c.owner_id='${actor}' AND t.name='Tour edit121 partial local TEST config committed' AND t.current_level_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id=t.id) AND NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE tournament_id=t.id) AND NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id=t.id);`),'1');
 const auth=`SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
 const context=()=>JSON.parse(sql(`BEGIN READ ONLY;${auth}SELECT public.get_tournament_edit_context_v1('${tour}','${actor}');ROLLBACK;`));
 const original=context();assert.equal(original.ok,true);assert.equal(original.state.levels.length,2);
 const fields=({level_number,small_blind,big_blind,ante,duration_minutes,is_break})=>({level_number,small_blind,big_blind,ante,duration_minutes,is_break});
 const levels=original.state.levels.map(fields),changed=levels.map((l,i)=>({...l,small_blind:l.small_blind+(i===0?1:0)}));
 const expectedRows=original.state.levels.map((l,i)=>({...l,small_blind:l.small_blind+(i===0?1:0)}));
 const quote=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
 const financial=()=>sql(`SELECT md5(jsonb_build_object('cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),'registrations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_registrations r),'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e))::text);`);
 const beforeFinancial=financial(),staleKey=randomUUID(),compensationKey=randomUUID();
 const a=session('edit140_committing_legacy'),b=session('edit140_stale_editor');
 let committed=false;
 try{
  a.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='12s';${auth}SELECT public.update_tournament_blinds('${tour}',${quote(changed)});SELECT 'EDIT140_LEGACY_HELD';\n`);
  await until(()=>a.output().includes('EDIT140_LEGACY_HELD'));
  b.child.stdin.end(`BEGIN;SET LOCAL statement_timeout='12s';${auth}SELECT public.edit_tournament_with_levels_v1('${tour}','${club}',${quote(original.state)},${quote({...original.state.config,description:'TEST stale editor140 must not persist'})},${quote(levels)},'${staleKey}','${actor}');ROLLBACK;\n`);
  await until(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='edit140_stale_editor' AND a.application_name='edit140_committing_legacy');")==='t');
  console.log('EDIT140_REAL_EDITOR_WAITING_THEN_LEGACY_COMMIT');
  a.child.stdin.end('COMMIT;\n');await a.closed;committed=true;
  const result=JSON.parse((await b.closed).split('\n').filter(Boolean).at(-1));
  assert.deepEqual(result,{ok:false,error:'stale_edit_context'});
  const after=context();assert.deepEqual(after.state.config,original.state.config);assert.deepEqual(after.state.levels,expectedRows);
  assert.equal(sql(`SELECT count(*) FROM public.table_operation_receipts WHERE actor_id='${actor}' AND operation_type='edit_tournament_with_levels_v1' AND request_id='${staleKey}';`),'0');
  console.log('EDIT140_COMMITTED_LEGACY_INVALIDATES_OLD_EDITOR_CAS_NO_RECEIPT_PASS');
 }finally{
  for(const s of [a,b])if(!s.child.stdin.writableEnded)s.child.stdin.end('ROLLBACK;\n');
  await Promise.allSettled([a.closed,b.closed]);
  const current=context();
  if(JSON.stringify(current.state.levels)===JSON.stringify(expectedRows)&&JSON.stringify(current.state.config)===JSON.stringify(original.state.config)){
   const restored=JSON.parse(sql(`BEGIN;${auth}SELECT public.edit_tournament_with_levels_v1('${tour}','${club}',${quote(current.state)},${quote(original.state.config)},${quote(levels)},'${compensationKey}','${actor}');COMMIT;`));
   assert.equal(restored.ok,true);assert.deepEqual(restored.state.config,original.state.config);assert.deepEqual(restored.state.levels.map(fields),levels);
   assert.equal(sql(`SELECT count(*) FROM public.table_operation_receipts WHERE actor_id='${actor}' AND operation_type='edit_tournament_with_levels_v1' AND request_id='${compensationKey}';`),'1');
   console.log('EDIT140_CANONICAL_COMPENSATION_RECEIPT_RETAINED',JSON.stringify({tour,staleKey,compensationKey,committed,newLevelIds:restored.state.levels.map(l=>l.id)}));
  }else{
   assert.deepEqual(current.state,original.state,'unexpected state preserved; never blindly compensate over another edit');
  }
  assert.equal(financial(),beforeFinancial);
 }
}

export async function runBlindAuthorityRevocation140({sql,session,until}){
 const tour='c19ee5c2-68c7-4627-842a-06a3a2348d6f',club='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',owner='f793a5b3-6025-4766-bc1b-49f16aa1b44a';
 const actor='b1400000-0000-4000-8000-000000000001';
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 assert.equal(sql(`SELECT count(*) FROM auth.users WHERE id='${actor}';`),'0','one retained revocation TEST identity, never duplicate the constructor');
 assert.equal(sql(`SELECT md5(replace(pg_get_functiondef('public._lock_tournament_blind_parent_v1(uuid)'::regprocedure),chr(13),''));`),'b117fa0fdc991e86eee6ee01066ac8ca');
 assert.equal(sql(`SELECT count(*) FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id WHERE t.id='${tour}' AND c.id='${club}' AND c.owner_id='${owner}' AND t.name='Tour edit121 partial local TEST config committed' AND NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id=t.id);`),'1');
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('tournament',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='${tour}'),'levels',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tournament_levels l),'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),'registrations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_registrations r))::text);`);
 const before=fingerprint();
 // Native auth is deliberately modeled, not the hosted auth.users schema.
 sql(`BEGIN;INSERT INTO auth.users(id) VALUES('${actor}');INSERT INTO public.club_cashiers(club_id,user_id,granted_by) VALUES('${club}','${actor}','${owner}');COMMIT;`);
 const a=session('blind140_parent_blocker'),b=session('blind140_revoked_writer');
 try{
  a.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='12s';SELECT id FROM public.tournaments WHERE id='${tour}' FOR UPDATE;SELECT 'BLIND140_PARENT_HELD';\n`);
  await until(()=>a.output().includes('BLIND140_PARENT_HELD'));
  b.child.stdin.end(`BEGIN;SET LOCAL statement_timeout='12s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;SELECT public.update_tournament_blinds('${tour}','[{"level_number":1,"small_blind":101,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]'::jsonb);ROLLBACK;\n`);
  await until(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='blind140_revoked_writer' AND a.application_name='blind140_parent_blocker');")==='t');
  console.log('BLIND140_AUTHORIZED_CASHIER_REQUEST_WAITING_ON_PARENT');
  assert.equal(sql(`BEGIN;DELETE FROM public.club_cashiers WHERE club_id='${club}' AND user_id='${actor}' AND granted_by='${owner}' RETURNING user_id;COMMIT;`),actor);
  a.child.stdin.end('ROLLBACK;\n');await a.closed;
  await assert.rejects(b.closed,/blind_parent_actor_not_allowed/);
  assert.equal(fingerprint(),before);
  console.log('BLIND140_MEMBERSHIP_REVOKED_DURING_PARENT_WAIT_DENIED_NO_BLIND_FINANCIAL_DELTA_PASS');
 }finally{
  for(const s of [a,b])if(!s.child.stdin.writableEnded)s.child.stdin.end('ROLLBACK;\n');
  await Promise.allSettled([a.closed,b.closed]);
  sql(`DELETE FROM public.club_cashiers WHERE club_id='${club}' AND user_id='${actor}' AND granted_by='${owner}';`);
  assert.equal(sql(`SELECT count(*) FROM public.club_cashiers WHERE user_id='${actor}';`),'0');
  assert.equal(sql(`SELECT count(*) FROM public.user_roles WHERE user_id='${actor}';`),'0','retained TEST identity must have no residual global roles');
  assert.equal(fingerprint(),before);
  console.log('BLIND140_TEST_IDENTITY_RETAINED_NO_MEMBERSHIP_OR_GLOBAL_ROLE',actor);
 }
}
