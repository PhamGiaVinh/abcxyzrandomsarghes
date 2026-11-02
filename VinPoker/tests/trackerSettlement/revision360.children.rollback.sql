\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'local360_only';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.tracker_bump_hand_source_revision()'::regprocedure)<>'788228372490f54cfa8e28c3d2ec1908' THEN RAISE EXCEPTION 'revision360_trigger_drift';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf' AND source_revision=25 AND status='completed' AND NOT is_voided) THEN RAISE EXCEPTION 'revision360_fixture_drift';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes WHERE hand_id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf' AND source_revision=25 AND status='verified' AND verification_scope='historical_display') THEN RAISE EXCEPTION 'revision360_current_proof_missing';END IF;
END $$;
CREATE FUNCTION pg_temp.assert_revision360() RETURNS void LANGUAGE plpgsql AS $$ DECLARE revision bigint; BEGIN
 SELECT source_revision INTO revision FROM public.tournament_hands WHERE id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf';
 IF revision<=25 THEN RAISE EXCEPTION 'revision360_not_bumped';END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes WHERE hand_id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf' AND source_revision=25 AND status='verified') THEN RAISE EXCEPTION 'revision360_old_proof_verified';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf' AND source_revision=revision) THEN RAISE EXCEPTION 'revision360_not_queued';END IF;
END $$;
SAVEPOINT action_delete;
DELETE FROM public.hand_actions WHERE id='4a87e786-b21d-4074-9250-85e28fbb8386';
SELECT pg_temp.assert_revision360();
ROLLBACK TO action_delete;
SAVEPOINT action_insert;
INSERT INTO public.hand_actions SELECT (jsonb_populate_record(NULL::public.hand_actions,to_jsonb(a)||jsonb_build_object('id',gen_random_uuid(),'action_order',1000,'action_type','check','action_amount',0))).* FROM public.hand_actions a WHERE id='4a87e786-b21d-4074-9250-85e28fbb8386';
SELECT pg_temp.assert_revision360();
ROLLBACK TO action_insert;
SAVEPOINT player_cards;
UPDATE public.hand_players SET hole_cards='["Qh","Qs"]'::jsonb WHERE id='b7198f70-f573-4f09-9da7-4905f4791f37';
SELECT pg_temp.assert_revision360();
ROLLBACK TO player_cards;
SAVEPOINT player_delete;
DELETE FROM public.hand_players WHERE id='b7198f70-f573-4f09-9da7-4905f4791f37';
SELECT pg_temp.assert_revision360();
ROLLBACK TO player_delete;
SELECT 'REVISION360_ACTION_INSERT_DELETE_PLAYER_CARDS_DELETE_INVALIDATE_QUEUE_PASS';
ROLLBACK;
