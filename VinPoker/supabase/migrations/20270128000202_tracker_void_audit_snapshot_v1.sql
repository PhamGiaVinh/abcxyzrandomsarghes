-- CLI generated20261020063623; forward202 after local catalog collision check.
-- Preserve the existing Void chip/lifecycle semantics, but archive source before
-- in-progress actions/cards are cleared. No legacy snapshot backfill is inferred.
-- Recovery: transactional DDL rollback before qualification; retain all committed
-- snapshots and audit. Never drop audit rows or restore unaudited deletion blindly.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres'
 OR md5(replace(pg_get_functiondef('public.void_last_hand(uuid)'::regprocedure),chr(13),''))<>'278caed40725bfe99b97d2cc61887037'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000202')
 OR to_regclass('floor_private.tracker_void_snapshots202') IS NOT NULL
 OR to_regprocedure('floor_private.capture_tracker_void_snapshot202(uuid)') IS NOT NULL
 OR (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname='postgres') IS NOT TRUE
 THEN RAISE EXCEPTION 'tracker_void202_baseline_drift_or_collision';END IF;
END $$;

CREATE TABLE floor_private.tracker_void_snapshots202(
 hand_id uuid PRIMARY KEY REFERENCES public.tournament_hands(id) ON DELETE RESTRICT,
 tournament_id uuid NOT NULL,club_id uuid NOT NULL,actor_id uuid NOT NULL,
 source_revision bigint NOT NULL CHECK(source_revision>0),
 hand_snapshot jsonb NOT NULL CHECK(jsonb_typeof(hand_snapshot)='object'),
 players_snapshot jsonb NOT NULL CHECK(jsonb_typeof(players_snapshot)='array'),
 actions_snapshot jsonb NOT NULL CHECK(jsonb_typeof(actions_snapshot)='array'),
 snapshot_digest text NOT NULL CHECK(length(snapshot_digest)=32),
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(hand_snapshot->>'id'=hand_id::text),
 CHECK((hand_snapshot->>'source_revision')::bigint=source_revision)
);
ALTER TABLE floor_private.tracker_void_snapshots202 ENABLE ROW LEVEL SECURITY;
ALTER TABLE floor_private.tracker_void_snapshots202 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE floor_private.tracker_void_snapshots202 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION floor_private.reject_tracker_void_snapshot_change202() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 RAISE EXCEPTION 'tracker_void_snapshot_immutable' USING ERRCODE='55000';
END $$;
REVOKE ALL ON FUNCTION floor_private.reject_tracker_void_snapshot_change202() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER tracker_void_snapshot_immutable202 BEFORE UPDATE OR DELETE ON floor_private.tracker_void_snapshots202
FOR EACH ROW EXECUTE FUNCTION floor_private.reject_tracker_void_snapshot_change202();

CREATE FUNCTION floor_private.capture_tracker_void_snapshot202(p_hand_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();h public.tournament_hands%ROWTYPE;club uuid;players jsonb;actions jsonb;
BEGIN
 SELECT * INTO h FROM public.tournament_hands WHERE id=p_hand_id FOR UPDATE;
 SELECT club_id INTO club FROM public.tournaments WHERE id=h.tournament_id;
 IF h.id IS NULL OR actor IS NULL OR public.is_club_tracker(actor,club) IS NOT TRUE
 THEN RAISE EXCEPTION 'tracker_void_snapshot_actor_not_allowed' USING ERRCODE='42501';END IF;
 IF h.is_voided OR h.status NOT IN('in_progress','completed')
 THEN RAISE EXCEPTION 'tracker_void_snapshot_context_changed';END IF;
 IF EXISTS(SELECT 1 FROM floor_private.tracker_void_snapshots202 WHERE hand_id=p_hand_id)
 THEN RAISE EXCEPTION 'tracker_void_snapshot_already_exists';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.seat_number,p.player_id,p.entry_number,p.id),'[]'::jsonb)
 INTO players FROM public.hand_players p WHERE p.hand_id=p_hand_id;
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.action_order,a.id),'[]'::jsonb)
 INTO actions FROM public.hand_actions a WHERE a.hand_id=p_hand_id;
 INSERT INTO floor_private.tracker_void_snapshots202(hand_id,tournament_id,club_id,actor_id,source_revision,
  hand_snapshot,players_snapshot,actions_snapshot,snapshot_digest)
 VALUES(h.id,h.tournament_id,club,actor,h.source_revision,to_jsonb(h),players,actions,
  md5(jsonb_build_object('hand',to_jsonb(h),'players',players,'actions',actions)::text));
END $$;
REVOKE ALL ON FUNCTION floor_private.capture_tracker_void_snapshot202(uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $$ DECLARE definition text;before_acl aclitem[];marker text;BEGIN
 SELECT replace(pg_get_functiondef(oid),chr(13),''),proacl INTO definition,before_acl
 FROM pg_proc WHERE oid='public.void_last_hand(uuid)'::regprocedure AND proowner='postgres'::regrole
 AND prosecdef AND proconfig=ARRAY['search_path=public'];
 IF definition IS NULL THEN RAISE EXCEPTION 'tracker_void202_owner_or_config_drift';END IF;
 marker:=E'    FOR v_player_record IN\n      SELECT *\n      FROM public.hand_players';
 IF array_length(string_to_array(definition,marker),1)<>2 THEN RAISE EXCEPTION 'tracker_void202_completed_marker_drift';END IF;
 definition:=replace(definition,marker,E'    PERFORM floor_private.capture_tracker_void_snapshot202(p_hand_id);\n'||marker);
 marker:=E'  IF v_hand_record.status = ''in_progress'' THEN\n    DELETE FROM public.hand_actions WHERE hand_id = p_hand_id;';
 IF array_length(string_to_array(definition,marker),1)<>2 THEN RAISE EXCEPTION 'tracker_void202_active_marker_drift';END IF;
 definition:=replace(definition,marker,E'  IF v_hand_record.status = ''in_progress'' THEN\n    PERFORM floor_private.capture_tracker_void_snapshot202(p_hand_id);\n    DELETE FROM public.hand_actions WHERE hand_id = p_hand_id;');
 EXECUTE definition;
 IF (SELECT proacl FROM pg_proc WHERE oid='public.void_last_hand(uuid)'::regprocedure) IS DISTINCT FROM before_acl
 THEN RAISE EXCEPTION 'tracker_void202_acl_changed';END IF;
END $$;
COMMIT;
