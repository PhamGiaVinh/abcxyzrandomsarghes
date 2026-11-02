-- Qualification of the active BookingChat confirmPayment prefix, not a fix PASS.
BEGIN;
SET LOCAL statement_timeout='10s';
DO $guard$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR NOT EXISTS(SELECT 1 FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
  JOIN public.tournament_entries e ON e.tournament_id=t.id
  WHERE t.id='d24e3aed-f125-4bc5-ab11-49836c435e30' AND c.owner_id='f793a5b3-6025-4766-bc1b-49f16aa1b44a' AND e.id='84bf4113-c9cb-4ce0-bbbd-f808685b157d' AND e.player_id='a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec')
 THEN RAISE EXCEPTION 'booking114_legacy_scope';END IF;
END $guard$;
SET LOCAL request.jwt.claim.sub='f793a5b3-6025-4766-bc1b-49f16aa1b44a';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"f793a5b3-6025-4766-bc1b-49f16aa1b44a"}';
SET LOCAL ROLE authenticated;
DO $prefix$ BEGIN
 IF auth.uid() IS DISTINCT FROM 'f793a5b3-6025-4766-bc1b-49f16aa1b44a'::uuid THEN RAISE EXCEPTION 'booking114_auth_model';END IF;
 BEGIN
  INSERT INTO public.stack_registrations(user_id,tournament_id,status)
  VALUES('a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec','d24e3aed-f125-4bc5-ab11-49836c435e30','confirmed');
  RAISE EXCEPTION 'booking114_expected_legacy_boundary_not_observed';
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM NOT LIKE '%row-level security policy%' THEN RAISE;END IF;
 END;
END $prefix$;
RESET ROLE;
ROLLBACK;
SELECT 'BOOKING114_CONFIRMPAYMENT_LEGACY_OWNER_INSERT_BLOCKED_BY_CURRENT_LOCAL_RLS_NOT_FEATURE_ACCEPTANCE';
