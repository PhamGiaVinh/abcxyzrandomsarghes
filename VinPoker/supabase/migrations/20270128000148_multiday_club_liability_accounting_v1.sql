-- CLI candidate20261018121806, local forward148 NOT LIVE.
-- One internal accounting calculation serves authorized event and club reads.
-- Keep dates, club authorization, ordinary-tour math and frozen history intact.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
DECLARE target regprocedure:='public.multi_day_payout_postfinal_state_v1(uuid)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),''); auth_start integer;needle text;
BEGIN
 IF current_user<>'postgres' OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=target)<>'e19885cc0407b5005d7a1ccca9233277'
  OR to_regprocedure('private.multi_day_payout_accounting_v1(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'multiday148_accounting_drift';END IF;
 auth_start:=position(' IF NOT FOUND OR v_actor IS NULL OR NOT (' IN definition);
 IF auth_start=0 THEN RAISE EXCEPTION 'multiday148_actor_anchor_missing';END IF;
 needle:=substring(definition FROM auth_start FOR position(' END IF;' IN substring(definition FROM auth_start))+length(' END IF;')-1);
 definition:=replace(definition,needle,$new$ IF NOT FOUND THEN RAISE EXCEPTION 'multi_day_obligations_not_finalized';END IF;$new$);
 definition:=replace(definition,'FUNCTION public.multi_day_payout_postfinal_state_v1(','FUNCTION private.multi_day_payout_accounting_v1(');
 EXECUTE definition;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_payout_accounting_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.multi_day_payout_postfinal_state_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();club uuid;
BEGIN
 SELECT f.club_id INTO club FROM public.multi_day_payout_finalizations_v1 f WHERE f.event_id=p_event_id;
 IF NOT FOUND OR actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=club AND
  (c.owner_id=actor OR public.is_club_floor(actor,c.id) OR EXISTS(SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id=c.id AND cc.user_id=actor)))
 THEN RAISE EXCEPTION 'multi_day_payout_read_actor_denied' USING ERRCODE='42501';END IF;
 RETURN private.multi_day_payout_accounting_v1(p_event_id);
END $$;
DO $$
DECLARE target regprocedure:='public.get_club_payout_liability(timestamptz,timestamptz,uuid)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),''); acl aclitem[];
 needle text:=$old$      EXISTS (SELECT 1 FROM public.tournament_entries e
              WHERE e.tournament_id = t.id AND e.finished_place IS NOT NULL) AS has_finished_place$old$;
 paid text:=$old$      (SELECT COALESCE(SUM(pp.prize_amount), 0)
       FROM public.tournament_prize_payments pp
       WHERE pp.tournament_id = s.id AND pp.status = 'paid') AS paid,$old$;
BEGIN
 SELECT proacl INTO acl FROM pg_proc WHERE oid=target;
 IF current_user<>'postgres' OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=target)<>'eb35ffed08154782d52e5f834d959f7f'
  OR length(definition)-length(replace(definition,needle,''))<>length(needle)
  OR length(definition)-length(replace(definition,paid,''))<>length(paid)
  OR (length(definition)-length(replace(definition,'    FROM scoped s','')))/length('    FROM scoped s')<>1
 THEN RAISE EXCEPTION 'multiday148_liability_dependency_drift';END IF;
 definition:=replace(definition,needle,$new$      CASE WHEN t.phase='final' AND EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1 q WHERE q.event_id=t.event_id)
       THEN EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 f WHERE f.event_id=t.event_id AND f.final_tournament_id=t.id)
       ELSE EXISTS(SELECT 1 FROM public.tournament_entries e WHERE e.tournament_id=t.id AND e.finished_place IS NOT NULL) END AS has_finished_place$new$);
 definition:=replace(definition,'      CASE WHEN s.has_finished_place THEN (',$new$      CASE WHEN f.event_id IS NOT NULL THEN
       (d.state->>'paidPlayerVnd')::numeric+(d.state->>'unpaidObligationVnd')::numeric
       WHEN s.has_finished_place THEN ($new$);
 definition:=replace(definition,paid,$new$      CASE WHEN f.event_id IS NOT NULL THEN (d.state->>'paidPlayerVnd')::numeric ELSE
       (SELECT COALESCE(SUM(pp.prize_amount),0) FROM public.tournament_prize_payments pp
        WHERE pp.tournament_id=s.id AND pp.status='paid') END AS paid,$new$);
 definition:=replace(definition,'    FROM scoped s',$new$    FROM scoped s
    LEFT JOIN public.multi_day_payout_finalizations_v1 f ON f.final_tournament_id=s.id
     AND f.event_id=(SELECT t.event_id FROM public.tournaments t WHERE t.id=s.id)
    LEFT JOIN LATERAL (SELECT CASE WHEN f.event_id IS NOT NULL THEN private.multi_day_payout_accounting_v1(f.event_id) ELSE NULL END AS state) d ON true$new$);
 EXECUTE definition;
 IF (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'multiday148_liability_acl_drift';END IF;
END $$;
COMMIT;
