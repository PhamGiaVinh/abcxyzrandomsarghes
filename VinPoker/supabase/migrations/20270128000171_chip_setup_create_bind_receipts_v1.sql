-- CLI-created candidate -> next unused local campaign version171. NOT LIVE.
-- Additive composite for the existing unbound-tour "create & bind" intent.
-- Recovery: suspend the three public endpoints; preserve immutable receipts.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $preflight$
BEGIN
 IF current_user<>'postgres'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.chip_ops_create_chip_set(uuid,text,text)')) IS DISTINCT FROM '540bd5c2da18ef250babdd300d113a02'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.chip_ops_bind_tournament_chip_set(uuid,uuid)')) IS DISTINCT FROM '2af8685a6bb091952f32e5fc92969e0b'
 OR to_regnamespace('private') IS NULL
 OR to_regclass('private.chip_setup_create_bind_receipts_v1') IS NOT NULL
 OR to_regprocedure('private.chip_setup_intent_context_v1(uuid,text,uuid,uuid)') IS NOT NULL
 OR to_regprocedure('private.apply_chip_setup_intent_v1(uuid,text,uuid,uuid,boolean)') IS NOT NULL
 OR to_regprocedure('public.chip_ops_create_and_bind_set_v1(uuid,text,uuid,uuid)') IS NOT NULL
 OR to_regprocedure('public.get_chip_setup_create_bind_receipt_v1(uuid,text,uuid,uuid)') IS NOT NULL
 OR to_regprocedure('public.cancel_chip_setup_create_bind_v1(uuid,text,uuid,uuid)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000171')
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.tournament_chip_set'::regclass AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (tournament_id)') THEN
   RAISE EXCEPTION 'chip_setup171_catalog_drift_or_collision';
 END IF;
END $preflight$;

CREATE TABLE private.chip_setup_create_bind_receipts_v1(
 actor_id uuid NOT NULL,request_id uuid NOT NULL,tournament_id uuid NOT NULL,club_id uuid NOT NULL,
 payload_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE private.chip_setup_create_bind_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.chip_setup_create_bind_receipts_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.chip_setup_intent_context_v1(p_tournament_id uuid,p_name text,p_request_id uuid,p_expected_actor uuid)
RETURNS TABLE(actor_id uuid,club_id uuid,payload_hash text,canonical_name text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $function$
BEGIN
 actor_id:=auth.uid();
 IF actor_id IS NULL OR actor_id IS DISTINCT FROM p_expected_actor THEN RAISE EXCEPTION 'chip_setup_actor_required' USING ERRCODE='42501';END IF;
 IF p_request_id IS NULL OR p_name IS NULL OR btrim(p_name)='' THEN RAISE EXCEPTION 'chip_setup_invalid_intent' USING ERRCODE='22023';END IF;
 SELECT t.club_id INTO club_id FROM public.tournaments t WHERE t.id=p_tournament_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND' USING ERRCODE='22023';END IF;
 IF NOT (coalesce(public.is_club_owner(actor_id,club_id),false) OR coalesce(public.is_club_chip_master(actor_id,club_id),false)) THEN
   RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';END IF;
 canonical_name:=btrim(p_name);
 payload_hash:=encode(extensions.digest(convert_to(jsonb_build_object('operation','chip-create-bind-v1',
   'club',club_id,'tournament',p_tournament_id,'name',canonical_name)::text,'UTF8'),'sha256'),'hex');
 RETURN NEXT;
END $function$;

CREATE FUNCTION private.apply_chip_setup_intent_v1(p_tournament_id uuid,p_name text,p_request_id uuid,p_expected_actor uuid,p_cancel boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $function$
DECLARE ctx record;prior private.chip_setup_create_bind_receipts_v1%ROWTYPE;answer jsonb;
 locked_club uuid;deleted timestamptz;created jsonb;set_id uuid;inserted uuid;failure text;
BEGIN
 SELECT * INTO ctx FROM private.chip_setup_intent_context_v1(p_tournament_id,p_name,p_request_id,p_expected_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('chip-setup-create-bind:'||ctx.actor_id||':'||p_request_id,0));
 -- Authority may have changed while waiting for the request lock.
 SELECT * INTO ctx FROM private.chip_setup_intent_context_v1(p_tournament_id,p_name,p_request_id,p_expected_actor);
 SELECT * INTO prior FROM private.chip_setup_create_bind_receipts_v1 r WHERE r.actor_id=ctx.actor_id AND r.request_id=p_request_id;
 IF FOUND THEN
   IF prior.payload_hash IS DISTINCT FROM ctx.payload_hash OR prior.tournament_id IS DISTINCT FROM p_tournament_id OR prior.club_id IS DISTINCT FROM ctx.club_id THEN
     RAISE EXCEPTION 'chip_setup_request_payload_conflict' USING ERRCODE='22023';END IF;
   RETURN prior.response;
 END IF;
 IF NOT p_cancel THEN
   -- Receipt lock -> tournament lock -> create primitive -> insert-only binding.
   -- Never rebound a set another operator assigned after the UI's unbound read.
   SELECT t.club_id,t.deleted_at INTO locked_club,deleted FROM public.tournaments t WHERE t.id=p_tournament_id FOR UPDATE;
   IF NOT FOUND OR deleted IS NOT NULL THEN failure:='TOURNAMENT_NOT_FOUND';
   ELSIF locked_club IS DISTINCT FROM ctx.club_id THEN RAISE EXCEPTION 'chip_setup_scope_changed' USING ERRCODE='40001';
   ELSE
     IF NOT (coalesce(public.is_club_owner(ctx.actor_id,ctx.club_id),false) OR coalesce(public.is_club_chip_master(ctx.actor_id,ctx.club_id),false)) THEN
       RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';END IF;
     IF EXISTS(SELECT 1 FROM public.tournament_chip_set b WHERE b.tournament_id=p_tournament_id) THEN failure:='CHIP_SET_ALREADY_BOUND_RELOAD';END IF;
   END IF;
   IF failure IS NULL THEN
     BEGIN
       created:=public.chip_ops_create_chip_set(ctx.club_id,ctx.canonical_name);
       failure:=created->>'error';
       IF failure IS NOT NULL THEN RAISE EXCEPTION 'chip_setup_known_rejection';END IF;
       set_id:=(created->>'chip_set_id')::uuid;
       IF created->>'status' IS DISTINCT FROM 'ok' OR set_id IS NULL OR NOT EXISTS(
         SELECT 1 FROM public.chip_set s WHERE s.id=set_id AND s.club_id=ctx.club_id AND s.name=ctx.canonical_name AND s.created_by=ctx.actor_id
       ) THEN RAISE EXCEPTION 'chip_setup_create_unverified' USING ERRCODE='23514';END IF;
       INSERT INTO public.tournament_chip_set(tournament_id,chip_set_id,club_id,created_by)
       VALUES(p_tournament_id,set_id,ctx.club_id,ctx.actor_id)
       ON CONFLICT(tournament_id) DO NOTHING RETURNING tournament_id INTO inserted;
       IF inserted IS NULL THEN
         failure:='CHIP_SET_ALREADY_BOUND_RELOAD';RAISE EXCEPTION 'chip_setup_known_rejection';
       END IF;
     EXCEPTION WHEN raise_exception THEN
       IF SQLERRM<>'chip_setup_known_rejection' OR failure IS NULL THEN RAISE;END IF;
       -- This subtransaction rolls back creation too, including a legacy-bind
       -- race which wins the unique tournament binding. Preserve only outcome.
       set_id:=NULL;
     END;
   END IF;
 END IF;
 answer:=jsonb_build_object('status',CASE WHEN failure IS NULL THEN 'ok' ELSE 'rejected' END,
   'outcome',CASE WHEN p_cancel THEN 'cancelled' WHEN failure IS NOT NULL THEN 'rejected' ELSE 'created_bound' END,
   'actor_id',ctx.actor_id,'request_id',p_request_id,'tournament_id',p_tournament_id,'club_id',ctx.club_id,
   'set_name',ctx.canonical_name,'chip_set_id',set_id,'error',failure);
 INSERT INTO private.chip_setup_create_bind_receipts_v1(actor_id,request_id,tournament_id,club_id,payload_hash,response)
 VALUES(ctx.actor_id,p_request_id,p_tournament_id,ctx.club_id,ctx.payload_hash,answer);
 RETURN answer;
END $function$;

CREATE FUNCTION public.chip_ops_create_and_bind_set_v1(p_tournament_id uuid,p_name text,p_request_id uuid,p_expected_actor uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $function$
 SELECT private.apply_chip_setup_intent_v1(p_tournament_id,p_name,p_request_id,p_expected_actor,false);
$function$;
CREATE FUNCTION public.cancel_chip_setup_create_bind_v1(p_tournament_id uuid,p_name text,p_request_id uuid,p_expected_actor uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $function$
 SELECT private.apply_chip_setup_intent_v1(p_tournament_id,p_name,p_request_id,p_expected_actor,true);
$function$;
CREATE FUNCTION public.get_chip_setup_create_bind_receipt_v1(p_tournament_id uuid,p_name text,p_request_id uuid,p_expected_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE ctx record;r private.chip_setup_create_bind_receipts_v1%ROWTYPE;
BEGIN
 SELECT * INTO ctx FROM private.chip_setup_intent_context_v1(p_tournament_id,p_name,p_request_id,p_expected_actor);
 SELECT * INTO r FROM private.chip_setup_create_bind_receipts_v1 WHERE actor_id=ctx.actor_id AND request_id=p_request_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF r.payload_hash IS DISTINCT FROM ctx.payload_hash OR r.tournament_id IS DISTINCT FROM p_tournament_id OR r.club_id IS DISTINCT FROM ctx.club_id THEN
   RAISE EXCEPTION 'chip_setup_request_payload_conflict' USING ERRCODE='22023';END IF;
 RETURN r.response;
END $function$;

REVOKE ALL ON FUNCTION private.chip_setup_intent_context_v1(uuid,text,uuid,uuid),private.apply_chip_setup_intent_v1(uuid,text,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.chip_ops_create_and_bind_set_v1(uuid,text,uuid,uuid),public.cancel_chip_setup_create_bind_v1(uuid,text,uuid,uuid),public.get_chip_setup_create_bind_receipt_v1(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.chip_ops_create_and_bind_set_v1(uuid,text,uuid,uuid),public.cancel_chip_setup_create_bind_v1(uuid,text,uuid,uuid),public.get_chip_setup_create_bind_receipt_v1(uuid,text,uuid,uuid) TO authenticated;
COMMIT;
