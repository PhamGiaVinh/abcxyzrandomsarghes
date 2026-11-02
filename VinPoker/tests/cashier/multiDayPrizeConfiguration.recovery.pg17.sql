-- Only before any configuration history has committed. Otherwise forward repair.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $$ DECLARE definition text;
BEGIN
 IF EXISTS(SELECT 1 FROM private.multi_day_prize_configurations_v1)
 OR EXISTS(SELECT 1 FROM private.multi_day_prize_write_intents_v1)
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='private.multi_day_legacy_payout_hold_v1()'::regprocedure)
    IS DISTINCT FROM '76130ee8af6434b4ae0f32c1a7dbdb78'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.multi_day_save_prize_configuration_v1(uuid,jsonb,text,text,text,text,text,uuid,text)'::regprocedure)
    IS DISTINCT FROM '8158f411a20d20f2c66aae6cd2bd67f3'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.multi_day_prize_configuration_receipt_v1(uuid,uuid)'::regprocedure)
    IS DISTINCT FROM '8a1526040bcad0be29b74f6c51a7d9fd' THEN
   RAISE EXCEPTION 'multiday217_recovery_requires_empty_history_and_exact_source';
 END IF;
 definition:=replace(pg_get_functiondef('private.multi_day_legacy_payout_hold_v1()'::regprocedure),chr(13),'');
 definition:=replace(definition,$branch$ IF TG_TABLE_NAME='tournament_prizes' AND TG_OP IN('INSERT','DELETE') THEN
   IF private.consume_multi_day_prize_write_intent_v1(TG_OP,CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END) THEN
     RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
   END IF;
 END IF;
$branch$,'');
 EXECUTE definition;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='private.multi_day_legacy_payout_hold_v1()'::regprocedure)
    IS DISTINCT FROM '4dd39985a1a0afca0baf122dfed216d2' THEN RAISE EXCEPTION 'multiday217_original_guard_not_restored';END IF;
END $$;
DROP FUNCTION public.multi_day_prize_configuration_receipt_v1(uuid,uuid);
DROP FUNCTION public.multi_day_save_prize_configuration_v1(uuid,jsonb,text,text,text,text,text,uuid,text);
DROP FUNCTION private.consume_multi_day_prize_write_intent_v1(text,public.tournament_prizes);
DROP TABLE private.multi_day_prize_write_intents_v1;
DROP TABLE private.multi_day_prize_configurations_v1;
COMMIT;
