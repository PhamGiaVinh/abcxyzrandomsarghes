-- CLI candidate20261018143958, forward150; LOCAL ONLY.
-- Preserve existing pricing/stock rules. Bind retries before legacy unique-key replay.
-- Recovery: disable create endpoints; keep receipts/audit. Never restore permissive replay.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
BEGIN
  IF current_user<>'postgres' OR to_regclass('public.fnb_create_intents_v1') IS NOT NULL
    OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000150') THEN
    RAISE EXCEPTION 'fnb150_catalog_collision';
  END IF;
END $$;
CREATE TABLE public.fnb_create_intents_v1(
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  request_id text NOT NULL,
  actor_id uuid NOT NULL,
  operation text NOT NULL CHECK(operation IN('order','comp')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(club_id,request_id)
);
ALTER TABLE public.fnb_create_intents_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fnb_create_intents_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public._fnb_bind_create_intent_v1(p_actor uuid,p_club uuid,p_key text,p_operation text,p_payload jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE existing public.fnb_create_intents_v1%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR p_actor IS DISTINCT FROM auth.uid() OR p_club IS NULL
    OR p_key IS NULL OR btrim(p_key)='' OR p_payload IS NULL THEN RETURN false; END IF;
  -- The legacy unique index is club+key, so both operation paths must share this lock.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club::text||':'||p_key,0));
  SELECT * INTO existing FROM public.fnb_create_intents_v1 WHERE club_id=p_club AND request_id=p_key;
  IF FOUND THEN
    RETURN existing.actor_id=p_actor AND existing.operation=p_operation AND existing.payload=p_payload;
  END IF;
  -- Historical keys have no provable original payload. Read the existing order instead;
  -- never adopt an arbitrary new request as its original intent.
  IF EXISTS(SELECT 1 FROM public.fnb_orders WHERE club_id=p_club AND client_request_id=p_key) THEN RETURN false; END IF;
  INSERT INTO public.fnb_create_intents_v1(club_id,request_id,actor_id,operation,payload)
    VALUES(p_club,p_key,p_actor,p_operation,p_payload);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._fnb_bind_create_intent_v1(uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE r record;body text;definition text;patched text;acl aclitem[];needle text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fnb_create_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,uuid,uuid)','2c43647785b69858333084e6537e12b5','order',
      'jsonb_build_object(''source'',p_source,''table'',p_table_label,''customer'',p_customer_name,''note'',p_note,''lines'',p_lines,''table_ref'',p_table_ref,''player_ref'',p_player_ref)'),
    ('public.fnb_create_comp_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,text)','5612637b3eff7936febbe767d4423882','comp',
      'jsonb_build_object(''source'',p_source,''table'',p_table_label,''customer'',p_customer_name,''note'',p_note,''lines'',p_lines,''reason'',p_comp_reason)')
  ) AS targets(signature,digest,operation,payload)
  LOOP
    SELECT prosrc,proacl INTO body,acl FROM pg_proc WHERE oid=r.signature::regprocedure;
    IF md5(body) IS DISTINCT FROM r.digest THEN RAISE EXCEPTION 'fnb150_function_drift: %',r.signature; END IF;
    needle:='v_crid := COALESCE(NULLIF(btrim(p_client_request_id), ''''), gen_random_uuid()::text);';
    IF length(body)-length(replace(body,needle,''))<>length(needle) THEN RAISE EXCEPTION 'fnb150_insert_seam_drift'; END IF;
    patched:=replace(body,needle,needle||E'\n  IF NOT public._fnb_bind_create_intent_v1(v_uid,p_club_id,v_crid,'||quote_literal(r.operation)||','||r.payload||E') THEN\n    RETURN jsonb_build_object(''error'',''REQUEST_ID_CONFLICT'');\n  END IF;');
    definition:=pg_get_functiondef(r.signature::regprocedure);
    IF position(body IN definition)=0 THEN RAISE EXCEPTION 'fnb150_definition_drift'; END IF;
    EXECUTE replace(definition,body,patched);
    IF (SELECT prosrc FROM pg_proc WHERE oid=r.signature::regprocedure) IS DISTINCT FROM patched
      OR (SELECT proacl FROM pg_proc WHERE oid=r.signature::regprocedure) IS DISTINCT FROM acl THEN
      RAISE EXCEPTION 'fnb150_body_or_acl_postcheck_failed';
    END IF;
  END LOOP;
END $patch$;
COMMIT;
