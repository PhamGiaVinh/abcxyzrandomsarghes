-- CLI candidate20261018174212 -> forward slot163. LOCAL candidate, NOT LIVE.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regprocedure('public.request_staking_release_v1(uuid,uuid,bigint,bigint,text)') IS NOT NULL
 OR to_regprocedure('public._staking_release_preview_v1(uuid,uuid)') IS NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000163')
 THEN RAISE EXCEPTION 'staking163_catalog_collision';END IF;
END $$;
CREATE FUNCTION public.request_staking_release_v1(p_actor uuid,p_deal uuid,p_backer bigint,p_player bigint,p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.staking_deals%ROWTYPE; r public.staking_release_requests%ROWTYPE;
 preview jsonb; intent jsonb; old_intent jsonb; note_value text:=nullif(btrim(p_note),''); existing_request boolean;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_required' USING ERRCODE='42501';END IF;
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role IN('super_admin','cashier'))
 THEN RAISE EXCEPTION 'staking_request_forbidden' USING ERRCODE='42501';END IF;
 IF p_backer IS NULL OR p_player IS NULL OR least(p_backer,p_player)<0 OR greatest(p_backer,p_player)>10000000000
 OR length(coalesce(note_value,''))>1000 THEN RAISE EXCEPTION 'staking_request_invalid_payload';END IF;
 -- Existing requests follow commit_v2's request -> deal -> purchases lock order.
 SELECT * INTO r FROM public.staking_release_requests WHERE deal_id=p_deal FOR UPDATE;
 existing_request:=FOUND;
 SELECT * INTO d FROM public.staking_deals WHERE id=p_deal FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_request_deal_not_found';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='super_admin')
 AND (d.club_id IS NULL OR NOT public.is_club_cashier(p_actor,d.club_id))
 THEN RAISE EXCEPTION 'staking_request_club_denied' USING ERRCODE='42501';END IF;
 -- A creator may have committed while this caller waited for the deal lock.
 -- Never invert the existing request/deal lock order to adopt that row.
 IF NOT existing_request AND EXISTS(SELECT 1 FROM public.staking_release_requests WHERE deal_id=p_deal)
 THEN RAISE EXCEPTION 'staking_request_retry_snapshot' USING ERRCODE='40001';END IF;
 PERFORM id FROM public.staking_purchases WHERE deal_id=p_deal ORDER BY id FOR UPDATE;
 preview:=public._staking_release_preview_v1(p_actor,p_deal);
 IF (preview->>'backer_amount')::bigint IS DISTINCT FROM p_backer OR (preview->>'player_amount')::bigint IS DISTINCT FROM p_player
 THEN RAISE EXCEPTION 'staking_request_amount_mismatch';END IF;
 intent:=jsonb_build_object('actor',p_actor,'deal',p_deal,'backer',p_backer,'player',p_player,'note',note_value);
 IF existing_request THEN
   IF NOT ((r.status='pending_cosign' AND d.status='release_requested') OR (r.status='approved' AND d.status='cosigned'))
   THEN RAISE EXCEPTION 'staking_request_state_mismatch';END IF;
   SELECT metadata->'request_intent' INTO old_intent FROM public.staking_audit_logs
     WHERE deal_id=p_deal AND action='release_requested' AND metadata->>'release_request_id'=r.id::text
     AND metadata ? 'request_intent';
   IF old_intent IS NULL THEN RAISE EXCEPTION 'staking_request_legacy_review_required';END IF;
   IF old_intent IS DISTINCT FROM intent OR r.requested_by_admin_id IS DISTINCT FROM p_actor OR r.note IS DISTINCT FROM note_value
   THEN RAISE EXCEPTION 'staking_request_payload_conflict';END IF;
   RETURN jsonb_build_object('success',true,'release_request_id',r.id,'deal_id',d.id,'status',d.status,'existing',true);
 END IF;
 IF d.status<>'result_verified' THEN RAISE EXCEPTION 'staking_request_state_mismatch';END IF;
 INSERT INTO public.staking_release_requests(deal_id,requested_by_admin_id,status,note)
 VALUES(p_deal,p_actor,'pending_cosign',note_value) RETURNING * INTO r;
 UPDATE public.staking_deals SET status='release_requested' WHERE id=p_deal;
 INSERT INTO public.staking_audit_logs(deal_id,action,performed_by,old_status,new_status,metadata)
 VALUES(p_deal,'release_requested',p_actor,'result_verified','release_requested',
   jsonb_build_object('release_request_id',r.id,'backer_amount',p_backer,'player_amount',p_player,'request_intent',intent));
 RETURN jsonb_build_object('success',true,'release_request_id',r.id,'deal_id',d.id,'status','release_requested','existing',false);
END $$;
REVOKE ALL ON FUNCTION public.request_staking_release_v1(uuid,uuid,bigint,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.request_staking_release_v1(uuid,uuid,bigint,bigint,text) TO service_role;
COMMIT;
