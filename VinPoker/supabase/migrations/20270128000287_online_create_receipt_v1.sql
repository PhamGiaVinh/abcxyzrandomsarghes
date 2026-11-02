-- CLI generated20261024213929; reserved forward287. Additive keyed create API.
-- Legacy callers remain for compatibility; do not label them replay-safe.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres' OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000287')
 OR to_regclass('private.online_create_requests_v1') IS NOT NULL
 OR to_regprocedure('public.op_create_open_table_v2(text,bigint,bigint,bigint,integer,uuid)') IS NOT NULL
 OR to_regprocedure('public.op_get_create_receipt_v1(uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'ONLINE287_CATALOG_COLLISION';END IF;
 IF md5(pg_get_functiondef('public.op_create_open_table(text,bigint,bigint,bigint,integer)'::regprocedure))<>'1e522dbfcbaa77628b231351fb1fb4e4'
 THEN RAISE EXCEPTION 'ONLINE287_LEGACY_CREATE_DRIFT';END IF;
END $$;
CREATE TABLE private.online_create_requests_v1(
 actor_id uuid NOT NULL REFERENCES auth.users(id),request_id uuid NOT NULL,
 payload jsonb NOT NULL,receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE private.online_create_requests_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.online_create_requests_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.op_create_open_table_v2(p_name text,p_sb bigint,p_bb bigint,p_buyin bigint,p_max_seats integer,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();payload jsonb;prior private.online_create_requests_v1%ROWTYPE;result jsonb;v_table_id uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'online_create_actor_required' USING ERRCODE='42501';END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'online_create_request_required' USING ERRCODE='22023';END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'online_create_requires_read_committed' USING ERRCODE='40001';END IF;
 payload:=jsonb_build_object('name',p_name,'sb',p_sb,'bb',p_bb,'buyin',p_buyin,'maxSeats',p_max_seats);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('online-create:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM private.online_create_requests_v1 WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'online_create_request_conflict' USING ERRCODE='23505';END IF;
  RETURN prior.receipt||jsonb_build_object('replayed',true);
 END IF;
 result:=public.op_create_open_table(p_name,p_sb,p_bb,p_buyin,p_max_seats);
 IF jsonb_typeof(result)<>'object' OR result->>'outcome' IS NULL OR result->>'outcome' NOT IN('ok','disabled','bad_blinds','bad_buyin','bad_max_seats') THEN
  RAISE EXCEPTION 'online_create_invalid_receipt' USING ERRCODE='23514';END IF;
 IF result->>'outcome'='ok' THEN
  v_table_id:=(result->>'table_id')::uuid;
  IF v_table_id IS NULL OR result->>'seat_no' IS DISTINCT FROM '1'
   OR NOT EXISTS(SELECT 1 FROM public.online_poker_tables t WHERE t.id=v_table_id AND t.created_by=actor AND t.host_user_id=actor)
   OR NOT EXISTS(SELECT 1 FROM public.online_poker_seats s WHERE s.table_id=v_table_id AND s.seat_no=1 AND s.user_id=actor AND s.stack=p_buyin AND s.status='sitting')
  THEN RAISE EXCEPTION 'online_create_invalid_receipt' USING ERRCODE='23514';END IF;
 END IF;
 result:=result||jsonb_build_object('request_id',p_request_id,'replayed',false);
 INSERT INTO private.online_create_requests_v1(actor_id,request_id,payload,receipt)VALUES(actor,p_request_id,payload,result);
 RETURN result;
END $$;
CREATE FUNCTION public.op_get_create_receipt_v1(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();prior private.online_create_requests_v1%ROWTYPE;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'online_create_actor_required' USING ERRCODE='42501';END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'online_create_request_required' USING ERRCODE='22023';END IF;
 SELECT * INTO prior FROM private.online_create_requests_v1 WHERE actor_id=actor AND request_id=p_request_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found','request_id',p_request_id);END IF;
 RETURN jsonb_build_object('outcome','found','request_id',p_request_id,'payload',prior.payload,'receipt',prior.receipt);
END $$;
REVOKE ALL ON FUNCTION public.op_create_open_table_v2(text,bigint,bigint,bigint,integer,uuid),public.op_get_create_receipt_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.op_create_open_table_v2(text,bigint,bigint,bigint,integer,uuid),public.op_get_create_receipt_v1(uuid) TO authenticated;
COMMIT;
