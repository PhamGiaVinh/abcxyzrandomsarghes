-- Empty-history inverse only; persisted debt must keep a readable state.
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM private.multi_day_individual_obligations_v1) THEN RAISE EXCEPTION 'individual_obligation_read_history_retained_use_forward_repair';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_multi_day_individual_rank_review_v1(uuid)'::regprocedure) IS DISTINCT FROM '1f0369408d278b8548ced6f6037d9f8f' THEN RAISE EXCEPTION 'individual_obligation_read_down_body_drift';END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.get_multi_day_individual_rank_review_v1(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid();club uuid;
BEGIN
 SELECT club_id INTO club FROM public.tournament_events WHERE id=p_event_id;
 IF actor IS NULL OR club IS NULL OR NOT(EXISTS(SELECT 1 FROM public.clubs WHERE id=club AND owner_id=actor)
  OR public.is_club_floor(actor,club)) THEN RAISE EXCEPTION 'individual_rank_actor_denied' USING ERRCODE='42501';END IF;
 RETURN private.multi_day_individual_rank_source_v1(p_event_id);
END $function$
;
