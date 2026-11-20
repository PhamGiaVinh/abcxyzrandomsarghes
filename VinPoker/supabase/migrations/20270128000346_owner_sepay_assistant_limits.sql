-- PREPARATION ONLY: requires isolated native qualification and exact release approval.
-- No financial records, questions, tokens or answers are stored here.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '10s';
CREATE SCHEMA IF NOT EXISTS owner_assistant_private;
REVOKE ALL ON SCHEMA owner_assistant_private FROM PUBLIC, anon, authenticated;
CREATE TABLE owner_assistant_private.sepay_requests_v1 (
  actor_id uuid NOT NULL,
  club_id uuid NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_id, club_id, request_id)
);
ALTER TABLE owner_assistant_private.sepay_requests_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE owner_assistant_private.sepay_requests_v1 FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX sepay_requests_v1_created_idx ON owner_assistant_private.sepay_requests_v1(created_at);
CREATE INDEX sepay_requests_v1_scope_created_idx ON owner_assistant_private.sepay_requests_v1(actor_id,club_id,created_at);

CREATE FUNCTION public.owner_sepay_reserve_request_v1(p_actor_id uuid, p_club_id uuid, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now timestamptz;
  v_global_minute bigint;
  v_global_day bigint;
  v_scope_minute bigint;
  v_scope_hour bigint;
BEGIN
  IF p_actor_id IS NULL OR p_club_id IS NULL OR p_request_id IS NULL
    OR NOT public.is_club_owner(p_actor_id,p_club_id) THEN
    RAISE EXCEPTION 'owner_assistant_forbidden' USING ERRCODE='42501';
  END IF;
  -- Serialize admission across Edge instances. Reserved requests cannot be
  -- replayed to run the model twice, even if an earlier response was lost.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('owner-sepay-admission-v1',0));
  v_now := pg_catalog.clock_timestamp();
  DELETE FROM owner_assistant_private.sepay_requests_v1 WHERE created_at <= v_now - interval '24 hours';
  IF EXISTS(SELECT 1 FROM owner_assistant_private.sepay_requests_v1
      WHERE actor_id=p_actor_id AND club_id=p_club_id AND request_id=p_request_id) THEN
    RETURN pg_catalog.jsonb_build_object('allowed',false,'duplicate',true);
  END IF;
  SELECT count(*) FILTER(WHERE created_at > v_now - interval '1 minute'),count(*)
    INTO v_global_minute,v_global_day FROM owner_assistant_private.sepay_requests_v1;
  SELECT count(*) FILTER(WHERE created_at > v_now - interval '1 minute'),count(*)
    INTO v_scope_minute,v_scope_hour FROM owner_assistant_private.sepay_requests_v1
    WHERE actor_id=p_actor_id AND club_id=p_club_id AND created_at > v_now - interval '1 hour';
  IF v_global_minute >= 20 OR v_global_day >= 200 OR v_scope_minute >= 3 OR v_scope_hour >= 15 THEN
    RETURN pg_catalog.jsonb_build_object('allowed',false,'duplicate',false);
  END IF;
  INSERT INTO owner_assistant_private.sepay_requests_v1(actor_id,club_id,request_id,created_at)
    VALUES(p_actor_id,p_club_id,p_request_id,v_now);
  RETURN pg_catalog.jsonb_build_object('allowed',true,'duplicate',false);
END;
$$;
REVOKE ALL ON FUNCTION public.owner_sepay_reserve_request_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.owner_sepay_reserve_request_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
-- Rollback: first disable OWNER_SEPAY_ASSISTANT_ENABLED and the UI flag.
-- After no in-flight requests: DROP FUNCTION public.owner_sepay_reserve_request_v1(uuid,uuid,uuid);
-- DROP TABLE owner_assistant_private.sepay_requests_v1; preserve the schema if shared later.
