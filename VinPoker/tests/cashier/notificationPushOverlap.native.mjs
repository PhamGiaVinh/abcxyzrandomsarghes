import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Called by the exact-native guarded parent; only these two new TEST notices
// commit for cross-session visibility. Claims roll back; exact fixture deletion
// removes their ephemeral queue rows, never pre-existing history or money.
export async function runPushOverlap(sql,{session,until}){
 const ids=[randomUUID(),randomUUID()],tag='push_overlap_'+randomUUID().replaceAll('-','');
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('notifications',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.notifications n),
  'queue',(SELECT jsonb_agg(to_jsonb(q) ORDER BY id) FROM private.notification_push_outbox_v1 q))::text);`);
 const before=fingerprint();
 const auth=`SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;`;
 let a,b,endedA=false,endedB=false;
 try{
  sql(`INSERT INTO public.notifications(id,user_id,type,title,body,data) VALUES
   ('${ids[0]}','675fe35e-60a8-4452-bb90-e79486d54da6','registration_confirmed','LOCAL overlap A TEST','${tag}','{}'),
   ('${ids[1]}','675fe35e-60a8-4452-bb90-e79486d54da6','registration_confirmed','LOCAL overlap B TEST','${tag}','{}');`);
  a=session(tag+'_a');b=session(tag+'_b');
  a.child.stdin.write(`BEGIN;${auth}SELECT CASE WHEN public.claim_notification_push_v1('${ids[0]}')->'job'->>'state'='processing' THEN 'A_CLAIMED' ELSE 'WRONG_A' END;\n`);
  await until(()=>a.output().includes('A_CLAIMED'));
  assert.equal(sql(`SELECT state FROM pg_stat_activity WHERE application_name='${tag}_a';`),'idle in transaction');
  b.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='3s';${auth}
   SELECT CASE WHEN public.claim_notification_push_v1('${ids[0]}')->'job'='null'::jsonb THEN 'LOCKED_A_SKIPPED' ELSE 'WRONG_RECLAIM' END;
   SELECT CASE WHEN public.claim_notification_push_v1('${ids[1]}')->'job'->>'notification_id'='${ids[1]}' THEN 'B_CLAIMED' ELSE 'WRONG_B' END;\n`);
  await until(()=>b.output().includes('B_CLAIMED'));
  assert.ok(b.output().includes('LOCKED_A_SKIPPED'));assert.ok(!b.output().includes('WRONG'));
  a.child.stdin.end('ROLLBACK;\n');endedA=true;
  b.child.stdin.end('ROLLBACK;\n');endedB=true;
  await Promise.all([a.closed,b.closed]);
  assert.equal(sql(`SELECT count(*) FROM private.notification_push_outbox_v1 WHERE notification_id IN('${ids[0]}','${ids[1]}') AND state='pending' AND attempts=0;`),'2');
  console.log('PUSH_OUTBOX_TRUE_TWO_SESSION_SKIP_LOCKED_DISTINCT_JOBS_ROLLBACK_PASS');
 }finally{
  if(a&&!endedA)a.child.stdin.end('ROLLBACK;\n');if(b&&!endedB)b.child.stdin.end('ROLLBACK;\n');
  await Promise.allSettled([a?.closed,b?.closed].filter(Boolean));
  sql(`DELETE FROM public.notifications WHERE id IN('${ids[0]}','${ids[1]}') AND body='${tag}' AND title IN('LOCAL overlap A TEST','LOCAL overlap B TEST');`);
  assert.equal(fingerprint(),before,'push overlap fixture cleanup changed retained notifications or jobs');
 }
}
