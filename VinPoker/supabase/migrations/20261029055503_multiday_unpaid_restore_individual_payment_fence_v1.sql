-- LOCAL GUARDED QUALIFICATION CANDIDATE ONLY; not promoted / not for db push.
-- Full individual-result/payment package required. Restore only unrelated unfrozen
-- entries before global payout/official close, when every existing payment has
-- canonical immutable individual-payment proof. No payment/result rewrite.
-- Existing tournament lock serializes with rank confirmation; remaining actor,
-- session, epoch, stack, seat, chronology and receipt guards remain unchanged.
-- ROLLBACK: restore exact pre-apply function definition from verified recovery
-- clone/native-source artifact. Preserve every result, payment, receipt and audit.
DO $patch$ DECLARE target regprocedure:='floor_private.restore_busted_player_to_seat(uuid,uuid,integer,bigint,bigint,uuid,uuid)'::regprocedure;
definition text;old_acl aclitem[];old_config text[];old_owner oid;
BEGIN
IF to_regprocedure('private.is_individual_multi_day_payment_v1(public.tournament_prize_payments)') IS NULL
 OR to_regclass('private.multi_day_individual_results_v1') IS NULL
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=target) IS DISTINCT FROM '314df30e7e69b8a3d9ab1cf5babfaef5'
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=target AND prosecdef AND pg_get_userbyid(proowner)='postgres' AND proconfig=ARRAY['search_path=""'])
THEN RAISE EXCEPTION 'unpaid_restore_individual_dependency_drift';END IF;
SELECT pg_get_functiondef(target),proacl,proconfig,proowner INTO definition,old_acl,old_config,old_owner FROM pg_proc WHERE oid=target;
IF array_length(string_to_array(definition,$anchor$IF EXISTS(SELECT 1 FROM public.tournament_close_report WHERE tournament_id=v_tournament.id)
    OR EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id=v_tournament.id) THEN$anchor$),1)<>2 THEN RAISE EXCEPTION 'unpaid_restore_individual_anchor_drift';END IF;
EXECUTE replace(definition,$anchor$IF EXISTS(SELECT 1 FROM public.tournament_close_report WHERE tournament_id=v_tournament.id)
    OR EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id=v_tournament.id) THEN$anchor$,$replacement$IF EXISTS(SELECT 1 FROM public.tournament_close_report WHERE tournament_id=v_tournament.id)
    OR EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id=v_tournament.event_id)
    OR EXISTS(SELECT 1 FROM private.multi_day_individual_results_v1 WHERE entry_id=p_entry_id)
    OR EXISTS(SELECT 1 FROM public.tournament_prize_payments payment
      WHERE payment.tournament_id=v_tournament.id
        AND (v_tournament.phase IS DISTINCT FROM 'final'
          OR NOT private.is_individual_multi_day_payment_v1(payment))) THEN$replacement$);
IF EXISTS(SELECT 1 FROM pg_proc WHERE oid=target AND (proacl IS DISTINCT FROM old_acl OR proconfig IS DISTINCT FROM old_config OR proowner IS DISTINCT FROM old_owner)) THEN RAISE EXCEPTION 'unpaid_restore_individual_metadata_drift';END IF;
END $patch$;
