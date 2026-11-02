import assert from 'node:assert/strict';

export function verifyMemberCancellation(sql){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 const tour='829e61fe-0ac8-4ced-950d-ab76cb8dadc5',id='14805fff-7c9d-4e6d-854c-86c15de1d724';
 const row=JSON.parse(sql(`SELECT to_jsonb(r) FROM public.tournament_registrations r JOIN public.tournaments t ON t.id=r.tournament_id
  WHERE r.id='${id}' AND r.tournament_id='${tour}' AND t.name='Single-day browser local TEST' AND r.status='confirmed' AND r.price_snapshot IS NOT NULL;`)||'null');
 assert.ok(row?.player_id,'exact retained canonical paid TEST registration');
 assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE registration_id='${id}' AND applied_amount>0)
  AND NOT EXISTS(SELECT 1 FROM public.cashier_refund_requests WHERE registration_id='${id}' AND status='paid');`),'t');
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('registration',(SELECT to_jsonb(r) FROM public.tournament_registrations r WHERE id='${id}'),
  'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.cashier_buyin_movements m WHERE registration_id='${id}'),
  'receipts',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.seat_draw_receipts s WHERE registration_id='${id}'))::text);`);
 const before=fingerprint(),usage=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");
 const changed=JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='5s';
  ${usage==='f'?'GRANT USAGE ON SCHEMA auth TO authenticated;':''}
  SET LOCAL request.jwt.claim.sub='${row.player_id}';SET LOCAL request.jwt.claim.role='authenticated';
  SET LOCAL request.jwt.claims='{"sub":"${row.player_id}","role":"authenticated"}';SET LOCAL ROLE authenticated;
  WITH changed AS(UPDATE public.tournament_registrations SET status='cancelled',cancellation_reason='player_cancelled',cancelled_at=now()
   WHERE id='${id}' AND player_id='${row.player_id}' AND status='pending' RETURNING id,status)
  SELECT coalesce(jsonb_agg(changed),'[]'::jsonb) FROM changed;
  RESET ROLE;
  -- Test the real money guard independently of the pending-only player RLS/CAS.
  DO $test$ BEGIN
    BEGIN
      UPDATE public.tournament_registrations SET status='cancelled',cancellation_reason='ROLLBACK TEST' WHERE id='${id}';
      RAISE EXCEPTION 'missing_paid_registration_guard';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM<>'Paid registration requires Cashier refund' THEN RAISE;END IF;
    END;
  END $test$;
  ROLLBACK;`));
 assert.deepEqual(changed,[]);assert.equal(fingerprint(),before);
 assert.equal(sql("SELECT has_schema_privilege('authenticated','auth','USAGE');"),usage);
 console.log('MEMBER_CANCEL_CONFIRMED_ZERO_ROWS_PAID_REFUND_GUARD_NO_DELTA_PASS',JSON.stringify({tour,registration:id}));
}
