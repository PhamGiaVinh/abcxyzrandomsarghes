BEGIN;
-- CLI-created20261024190030, reserved forward281 after filename/local ledger collision checks.
-- Keep the existing soft-reporting-link policy. Recover an already committed, actor/payload-bound
-- intent before applying current-seat validation to a genuinely new order.
DO $migration$
DECLARE definition text; link_guard text; marker text; first_pos int; end_pos int;
BEGIN
 SELECT pg_get_functiondef('public.fnb_create_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,uuid,uuid)'::regprocedure) INTO definition;
 IF md5(definition)<>'60212b28a72941f81499d72d1aaa92f3' THEN
  RAISE EXCEPTION 'FNB_CREATE_RECOVERY_PREDECESSOR_DRIFT';
 END IF;
 first_pos:=strpos(definition,'  -- (A2) validate the OPTIONAL soft refs');
 end_pos:=strpos(definition,'  v_crid :=');
 marker:='  -- (3) idempotency: insert the order;';
 IF first_pos=0 OR end_pos<=first_pos OR strpos(definition,marker)=0 THEN
  RAISE EXCEPTION 'FNB_CREATE_RECOVERY_SOURCE_SEAM_DRIFT';
 END IF;
 link_guard:=substr(definition,first_pos,end_pos-first_pos);
 definition:=replace(definition,link_guard,'');
 definition:=replace(definition,marker,$new$
  -- Binding waits on a per-club/key lock. Revalidate authority after that wait; an exception
  -- rolls back a newly inserted intent as well as preventing an unauthorized order.
  IF NOT (public.is_club_fnb(v_uid,p_club_id) OR public.is_club_owner(v_uid,p_club_id))
     OR (p_source='counter' AND NOT (public.is_club_fnb_kind(v_uid,p_club_id,'cashier') OR public.is_club_owner(v_uid,p_club_id))) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT id INTO v_order_id FROM public.fnb_orders WHERE club_id=p_club_id AND client_request_id=v_crid;
  IF FOUND THEN
    RETURN jsonb_build_object('status','ok','order_id',v_order_id,'idempotent',true);
  END IF;
$new$||link_guard||marker);
 EXECUTE definition;
END $migration$;
COMMIT;
