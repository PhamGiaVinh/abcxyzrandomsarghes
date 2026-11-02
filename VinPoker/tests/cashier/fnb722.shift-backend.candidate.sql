-- Candidate only: primary DB permits rollback qualification only; separately stamped owned clone
-- permits explicit723 installation for cross-session visibility. No hosted target is accepted.
-- No archive replay or historical recognition backfill. Shift membership is not a money ledger.
DO $$ BEGIN
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (current_database()='vinpoker_ops_cash115_qualified_c' AND current_setting('test.fnb722_rollback',true)='on')
  OR (current_database()='vinpoker_fnb719_gate_local' AND current_setting('test.fnb723_clone',true)='on'
   AND (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())=
    'VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
 ASSERT to_regclass('public.fnb_cashier_shifts') IS NULL;
 ASSERT to_regprocedure('floor_private.fnb_cash_event_gate_v1(uuid)') IS NOT NULL;
END $$;

CREATE TABLE public.fnb_cashier_shifts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid NOT NULL REFERENCES public.clubs(id),
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','closed')),
 opened_by uuid NOT NULL, opened_at timestamptz NOT NULL,
 closed_by uuid, closed_at timestamptz,
 opening_float_vnd bigint NOT NULL CHECK(opening_float_vnd>=0),
 expected_cash_vnd bigint, counted_cash_vnd bigint CHECK(counted_cash_vnd>=0), variance_vnd bigint,
 note text, client_request_id text NOT NULL, frozen_report jsonb,
 CHECK((status='open' AND closed_by IS NULL AND closed_at IS NULL AND frozen_report IS NULL
        AND expected_cash_vnd IS NULL AND counted_cash_vnd IS NULL AND variance_vnd IS NULL)
    OR (status='closed' AND closed_by IS NOT NULL AND closed_at IS NOT NULL AND frozen_report IS NOT NULL
        AND expected_cash_vnd IS NOT NULL AND counted_cash_vnd IS NOT NULL AND variance_vnd IS NOT NULL))
);
CREATE UNIQUE INDEX fnb_shift_one_open_v1 ON public.fnb_cashier_shifts(club_id) WHERE status='open';
CREATE INDEX fnb_shift_club_recent_v1 ON public.fnb_cashier_shifts(club_id,opened_at DESC);
ALTER TABLE public.fnb_cashier_shifts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fnb_cashier_shifts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.fnb_cashier_shifts TO authenticated;
CREATE POLICY fnb_shift_read_v1 ON public.fnb_cashier_shifts FOR SELECT TO authenticated
 USING(public.is_club_fnb((SELECT auth.uid()),club_id) OR public.is_club_owner((SELECT auth.uid()),club_id));

-- Only recognition links; no amount balance or financial authority duplicated here.
-- NULL shift records the established no-open-shift gap rather than assigning it retrospectively.
CREATE TABLE floor_private.fnb_shift_order_events722 (
 order_id uuid NOT NULL REFERENCES public.fnb_orders(id), kind text NOT NULL CHECK(kind IN('sale','refund')),
 shift_id uuid REFERENCES public.fnb_cashier_shifts(id), at timestamptz NOT NULL,
 PRIMARY KEY(order_id,kind)
);
CREATE INDEX fnb_shift_events722_shift ON floor_private.fnb_shift_order_events722(shift_id);
CREATE TABLE floor_private.fnb_shift_intents722 (
 actor uuid NOT NULL, request_id text NOT NULL, payload jsonb NOT NULL, response jsonb NOT NULL,
 PRIMARY KEY(actor,request_id)
);
ALTER TABLE floor_private.fnb_shift_order_events722 ENABLE ROW LEVEL SECURITY;
ALTER TABLE floor_private.fnb_shift_intents722 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.fnb_shift_order_events722,floor_private.fnb_shift_intents722 FROM PUBLIC,anon,authenticated,service_role;

-- Comp is the remaining writer that sets paid_at. Club gate precedes create-intent/order/ingredient locks.
DO $$ DECLARE body text;old_proc record;new_proc record;anchor text;BEGIN
 SELECT * INTO STRICT old_proc FROM pg_proc WHERE oid='public.fnb_create_comp_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,text)'::regprocedure;
 body:=pg_get_functiondef(old_proc.oid);
 ASSERT md5(body)='53b74527ffe2f57df8b82ed6dc8e53b3','comp writer drift';
 anchor:='v_crid := COALESCE(NULLIF(btrim(p_client_request_id), ''''), gen_random_uuid()::text);';
 ASSERT (length(body)-length(replace(body,anchor,'')))/length(anchor)=1;
 body:=replace(body,anchor,'PERFORM floor_private.fnb_cash_event_gate_v1(p_club_id);'||chr(10)||'  '||anchor);
 anchor:='paid_at          = now()';
 ASSERT (length(body)-length(replace(body,anchor,'')))/length(anchor)=1;
 body:=replace(body,anchor,'paid_at          = clock_timestamp()');
 EXECUTE body;
 SELECT * INTO STRICT new_proc FROM pg_proc WHERE oid=old_proc.oid;
 ASSERT old_proc.proowner=new_proc.proowner AND old_proc.proacl IS NOT DISTINCT FROM new_proc.proacl
  AND old_proc.proconfig IS NOT DISTINCT FROM new_proc.proconfig AND old_proc.prosecdef=new_proc.prosecdef;
END $$;

CREATE FUNCTION floor_private.fnb_capture_shift_event722() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE leg text;stamp timestamptz;gate bigint;assigned uuid;BEGIN
 IF TG_OP='UPDATE' AND OLD.paid_at IS NOT NULL AND
  ROW(NEW.club_id,NEW.paid_at,NEW.subtotal_vnd,NEW.cogs_vnd,NEW.payment_method,NEW.is_comp)
   IS DISTINCT FROM ROW(OLD.club_id,OLD.paid_at,OLD.subtotal_vnd,OLD.cogs_vnd,OLD.payment_method,OLD.is_comp) THEN
  RAISE EXCEPTION 'FNB_PAID_ORDER_IMMUTABLE';
 END IF;
 IF NEW.paid_at IS NOT NULL AND OLD.paid_at IS NULL THEN leg:='sale';stamp:=NEW.paid_at;
 ELSIF NEW.status='cancelled' AND OLD.status<>'cancelled' AND NEW.paid_at IS NOT NULL THEN
  leg:='refund';stamp:=NEW.cancelled_at;
 ELSE RETURN NEW;END IF;
 -- A snapshot taken before gate admission must not see a superseded open shift.
 -- Default PostgREST write transactions are READ COMMITTED; reject stale RR snapshots atomically.
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'FNB_SHIFT_READ_COMMITTED_REQUIRED' USING ERRCODE='40001';
 END IF;
 -- Do not acquire a club lock after the order row lock. Reject a new writer bypassing admission.
 gate:=pg_catalog.hashtextextended('fnb-cash-shift:'||NEW.club_id::text,718);
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND pid=pg_catalog.pg_backend_pid()
    AND classid=((gate>>32)&4294967295)::oid AND objid=(gate&4294967295)::oid AND objsubid=1 AND granted) THEN
  RAISE EXCEPTION 'FNB_SHIFT_GATE_REQUIRED';
 END IF;
 SELECT id INTO assigned FROM public.fnb_cashier_shifts WHERE club_id=NEW.club_id AND status='open';
 INSERT INTO floor_private.fnb_shift_order_events722(order_id,kind,shift_id,at) VALUES(NEW.id,leg,assigned,stamp);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION floor_private.fnb_capture_shift_event722() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER fnb_shift_event722 AFTER INSERT OR UPDATE ON public.fnb_orders
 FOR EACH ROW EXECUTE FUNCTION floor_private.fnb_capture_shift_event722();

CREATE FUNCTION floor_private.fnb_frozen_shift_guard722() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status='closed' THEN RAISE EXCEPTION 'FNB_SHIFT_IMMUTABLE';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION floor_private.fnb_frozen_shift_guard722() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER fnb_shift_frozen722 BEFORE UPDATE OR DELETE ON public.fnb_cashier_shifts
 FOR EACH ROW EXECUTE FUNCTION floor_private.fnb_frozen_shift_guard722();

CREATE FUNCTION floor_private.fnb_shift_totals722(p_shift uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH rows AS (
  SELECT o.id,e.at,e.kind,CASE WHEN e.kind='sale' THEN o.subtotal_vnd ELSE -o.subtotal_vnd END amount_vnd,
   o.is_comp,o.payment_method::text payment_method,o.status::text status,o.table_label,o.customer_name
  FROM floor_private.fnb_shift_order_events722 e JOIN public.fnb_orders o ON o.id=e.order_id
  WHERE e.shift_id=p_shift AND (e.kind='sale' OR NOT o.is_comp)
 )
 SELECT jsonb_build_object(
  'sales_vnd',COALESCE(sum(amount_vnd) FILTER(WHERE kind='sale' AND NOT is_comp AND payment_method='cash'),0),
  'refunds_vnd',COALESCE(-sum(amount_vnd) FILTER(WHERE kind='refund' AND NOT is_comp AND payment_method='cash'),0),
  'bank_paid_vnd',COALESCE(sum(amount_vnd) FILTER(WHERE kind='sale' AND NOT is_comp AND payment_method='bank_transfer'),0),
  'comp_count',count(*) FILTER(WHERE kind='sale' AND is_comp),
  'orders',COALESCE(jsonb_agg(to_jsonb(rows) ORDER BY at,id,kind),'[]'::jsonb)) FROM rows;
$$;
REVOKE ALL ON FUNCTION floor_private.fnb_shift_totals722(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fnb_open_shift(p_club_id uuid,p_opening_float_vnd bigint DEFAULT 0,p_client_request_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
<<shift_open>>
DECLARE actor uuid:=auth.uid();payload jsonb;receipt record;existing public.fnb_cashier_shifts%ROWTYPE;answer jsonb;BEGIN
 IF actor IS NULL THEN RETURN jsonb_build_object('error','Unauthorized');END IF;
 IF NOT(public.is_club_fnb_kind(actor,p_club_id,'cashier') OR public.is_club_owner(actor,p_club_id)) THEN RETURN jsonb_build_object('error','Forbidden');END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'FNB_SHIFT_READ_COMMITTED_REQUIRED' USING ERRCODE='40001';END IF;
 IF p_opening_float_vnd IS NULL OR p_opening_float_vnd<0 OR p_client_request_id IS NULL
  OR length(btrim(p_client_request_id)) NOT BETWEEN 1 AND 200 THEN RETURN jsonb_build_object('error','INVALID_INPUT');END IF;
 payload:=jsonb_build_object('operation','open','club',p_club_id,'float',p_opening_float_vnd);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fnb-shift-intent:'||actor||':'||p_client_request_id,722));
 PERFORM floor_private.fnb_cash_event_gate_v1(p_club_id);
 SELECT * INTO receipt FROM floor_private.fnb_shift_intents722 i WHERE i.actor=shift_open.actor AND i.request_id=p_client_request_id;
 IF FOUND THEN
  IF receipt.payload<>payload THEN RETURN jsonb_build_object('error','REQUEST_ID_CONFLICT');END IF;
  RETURN receipt.response;
 END IF;
 SELECT * INTO existing FROM public.fnb_cashier_shifts WHERE club_id=p_club_id AND status='open';
 IF FOUND THEN answer:=jsonb_build_object('status','ok','shift_id',existing.id,'already_open',true,'opening_float_vnd',existing.opening_float_vnd);
 ELSE
  INSERT INTO public.fnb_cashier_shifts(club_id,opened_by,opened_at,opening_float_vnd,client_request_id)
   VALUES(p_club_id,actor,clock_timestamp(),p_opening_float_vnd,p_client_request_id) RETURNING * INTO existing;
  answer:=jsonb_build_object('status','ok','shift_id',existing.id,'already_open',false,'opening_float_vnd',existing.opening_float_vnd);
 END IF;
 INSERT INTO floor_private.fnb_shift_intents722 VALUES(actor,p_client_request_id,payload,answer);
 RETURN answer;
END $$;

CREATE FUNCTION public.fnb_close_shift(p_shift_id uuid,p_counted_cash_vnd bigint,p_note text DEFAULT NULL,p_client_request_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
<<shift_close>>
DECLARE actor uuid:=auth.uid();club uuid;payload jsonb;receipt record;existing public.fnb_cashier_shifts%ROWTYPE;
 totals jsonb;expected bigint;variance bigint;answer jsonb;BEGIN
 IF actor IS NULL THEN RETURN jsonb_build_object('error','Unauthorized');END IF;
 SELECT club_id INTO club FROM public.fnb_cashier_shifts WHERE id=p_shift_id;
 IF club IS NULL THEN RETURN jsonb_build_object('error','SHIFT_NOT_FOUND');END IF;
 IF NOT(public.is_club_fnb_kind(actor,club,'cashier') OR public.is_club_owner(actor,club)) THEN RETURN jsonb_build_object('error','Forbidden');END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'FNB_SHIFT_READ_COMMITTED_REQUIRED' USING ERRCODE='40001';END IF;
 IF p_counted_cash_vnd IS NULL OR p_counted_cash_vnd<0 OR p_client_request_id IS NULL
  OR length(btrim(p_client_request_id)) NOT BETWEEN 1 AND 200 THEN RETURN jsonb_build_object('error','INVALID_INPUT');END IF;
 payload:=jsonb_build_object('operation','close','shift',p_shift_id,'counted',p_counted_cash_vnd,'note',p_note);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fnb-shift-intent:'||actor||':'||p_client_request_id,722));
 PERFORM floor_private.fnb_cash_event_gate_v1(club);
 SELECT * INTO receipt FROM floor_private.fnb_shift_intents722 i WHERE i.actor=shift_close.actor AND i.request_id=p_client_request_id;
 IF FOUND THEN
  IF receipt.payload<>payload THEN RETURN jsonb_build_object('error','REQUEST_ID_CONFLICT');END IF;
  RETURN receipt.response;
 END IF;
 SELECT * INTO STRICT existing FROM public.fnb_cashier_shifts WHERE id=p_shift_id FOR UPDATE;
 IF existing.status='closed' THEN RETURN jsonb_build_object('error','SHIFT_ALREADY_CLOSED');END IF;
 totals:=floor_private.fnb_shift_totals722(p_shift_id);
 expected:=(totals->>'sales_vnd')::bigint-(totals->>'refunds_vnd')::bigint;
 variance:=p_counted_cash_vnd-(existing.opening_float_vnd+expected);
 UPDATE public.fnb_cashier_shifts SET status='closed',closed_by=actor,closed_at=clock_timestamp(),
  expected_cash_vnd=expected,counted_cash_vnd=p_counted_cash_vnd,variance_vnd=variance,note=p_note,frozen_report=totals WHERE id=p_shift_id;
 answer:=totals||jsonb_build_object('status','ok','shift_id',p_shift_id,'opening_float_vnd',existing.opening_float_vnd,
  'expected_cash_vnd',expected,'counted_cash_vnd',p_counted_cash_vnd,'variance_vnd',variance);
 INSERT INTO floor_private.fnb_shift_intents722 VALUES(actor,p_client_request_id,payload,answer);
 RETURN answer;
END $$;

CREATE FUNCTION public.fnb_get_shift_report(p_shift_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();existing public.fnb_cashier_shifts%ROWTYPE;totals jsonb;expected bigint;BEGIN
 IF actor IS NULL THEN RETURN jsonb_build_object('error','Unauthorized');END IF;
 SELECT * INTO existing FROM public.fnb_cashier_shifts WHERE id=p_shift_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','SHIFT_NOT_FOUND');END IF;
 IF NOT(public.is_club_fnb(actor,existing.club_id) OR public.is_club_owner(actor,existing.club_id)) THEN RETURN jsonb_build_object('error','Forbidden');END IF;
 IF existing.status='closed' THEN totals:=existing.frozen_report;ELSE totals:=floor_private.fnb_shift_totals722(p_shift_id);END IF;
 expected:=(totals->>'sales_vnd')::bigint-(totals->>'refunds_vnd')::bigint;
 RETURN totals||jsonb_build_object('status','ok','shift',to_jsonb(existing)-'frozen_report',
  'expected_cash_vnd',expected,'expected_drawer_vnd',existing.opening_float_vnd+expected);
END $$;
REVOKE ALL ON FUNCTION public.fnb_open_shift(uuid,bigint,text),public.fnb_close_shift(uuid,bigint,text,text),public.fnb_get_shift_report(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fnb_open_shift(uuid,bigint,text),public.fnb_close_shift(uuid,bigint,text,text),public.fnb_get_shift_report(uuid) TO authenticated;
