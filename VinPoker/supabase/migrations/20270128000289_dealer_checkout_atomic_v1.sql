-- CLI generated 20261025012058, reserved289 after source/catalog288.
-- LOCAL candidate only. No historical migration edits or ledger replay.
-- Recovery: suspend EXECUTE on the new RPCs; retain receipts/audit, never
-- delete committed payroll facts or revive the old partially-writing path.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF to_regclass('private.dealer_checkout_receipts_v1') IS NOT NULL
  OR to_regprocedure('public.operator_checkout_dealer_attendance_v1(uuid,uuid)') IS NOT NULL
  OR to_regprocedure('public.get_dealer_checkout_receipt_v1(uuid,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'dealer_checkout289_catalog_collision';END IF;
 IF md5(pg_get_functiondef('public.transition_dealer_state(uuid,text,text)'::regprocedure))<>'88dfc4a867ba190076dcef500aa95125'
  OR md5(pg_get_functiondef('public.is_club_dealer_control(uuid,uuid)'::regprocedure))<>'3186459824aedc075cda311b80bf97ad' THEN
  RAISE EXCEPTION 'dealer_checkout289_dependency_drift';END IF;
END $$;

CREATE TABLE private.dealer_checkout_receipts_v1(
 attendance_id uuid PRIMARY KEY REFERENCES public.dealer_attendance(id),
 club_id uuid NOT NULL REFERENCES public.clubs(id),
 actor_id uuid NOT NULL,
 result jsonb NOT NULL,
 attendance_facts jsonb NOT NULL CHECK(jsonb_typeof(attendance_facts)='array'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.dealer_checkout_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.dealer_checkout_receipts_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_dealer_checkout_receipt_v1(p_actor_id uuid,p_attendance_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
DECLARE club uuid;headers jsonb;att public.dealer_attendance;receipt jsonb;facts jsonb;
BEGIN
 headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
 IF auth.role() IS DISTINCT FROM 'service_role' OR headers->>'x-vinpoker-dealer-intent' IS DISTINCT FROM 'manual'
  OR headers->>'x-vinpoker-dealer-actor' IS DISTINCT FROM p_actor_id::text OR p_actor_id IS NULL THEN
  RAISE EXCEPTION 'DEALER_CHECKOUT_FORBIDDEN' USING ERRCODE='42501';END IF;
 SELECT d.club_id INTO club FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE a.id=p_attendance_id;
 IF NOT FOUND OR NOT public.is_club_dealer_control(p_actor_id,club) THEN RAISE EXCEPTION 'DEALER_CHECKOUT_FORBIDDEN' USING ERRCODE='42501';END IF;
 SELECT r.result,r.attendance_facts INTO receipt,facts FROM private.dealer_checkout_receipts_v1 r WHERE r.attendance_id=p_attendance_id AND r.club_id=club;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','receipt_not_found');END IF;
 SELECT * INTO att FROM public.dealer_attendance a WHERE a.id=p_attendance_id;
 IF facts IS DISTINCT FROM jsonb_build_array(att.dealer_id,att.status,att.current_state,att.check_in_time,att.check_out_time,
   att.total_worked_minutes_today,att.overtime_minutes,att.pre_assigned_table_id,att.pre_assigned_at)
  OR EXISTS(SELECT 1 FROM public.dealer_assignments a WHERE a.released_at IS NULL AND
   ((a.attendance_id=p_attendance_id AND a.status IN('assigned','on_break','pre_assigned','reserved'))
   OR (a.pre_assigned_attendance_id=p_attendance_id AND a.status='assigned'))) THEN
  RAISE EXCEPTION 'DEALER_CHECKOUT_RECEIPT_STATE_CHANGED' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('status','receipt_found','result',receipt);
END $$;

CREATE FUNCTION public.operator_checkout_dealer_attendance_v1(p_actor_id uuid,p_attendance_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
 club uuid;headers jsonb;att public.dealer_attendance;dealer public.dealers;
 ids uuid[];current_ids uuid[];released_ids uuid[];cleared_ids uuid[];receipt jsonb;facts jsonb;transition jsonb;result jsonb;
 ended timestamptz;worked integer;break_minutes integer;total_minutes integer;was_pre boolean;pre_table text;
 replacement record;replacement_count integer;
BEGIN
 headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
 IF auth.role() IS DISTINCT FROM 'service_role' OR headers->>'x-vinpoker-dealer-intent' IS DISTINCT FROM 'manual'
  OR headers->>'x-vinpoker-dealer-actor' IS DISTINCT FROM p_actor_id::text OR p_actor_id IS NULL THEN
  RAISE EXCEPTION 'DEALER_CHECKOUT_FORBIDDEN' USING ERRCODE='42501';END IF;
 SELECT d.* INTO dealer FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE a.id=p_attendance_id FOR SHARE OF d;
 IF NOT FOUND THEN RAISE EXCEPTION 'DEALER_CHECKOUT_FORBIDDEN' USING ERRCODE='42501';END IF;
 club:=dealer.club_id;
 -- Lock the two existing permission sources. A revocation cannot pass between
 -- the final authorization check and commit; inactive dealers may still leave.
 PERFORM 1 FROM public.clubs c WHERE c.id=club FOR SHARE;
 PERFORM 1 FROM public.club_dealer_controls c WHERE c.club_id=club AND c.user_id=p_actor_id FOR SHARE;
 IF NOT public.is_club_dealer_control(p_actor_id,club) THEN RAISE EXCEPTION 'DEALER_CHECKOUT_FORBIDDEN' USING ERRCODE='42501';END IF;
 SELECT coalesce(array_agg(a.id ORDER BY a.id),'{}'::uuid[]) INTO ids FROM public.dealer_assignments a
 WHERE (a.attendance_id=p_attendance_id AND a.released_at IS NULL AND a.status IN('assigned','on_break','pre_assigned','reserved'))
  OR (a.pre_assigned_attendance_id=p_attendance_id AND a.released_at IS NULL AND a.status='assigned');
 IF EXISTS(SELECT 1 FROM public.dealer_assignments a LEFT JOIN public.game_tables g ON g.id=a.table_id WHERE a.id=ANY(ids)
  AND ((a.club_id IS NOT NULL AND a.club_id<>club) OR (a.table_id IS NOT NULL AND g.club_id IS DISTINCT FROM club))) THEN
  RAISE EXCEPTION 'DEALER_CHECKOUT_ASSIGNMENT_SCOPE_MISMATCH' USING ERRCODE='23514';END IF;
 -- Follow table/session -> assignment -> attendance order. If an acquisition
 -- appeared after this snapshot, fail before writing rather than lock it in
 -- reverse order or silently miss the newly-created assignment.
 PERFORM 1 FROM public.game_tables g WHERE g.id IN(SELECT a.table_id FROM public.dealer_assignments a WHERE a.id=ANY(ids)) ORDER BY g.id FOR UPDATE;
 PERFORM 1 FROM public.table_sessions s WHERE s.id IN(SELECT a.table_session_id FROM public.dealer_assignments a WHERE a.id=ANY(ids)) ORDER BY s.id FOR UPDATE;
 PERFORM 1 FROM public.dealer_assignments a WHERE a.id=ANY(ids) ORDER BY a.id FOR UPDATE;
 SELECT * INTO att FROM public.dealer_attendance a WHERE a.id=p_attendance_id FOR UPDATE;
 IF NOT FOUND OR att.dealer_id<>dealer.id OR NOT public.is_club_dealer_control(p_actor_id,club) THEN
  RAISE EXCEPTION 'DEALER_CHECKOUT_FORBIDDEN' USING ERRCODE='42501';END IF;
 SELECT coalesce(array_agg(a.id ORDER BY a.id),'{}'::uuid[]) INTO current_ids FROM public.dealer_assignments a
 WHERE (a.attendance_id=p_attendance_id AND a.released_at IS NULL AND a.status IN('assigned','on_break','pre_assigned','reserved'))
  OR (a.pre_assigned_attendance_id=p_attendance_id AND a.released_at IS NULL AND a.status='assigned');
 SELECT r.result,r.attendance_facts INTO receipt,facts FROM private.dealer_checkout_receipts_v1 r WHERE r.attendance_id=p_attendance_id AND r.club_id=club;
 IF FOUND THEN
  IF facts IS DISTINCT FROM jsonb_build_array(att.dealer_id,att.status,att.current_state,att.check_in_time,att.check_out_time,
    att.total_worked_minutes_today,att.overtime_minutes,att.pre_assigned_table_id,att.pre_assigned_at)
   OR cardinality(current_ids)<>0 THEN
   RAISE EXCEPTION 'DEALER_CHECKOUT_RECEIPT_STATE_CHANGED' USING ERRCODE='23514';END IF;
  RETURN receipt||jsonb_build_object('idempotent',true);
 END IF;
 IF ids IS DISTINCT FROM current_ids THEN RAISE EXCEPTION 'DEALER_CHECKOUT_CONTEXT_CHANGED' USING ERRCODE='40001';END IF;
 IF att.status<>'checked_in' OR att.check_out_time IS NOT NULL THEN
  RETURN jsonb_build_object('success',false,'attendance_id',p_attendance_id,'code','LEGACY_CHECKOUT_REVIEW_REQUIRED');END IF;
 ended:=clock_timestamp();
 IF att.check_in_time IS NULL OR att.check_in_time>ended OR ended-att.check_in_time>=interval '24 hours' THEN
  RETURN jsonb_build_object('success',false,'attendance_id',p_attendance_id,'code','STALE_ATTENDANCE_REQUIRES_CLEANUP');END IF;
 PERFORM 1 FROM public.dealer_breaks b WHERE b.attendance_id=p_attendance_id
  OR EXISTS(SELECT 1 FROM public.dealer_assignments a WHERE a.id=b.assignment_id AND a.attendance_id=p_attendance_id) ORDER BY b.id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.dealer_breaks b WHERE (b.attendance_id=p_attendance_id
  OR EXISTS(SELECT 1 FROM public.dealer_assignments a WHERE a.id=b.assignment_id AND a.attendance_id=p_attendance_id))
  AND (b.break_start<att.check_in_time OR b.break_start>ended OR coalesce(b.break_end,ended)<b.break_start OR coalesce(b.break_end,ended)>ended)) THEN
  RAISE EXCEPTION 'DEALER_CHECKOUT_BREAK_REVIEW_REQUIRED' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(round(extract(epoch FROM(coalesce(b.break_end,ended)-b.break_start))/60)),0)::integer INTO break_minutes
 FROM public.dealer_breaks b WHERE b.attendance_id=p_attendance_id
  OR EXISTS(SELECT 1 FROM public.dealer_assignments a WHERE a.id=b.assignment_id AND a.attendance_id=p_attendance_id);
 total_minutes:=round(extract(epoch FROM(ended-att.check_in_time))/60)::integer;
 worked:=total_minutes-break_minutes;
 IF worked<0 THEN RAISE EXCEPTION 'DEALER_CHECKOUT_BREAK_REVIEW_REQUIRED' USING ERRCODE='23514';END IF;
 was_pre:=att.current_state='pre_assigned';
 SELECT g.table_name INTO pre_table FROM public.game_tables g WHERE g.id=att.pre_assigned_table_id;
 SELECT count(*) INTO replacement_count FROM public.dealer_assignments a WHERE a.id=ANY(ids) AND a.attendance_id=p_attendance_id AND a.status='assigned';
 SELECT a.id,a.table_id,a.table_session_id INTO replacement FROM public.dealer_assignments a JOIN public.table_sessions s ON s.id=a.table_session_id
 WHERE replacement_count=1 AND a.id=ANY(ids) AND a.attendance_id=p_attendance_id AND a.status='assigned'
  AND a.table_id=s.game_table_id AND s.club_id=club AND s.closed_at IS NULL;
 transition:=public.transition_dealer_state(p_attendance_id,'checked_out','dealer_checkout');
 IF transition->'ok' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'DEALER_CHECKOUT_TRANSITION_FAILED';END IF;
 UPDATE public.dealer_breaks b SET break_end=ended WHERE b.break_end IS NULL AND (b.attendance_id=p_attendance_id
  OR EXISTS(SELECT 1 FROM public.dealer_assignments a WHERE a.id=b.assignment_id AND a.attendance_id=p_attendance_id));
 WITH cleared AS(UPDATE public.dealer_assignments a SET pre_assigned_attendance_id=NULL,pre_assigned_at=NULL
 WHERE a.id=ANY(ids) AND a.pre_assigned_attendance_id=p_attendance_id RETURNING a.id)
 SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO cleared_ids FROM cleared;
 WITH released AS(UPDATE public.dealer_assignments a SET released_at=ended,status='completed',needs_replacement=true,
  pre_assigned_attendance_id=NULL,pre_assigned_at=NULL,release_reason='dealer_checkout',updated_at=ended
 WHERE a.id=ANY(ids) AND a.attendance_id=p_attendance_id AND a.released_at IS NULL RETURNING a.id)
 SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO released_ids FROM released;
 UPDATE public.dealer_attendance SET status='checked_out',check_out_time=ended,pre_assigned_table_id=NULL,pre_assigned_at=NULL,
  overtime_minutes=greatest(0,worked-480),worked_minutes_since_last_break=0,total_worked_minutes_today=worked WHERE id=p_attendance_id;
 result:=jsonb_build_object('success',true,'core_version',1,'attendance_id',p_attendance_id,'club_id',club,'dealer_name',dealer.full_name,
  'check_in_time',att.check_in_time,'check_out_time',ended,'total_hours',round(worked::numeric/6)/10,
  'released_pre_assigned',was_pre,'pre_assigned_table',pre_table,'replacement_table_id',replacement.table_id,
  'replacement_session_id',replacement.table_session_id,'replacement_assignment_id',replacement.id,
  'released_assignment_ids',released_ids,'cleared_preassignment_assignment_ids',cleared_ids,'idempotent',false);
 INSERT INTO public.audit_logs(club_id,actor_id,action,entity_type,entity_id,payload)
 VALUES(club,p_actor_id,'checkout_dealer','dealer_attendance',p_attendance_id,jsonb_build_object('core_version',1,
  'worked_minutes',worked,'overtime_minutes',greatest(0,worked-480),'released_assignment_ids',released_ids,
  'cleared_preassignment_assignment_ids',cleared_ids,'released_pre_assigned',was_pre));
 INSERT INTO private.dealer_checkout_receipts_v1(attendance_id,club_id,actor_id,result,attendance_facts)
 SELECT p_attendance_id,club,p_actor_id,result,jsonb_build_array(a.dealer_id,a.status,a.current_state,a.check_in_time,a.check_out_time,
  a.total_worked_minutes_today,a.overtime_minutes,a.pre_assigned_table_id,a.pre_assigned_at)
 FROM public.dealer_attendance a WHERE a.id=p_attendance_id;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.operator_checkout_dealer_attendance_v1(uuid,uuid),public.get_dealer_checkout_receipt_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.operator_checkout_dealer_attendance_v1(uuid,uuid),public.get_dealer_checkout_receipt_v1(uuid,uuid) TO service_role;
COMMIT;
