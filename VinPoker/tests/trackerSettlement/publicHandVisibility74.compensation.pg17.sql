-- Isolated compensation rehearsal only; production requires a new reviewed migration.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
 IF current_database() NOT IN ('vinpoker_visibility74_acl_20261014','vinpoker_visibility74_ci') OR current_user<>'postgres'
 OR inet_server_addr()<>'127.0.0.1'::inet
 OR (current_database()='vinpoker_visibility74_acl_20261014' AND inet_server_port()<>55464)
 OR (current_database()='vinpoker_visibility74_ci' AND inet_server_port()<>55441)
 OR md5(replace(pg_get_functiondef('floor_private.tracker_hand_read_scope74(uuid,boolean,uuid)'::regprocedure),chr(13),''))<>'9da991bb1262c314ded4bfd69c70749c'
 OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname IN ('tournament_hands_visibility74','hand_players_visibility74') AND permissive='RESTRICTIVE' AND cmd='SELECT')<>2
 THEN RAISE EXCEPTION 'owned_visibility74_compensation_fixture_required'; END IF;
 PERFORM set_config('visibility74.compensation_baseline',(
 SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname)::text)
 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename IN ('tournament_hands','hand_players')
 AND p.policyname NOT IN ('tournament_hands_visibility74','hand_players_visibility74')),true);
END;
$guard$;
DROP POLICY tournament_hands_visibility74 ON public.tournament_hands;
DROP POLICY hand_players_visibility74 ON public.hand_players;
REVOKE ALL ON FUNCTION floor_private.tracker_hand_read_scope74(uuid,boolean,uuid) FROM anon,authenticated;
DROP FUNCTION floor_private.tracker_hand_read_scope74(uuid,boolean,uuid);
DO $post$
BEGIN
 IF to_regprocedure('floor_private.tracker_hand_read_scope74(uuid,boolean,uuid)') IS NOT NULL
 OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename IN ('tournament_hands','hand_players'))<>6 THEN RAISE EXCEPTION 'visibility74_compensation_postcheck'; END IF;
 IF (SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname)::text) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename IN ('tournament_hands','hand_players')) IS DISTINCT FROM current_setting('visibility74.compensation_baseline') THEN RAISE EXCEPTION 'visibility74_compensation_changed_existing_policy'; END IF;
 RAISE NOTICE 'VISIBILITY74_ISOLATED_COMPENSATION_PASS';
END;
$post$;
ROLLBACK;
