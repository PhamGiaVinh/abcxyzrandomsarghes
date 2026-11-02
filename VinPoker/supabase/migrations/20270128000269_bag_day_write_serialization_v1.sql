-- Shared legacy tournament/day lock covers an absent day row without creating metadata.
-- Public callers authenticate/authorize before reaching this private primitive.
CREATE FUNCTION floor_private.lock_chip_bag_day_v1(p_tournament_id uuid,p_day_number integer)
RETURNS void LANGUAGE sql VOLATILE STRICT SECURITY INVOKER SET search_path=''
AS $$ SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chip-bag-day-v1:'||p_tournament_id::text||':'||p_day_number::text,0)); $$;
REVOKE ALL ON FUNCTION floor_private.lock_chip_bag_day_v1(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;

-- Exact reviewed-body amendments preserve signatures, ACLs, audit, receipts and error policy.
-- Any different source definition requires explicit reconciliation, never silent replacement.
DO $$
DECLARE v record;v_def text;v_marker text;v_call text;v_row_guard text;
BEGIN
 FOR v IN SELECT * FROM (VALUES
  ('public.chip_ops_record_bag(uuid,integer,uuid,text,bigint,boolean)','179b2b4ecc0ebc3989c2109c896c509d','record'),
  ('public.chip_ops_unseal_bag(uuid)','93759a9a2cc54a1a3dee43f23d741c32','unseal'),
  ('public.chip_ops_close_day(uuid,integer,integer,boolean,text)','4131e2e4d74d407bb403634e508a4b92','close'),
  ('public.chip_ops_reopen_day(uuid,integer,integer)','c998894faa4999fff756a3afcb495c6b','reopen')
 ) x(signature,expected_digest,kind) LOOP
  v_def:=replace(pg_get_functiondef(to_regprocedure(v.signature)),chr(13),'');
  IF md5(v_def)<>v.expected_digest THEN RAISE EXCEPTION 'bag_day_writer_definition_drift: %',v.signature;END IF;
  v_call:='  PERFORM floor_private.lock_chip_bag_day_v1(p_tournament_id,p_day_number);';
  IF v.kind='record' THEN
   v_marker:='  SELECT (status = ''locked'') INTO v_locked FROM public.day_close';
   v_row_guard:='  WHERE tournament_id = p_tournament_id AND day_number = p_day_number;';
  ELSIF v.kind='unseal' THEN
   v_marker:='  SELECT id, (status=''locked'') INTO v_dayid, v_locked FROM public.day_close';
   v_call:='  PERFORM floor_private.lock_chip_bag_day_v1(v_tid,v_day);';
   v_row_guard:='  WHERE tournament_id = v_tid AND day_number = v_day;';
  ELSE
   v_marker:='  SELECT id, status, version INTO v_dayid, v_status, v_ver FROM public.day_close';
   v_row_guard:=NULL;
  END IF;
  IF cardinality(string_to_array(v_def,v_marker))<>2 THEN RAISE EXCEPTION 'bag_day_lock_anchor_drift: %',v.signature;END IF;
  v_def:=replace(v_def,v_marker,v_call||E'\n'||v_marker);
  IF v_row_guard IS NOT NULL THEN
   IF cardinality(string_to_array(v_def,v_row_guard))<>2 THEN RAISE EXCEPTION 'bag_day_row_anchor_drift: %',v.signature;END IF;
   v_def:=replace(v_def,v_row_guard,left(v_row_guard,length(v_row_guard)-1)||' FOR UPDATE;');
  END IF;
  EXECUTE v_def;
 END LOOP;
END;
$$;
-- Existing canonical multi-day writers already lock existing day rows before bags.
-- Flight-end/legacy pre-bagging interleavings and direct DML require separate qualification.
