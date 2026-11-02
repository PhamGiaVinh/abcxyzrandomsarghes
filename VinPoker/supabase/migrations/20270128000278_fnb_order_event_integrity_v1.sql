-- CLI generated20261024172859; forward278 reserved after277 after catalog check.
-- Order-event integrity only, NOT activation of absent cashier-shift functionality.
-- Exact reviewed predecessor bodies required; do not bypass drift checks/replay archive.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres' OR to_regprocedure('floor_private.fnb_cash_event_gate_v1(uuid)') IS NOT NULL
  OR (SELECT atttypid FROM pg_attribute WHERE attrelid='public.fnb_order_events'::regclass AND attname='old_status')
    IS DISTINCT FROM 'public.fnb_order_status'::regtype::oid THEN
  RAISE EXCEPTION 'fnb278_catalog_precondition_failed';
 END IF;
END $$;
CREATE FUNCTION floor_private.fnb_cash_event_gate_v1(p_club_id uuid)
RETURNS void LANGUAGE sql STRICT SECURITY INVOKER SET search_path='' AS $$
 SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fnb-cash-shift:'||p_club_id::text,718));
$$;
REVOKE ALL ON FUNCTION floor_private.fnb_cash_event_gate_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE item record;before_proc record;after_proc record;body text;anchor text;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public.fnb_mark_paid(uuid,text)','c8d1b825e471fab2038c0552532dbc15','paid_at = now()','paid_at = clock_timestamp()'),
  ('public.fnb_cancel_order(uuid,text)','7a40b0d5f0103b4dbcf7848079aca94b','cancelled_at = now()','cancelled_at = clock_timestamp()'),
  ('public.fnb_settle_bank_paid(uuid,uuid)','779c15e9a2763eb2c8b7b0c0aaea7206','paid_at = now()','paid_at = clock_timestamp()')
 ) v(signature,expected_hash,time_anchor,time_replacement) LOOP
  SELECT * INTO STRICT before_proc FROM pg_proc WHERE oid=item.signature::regprocedure;
  body:=pg_get_functiondef(before_proc.oid);
  IF md5(body)<>item.expected_hash OR NOT before_proc.prosecdef THEN
   RAISE EXCEPTION 'fnb278_writer_drift: %',item.signature;
  END IF;
  anchor:='SELECT * INTO v_order FROM public.fnb_orders WHERE id = p_order_id FOR UPDATE;';
  IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1
   OR (length(body)-length(replace(body,item.time_anchor,'')))/length(item.time_anchor)<>1 THEN
   RAISE EXCEPTION 'fnb278_writer_seam_drift: %',item.signature;
  END IF;
  body:=replace(body,anchor,'PERFORM floor_private.fnb_cash_event_gate_v1((SELECT o.club_id FROM public.fnb_orders o WHERE o.id=p_order_id));'||chr(10)||'  '||anchor);
  body:=replace(body,item.time_anchor,item.time_replacement);
  IF item.signature='public.fnb_settle_bank_paid(uuid,uuid)' THEN
   anchor:='v_old       text;';
   IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'fnb278_bank_enum_seam_drift';END IF;
   body:=replace(body,anchor,'v_old       public.fnb_order_status;');
  END IF;
  EXECUTE body;
  SELECT * INTO STRICT after_proc FROM pg_proc WHERE oid=before_proc.oid;
  IF after_proc.proowner<>before_proc.proowner OR after_proc.proacl IS DISTINCT FROM before_proc.proacl
   OR after_proc.proconfig IS DISTINCT FROM before_proc.proconfig OR after_proc.prosecdef IS DISTINCT FROM before_proc.prosecdef THEN
   RAISE EXCEPTION 'fnb278_writer_authority_changed: %',item.signature;
  END IF;
 END LOOP;
 IF has_function_privilege('anon','floor_private.fnb_cash_event_gate_v1(uuid)','EXECUTE')
  OR has_function_privilege('authenticated','floor_private.fnb_cash_event_gate_v1(uuid)','EXECUTE')
  OR has_function_privilege('service_role','floor_private.fnb_cash_event_gate_v1(uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'fnb278_internal_gate_exposed';
 END IF;
END $$;
COMMIT;
