import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

export function verifyMemberProof(sql){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
  'users',(SELECT count(*) FROM auth.users),'clubs',(SELECT count(*) FROM public.clubs),
  'tours',(SELECT count(*) FROM public.tournaments),'registrations',(SELECT count(*) FROM public.tournament_registrations),
  'shifts',(SELECT count(*) FROM public.cashier_till_shifts),'movements',(SELECT count(*) FROM public.cashier_buyin_movements),
  'entries',(SELECT count(*) FROM public.tournament_entries),'receipts',(SELECT count(*) FROM public.seat_draw_receipts))::text);`);
 const before=fingerprint(),usage=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");
 const raw=readFileSync('tests/cashier/cashPaymentIdentity.pg17.sql','utf8');
 const marker=' -- CASH112_CONCURRENCY_FIXTURE_READY';assert.equal(raw.split(marker).length,2);
 // Reuse canonical create + priced registration; stop before the first payment.
 const prefix=raw.split(marker)[0].replace('BEGIN;',`BEGIN;SET LOCAL statement_timeout='5s';${usage==='f'?'GRANT USAGE ON SCHEMA auth TO authenticated;':''}`);
 const result=sql(prefix+`
 PERFORM set_config('role','none',true);
 PERFORM set_config('request.jwt.claim.sub',player_id::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',player_id,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 UPDATE public.tournament_registrations SET transfer_proof_image_url='LOCAL_TEST_PROOF_NO_STORAGE'
  WHERE id=registration AND tournament_registrations.player_id=current_setting('request.jwt.claim.sub')::uuid RETURNING to_jsonb(tournament_registrations) INTO saved;
 PERFORM pg_temp.assert_cash(saved->>'id'=registration::text AND saved->>'transfer_proof_image_url'='LOCAL_TEST_PROOF_NO_STORAGE','exact self-owned proof link receipt');
 UPDATE public.tournament_registrations SET transfer_proof_submitted=true WHERE id=registration
  RETURNING to_jsonb(tournament_registrations) INTO saved;
 PERFORM pg_temp.assert_cash(saved->>'id'=registration::text AND saved->>'transfer_proof_submitted'='true','exact submitted receipt');
 BEGIN
  UPDATE public.tournament_registrations SET status='confirmed' WHERE id=registration;
  RAISE EXCEPTION 'self_confirmation_was_allowed';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT IN('Verified buy-in total is insufficient for confirmation','Server-priced registration fields are server-owned') THEN RAISE;END IF;
 END;
 PERFORM set_config('role','none',true);
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 -- Owner is a separately authorized Cashier, not the negative actor. Use a fresh outsider.
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
 saved:=NULL;
 UPDATE public.tournament_registrations SET transfer_proof_submitted=false WHERE id=registration
  RETURNING to_jsonb(tournament_registrations) INTO saved;
 PERFORM pg_temp.assert_cash(saved IS NULL,'outsider proof mutation must return no row');
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.assert_cash((SELECT status='pending' AND transfer_proof_submitted FROM public.tournament_registrations WHERE id=registration),'proof is not payment confirmation');
 PERFORM pg_temp.assert_cash(NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE registration_id=registration),'no money movement');
 PERFORM pg_temp.assert_cash(NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE registration_id=registration),'proof creates no entry');
 END $$;
 SELECT 'MEMBER_PROOF_NATIVE_SELF_ACK_OUTSIDER_DENIED_NO_SELF_CONFIRM';
 ROLLBACK;`);
 assert.equal(result.split('\n').at(-1),'MEMBER_PROOF_NATIVE_SELF_ACK_OUTSIDER_DENIED_NO_SELF_CONFIRM');
 assert.equal(fingerprint(),before);assert.equal(sql("SELECT has_schema_privilege('authenticated','auth','USAGE');"),usage);
 console.log('MEMBER_PROOF_NATIVE_ROLLBACK_PASS');
}
