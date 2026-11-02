-- created_by alone is not authority. Preserve the legacy creator exception
-- only for the existing database-backed global super_admin role.
-- Recovery: restore the exact reviewed predecessor policy from release backup.
-- No table/function grants, reader policies or canonical RPC bodies change.
BEGIN;
DO $migration$
DECLARE prior record;current_policy record;
BEGIN
 SELECT polroles,polpermissive,polcmd,
  md5(jsonb_build_object('qual',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid),
   'roles',polroles,'permissive',polpermissive,'command',polcmd)::text) digest
 INTO STRICT prior FROM pg_catalog.pg_policy
 WHERE polrelid='public.tournament_hands'::regclass AND polname='Tournament hands manageable by admins';
 IF prior.digest<>'e429b3f6a9164828faf23013d75dba00' THEN
  RAISE EXCEPTION 'tracker_hand_tenant_policy_predecessor_drift';
 END IF;
 IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.tournament_hands'::regclass) THEN
  RAISE EXCEPTION 'tracker_hand_tenant_rls_disabled';
 END IF;
 EXECUTE $policy$
 ALTER POLICY "Tournament hands manageable by admins" ON public.tournament_hands
 USING (EXISTS (
  SELECT 1 FROM public.tournaments t
  LEFT JOIN public.clubs c ON c.id=t.club_id
  LEFT JOIN public.club_cashiers cc ON cc.club_id=t.club_id AND cc.user_id=auth.uid()
  LEFT JOIN public.club_trackers ct ON ct.club_id=t.club_id AND ct.user_id=auth.uid()
  LEFT JOIN public.club_dealer_controls cdc ON cdc.club_id=t.club_id AND cdc.user_id=auth.uid()
  WHERE t.id=tournament_hands.tournament_id
   AND (c.owner_id=auth.uid() OR cc.user_id IS NOT NULL OR ct.user_id IS NOT NULL OR cdc.user_id IS NOT NULL)
 ) OR (tournament_hands.created_by=auth.uid() AND public.has_role(auth.uid(),'super_admin'::public.app_role)))
 WITH CHECK (EXISTS (
  SELECT 1 FROM public.tournaments t
  LEFT JOIN public.clubs c ON c.id=t.club_id
  LEFT JOIN public.club_cashiers cc ON cc.club_id=t.club_id AND cc.user_id=auth.uid()
  LEFT JOIN public.club_trackers ct ON ct.club_id=t.club_id AND ct.user_id=auth.uid()
  LEFT JOIN public.club_dealer_controls cdc ON cdc.club_id=t.club_id AND cdc.user_id=auth.uid()
  WHERE t.id=tournament_hands.tournament_id
   AND (c.owner_id=auth.uid() OR cc.user_id IS NOT NULL OR ct.user_id IS NOT NULL OR cdc.user_id IS NOT NULL)
 ) OR (tournament_hands.created_by=auth.uid() AND public.has_role(auth.uid(),'super_admin'::public.app_role)))
 $policy$;
 SELECT polroles,polpermissive,polcmd,pg_get_expr(polqual,polrelid) predicate,
  pg_get_expr(polwithcheck,polrelid) check_predicate
 INTO STRICT current_policy FROM pg_catalog.pg_policy
 WHERE polrelid='public.tournament_hands'::regclass AND polname='Tournament hands manageable by admins';
 IF current_policy.polroles IS DISTINCT FROM prior.polroles
  OR current_policy.polpermissive IS DISTINCT FROM prior.polpermissive
  OR current_policy.polcmd IS DISTINCT FROM prior.polcmd
  OR current_policy.predicate IS DISTINCT FROM current_policy.check_predicate
  OR current_policy.predicate NOT LIKE '%has_role%super_admin%' THEN
  RAISE EXCEPTION 'tracker_hand_tenant_policy_postcondition_failed';
 END IF;
END $migration$;
COMMIT;
