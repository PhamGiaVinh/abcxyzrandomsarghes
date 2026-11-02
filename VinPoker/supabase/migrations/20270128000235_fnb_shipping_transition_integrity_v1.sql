-- CLI scaffold20261021085133, forward235 reserved after source/native catalog check.
-- Preserve stock/payment rules; reject nonexistent lines and audit only real transitions.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fnb_mark_shipped(uuid,uuid)'::regprocedure)
   IS DISTINCT FROM 'f38043fd146c6180e690a611140b9c30'
 OR to_regclass('floor_private.fnb_shipping_release_backup235') IS NOT NULL THEN
  RAISE EXCEPTION 'fnb235_precondition_drift';END IF;
END $$;
CREATE TABLE floor_private.fnb_shipping_release_backup235(
 id boolean PRIMARY KEY CHECK(id),saved_definition text NOT NULL,old_md5 text NOT NULL,
 owner_name text NOT NULL,saved_acl aclitem[],saved_config text[]
);
ALTER TABLE floor_private.fnb_shipping_release_backup235 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.fnb_shipping_release_backup235 FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO floor_private.fnb_shipping_release_backup235
 SELECT true,pg_get_functiondef(oid),md5(prosrc),pg_get_userbyid(proowner),proacl,proconfig FROM pg_proc
 WHERE oid='public.fnb_mark_shipped(uuid,uuid)'::regprocedure;
CREATE OR REPLACE FUNCTION public.fnb_mark_shipped(p_order_id uuid,p_line_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
 v_uid uuid:=auth.uid();
 v_order public.fnb_orders%ROWTYPE;
 v_all_shipped boolean;
 v_changed integer:=0;
 v_transitioned integer:=0;
BEGIN
 IF v_uid IS NULL THEN RETURN jsonb_build_object('error','Unauthorized');END IF;
 SELECT * INTO v_order FROM public.fnb_orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','ORDER_NOT_FOUND');END IF;
 IF NOT (public.is_club_fnb(v_uid,v_order.club_id) OR public.is_club_owner(v_uid,v_order.club_id)) THEN
  RETURN jsonb_build_object('error','Forbidden');END IF;
 IF v_order.status NOT IN ('paid','shipped') THEN
  RETURN jsonb_build_object('error','BAD_STATE','status',v_order.status);END IF;
 IF p_line_id IS NOT NULL THEN
  -- Keep the established order -> line lock order and fence validation from
  -- a concurrent line removal between the existence check and UPDATE.
  PERFORM id FROM public.fnb_order_items WHERE id=p_line_id AND order_id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','LINE_NOT_FOUND');END IF;
 END IF;
 IF p_line_id IS NOT NULL THEN
  UPDATE public.fnb_order_items SET line_status='shipped',shipped_at=now()
   WHERE id=p_line_id AND order_id=p_order_id AND line_status='paid';
 ELSE
  UPDATE public.fnb_order_items SET line_status='shipped',shipped_at=now()
   WHERE order_id=p_order_id AND line_status='paid';
 END IF;
 GET DIAGNOSTICS v_changed=ROW_COUNT;
 SELECT NOT EXISTS(SELECT 1 FROM public.fnb_order_items WHERE order_id=p_order_id AND line_status<>'shipped') INTO v_all_shipped;
 IF v_all_shipped THEN
  UPDATE public.fnb_orders SET status='shipped',shipped_at=now(),updated_at=now()
   WHERE id=p_order_id AND status='paid';
  GET DIAGNOSTICS v_transitioned=ROW_COUNT;
  IF v_transitioned>0 THEN
   INSERT INTO public.fnb_order_events(order_id,club_id,action,old_status,new_status,actor)
    VALUES(p_order_id,v_order.club_id,'shipped','paid','shipped',v_uid);
  END IF;
 ELSIF v_changed>0 THEN
  INSERT INTO public.fnb_order_events(order_id,club_id,action,old_status,new_status,actor,metadata)
   VALUES(p_order_id,v_order.club_id,'line_shipped',v_order.status,v_order.status,v_uid,jsonb_build_object('line_id',p_line_id));
 END IF;
 RETURN jsonb_build_object('status','ok','order_id',p_order_id,'all_shipped',v_all_shipped,'idempotent',v_changed=0 AND v_transitioned=0);
END;
$function$;
DO $$ BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.fnb_mark_shipped(uuid,uuid)'::regprocedure)
   IS DISTINCT FROM '31b85897c490845913ab864bdfd5320c'
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN floor_private.fnb_shipping_release_backup235 b
  WHERE p.oid='public.fnb_mark_shipped(uuid,uuid)'::regprocedure
  AND (p.proacl IS DISTINCT FROM b.saved_acl OR pg_get_userbyid(p.proowner) IS DISTINCT FROM b.owner_name OR p.proconfig IS DISTINCT FROM b.saved_config)) THEN
  RAISE EXCEPTION 'fnb235_acl_owner_config_changed';END IF;
END $$;
COMMIT;
