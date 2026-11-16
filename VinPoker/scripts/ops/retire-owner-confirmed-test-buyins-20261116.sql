-- DRAFT: owner-confirmed legacy TEST buy-ins only. Not a migration or a generic cancellation API.
-- Production execution requires reviewed exact SHA, fresh recovery and controlled authorization.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
-- Stabilize absent tournament metadata; abort rather than wait on active writers.
LOCK TABLE public.tournaments IN SHARE MODE;
CREATE TEMP TABLE cleanup_scope(id_hash text PRIMARY KEY,before_md5 text NOT NULL,before_image jsonb) ON COMMIT DROP;
INSERT INTO cleanup_scope(id_hash,before_md5) VALUES
('6f4d67ff0ac30ed829dabcc50a82d76c924cd744f3095a866fa4de5e19456fb4','48d23d28fe8bba70b8a4b538a336620b'),
('a29623ee0314c5df56c7fc06677c8f19aba10aacba1ec993b0f0aad7adf4abef','06b4564c9cdfa7879af5c1599730e465'),
('4f0ecb1b43f7fdc6e450368e999b42f153223ecdfd77df8d51ec627ff9f4e3b7','d5de47771ddaba96d250799ae72fa4dd'),
('58f9f483504d3a33474ad24f169189dbc3862bc279309f5597811b44ee7d0a20','15be25adb597ebd0383bf802966cfb07'),
('5cf6c679d6cc61bee64fbc77c7d4cb9889a01ad699f680aa1046360142005c78','147ab43136e97c17f5287276d4a858cf');
DO $cleanup$
DECLARE r public.tournament_registrations%ROWTYPE; before_row jsonb; after_row jsonb; n integer:=0;
BEGIN
 IF current_setting('vinpoker.test_cleanup.project',true) IS DISTINCT FROM 'orlesggcjamwuknxwcpk'
  OR current_setting('vinpoker.test_cleanup.reviewed_sha',true) IS NULL
  OR current_setting('vinpoker.test_cleanup.reviewed_sha',true) !~ '^[a-f0-9]{40}$'
  OR current_setting('vinpoker.test_cleanup.approved_owner',true) IS DISTINCT FROM 'PhamGiaVinh'
 THEN RAISE EXCEPTION 'TEST_CLEANUP_REVIEWED_CONTEXT_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('owner-confirmed-legacy-test-buyins-20261116',0));
 IF (SELECT count(*) FROM cleanup_scope)<>5 THEN RAISE EXCEPTION 'TEST_CLEANUP_SCOPE_INVALID'; END IF;
 -- Locks fence in-flight row/FK operations, not hypothetical future writers.
 -- Controlled execution must exclude operations on these retired TEST records.
 -- No trigger is disabled or replaced.
 FOR r IN SELECT reg.* FROM public.tournament_registrations reg
 JOIN cleanup_scope s ON s.id_hash=encode(sha256(convert_to(reg.id::text,'UTF8')),'hex')
 ORDER BY reg.id FOR UPDATE OF reg LOOP
  before_row:=to_jsonb(r);
  UPDATE cleanup_scope SET before_image=before_row WHERE id_hash=encode(sha256(convert_to(r.id::text,'UTF8')),'hex');
  IF md5(before_row::text) IS DISTINCT FROM (SELECT before_md5 FROM cleanup_scope WHERE id_hash=encode(sha256(convert_to(r.id::text,'UTF8')),'hex'))
   OR r.status NOT IN ('pending','confirmed') OR r.price_snapshot IS NOT NULL
   OR r.cashier_paid_at IS NOT NULL OR r.source_entry_id IS NOT NULL
   OR EXISTS(SELECT 1 FROM public.tournaments WHERE id=r.tournament_id)
   OR EXISTS(SELECT 1 FROM public.tournament_entries WHERE registration_id=r.id)
   OR EXISTS(SELECT 1 FROM public.seat_draw_receipts WHERE registration_id=r.id)
   OR EXISTS(SELECT 1 FROM public.payment_settlements WHERE tournament_registration_id=r.id)
   OR EXISTS(SELECT 1 FROM public.satellite_tickets WHERE registration_id=r.id)
   OR EXISTS(SELECT 1 FROM public.cashier_refund_requests WHERE registration_id=r.id)
   OR EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE registration_id=r.id)
   OR EXISTS(SELECT 1 FROM public.satellite_ticket_value_transfers WHERE registration_id=r.id)
   OR EXISTS(SELECT 1 FROM public.satellite_redemption_reversals WHERE registration_id=r.id)
  THEN RAISE EXCEPTION 'TEST_CLEANUP_SOURCE_OR_DEPENDENCY_CHANGED'; END IF;
  UPDATE public.tournament_registrations AS current_reg SET status='cancelled',cancelled_at=transaction_timestamp(),
   cancelled_by=NULL,cancellation_reason='Owner confirmed legacy TEST buy-in; tournament metadata absent; retired 2026-11-16; no refund or payment assertion'
   WHERE current_reg.id=r.id RETURNING to_jsonb(current_reg) INTO after_row;
  IF after_row IS NULL OR after_row->>'status'<>'cancelled'
   OR (after_row-ARRAY['status','cancelled_at','cancelled_by','cancellation_reason','updated_at'])
     IS DISTINCT FROM (before_row-ARRAY['status','cancelled_at','cancelled_by','cancellation_reason','updated_at'])
  THEN RAISE EXCEPTION 'TEST_CLEANUP_HISTORY_CHANGED'; END IF;
  INSERT INTO public.audit_logs(club_id,actor_id,action,entity_type,entity_id,payload)
   VALUES(r.club_id,NULL,'owner_confirmed_legacy_test_buyin_retired_20261116','tournament_registration',r.id,
    jsonb_build_object('authorization','Owner identified these old buy-ins as TEST and requested cleanup',
     'approvedOwner',current_setting('vinpoker.test_cleanup.approved_owner'),
     'reviewedSha',current_setting('vinpoker.test_cleanup.reviewed_sha'),
     'executor','reviewed controlled maintenance; not a player action',
     'beforeMd5',md5(before_row::text),'afterMd5',md5(after_row::text),
     'previousStatus',r.status,'newStatus','cancelled','originalEvidencePreserved',true,
     'noRefundOrPaymentAssertion',true));
  n:=n+1;
 END LOOP;
 IF n<>5 THEN RAISE EXCEPTION 'TEST_CLEANUP_TARGET_COUNT_CHANGED'; END IF;
 -- Re-read after all row/statement triggers, including effects of later rows.
 IF (SELECT count(*) FROM cleanup_scope s JOIN public.tournament_registrations reg
   ON s.id_hash=encode(sha256(convert_to(reg.id::text,'UTF8')),'hex')
   WHERE reg.status='cancelled' AND reg.cancelled_at=transaction_timestamp()
    AND (to_jsonb(reg)-ARRAY['status','cancelled_at','cancelled_by','cancellation_reason','updated_at'])
      IS NOT DISTINCT FROM (s.before_image-ARRAY['status','cancelled_at','cancelled_by','cancellation_reason','updated_at']))<>5
  OR (SELECT count(*) FROM public.audit_logs a JOIN cleanup_scope s
   ON s.id_hash=encode(sha256(convert_to(a.entity_id::text,'UTF8')),'hex')
   JOIN public.tournament_registrations reg ON reg.id=a.entity_id
   WHERE a.action='owner_confirmed_legacy_test_buyin_retired_20261116'
    AND a.payload->>'beforeMd5'=s.before_md5 AND a.payload->>'afterMd5'=md5(to_jsonb(reg)::text)
    AND a.payload->>'reviewedSha'=current_setting('vinpoker.test_cleanup.reviewed_sha'))<>5
 THEN RAISE EXCEPTION 'TEST_CLEANUP_FINAL_POSTCHECK_FAILED'; END IF;
 IF EXISTS(SELECT 1 FROM public.tournaments t JOIN cleanup_scope s
   ON t.id=(s.before_image->>'tournament_id')::uuid)
  OR EXISTS(SELECT 1 FROM (
   SELECT registration_id AS id FROM public.tournament_entries
   UNION ALL SELECT registration_id FROM public.seat_draw_receipts
   UNION ALL SELECT tournament_registration_id FROM public.payment_settlements
   UNION ALL SELECT registration_id FROM public.satellite_tickets
   UNION ALL SELECT registration_id FROM public.cashier_refund_requests
   UNION ALL SELECT registration_id FROM public.cashier_buyin_movements
   UNION ALL SELECT registration_id FROM public.satellite_ticket_value_transfers
   UNION ALL SELECT registration_id FROM public.satellite_redemption_reversals
  ) refs JOIN cleanup_scope s ON s.id_hash=encode(sha256(convert_to(refs.id::text,'UTF8')),'hex'))
 THEN RAISE EXCEPTION 'TEST_CLEANUP_FINAL_DEPENDENCY_CHANGED'; END IF;
END $cleanup$;
COMMIT;
