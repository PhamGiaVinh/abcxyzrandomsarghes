import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
assert.equal(process.env.VINPOKER_NATIVE_DB_TEST,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=input=>execFileSync('wsl',args,{input,encoding:'utf8',timeout:15000}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
const target=JSON.parse(sql(`SELECT jsonb_build_object('tour',c.tournament_id,'table',c.tournament_table_id,'actor',cl.owner_id,'assignment',a.id,'attendance',a.attendance_id)
 FROM public.tracker_voice_configs c JOIN public.clubs cl ON cl.id=c.club_id
 JOIN public.table_sessions s ON s.id=c.table_session_id JOIN public.tournament_tables t ON t.id=c.tournament_table_id
 JOIN public.dealer_assignments a ON a.table_session_id=s.id AND a.status='assigned' AND a.released_at IS NULL
 JOIN public.dealers d ON d.id=a.dealer_id JOIN public.dealer_attendance att ON att.id=a.attendance_id
 WHERE c.enabled AND c.control_epoch=s.control_epoch AND s.closed_at IS NULL AND s.control_mode='tracker'
 AND t.status='active' AND d.status='active' AND d.deleted_at IS NULL AND att.status='checked_in'
 AND att.check_out_time IS NULL AND att.current_state='assigned' ORDER BY c.id LIMIT 1;`));
const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_assignments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_attendance x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.table_sessions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tracker_voice_configs x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY key) FROM public.app_settings x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tracker_voice_events x))::text);`);
// Only this reader's transaction enables local Voice; no committed flag edit.
const read=()=>JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='3s';SET LOCAL request.jwt.claim.sub='${target.actor}';
 INSERT INTO public.app_settings(key,value) VALUES('tracker_voice_global_enabled','true'::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
 SET LOCAL ROLE authenticated;SELECT public.get_tracker_voice_runtime_context('${target.tour}','${target.table}');ROLLBACK;`));
const before=fingerprint();
assert.equal(read().ok,true,'retained target must be operational before lock test');
for(const [relation,id] of [['dealer_assignments',target.assignment],['dealer_attendance',target.attendance]]){
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.setEncoding('utf8').on('data',x=>{out+=x;});child.stderr.setEncoding('utf8').on('data',x=>{err+=x;});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(err)));});
 done.catch(()=>{});
 try{
  child.stdin.write(`BEGIN;SET LOCAL application_name='voice459-${relation}';SET LOCAL statement_timeout='10s';SELECT id FROM public.${relation} WHERE id='${id}' FOR UPDATE;SELECT 'VOICE459_LOCK_HELD';\n`);
  for(let i=0;i<50&&!out.includes('VOICE459_LOCK_HELD');i++)await new Promise(r=>setTimeout(r,100));
  assert.ok(out.includes('VOICE459_LOCK_HELD'),'row lock acquisition marker missing');
  assert.equal(sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='voice459-${relation}' AND state='idle in transaction';`),'1');
  const result=read();assert.equal(result.ok,false);assert.equal(result.error,'dealer_assignment_busy');
  assert.equal(result.can_mint_session,false);assert.equal(result.read_only,true);
  console.log(`VOICE459_${relation.toUpperCase()}_ACTUAL_LOCK_BUSY_FAIL_CLOSED_PASS`);
 }finally{
  if(!child.stdin.writableEnded)child.stdin.end('ROLLBACK;\n');await done;
 }
 assert.equal(read().ok,true,'context must recover after lock released');
}
assert.equal(fingerprint(),before,'rollback readers/lockers changed authoritative state');
console.log('VOICE459_RECOVERED_EXACT_GLOBAL_FINGERPRINT_ROLLBACK_PASS');
