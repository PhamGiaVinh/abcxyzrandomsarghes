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
