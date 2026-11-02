\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'local327_only';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf' AND source_revision=25 AND status='completed' AND NOT is_voided)
 THEN RAISE EXCEPTION 'retained_hand327_revision_drift';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes WHERE hand_id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf' AND source_revision=25 AND status='verified' AND verification_scope='historical_display')
 THEN RAISE EXCEPTION 'retained_hand327_current_proof_missing';END IF;
END $$;
CREATE FUNCTION pg_temp.assert_revision327() RETURNS void LANGUAGE plpgsql AS $$
DECLARE revision bigint;
BEGIN
 SELECT source_revision INTO revision FROM public.tournament_hands WHERE id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf';
 IF revision<=25 THEN RAISE EXCEPTION 'source_revision_not_bumped327';END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes WHERE hand_id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf' AND source_revision=25 AND status='verified')
 THEN RAISE EXCEPTION 'old_proof_remains_verified327';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf' AND source_revision=revision)
 THEN RAISE EXCEPTION 'current_revision_not_queued327';END IF;
END $$;
SAVEPOINT board327;
UPDATE public.tournament_hands SET community_cards='["2c","3d","7s","9c","Qh"]'::jsonb WHERE id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf';
SELECT pg_temp.assert_revision327();
ROLLBACK TO board327;
SAVEPOINT participant327;
UPDATE public.hand_players SET starting_stack=starting_stack+1 WHERE id='b7198f70-f573-4f09-9da7-4905f4791f37';
SELECT pg_temp.assert_revision327();
ROLLBACK TO participant327;
SAVEPOINT action327;
UPDATE public.hand_actions SET action_amount=99 WHERE id='4a87e786-b21d-4074-9250-85e28fbb8386';
SELECT pg_temp.assert_revision327();
ROLLBACK TO action327;
SELECT 'REVISION327_BOARD_PARTICIPANT_ACTION_INVALIDATE_QUEUE_ROLLBACK_PASS';
ROLLBACK;
