-- Appended inside the existing operationalInventory transaction; all rollback.
RESET ROLE;
UPDATE public.dealer_assignments SET swing_due_at=now()-interval '1 minute'
WHERE table_session_id='e1700000-0000-4000-8000-000000000021' AND released_at IS NULL;
SET LOCAL request.jwt.claim.sub='e1700000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"e1700000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(
  public.get_dealer_swing_health(ARRAY['e1700000-0000-4000-8000-000000000002'::uuid])->0->>'overdue_now'='1',
  'current exact-session overdue assignment is visible to owner');
SELECT pg_temp.assert_true(
  jsonb_array_length(public.get_dealer_swing_health(ARRAY['e1700000-0000-4000-8000-000000000002'::uuid,
  'e1700000-0000-4000-8000-000000000099'::uuid]))=1,
  'health projects only caller-authorized club in mixed request');
SELECT pg_temp.assert_true(
  public.get_dealer_swing_health(ARRAY['e1700000-0000-4000-8000-000000000099'::uuid])='[]'::jsonb,
  'owner cannot read unrelated club health');
SELECT pg_temp.assert_true(
  (public.operator_close_club_table_v2('e1700000-0000-4000-8000-000000000021',1,gen_random_uuid())->>'ok')::boolean,
  'actual operator close succeeds for overdue staffed session');
SELECT pg_temp.assert_true(
  public.get_dealer_swing_health(ARRAY['e1700000-0000-4000-8000-000000000002'::uuid])->0->>'overdue_now'='0',
  'health clears overdue count after canonical close');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT closed_at IS NOT NULL FROM public.table_sessions
  WHERE id='e1700000-0000-4000-8000-000000000021'),'session actually closed');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.dealer_assignments
  WHERE table_session_id='e1700000-0000-4000-8000-000000000021' AND released_at IS NULL),'assignment actually released');
SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.get_dealer_operational_tables_v1(
  'e1700000-0000-4000-8000-000000000002') WHERE id='e1700000-0000-4000-8000-000000000011'),
  'worker inventory excludes same closed session');
SELECT pg_temp.assert_true(public.worker_assign_dealer_to_session_v1(
  'e1700000-0000-4000-8000-000000000002','e1700000-0000-4000-8000-000000000011',
  'e1700000-0000-4000-8000-000000000021','e1700000-0000-4000-8000-000000000041',
  now()+interval '30 minutes','health-late-key')->>'outcome'='table_session_changed',
  'late worker cannot revive a closed session');
RESET ROLE;
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.get_dealer_swing_health(uuid[])','EXECUTE'),
  'health is not anonymous');
INSERT INTO public.club_processing_locks(club_id,owner_id,locked_by,locked_at,expires_at,last_heartbeat_at)
VALUES('e1700000-0000-4000-8000-000000000002',gen_random_uuid(),'LOCAL health TEST',
  now()-interval '30 seconds',now()+interval '30 seconds',NULL);
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='e1700000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claims='{"sub":"e1700000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE lease jsonb;BEGIN
 lease:=public.get_dealer_swing_health(ARRAY['e1700000-0000-4000-8000-000000000002'::uuid])->0->'lock';
 PERFORM pg_temp.assert_true(lease->>'held'='true' AND lease->>'is_expired'='false'
   AND lease->>'age_seconds'='30' AND lease->'heartbeat_age_seconds'='null'::jsonb,
   'real held lease matches client positive contract, nullable heartbeat allowed');
END $$;
RESET ROLE;
UPDATE public.club_processing_locks SET expires_at=now()-interval '1 second'
WHERE club_id='e1700000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.get_dealer_swing_health(ARRAY['e1700000-0000-4000-8000-000000000002'::uuid])
  ->0->'lock'->>'is_expired'='true','expired lease is explicit; this is deadline injection, not a wall-clock soak');
RESET ROLE;
SELECT 'SWING_HEALTH_EXACT_SESSION_CLOSE_SCOPE_LATE_WORKER_NATIVE_PASS';
