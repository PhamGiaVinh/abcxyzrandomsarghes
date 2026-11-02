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
