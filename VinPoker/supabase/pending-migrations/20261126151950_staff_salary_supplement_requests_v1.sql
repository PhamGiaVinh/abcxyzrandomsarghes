DO $new_function_guards$ BEGIN
 IF to_regprocedure('floor_private.staff_salary_adjustment_operator_v1(uuid,uuid)') IS NOT NULL AND (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid=to_regprocedure('floor_private.staff_salary_adjustment_operator_v1(uuid,uuid)')) NOT IN ('cbcd85af5d3addb1556e46f74a6dde00') THEN RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_FUNCTION_DRIFT:floor_private.staff_salary_adjustment_operator_v1(uuid,uuid)';END IF;
 IF to_regprocedure('floor_private.staff_salary_adjustment_immutable_v1()') IS NOT NULL AND (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid=to_regprocedure('floor_private.staff_salary_adjustment_immutable_v1()')) NOT IN ('b7d524487449b78500664d73e0c7517c') THEN RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_FUNCTION_DRIFT:floor_private.staff_salary_adjustment_immutable_v1()';END IF;
 IF to_regprocedure('floor_private.refresh_staff_salary_adjustment_v1(uuid)') IS NOT NULL AND (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid=to_regprocedure('floor_private.refresh_staff_salary_adjustment_v1(uuid)')) NOT IN ('632a30e4b21171930989a7926629f256') THEN RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_FUNCTION_DRIFT:floor_private.refresh_staff_salary_adjustment_v1(uuid)';END IF;
 IF to_regprocedure('public.refresh_staff_salary_adjustment_v1(uuid)') IS NOT NULL AND (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid=to_regprocedure('public.refresh_staff_salary_adjustment_v1(uuid)')) NOT IN ('2cfed54778e95eeb2858e892d13602a6','59ef1d0290b700428b3ee97d255c647f') THEN RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_FUNCTION_DRIFT:public.refresh_staff_salary_adjustment_v1(uuid)';END IF;
 IF to_regprocedure('floor_private.staff_salary_checkout_adjustment_v1()') IS NOT NULL AND (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid=to_regprocedure('floor_private.staff_salary_checkout_adjustment_v1()')) NOT IN ('00c6d171041ef2fd443705bc5338954c') THEN RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_FUNCTION_DRIFT:floor_private.staff_salary_checkout_adjustment_v1()';END IF;
 IF to_regprocedure('public.get_staff_salary_adjustments_v1(uuid,integer,integer)') IS NOT NULL AND (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid=to_regprocedure('public.get_staff_salary_adjustments_v1(uuid,integer,integer)')) NOT IN ('f462a9c5781e6bea9a8dbccf247dffca') THEN RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_FUNCTION_DRIFT:public.get_staff_salary_adjustments_v1(uuid,integer,integer)';END IF;
 IF to_regprocedure('public.get_staff_salary_run_source_v1(uuid)') IS NOT NULL AND (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid=to_regprocedure('public.get_staff_salary_run_source_v1(uuid)')) NOT IN ('dfdf857f24d3cb99504a7c5d737dab14') THEN RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_FUNCTION_DRIFT:public.get_staff_salary_run_source_v1(uuid)';END IF;
 IF to_regprocedure('floor_private.staff_salary_supplement_guard_v1()') IS NOT NULL AND (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid=to_regprocedure('floor_private.staff_salary_supplement_guard_v1()')) NOT IN ('98263f569cfb85ad5792cc2fc7b33336') THEN RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_FUNCTION_DRIFT:floor_private.staff_salary_supplement_guard_v1()';END IF;
 IF to_regprocedure('public.approve_staff_salary_adjustment_v1(uuid)') IS NOT NULL AND (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid=to_regprocedure('public.approve_staff_salary_adjustment_v1(uuid)')) NOT IN ('a6a0194019fa99696053ec51d8d66461','2f2ccd5292b359ffc71ee586003c06a8') THEN RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_FUNCTION_DRIFT:public.approve_staff_salary_adjustment_v1(uuid)';END IF;
END $new_function_guards$;
DO $existing_function_guard$ BEGIN
 IF (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid='public.mark_staff_salary_paid(uuid,text,text)'::regprocedure) NOT IN ('a479b49abe2e0ebbe04eae69ddfbacf8','10d599583bab91c6b72d052783e64eb6') THEN RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_EXISTING_FUNCTION_DRIFT';END IF;
 IF (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid='public.get_staff_salary_report(uuid,integer,integer)'::regprocedure) NOT IN ('e42cb9276ccb2c67f679d02d5c9cb3c6','fba77049eb63e5f71f21644470fc27aa') THEN RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_EXISTING_FUNCTION_DRIFT';END IF;
END $existing_function_guard$;
-- Owner-gated supplementary FT payables: private requests, current-source approval and existing payment/Finance stream.
-- No production apply. Requests/source stay private; no client amount or new payment path.
-- ROLLBACK: paired ROLLBACK_20261126151950_staff_salary_supplement_requests_v1.sql holds new requests/approvals and retains read/payment compatibility.
DO $prerequisite$ BEGIN
 IF to_regclass('floor_private.staff_salary_sources_v1') IS NULL
 OR (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid='public.chot_staff_salary_month(uuid,integer,integer)'::regprocedure)<>'d72e3c7ff70ae385a9bab496f07f78dc' THEN
  RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_REQUIRES_CLOSED_SOURCE_V1';END IF;
 IF to_regclass('floor_private.staff_salary_adjustment_requests_v1') IS NOT NULL
 AND obj_description(to_regclass('floor_private.staff_salary_adjustment_requests_v1'),'pg_class') IS DISTINCT FROM 'staff_salary_adjustment_requests_v1_private' THEN
  RAISE EXCEPTION 'STAFF_SALARY_REQUEST_STORAGE_UNKNOWN';END IF;
END $prerequisite$;

CREATE TABLE IF NOT EXISTS floor_private.staff_salary_adjustment_requests_v1(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 base_run_id uuid NOT NULL REFERENCES public.staff_salary_runs(id) ON DELETE RESTRICT,
 club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
 staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
 period_year integer NOT NULL,period_month integer NOT NULL CHECK(period_month BETWEEN 1 AND 12),
 amount_vnd bigint NOT NULL CHECK(amount_vnd>0),gross_delta_vnd bigint NOT NULL,
 source_fingerprint text NOT NULL CHECK(length(source_fingerprint)=64),
 source_snapshot jsonb NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','superseded','approved')),
 created_at timestamptz NOT NULL DEFAULT now(),created_by uuid REFERENCES auth.users(id),
 superseded_at timestamptz,superseded_reason text,
 approved_at timestamptz,approved_by uuid REFERENCES auth.users(id),
 child_run_id uuid UNIQUE REFERENCES public.staff_salary_runs(id) ON DELETE RESTRICT,
 CHECK((state='approved' AND approved_at IS NOT NULL AND approved_by IS NOT NULL)
   OR(state<>'approved' AND approved_at IS NULL AND approved_by IS NULL AND child_run_id IS NULL)),
 CHECK((state='superseded')=(superseded_at IS NOT NULL))
);
COMMENT ON TABLE floor_private.staff_salary_adjustment_requests_v1 IS 'staff_salary_adjustment_requests_v1_private';
ALTER TABLE floor_private.staff_salary_adjustment_requests_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE floor_private.staff_salary_adjustment_requests_v1 FROM PUBLIC,anon,authenticated,service_role;
-- No derivation/backfill from existing requests: a missing value refuses qualification.
ALTER TABLE floor_private.staff_salary_adjustment_requests_v1 ADD COLUMN IF NOT EXISTS gross_delta_vnd bigint;
ALTER TABLE floor_private.staff_salary_adjustment_requests_v1 ALTER COLUMN gross_delta_vnd SET NOT NULL;
DO $gross_constraint$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='floor_private.staff_salary_adjustment_requests_v1'::regclass AND conname='staff_salary_adjustment_gross_nonnegative_v1') THEN
  ALTER TABLE floor_private.staff_salary_adjustment_requests_v1 ADD CONSTRAINT staff_salary_adjustment_gross_nonnegative_v1 CHECK(gross_delta_vnd>=0);
 END IF;
END $gross_constraint$;
CREATE UNIQUE INDEX IF NOT EXISTS staff_salary_adjustment_one_pending_v1 ON floor_private.staff_salary_adjustment_requests_v1(base_run_id) WHERE state='pending';
CREATE INDEX IF NOT EXISTS staff_salary_adjustment_scope_v1 ON floor_private.staff_salary_adjustment_requests_v1(club_id,period_year,period_month,base_run_id);

CREATE OR REPLACE FUNCTION floor_private.staff_salary_adjustment_operator_v1(p_actor uuid,p_club uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $operator$
 SELECT p_actor IS NOT NULL AND(
  public.has_role(p_actor,'super_admin'::public.app_role)
  OR EXISTS(SELECT 1 FROM public.clubs WHERE id=p_club AND owner_id=p_actor)
  OR EXISTS(SELECT 1 FROM public.club_accountants WHERE club_id=p_club AND user_id=p_actor));
$operator$;
REVOKE ALL ON FUNCTION floor_private.staff_salary_adjustment_operator_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION floor_private.staff_salary_adjustment_immutable_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $request_guard$
DECLARE base public.staff_salary_runs%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'STAFF_SALARY_REQUEST_IMMUTABLE' USING ERRCODE='42501';END IF;
 IF TG_OP='UPDATE' THEN
  IF(to_jsonb(NEW)-ARRAY['state','superseded_at','superseded_reason','approved_at','approved_by','child_run_id'])
   IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','superseded_at','superseded_reason','approved_at','approved_by','child_run_id']) THEN
   RAISE EXCEPTION 'STAFF_SALARY_REQUEST_IMMUTABLE' USING ERRCODE='42501';END IF;
  IF OLD.state='pending' AND NEW.state IN('superseded','approved') THEN RETURN NEW;END IF;
  IF OLD.state='approved' AND NEW.state='approved' AND OLD.child_run_id IS NULL AND NEW.child_run_id=NEW.id
   AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by
   AND NEW.superseded_at IS NOT DISTINCT FROM OLD.superseded_at AND NEW.superseded_reason IS NOT DISTINCT FROM OLD.superseded_reason THEN RETURN NEW;END IF;
  RAISE EXCEPTION 'STAFF_SALARY_REQUEST_TRANSITION_REFUSED' USING ERRCODE='42501';
 END IF;
 SELECT * INTO base FROM public.staff_salary_runs WHERE id=NEW.base_run_id;
 IF NOT FOUND OR base.adjusts_id IS NOT NULL OR base.employment_type<>'full_time'
  OR ROW(NEW.club_id,NEW.staff_id,NEW.period_year,NEW.period_month)
   IS DISTINCT FROM ROW(base.club_id,base.staff_id,base.period_year,base.period_month)
  OR NEW.state<>'pending' THEN RAISE EXCEPTION 'STAFF_SALARY_REQUEST_SCOPE_INVALID' USING ERRCODE='22023';END IF;
 RETURN NEW;
END $request_guard$;
REVOKE ALL ON FUNCTION floor_private.staff_salary_adjustment_immutable_v1() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS staff_salary_adjustment_immutable_v1 ON floor_private.staff_salary_adjustment_requests_v1;
CREATE TRIGGER staff_salary_adjustment_immutable_v1 BEFORE INSERT OR UPDATE OR DELETE ON floor_private.staff_salary_adjustment_requests_v1
FOR EACH ROW EXECUTE FUNCTION floor_private.staff_salary_adjustment_immutable_v1();

CREATE OR REPLACE FUNCTION floor_private.refresh_staff_salary_adjustment_v1(p_base uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $refresh$
DECLARE base public.staff_salary_runs%ROWTYPE; frozen jsonb; current_source jsonb; fingerprint text;
 approved_sum bigint; approved_gross bigint; delta bigint; gross_delta bigint; current_request floor_private.staff_salary_adjustment_requests_v1%ROWTYPE;
 request_id uuid; employment public.staff%ROWTYPE;
BEGIN
 SELECT * INTO base FROM public.staff_salary_runs WHERE id=p_base;
 IF NOT FOUND OR base.adjusts_id IS NOT NULL OR base.employment_type<>'full_time' THEN RETURN jsonb_build_object('status','unverified','reason','BASE_NOT_VERIFIED');END IF;
 PERFORM floor_private.staff_salary_period_lock_v1(base.club_id,base.period_year,base.period_month);
 PERFORM 1 FROM public.staff_salary_periods WHERE club_id=base.club_id AND period_year=base.period_year AND period_month=base.period_month FOR UPDATE;
 SELECT * INTO base FROM public.staff_salary_runs WHERE id=p_base FOR UPDATE;
 IF base.status NOT IN('locked','paid') THEN RETURN jsonb_build_object('status','unverified','reason','BASE_NOT_CURRENT');END IF;
 SELECT snapshot INTO frozen FROM floor_private.staff_salary_sources_v1 WHERE run_id=base.id;
 IF frozen IS NULL THEN RETURN jsonb_build_object('status','unverified','reason','LEGACY_SOURCE_UNVERIFIED');END IF;
 SELECT * INTO employment FROM public.staff WHERE id=base.staff_id;
 IF NOT FOUND OR employment.deleted_at IS NOT NULL OR employment.employment_type<>'full_time' OR employment.club_id<>base.club_id THEN
  RETURN jsonb_build_object('status','unverified','reason','STAFF_SCOPE_CHANGED');END IF;
 current_source:=floor_private.staff_salary_source_v1(base.staff_id,base.period_year,base.period_month,frozen);
 current_source:=current_source-ARRAY['observed_at','frozen_at'];
 fingerprint:=encode(sha256(convert_to(current_source::text,'UTF8')),'hex');
 SELECT coalesce(sum(net_vnd),0),coalesce(sum(gross_vnd),0) INTO approved_sum,approved_gross FROM public.staff_salary_runs WHERE adjusts_id=base.id AND status IN('locked','paid');
 delta:=(current_source->>'net_vnd')::bigint-base.net_vnd-approved_sum;
 gross_delta:=(current_source->>'gross_vnd')::bigint-base.gross_vnd-approved_gross;
 SELECT * INTO current_request FROM floor_private.staff_salary_adjustment_requests_v1 WHERE base_run_id=base.id AND state='pending' FOR UPDATE;
 IF current_request.id IS NOT NULL AND delta>0 AND gross_delta>=0 AND current_request.amount_vnd=delta AND current_request.gross_delta_vnd=gross_delta
  AND current_request.source_fingerprint=fingerprint AND current_request.source_snapshot=current_source THEN
  RETURN jsonb_build_object('status','pending','request_id',current_request.id,'base_run_id',base.id,'amount_vnd',delta,'idempotent',true);END IF;
 IF current_request.id IS NOT NULL THEN
  UPDATE floor_private.staff_salary_adjustment_requests_v1 SET state='superseded',superseded_at=now(),superseded_reason='SOURCE_REVISION_CHANGED' WHERE id=current_request.id;
 END IF;
 IF delta<=0 OR gross_delta<0 THEN RETURN jsonb_build_object('status',CASE WHEN delta<0 OR gross_delta<0 THEN 'needs_review' ELSE 'no_adjustment' END,'base_run_id',base.id,'amount_vnd',delta);END IF;
 INSERT INTO floor_private.staff_salary_adjustment_requests_v1(base_run_id,club_id,staff_id,period_year,period_month,amount_vnd,gross_delta_vnd,source_fingerprint,source_snapshot,created_by)
 VALUES(base.id,base.club_id,base.staff_id,base.period_year,base.period_month,delta,gross_delta,fingerprint,current_source,auth.uid()) RETURNING id INTO request_id;
 RETURN jsonb_build_object('status','pending','request_id',request_id,'base_run_id',base.id,'amount_vnd',delta,'idempotent',false);
END $refresh$;
REVOKE ALL ON FUNCTION floor_private.refresh_staff_salary_adjustment_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.refresh_staff_salary_adjustment_v1(p_base_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $refresh_api$
DECLARE base public.staff_salary_runs%ROWTYPE; actor uuid:=auth.uid(); result jsonb;
BEGIN
 SELECT * INTO base FROM public.staff_salary_runs WHERE id=p_base_run_id;
 IF NOT FOUND OR NOT floor_private.staff_salary_adjustment_operator_v1(actor,base.club_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';END IF;
 PERFORM floor_private.staff_salary_period_lock_v1(base.club_id,base.period_year,base.period_month);
 SELECT * INTO base FROM public.staff_salary_runs WHERE id=p_base_run_id;
 IF NOT floor_private.staff_salary_adjustment_operator_v1(actor,base.club_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';END IF;
 result:=floor_private.refresh_staff_salary_adjustment_v1(base.id);
 RETURN result;
END $refresh_api$;
REVOKE ALL ON FUNCTION public.refresh_staff_salary_adjustment_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.refresh_staff_salary_adjustment_v1(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION floor_private.staff_salary_checkout_adjustment_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $checkout$
DECLARE previous_staff uuid; previous_year integer; previous_month integer; base record; scope record;
BEGIN
 IF TG_OP='UPDATE' THEN previous_staff:=OLD.staff_id;previous_year:=extract(year from OLD.shift_date);previous_month:=extract(month from OLD.shift_date);END IF;
 -- Lock the known staff/month BEFORE discovering a base: a freeze may not have committed its new run yet.
 FOR scope IN SELECT DISTINCT s.club_id,period.yr,period.mon FROM public.staff s JOIN(
  SELECT NEW.staff_id AS staff_id,extract(year from NEW.shift_date)::integer AS yr,extract(month from NEW.shift_date)::integer AS mon
  UNION ALL SELECT previous_staff,previous_year,previous_month)period ON period.staff_id=s.id
  WHERE s.employment_type='full_time'
  ORDER BY s.club_id,period.yr,period.mon
 LOOP PERFORM floor_private.staff_salary_period_lock_v1(scope.club_id,scope.yr,scope.mon);END LOOP;
 FOR base IN SELECT r.id,r.club_id,r.period_year,r.period_month FROM public.staff_salary_runs r
  JOIN floor_private.staff_salary_sources_v1 proof ON proof.run_id=r.id
  WHERE r.employment_type='full_time' AND r.adjusts_id IS NULL AND r.status IN('locked','paid')
  AND((r.staff_id=NEW.staff_id AND r.period_year=extract(year from NEW.shift_date) AND r.period_month=extract(month from NEW.shift_date))
   OR(r.staff_id=previous_staff AND r.period_year=previous_year AND r.period_month=previous_month))
  ORDER BY r.club_id,r.period_year,r.period_month,r.id
 LOOP PERFORM floor_private.refresh_staff_salary_adjustment_v1(base.id);END LOOP;
 RETURN NEW;
END $checkout$;
REVOKE ALL ON FUNCTION floor_private.staff_salary_checkout_adjustment_v1() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS staff_salary_checkout_adjustment_v1 ON public.staff_attendance;
CREATE TRIGGER staff_salary_checkout_adjustment_v1 AFTER INSERT OR UPDATE OF check_in_time,check_out_time,status,shift_date,staff_id
ON public.staff_attendance FOR EACH ROW EXECUTE FUNCTION floor_private.staff_salary_checkout_adjustment_v1();

CREATE OR REPLACE FUNCTION public.get_staff_salary_adjustments_v1(p_club_id uuid,p_year integer,p_month integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $requests_read$
BEGIN
 IF NOT floor_private.staff_salary_adjustment_operator_v1(auth.uid(),p_club_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('club_id',p_club_id,'period_year',p_year,'period_month',p_month,'requests',coalesce((
  SELECT jsonb_agg(jsonb_build_object('id',q.id,'base_run_id',q.base_run_id,'staff_id',q.staff_id,'amount_vnd',q.amount_vnd,'gross_delta_vnd',q.gross_delta_vnd,'state',q.state,
   'source_fingerprint',q.source_fingerprint,'child_run_id',q.child_run_id,'created_at',q.created_at,'approved_at',q.approved_at,'approved_by',q.approved_by)
   ORDER BY q.created_at,q.id) FROM floor_private.staff_salary_adjustment_requests_v1 q
   WHERE q.club_id=p_club_id AND q.period_year=p_year AND q.period_month=p_month),'[]'::jsonb));
END $requests_read$;
REVOKE ALL ON FUNCTION public.get_staff_salary_adjustments_v1(uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_staff_salary_adjustments_v1(uuid,integer,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_staff_salary_run_source_v1(p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $source_read$
DECLARE r public.staff_salary_runs%ROWTYPE; base public.staff_salary_runs%ROWTYPE; actor uuid:=auth.uid(); proof jsonb;
BEGIN
 SELECT * INTO r FROM public.staff_salary_runs WHERE id=p_run_id;
 IF NOT FOUND OR actor IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';END IF;
 IF NOT floor_private.staff_salary_adjustment_operator_v1(actor,r.club_id)
  AND NOT EXISTS(SELECT 1 FROM public.staff WHERE id=r.staff_id AND user_id=actor AND deleted_at IS NULL) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO base FROM public.staff_salary_runs WHERE id=coalesce(r.adjusts_id,r.id);
 IF NOT FOUND OR base.adjusts_id IS NOT NULL OR ROW(base.club_id,base.staff_id,base.period_year,base.period_month)
  IS DISTINCT FROM ROW(r.club_id,r.staff_id,r.period_year,r.period_month) THEN RAISE EXCEPTION 'salary_source_link_invalid' USING ERRCODE='42501';END IF;
 SELECT snapshot INTO proof FROM floor_private.staff_salary_sources_v1 WHERE run_id=base.id;
 IF r.adjusts_id IS NOT NULL THEN
  SELECT source_snapshot INTO proof FROM floor_private.staff_salary_adjustment_requests_v1 WHERE base_run_id=base.id AND child_run_id=r.id AND state='approved';
 END IF;
 RETURN jsonb_build_object('run_id',r.id,'base_run_id',base.id,'club_id',r.club_id,'staff_id',r.staff_id,
  'recorded_net_vnd',r.net_vnd,'recorded_gross_vnd',r.gross_vnd,
  'source_status',CASE WHEN proof IS NULL THEN 'unverified' ELSE 'verified' END,'source',proof);
END $source_read$;
REVOKE ALL ON FUNCTION public.get_staff_salary_run_source_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_staff_salary_run_source_v1(uuid) TO authenticated;

-- Permit many separately approved children while retaining one active base.
DO $legacy_children$ BEGIN
 IF EXISTS(SELECT 1 FROM public.staff_salary_runs r WHERE r.adjusts_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM floor_private.staff_salary_adjustment_requests_v1 q WHERE q.id=r.id AND q.base_run_id=r.adjusts_id AND q.state='approved')) THEN
  RAISE EXCEPTION 'LEGACY_SALARY_ADJUSTMENTS_REVIEW_REQUIRED';END IF;
 IF to_regclass('public.uq_staff_salary_run_month') IS NOT NULL
 AND md5(pg_get_indexdef(to_regclass('public.uq_staff_salary_run_month')))<>'755ea3c4cf1030c366c72cd75522212e' THEN
  RAISE EXCEPTION 'STAFF_SALARY_ACTIVE_INDEX_DRIFT';END IF;
END $legacy_children$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_salary_base_month_v1 ON public.staff_salary_runs(club_id,staff_id,period_year,period_month)
WHERE status<>'voided' AND adjusts_id IS NULL;
DROP INDEX IF EXISTS public.uq_staff_salary_run_month;

-- The second policy restricts only children; legacy base-row access is unchanged.
DROP POLICY IF EXISTS staff_salary_supplement_scope_v1 ON public.staff_salary_runs;
CREATE POLICY staff_salary_supplement_scope_v1 ON public.staff_salary_runs AS RESTRICTIVE FOR SELECT TO authenticated USING(
 adjusts_id IS NULL OR public.has_role(auth.uid(),'super_admin'::public.app_role)
 OR EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=staff_salary_runs.club_id AND c.owner_id=auth.uid())
 OR EXISTS(SELECT 1 FROM public.club_accountants a WHERE a.club_id=staff_salary_runs.club_id AND a.user_id=auth.uid())
 OR EXISTS(SELECT 1 FROM public.club_cashiers c WHERE c.club_id=staff_salary_runs.club_id AND c.user_id=auth.uid())
 OR EXISTS(SELECT 1 FROM public.staff s WHERE s.id=staff_salary_runs.staff_id AND s.user_id=auth.uid() AND s.deleted_at IS NULL));

CREATE OR REPLACE FUNCTION floor_private.staff_salary_supplement_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $child_guard$
DECLARE base public.staff_salary_runs%ROWTYPE; request floor_private.staff_salary_adjustment_requests_v1%ROWTYPE; actor uuid:=auth.uid();
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.adjusts_id IS NOT NULL THEN RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_IMMUTABLE' USING ERRCODE='42501';END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.adjusts_id IS NOT NULL AND NEW.adjusts_id IS DISTINCT FROM OLD.adjusts_id THEN
  RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_IMMUTABLE' USING ERRCODE='42501';END IF;
 IF NEW.adjusts_id IS NULL THEN
  IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.staff_salary_runs WHERE adjusts_id=OLD.id AND status IN('locked','paid'))
   AND(ROW(NEW.club_id,NEW.staff_id,NEW.period_year,NEW.period_month,NEW.gross_vnd,NEW.net_vnd,NEW.employment_type)
    IS DISTINCT FROM ROW(OLD.club_id,OLD.staff_id,OLD.period_year,OLD.period_month,OLD.gross_vnd,OLD.net_vnd,OLD.employment_type) OR NEW.status='voided') THEN
   RAISE EXCEPTION 'STAFF_SALARY_BASE_HAS_APPROVED_SUPPLEMENTS' USING ERRCODE='42501';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO base FROM public.staff_salary_runs WHERE id=NEW.adjusts_id;
 IF NOT FOUND OR base.adjusts_id IS NOT NULL OR base.status NOT IN('locked','paid') OR base.employment_type<>'full_time'
  OR NEW.employment_type<>'full_time' OR ROW(NEW.club_id,NEW.staff_id,NEW.period_year,NEW.period_month)
   IS DISTINCT FROM ROW(base.club_id,base.staff_id,base.period_year,base.period_month) THEN
  RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_SCOPE_INVALID' USING ERRCODE='42501';END IF;
 SELECT * INTO request FROM floor_private.staff_salary_adjustment_requests_v1 WHERE id=NEW.id AND base_run_id=base.id AND state='approved';
 IF NOT FOUND OR NEW.net_vnd<>request.amount_vnd OR NEW.gross_vnd<>request.gross_delta_vnd OR NEW.manual_bhxh_vnd<>0 OR NEW.manual_tax_vnd<>0 THEN
  RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_NOT_APPROVED' USING ERRCODE='42501';END IF;
 IF TG_OP='INSERT' THEN
  IF actor IS NULL OR request.approved_by IS DISTINCT FROM actor OR NEW.locked_by IS DISTINCT FROM actor
   OR NOT(public.has_role(actor,'super_admin'::public.app_role) OR EXISTS(SELECT 1 FROM public.clubs WHERE id=base.club_id AND owner_id=actor))
   OR NEW.status<>'locked' OR NEW.paid_at IS NOT NULL OR NEW.paid_by IS NOT NULL OR NEW.payment_method IS NOT NULL OR NEW.payment_reference IS NOT NULL THEN
   RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_NOT_APPROVED' USING ERRCODE='42501';END IF;
 ELSE
  IF NOT floor_private.staff_salary_adjustment_operator_v1(actor,NEW.club_id)
   OR(to_jsonb(NEW)-ARRAY['status','paid_at','paid_by','payment_method','payment_reference']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','paid_at','paid_by','payment_method','payment_reference'])
   OR OLD.status<>'locked' OR NEW.status<>'paid' OR NEW.paid_at IS NULL OR NEW.paid_by IS DISTINCT FROM actor
   OR NEW.payment_method IS NULL OR NEW.payment_method NOT IN('cash','bank_transfer')
   OR(NEW.payment_method='bank_transfer' AND nullif(btrim(NEW.payment_reference),'') IS NULL)
   OR(NEW.payment_method='cash' AND nullif(btrim(NEW.payment_reference),'') IS NOT NULL) THEN
   RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_PAYMENT_REFUSED' USING ERRCODE='42501';END IF;
 END IF;
 RETURN NEW;
END $child_guard$;
REVOKE ALL ON FUNCTION floor_private.staff_salary_supplement_guard_v1() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS staff_salary_supplement_guard_v1 ON public.staff_salary_runs;
CREATE TRIGGER staff_salary_supplement_guard_v1 BEFORE INSERT OR UPDATE OR DELETE ON public.staff_salary_runs
FOR EACH ROW EXECUTE FUNCTION floor_private.staff_salary_supplement_guard_v1();

CREATE OR REPLACE FUNCTION public.approve_staff_salary_adjustment_v1(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $approve$
DECLARE request floor_private.staff_salary_adjustment_requests_v1%ROWTYPE; base public.staff_salary_runs%ROWTYPE;
 actor uuid:=auth.uid(); refreshed jsonb; period_state text;
BEGIN
 SELECT * INTO request FROM floor_private.staff_salary_adjustment_requests_v1 WHERE id=p_request_id;
 IF NOT FOUND OR actor IS NULL OR NOT(public.has_role(actor,'super_admin'::public.app_role)
  OR EXISTS(SELECT 1 FROM public.clubs WHERE id=request.club_id AND owner_id=actor)) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';END IF;
 PERFORM floor_private.staff_salary_period_lock_v1(request.club_id,request.period_year,request.period_month);
 SELECT status INTO period_state FROM public.staff_salary_periods WHERE club_id=request.club_id AND period_year=request.period_year AND period_month=request.period_month FOR UPDATE;
 SELECT * INTO base FROM public.staff_salary_runs WHERE id=request.base_run_id FOR UPDATE;
 SELECT * INTO request FROM floor_private.staff_salary_adjustment_requests_v1 WHERE id=p_request_id FOR UPDATE;
 IF NOT(public.has_role(actor,'super_admin'::public.app_role) OR EXISTS(SELECT 1 FROM public.clubs WHERE id=request.club_id AND owner_id=actor)) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';END IF;
 IF request.state='approved' AND request.child_run_id IS NOT NULL THEN
  RETURN jsonb_build_object('status','approved','idempotent',true,'request_id',request.id,'run_id',request.child_run_id,'base_run_id',request.base_run_id,'amount_vnd',request.amount_vnd);END IF;
 IF request.state<>'pending' THEN RETURN jsonb_build_object('error','STALE_SALARY_ADJUSTMENT','detail','Đề nghị điều chỉnh đã thay đổi. Tải lại bảng lương trước khi duyệt.');END IF;
 IF period_state IS DISTINCT FROM 'approved' OR base.status NOT IN('locked','paid') THEN
  RETURN jsonb_build_object('error','NOT_APPROVED','detail','Bản lương gốc chưa được duyệt hoặc không còn hiệu lực.');END IF;
 refreshed:=floor_private.refresh_staff_salary_adjustment_v1(base.id);
 IF refreshed->>'status' IS DISTINCT FROM 'pending' OR refreshed->>'request_id' IS DISTINCT FROM request.id::text THEN
  RETURN jsonb_build_object('error','STALE_SALARY_ADJUSTMENT','detail','Nguồn ca hoặc đề nghị điều chỉnh đã thay đổi. Tải lại để đối chiếu.','current_request_id',refreshed->>'request_id');END IF;
 UPDATE floor_private.staff_salary_adjustment_requests_v1 SET state='approved',approved_at=now(),approved_by=actor WHERE id=request.id;
 INSERT INTO public.staff_salary_runs(id,club_id,staff_id,period_year,period_month,employment_type,worked_days,gross_vnd,manual_bhxh_vnd,manual_tax_vnd,net_vnd,status,locked_by,adjusts_id,note)
 VALUES(request.id,base.club_id,base.staff_id,base.period_year,base.period_month,'full_time',0,request.gross_delta_vnd,0,0,request.amount_vnd,'locked',actor,base.id,'Bổ sung lương đã được chủ CLB duyệt riêng');
 UPDATE floor_private.staff_salary_adjustment_requests_v1 SET child_run_id=request.id WHERE id=request.id;
 RETURN jsonb_build_object('status','approved','idempotent',false,'request_id',request.id,'run_id',request.id,'base_run_id',base.id,'amount_vnd',request.amount_vnd);
END $approve$;
REVOKE ALL ON FUNCTION public.approve_staff_salary_adjustment_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_staff_salary_adjustment_v1(uuid) TO authenticated;

-- Existing payment/report child scope: protect idempotent reads too; legacy base behavior retained.
CREATE OR REPLACE FUNCTION public.mark_staff_salary_paid(p_run_id uuid, p_payment_method text DEFAULT NULL::text, p_payment_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_run record;
  v_reference text := nullif(btrim(p_payment_reference),'');
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_run from public.staff_salary_runs where id = p_run_id;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  IF v_run.adjusts_id IS NOT NULL AND NOT floor_private.staff_salary_adjustment_operator_v1(v_uid,v_run.club_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';END IF;
  if not public._staff_salary_authorised(v_uid, v_run.club_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  PERFORM floor_private.staff_salary_period_lock_v1(v_run.club_id,v_run.period_year,v_run.period_month);
  -- Consistent lock order: month, period header, run. Re-read after waiting.
  PERFORM 1 FROM public.staff_salary_periods WHERE club_id=v_run.club_id AND period_year=v_run.period_year AND period_month=v_run.period_month FOR UPDATE;
  SELECT * INTO v_run FROM public.staff_salary_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND');END IF;
  IF NOT public._staff_salary_authorised(v_uid,v_run.club_id) THEN RAISE EXCEPTION 'forbidden' USING errcode='42501';END IF;
  IF v_run.adjusts_id IS NOT NULL AND NOT floor_private.staff_salary_adjustment_operator_v1(v_uid,v_run.club_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';END IF;
  -- PT monthly runs are sums of canonical daily payouts, never another payable.
  IF v_run.employment_type='part_time' THEN
    RETURN jsonb_build_object('error','PT_MONTHLY_PAYMENT_SUMMARY_ONLY','detail','Bảng tháng PT chỉ tổng hợp khoản đã trả theo ngày, không chi trả lại từ đây.');
  END IF;
  -- [S7] owner must have approved the month's report before anyone can be marked paid.
  if not exists (
    select 1 from public.staff_salary_periods p
    where p.club_id = v_run.club_id and p.period_year = v_run.period_year
      and p.period_month = v_run.period_month and p.status = 'approved'
  ) then
    return jsonb_build_object('error', 'NOT_APPROVED', 'detail', 'Chủ CLB chưa duyệt bảng lương tháng này.');
  end if;
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash','bank_transfer') THEN
    RETURN jsonb_build_object('error','INVALID_PAYMENT_METHOD','detail','Chọn tiền mặt hoặc chuyển khoản.');
  END IF;
  IF p_payment_method='bank_transfer' AND v_reference IS NULL THEN
    RETURN jsonb_build_object('error','PAYMENT_REFERENCE_REQUIRED','detail','Nhập mã tham chiếu chuyển khoản.');
  END IF;
  IF p_payment_method='cash' AND v_reference IS NOT NULL THEN
    RETURN jsonb_build_object('error','INVALID_PAYMENT_REFERENCE','detail','Khoản tiền mặt không dùng mã tham chiếu chuyển khoản.');
  END IF;
  IF v_run.status='paid' THEN
    IF v_run.payment_method IS DISTINCT FROM p_payment_method
      OR nullif(btrim(v_run.payment_reference),'') IS DISTINCT FROM v_reference THEN
      RETURN jsonb_build_object('error','PAYMENT_INTENT_CONFLICT',
        'detail','Khoản lương đã ghi chi với phương thức hoặc tham chiếu khác. Tải lại phiếu để đối chiếu.',
        'run_id',v_run.id,'payment_method',v_run.payment_method,'payment_reference',v_run.payment_reference);
    END IF;
    RETURN jsonb_build_object('status','paid','idempotent',true,'run_id',v_run.id,
      'club_id',v_run.club_id,'staff_id',v_run.staff_id,'period_year',v_run.period_year,'period_month',v_run.period_month,
      'net_vnd',v_run.net_vnd,'paid_at',v_run.paid_at,'paid_by',v_run.paid_by,
      'payment_method',v_run.payment_method,'payment_reference',v_run.payment_reference);
  END IF;
  IF v_run.status<>'locked' THEN
    RETURN jsonb_build_object('error','STALE_SALARY_RUN','run_id',p_run_id,'status',v_run.status);
  END IF;

  update public.staff_salary_runs
  set status = 'paid', paid_at = now(), paid_by = v_uid,
      payment_method = p_payment_method, payment_reference = v_reference
  where id = p_run_id and status = 'locked'
  RETURNING * INTO v_run;

  return jsonb_build_object('status','paid','idempotent',false,'run_id',v_run.id,
      'club_id',v_run.club_id,'staff_id',v_run.staff_id,'period_year',v_run.period_year,'period_month',v_run.period_month,
      'net_vnd',v_run.net_vnd,'paid_at',v_run.paid_at,'paid_by',v_run.paid_by,
      'payment_method',v_run.payment_method,'payment_reference',v_run.payment_reference);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_staff_salary_report(p_club_id uuid, p_year integer, p_month integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_hdr jsonb;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if not public._staff_salary_authorised(v_uid, p_club_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  IF NOT floor_private.staff_salary_adjustment_operator_v1(v_uid,p_club_id) AND EXISTS(SELECT 1 FROM public.staff_salary_runs WHERE club_id=p_club_id AND period_year=p_year AND period_month=p_month AND adjusts_id IS NOT NULL AND status<>'voided') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';END IF;

  select to_jsonb(p) into v_hdr from public.staff_salary_periods p
  where p.club_id = p_club_id and p.period_year = p_year and p.period_month = p_month;

  return jsonb_build_object(
    'club_id', p_club_id, 'period_year', p_year, 'period_month', p_month,
    'header', coalesce(v_hdr, jsonb_build_object('status', 'prepared')),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'staff_id', r.staff_id, 'employment_type', r.employment_type, 'adjusts_id',r.adjusts_id,
               'worked_days', r.worked_days, 'worked_minutes', r.worked_minutes,
               'gross_vnd', r.gross_vnd, 'manual_bhxh_vnd', r.manual_bhxh_vnd,
               'manual_tax_vnd', r.manual_tax_vnd, 'net_vnd', r.net_vnd,
               'status', r.status, 'full_name', s.full_name, 'department', s.department,
               'paid_at', CASE WHEN r.status='paid' THEN r.paid_at END,
               'payment_method', CASE WHEN r.status='paid' THEN r.payment_method END,
               'payment_reference', CASE WHEN r.status='paid' THEN r.payment_reference END
             ) order by s.employment_type, s.full_name)
      from public.staff_salary_runs r join public.staff s on s.id = r.staff_id
      where r.club_id = p_club_id and r.period_year = p_year and r.period_month = p_month and r.status <> 'voided'
    ), '[]'::jsonb),
    'total_gross_vnd', (select coalesce(sum(gross_vnd),0) from public.staff_salary_runs
                        where club_id = p_club_id and period_year = p_year and period_month = p_month and status <> 'voided'),
    'total_net_vnd', (select coalesce(sum(net_vnd),0) from public.staff_salary_runs
                      where club_id = p_club_id and period_year = p_year and period_month = p_month and status <> 'voided')
  );
end;
$function$
;





DO $index_guard$ BEGIN IF md5(pg_get_indexdef('public.uq_staff_salary_base_month_v1'::regclass))<>'46a6729541a15917545fc7e3f3d8b50b' THEN RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_INDEX_DRIFT:public.uq_staff_salary_base_month_v1';END IF;END $index_guard$;

DO $index_guard$ BEGIN IF md5(pg_get_indexdef('floor_private.staff_salary_adjustment_one_pending_v1'::regclass))<>'f45e1f392e39a19ca8512163d263b45a' THEN RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_INDEX_DRIFT:floor_private.staff_salary_adjustment_one_pending_v1';END IF;END $index_guard$;

DO $index_guard$ BEGIN IF md5(pg_get_indexdef('floor_private.staff_salary_adjustment_scope_v1'::regclass))<>'3c4c768bacf1e5ba8cb7aad2c0e53e77' THEN RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_INDEX_DRIFT:floor_private.staff_salary_adjustment_scope_v1';END IF;END $index_guard$;

DO $constraint_guard$ BEGIN IF (SELECT md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid='floor_private.staff_salary_adjustment_requests_v1'::regclass AND conname='staff_salary_adjustment_gross_nonnegative_v1') IS DISTINCT FROM '878471cebcfd25ab237c22041305d284' THEN RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_CONSTRAINT_DRIFT';END IF;END $constraint_guard$;
