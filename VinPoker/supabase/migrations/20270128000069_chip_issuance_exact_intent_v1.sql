-- CLI candidate20261013131229; forward69 checked absent source/live.
-- Exact issuance generation and actor/key/payload receipts. Existing count,
-- inventory/coupling/rounding semantics are preserved in the pinned private core.
-- ROLLBACK: disable issuance UI and forward restore reviewed function snapshots;
-- retain revision/receipts/ledger. Never restore old counts or delete audit.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$ DECLARE fn regprocedure:=to_regprocedure('public.chip_ops_set_issuance(uuid,integer)'); p pg_proc%ROWTYPE; definition text;
BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid=fn;
 IF fn IS NULL OR md5(replace(p.prosrc,chr(13),''))<>'e0fb34ec86462d73d7d95121f8ae5b3a'
  OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' THEN RAISE EXCEPTION 'issuance69_baseline_drift'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stack_template_issuance' AND column_name='revision')
  OR to_regprocedure('floor_private.chip_issuance_core69(uuid,integer)') IS NOT NULL
  OR to_regprocedure('public.chip_ops_set_issuance_v2(uuid,integer,bigint,uuid,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'issuance69_namespace_collision'; END IF;
 IF has_table_privilege('authenticated','public.stack_template_issuance','INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'issuance69_direct_write_acl_drift'; END IF;
 definition:=replace(pg_get_functiondef(fn),chr(13),'');
 definition:=replace(definition,'FUNCTION public.chip_ops_set_issuance(', 'FUNCTION floor_private.chip_issuance_core69(');
 IF position('FUNCTION floor_private.chip_issuance_core69(' in definition)=0 THEN RAISE EXCEPTION 'issuance69_clone_seam_drift'; END IF;
 EXECUTE definition;
END $preflight$;
ALTER FUNCTION floor_private.chip_issuance_core69(uuid,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.chip_issuance_core69(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.stack_template_issuance ADD COLUMN revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0);
CREATE FUNCTION floor_private.chip_issuance_revision69() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.revision:=1;
 ELSE NEW.revision:=OLD.revision+CASE WHEN NEW.issued_count IS DISTINCT FROM OLD.issued_count THEN 1 ELSE 0 END; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION floor_private.chip_issuance_revision69() OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.chip_issuance_revision69() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER chip_issuance_revision69 BEFORE INSERT OR UPDATE ON public.stack_template_issuance
 FOR EACH ROW EXECUTE FUNCTION floor_private.chip_issuance_revision69();

CREATE FUNCTION public.get_chip_issuance_state_v1(p_stack_template_id uuid,p_expected_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); club uuid; tour uuid; count_now integer; rev bigint;
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_actor THEN RETURN jsonb_build_object('error','ACTOR_MISMATCH'); END IF;
 SELECT t.club_id,t.id INTO club,tour FROM public.stack_template s JOIN public.tournaments t ON t.id=s.tournament_id
 WHERE s.id=p_stack_template_id AND s.club_id=t.club_id AND t.deleted_at IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','TEMPLATE_NOT_FOUND'); END IF;
 IF NOT(COALESCE(public.is_club_owner(actor,club),false) OR COALESCE(public.is_club_chip_master(actor,club),false)) THEN RETURN jsonb_build_object('error','Forbidden'); END IF;
 IF EXISTS(SELECT 1 FROM public.stack_template_issuance i WHERE i.stack_template_id=p_stack_template_id AND i.club_id IS DISTINCT FROM club) THEN RETURN jsonb_build_object('error','ISSUANCE_SCOPE_MISMATCH'); END IF;
 SELECT i.issued_count,i.revision INTO count_now,rev FROM public.stack_template_issuance i WHERE i.stack_template_id=p_stack_template_id AND i.club_id=club;
 RETURN jsonb_build_object('status','ok','actor_id',actor,'club_id',club,'tournament_id',tour,
   'stack_template_id',p_stack_template_id,'issued_count',COALESCE(count_now,0),'revision',COALESCE(rev,0));
END $$;

CREATE FUNCTION public.chip_ops_set_issuance_v2(p_stack_template_id uuid,p_issued_count integer,p_expected_revision bigint,p_request_id uuid,p_expected_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); context jsonb; club uuid; tour uuid; payload jsonb; result jsonb; prior floor_private.chip_mutation_receipts%ROWTYPE; rev bigint;
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_actor THEN RETURN jsonb_build_object('error','ACTOR_MISMATCH'); END IF;
 IF p_stack_template_id IS NULL OR p_issued_count IS NULL OR p_issued_count<0 OR p_expected_revision IS NULL OR p_expected_revision<0 OR p_request_id IS NULL THEN RETURN jsonb_build_object('error','INVALID_INPUT'); END IF;
 context:=public.get_chip_issuance_state_v1(p_stack_template_id,actor);
 IF context->>'status' IS DISTINCT FROM 'ok' THEN RETURN context; END IF;
 club:=(context->>'club_id')::uuid; tour:=(context->>'tournament_id')::uuid;
 payload:=jsonb_build_object('stack_template_id',p_stack_template_id,'issued_count',p_issued_count,'expected_revision',p_expected_revision);
 PERFORM pg_advisory_xact_lock(280016,hashtext('club:'||club::text));
 PERFORM 1 FROM public.tournaments t WHERE t.id=tour AND t.club_id=club AND t.deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','TOURNAMENT_NOT_FOUND'); END IF;
 PERFORM pg_advisory_xact_lock(280016,hashtext(p_request_id::text));
 PERFORM 1 FROM public.stack_template s WHERE s.id=p_stack_template_id AND s.tournament_id=tour AND s.club_id=club FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','TEMPLATE_NOT_IN_CLUB'); END IF;
 context:=public.get_chip_issuance_state_v1(p_stack_template_id,actor);
 IF context->>'status' IS DISTINCT FROM 'ok' THEN RETURN context; END IF;
 SELECT * INTO prior FROM floor_private.chip_mutation_receipts r WHERE r.actor_id=actor AND r.request_key=p_request_id::text;
 IF FOUND THEN
  IF prior.operation<>'issuance_v2' OR prior.payload<>payload THEN RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN prior.result;
 END IF;
 rev:=(context->>'revision')::bigint;
 IF rev<>p_expected_revision THEN result:=jsonb_build_object('error','STALE_STATE','current_revision',rev);
 ELSE
  result:=floor_private.chip_issuance_core69(p_stack_template_id,p_issued_count);
  IF result->>'status'='ok' THEN
   SELECT revision INTO rev FROM public.stack_template_issuance WHERE stack_template_id=p_stack_template_id AND club_id=club;
   result:=result||jsonb_build_object('revision',rev);
  END IF;
 END IF;
 result:=result||jsonb_build_object('actor_id',actor,'request_id',p_request_id,'payload',payload,'club_id',club,'tournament_id',tour);
 INSERT INTO floor_private.chip_mutation_receipts(actor_id,request_key,operation,payload,result)
 VALUES(actor,p_request_id::text,'issuance_v2',payload,result);
 RETURN result;
END $$;

CREATE FUNCTION public.get_chip_issuance_receipt_v1(p_stack_template_id uuid,p_issued_count integer,p_expected_revision bigint,p_request_id uuid,p_expected_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb; prior floor_private.chip_mutation_receipts%ROWTYPE; payload jsonb;
BEGIN
 IF p_request_id IS NULL OR p_issued_count IS NULL OR p_issued_count<0 OR p_expected_revision IS NULL OR p_expected_revision<0 THEN RETURN jsonb_build_object('error','INVALID_INPUT'); END IF;
 context:=public.get_chip_issuance_state_v1(p_stack_template_id,p_expected_actor);
 IF context->>'status' IS DISTINCT FROM 'ok' THEN RETURN context; END IF;
 payload:=jsonb_build_object('stack_template_id',p_stack_template_id,'issued_count',p_issued_count,'expected_revision',p_expected_revision);
 SELECT * INTO prior FROM floor_private.chip_mutation_receipts r WHERE r.actor_id=p_expected_actor AND r.request_key=p_request_id::text;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','unknown'); END IF;
 IF prior.operation<>'issuance_v2' OR prior.payload<>payload THEN RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); END IF;
 RETURN jsonb_build_object('status','committed','result',prior.result);
END $$;
CREATE OR REPLACE FUNCTION public.chip_ops_set_issuance(p_stack_template_id uuid,p_issued_count integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN jsonb_build_object('error','EXACT_ISSUANCE_INTENT_REQUIRED'); END $$;
ALTER FUNCTION public.get_chip_issuance_state_v1(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.chip_ops_set_issuance_v2(uuid,integer,bigint,uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.get_chip_issuance_receipt_v1(uuid,integer,bigint,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_chip_issuance_state_v1(uuid,uuid),public.chip_ops_set_issuance_v2(uuid,integer,bigint,uuid,uuid),public.get_chip_issuance_receipt_v1(uuid,integer,bigint,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_chip_issuance_state_v1(uuid,uuid),public.chip_ops_set_issuance_v2(uuid,integer,bigint,uuid,uuid),public.get_chip_issuance_receipt_v1(uuid,integer,bigint,uuid,uuid) TO authenticated;
DO $postcheck$ BEGIN
 IF (SELECT count(*) FROM (VALUES
   ('public.chip_ops_set_issuance(uuid,integer)','f1885080a12f394c4adce5a5102915f7',true),
   ('floor_private.chip_issuance_core69(uuid,integer)','e0fb34ec86462d73d7d95121f8ae5b3a',false),
   ('floor_private.chip_issuance_revision69()','bb94700074da2962b0911c13ce62bf06',false),
   ('public.get_chip_issuance_state_v1(uuid,uuid)','066efa4e61b6b4ca4c570d4d81161659',true),
   ('public.chip_ops_set_issuance_v2(uuid,integer,bigint,uuid,uuid)','bc3ad8fd8869bc4ef443121c3f9e37cd',true),
   ('public.get_chip_issuance_receipt_v1(uuid,integer,bigint,uuid,uuid)','0a7f05e263e1de11d20d0e3ba5bacdef',true)
 ) expected(signature,hash,browser_grant) JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
 WHERE md5(replace(p.prosrc,chr(13),''))=expected.hash AND p.proowner='postgres'::regrole
  AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[]
  AND p.proacl::text=CASE WHEN expected.browser_grant THEN '{postgres=X/postgres,authenticated=X/postgres}' ELSE '{postgres=X/postgres}' END)<>6
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.stack_template_issuance'::regclass
  AND tgname='chip_issuance_revision69' AND tgenabled='O'
  AND tgfoid='floor_private.chip_issuance_revision69()'::regprocedure)
 OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.stack_template_issuance'::regclass
  AND attname='revision' AND atttypid='bigint'::regtype AND attnotnull AND NOT attisdropped)
 THEN RAISE EXCEPTION 'issuance69_object_postcheck_failed'; END IF;
END $postcheck$;
COMMIT;
