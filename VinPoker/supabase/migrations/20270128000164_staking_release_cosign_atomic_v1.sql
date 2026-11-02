-- CLI candidate20261018174621 ->164. LOCAL only, not a live migration receipt.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regprocedure('public.cosign_staking_release_v1(uuid,uuid,text)') IS NOT NULL
 OR to_regprocedure('public.request_staking_release_v1(uuid,uuid,bigint,bigint,text)') IS NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000164')
 THEN RAISE EXCEPTION 'staking164_catalog_collision';END IF;
END $$;
CREATE FUNCTION public.cosign_staking_release_v1(p_actor uuid,p_request uuid,p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.staking_release_requests%ROWTYPE; d public.staking_deals%ROWTYPE;
 is_super boolean; is_cashier boolean; intent jsonb; old_intent jsonb; note_value text:=nullif(btrim(p_note),'');
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_required' USING ERRCODE='42501';END IF;
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='super_admin'),
   EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='cashier') INTO is_super,is_cashier;
 IF p_actor IS NULL OR NOT (is_super OR is_cashier) THEN RAISE EXCEPTION 'staking_cosign_forbidden' USING ERRCODE='42501';END IF;
 IF length(coalesce(note_value,''))>1000 THEN RAISE EXCEPTION 'staking_cosign_invalid_note';END IF;
 SELECT * INTO r FROM public.staking_release_requests WHERE id=p_request FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_cosign_not_found';END IF;
 SELECT * INTO d FROM public.staking_deals WHERE id=r.deal_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_cosign_deal_not_found';END IF;
 IF NOT is_super AND (d.club_id IS NULL OR NOT public.is_club_cashier(p_actor,d.club_id))
 THEN RAISE EXCEPTION 'staking_cosign_club_denied' USING ERRCODE='42501';END IF;
 intent:=jsonb_build_object('actor',p_actor,'request',p_request,'note',note_value);
 IF r.status='approved' THEN
   IF d.status<>'cosigned' THEN RAISE EXCEPTION 'staking_cosign_state_mismatch';END IF;
   SELECT metadata->'cosign_intent' INTO old_intent FROM public.staking_audit_logs
     WHERE deal_id=d.id AND action='release_cosigned' AND metadata->>'release_request_id'=r.id::text
     AND metadata ? 'cosign_intent';
   IF old_intent IS NULL THEN RAISE EXCEPTION 'staking_cosign_legacy_review_required';END IF;
   IF old_intent IS DISTINCT FROM intent OR r.cosigned_by_admin_id IS DISTINCT FROM p_actor
   THEN RAISE EXCEPTION 'staking_cosign_payload_conflict';END IF;
   RETURN jsonb_build_object('success',true,'release_request_id',r.id,'deal_id',d.id,'status','cosigned','existing',true);
 END IF;
 IF r.status<>'pending_cosign' OR d.status<>'release_requested' OR r.cosigned_by_admin_id IS NOT NULL
 THEN RAISE EXCEPTION 'staking_cosign_state_mismatch';END IF;
 -- Preserve established cashier one-step policy; admin-only requester needs another admin.
 IF NOT is_cashier AND r.requested_by_admin_id=p_actor THEN RAISE EXCEPTION 'staking_cosign_distinct_admin_required' USING ERRCODE='42501';END IF;
 -- Canonical verified snapshot must still exist; no new amount formula.
 PERFORM id FROM public.staking_purchases WHERE deal_id=d.id ORDER BY id FOR UPDATE;
 PERFORM public._staking_release_preview_v1(p_actor,d.id);
 UPDATE public.staking_release_requests SET cosigned_by_admin_id=p_actor,status='approved',cosigned_at=now()
   WHERE id=r.id RETURNING * INTO r;
 IF r.status<>'approved' OR r.cosigned_by_admin_id IS DISTINCT FROM p_actor OR r.cosigned_at IS NULL
 THEN RAISE EXCEPTION 'staking_cosign_transition_unverified';END IF;
 UPDATE public.staking_deals SET status='cosigned' WHERE id=d.id;
 -- Keep requester's note intact; cosigner note is an immutable audit intent.
 INSERT INTO public.staking_audit_logs(deal_id,action,performed_by,old_status,new_status,metadata)
 VALUES(d.id,'release_cosigned',p_actor,'release_requested','cosigned',
   jsonb_build_object('release_request_id',r.id,'requested_by',r.requested_by_admin_id,'cosign_intent',intent));
 RETURN jsonb_build_object('success',true,'release_request_id',r.id,'deal_id',d.id,'status','cosigned','existing',false);
END $$;
REVOKE ALL ON FUNCTION public.cosign_staking_release_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cosign_staking_release_v1(uuid,uuid,text) TO service_role;
COMMIT;
