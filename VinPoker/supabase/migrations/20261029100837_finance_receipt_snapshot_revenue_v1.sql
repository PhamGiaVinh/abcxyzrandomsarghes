-- Pending LOCAL candidate. Owner revenue uses accepted per-buy price snapshots,
-- never the tournament's currently editable price. Daily recognition stays on
-- event start (UTC+7 calendar wrapper / raw timestamp API unchanged).
-- Rollback: forward restore BOTH exact raw definitions in the private backup.
-- No paid registration, price snapshot, financial ledger or old close is edited.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE h record; f record; a record; helper_definition text; finance_definition text; function_oid oid;
 old_sum text:='coalesce(sum(coalesce(snap_rake,0)) FILTER(WHERE valid),0) AS rake,';
 new_sum text:=$sums$coalesce(sum(coalesce(snap_rake,0)) FILTER(WHERE valid),0) AS rake,
   coalesce(sum(coalesce(snap_rake,0)) FILTER(WHERE valid AND coalesce(reference_code,'') NOT LIKE 'CASH-%' AND coalesce(reference_code,'') NOT LIKE 'REENTRY-%'),0) AS rake_online,
   coalesce(sum(coalesce(snap_rake,0)) FILTER(WHERE valid AND reference_code LIKE 'CASH-%'),0) AS rake_offline,
   coalesce(sum(coalesce(snap_rake,0)) FILTER(WHERE valid AND reference_code LIKE 'REENTRY-%'),0) AS rake_reentry,$sums$;
 old_json text:=$key$  'serviceFee',CASE WHEN coalesce(a.unavailable_buys,0)=0 THEN coalesce(a.service,0) END,$key$;
 new_json text:=$keys$  'rakeOnline',CASE WHEN coalesce(a.unavailable_buys,0)=0 THEN coalesce(a.rake_online,0) END,
  'rakeOffline',CASE WHEN coalesce(a.unavailable_buys,0)=0 THEN coalesce(a.rake_offline,0) END,
  'rakeReentry',CASE WHEN coalesce(a.unavailable_buys,0)=0 THEN coalesce(a.rake_reentry,0) END,
  'serviceFee',CASE WHEN coalesce(a.unavailable_buys,0)=0 THEN coalesce(a.service,0) END,$keys$;
 guard_start integer; guard_end integer; reg_start integer; reg_end integer;
 guard text:=$guard$  -- Collect once through the SAME classifier used by live and buy-close.
  select coalesce(jsonb_agg(receipt), '[]'::jsonb) into v_tour_receipts
  from unnest(v_club_ids) cid
  cross join lateral jsonb_array_elements(floor_private.tour_revenue_live_source_v1(cid)->'tours') receipt;

  if exists (select 1 from jsonb_array_elements(v_tour_receipts) receipt
    join public.tournaments t on t.id=(receipt->>'tournamentId')::uuid
    where t.start_time is null and (
      (receipt->>'unavailableBuys')::bigint>0
      or (receipt->>'rake')::numeric<>0 or (receipt->>'serviceFee')::numeric<>0)) then
    raise exception 'finance_report_event_start_unavailable' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_tour_receipts) receipt
    join public.tournaments t on t.id=(receipt->>'tournamentId')::uuid
    where t.start_time between p_from and p_to and (receipt->>'unavailableBuys')::bigint>0) then
    raise exception 'finance_report_receipt_price_unavailable' using errcode='22023';
  end if;

$guard$;
 receipt_cte text:=$cte$  -- cfg_* column names remain for API compatibility; values are now the
  -- accepted receipt allocation, not a calculation from current tour config.
  rake_cfg as (
    select t.club_id,to_char(t.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM') as ym,
      (receipt->>'rakeOnline')::numeric as cfg_online,
      (receipt->>'rakeOffline')::numeric as cfg_offline,
      (receipt->>'rakeReentry')::numeric as cfg_reentry,
      (receipt->>'serviceFee')::numeric as cfg_service,
      (receipt->>'rake')::numeric as actual_sum
    from jsonb_array_elements(v_tour_receipts) receipt
    join public.tournaments t on t.id=(receipt->>'tournamentId')::uuid
    where t.club_id=any(v_club_ids) and t.start_time between p_from and p_to
  ),
$cte$;
BEGIN
 SELECT p.*,pg_get_functiondef(p.oid) AS definition INTO STRICT h FROM pg_proc p
 WHERE oid='floor_private.tour_revenue_live_source_v1(uuid)'::regprocedure;
 SELECT p.*,pg_get_functiondef(p.oid) AS definition INTO STRICT f FROM pg_proc p
 WHERE oid='public.get_club_finance_summary(timestamptz,timestamptz,uuid)'::regprocedure;
 IF current_user<>'postgres' OR md5(h.prosrc)<>'67ea8cc36824b34ef7006b9a8b36e923'
 OR md5(f.prosrc)<>'32a2a84b0179709a18c380fc4de0594c'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_owner_tour_rake_live_v1(uuid)'::regprocedure)<>'56ded9283dae799954cbc0f90914a225'
 OR pg_get_userbyid(h.proowner)<>'postgres' OR pg_get_userbyid(f.proowner)<>'postgres'
 OR has_function_privilege('authenticated',h.oid,'EXECUTE')
 OR has_function_privilege('anon',h.oid,'EXECUTE')
 OR has_function_privilege('service_role',h.oid,'EXECUTE')
 OR to_regclass('floor_private.finance_receipt_definition_backup_v1') IS NOT NULL THEN
  RAISE EXCEPTION 'finance_receipt_dependency_drift_or_collision';
 END IF;
 helper_definition:=replace(h.definition,chr(13),'');
 IF cardinality(string_to_array(helper_definition,old_sum))<>2
 OR cardinality(string_to_array(helper_definition,old_json))<>2 THEN
  RAISE EXCEPTION 'finance_receipt_helper_anchor_drift';
 END IF;
 helper_definition:=replace(replace(helper_definition,old_sum,new_sum),old_json,new_json);
 finance_definition:=replace(f.definition,chr(13),'');
 IF cardinality(string_to_array(finance_definition,'  v_result jsonb;'))<>2 THEN
  RAISE EXCEPTION 'finance_receipt_declaration_drift';END IF;
 finance_definition:=replace(finance_definition,'  v_result jsonb;',E'  v_result jsonb;\n  v_tour_receipts jsonb;');
 guard_start:=strpos(finance_definition,'  -- Event-day recognition cannot invent a date for confirmed registrations.');
 guard_end:=strpos(finance_definition,E'  with\n  acc_clubs as (');
 reg_start:=strpos(finance_definition,'  reg_src as (');
 reg_end:=strpos(finance_definition,'  -- [C] fnb_rows:');
 IF guard_start=0 OR guard_end<=guard_start OR reg_start<=guard_end OR reg_end<=reg_start THEN
  RAISE EXCEPTION 'finance_receipt_report_anchor_drift';END IF;
 finance_definition:=substr(finance_definition,1,guard_start-1)||guard
  ||substr(finance_definition,guard_end,reg_start-guard_end)||receipt_cte||substr(finance_definition,reg_end);
 CREATE TABLE floor_private.finance_receipt_definition_backup_v1(
  signature text PRIMARY KEY,definition text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
 ALTER TABLE floor_private.finance_receipt_definition_backup_v1 ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON floor_private.finance_receipt_definition_backup_v1 FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO floor_private.finance_receipt_definition_backup_v1(signature,definition)
 VALUES('floor_private.tour_revenue_live_source_v1(uuid)',h.definition),
  ('public.get_club_finance_summary(timestamptz,timestamptz,uuid)',f.definition);
 EXECUTE helper_definition;
 EXECUTE finance_definition;
 FOREACH function_oid IN ARRAY ARRAY[h.oid,f.oid] LOOP
  SELECT * INTO STRICT a FROM pg_proc WHERE oid=function_oid;
  IF a.oid=h.oid THEN
   IF a.proacl IS DISTINCT FROM h.proacl OR a.proowner<>h.proowner OR a.prosecdef IS DISTINCT FROM h.prosecdef
    OR a.provolatile IS DISTINCT FROM h.provolatile OR a.proconfig IS DISTINCT FROM h.proconfig THEN
    RAISE EXCEPTION 'finance_receipt_helper_metadata_changed';END IF;
  ELSE
   IF a.proacl IS DISTINCT FROM f.proacl OR a.proowner<>f.proowner OR a.prosecdef IS DISTINCT FROM f.prosecdef
    OR a.provolatile IS DISTINCT FROM f.provolatile OR a.proconfig IS DISTINCT FROM f.proconfig THEN
    RAISE EXCEPTION 'finance_receipt_report_metadata_changed';END IF;
  END IF;
 END LOOP;
END $patch$;
COMMIT;
