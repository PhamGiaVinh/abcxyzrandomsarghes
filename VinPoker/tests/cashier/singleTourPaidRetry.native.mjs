import assert from 'node:assert/strict';

// Native bootstrap's auth.uid reads only the individual GUC. Hosted Auth also
// reads JSON claims. Model that platform seam transactionally, never persist an
// Auth helper change or pass a human subject in the service caller's claims.
export function retrySingleTourPaidNative({sql,fixture,actor}) {
 assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 assert.equal(sql("SELECT host(inet_server_addr())||':'||inet_server_port();"),'127.0.0.1:55441');
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
 const definition=sql("SELECT pg_get_functiondef('auth.uid()'::regprocedure);");
 assert.equal(sql("SELECT regexp_replace(prosrc,'\\s+',' ','g') FROM pg_proc WHERE oid='auth.uid()'::regprocedure;").trim(),
  "SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid");
 assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournaments WHERE id='${fixture.tour}' AND club_id='${fixture.club}' AND event_id IS NULL AND name='Single-day browser local TEST');`),'t');
 const fingerprint=()=>sql(`SELECT jsonb_build_object('movements',md5((SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]'::jsonb)::text FROM public.cashier_buyin_movements m)),
  'bank',md5((SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY id),'[]'::jsonb)::text FROM public.bank_transactions b)))::text;`);
 const before=fingerprint();
 const output=sql(`BEGIN;
 CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
 SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';
 SET LOCAL ROLE service_role;SELECT public.cashier_retry_paid_seating_v1(false,100);
 RESET ROLE;${definition};COMMIT;`);
 const result=JSON.parse(output);assert.equal(result.ok,true);
 assert.equal(sql("SELECT pg_get_functiondef('auth.uid()'::regprocedure);"),definition);
 assert.equal(fingerprint(),before,'retry must not rewrite or add payments/bank transactions');
 const facts=JSON.parse(sql(`SELECT jsonb_build_object('registrations',count(*),'confirmed',count(*) FILTER(WHERE r.status='confirmed'),
  'entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${fixture.tour}'),
  'seats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${fixture.tour}' AND is_active),
  'stack',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${fixture.tour}' AND is_active),
  'movements',(SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='${fixture.tour}'),
  'paid',(SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='${fixture.tour}'),
  'receipts',(SELECT count(*) FROM public.seat_draw_receipts WHERE tournament_id='${fixture.tour}' AND status='issued'))
  FROM public.tournament_registrations r WHERE r.tournament_id='${fixture.tour}' AND r.player_id='${actor}';`));
 assert.deepEqual(facts,{registrations:1,confirmed:1,entries:1,seats:1,stack:20000,movements:1,paid:100000,receipts:1});
 console.log('LOCAL_SINGLE_TOUR_ACTUAL_PAID_RETRY_AUTH_PARITY_PASS',JSON.stringify({tour:fixture.tour,result,facts,authRestored:true,moneyFingerprint:JSON.parse(before)}));
}
