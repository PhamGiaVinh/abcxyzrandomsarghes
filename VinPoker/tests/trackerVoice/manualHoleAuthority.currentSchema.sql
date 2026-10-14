-- Runs only inside the existing guarded owned-schema rollback harness.
-- Same authenticated actor transport used by tournament-live-update manual RPC.
DO $$ BEGIN
 IF current_database() NOT IN ('vinpoker_voice_dealer_baseline_20261014','vinpoker_voice_migration70_20261014')
 OR current_user<>'postgres' OR inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port()<>55464
 OR current_setting('manual75.fixture',true) IS DISTINCT FROM 'owned-manual-authority'
 THEN RAISE EXCEPTION 'owned_manual_authority_rollback_harness_required'; END IF;
END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.club_trackers WHERE user_id='81200000-0000-4000-8000-000000000001')
 OR NOT EXISTS(SELECT 1 FROM public.dealers d JOIN public.dealer_assignments a ON a.dealer_id=d.id
  WHERE d.user_id='81200000-0000-4000-8000-000000000001' AND a.status='assigned'
  AND a.released_at IS NULL AND a.table_session_id='83500000-0000-4000-8000-000000000001')
 THEN RAISE EXCEPTION 'qualified_manual_dealer_fixture_required'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81200000-0000-4000-8000-000000000001',false);
SELECT set_config('request.jwt.claims','{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}',false);
SELECT public.show_hole_cards(
 '86000000-0000-4000-8000-000000000001',
 '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Qh","Qs"]}]'::jsonb,
 '81200000-0000-4000-8000-000000000001')::text AS payload \gset manual_authority_
RESET ROLE;
SELECT (:'manual_authority_payload'::jsonb->>'status'='success'
 AND (SELECT hole_cards='["Qh","Qs"]'::jsonb FROM public.hand_players
  WHERE hand_id='86000000-0000-4000-8000-000000000001' AND seat_number=2)) AS allowed \gset manual_authority_
\if :manual_authority_allowed
\echo MANUAL_ASSIGNED_DEALER_HOLE_AUTHORITY_PASS
\else
\echo MANUAL_ASSIGNED_DEALER_HOLE_AUTHORITY_REJECTED
\echo :manual_authority_payload
DO $$ BEGIN RAISE EXCEPTION 'manual_assigned_dealer_hole_authority_rejected'; END $$;
\endif
-- A canonical hand may have been started by Owner or another controller.
-- Assignment authority must not accidentally depend on who created the hand.
UPDATE public.tournament_hands SET created_by='81100000-0000-4000-8000-000000000001'
 WHERE id='86000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT public.show_hole_cards('86000000-0000-4000-8000-000000000001','[]'::jsonb,
 '81200000-0000-4000-8000-000000000001')::text AS payload \gset manual_other_creator_
RESET ROLE;
SELECT (:'manual_other_creator_payload'::jsonb->>'status'='success') AS allowed \gset manual_other_creator_
\if :manual_other_creator_allowed
\echo MANUAL_ASSIGNED_DEALER_OTHER_CREATOR_PASS
\else
\echo MANUAL_ASSIGNED_DEALER_OTHER_CREATOR_REJECTED
\echo :manual_other_creator_payload
DO $$ BEGIN RAISE EXCEPTION 'manual_assigned_dealer_other_creator_rejected'; END $$;
\endif
-- Existing Voice fixtures intentionally remove the Dealer web identity. That
-- must not be misreported as a valid browser Dealer authorization failure.
UPDATE public.dealers SET user_id=NULL WHERE id='87000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT public.show_hole_cards('86000000-0000-4000-8000-000000000001','[]'::jsonb,
 '81200000-0000-4000-8000-000000000001')::text AS payload \gset manual_unlinked_
RESET ROLE;
SELECT (:'manual_unlinked_payload'::jsonb->>'error'='hand_not_found') AS denied \gset manual_unlinked_
\if :manual_unlinked_denied
\echo MANUAL_UNLINKED_WEB_ACTOR_DENIED_PASS
\else
DO $$ BEGIN RAISE EXCEPTION 'manual_unlinked_web_actor_not_denied'; END $$;
\endif
