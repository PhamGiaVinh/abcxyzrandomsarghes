BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='20s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='e2481594-66a4-422b-9aa8-1bdd293ee3ac' AND status='completed' AND NOT is_voided);
END $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}';
DO $$ DECLARE old_seat jsonb;r jsonb;BEGIN
 SELECT to_jsonb(s) INTO old_seat FROM public.tournament_seats s WHERE id='d5b6eaeb-1616-493c-9da1-6dea18c97d1f';
 ASSERT old_seat->>'status'='busted' AND old_seat->>'is_active'='false';
 BEGIN
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}',true);
  PERFORM set_config('role','authenticated',true);
  r:=public.void_last_hand('e2481594-66a4-422b-9aa8-1bdd293ee3ac');
  ASSERT r->>'error'='actor_not_allowed',r::text;
  RAISE SQLSTATE 'PZ192';
 EXCEPTION WHEN SQLSTATE 'PZ192' THEN NULL;END;
 BEGIN
  UPDATE public.tournament_seats SET is_active=false,status='moved' WHERE id='d08e59cf-3f49-4302-8785-1cef5e15e26f';
  PERFORM set_config('role','authenticated',true);
  r:=public.void_last_hand('e2481594-66a4-422b-9aa8-1bdd293ee3ac');
  ASSERT r->>'error'='void_seat_dependency',r::text;
  RAISE SQLSTATE 'PZ192';
 EXCEPTION WHEN SQLSTATE 'PZ192' THEN NULL;END;
 BEGIN
  UPDATE public.tournament_entries SET current_stack=current_stack+1 WHERE id='9384eec9-8014-4d38-a1b0-03a35d264aa9';
  PERFORM set_config('role','authenticated',true);
  r:=public.void_last_hand('e2481594-66a4-422b-9aa8-1bdd293ee3ac');
  ASSERT r->>'error'='void_stack_dependency',r::text;
  RAISE SQLSTATE 'PZ192';
 EXCEPTION WHEN SQLSTATE 'PZ192' THEN NULL;END;
 BEGIN
  -- Ambiguous historical busted candidates remain blocked: no newest-row guess.
  UPDATE public.tournament_entries SET status='busted',current_stack=0 WHERE id='9384eec9-8014-4d38-a1b0-03a35d264aa9';
  UPDATE public.tournament_seats SET is_active=false,status='busted' WHERE id='d08e59cf-3f49-4302-8785-1cef5e15e26f';
  UPDATE public.hand_players SET ending_stack=0,is_eliminated=true WHERE hand_id='e2481594-66a4-422b-9aa8-1bdd293ee3ac' AND player_id='533feda3-28c5-4194-bdf3-53a07c41305b';
  PERFORM set_config('role','authenticated',true);
  r:=public.void_last_hand('e2481594-66a4-422b-9aa8-1bdd293ee3ac');
  ASSERT r->>'error'='void_seat_dependency',r::text;
  RAISE SQLSTATE 'PZ192';
 EXCEPTION WHEN SQLSTATE 'PZ192' THEN NULL;END;
 PERFORM set_config('role','authenticated',true);
 r:=public.void_last_hand('e2481594-66a4-422b-9aa8-1bdd293ee3ac');
 ASSERT r->>'status'='success',r::text;
 r:=public.void_last_hand('e2481594-66a4-422b-9aa8-1bdd293ee3ac');
 ASSERT r->>'error'='Hand already voided',r::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT to_jsonb(s) FROM public.tournament_seats s WHERE id='d5b6eaeb-1616-493c-9da1-6dea18c97d1f')=old_seat,'historical busted seat was rewritten';
 ASSERT (SELECT is_active AND status='active' AND chip_count=600 FROM public.tournament_seats WHERE id='d08e59cf-3f49-4302-8785-1cef5e15e26f'),'current short seat changed identity/stack';
 ASSERT (SELECT count(*)=2 AND sum(chip_count)=60000 FROM public.tournament_seats WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND is_active),'void broke live seat conservation';
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='e2481594-66a4-422b-9aa8-1bdd293ee3ac' AND status='voided' AND is_voided);
END $$;
ROLLBACK;
SELECT 'VOID192_RETAINED_CHILD_CURRENT_SEAT_HISTORY_PRESERVED_ROLLBACK_PASS';
