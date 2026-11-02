-- Tests-only evolution after722: expected actor + durable lookup/cancel, not a production migration.
DO $$ BEGIN
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (current_database()='vinpoker_ops_cash115_qualified_c' AND current_setting('test.fnb725_rollback',true)='on')
  OR (current_database()='vinpoker_fnb719_gate_local' AND current_setting('test.fnb725_clone',true)='on'
   AND (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
 ASSERT to_regprocedure('public.fnb_open_shift_v2(uuid,bigint,text,uuid)') IS NULL;
 ASSERT md5(pg_get_functiondef('public.fnb_open_shift(uuid,bigint,text)'::regprocedure))='6109017eb16065717376c21474d33cbc';
 ASSERT md5(pg_get_functiondef('public.fnb_close_shift(uuid,bigint,text,text)'::regprocedure))='530d8b72b27d2c2ae130351d84445fdb';
END $$;

CREATE FUNCTION floor_private.fnb_shift_actor725(p_club uuid,p_expected uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path='' AS $$ DECLARE actor uuid:=auth.uid();BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Unauthorized';END IF;
 IF actor IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'FNB_SHIFT_ACTOR_MISMATCH';END IF;
 IF NOT(public.is_club_fnb_kind(actor,p_club,'cashier') OR public.is_club_owner(actor,p_club)) THEN RAISE EXCEPTION 'Forbidden';END IF;
 RETURN actor;
END $$;
CREATE FUNCTION floor_private.fnb_shift_payload725(p_club uuid,p_operation text,p_shift uuid,p_amount bigint,p_note text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 IF p_club IS NULL OR p_amount IS NULL OR p_amount<0 THEN RAISE EXCEPTION 'FNB_SHIFT_INVALID_INPUT';END IF;
 IF p_operation='open' AND p_shift IS NULL AND p_note IS NULL THEN
  RETURN jsonb_build_object('operation','open','club',p_club,'float',p_amount);
 ELSIF p_operation='close' AND p_shift IS NOT NULL THEN
  RETURN jsonb_build_object('operation','close','shift',p_shift,'counted',p_amount,'note',p_note);
 END IF;
 RAISE EXCEPTION 'FNB_SHIFT_INVALID_INPUT';
END $$;
CREATE FUNCTION floor_private.fnb_shift_request_gate725(p_actor uuid,p_club uuid,p_key text) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF p_key IS NULL OR length(btrim(p_key)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'FNB_SHIFT_INVALID_INPUT';END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'FNB_SHIFT_READ_COMMITTED_REQUIRED' USING ERRCODE='40001';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fnb-shift-intent:'||p_actor||':'||p_key,722));
 PERFORM floor_private.fnb_cash_event_gate_v1(p_club);
 -- Verify again after a wait, not only against the pre-admission role snapshot.
 PERFORM floor_private.fnb_shift_actor725(p_club,p_actor);
END $$;
REVOKE ALL ON FUNCTION floor_private.fnb_shift_actor725(uuid,uuid),floor_private.fnb_shift_payload725(uuid,text,uuid,bigint,text),floor_private.fnb_shift_request_gate725(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.fnb_open_shift(uuid,bigint,text) SET SCHEMA floor_private;
ALTER FUNCTION floor_private.fnb_open_shift(uuid,bigint,text) RENAME TO fnb_open_shift_core725;
ALTER FUNCTION public.fnb_close_shift(uuid,bigint,text,text) SET SCHEMA floor_private;
ALTER FUNCTION floor_private.fnb_close_shift(uuid,bigint,text,text) RENAME TO fnb_close_shift_core725;
REVOKE ALL ON FUNCTION floor_private.fnb_open_shift_core725(uuid,bigint,text),floor_private.fnb_close_shift_core725(uuid,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE signature text;body text;anchor text;replacement text;BEGIN
 FOR signature,anchor,replacement IN SELECT * FROM (VALUES
  ('floor_private.fnb_open_shift_core725(uuid,bigint,text)',
   'payload:=jsonb_build_object(''operation'',''open'',''club'',p_club_id,''float'',p_opening_float_vnd);',
   'payload:=floor_private.fnb_shift_payload725(p_club_id,''open'',NULL,p_opening_float_vnd,NULL);'),
  ('floor_private.fnb_close_shift_core725(uuid,bigint,text,text)',
   'payload:=jsonb_build_object(''operation'',''close'',''shift'',p_shift_id,''counted'',p_counted_cash_vnd,''note'',p_note);',
   'payload:=floor_private.fnb_shift_payload725(club,''close'',p_shift_id,p_counted_cash_vnd,p_note);')
 ) x(signature,anchor,replacement) LOOP
  body:=pg_get_functiondef(signature::regprocedure);
  ASSERT (length(body)-length(replace(body,anchor,'')))/length(anchor)=1,'payload seam drift';
  EXECUTE replace(body,anchor,replacement);
 END LOOP;
END $$;

CREATE FUNCTION public.fnb_open_shift_v2(p_club_id uuid,p_opening_float_vnd bigint,p_client_request_id text,p_expected_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE actor uuid;result jsonb;BEGIN
 actor:=floor_private.fnb_shift_actor725(p_club_id,p_expected_actor);
 PERFORM floor_private.fnb_shift_payload725(p_club_id,'open',NULL,p_opening_float_vnd,NULL);
 PERFORM floor_private.fnb_shift_request_gate725(actor,p_club_id,p_client_request_id);
 result:=floor_private.fnb_open_shift_core725(p_club_id,p_opening_float_vnd,p_client_request_id);
 IF result?'error' THEN RETURN result;END IF;
 RETURN result||jsonb_build_object('actor_id',actor,'club_id',p_club_id,'request_id',p_client_request_id,'operation','open');
END $$;
CREATE FUNCTION public.fnb_close_shift_v2(p_shift_id uuid,p_counted_cash_vnd bigint,p_note text,p_client_request_id text,p_expected_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE actor uuid;club uuid;result jsonb;BEGIN
 SELECT club_id INTO club FROM public.fnb_cashier_shifts WHERE id=p_shift_id;
 actor:=floor_private.fnb_shift_actor725(club,p_expected_actor);
 IF club IS NULL THEN RAISE EXCEPTION 'SHIFT_NOT_FOUND';END IF;
 PERFORM floor_private.fnb_shift_payload725(club,'close',p_shift_id,p_counted_cash_vnd,p_note);
 PERFORM floor_private.fnb_shift_request_gate725(actor,club,p_client_request_id);
 result:=floor_private.fnb_close_shift_core725(p_shift_id,p_counted_cash_vnd,p_note,p_client_request_id);
 IF result?'error' THEN RETURN result;END IF;
 RETURN result||jsonb_build_object('actor_id',actor,'club_id',club,'request_id',p_client_request_id,'operation','close');
END $$;
CREATE FUNCTION public.fnb_get_shift_intent_v1(p_club_id uuid,p_request_id text,p_expected_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
<<read_intent>>
DECLARE actor uuid;receipt floor_private.fnb_shift_intents722%ROWTYPE;club uuid;BEGIN
 actor:=floor_private.fnb_shift_actor725(p_club_id,p_expected_actor);
 IF p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'FNB_SHIFT_INVALID_INPUT';END IF;
 SELECT * INTO receipt FROM floor_private.fnb_shift_intents722 i WHERE i.actor=read_intent.actor AND i.request_id=p_request_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found','actor_id',actor,'club_id',p_club_id,'request_id',p_request_id);END IF;
 IF receipt.payload->>'operation'='open' THEN club:=(receipt.payload->>'club')::uuid;
 ELSE SELECT club_id INTO club FROM public.fnb_cashier_shifts WHERE id=(receipt.payload->>'shift')::uuid;END IF;
 IF club IS DISTINCT FROM p_club_id THEN RAISE EXCEPTION 'REQUEST_ID_CONFLICT';END IF;
 RETURN jsonb_build_object('status','found','actor_id',actor,'club_id',club,'request_id',p_request_id,'intent',receipt.payload,'result',receipt.response);
END $$;
CREATE FUNCTION public.fnb_cancel_shift_intent_v1(p_club_id uuid,p_operation text,p_shift_id uuid,p_amount_vnd bigint,p_note text,p_request_id text,p_expected_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
<<cancel_intent>>
DECLARE actor uuid;payload jsonb;receipt floor_private.fnb_shift_intents722%ROWTYPE;result jsonb;BEGIN
 actor:=floor_private.fnb_shift_actor725(p_club_id,p_expected_actor);
 payload:=floor_private.fnb_shift_payload725(p_club_id,p_operation,p_shift_id,p_amount_vnd,p_note);
 PERFORM floor_private.fnb_shift_request_gate725(actor,p_club_id,p_request_id);
 IF p_operation='close' AND NOT EXISTS(SELECT 1 FROM public.fnb_cashier_shifts WHERE id=p_shift_id AND club_id=p_club_id) THEN RAISE EXCEPTION 'SHIFT_NOT_FOUND';END IF;
 SELECT * INTO receipt FROM floor_private.fnb_shift_intents722 i WHERE i.actor=cancel_intent.actor AND i.request_id=p_request_id;
 IF FOUND THEN
  IF receipt.payload<>payload THEN RAISE EXCEPTION 'REQUEST_ID_CONFLICT';END IF;
  RETURN receipt.response||jsonb_build_object('actor_id',actor,'club_id',p_club_id,'request_id',p_request_id,'operation',p_operation);
 END IF;
 result:=jsonb_build_object('status','cancelled');
 INSERT INTO floor_private.fnb_shift_intents722 VALUES(actor,p_request_id,payload,result);
 RETURN result||jsonb_build_object('actor_id',actor,'club_id',p_club_id,'request_id',p_request_id,'operation',p_operation);
END $$;

-- No browser path may bypass expected-actor admission through the original signatures.
CREATE FUNCTION public.fnb_open_shift(p_club_id uuid,p_opening_float_vnd bigint DEFAULT 0,p_client_request_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'FNB_SHIFT_REQUEST_CONTEXT_REQUIRED';END $$;
CREATE FUNCTION public.fnb_close_shift(p_shift_id uuid,p_counted_cash_vnd bigint,p_note text DEFAULT NULL,p_client_request_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'FNB_SHIFT_REQUEST_CONTEXT_REQUIRED';END $$;
REVOKE ALL ON FUNCTION public.fnb_open_shift(uuid,bigint,text),public.fnb_close_shift(uuid,bigint,text,text),
 public.fnb_open_shift_v2(uuid,bigint,text,uuid),public.fnb_close_shift_v2(uuid,bigint,text,text,uuid),
 public.fnb_get_shift_intent_v1(uuid,text,uuid),public.fnb_cancel_shift_intent_v1(uuid,text,uuid,bigint,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fnb_open_shift(uuid,bigint,text),public.fnb_close_shift(uuid,bigint,text,text),
 public.fnb_open_shift_v2(uuid,bigint,text,uuid),public.fnb_close_shift_v2(uuid,bigint,text,text,uuid),
 public.fnb_get_shift_intent_v1(uuid,text,uuid),public.fnb_cancel_shift_intent_v1(uuid,text,uuid,bigint,text,text,uuid) TO authenticated;
