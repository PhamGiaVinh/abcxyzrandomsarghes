-- CLI candidate20261021000559 reserved as unused campaign223. LOCAL CANDIDATE, NOT LIVE.
-- No ledger rewrite or policy change. Legacy writer delegates to the same receipts.
-- Recovery: rollback frontend but keep compatible backend once any v2 receipt
-- exists. Pre-use uninstall is guarded by bankReceipt271.recovery.pg17.sql.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $pre$
BEGIN
 IF current_user<>'postgres'
 OR md5(pg_get_functiondef('public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text)'::regprocedure)) IS DISTINCT FROM 'da643ca448cb56633268c8b377895b19'
 OR to_regclass('floor_private.chip_mutation_receipts') IS NULL
 OR to_regprocedure('floor_private.chip_bank_adjust_primitive_v1(uuid,uuid,text,bigint,uuid,integer,text)') IS NOT NULL
 OR to_regprocedure('floor_private.resolve_chip_bank_adjust_v2(uuid,uuid,text,bigint,uuid,integer,text,uuid,text)') IS NOT NULL
 OR to_regprocedure('public.chip_ops_bank_adjust_v2(uuid,uuid,text,bigint,uuid,integer,text,uuid)') IS NOT NULL
 OR to_regprocedure('public.get_chip_bank_adjust_receipt_v2(uuid,uuid,text,bigint,uuid,integer,text,uuid)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE (n.nspname='public' AND p.proname IN('chip_ops_bank_adjust_v2','get_chip_bank_adjust_receipt_v2'))
      OR (n.nspname='floor_private' AND p.proname IN('resolve_chip_bank_adjust_v2','chip_bank_adjust_primitive_v1')))
 OR NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass('floor_private.chip_mutation_receipts')
   AND c.contype='p' AND pg_get_constraintdef(c.oid)='PRIMARY KEY (actor_id, request_key)')
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000223') THEN
  RAISE EXCEPTION 'chip_bank223_catalog_drift_or_collision';
 END IF;
 -- Exact reviewed primitive remains the only bank arithmetic/locking implementation.
 EXECUTE replace(pg_get_functiondef('public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text)'::regprocedure),
   'CREATE OR REPLACE FUNCTION public.chip_ops_bank_adjust(',
   'CREATE FUNCTION floor_private.chip_bank_adjust_primitive_v1(');
END $pre$;

CREATE FUNCTION floor_private.resolve_chip_bank_adjust_v2(
 p_club_id uuid,p_denomination_id uuid,p_direction text,p_count bigint,p_tournament_id uuid,
 p_old_version integer,p_idempotency_key text,p_expected_actor uuid,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
DECLARE actor uuid:=auth.uid();payload jsonb;answer jsonb;result jsonb;failure text;replayed boolean:=false;
 prior floor_private.chip_mutation_receipts%ROWTYPE;ledger public.chip_bank_ledger%ROWTYPE;
BEGIN
 IF actor IS NULL THEN RETURN jsonb_build_object('error','Unauthorized');END IF;
 IF actor IS DISTINCT FROM p_expected_actor THEN RAISE EXCEPTION 'chip_bank_actor_changed' USING ERRCODE='42501';END IF;
 IF p_action IS NULL OR p_action NOT IN('apply','lookup') THEN RAISE EXCEPTION 'chip_bank_invalid_action';END IF;
 IF p_club_id IS NULL OR p_denomination_id IS NULL OR p_direction IS NULL OR p_direction NOT IN('thu','xuat')
 OR p_count IS NULL OR p_count<=0 OR p_old_version IS NULL OR p_old_version<0
 OR p_idempotency_key IS NULL OR length(btrim(p_idempotency_key))=0 OR length(p_idempotency_key)>128 THEN
  RETURN jsonb_build_object('error','INVALID_INPUT');
 END IF;
 IF NOT(coalesce(public.is_club_owner(actor,p_club_id),false) OR coalesce(public.is_club_chip_master(actor,p_club_id),false)) THEN
  RETURN jsonb_build_object('error','Forbidden');END IF;
 payload:=jsonb_build_object('club_id',p_club_id,'denomination_id',p_denomination_id,'direction',p_direction,
   'count',p_count,'tournament_id',p_tournament_id,'expected_version',p_old_version);
 -- Same order as current bank/color-up writer: club first, then global ledger key.
 PERFORM pg_catalog.pg_advisory_xact_lock(280016,pg_catalog.hashtext('club:'||p_club_id::text));
 PERFORM pg_catalog.pg_advisory_xact_lock(280011,pg_catalog.hashtext(p_idempotency_key));
 IF NOT(coalesce(public.is_club_owner(actor,p_club_id),false) OR coalesce(public.is_club_chip_master(actor,p_club_id),false)) THEN
  RETURN jsonb_build_object('error','Forbidden');END IF;
 SELECT * INTO prior FROM floor_private.chip_mutation_receipts r WHERE r.actor_id=actor AND r.request_key=p_idempotency_key;
 IF FOUND THEN
  IF prior.operation IS DISTINCT FROM 'bank_adjust_v2' OR prior.payload IS DISTINCT FROM payload THEN
   RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT');END IF;
  RETURN prior.result||jsonb_build_object('idempotent',true);
 END IF;
 SELECT * INTO ledger FROM public.chip_bank_ledger l WHERE l.idempotency_key=p_idempotency_key;
 IF FOUND THEN
  replayed:=true;
  IF ledger.actor IS DISTINCT FROM actor OR ledger.club_id IS DISTINCT FROM p_club_id OR ledger.reason IS DISTINCT FROM 'manual'
  OR ledger.denomination_id IS DISTINCT FROM p_denomination_id OR ledger.direction IS DISTINCT FROM p_direction
  OR ledger.count IS DISTINCT FROM p_count OR ledger.tournament_id IS DISTINCT FROM p_tournament_id
  OR ledger.details->'expected_version' IS DISTINCT FROM to_jsonb(p_old_version) THEN
   RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT');END IF;
  result:=jsonb_build_object('status','ok','direction',ledger.direction,'count',ledger.count,
    'on_hand_count',ledger.balance_after,'balance_after',ledger.balance_after);
 ELSIF p_action='lookup' THEN RETURN NULL;
 ELSE
  result:=floor_private.chip_bank_adjust_primitive_v1(p_club_id,p_denomination_id,p_direction,p_count,p_tournament_id,p_old_version,p_idempotency_key);
  failure:=result->>'error';
  IF failure IS NULL THEN
   SELECT * INTO ledger FROM public.chip_bank_ledger l WHERE l.idempotency_key=p_idempotency_key;
   IF NOT FOUND OR result->>'status' IS DISTINCT FROM 'ok' OR ledger.actor IS DISTINCT FROM actor
   OR ledger.club_id IS DISTINCT FROM p_club_id OR ledger.denomination_id IS DISTINCT FROM p_denomination_id
   OR ledger.tournament_id IS DISTINCT FROM p_tournament_id OR ledger.reason IS DISTINCT FROM 'manual'
   OR ledger.direction IS DISTINCT FROM p_direction OR ledger.count IS DISTINCT FROM p_count
   OR ledger.details->'expected_version' IS DISTINCT FROM to_jsonb(p_old_version)
   OR result->'count' IS DISTINCT FROM to_jsonb(p_count) OR result->'direction' IS DISTINCT FROM to_jsonb(p_direction)
   OR result->'balance_after' IS DISTINCT FROM to_jsonb(ledger.balance_after)
   OR result->'on_hand_count' IS DISTINCT FROM to_jsonb(ledger.balance_after) THEN
    RAISE EXCEPTION 'chip_bank_unverified_commit' USING ERRCODE='23514';END IF;
  ELSIF failure NOT IN('Unauthorized','Forbidden','INVALID_INPUT','DENOM_NOT_IN_CLUB','TOURNAMENT_NOT_IN_CLUB','BANK_NEGATIVE','race_lost','IDEMPOTENCY_CONFLICT') THEN
   RAISE EXCEPTION 'chip_bank_unrecognized_rejection' USING ERRCODE='23514';
  END IF;
 END IF;
 answer:=jsonb_build_object('status',CASE WHEN failure IS NULL THEN 'ok' ELSE 'rejected' END,
  'outcome',CASE WHEN failure IS NULL THEN 'applied' ELSE 'rejected' END,'actor_id',actor,
  'request_id',p_idempotency_key,'payload',payload,'ledger_id',CASE WHEN failure IS NULL THEN ledger.id ELSE NULL END,
  'result',result,'error',failure,'idempotent',replayed);
 IF p_action='apply' THEN
  INSERT INTO floor_private.chip_mutation_receipts(actor_id,request_key,operation,payload,result)
    VALUES(actor,p_idempotency_key,'bank_adjust_v2',payload,answer);
 END IF;
 RETURN answer;
END $f$;

CREATE FUNCTION public.chip_ops_bank_adjust_v2(p_club_id uuid,p_denomination_id uuid,p_direction text,p_count bigint,p_tournament_id uuid,p_old_version integer,p_idempotency_key text,p_expected_actor uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $f$
 SELECT floor_private.resolve_chip_bank_adjust_v2(p_club_id,p_denomination_id,p_direction,p_count,p_tournament_id,p_old_version,p_idempotency_key,p_expected_actor,'apply');
$f$;
CREATE FUNCTION public.get_chip_bank_adjust_receipt_v2(p_club_id uuid,p_denomination_id uuid,p_direction text,p_count bigint,p_tournament_id uuid,p_old_version integer,p_idempotency_key text,p_expected_actor uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $f$
 SELECT floor_private.resolve_chip_bank_adjust_v2(p_club_id,p_denomination_id,p_direction,p_count,p_tournament_id,p_old_version,p_idempotency_key,p_expected_actor,'lookup');
$f$;
-- Keep the legacy signature/return shape, but it cannot bypass durable rejections.
CREATE OR REPLACE FUNCTION public.chip_ops_bank_adjust(p_club_id uuid,p_denomination_id uuid,p_direction text,p_count bigint,p_tournament_id uuid DEFAULT NULL,p_old_version integer DEFAULT 0,p_idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE answer jsonb;
BEGIN
 answer:=floor_private.resolve_chip_bank_adjust_v2(p_club_id,p_denomination_id,p_direction,p_count,p_tournament_id,p_old_version,p_idempotency_key,auth.uid(),'apply');
 IF answer->>'outcome'='applied' AND (answer->>'idempotent')::boolean THEN
  RETURN (answer->'result')||jsonb_build_object('idempotent',true);
 END IF;
 RETURN coalesce(answer->'result',answer);
END $f$;
REVOKE ALL ON FUNCTION floor_private.chip_bank_adjust_primitive_v1(uuid,uuid,text,bigint,uuid,integer,text),floor_private.resolve_chip_bank_adjust_v2(uuid,uuid,text,bigint,uuid,integer,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.chip_ops_bank_adjust_v2(uuid,uuid,text,bigint,uuid,integer,text,uuid),public.get_chip_bank_adjust_receipt_v2(uuid,uuid,text,bigint,uuid,integer,text,uuid),public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.chip_ops_bank_adjust_v2(uuid,uuid,text,bigint,uuid,integer,text,uuid),public.get_chip_bank_adjust_receipt_v2(uuid,uuid,text,bigint,uuid,integer,text,uuid),public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text) TO authenticated;
COMMIT;
