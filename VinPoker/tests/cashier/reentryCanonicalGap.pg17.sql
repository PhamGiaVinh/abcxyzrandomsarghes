\set ON_ERROR_STOP on
-- Default: diagnostic, PASS means old seating gap reproduced, NOT repaired.
-- FIXED_REENTRY: legacy confirmation seating/ticket/replay regression only.
-- Both modes separately prove current Edge-shaped re-entry cannot accept cash
-- without a server price snapshot. NOT a full paid re-entry acceptance test.
BEGIN;
\if :{?PAID_REGISTRATION}
SELECT set_config('test.paid_registration',:'PAID_REGISTRATION',true);
\else
SELECT set_config('test.paid_registration','8ac7903e-0cc3-43b4-addf-af32d69321d5',true);
\endif
\if :{?FIXED_REENTRY}
SELECT set_config('test.fixed_reentry','true',true);
\else
SELECT set_config('test.fixed_reentry','false',true);
\endif
\if :{?SERVER_PRICED_REENTRY}
SELECT set_config('test.server_priced_reentry','true',true);
\else
SELECT set_config('test.server_priced_reentry','false',true);
\endif
DO $$ BEGIN
 IF current_database() NOT IN ('vinpoker_ops_cash112_ui','vinpoker_ops_cash115_qualified_c') OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR inet_server_port()<>55441 OR current_setting('server_version_num')::int/10000<>17
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
 RAISE EXCEPTION 'isolated_reentry_diagnostic_required';END IF;
END $$;
CREATE FUNCTION pg_temp.fail_reentry_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.source_entry_id::text=current_setting('test.fail_reentry_source',true) THEN
  RAISE EXCEPTION 'TEST_REENTRY_INSERT_FAULT';END IF;RETURN NEW;
END $$;
CREATE TRIGGER zzzz_test_reentry_insert AFTER INSERT ON public.tournament_registrations
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_reentry_insert();
DO $$ DECLARE source_entry public.tournament_entries%ROWTYPE; sess public.table_sessions%ROWTYPE;
 reg uuid:=gen_random_uuid(); actor uuid; r jsonb; saved jsonb; intent jsonb; BEGIN
 SELECT * INTO STRICT source_entry FROM public.tournament_entries WHERE registration_id=current_setting('test.paid_registration')::uuid;
 SELECT x.* INTO STRICT sess FROM public.table_sessions x JOIN public.tournament_seats s ON s.table_session_id=x.id WHERE s.entry_id=source_entry.id AND s.is_active;
 SELECT owner_id INTO STRICT actor FROM public.clubs WHERE id=sess.club_id;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_bust_player_v3(source_entry.id,sess.revision,sess.control_epoch,20000,gen_random_uuid(),'reentry_gap_TEST');
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'canonical_bust_failed: %',r;END IF;
 IF current_setting('test.server_priced_reentry')='true' THEN
  BEGIN
   PERFORM public.cashier_create_app_reentry_v1(source_entry.tournament_id,source_entry.player_id);
   RAISE EXCEPTION 'browser_reentry_service_endpoint_exposed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 END IF;
 PERFORM set_config('role','none',true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 -- Fixture insert uses local postgres: this native service_role intentionally
 -- has no BYPASSRLS. Keep service JWT for the server-insert trigger; this is
 -- not an Edge/service-role authorization test.
 -- Same pending-registration shape as tournament-reentry Edge. Local fixture
 -- only; not claiming this exercises its HTTP/banking/notification transport.
 IF current_setting('test.server_priced_reentry')='true' THEN
  UPDATE public.tournaments SET rake_amount=1000,service_fee_amount=2000,free_rake_enabled=true,free_rake_slots=3,free_rake_used=0
   WHERE id=source_entry.tournament_id;
  -- Trust-boundary and lifecycle failures must not create a registration.
  BEGIN
   UPDATE public.tournaments SET current_level=7,late_reg_close_level=6 WHERE id=source_entry.tournament_id;
   r:=public.cashier_create_app_reentry_v1(source_entry.tournament_id,source_entry.player_id);
   IF r->>'error' IS DISTINCT FROM 'reentry_window_closed' THEN RAISE EXCEPTION 'late_reentry_accepted: %',r;END IF;
   RAISE SQLSTATE 'PZ001';
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;END;
  BEGIN
   UPDATE public.tournaments SET status='completed' WHERE id=source_entry.tournament_id;
   r:=public.cashier_create_app_reentry_v1(source_entry.tournament_id,source_entry.player_id);
   IF r->>'error' IS DISTINCT FROM 'reentry_window_closed' THEN RAISE EXCEPTION 'completed_reentry_accepted: %',r;END IF;
   RAISE SQLSTATE 'PZ001';
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;END;
  BEGIN
   PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
   r:=public.cashier_create_app_reentry_v1(source_entry.tournament_id,source_entry.player_id);
   IF r->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'nonservice_jwt_accepted';END IF;
   RAISE SQLSTATE 'PZ001';
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;END;
  r:=public.cashier_create_app_reentry_v1(source_entry.tournament_id,gen_random_uuid());
  IF r->>'error' IS DISTINCT FROM 'source_entry_not_found' THEN RAISE EXCEPTION 'unrelated_player_accepted: %',r;END IF;
  IF EXISTS(SELECT 1 FROM public.tournament_registrations WHERE source_entry_id=source_entry.id) THEN
   RAISE EXCEPTION 'denied_reentry_created_registration';END IF;
  BEGIN
   PERFORM set_config('test.fail_reentry_source',source_entry.id::text,true);
   BEGIN
    PERFORM public.cashier_create_app_reentry_v1(source_entry.tournament_id,source_entry.player_id);
    RAISE EXCEPTION 'reentry_fault_not_injected';
   EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'TEST_REENTRY_INSERT_FAULT' THEN RAISE;END IF;
   END;
   IF EXISTS(SELECT 1 FROM public.tournament_registrations WHERE source_entry_id=source_entry.id) THEN
    RAISE EXCEPTION 'fault_left_partial_registration';END IF;
   RAISE SQLSTATE 'PZ001';
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;END;
  BEGIN
   INSERT INTO public.tournament_registrations(tournament_id,player_id,club_id,buy_in,platform_fixed_fee,total_pay,reference_code,status,source_entry_id,used_free_rake)
   VALUES(source_entry.tournament_id,source_entry.player_id,sess.club_id,100000,0,103000,
    'REENTRY-'||substr(replace(gen_random_uuid()::text,'-',''),1,8),'pending',source_entry.id,false);
   r:=public.cashier_create_app_reentry_v1(source_entry.tournament_id,source_entry.player_id);
   IF r->>'error' IS DISTINCT FROM 'legacy_reentry_price_requires_review' THEN RAISE EXCEPTION 'legacy_unpriced_reentry_not_quarantined: %',r;END IF;
   IF EXISTS(SELECT 1 FROM public.tournament_registrations WHERE source_entry_id=source_entry.id AND price_snapshot IS NOT NULL) THEN
    RAISE EXCEPTION 'legacy_pending_price_rewritten';END IF;
   RAISE SQLSTATE 'PZ001';
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;END;
  PERFORM set_config('role','service_role',true);
  r:=public.cashier_create_app_reentry_v1(source_entry.tournament_id,source_entry.player_id);
  IF r->>'ok' IS DISTINCT FROM 'true' OR (r->>'total_pay')::bigint<>103000 OR r->'price_snapshot'->>'free_rake_applied'<>'false'
   OR (r->'price_snapshot'->>'rake')::bigint<>1000 OR (r->'price_snapshot'->>'service_fee')::bigint<>2000 THEN
   RAISE EXCEPTION 'server_priced_reentry_failed: %',r;END IF;
  reg:=(r->>'registration_id')::uuid;saved:=r;
  PERFORM set_config('role','none',true);
  UPDATE public.tournaments SET rake_amount=9000,service_fee_amount=8000 WHERE id=source_entry.tournament_id;
  PERFORM set_config('role','service_role',true);
  r:=public.cashier_create_app_reentry_v1(source_entry.tournament_id,source_entry.player_id);
  IF r->>'registration_id' IS DISTINCT FROM saved->>'registration_id' OR r->'price_snapshot' IS DISTINCT FROM saved->'price_snapshot' OR r->>'already_registered'<>'true' THEN
   RAISE EXCEPTION 'reentry_registration_retry_changed_identity_or_price';END IF;
 ELSE
 INSERT INTO public.tournament_registrations(id,tournament_id,player_id,club_id,buy_in,platform_fixed_fee,total_pay,reference_code,status,source_entry_id,used_free_rake)
 SELECT reg,t.id,source_entry.player_id,t.club_id,t.buy_in,0,t.buy_in+coalesce(t.rake_amount,0)+coalesce(t.service_fee_amount,0),'REENTRY-'||substr(replace(reg::text,'-',''),1,8),'pending',source_entry.id,false
 FROM public.tournaments t WHERE t.id=source_entry.tournament_id;
 END IF;
 PERFORM set_config('role','none',true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 -- Distinct unresolved producer bug: the real Edge insert omits the server
 -- price snapshot required by the cash path. Do not fabricate one to green.
 IF current_setting('test.server_priced_reentry')='true' THEN
  intent:=jsonb_build_object('actor_id',actor,'club_id',sess.club_id,'tournament_id',source_entry.tournament_id,
   'registration_id',reg,'amount',103000,'request_id',gen_random_uuid());
  saved:=public.resolve_cashier_cash_buyin_intent_v1(intent,'record');
  IF saved->>'status'<>'recorded' OR saved->'result'->>'seating_state'<>'seated' THEN
   RAISE EXCEPTION 'paid_reentry_failed: %',saved;END IF;
  IF public.resolve_cashier_cash_buyin_intent_v1(intent,'record') IS DISTINCT FROM saved THEN RAISE EXCEPTION 'paid_reentry_replay_changed';END IF;
  r:=saved->'result';
 ELSE
 r:=public.cashier_record_cash_buyin_v1(reg,100000,gen_random_uuid());
 IF r->>'error' IS DISTINCT FROM 'unverified_registration_price' THEN
  RAISE EXCEPTION 'edge_reentry_price_gap_not_observed: %',r;END IF;
 r:=public.confirm_reentry_and_assign_seat(reg,actor,'random_balanced');
 END IF;
 IF current_setting('test.fixed_reentry')='true' THEN
  IF r->>'ok' IS DISTINCT FROM 'true' OR (r->>'entry_no')::int<>source_entry.entry_no+1 THEN
   RAISE EXCEPTION 'expected_fixed_reentry_failed: %',r;END IF;
  IF (public.get_floor_seat_ticket_v1(source_entry.tournament_id,(r->>'entry_id')::uuid,r->>'receipt_code')->>'ok') IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'reentry_floor_ticket_proof_failed';END IF;
  IF (public.confirm_reentry_and_assign_seat(reg,actor,'random_balanced')->>'entry_id') IS DISTINCT FROM r->>'entry_id' THEN
   RAISE EXCEPTION 'reentry_replay_changed_entry';END IF;
 ELSE
  IF r->>'error' IS DISTINCT FROM 'no_table_available' THEN RAISE EXCEPTION 'expected_unfixed_reentry_gap_not_observed: %',r;END IF;
 END IF;
 PERFORM set_config('role','none',true);
 IF current_setting('test.server_priced_reentry')='true' THEN
  IF (SELECT count(*)=1 AND sum(amount)=103000 FROM public.cashier_buyin_movements WHERE registration_id=reg) IS NOT TRUE THEN
   RAISE EXCEPTION 'paid_reentry_money_not_exactly_once';END IF;
  IF (SELECT free_rake_used FROM public.tournaments WHERE id=source_entry.tournament_id)<>0 THEN
   RAISE EXCEPTION 'reentry_consumed_free_rake_slot';END IF;
 ELSE
 IF EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE registration_id=reg) THEN
  RAISE EXCEPTION 'rejected_unpriced_registration_received_money';END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM floor_private.pick_cashier_canonical_seat_v1(source_entry.tournament_id,'random_balanced')) THEN RAISE EXCEPTION 'canonical_positive_fixture_missing';END IF;
 IF current_setting('test.fixed_reentry')='true' THEN
  IF (SELECT count(*) FROM public.tournament_entries e JOIN public.tournament_seats s ON s.entry_id=e.id AND s.is_active
    JOIN public.tournament_tables t ON t.id=s.tournament_table_id AND t.table_session_id=s.table_session_id
    JOIN public.table_sessions x ON x.id=s.table_session_id AND x.game_table_id=t.game_table_id AND x.closed_at IS NULL
    WHERE e.registration_id=reg AND s.chip_count=20000 AND e.seat_id=s.id)<>1 THEN
   RAISE EXCEPTION 'canonical_reentry_tuple_or_stack_failed';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.tournament_entries WHERE registration_id=reg) THEN RAISE EXCEPTION 'failed_reentry_created_entry';END IF;
 END IF;
END $$;
ROLLBACK;
\if :{?FIXED_REENTRY}
\if :{?SERVER_PRICED_REENTRY}
SELECT 'SERVER_PRICED_REENTRY_CASH_SESSION_TICKET_REPLAY_PASS';
\else
SELECT 'LEGACY_REENTRY_SESSION_TICKET_REPLAY_AND_UNPRICED_CASH_REJECTION_PASS';
\endif
\else
SELECT 'REENTRY_CANONICAL_TABLE_GAP_REPRODUCED_NOT_FIXED';
\endif
