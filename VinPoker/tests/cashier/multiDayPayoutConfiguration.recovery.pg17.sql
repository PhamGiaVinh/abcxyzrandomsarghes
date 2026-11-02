-- Exact inverse of unretained216 candidate. No data deletion or ledger change.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $$
DECLARE definition text;
BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='private.multi_day_payout_evaluate_v2(uuid,jsonb)'::regprocedure)
      IS DISTINCT FROM 'a75c2bfc3d7bf05d5ee05d830bda38dc'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.multi_day_payout_configuration_preview_v1(uuid,jsonb)'::regprocedure)
      IS DISTINCT FROM '7610ff472c03e70f3bd170ce0b71afd4'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='private.multi_day_payout_unverified_v1(uuid)'::regprocedure)
      IS DISTINCT FROM 'ccf4e0f886a5356e981ef4a33e40f0ab'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.multi_day_payout_preview_v1(uuid)'::regprocedure)
      IS DISTINCT FROM '391d3632fea66c8b276a478b2d8a168c' THEN
   RAISE EXCEPTION 'multiday216_recovery_drift';
 END IF;
 definition:=replace(pg_get_functiondef('private.multi_day_payout_evaluate_v2(uuid,jsonb)'::regprocedure),chr(13),'');
 definition:=replace(definition,'FUNCTION private.multi_day_payout_evaluate_v2(p_event_id uuid, p_proposed_rows jsonb)',
   'FUNCTION private.multi_day_payout_unverified_v1(p_event_id uuid)');
 definition:=replace(definition,'private.multi_day_payout_prize_rows_v1(v_rules.final_tournament_id,p_proposed_rows) q','public.tournament_prizes q');
 definition:=replace(definition,'count(q.position)','count(q.id)');
 definition:=replace(definition,'IF p_proposed_rows IS NULL THEN PERFORM private.multi_day_payout_validate_positions_v1(v_rules.final_tournament_id); END IF;',
   'PERFORM private.multi_day_payout_validate_positions_v1(v_rules.final_tournament_id);');
 EXECUTE definition;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='private.multi_day_payout_unverified_v1(uuid)'::regprocedure)
    IS DISTINCT FROM '156dffd08c53e36f216d1240af5cf56f' THEN
   RAISE EXCEPTION 'multiday216_original_body_not_restored';
 END IF;
END $$;
DROP FUNCTION public.multi_day_payout_configuration_preview_v1(uuid,jsonb);
DROP FUNCTION private.multi_day_payout_evaluate_v2(uuid,jsonb);
DROP FUNCTION private.multi_day_payout_prize_rows_v1(uuid,jsonb);
COMMIT;
