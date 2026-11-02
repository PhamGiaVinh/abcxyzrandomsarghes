-- Parent supplies BEGIN, migration212 and ROLLBACK. Exact retained journey only.
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT (SELECT count(*) FROM public.tournament_seats WHERE tournament_table_id='8ce69933-b2d0-4dfe-962e-86709c6222ac' AND is_active)=8;
 ASSERT to_regprocedure('public.release_bagged_flight_table_v1(uuid,uuid,bigint,text,integer,uuid)') IS NOT NULL,
  'MISSING_CANONICAL_LOCKED_BAG_TABLE_HANDOFF';
END $$;
CREATE TEMP TABLE release177_before AS SELECT
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.tournament_seats s WHERE s.tournament_id='fdf91018-09f3-4cdc-b76a-f688eb216cee') seats,
 (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.tournament_entries e WHERE e.tournament_id='fdf91018-09f3-4cdc-b76a-f688eb216cee') entries,
 (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM public.chip_bag b) bags,
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.flight_tournament_id,r.player_id) FROM public.multi_day_flight_roster_v1 r) roster,
 (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.cashier_buyin_movements c) cash,
 (SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM public.tournament_hands h) hands;
-- Only this transaction models the package enablement, never retain the flag.
UPDATE public.multi_day_package_release_v1 SET enabled=true,
 allowed_club_ids=ARRAY['a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'::uuid] WHERE id;
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
DO $$ BEGIN
 BEGIN
  UPDATE public.tournament_entries SET status='bagged' WHERE id='b15a5fa6-9934-48ce-8517-fe5a25f3c72a';
  RAISE EXCEPTION 'raw_bagged_status_accepted_without_permit';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='bagged_release_permit_required',SQLERRM; END;
END $$;
CREATE FUNCTION pg_temp.release177_close_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id='c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55' AND NEW.closed_at IS NOT NULL THEN
  RAISE EXCEPTION 'release177_injected_close_failure';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER release177_close_fault BEFORE UPDATE OF closed_at ON public.table_sessions
 FOR EACH ROW EXECUTE FUNCTION pg_temp.release177_close_fault();
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.release_bagged_flight_table_v1('8ce69933-b2d0-4dfe-962e-86709c6222ac','c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55',10,'9b83697a48dba8fac105ffbf058147a1',1,'17700000-0000-4000-8000-000000000009');
  RAISE EXCEPTION 'fault_did_not_abort';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='release177_injected_close_failure',SQLERRM; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM public.tournament_seats WHERE tournament_table_id='8ce69933-b2d0-4dfe-962e-86709c6222ac' AND is_active AND status='active')=8;
 ASSERT (SELECT count(*) FROM public.tournament_entries WHERE tournament_id='fdf91018-09f3-4cdc-b76a-f688eb216cee' AND status='seated')=8;
 ASSERT (SELECT closed_at IS NULL AND revision=10 FROM public.table_sessions WHERE id='c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55');
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='3928ef05-30d9-4d8f-915b-08862cfc6fc8' AND released_at IS NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.bagged_flight_release_permits_v1);
 ASSERT NOT EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE request_id='17700000-0000-4000-8000-000000000009');
END $$;
DROP TRIGGER release177_close_fault ON public.table_sessions;
-- Model a receipt from the old close API: it lacks the exact session in its
-- fingerprint. It must not let the release claim this still-open session closed.
INSERT INTO public.table_operation_receipts(actor_id,operation_type,request_id,request_fingerprint,result)
VALUES('675fe35e-60a8-4452-bb90-e79486d54da6','close_tournament_table_v3',
 '17700000-0000-4000-8000-000000000011',
 jsonb_build_object('tournament_table_id','8ce69933-b2d0-4dfe-962e-86709c6222ac'::uuid,'expected_revision',10)::text,
 '{"ok":true,"closed":true}');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.release_bagged_flight_table_v1('8ce69933-b2d0-4dfe-962e-86709c6222ac','c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55',10,'9b83697a48dba8fac105ffbf058147a1',1,'17700000-0000-4000-8000-000000000011');
  RAISE EXCEPTION 'old_close_receipt_accepted_as_new_session_close';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='bagged_release_close_postcondition_failed',SQLERRM; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM public.tournament_seats WHERE tournament_table_id='8ce69933-b2d0-4dfe-962e-86709c6222ac' AND is_active)=8;
 ASSERT (SELECT closed_at IS NULL AND revision=10 FROM public.table_sessions WHERE id='c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55');
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.bagged_flight_release_permits_v1);
END $$;
SET LOCAL request.jwt.claim.sub='3add8ca8-34ff-4f52-8b40-a48c192d3aa5';
SET LOCAL request.jwt.claims='{"sub":"3add8ca8-34ff-4f52-8b40-a48c192d3aa5","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.release_bagged_flight_table_v1('8ce69933-b2d0-4dfe-962e-86709c6222ac','c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55',10,'9b83697a48dba8fac105ffbf058147a1',1,'17700000-0000-4000-8000-000000000010');
  RAISE EXCEPTION 'outsider_accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='bagged_release_actor_or_scope_denied',SQLERRM; END;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; replay jsonb;
BEGIN
 BEGIN
  PERFORM public.release_bagged_flight_table_v1('8ce69933-b2d0-4dfe-962e-86709c6222ac','00000000-0000-4000-8000-000000000000',10,'9b83697a48dba8fac105ffbf058147a1',1,'17700000-0000-4000-8000-000000000012');
  RAISE EXCEPTION 'wrong_session_accepted';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='bagged_release_session_mismatch',SQLERRM; END;
 BEGIN
  PERFORM public.release_bagged_flight_table_v1('8ce69933-b2d0-4dfe-962e-86709c6222ac','c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55',9,'9b83697a48dba8fac105ffbf058147a1',1,'17700000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'stale_revision_accepted';
 EXCEPTION WHEN serialization_failure THEN ASSERT SQLERRM='bagged_release_stale_session',SQLERRM; END;
 BEGIN
  PERFORM public.release_bagged_flight_table_v1('8ce69933-b2d0-4dfe-962e-86709c6222ac','c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55',10,'wrong-hash',1,'17700000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'wrong_roster_accepted';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='bagged_release_flight_not_locked',SQLERRM; END;
 BEGIN
  PERFORM public.release_bagged_flight_table_v1('8ce69933-b2d0-4dfe-962e-86709c6222ac','c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55',10,'9b83697a48dba8fac105ffbf058147a1',0,'17700000-0000-4000-8000-000000000003');
  RAISE EXCEPTION 'wrong_day_accepted';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='bagged_release_day_not_reconciled',SQLERRM; END;
 r:=public.release_bagged_flight_table_v1('8ce69933-b2d0-4dfe-962e-86709c6222ac','c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55',10,'9b83697a48dba8fac105ffbf058147a1',1,'17700000-0000-4000-8000-000000000004');
 ASSERT r->>'ok'='true' AND r->>'closed'='true' AND r->>'status'='bagged',r::text;
 ASSERT (r->>'releasedPlayers')::integer=8 AND (r->>'baggedTotal')::bigint=160000,r::text;
 replay:=public.release_bagged_flight_table_v1('8ce69933-b2d0-4dfe-962e-86709c6222ac','c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55',10,'9b83697a48dba8fac105ffbf058147a1',1,'17700000-0000-4000-8000-000000000004');
 ASSERT replay=r,'replay_did_not_return_exact_receipt';
 BEGIN
  PERFORM public.release_bagged_flight_table_v1('8ce69933-b2d0-4dfe-962e-86709c6222ac','c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55',11,'9b83697a48dba8fac105ffbf058147a1',1,'17700000-0000-4000-8000-000000000004');
  RAISE EXCEPTION 'changed_payload_accepted';
 EXCEPTION WHEN unique_violation THEN ASSERT SQLERRM='IDEMPOTENCY_CONFLICT',SQLERRM; END;
END $$;
RESET ROLE;
DO $$ DECLARE b record;
BEGIN
 SELECT * INTO b FROM release177_before;
 ASSERT (SELECT count(*) FROM public.tournament_seats WHERE tournament_table_id='8ce69933-b2d0-4dfe-962e-86709c6222ac' AND is_active)=0;
 ASSERT (SELECT count(*) FROM public.tournament_seats WHERE tournament_table_id='8ce69933-b2d0-4dfe-962e-86709c6222ac' AND status='bagged')=8;
 ASSERT (SELECT count(*) FROM public.tournament_entries WHERE tournament_id='fdf91018-09f3-4cdc-b76a-f688eb216cee' AND status='bagged')=8;
 ASSERT (SELECT closed_at IS NOT NULL AND revision=11 FROM public.table_sessions WHERE id='c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55');
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE table_session_id='c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55' AND released_at IS NULL);
 ASSERT (SELECT current_state='available' FROM public.dealer_attendance WHERE id='3c1d8c23-a4ff-4be7-b078-e46c26d696ea');
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.bagged_flight_release_permits_v1);
 ASSERT b.bags=(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.chip_bag x);
 ASSERT b.roster=(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.flight_tournament_id,x.player_id) FROM public.multi_day_flight_roster_v1 x);
 ASSERT b.cash=(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.cashier_buyin_movements x);
 ASSERT b.hands=(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_hands x);
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b.seats) old
  LEFT JOIN public.tournament_seats s ON s.id=(old->>'id')::uuid
  WHERE to_jsonb(s)-ARRAY['status','is_active'] IS DISTINCT FROM old-ARRAY['status','is_active']);
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b.entries) old
  LEFT JOIN public.tournament_entries e ON e.id=(old->>'id')::uuid
  WHERE to_jsonb(e)-ARRAY['status','updated_at'] IS DISTINCT FROM old-ARRAY['status','updated_at']);
 -- No enduring exception to the freeze: even the owner cannot mutate a bagged stack.
 BEGIN
  UPDATE public.tournament_entries SET current_stack=current_stack+1
   WHERE id='b15a5fa6-9934-48ce-8517-fe5a25f3c72a';
  RAISE EXCEPTION 'post_release_stack_write_accepted';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_end_play_roster_frozen',SQLERRM; END;
 ASSERT NOT has_table_privilege('authenticated','floor_private.bagged_flight_release_permits_v1','INSERT');
 ASSERT NOT has_function_privilege('anon','public.release_bagged_flight_table_v1(uuid,uuid,bigint,text,integer,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.release_bagged_flight_table_v1(uuid,uuid,bigint,text,integer,uuid)','EXECUTE');
END $$;
SELECT 'BAGGED_RELEASE177_ROLLBACK_QUALIFICATION_PASS';
