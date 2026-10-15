-- CLI-created forward candidate. Not approved/applied to production.
-- Retire direct browser position writes; retain existing non-position updates.
-- Recovery is a reviewed forward change, never deletion of audit/receipts.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE FUNCTION public.reorder_club_series_images_v1(
 p_club_id uuid,p_expected jsonb,p_order uuid[],p_request_id uuid,p_expected_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s'
AS $function$
DECLARE actor uuid:=auth.uid(); fingerprint text; receipt record; snapshot jsonb;
 expected jsonb; expected_ids uuid[]; actual_ids uuid[]; result jsonb; changed integer;
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_actor_id THEN
  RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');
 END IF;
 PERFORM 1 FROM public.clubs c WHERE c.id=p_club_id AND
   (c.owner_id=actor OR public.has_role(actor,'super_admin'::public.app_role)) FOR SHARE;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');
 END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_expected) IS DISTINCT FROM 'array'
  OR p_order IS NULL OR array_ndims(p_order) IS DISTINCT FROM 1
  OR array_position(p_order,NULL) IS NOT NULL THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_reorder');
 END IF;
 SELECT jsonb_agg(jsonb_build_object('id',x.id,'position',x.position) ORDER BY x.id),
   array_agg(x.id ORDER BY x.id) INTO expected,expected_ids
 FROM jsonb_to_recordset(p_expected) AS x(id uuid,position integer);
 IF expected IS NULL OR EXISTS(SELECT 1 FROM jsonb_to_recordset(expected) AS x(id uuid,position integer)
  WHERE x.id IS NULL OR x.position IS NULL)
  OR cardinality(expected_ids)<>(SELECT count(DISTINCT x) FROM unnest(expected_ids) x)
  OR cardinality(p_order)<>cardinality(expected_ids)
  OR (SELECT array_agg(x ORDER BY x) FROM unnest(p_order) x) IS DISTINCT FROM expected_ids THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_reorder');
 END IF;
 fingerprint:=jsonb_build_object('club_id',p_club_id,'expected',expected,'order',p_order)::text;
 PERFORM floor_private.floor_table_v3_lock_receipt(actor,'reorder_club_series_images_v1',p_request_id);
 SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,'reorder_club_series_images_v1',p_request_id);
 IF FOUND THEN
  IF receipt.request_fingerprint IS DISTINCT FROM fingerprint THEN
   RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
  END IF;
  RETURN receipt.result;
 END IF;
 -- Gallery is a small admin publication table. This bounded, short lock also
 -- serializes legacy INSERT/DELETE; row locks alone cannot fence new images.
 LOCK TABLE public.club_series_images IN SHARE ROW EXCLUSIVE MODE;
 SELECT jsonb_agg(jsonb_build_object('id',id,'position',position) ORDER BY id),array_agg(id ORDER BY id)
 INTO snapshot,actual_ids FROM public.club_series_images WHERE club_id=p_club_id;
 IF snapshot IS DISTINCT FROM expected OR actual_ids IS DISTINCT FROM expected_ids THEN
  RETURN jsonb_build_object('ok',false,'error','reorder_conflict');
 END IF;
 UPDATE public.club_series_images i SET position=o.ordinality::integer-1
 FROM unnest(p_order) WITH ORDINALITY o(id,ordinality)
 WHERE i.club_id=p_club_id AND i.id=o.id;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>cardinality(p_order) THEN RAISE EXCEPTION 'series_reorder_count_changed'; END IF;
 result:=jsonb_build_object('ok',true,'actor_id',actor,'club_id',p_club_id,'request_id',p_request_id,'order',p_order);
 PERFORM floor_private.floor_table_v3_save_receipt(actor,'reorder_club_series_images_v1',p_request_id,fingerprint,result);
 RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.reorder_club_series_images_v1(uuid,jsonb,uuid[],uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.reorder_club_series_images_v1(uuid,jsonb,uuid[],uuid,uuid) TO authenticated;

CREATE FUNCTION public.get_club_series_reorder_receipt_v1(
 p_club_id uuid,p_expected jsonb,p_order uuid[],p_request_id uuid,p_expected_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE actor uuid:=auth.uid(); receipt record; expected jsonb; fingerprint text;
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_actor_id OR NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=p_club_id AND
  (c.owner_id=actor OR public.has_role(actor,'super_admin'::public.app_role))) THEN
  RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');
 END IF;
 SELECT jsonb_agg(jsonb_build_object('id',x.id,'position',x.position) ORDER BY x.id)
 INTO expected FROM jsonb_to_recordset(p_expected) AS x(id uuid,position integer);
 fingerprint:=jsonb_build_object('club_id',p_club_id,'expected',expected,'order',p_order)::text;
 SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,'reorder_club_series_images_v1',p_request_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','receipt_not_found'); END IF;
 IF receipt.request_fingerprint IS DISTINCT FROM fingerprint THEN
  RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
 END IF;
 RETURN receipt.result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_club_series_reorder_receipt_v1(uuid,jsonb,uuid[],uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_club_series_reorder_receipt_v1(uuid,jsonb,uuid[],uuid,uuid) TO authenticated;

-- RLS alone cannot distinguish the old multi-request position writer. Column
-- privileges force browser reorder through the atomic, actor-checked seam.
REVOKE UPDATE ON public.club_series_images FROM authenticated;
REVOKE UPDATE(position) ON public.club_series_images FROM authenticated;
GRANT UPDATE(id,club_id,image_url,caption,created_at) ON public.club_series_images TO authenticated;
DO $privilege_check$ BEGIN
 IF has_column_privilege('authenticated','public.club_series_images','position','UPDATE') THEN
  RAISE EXCEPTION 'series_position_write_privilege_drift';
 END IF;
END $privilege_check$;
COMMIT;
