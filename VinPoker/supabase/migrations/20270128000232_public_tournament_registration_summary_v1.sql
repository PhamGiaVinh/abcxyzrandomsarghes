-- CLI-created 20261021060927; reserved forward slot232 after source catalog check.
-- Public aggregate only. Never grant anonymous access to registration rows.
-- Recovery: revoke/drop this new endpoint; preserve all registrations/counters.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
CREATE FUNCTION public.get_public_tournament_registration_summary_v1(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE manual_count integer; registered_count bigint;
BEGIN
 IF p_tournament_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','invalid_request');END IF;
 SELECT t.current_players INTO manual_count FROM public.tournaments t WHERE t.id=p_tournament_id AND t.deleted_at IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','tournament_not_found');END IF;
 -- Preserve row-count semantics (a re-entry is another registration), explicitly
 -- labelled as registrations by the client, and the existing public counter floor.
 -- Never derive money/participation entries or expose identities here.
 SELECT count(*) INTO registered_count FROM public.tournament_registrations r
 WHERE r.tournament_id=p_tournament_id AND r.status IN ('pending','confirmed');
 RETURN jsonb_build_object('ok',true,'tournament_id',p_tournament_id,
  'registration_count',greatest(coalesce(manual_count,0),registered_count),
  'source','canonical_registration_v1');
END;
$function$;
REVOKE ALL ON FUNCTION public.get_public_tournament_registration_summary_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_registration_summary_v1(uuid) TO anon,authenticated;
COMMIT;
