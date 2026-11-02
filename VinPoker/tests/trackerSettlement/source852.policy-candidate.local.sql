-- HISTORICAL prototype before Super Admin compatibility qualification853.
-- Do not install or use as current repair; use reviewed forward295 instead.
-- Local rollback qualification only. Not a migration or install command.
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT (SELECT md5(jsonb_build_object('qual',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid),
  'roles',polroles,'permissive',polpermissive,'command',polcmd)::text) FROM pg_policy
  WHERE polrelid='public.tournament_hands'::regclass AND polname='Tournament hands manageable by admins')='e429b3f6a9164828faf23013d75dba00';
END $$;
-- created_by is provenance, not tenant authority. Canonical assigned-Dealer
-- writers are SECURITY DEFINER and perform their own current assignment checks.
ALTER POLICY "Tournament hands manageable by admins" ON public.tournament_hands
USING (EXISTS (
 SELECT 1 FROM public.tournaments t
 LEFT JOIN public.clubs c ON c.id=t.club_id
 LEFT JOIN public.club_cashiers cc ON cc.club_id=t.club_id AND cc.user_id=auth.uid()
 LEFT JOIN public.club_trackers ct ON ct.club_id=t.club_id AND ct.user_id=auth.uid()
 LEFT JOIN public.club_dealer_controls cdc ON cdc.club_id=t.club_id AND cdc.user_id=auth.uid()
 WHERE t.id=tournament_hands.tournament_id
  AND (c.owner_id=auth.uid() OR cc.user_id IS NOT NULL OR ct.user_id IS NOT NULL OR cdc.user_id IS NOT NULL)
))
WITH CHECK (EXISTS (
 SELECT 1 FROM public.tournaments t
 LEFT JOIN public.clubs c ON c.id=t.club_id
 LEFT JOIN public.club_cashiers cc ON cc.club_id=t.club_id AND cc.user_id=auth.uid()
 LEFT JOIN public.club_trackers ct ON ct.club_id=t.club_id AND ct.user_id=auth.uid()
 LEFT JOIN public.club_dealer_controls cdc ON cdc.club_id=t.club_id AND cdc.user_id=auth.uid()
 WHERE t.id=tournament_hands.tournament_id
  AND (c.owner_id=auth.uid() OR cc.user_id IS NOT NULL OR ct.user_id IS NOT NULL OR cdc.user_id IS NOT NULL)
));
