import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function runD2PaymentConcurrency(sql,session,until){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 const event='30eb935c-8ba6-43ab-a6a6-0c0934f71570';
 const f=JSON.parse(sql(`SELECT jsonb_build_object('club',f.club_id,'actor',c.owner_id,'tour',f.final_tournament_id)
  FROM public.multi_day_payout_finalizations_v1 f JOIN public.clubs c ON c.id=f.club_id WHERE f.event_id='${event}';`));
 const claims=actor=>`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';
  SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
 const call=(q,actor=f.actor)=>JSON.parse(sql(`BEGIN;${claims(actor)}${q}COMMIT;`));
 const priorGate=JSON.parse(sql("SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) FROM public.multi_day_package_release_v1 g;"));
 assert.ok(priorGate.length<=1);
 const cashier=randomUUID(),keyA=randomUUID(),keyB=randomUUID(),name='d2_payment_'+randomUUID().replaceAll('-','');
 let a,b,committed=null;
 sql(`INSERT INTO auth.users(id) VALUES('${cashier}');INSERT INTO public.club_cashiers(club_id,user_id) VALUES('${f.club}','${cashier}');
  INSERT INTO public.multi_day_package_release_v1(id,enabled,allowed_club_ids) VALUES(true,true,ARRAY['${f.club}'::uuid])
  ON CONFLICT(id) DO UPDATE SET enabled=true,allowed_club_ids=excluded.allowed_club_ids;`);
 try{
  const before=call(`SELECT public.multi_day_payout_postfinal_state_v1('${event}');`);assert.equal(before.paidPlayerVnd,0);
  const person=call(`SELECT public.get_multi_day_payout_recipients_v1('${event}');`).places[0];assert.equal(person.prizeAmount,300000);
  a=session(name+'_a');b=session(name+'_b');
  const command=(actor,key)=>`BEGIN;${claims(actor)}SELECT public.record_multi_day_prize_payment_v1('${event}',
   '${person.multiDayParticipationId}','cash','${person.confirmationToken}','${key}');SELECT 'PAYMENT_HELD';\n`;
  a.child.stdin.write(command(f.actor,keyA));await until(()=>a.output().includes('PAYMENT_HELD'));
  b.child.stdin.write(command(cashier,keyB));
  await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}_b' AND wait_event_type='Lock');`)==='t');
  assert.ok(!b.output().includes('PAYMENT_HELD'),'second actor must overlap and wait, not start after commit');
  a.child.stdin.end('COMMIT;\n');
  const outA=await a.closed;committed=JSON.parse(outA.split('\n').find(line=>line.startsWith('{')));assert.equal(committed.ok,true);
  await until(()=>b.output().includes('PAYMENT_HELD'));b.child.stdin.end('COMMIT;\n');
  const outB=await b.closed,rejected=JSON.parse(outB.split('\n').find(line=>line.startsWith('{')));
  assert.equal(rejected.error,'payout_confirmation_stale');
  const after=call(`SELECT public.multi_day_payout_postfinal_state_v1('${event}');`);
  assert.equal(after.paidPlayerVnd,300000);assert.equal(after.unpaidObligationVnd,1300000);
  assert.equal(call(`SELECT public.get_tournament_prize_payment_receipt_v2('${keyA}');`,cashier).found,false);
  assert.equal(call(`SELECT public.get_tournament_prize_payment_receipt_v2('${keyB}');`,cashier).result.error,'payout_confirmation_stale');
  console.log('D2_TWO_ACTOR_REAL_LOCK_WAIT_ONE_PAYMENT_STALE_OTHER_PRIVATE_RECEIPTS_PASS');
 } finally {
  for(const s of [a,b])if(s)s.child.stdin.end();
  await Promise.allSettled([a?.closed,b?.closed].filter(Boolean));
  try{
   if(committed?.ok){
    // Explicit TEST compensation through audited owner request/approval; never
    // delete/rewrite the payment or pretend the original marker disappeared.
    const state=call(`SELECT public.multi_day_payout_postfinal_state_v1('${event}');`);
    const person=call(`SELECT public.get_multi_day_payout_recipients_v1('${event}');`).places[0];
    const request=randomUUID();
    assert.equal(call(`SELECT public.multi_day_request_payout_correction_v1('${event}','PAYMENT_REVERSAL',
      '${person.multiDayParticipationId}','${committed.payment_id}',-300000,'${state.revision}',
      'LOCAL TEST race compensation','LOCAL-NATIVE-RACE-EVIDENCE','${request}');`).state,'PENDING_APPROVAL');
    assert.equal(call(`SELECT public.multi_day_approve_payout_correction_v1('${request}','${randomUUID()}');`).ok,true);
    assert.equal(call(`SELECT public.multi_day_payout_postfinal_state_v1('${event}');`).paidPlayerVnd,0);
    console.log('D2_TEST_RACE_AUDITED_COMPENSATION_PAID0_HISTORY_RETAINED_PASS');
   }
  }finally{
   if(priorGate.length){const g=priorGate[0];sql(`UPDATE public.multi_day_package_release_v1 SET enabled=${g.enabled},allowed_club_ids=ARRAY[${g.allowed_club_ids.map(id=>`'${id}'::uuid`).join(',')}]::uuid[] WHERE id;`);}
   else sql(`DELETE FROM public.multi_day_package_release_v1 WHERE id AND allowed_club_ids=ARRAY['${f.club}'::uuid];`);
   assert.deepEqual(JSON.parse(sql("SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) FROM public.multi_day_package_release_v1 g;")),priorGate);
  }
 }
}
