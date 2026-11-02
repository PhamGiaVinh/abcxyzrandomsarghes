-- CLI generated20261025071349; reserved291 after source290/native catalog.
-- Forward-only LOCAL candidate. Does not change installed290 or saved receipts.
-- Recovery: suspend new v2 writer/cancel EXECUTE; retain receipt getter/audit.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF to_regprocedure('public.save_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid)') IS NOT NULL
  OR to_regprocedure('public.cancel_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid)') IS NOT NULL
  OR to_regprocedure('public.get_table_dealer_profile_receipt_v2(uuid,uuid,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'dealer_profile291_catalog_collision'; END IF;
 IF md5(pg_get_functiondef('public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid)'::regprocedure))<>'1447eca27159c475ff37a3480d836cb7'
  OR md5(pg_get_functiondef('public.get_table_dealer_profile_receipt_v1(uuid,uuid)'::regprocedure))<>'8d885cd171abd29a8df9886b80175a6e' THEN
  RAISE EXCEPTION 'dealer_profile291_dependency_drift'; END IF;
END $$;

CREATE FUNCTION public.save_table_dealer_profile_v2(p_club_id uuid,p_table_id uuid,p_table_mode text,
 p_is_final boolean,p_allow_override boolean,p_members jsonb,p_request_id uuid,p_expected_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$ DECLARE actor uuid:=auth.uid(); BEGIN
 IF actor IS NULL OR p_expected_actor IS DISTINCT FROM actor OR auth.role() IS DISTINCT FROM 'authenticated' THEN
  RAISE EXCEPTION 'DEALER_PROFILE_ACTOR_CHANGED' USING ERRCODE='42501'; END IF;
 RETURN public.save_table_dealer_profile_v1(p_club_id,p_table_id,p_table_mode,p_is_final,p_allow_override,p_members,p_request_id)
  ||jsonb_build_object('actor_id',actor);
END $$;

CREATE FUNCTION public.get_table_dealer_profile_receipt_v2(p_club_id uuid,p_request_id uuid,p_expected_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$ DECLARE actor uuid:=auth.uid(); r jsonb; BEGIN
 IF actor IS NULL OR p_expected_actor IS DISTINCT FROM actor OR auth.role() IS DISTINCT FROM 'authenticated' THEN
  RAISE EXCEPTION 'DEALER_PROFILE_ACTOR_CHANGED' USING ERRCODE='42501'; END IF;
 r:=public.get_table_dealer_profile_receipt_v1(p_club_id,p_request_id);
 IF r->>'status'='receipt_found' THEN r:=jsonb_set(r,'{result}',(r->'result')||jsonb_build_object('actor_id',actor)); END IF;
 RETURN r||jsonb_build_object('actor_id',actor);
END $$;

CREATE FUNCTION public.cancel_table_dealer_profile_v2(p_club_id uuid,p_table_id uuid,p_table_mode text,
 p_is_final boolean,p_allow_override boolean,p_members jsonb,p_request_id uuid,p_expected_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$ DECLARE actor uuid:=auth.uid();club uuid;payload jsonb;r record;result jsonb; BEGIN
 IF actor IS NULL OR p_expected_actor IS DISTINCT FROM actor OR auth.role() IS DISTINCT FROM 'authenticated' THEN
  RAISE EXCEPTION 'DEALER_PROFILE_ACTOR_CHANGED' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_club_id IS NULL OR p_table_id IS NULL OR p_table_mode IS NULL
  OR p_table_mode NOT IN('normal','feature') OR p_is_final IS NULL OR p_allow_override IS NULL
  OR p_members IS NULL OR jsonb_typeof(p_members)<>'array' THEN
  RAISE EXCEPTION 'DEALER_PROFILE_INVALID_PAYLOAD' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.clubs c WHERE c.id=p_club_id FOR SHARE;
 PERFORM 1 FROM public.club_dealer_controls c WHERE c.club_id=p_club_id AND c.user_id=actor FOR SHARE;
 PERFORM 1 FROM public.user_roles role_row WHERE role_row.user_id=actor AND role_row.role='super_admin'::public.app_role FOR SHARE;
 IF NOT public._dealer_feature_can_manage(actor,p_club_id) THEN
  RAISE EXCEPTION 'DEALER_PROFILE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 payload:=jsonb_build_object('club_id',p_club_id,'table_id',p_table_id,'table_mode',p_table_mode,
  'is_final',p_is_final,'allow_override',p_allow_override,'members',p_members);
 -- Identical lock to290: cancel and a delayed save cannot both win.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dealer-profile:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO r FROM private.dealer_feature_config_receipts_v1 x WHERE x.actor_id=actor AND x.request_id=p_request_id;
 IF FOUND THEN
  IF r.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'DEALER_PROFILE_REQUEST_CONFLICT' USING ERRCODE='23505'; END IF;
  -- Already saved is NOT an undo; return its immutable actual outcome.
  RETURN r.result||jsonb_build_object('actor_id',actor);
 END IF;
 SELECT g.club_id INTO club FROM public.game_tables g WHERE g.id=p_table_id FOR SHARE;
 IF club IS DISTINCT FROM p_club_id THEN RAISE EXCEPTION 'DEALER_PROFILE_TABLE_SCOPE_MISMATCH' USING ERRCODE='42501'; END IF;
 -- Cancellation deliberately does not require a still-valid dealer pool. A
 -- rejected/stale draft must be cancellable without ever applying that draft.
 result:=jsonb_build_object('status','cancelled','request_id',p_request_id,'club_id',club,'table_id',p_table_id,
  'profile',payload-'club_id'-'table_id');
 INSERT INTO private.dealer_feature_config_receipts_v1(actor_id,request_id,club_id,table_id,payload,result)
 VALUES(actor,p_request_id,club,p_table_id,payload,result);
 INSERT INTO public.audit_logs(club_id,actor_id,action,entity_type,entity_id,payload)
 VALUES(club,actor,'cancel_table_dealer_profile','dealer_table_profile',p_table_id,jsonb_build_object('request_id',p_request_id));
 RETURN result||jsonb_build_object('actor_id',actor);
END $$;

REVOKE ALL ON FUNCTION public.save_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cancel_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_table_dealer_profile_receipt_v2(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_table_dealer_profile_receipt_v2(uuid,uuid,uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE EXECUTE ON FUNCTION public.get_table_dealer_profile_receipt_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
