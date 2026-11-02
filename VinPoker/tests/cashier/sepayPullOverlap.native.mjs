import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Called only by the exact-loopback guarded parent. Both sessions roll back.
export async function runSePayPullOverlap(sql,{session,until}){
 const club=sql(`SELECT c.id FROM public.clubs c JOIN public.tournaments t ON t.club_id=c.id
  JOIN public.club_payment_config cfg ON cfg.club_id=c.id WHERE t.id='e77ceb98-7e77-4c87-bd73-787c6de20936'
  AND t.name='Cash identity local TEST' AND c.name='Cash identity local TEST' AND cfg.master_account_number LIKE 'TEST-%';`);
 assert.match(club,/^[a-f0-9-]{36}$/);
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('config',(SELECT to_jsonb(c) FROM public.club_payment_config c WHERE club_id='${club}'),
  'progress',(SELECT to_jsonb(p) FROM private.sepay_pull_progress_v1 p WHERE club_id='${club}'))::text);`);
 assert.equal(sql(`SELECT count(*) FROM private.sepay_pull_progress_v1 WHERE club_id='${club}';`),'0');
 const before=fingerprint(),name='sepay_pull_'+randomUUID().replaceAll('-',''),a=session(name+'_a'),b=session(name+'_b');
 const claimRpc=sql("SELECT to_regprocedure('public.sepay_claim_pull_v2(uuid,uuid)') IS NOT NULL;")==='t'?'sepay_claim_pull_v2':'sepay_claim_pull_v1';
 const claim=`BEGIN;SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';
  SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;
  SELECT public.${claimRpc}('${club}','51100000-0000-4000-8000-000000000001')->>'status';`;
 let aEnded=false,bEnded=false;
 try{
  a.child.stdin.write(claim+'\n');await until(()=>a.output().includes('claimed'));
  b.child.stdin.write(claim+'\n');
  await until(()=>sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}_b' AND wait_event_type='Lock';`)==='1');
  assert.equal(b.output().includes('claimed'),false,'second claim cannot pass the held configuration lock');
  a.child.stdin.end('ROLLBACK;\n');aEnded=true;await a.closed;
  await until(()=>b.output().includes('claimed'));
  b.child.stdin.end('ROLLBACK;\n');bEnded=true;await b.closed;
  assert.equal(fingerprint(),before);
  console.log('SEPAY_PULL_TWO_ACTUAL_SESSIONS_LOCK_WAIT_ROLLBACK_NO_DELTA_PASS');
 }finally{
  if(!aEnded)a.child.stdin.end('ROLLBACK;\n');if(!bEnded)b.child.stdin.end('ROLLBACK;\n');
  await Promise.allSettled([a.closed,b.closed]);
 }
}
