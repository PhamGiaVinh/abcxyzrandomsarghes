-- COMPLETE LOCAL QUALIFICATION CANDIDATE; NOT PROMOTED / NOT FOR DB PUSH.
-- CLI scaffold retained in pending because active catalog reconciliation fails.
-- Current timestamp precedes future-dated dependencies; promotion requires a collision-checked forward version.
-- All eight stages are atomic: never apply only part. No fixture or financial seed data.
-- Rollback qualification must run inside BEGIN/ROLLBACK. Durable installation requires verified recovery clone.

-- PACKAGE STAGE 1/8 20261027155124_multiday_individual_rank_confirmation_v1.sql
-- SHA256 b0b83a60f9287eaab87afd5f14e3b2973a1865aba24f37910061dbc329182138
-- LOCAL SOURCE CANDIDATE. Individual rank only: no obligation or payment yet.
-- Exact qualified ranking296 dependency; apply only inside guarded local tests.
-- Do not replay by filename order against future-dated repository migrations.
DO $$ BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='floor_private.tournament_ranking_source296(uuid)'::regprocedure))
  IS DISTINCT FROM '4a7284cc9c03eea50f9580cc8764614d'
 OR to_regclass('private.multi_day_individual_results_v1') IS NOT NULL
 OR to_regprocedure('private.multi_day_individual_rank_source_v1(uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'individual_rank_dependency_drift_or_collision';END IF;
END $$;

CREATE TABLE private.multi_day_individual_results_v1(
 event_id uuid NOT NULL REFERENCES public.tournament_events(id),
 participation_id uuid PRIMARY KEY REFERENCES public.multi_day_final_participations_v1(id),
 tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
 entry_id uuid NOT NULL UNIQUE REFERENCES public.tournament_entries(id),
 player_id uuid NOT NULL,entry_no integer NOT NULL,
 finished_place integer NOT NULL CHECK(finished_place>1),
 source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{32}$'),
 source_snapshot jsonb NOT NULL,actor_id uuid NOT NULL REFERENCES auth.users(id),
 request_id uuid NOT NULL,confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(event_id,finished_place)
);
ALTER TABLE private.multi_day_individual_results_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.multi_day_individual_results_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE private.multi_day_individual_rank_requests_v1(
 actor_id uuid NOT NULL REFERENCES auth.users(id),request_id uuid NOT NULL,
 event_id uuid NOT NULL REFERENCES public.tournament_events(id),
 payload jsonb NOT NULL,receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE private.multi_day_individual_rank_requests_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.multi_day_individual_rank_requests_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER individual_result_immutable BEFORE UPDATE OR DELETE ON private.multi_day_individual_results_v1
 FOR EACH ROW EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();
CREATE TRIGGER individual_rank_request_immutable BEFORE UPDATE OR DELETE ON private.multi_day_individual_rank_requests_v1
 FOR EACH ROW EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();

CREATE FUNCTION private.multi_day_individual_rank_source_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE event public.tournament_events; final public.tournaments; qualification jsonb;
 ranking jsonb;participants jsonb;body jsonb;field integer;
BEGIN
 SELECT * INTO event FROM public.tournament_events WHERE id=p_event_id;
 SELECT * INTO final FROM public.tournaments WHERE id=event.final_tournament_id;
 SELECT to_jsonb(q) INTO qualification FROM public.multi_day_qualification_locks_v1 q WHERE event_id=p_event_id;
 IF event.id IS NULL OR final.phase IS DISTINCT FROM 'final' OR final.event_id IS DISTINCT FROM event.id
 OR final.club_id IS DISTINCT FROM event.club_id OR final.deleted_at IS NOT NULL OR qualification IS NULL
 THEN RAISE EXCEPTION 'individual_rank_qualification_required';END IF;
 SELECT count(*),jsonb_agg(jsonb_build_object('participationId',p.id,'playerId',p.player_id,
  'entryId',s.entry_id,'entryNo',e.entry_no) ORDER BY p.id) INTO field,participants
 FROM public.multi_day_final_participations_v1 p
 LEFT JOIN public.multi_day_final_seatings_v1 s ON s.participation_id=p.id
 LEFT JOIN public.tournament_entries e ON e.id=s.entry_id
 WHERE p.event_id=event.id;
 IF field<2 OR EXISTS(SELECT 1 FROM public.multi_day_final_participations_v1 p
  LEFT JOIN public.multi_day_final_seatings_v1 s ON s.participation_id=p.id
  LEFT JOIN public.tournament_entries e ON e.id=s.entry_id
  WHERE p.event_id=event.id AND (s.entry_id IS NULL OR e.id IS NULL OR e.tournament_id<>final.id
   OR e.player_id<>p.player_id OR p.final_tournament_id<>final.id))
 OR (SELECT count(*) FROM public.tournament_entries WHERE tournament_id=final.id)<>field
 THEN RAISE EXCEPTION 'individual_rank_field_identity_changed';END IF;
 ranking:=floor_private.tournament_ranking_source296(final.id);
 IF (ranking->>'field')::integer<>field THEN RAISE EXCEPTION 'individual_rank_field_identity_changed';END IF;
 body:=jsonb_build_object('eventId',event.id,'tournamentId',final.id,'qualification',qualification,
  'participants',participants,'rankingHash',ranking->>'sourceHash');
 RETURN jsonb_build_object('eventId',event.id,'tournamentId',final.id,'field',field,
  'participants',participants,'ranking',ranking,'sourceHash',md5(body::text),'source',body,
  'individualResults',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.finished_place),'[]'::jsonb)
    FROM private.multi_day_individual_results_v1 r WHERE r.event_id=event.id));
END $$;
REVOKE ALL ON FUNCTION private.multi_day_individual_rank_source_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_multi_day_individual_rank_review_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();club uuid;
BEGIN
 SELECT club_id INTO club FROM public.tournament_events WHERE id=p_event_id;
 IF actor IS NULL OR club IS NULL OR NOT(EXISTS(SELECT 1 FROM public.clubs WHERE id=club AND owner_id=actor)
  OR public.is_club_floor(actor,club)) THEN RAISE EXCEPTION 'individual_rank_actor_denied' USING ERRCODE='42501';END IF;
 RETURN private.multi_day_individual_rank_source_v1(p_event_id);
END $$;
REVOKE ALL ON FUNCTION public.get_multi_day_individual_rank_review_v1(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_multi_day_individual_rank_review_v1(uuid) TO authenticated;

CREATE FUNCTION public.confirm_multi_day_individual_ranks_v1(p_event_id uuid,p_expected_source_hash text,
 p_ordered_busted_entry_ids uuid[],p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();club uuid;tour uuid;s jsonb;r jsonb;payload jsonb;receipt jsonb;
 prior private.multi_day_individual_rank_requests_v1;item record;frozen private.multi_day_individual_results_v1;
 expected_ids uuid[];provided_ids uuid[];survivors integer;field integer;participant jsonb;entry public.tournament_entries;
BEGIN
 SELECT club_id,final_tournament_id INTO club,tour FROM public.tournament_events WHERE id=p_event_id;
 IF actor IS NULL OR club IS NULL OR NOT(EXISTS(SELECT 1 FROM public.clubs WHERE id=club AND owner_id=actor)
  OR public.is_club_floor(actor,club)) THEN RAISE EXCEPTION 'individual_rank_actor_denied' USING ERRCODE='42501';END IF;
 IF p_request_id IS NULL OR p_expected_source_hash IS NULL OR p_expected_source_hash!~'^[a-f0-9]{32}$'
 OR p_ordered_busted_entry_ids IS NULL OR cardinality(p_ordered_busted_entry_ids)=0
 THEN RAISE EXCEPTION 'individual_rank_request_invalid';END IF;
 payload:=jsonb_build_object('eventId',p_event_id,'sourceHash',p_expected_source_hash,'orderedBustedEntryIds',p_ordered_busted_entry_ids);
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM private.multi_day_individual_rank_requests_v1 WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  RETURN prior.receipt;
 END IF;
 PERFORM 1 FROM public.tournament_events WHERE id=p_event_id FOR UPDATE;
 PERFORM 1 FROM public.tournaments WHERE id=tour FOR UPDATE;
 PERFORM 1 FROM public.tournament_entries WHERE tournament_id=tour ORDER BY id FOR UPDATE;
 s:=public.get_multi_day_individual_rank_review_v1(p_event_id);r:=s->'ranking';
 IF s->>'sourceHash' IS DISTINCT FROM p_expected_source_hash THEN RAISE EXCEPTION 'individual_rank_source_changed';END IF;
 field:=(s->>'field')::integer;survivors:=(r->>'survivors')::integer;
 IF survivors<1 OR survivors>=field OR (r->>'activeHand')::boolean OR (r->>'evidencePending')::boolean
 OR (r->>'hasOfficial')::boolean
 OR EXISTS(SELECT 1 FROM public.tournament_close_report WHERE tournament_id=tour)
 OR EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id)
 THEN RAISE EXCEPTION 'individual_rank_not_ready';END IF;
 SELECT array_agg((x->>'entryId')::uuid ORDER BY x->>'entryId') INTO expected_ids
 FROM jsonb_array_elements(r->'entries')x WHERE x->>'status'='busted';
 SELECT array_agg(x ORDER BY x) INTO provided_ids FROM unnest(p_ordered_busted_entry_ids)x;
 IF provided_ids IS DISTINCT FROM expected_ids THEN RAISE EXCEPTION 'individual_rank_entries_mismatch';END IF;
 -- Manual Floor busts may legitimately have no provisional bust_order. The
 -- operator supplies the complete explicit order; never infer it from time/UUID.
 -- Preserve every known separate-hand chronology and any earlier frozen rank.
 IF EXISTS(SELECT 1 FROM unnest(p_ordered_busted_entry_ids) WITH ORDINALITY a(id,n)
 JOIN public.tournament_entries ea ON ea.id=a.id
 CROSS JOIN unnest(p_ordered_busted_entry_ids) WITH ORDINALITY b(id,n)
 JOIN public.tournament_entries eb ON eb.id=b.id
 WHERE a.n<b.n AND ea.bust_order<eb.bust_order AND NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(r->'simultaneousGroups')g
  WHERE g->'entryIds' ? ea.id::text AND g->'entryIds' ? eb.id::text))
 THEN RAISE EXCEPTION 'individual_rank_chronology_mismatch';END IF;
 FOR item IN SELECT id,n FROM unnest(p_ordered_busted_entry_ids) WITH ORDINALITY a(id,n) LOOP
  SELECT * INTO STRICT entry FROM public.tournament_entries WHERE id=item.id;
  SELECT x INTO STRICT participant FROM jsonb_array_elements(s->'participants')x WHERE x->>'entryId'=entry.id::text;
  SELECT * INTO frozen FROM private.multi_day_individual_results_v1 WHERE participation_id=(participant->>'participationId')::uuid;
  IF FOUND THEN
   IF frozen.entry_id<>entry.id OR frozen.player_id<>entry.player_id OR frozen.entry_no<>entry.entry_no
    OR frozen.finished_place<>survivors+item.n THEN RAISE EXCEPTION 'individual_rank_frozen_conflict';END IF;
  ELSE
   INSERT INTO private.multi_day_individual_results_v1(event_id,participation_id,tournament_id,entry_id,player_id,
    entry_no,finished_place,source_hash,source_snapshot,actor_id,request_id)
   VALUES(p_event_id,(participant->>'participationId')::uuid,tour,entry.id,entry.player_id,entry.entry_no,
    survivors+item.n,p_expected_source_hash,s,actor,p_request_id);
  END IF;
 END LOOP;
 receipt:=jsonb_build_object('ok',true,'outcome','recorded','eventId',p_event_id,'requestId',p_request_id,
  'sourceHash',p_expected_source_hash,'individualResults',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.finished_place)
   FROM private.multi_day_individual_results_v1 x WHERE event_id=p_event_id),'paymentExecution','NOT_PERFORMED');
 INSERT INTO private.multi_day_individual_rank_requests_v1(actor_id,request_id,event_id,payload,receipt)
 VALUES(actor,p_request_id,p_event_id,payload,receipt);
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.confirm_multi_day_individual_ranks_v1(uuid,text,uuid[],uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.confirm_multi_day_individual_ranks_v1(uuid,text,uuid[],uuid) TO authenticated;

CREATE FUNCTION public.get_multi_day_individual_rank_receipt_v1(p_event_id uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();prior private.multi_day_individual_rank_requests_v1;
BEGIN
 PERFORM public.get_multi_day_individual_rank_review_v1(p_event_id);
 SELECT * INTO prior FROM private.multi_day_individual_rank_requests_v1 WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND AND prior.event_id<>p_event_id THEN RAISE EXCEPTION 'individual_rank_receipt_scope_conflict';END IF;
 RETURN jsonb_build_object('ok',true,'outcome',CASE WHEN prior.request_id IS NULL THEN 'not_found' ELSE 'recorded' END,
  'receipt',prior.receipt);
END $$;
REVOKE ALL ON FUNCTION public.get_multi_day_individual_rank_receipt_v1(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_multi_day_individual_rank_receipt_v1(uuid,uuid) TO authenticated;

CREATE FUNCTION private.multi_day_individual_result_entry_fence_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE frozen private.multi_day_individual_results_v1;
BEGIN
 IF TG_OP='INSERT' THEN
  IF EXISTS(SELECT 1 FROM private.multi_day_individual_results_v1 WHERE tournament_id=NEW.tournament_id AND player_id=NEW.player_id)
  THEN RAISE EXCEPTION 'individual_result_immutable';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO frozen FROM private.multi_day_individual_results_v1 WHERE entry_id=OLD.id;
 IF FOUND THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'individual_result_immutable';END IF;
  IF NEW.id<>frozen.entry_id OR NEW.tournament_id<>frozen.tournament_id OR NEW.player_id IS DISTINCT FROM frozen.player_id
   OR NEW.entry_no IS DISTINCT FROM frozen.entry_no OR NEW.status IS DISTINCT FROM 'busted'
   OR NEW.registration_id IS DISTINCT FROM OLD.registration_id OR NEW.member_id IS DISTINCT FROM OLD.member_id
   OR NEW.bust_order IS DISTINCT FROM OLD.bust_order
   OR NEW.current_stack IS DISTINCT FROM OLD.current_stack
   OR NEW.finished_place IS NOT NULL AND NEW.finished_place<>frozen.finished_place
  THEN RAISE EXCEPTION 'individual_result_immutable';END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_individual_result_entry_fence_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_individual_result_entry_fence BEFORE INSERT OR UPDATE OR DELETE ON public.tournament_entries
 FOR EACH ROW EXECUTE FUNCTION private.multi_day_individual_result_entry_fence_v1();


-- PACKAGE STAGE 2/8 20261027160743_multiday_individual_results_finalization_v1.sql
-- SHA256 650a0d8c3695b60ab86d1375cb64255bc75e5572aaeb655e79424cfeeb9d01f2
-- LOCAL candidate; requires individual rank package20261027155124.
-- Exact baseline only. Execute in an explicit guarded transaction.
DO $$ BEGIN
 IF to_regclass('private.multi_day_individual_results_v1') IS NULL
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.finalize_tournament_results(uuid)'::regprocedure))
   IS DISTINCT FROM '6dbe0cca5584570defa8c07acc5693c5'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='floor_private.felt_official_results_close_status_v1(uuid)'::regprocedure))
   IS DISTINCT FROM '8c4d35c69aba350d436f6f9ae43ff29e'
 THEN RAISE EXCEPTION 'individual_finalization_dependency_drift';END IF;
END $$;

CREATE FUNCTION private.multi_day_individual_close_state_v1(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE event_id uuid;s jsonb;ranking jsonb;field integer;state text;
BEGIN
 SELECT t.event_id INTO event_id FROM public.tournaments t WHERE t.id=p_tournament_id;
 s:=private.multi_day_individual_rank_source_v1(event_id);ranking:=s->'ranking';field:=(s->>'field')::integer;
 IF (ranking->>'survivors')::integer<>1 THEN state:='official_results_not_finished';
 ELSIF (ranking->>'activeHand')::boolean OR (ranking->>'evidencePending')::boolean THEN state:='ranking_hand_evidence_pending';
 ELSIF (SELECT count(*) FROM private.multi_day_individual_results_v1 WHERE tournament_id=p_tournament_id)<>field-1
 OR EXISTS(SELECT 1 FROM public.tournament_entries e LEFT JOIN private.multi_day_individual_results_v1 f ON f.entry_id=e.id
  WHERE e.tournament_id=p_tournament_id AND ((e.status='busted' AND (f.entry_id IS NULL OR f.player_id<>e.player_id
   OR f.entry_no<>e.entry_no OR f.tournament_id<>e.tournament_id OR f.finished_place>field))
   OR (coalesce(e.status,'')<>'busted' AND f.entry_id IS NOT NULL)))
 THEN state:='individual_results_confirmation_required';
 ELSIF EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id=p_tournament_id AND finished_place IS NOT NULL) THEN
  IF EXISTS(SELECT 1 FROM public.tournament_entries e LEFT JOIN private.multi_day_individual_results_v1 f ON f.entry_id=e.id
    WHERE e.tournament_id=p_tournament_id AND e.finished_place IS DISTINCT FROM CASE WHEN e.status='busted' THEN f.finished_place ELSE 1 END)
  THEN state:='official_results_incomplete';ELSE state:='preserved';END IF;
 ELSE state:='ready_to_finalize';END IF;
 RETURN jsonb_build_object('field',field,'status',state,'eventId',event_id);
END $$;
REVOKE ALL ON FUNCTION private.multi_day_individual_close_state_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.finalize_multi_day_individual_results_v1(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE state jsonb;changed integer;
BEGIN
 -- Called only after canonical finalizer acquired tournament lock and checked
 -- authority. Do not acquire event after tournament: confirmation locks event
 -- then tournament. Tournament/entry locks serialize both without a cycle.
 PERFORM 1 FROM public.tournament_entries WHERE tournament_id=p_tournament_id ORDER BY id FOR UPDATE;
 state:=private.multi_day_individual_close_state_v1(p_tournament_id);
 IF state->>'status'='preserved' THEN
  RETURN jsonb_build_object('ok',true,'outcome','preserved','field',state->'field','survivors',1);
 END IF;
 IF state->>'status'<>'ready_to_finalize' THEN RETURN jsonb_build_object('ok',false,'error',state->>'status');END IF;
 UPDATE public.tournament_entries e SET finished_place=f.finished_place
 FROM private.multi_day_individual_results_v1 f WHERE f.entry_id=e.id AND e.tournament_id=p_tournament_id
  AND e.finished_place IS DISTINCT FROM f.finished_place;
 GET DIAGNOSTICS changed=ROW_COUNT;
 UPDATE public.tournament_entries SET finished_place=1 WHERE tournament_id=p_tournament_id
  AND coalesce(status,'')<>'busted' AND finished_place IS DISTINCT FROM 1;
 IF private.multi_day_individual_close_state_v1(p_tournament_id)->>'status'<>'preserved'
 THEN RAISE EXCEPTION 'individual_results_finalization_mismatch';END IF;
 RETURN jsonb_build_object('ok',true,'field',state->'field','places_set',changed+1,'survivors',1,'individual_results',true);
END $$;
REVOKE ALL ON FUNCTION private.finalize_multi_day_individual_results_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE fn regprocedure;definition text;acl aclitem[];anchor text;
BEGIN
 fn:='public.finalize_tournament_results(uuid)'::regprocedure;
 SELECT pg_get_functiondef(fn),proacl INTO definition,acl FROM pg_proc WHERE oid=fn;
 anchor:='  -- Guard (post-audit P2):';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_finalizer_anchor_drift';END IF;
 EXECUTE replace(definition,anchor,$new$  IF EXISTS(SELECT 1 FROM private.multi_day_individual_results_v1 WHERE tournament_id=p_tournament_id) THEN
    RETURN private.finalize_multi_day_individual_results_v1(p_tournament_id);
  END IF;
$new$||anchor);
 IF (SELECT proacl FROM pg_proc WHERE oid=fn) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'individual_finalizer_acl_drift';END IF;
 fn:='floor_private.felt_official_results_close_status_v1(uuid)'::regprocedure;
 SELECT pg_get_functiondef(fn),proacl INTO definition,acl FROM pg_proc WHERE oid=fn;
 anchor:='  WHEN all_ranked>0 THEN';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_close_status_anchor_drift';END IF;
 EXECUTE replace(definition,anchor,$new$  WHEN EXISTS(SELECT 1 FROM private.multi_day_individual_results_v1 WHERE tournament_id=p_tournament_id)
    THEN private.multi_day_individual_close_state_v1(p_tournament_id)->>'status'
$new$||anchor);
 IF (SELECT proacl FROM pg_proc WHERE oid=fn) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'individual_close_status_acl_drift';END IF;
END $patch$;


-- PACKAGE STAGE 3/8 20261027162130_multiday_shared_obligation_amount_v1.sql
-- SHA256 a5a5e6bcfc532e35bae2075b196df6580891b984488d5c63e084f070ee9bf827
-- LOCAL candidate. Shared existing arithmetic; no obligation/payment writer.
-- Execute only inside an explicit guarded transaction.
DO $$ BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='private.multi_day_payout_evaluate_v2(uuid,jsonb)'::regprocedure))
  IS DISTINCT FROM 'a75c2bfc3d7bf05d5ee05d830bda38dc'
 OR to_regclass('private.multi_day_individual_results_v1') IS NULL
 OR to_regprocedure('private.multi_day_obligation_amount_v1(numeric,numeric,numeric)') IS NOT NULL
 THEN RAISE EXCEPTION 'individual_obligation_amount_dependency_drift';END IF;
END $$;
CREATE FUNCTION private.multi_day_obligation_amount_v1(p_rank_award numeric,p_floor numeric,p_nonselected_min_cash numeric)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE amount numeric;
BEGIN
 IF p_rank_award IS NULL OR p_floor IS NULL OR p_nonselected_min_cash IS NULL
 OR p_rank_award::text IN('NaN','Infinity','-Infinity') OR p_floor::text IN('NaN','Infinity','-Infinity')
 OR p_nonselected_min_cash::text IN('NaN','Infinity','-Infinity')
 OR least(p_rank_award,p_floor,p_nonselected_min_cash)<0
 OR p_rank_award<>trunc(p_rank_award) OR p_floor<>trunc(p_floor) OR p_nonselected_min_cash<>trunc(p_nonselected_min_cash)
 THEN RAISE EXCEPTION 'multi_day_payout_fractional_or_invalid_obligation' USING ERRCODE='23514';END IF;
 amount:=greatest(p_rank_award,p_floor)+p_nonselected_min_cash;
 IF amount>9007199254740991 THEN RAISE EXCEPTION 'multi_day_payout_amount_overflow' USING ERRCODE='22003';END IF;
 RETURN amount;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_obligation_amount_v1(numeric,numeric,numeric) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE fn regprocedure:='private.multi_day_payout_evaluate_v2(uuid,jsonb)'::regprocedure;
 definition text;acl aclitem[];anchor text:='v_obligation:=greatest(v_per_player::numeric,v_floor)+v_min_cash;';
BEGIN
 SELECT pg_get_functiondef(fn),proacl INTO definition,acl FROM pg_proc WHERE oid=fn;
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_obligation_amount_anchor_drift';END IF;
 EXECUTE replace(definition,anchor,'v_obligation:=private.multi_day_obligation_amount_v1(v_per_player::numeric,v_floor,v_min_cash);');
 IF (SELECT proacl FROM pg_proc WHERE oid=fn) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'individual_obligation_amount_acl_drift';END IF;
END $patch$;

CREATE FUNCTION private.multi_day_individual_obligation_quote_v1(p_participation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE frozen private.multi_day_individual_results_v1;participant public.multi_day_final_participations_v1;
 entry public.tournament_entries;prize public.tournament_prizes;extra numeric;amount numeric;context jsonb;
BEGIN
 SELECT * INTO frozen FROM private.multi_day_individual_results_v1 WHERE participation_id=p_participation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'individual_obligation_final_rank_required';END IF;
 SELECT * INTO STRICT participant FROM public.multi_day_final_participations_v1 WHERE id=p_participation_id;
 SELECT * INTO STRICT entry FROM public.tournament_entries WHERE id=frozen.entry_id;
 IF participant.event_id<>frozen.event_id OR participant.player_id<>frozen.player_id
 OR participant.final_tournament_id<>frozen.tournament_id OR entry.player_id<>frozen.player_id
 OR entry.entry_no<>frozen.entry_no OR entry.tournament_id<>frozen.tournament_id OR entry.status<>'busted'
 OR entry.finished_place IS NOT NULL AND entry.finished_place<>frozen.finished_place
 THEN RAISE EXCEPTION 'individual_obligation_result_identity_changed';END IF;
 -- This staged quote requires a persisted rank amount. Missing non-ITM rows
 -- stay unavailable here until the shared funding/ITM source is integrated.
 IF (SELECT count(*) FROM public.tournament_prizes WHERE tournament_id=frozen.tournament_id AND position=frozen.finished_place)<>1
 THEN RAISE EXCEPTION 'individual_obligation_prize_amount_missing';END IF;
 SELECT * INTO STRICT prize FROM public.tournament_prizes WHERE tournament_id=frozen.tournament_id AND position=frozen.finished_place;
 SELECT coalesce(sum(amount_vnd),0) INTO extra FROM public.multi_day_nonselected_min_cash_v1
 WHERE participation_id=p_participation_id AND status='PENDING_FUNDING';
 IF participant.policy='SUM_STACKS' AND extra<>0 THEN RAISE EXCEPTION 'multi_day_payout_sum_stacks_extra_cash';END IF;
 amount:=private.multi_day_obligation_amount_v1(prize.amount,participant.participation_floor_vnd,extra);
 context:=jsonb_build_object('eventId',frozen.event_id,'participationId',p_participation_id,'entryId',entry.id,
  'playerId',frozen.player_id,'rank',frozen.finished_place,'rankSourceHash',frozen.source_hash,
  'prizeRow',to_jsonb(prize),'rankAwardVnd',prize.amount,'participationFloorVnd',participant.participation_floor_vnd,
  'nonselectedBagMinCashVnd',extra,'totalVnd',amount);
 RETURN context||jsonb_build_object('quoteHash',md5(context::text),'fundingState','NOT_VERIFIED',
  'obligationPersistence','NOT_PERFORMED','paymentExecution','NOT_PERFORMED');
END $$;
REVOKE ALL ON FUNCTION private.multi_day_individual_obligation_quote_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;


-- PACKAGE STAGE 4/8 20261027162844_multiday_verified_funding_projection_v1.sql
-- SHA256 2e8f44704b5ce01608eb8039c723ff5f890ca32dc60e72095f723dbb04b780c1
-- LOCAL source candidate. Verified incoming source projection only, no reserve,
-- obligation, outgoing payment or global finalization. Guarded transaction only.
DO $build$
DECLARE definition text;prefix text;identity_check text;price_checks text;revisions text;
 result_start text:=' IF EXISTS(SELECT 1 FROM public.multi_day_final_participations_v1 p';
 result_end text:=' IF EXISTS(SELECT 1 FROM public.multi_day_final_adjustments_v1 a';
 payment_start text:=' SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('||chr(10)||'    ''id'',m.id,''playerId'',m.recipient_ref,''amountVnd'',m.prize_amount,''status'',m.status)';
 result_pos integer;adjustment_pos integer;payment_pos integer;revision_pos integer;input_pos integer;
BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='private.multi_day_payout_evaluate_v2(uuid,jsonb)'::regprocedure))
   IS DISTINCT FROM 'f24aa8981ff331dae9a9142f85603621'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.multi_day_payout_preview_v1(uuid)'::regprocedure))
   IS DISTINCT FROM '391d3632fea66c8b276a478b2d8a168c'
 OR to_regprocedure('private.multi_day_funding_evaluate_v1(uuid,jsonb)') IS NOT NULL
 OR to_regprocedure('private.multi_day_verified_funding_source_v1(uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'individual_funding_source_dependency_drift';END IF;
 definition:=pg_get_functiondef('private.multi_day_payout_evaluate_v2(uuid,jsonb)'::regprocedure);
 result_pos:=strpos(definition,result_start);adjustment_pos:=strpos(definition,result_end);
 payment_pos:=strpos(definition,payment_start);revision_pos:=strpos(definition,' -- A seeded historical row');
 input_pos:=strpos(definition,' v_input_hash:=');
 IF result_pos=0 OR adjustment_pos<=result_pos OR payment_pos<=adjustment_pos
 OR revision_pos<=payment_pos OR input_pos<=revision_pos
 THEN RAISE EXCEPTION 'individual_funding_source_anchor_drift';END IF;
 prefix:=left(definition,result_pos-1);
 identity_check:=substring(definition FROM result_pos FOR adjustment_pos-result_pos);
 IF array_length(string_to_array(identity_check,'e.finished_place IS NULL'),1)<>2
 OR array_length(string_to_array(identity_check,'e.finished_place IS NOT NULL'),1)<>2
 THEN RAISE EXCEPTION 'individual_funding_identity_anchor_drift';END IF;
 identity_check:=replace(identity_check,'e.finished_place IS NULL','e.id IS NULL');
 identity_check:=replace(identity_check,' AND e.finished_place IS NOT NULL','');
 identity_check:=replace(identity_check,'multi_day_payout_results_not_ready','multi_day_funding_participation_identity_invalid');
 price_checks:=substring(definition FROM adjustment_pos FOR payment_pos-adjustment_pos);
 revisions:=substring(definition FROM revision_pos FOR input_pos-revision_pos);
 prefix:=replace(prefix,'FUNCTION private.multi_day_payout_evaluate_v2(', 'FUNCTION private.multi_day_funding_evaluate_v1(');
 -- Same canonical paid-source classification, overlay totals, qualification,
 -- persisted prize validation and revision expressions. No invented results.
 EXECUTE prefix||identity_check||price_checks||$tail$
 IF p_proposed_rows IS NOT NULL THEN RAISE EXCEPTION 'individual_funding_persisted_prizes_required';END IF;
 IF EXISTS(SELECT 1 FROM generate_series(1,v_itm_places)n LEFT JOIN public.tournament_prizes q
   ON q.tournament_id=v_rules.final_tournament_id AND q.position=n
   GROUP BY n HAVING count(q.position)<>1 OR count(q.amount)<>1)
 THEN RAISE EXCEPTION 'multi_day_payout_rank_amount_missing' USING ERRCODE='23514';END IF;
$tail$||revisions||$tail$
 v_input_hash:=md5(jsonb_build_object('rules',v_rules_version,'funding',v_funding_revision,
  'qualification',v_qualification_revision,'prizes',v_prize_rows)::text);
 IF greatest(v_direct,v_transfer_pool,v_fee,v_recorded_overlay)>9007199254740991
 THEN RAISE EXCEPTION 'multi_day_payout_amount_overflow' USING ERRCODE='22003';END IF;
 RETURN jsonb_build_object('ok',true,'eventId',p_event_id,'finalTournamentId',v_rules.final_tournament_id,
  'state','INCOMING_SOURCE_VERIFIED','itmPlaces',v_itm_places,'rulesVersion',v_rules_version,
  'fundingRevision',v_funding_revision,'qualificationRevision',v_qualification_revision,'sourceInputHash',v_input_hash,
  'directPoolVnd',v_direct::bigint,'transferPoolVnd',v_transfer_pool::bigint,'feesVnd',v_fee::bigint,
  'recordedOverlayVnd',v_recorded_overlay::bigint,'prizePositions',v_prize_rows,
  'obligationPersistence','NOT_PERFORMED','paymentExecution','NOT_PERFORMED',
  'sourceSnapshot',jsonb_build_object('registrations',v_source,'overlayRecords',v_overlay_rows));
END $function$;
$tail$;
 definition:=pg_get_functiondef('public.multi_day_payout_preview_v1(uuid)'::regprocedure);
 IF array_length(string_to_array(definition,'v_result:=private.multi_day_payout_unverified_v1(p_event_id);'),1)<>2
 THEN RAISE EXCEPTION 'individual_funding_bank_wrapper_anchor_drift';END IF;
 definition:=replace(definition,'FUNCTION public.multi_day_payout_preview_v1(', 'FUNCTION private.multi_day_verified_funding_source_v1(');
 definition:=replace(definition,'v_result:=private.multi_day_payout_unverified_v1(p_event_id);',
   'v_result:=private.multi_day_funding_evaluate_v1(p_event_id,NULL);');
 definition:=replace(definition,'payoutInputHash','sourceInputHash');
 EXECUTE definition;
END $build$;
REVOKE ALL ON FUNCTION private.multi_day_funding_evaluate_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.multi_day_verified_funding_source_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;


-- PACKAGE STAGE 5/8 20261027164129_multiday_individual_obligation_commit_v1.sql
-- SHA256 c1c939fefe5e2a389e5f8ccc67e594f31a4c53d91a4a84f92c608ef13c0801ed
-- LOCAL CANDIDATE. Immutable individual obligations only; NO payment writer.
-- Explicit guarded transaction; do not durably apply this partial package.
DO $$ BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='private.multi_day_verified_funding_source_v1(uuid)'::regprocedure))
   IS DISTINCT FROM '99ce1551b75923a53fb9ac123a8db23b'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='private.multi_day_individual_obligation_quote_v1(uuid)'::regprocedure))
   IS DISTINCT FROM '4278e6f3988ee6ed17236baf5eae63b1'
 OR to_regclass('private.multi_day_individual_obligations_v1') IS NOT NULL
 THEN RAISE EXCEPTION 'individual_obligation_commit_dependency_drift';END IF;
END $$;

-- Same canonical amount rule, including explicit zero outside ITM when that
-- rank has no persisted row. A missing ITM row is never treated as zero.
CREATE OR REPLACE FUNCTION private.multi_day_individual_obligation_quote_v1(p_participation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE frozen private.multi_day_individual_results_v1;participant public.multi_day_final_participations_v1;
 entry public.tournament_entries;prize public.tournament_prizes;extra numeric;amount numeric;context jsonb;funding jsonb;award numeric;
BEGIN
 SELECT * INTO frozen FROM private.multi_day_individual_results_v1 WHERE participation_id=p_participation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'individual_obligation_final_rank_required';END IF;
 SELECT * INTO STRICT participant FROM public.multi_day_final_participations_v1 WHERE id=p_participation_id;
 SELECT * INTO STRICT entry FROM public.tournament_entries WHERE id=frozen.entry_id;
 IF participant.event_id<>frozen.event_id OR participant.player_id<>frozen.player_id
 OR participant.final_tournament_id<>frozen.tournament_id OR entry.player_id<>frozen.player_id
 OR entry.entry_no<>frozen.entry_no OR entry.tournament_id<>frozen.tournament_id OR entry.status<>'busted'
 OR entry.finished_place IS NOT NULL AND entry.finished_place<>frozen.finished_place
 THEN RAISE EXCEPTION 'individual_obligation_result_identity_changed';END IF;
 funding:=private.multi_day_verified_funding_source_v1(frozen.event_id);
 IF (SELECT count(*) FROM public.tournament_prizes WHERE tournament_id=frozen.tournament_id AND position=frozen.finished_place)>1
 THEN RAISE EXCEPTION 'individual_obligation_prize_amount_missing';END IF;
 SELECT * INTO prize FROM public.tournament_prizes WHERE tournament_id=frozen.tournament_id AND position=frozen.finished_place;
 IF NOT FOUND THEN
  IF frozen.finished_place<=(funding->>'itmPlaces')::integer THEN RAISE EXCEPTION 'individual_obligation_prize_amount_missing';END IF;
  award:=0;
 ELSE award:=prize.amount;END IF;
 SELECT coalesce(sum(amount_vnd),0) INTO extra FROM public.multi_day_nonselected_min_cash_v1
 WHERE participation_id=p_participation_id AND status='PENDING_FUNDING';
 IF participant.policy='SUM_STACKS' AND extra<>0 THEN RAISE EXCEPTION 'multi_day_payout_sum_stacks_extra_cash';END IF;
 amount:=private.multi_day_obligation_amount_v1(award,participant.participation_floor_vnd,extra);
 context:=jsonb_build_object('eventId',frozen.event_id,'participationId',p_participation_id,'entryId',entry.id,
  'playerId',frozen.player_id,'rank',frozen.finished_place,'rankSourceHash',frozen.source_hash,
  'prizeRow',CASE WHEN prize.id IS NULL THEN NULL ELSE to_jsonb(prize) END,'rankAwardVnd',award,
  'participationFloorVnd',participant.participation_floor_vnd,'nonselectedBagMinCashVnd',extra,'totalVnd',amount);
 RETURN context||jsonb_build_object('quoteHash',md5(context::text),'fundingState','NOT_VERIFIED',
  'obligationPersistence','NOT_PERFORMED','paymentExecution','NOT_PERFORMED');
END $$;

CREATE TABLE private.multi_day_individual_obligations_v1(
 participation_id uuid PRIMARY KEY REFERENCES private.multi_day_individual_results_v1(participation_id),
 event_id uuid NOT NULL REFERENCES public.tournament_events(id),
 tournament_id uuid NOT NULL REFERENCES public.tournaments(id),entry_id uuid NOT NULL REFERENCES public.tournament_entries(id),
 player_id uuid NOT NULL,finished_place integer NOT NULL CHECK(finished_place>1),
 amount_vnd bigint NOT NULL CHECK(amount_vnd BETWEEN 0 AND 9007199254740991),
 quote_hash text NOT NULL CHECK(quote_hash~'^[a-f0-9]{32}$'),source_input_hash text NOT NULL CHECK(source_input_hash~'^[a-f0-9]{32}$'),
 budget_hash text NOT NULL CHECK(budget_hash~'^[a-f0-9]{32}$'),
 quote_snapshot jsonb NOT NULL,funding_snapshot jsonb NOT NULL,budget_snapshot jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id),request_id uuid NOT NULL,
 confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(actor_id,request_id)
);
CREATE TABLE private.multi_day_individual_obligation_requests_v1(
 actor_id uuid NOT NULL REFERENCES auth.users(id),request_id uuid NOT NULL,event_id uuid NOT NULL REFERENCES public.tournament_events(id),
 payload jsonb NOT NULL,receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE private.multi_day_individual_obligations_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.multi_day_individual_obligation_requests_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.multi_day_individual_obligations_v1,private.multi_day_individual_obligation_requests_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER individual_obligation_immutable BEFORE UPDATE OR DELETE ON private.multi_day_individual_obligations_v1
 FOR EACH ROW EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();
CREATE TRIGGER individual_obligation_request_immutable BEFORE UPDATE OR DELETE ON private.multi_day_individual_obligation_requests_v1
 FOR EACH ROW EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();

CREATE FUNCTION private.multi_day_individual_obligation_budget_v1(p_event_id uuid,p_funding jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE field integer;floor_amount numeric;floors integer;extra numeric;total numeric;funded numeric;context jsonb;extras jsonb;
BEGIN
 IF p_funding->>'eventId' IS DISTINCT FROM p_event_id::text THEN RAISE EXCEPTION 'individual_obligation_budget_scope_invalid';END IF;
 SELECT count(*),count(DISTINCT participation_floor_vnd),min(participation_floor_vnd) INTO field,floors,floor_amount
 FROM public.multi_day_final_participations_v1 WHERE event_id=p_event_id;
 -- Canonical qualification computes one event floor for every participation.
 -- Reject drift, do not choose a new allocation policy for nonuniform data.
 IF field<2 OR floors<>1 THEN RAISE EXCEPTION 'individual_obligation_budget_nonuniform_floor';END IF;
 SELECT coalesce(sum(m.amount_vnd),0),coalesce(jsonb_agg(jsonb_build_object('participationId',m.participation_id,'id',m.id,'amountVnd',m.amount_vnd) ORDER BY m.id),'[]'::jsonb)
 INTO extra,extras FROM public.multi_day_nonselected_min_cash_v1 m JOIN public.multi_day_final_participations_v1 p ON p.id=m.participation_id
 WHERE p.event_id=p_event_id AND m.status='PENDING_FUNDING';
 IF EXISTS(SELECT 1 FROM public.multi_day_nonselected_min_cash_v1 m JOIN public.multi_day_final_participations_v1 p ON p.id=m.participation_id
  WHERE p.event_id=p_event_id AND m.status='PENDING_FUNDING' AND (m.amount_vnd<0 OR m.amount_vnd<>trunc(m.amount_vnd) OR p.policy='SUM_STACKS'))
 THEN RAISE EXCEPTION 'individual_obligation_budget_min_cash_invalid';END IF;
 -- Uniform event floor makes this full-field sum independent of unfinalized
 -- players' eventual rank. No player is provisionally assigned a rank.
 SELECT sum(private.multi_day_obligation_amount_v1(coalesce(q.amount,0),floor_amount,0)) INTO total
 FROM generate_series(1,field)n LEFT JOIN public.tournament_prizes q ON q.tournament_id=(p_funding->>'finalTournamentId')::uuid AND q.position=n;
 total:=total+extra;funded:=(p_funding->>'directPoolVnd')::numeric+(p_funding->>'transferPoolVnd')::numeric+(p_funding->>'recordedOverlayVnd')::numeric;
 IF total>9007199254740991 OR funded>9007199254740991 THEN RAISE EXCEPTION 'multi_day_payout_amount_overflow';END IF;
 IF EXISTS(SELECT 1 FROM private.multi_day_individual_obligations_v1 o
  JOIN public.multi_day_final_participations_v1 p ON p.id=o.participation_id
  LEFT JOIN public.tournament_prizes q ON q.tournament_id=o.tournament_id AND q.position=o.finished_place
  WHERE o.event_id=p_event_id AND o.amount_vnd IS DISTINCT FROM private.multi_day_obligation_amount_v1(coalesce(q.amount,0),p.participation_floor_vnd,
   (SELECT coalesce(sum(m.amount_vnd),0) FROM public.multi_day_nonselected_min_cash_v1 m WHERE m.participation_id=p.id AND m.status='PENDING_FUNDING')))
 THEN RAISE EXCEPTION 'individual_obligation_frozen_amount_changed';END IF;
 context:=jsonb_build_object('eventId',p_event_id,'field',field,'eventFloorVnd',floor_amount,'prizePositions',p_funding->'prizePositions',
  'nonselectedMinCash',extras,'requiredTotalVnd',total,'fundedVnd',funded,'requiredShortfallVnd',greatest(total-funded,0));
 RETURN context||jsonb_build_object('budgetHash',md5(context::text));
END $$;
REVOKE ALL ON FUNCTION private.multi_day_individual_obligation_budget_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_multi_day_individual_obligation_preview_v1(p_event_id uuid,p_participation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE funding jsonb;quote jsonb;budget jsonb;
BEGIN
 funding:=private.multi_day_verified_funding_source_v1(p_event_id);
 quote:=private.multi_day_individual_obligation_quote_v1(p_participation_id);
 IF quote->>'eventId' IS DISTINCT FROM p_event_id::text THEN RAISE EXCEPTION 'individual_obligation_scope_invalid';END IF;
 budget:=private.multi_day_individual_obligation_budget_v1(p_event_id,funding);
 RETURN jsonb_build_object('ok',true,'state',CASE WHEN (budget->>'requiredShortfallVnd')::numeric=0 THEN 'READY_TO_CONFIRM' ELSE 'REQUIRED_SHORTFALL' END,
  'quote',quote,'funding',funding,'budget',budget,'paymentExecution','NOT_PERFORMED');
END $$;
REVOKE ALL ON FUNCTION public.get_multi_day_individual_obligation_preview_v1(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_multi_day_individual_obligation_preview_v1(uuid,uuid) TO authenticated;

CREATE FUNCTION public.confirm_multi_day_individual_obligation_v1(p_event_id uuid,p_participation_id uuid,
 p_expected_quote_hash text,p_expected_source_hash text,p_expected_budget_hash text,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();club uuid;tour uuid;payload jsonb;preview jsonb;receipt jsonb;
 prior private.multi_day_individual_obligation_requests_v1;obligation private.multi_day_individual_obligations_v1;outcome text;
BEGIN
 SELECT club_id,final_tournament_id INTO club,tour FROM public.tournament_events WHERE id=p_event_id;
 IF actor IS NULL OR club IS NULL OR NOT(EXISTS(SELECT 1 FROM public.clubs WHERE id=club AND owner_id=actor)
  OR public.is_club_floor(actor,club)) THEN RAISE EXCEPTION 'individual_obligation_actor_denied' USING ERRCODE='42501';END IF;
 IF p_participation_id IS NULL OR p_request_id IS NULL OR p_expected_quote_hash IS NULL OR p_expected_quote_hash!~'^[a-f0-9]{32}$'
 OR p_expected_source_hash IS NULL OR p_expected_source_hash!~'^[a-f0-9]{32}$'
 OR p_expected_budget_hash IS NULL OR p_expected_budget_hash!~'^[a-f0-9]{32}$' THEN RAISE EXCEPTION 'individual_obligation_request_invalid';END IF;
 payload:=jsonb_build_object('eventId',p_event_id,'participationId',p_participation_id,'quoteHash',p_expected_quote_hash,'sourceHash',p_expected_source_hash,'budgetHash',p_expected_budget_hash);
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM private.multi_day_individual_obligation_requests_v1 WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN IF prior.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.receipt;END IF;
 -- Same event-only fence as canonical whole-event payout finalization. Source
 -- writers take event SHARE; do not add registration/tournament locks here.
 PERFORM 1 FROM public.tournament_events WHERE id=p_event_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id)
 THEN RAISE EXCEPTION 'individual_obligation_global_finalization_exists';END IF;
 preview:=public.get_multi_day_individual_obligation_preview_v1(p_event_id,p_participation_id);
 IF preview->'quote'->>'quoteHash' IS DISTINCT FROM p_expected_quote_hash
 OR preview->'funding'->>'sourceInputHash' IS DISTINCT FROM p_expected_source_hash
 OR preview->'budget'->>'budgetHash' IS DISTINCT FROM p_expected_budget_hash
 THEN RAISE EXCEPTION 'individual_obligation_source_changed';END IF;
 IF preview->>'state'<>'READY_TO_CONFIRM' THEN RAISE EXCEPTION 'individual_obligation_shortfall_unfunded';END IF;
 SELECT * INTO obligation FROM private.multi_day_individual_obligations_v1 WHERE participation_id=p_participation_id;
 IF FOUND THEN outcome:='already_finalized';ELSE
  INSERT INTO private.multi_day_individual_obligations_v1(participation_id,event_id,tournament_id,entry_id,player_id,finished_place,amount_vnd,
   quote_hash,source_input_hash,budget_hash,quote_snapshot,funding_snapshot,budget_snapshot,actor_id,request_id)
  VALUES(p_participation_id,p_event_id,tour,(preview->'quote'->>'entryId')::uuid,(preview->'quote'->>'playerId')::uuid,
   (preview->'quote'->>'rank')::integer,(preview->'quote'->>'totalVnd')::numeric,
   p_expected_quote_hash,p_expected_source_hash,p_expected_budget_hash,preview->'quote',preview->'funding',preview->'budget',actor,p_request_id)
  RETURNING * INTO obligation;
  outcome:='recorded';
 END IF;
 receipt:=jsonb_build_object('ok',true,'outcome',outcome,'eventId',p_event_id,'requestId',p_request_id,
  'obligation',to_jsonb(obligation),'paymentExecution','NOT_PERFORMED');
 INSERT INTO private.multi_day_individual_obligation_requests_v1(actor_id,request_id,event_id,payload,receipt) VALUES(actor,p_request_id,p_event_id,payload,receipt);
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.confirm_multi_day_individual_obligation_v1(uuid,uuid,text,text,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.confirm_multi_day_individual_obligation_v1(uuid,uuid,text,text,text,uuid) TO authenticated;

CREATE FUNCTION public.get_multi_day_individual_obligation_receipt_v1(p_event_id uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();club uuid;prior private.multi_day_individual_obligation_requests_v1;
BEGIN
 SELECT club_id INTO club FROM public.tournament_events WHERE id=p_event_id;
 IF actor IS NULL OR club IS NULL OR NOT(EXISTS(SELECT 1 FROM public.clubs WHERE id=club AND owner_id=actor)
  OR public.is_club_floor(actor,club)) THEN RAISE EXCEPTION 'individual_obligation_actor_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO prior FROM private.multi_day_individual_obligation_requests_v1 WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND AND prior.event_id<>p_event_id THEN RAISE EXCEPTION 'individual_obligation_receipt_scope_conflict';END IF;
 RETURN jsonb_build_object('ok',true,'outcome',CASE WHEN prior.request_id IS NULL THEN 'not_found' ELSE 'recorded' END,'receipt',prior.receipt);
END $$;
REVOKE ALL ON FUNCTION public.get_multi_day_individual_obligation_receipt_v1(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_multi_day_individual_obligation_receipt_v1(uuid,uuid) TO authenticated;


-- PACKAGE STAGE 6/8 20261027170011_multiday_individual_global_liability_link_v1.sql
-- SHA256 c0bc98752329379595de4c9a261e28a4727ea43fc9822a79708d9c4357e2f554
-- LOCAL candidate. Link individual debt to global finalization; never sum both.
-- Explicit guarded transaction. No payment writer or historical debt rewrite.
DO $$ BEGIN
 IF to_regclass('private.multi_day_individual_obligations_v1') IS NULL
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.multi_day_finalize_payout_v1(uuid,text,text,text,text,uuid)'::regprocedure))
  IS DISTINCT FROM '924ff3f29f94d8f962d703d384b46c1b'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.get_club_payout_liability(timestamptz,timestamptz,uuid)'::regprocedure))
  IS DISTINCT FROM 'c14f988d9940615ddfb76774b191ba97'
 THEN RAISE EXCEPTION 'individual_global_liability_dependency_drift';END IF;
END $$;
CREATE FUNCTION private.reconcile_multi_day_individual_obligations_v1(p_event_id uuid,p_obligations jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE obligation private.multi_day_individual_obligations_v1;item jsonb;links jsonb:='[]'::jsonb;
BEGIN
 IF p_obligations IS NULL OR jsonb_typeof(p_obligations)<>'array' THEN RAISE EXCEPTION 'individual_obligation_reconciliation_invalid';END IF;
 FOR obligation IN SELECT * FROM private.multi_day_individual_obligations_v1 WHERE event_id=p_event_id ORDER BY participation_id LOOP
  IF (SELECT count(*) FROM jsonb_array_elements(p_obligations)x WHERE x->>'participationId'=obligation.participation_id::text)<>1
  THEN RAISE EXCEPTION 'individual_obligation_global_identity_changed';END IF;
  SELECT x INTO item FROM jsonb_array_elements(p_obligations)x WHERE x->>'participationId'=obligation.participation_id::text;
  IF item->>'playerId' IS DISTINCT FROM obligation.player_id::text
   OR (item->>'rank')::integer IS DISTINCT FROM obligation.finished_place
   OR (item->>'totalVnd')::numeric IS DISTINCT FROM obligation.amount_vnd
   OR NOT EXISTS(SELECT 1 FROM public.multi_day_final_seatings_v1 s WHERE s.participation_id=obligation.participation_id
    AND s.entry_id=obligation.entry_id AND s.final_tournament_id=obligation.tournament_id AND s.player_id=obligation.player_id)
  THEN RAISE EXCEPTION 'individual_obligation_global_amount_or_identity_changed';END IF;
  links:=links||jsonb_build_array(jsonb_build_object('participationId',obligation.participation_id,'entryId',obligation.entry_id,
   'individualRequestId',obligation.request_id,'individualActorId',obligation.actor_id,'rank',obligation.finished_place,
   'amountVnd',obligation.amount_vnd,'quoteHash',obligation.quote_hash,'sourceInputHash',obligation.source_input_hash));
 END LOOP;
 RETURN links;
END $$;
REVOKE ALL ON FUNCTION private.reconcile_multi_day_individual_obligations_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.multi_day_unified_obligation_accounting_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE final public.multi_day_payout_finalizations_v1;total numeric;finalized integer;links jsonb;
BEGIN
 SELECT * INTO final FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id;
 IF FOUND THEN
  links:=private.reconcile_multi_day_individual_obligations_v1(p_event_id,final.obligations);
  RETURN private.multi_day_payout_accounting_v1(p_event_id)||jsonb_build_object('liabilityBasis','GLOBAL',
   'individualObligationLinks',links,'finalizedCount',jsonb_array_length(final.obligations));
 END IF;
 SELECT coalesce(sum(amount_vnd),0),count(*) INTO total,finalized FROM private.multi_day_individual_obligations_v1 WHERE event_id=p_event_id;
 IF finalized=0 THEN RETURN NULL;END IF;
 -- Early paid markers are not implemented by this package. Never report zero
 -- paid if a marker exists without the forthcoming verified early accounting.
 IF EXISTS(SELECT 1 FROM public.tournament_prize_payments m JOIN public.tournaments t ON t.id=m.tournament_id WHERE t.event_id=p_event_id AND t.phase='final')
 THEN RAISE EXCEPTION 'individual_obligation_early_payment_accounting_not_integrated';END IF;
 IF total>9007199254740991 THEN RAISE EXCEPTION 'multi_day_payout_amount_overflow';END IF;
 RETURN jsonb_build_object('paidPlayerVnd',0,'unpaidObligationVnd',total,'liabilityBasis','INDIVIDUAL','finalizedCount',finalized);
END $$;
REVOKE ALL ON FUNCTION private.multi_day_unified_obligation_accounting_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE fn regprocedure;definition text;acl aclitem[];anchor text;replacement text;
BEGIN
 fn:='public.multi_day_finalize_payout_v1(uuid,text,text,text,text,uuid)'::regprocedure;
 SELECT pg_get_functiondef(fn),proacl INTO definition,acl FROM pg_proc WHERE oid=fn;
 anchor:=' v_receipt:=pg_catalog.jsonb_build_object(';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_global_finalize_anchor_drift';END IF;
 EXECUTE replace(definition,anchor,$new$ v_preview:=jsonb_set(v_preview,'{sourceSnapshot,individualObligations}',
   private.reconcile_multi_day_individual_obligations_v1(p_event_id,v_preview->'obligations'),true);
$new$||anchor);
 IF (SELECT proacl FROM pg_proc WHERE oid=fn) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'individual_global_finalize_acl_drift';END IF;
 fn:='public.get_club_payout_liability(timestamptz,timestamptz,uuid)'::regprocedure;
 SELECT pg_get_functiondef(fn),proacl INTO definition,acl FROM pg_proc WHERE oid=fn;
 anchor:='THEN EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 f WHERE f.event_id=t.event_id AND f.final_tournament_id=t.id)';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_liability_scope_anchor_drift';END IF;
 definition:=replace(definition,anchor,$new$THEN (EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 f WHERE f.event_id=t.event_id AND f.final_tournament_id=t.id)
       OR EXISTS(SELECT 1 FROM private.multi_day_individual_obligations_v1 o WHERE o.event_id=t.event_id AND o.tournament_id=t.id))$new$);
 anchor:='      s.id, s.name, s.close_date, s.is_closed, s.has_finished_place,';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_liability_calc_anchor_drift';END IF;
 definition:=replace(definition,anchor,anchor||chr(10)||'      d.state->>''liabilityBasis'' AS liability_basis,');
 anchor:='      CASE WHEN f.event_id IS NOT NULL THEN'||chr(10)||'       (d.state';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_liability_owed_anchor_drift';END IF;
 definition:=replace(definition,anchor,'      CASE WHEN d.state IS NOT NULL THEN'||chr(10)||'       (d.state');
 anchor:='      CASE WHEN f.event_id IS NOT NULL THEN (d.state';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_liability_paid_anchor_drift';END IF;
 definition:=replace(definition,anchor,'      CASE WHEN d.state IS NOT NULL THEN (d.state');
 anchor:=$old$      (SELECT COUNT(*) FROM public.tournament_entries e
       WHERE e.tournament_id = s.id AND e.finished_place IS NOT NULL) AS finishers_count$old$;
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_liability_count_anchor_drift';END IF;
 definition:=replace(definition,anchor,$new$      CASE WHEN d.state->>'liabilityBasis'='INDIVIDUAL' THEN (d.state->>'finalizedCount')::bigint ELSE
       (SELECT COUNT(*) FROM public.tournament_entries e WHERE e.tournament_id=s.id AND e.finished_place IS NOT NULL) END AS finishers_count$new$);
 anchor:='    LEFT JOIN LATERAL (SELECT CASE WHEN f.event_id IS NOT NULL THEN private.multi_day_payout_accounting_v1(f.event_id) ELSE NULL END AS state) d ON true';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_liability_accounting_anchor_drift';END IF;
 replacement:=$new$    LEFT JOIN LATERAL (SELECT CASE WHEN f.event_id IS NOT NULL OR EXISTS(
       SELECT 1 FROM private.multi_day_individual_obligations_v1 o WHERE o.tournament_id=s.id)
       THEN private.multi_day_unified_obligation_accounting_v1((SELECT event_id FROM public.tournaments WHERE id=s.id))
       ELSE NULL END AS state) d ON true$new$;
 definition:=replace(definition,anchor,replacement);
 anchor:='      ''finishersCount'', c.finishers_count';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_liability_metadata_anchor_drift';END IF;
 definition:=replace(definition,anchor,anchor||','||chr(10)||'      ''liabilityScope'',coalesce(c.liability_basis,''ORDINARY''),''isPartial'',coalesce(c.liability_basis=''INDIVIDUAL'',false)');
 EXECUTE definition;
 IF (SELECT proacl FROM pg_proc WHERE oid=fn) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'individual_liability_acl_drift';END IF;
END $patch$;


-- PACKAGE STAGE 7/8 20261027172548_multiday_individual_verified_payment_v1.sql
-- SHA256 5898b6956c53bfb979530c718982a2ced0c8b2031e7c9a324ab06f7728d36c18
-- LOCAL candidate only. Transaction-bound early paid markers; no bank transfer.
-- Requires1162/1164/1165/1166/1167/1168 in the same guarded transaction.
DO $$ BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='private.is_verified_multi_day_payment_v1(public.tournament_prize_payments)'::regprocedure)) IS DISTINCT FROM '5addc8c68b15fb44b14cd5199c6a404d'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.get_multi_day_payout_recipients_v1(uuid)'::regprocedure)) IS DISTINCT FROM '6bf6ef281658df191077a369808abf18'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.record_multi_day_prize_payment_v1(uuid,uuid,text,text,uuid)'::regprocedure)) IS DISTINCT FROM '246185b8b596815a5a3bd074fc03e26d'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='private.multi_day_unified_obligation_accounting_v1(uuid)'::regprocedure)) IS DISTINCT FROM '1c6d399ff2023e862fa3ca794cc87be9'
 OR to_regclass('private.multi_day_individual_payment_commits_v1') IS NOT NULL
 THEN RAISE EXCEPTION 'individual_payment_dependency_drift';END IF;
END $$;
-- Payment-authorized Cashier uses the same incoming-source computation privately.
-- Public funding preview/obligation confirmation roles remain unchanged.
DO $build$
DECLARE definition text;needle text:='(c.owner_id=v_actor OR public.is_club_floor(v_actor,v_rules.club_id))';
BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='private.multi_day_funding_evaluate_v1(uuid,jsonb)'::regprocedure)) IS DISTINCT FROM '7ecfb3f082c03267ed728e9cb0648583'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='private.multi_day_verified_funding_source_v1(uuid)'::regprocedure)) IS DISTINCT FROM '99ce1551b75923a53fb9ac123a8db23b'
 THEN RAISE EXCEPTION 'individual_payment_funding_dependency_drift';END IF;
 definition:=pg_get_functiondef('private.multi_day_funding_evaluate_v1(uuid,jsonb)'::regprocedure);
 IF array_length(string_to_array(definition,needle),1)<>2 THEN RAISE EXCEPTION 'individual_payment_funding_actor_anchor_drift';END IF;
 definition:=replace(definition,'FUNCTION private.multi_day_funding_evaluate_v1(','FUNCTION private.multi_day_payment_funding_evaluate_v1(');
 definition:=replace(definition,needle,'(c.owner_id=v_actor OR EXISTS(SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id=v_rules.club_id AND cc.user_id=v_actor))');
 EXECUTE definition;
 definition:=pg_get_functiondef('private.multi_day_verified_funding_source_v1(uuid)'::regprocedure);
 definition:=replace(definition,'FUNCTION private.multi_day_verified_funding_source_v1(','FUNCTION private.multi_day_payment_verified_funding_v1(');
 definition:=replace(definition,'private.multi_day_funding_evaluate_v1(p_event_id,NULL)','private.multi_day_payment_funding_evaluate_v1(p_event_id,NULL)');
 EXECUTE definition;
END $build$;
REVOKE ALL ON FUNCTION private.multi_day_payment_funding_evaluate_v1(uuid,jsonb),private.multi_day_payment_verified_funding_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE private.multi_day_individual_payment_commits_v1(
 payment_id uuid PRIMARY KEY REFERENCES public.tournament_prize_payments(id) DEFERRABLE INITIALLY DEFERRED,
 participation_id uuid NOT NULL UNIQUE REFERENCES private.multi_day_individual_obligations_v1(participation_id),
 event_id uuid NOT NULL REFERENCES public.tournament_events(id),tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
 club_id uuid NOT NULL REFERENCES public.clubs(id),actor_id uuid NOT NULL REFERENCES auth.users(id),request_id uuid NOT NULL,
 player_id uuid NOT NULL,finished_place integer NOT NULL CHECK(finished_place>1),
 amount_vnd bigint NOT NULL CHECK(amount_vnd>0 AND amount_vnd<=9007199254740991),
 recipient_name text NOT NULL CHECK(length(btrim(recipient_name))>0),method text NOT NULL CHECK(method IN('cash','bank','app','other')),
 paid_at timestamptz NOT NULL,transaction_id bigint NOT NULL,backend_pid integer NOT NULL,
 previous_revision text NOT NULL CHECK(previous_revision~'^[0-9a-f]{32}$'),UNIQUE(actor_id,request_id),
 FOREIGN KEY(actor_id,request_id) REFERENCES floor_private.payout_payment_receipts_v1(actor_id,request_id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE private.multi_day_individual_payment_commits_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.multi_day_individual_payment_commits_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER individual_payment_commit_immutable BEFORE UPDATE OR DELETE ON private.multi_day_individual_payment_commits_v1
 FOR EACH ROW EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();
CREATE FUNCTION private.is_individual_multi_day_payment_v1(row_value public.tournament_prize_payments)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT row_value.multi_day_participation_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM private.multi_day_individual_payment_commits_v1 c
  JOIN private.multi_day_individual_obligations_v1 o ON o.participation_id=c.participation_id AND o.event_id=c.event_id
   AND o.tournament_id=c.tournament_id AND o.player_id=c.player_id AND o.finished_place=c.finished_place AND o.amount_vnd=c.amount_vnd
  JOIN public.multi_day_final_participations_v1 p ON p.id=c.participation_id AND p.event_id=c.event_id
   AND p.final_tournament_id=c.tournament_id AND p.player_id=c.player_id
  JOIN public.tournaments t ON t.id=c.tournament_id AND t.event_id=c.event_id AND t.club_id=c.club_id AND t.phase='final'
  WHERE c.payment_id=row_value.id AND row_value.multi_day_participation_id=c.participation_id
   AND row_value.tournament_id=c.tournament_id AND row_value.club_id=c.club_id
   AND row_value.finished_place=c.finished_place AND row_value.prize_amount=c.amount_vnd
   AND row_value.recipient_ref=c.player_id AND row_value.recipient_name=c.recipient_name
   AND row_value.paid_by=c.actor_id AND row_value.paid_at=c.paid_at AND row_value.method=c.method
   AND row_value.status='paid' AND row_value.proof_url IS NULL AND row_value.notes IS NULL);
$$;
REVOKE ALL ON FUNCTION private.is_individual_multi_day_payment_v1(public.tournament_prize_payments) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE definition text:=pg_get_functiondef('private.is_verified_multi_day_payment_v1(public.tournament_prize_payments)'::regprocedure);
 needle text:=' SELECT row_value.multi_day_participation_id IS NOT NULL AND EXISTS(';
BEGIN
 IF array_length(string_to_array(definition,needle),1)<>2 THEN RAISE EXCEPTION 'individual_payment_verifier_anchor_drift';END IF;
 EXECUTE replace(definition,needle,$new$ SELECT (private.is_individual_multi_day_payment_v1(row_value) AND EXISTS(
  SELECT 1 FROM private.multi_day_individual_payment_commits_v1 c WHERE c.payment_id=row_value.id
   AND c.transaction_id=pg_catalog.txid_current() AND c.backend_pid=pg_catalog.pg_backend_pid() AND c.actor_id=auth.uid()))
 OR row_value.multi_day_participation_id IS NOT NULL AND EXISTS($new$);
END $patch$;
CREATE FUNCTION private.multi_day_individual_payment_state_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE tour uuid;rows jsonb;owed numeric;paid numeric;context jsonb;
BEGIN
 SELECT final_tournament_id INTO tour FROM public.tournament_events WHERE id=p_event_id;
 IF tour IS NULL OR EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id)
 THEN RAISE EXCEPTION 'individual_payment_state_requires_pre_global_event';END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_prize_payments m WHERE m.tournament_id=tour AND NOT private.is_individual_multi_day_payment_v1(m))
 THEN RAISE EXCEPTION 'individual_payment_unrecognized_marker';END IF;
 SELECT coalesce(sum(o.amount_vnd),0),coalesce(sum(m.prize_amount),0),coalesce(jsonb_agg(jsonb_build_object(
  'participationId',o.participation_id,'totalVnd',o.amount_vnd,'paidVnd',coalesce(m.prize_amount,0),
  'payment',CASE WHEN m.id IS NULL THEN NULL ELSE to_jsonb(m) END) ORDER BY o.participation_id),'[]'::jsonb)
 INTO owed,paid,rows FROM private.multi_day_individual_obligations_v1 o LEFT JOIN public.tournament_prize_payments m
  ON m.multi_day_participation_id=o.participation_id AND m.tournament_id=o.tournament_id AND m.status='paid' WHERE o.event_id=p_event_id;
 IF paid>owed OR greatest(owed,paid)>9007199254740991 THEN RAISE EXCEPTION 'individual_payment_amount_invalid';END IF;
 context:=jsonb_build_object('eventId',p_event_id,'obligations',rows,'paidPlayerVnd',paid::bigint,'unpaidObligationVnd',(owed-paid)::bigint);
 RETURN context||jsonb_build_object('revision',md5(context::text));
END $$;
REVOKE ALL ON FUNCTION private.multi_day_individual_payment_state_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION floor_private.multi_day_individual_payment_context_v1(p_event_id uuid,p_participation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE o private.multi_day_individual_obligations_v1;entry public.tournament_entries;context jsonb;state jsonb;
 funding jsonb;budget jsonb;item jsonb;label text;last_payment public.tournament_prize_payments;
BEGIN
 SELECT * INTO o FROM private.multi_day_individual_obligations_v1 WHERE participation_id=p_participation_id AND event_id=p_event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'individual_payment_obligation_required';END IF;
 SELECT * INTO entry FROM public.tournament_entries WHERE id=o.entry_id AND tournament_id=o.tournament_id AND player_id=o.player_id;
 IF NOT FOUND OR entry.status<>'busted' OR entry.finished_place IS NOT NULL AND entry.finished_place<>o.finished_place
 THEN RAISE EXCEPTION 'multi_day_result_identity_changed';END IF;
 funding:=private.multi_day_payment_verified_funding_v1(p_event_id);
 budget:=private.multi_day_individual_obligation_budget_v1(p_event_id,funding);
 IF (budget->>'requiredShortfallVnd')::numeric<>0 THEN RAISE EXCEPTION 'individual_payment_shortfall_unfunded';END IF;
 state:=private.multi_day_individual_payment_state_v1(p_event_id);
 SELECT x INTO STRICT item FROM jsonb_array_elements(state->'obligations')x WHERE x->>'participationId'=p_participation_id::text;
 SELECT coalesce(nullif(btrim(r.display_name),''),'Final Day player') INTO label
 FROM public.multi_day_final_seatings_v1 s JOIN public.seat_draw_receipts r ON r.id=s.receipt_id
 WHERE s.participation_id=p_participation_id AND s.entry_id=o.entry_id AND s.player_id=o.player_id AND s.final_tournament_id=o.tournament_id;
 IF label IS NULL THEN RAISE EXCEPTION 'multi_day_result_identity_changed';END IF;
 SELECT * INTO last_payment FROM public.tournament_prize_payments WHERE tournament_id=o.tournament_id AND multi_day_participation_id=p_participation_id AND status='paid';
 context:=jsonb_build_object('entryId',o.entry_id,'recipientRef',o.player_id,'recipientName',label,'tournamentId',o.tournament_id,
  'multiDayEventId',p_event_id,'multiDayParticipationId',p_participation_id,'finishedPlace',o.finished_place,
  'prizeAmount',o.amount_vnd-(item->>'paidVnd')::numeric::bigint,'obligationAmount',o.amount_vnd,'paidAmount',(item->>'paidVnd')::numeric::bigint,
  'accountingRevision',state->>'revision','sourceInputHash',funding->>'sourceInputHash','budgetHash',budget->>'budgetHash',
  'isPaid',o.amount_vnd=(item->>'paidVnd')::numeric::bigint,'paidAt',last_payment.paid_at,'method',last_payment.method);
 RETURN context||jsonb_build_object('confirmationToken',md5(context::text));
END $$;
REVOKE ALL ON FUNCTION floor_private.multi_day_individual_payment_context_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION floor_private.get_multi_day_individual_payment_recipients_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();club uuid;tour uuid;state jsonb;o record;context jsonb;places jsonb:='[]';paid_count integer:=0;
BEGIN
 SELECT club_id,final_tournament_id INTO club,tour FROM public.tournament_events WHERE id=p_event_id;
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=club AND (c.owner_id=actor
  OR EXISTS(SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id=c.id AND cc.user_id=actor)))
 THEN RAISE EXCEPTION 'actor_not_allowed' USING ERRCODE='42501';END IF;
 state:=private.multi_day_individual_payment_state_v1(p_event_id);
 FOR o IN SELECT participation_id FROM private.multi_day_individual_obligations_v1 WHERE event_id=p_event_id ORDER BY finished_place,participation_id LOOP
  context:=floor_private.multi_day_individual_payment_context_v1(p_event_id,o.participation_id);
  places:=places||jsonb_build_array(context);IF (context->>'isPaid')::boolean THEN paid_count:=paid_count+1;END IF;
 END LOOP;
 RETURN jsonb_build_object('tournamentId',tour,'mode','multi_day','eventId',p_event_id,'liabilityScope','INDIVIDUAL','isPartial',true,
  'itmPlaces',NULL,'owedTotal',(state->>'paidPlayerVnd')::bigint+(state->>'unpaidObligationVnd')::bigint,
  'paidTotal',(state->>'paidPlayerVnd')::bigint,'paidCount',paid_count,'totalCount',jsonb_array_length(places),'places',places);
END $$;
REVOKE ALL ON FUNCTION floor_private.get_multi_day_individual_payment_recipients_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION floor_private.record_multi_day_individual_payment_v1(p_event_id uuid,p_participation_id uuid,p_method text,p_expected_token text,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();o private.multi_day_individual_obligations_v1;club uuid;context jsonb;payload jsonb;
 receipt floor_private.payout_payment_receipts_v1;result jsonb;amount bigint;payment_id uuid:=gen_random_uuid();stamp timestamptz;after_state jsonb;
BEGIN
 IF actor IS NULL THEN RETURN jsonb_build_object('ok',false,'error','unauthorized');END IF;
 IF p_request_id IS NULL OR p_method IS NULL OR p_method NOT IN('cash','bank','app','other') OR p_expected_token IS NULL OR p_expected_token!~'^[a-f0-9]{32}$'
 THEN RETURN jsonb_build_object('ok',false,'error','invalid_payment_intent');END IF;
 SELECT * INTO o FROM private.multi_day_individual_obligations_v1 WHERE event_id=p_event_id AND participation_id=p_participation_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','multi_day_obligations_not_finalized');END IF;
 SELECT club_id INTO club FROM public.tournament_events WHERE id=p_event_id AND final_tournament_id=o.tournament_id;
 IF NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=club AND (c.owner_id=actor
  OR EXISTS(SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id=c.id AND cc.user_id=actor)))
 THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');END IF;
 payload:=jsonb_build_object('tournament_id',o.tournament_id,'finished_place',o.finished_place,'method',p_method,
  'expected_token',p_expected_token,'event_id',p_event_id,'participation_id',p_participation_id);
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_id::text,0));
 SELECT * INTO receipt FROM floor_private.payout_payment_receipts_v1 WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  IF receipt.payload IS DISTINCT FROM payload THEN RETURN jsonb_build_object('ok',false,'error','request_payload_conflict');END IF;
  RETURN receipt.result;
 END IF;
 PERFORM 1 FROM public.tournament_events WHERE id=p_event_id FOR UPDATE;
 PERFORM 1 FROM public.clubs WHERE id=club AND owner_id=actor FOR SHARE;
 IF NOT FOUND THEN
  PERFORM 1 FROM public.club_cashiers WHERE club_id=club AND user_id=actor FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 WHERE id AND enabled AND club=ANY(allowed_club_ids))
 THEN RETURN jsonb_build_object('ok',false,'error','multi_day_package_release_off');END IF;
 IF EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id) THEN
  result:=jsonb_build_object('ok',false,'error','payout_confirmation_stale');
 ELSE
  context:=floor_private.multi_day_individual_payment_context_v1(p_event_id,p_participation_id);amount:=(context->>'prizeAmount')::bigint;
  IF context->>'confirmationToken' IS DISTINCT FROM p_expected_token THEN result:=jsonb_build_object('ok',false,'error','payout_confirmation_stale');
  ELSIF amount<=0 THEN result:=jsonb_build_object('ok',false,'error','no_unpaid_obligation');
  ELSE
   stamp:=clock_timestamp();
   INSERT INTO private.multi_day_individual_payment_commits_v1(payment_id,participation_id,event_id,tournament_id,club_id,actor_id,request_id,
    player_id,finished_place,amount_vnd,recipient_name,method,paid_at,transaction_id,backend_pid,previous_revision)
   VALUES(payment_id,p_participation_id,p_event_id,o.tournament_id,club,actor,p_request_id,o.player_id,o.finished_place,amount,
    context->>'recipientName',p_method,stamp,txid_current(),pg_backend_pid(),context->>'accountingRevision');
   INSERT INTO public.tournament_prize_payments(id,tournament_id,club_id,finished_place,prize_amount,recipient_ref,recipient_name,status,paid_by,paid_at,method,multi_day_participation_id)
   VALUES(payment_id,o.tournament_id,club,o.finished_place,amount,o.player_id,context->>'recipientName','paid',actor,stamp,p_method,p_participation_id);
   after_state:=private.multi_day_individual_payment_state_v1(p_event_id);
   IF (after_state->>'paidPlayerVnd')::bigint<>(SELECT coalesce(sum(prize_amount),0) FROM public.tournament_prize_payments WHERE tournament_id=o.tournament_id AND status='paid')
   THEN RAISE EXCEPTION 'individual_payment_accounting_mismatch';END IF;
   result:=jsonb_build_object('ok',true,'outcome','recorded','payment_id',payment_id,'prize_amount',amount,'paid_at',stamp,
    'tournament_id',o.tournament_id,'finished_place',o.finished_place,'entry_id',o.entry_id,'recipient_ref',o.player_id,'accounting_revision',after_state->>'revision');
  END IF;
 END IF;
 INSERT INTO floor_private.payout_payment_receipts_v1(actor_id,request_id,payload,result) VALUES(actor,p_request_id,payload,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION floor_private.record_multi_day_individual_payment_v1(uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE definition text;target regprocedure;acl aclitem[];anchor text:=' SELECT * INTO f FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id;';
BEGIN
 FOREACH target IN ARRAY ARRAY['public.get_multi_day_payout_recipients_v1(uuid)'::regprocedure,'public.record_multi_day_prize_payment_v1(uuid,uuid,text,text,uuid)'::regprocedure] LOOP
  SELECT proacl INTO acl FROM pg_proc WHERE oid=target;definition:=pg_get_functiondef(target);
  IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_payment_public_anchor_drift';END IF;
  IF target='public.get_multi_day_payout_recipients_v1(uuid)'::regprocedure THEN
   definition:=replace(definition,anchor,$new$ IF NOT EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id)
    AND EXISTS(SELECT 1 FROM private.multi_day_individual_obligations_v1 WHERE event_id=p_event_id) THEN
    RETURN floor_private.get_multi_day_individual_payment_recipients_v1(p_event_id);
   END IF;
$new$||anchor);
  ELSE
   definition:=replace(definition,anchor,$new$ IF NOT EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id)
    AND EXISTS(SELECT 1 FROM private.multi_day_individual_obligations_v1 WHERE event_id=p_event_id AND participation_id=p_participation_id) THEN
    RETURN floor_private.record_multi_day_individual_payment_v1(p_event_id,p_participation_id,p_method,p_expected_token,p_request_id);
   END IF;
$new$||anchor);
  END IF;
  EXECUTE definition;IF (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'individual_payment_public_acl_drift';END IF;
 END LOOP;
 target:='private.multi_day_unified_obligation_accounting_v1(uuid)'::regprocedure;definition:=pg_get_functiondef(target);
 anchor:=$old$ IF EXISTS(SELECT 1 FROM public.tournament_prize_payments m JOIN public.tournaments t ON t.id=m.tournament_id WHERE t.event_id=p_event_id AND t.phase='final')
 THEN RAISE EXCEPTION 'individual_obligation_early_payment_accounting_not_integrated';END IF;$old$;
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_payment_accounting_anchor_drift';END IF;
 definition:=replace(definition,anchor,'');
 IF array_length(string_to_array(definition,$old$'paidPlayerVnd',0,'unpaidObligationVnd',total$old$),1)<>2 THEN RAISE EXCEPTION 'individual_payment_accounting_value_anchor_drift';END IF;
 definition:=replace(definition,$old$'paidPlayerVnd',0,'unpaidObligationVnd',total$old$,
  $new$'paidPlayerVnd',(private.multi_day_individual_payment_state_v1(p_event_id)->>'paidPlayerVnd')::bigint,
   'unpaidObligationVnd',(private.multi_day_individual_payment_state_v1(p_event_id)->>'unpaidObligationVnd')::bigint$new$);
 EXECUTE definition;
END $patch$;


-- PACKAGE STAGE 8/8 20261027184903_multiday_individual_obligation_read_state_v1.sql
-- SHA256 31ff49c678c263e17e0c05ddfd2f84b908566eb0624c0f98c27c96dc2b1e8351
-- LOCAL candidate: expose persisted individual debt in the existing Floor read.
-- No amount recomputation, write path, role, grant or payment-state change.
DO $patch$
DECLARE target regprocedure:='public.get_multi_day_individual_rank_review_v1(uuid)'::regprocedure;
 definition text;acl aclitem[];
 anchor text:=' RETURN private.multi_day_individual_rank_source_v1(p_event_id);';
BEGIN
 IF to_regclass('private.multi_day_individual_obligations_v1') IS NULL
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=target) IS DISTINCT FROM 'ce66aaafa982d8f705df1ef58234f740'
 THEN RAISE EXCEPTION 'individual_obligation_read_dependency_drift';END IF;
 SELECT pg_get_functiondef(target),proacl INTO definition,acl FROM pg_proc WHERE oid=target;
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_obligation_read_anchor_drift';END IF;
 EXECUTE replace(definition,anchor,$new$ RETURN private.multi_day_individual_rank_source_v1(p_event_id)||jsonb_build_object(
  'individualObligations',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'eventId',o.event_id,'tournamentId',o.tournament_id,'participationId',o.participation_id,
   'entryId',o.entry_id,'playerId',o.player_id,'rank',o.finished_place,'totalVnd',o.amount_vnd,
   'requestId',o.request_id,'confirmedAt',o.confirmed_at) ORDER BY o.finished_place,o.participation_id),'[]'::jsonb)
   FROM private.multi_day_individual_obligations_v1 o WHERE o.event_id=p_event_id));$new$);
 IF (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'individual_obligation_read_acl_drift';END IF;
END $patch$;

