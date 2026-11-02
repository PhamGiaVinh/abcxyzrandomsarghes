 -- Nested negative probe uses the existing owner-only prize configuration
 -- command; its success and rejected global finalization are rolled back.
 BEGIN
  DECLARE proposed jsonb;configuration jsonb;saved jsonb;changed jsonb;item jsonb;BEGIN
   SELECT jsonb_agg(jsonb_build_object('position',n,'amount',200000) ORDER BY n) INTO proposed FROM generate_series(1,8)n;
   configuration:=public.multi_day_payout_configuration_preview_v1(event,proposed);
   saved:=public.multi_day_save_prize_configuration_v1(event,proposed,configuration->>'configurationRevision',configuration->>'rulesVersion',
    configuration->>'fundingRevision',configuration->>'qualificationRevision',configuration->>'payoutInputHash',gen_random_uuid(),'1168 TEST negative price drift');
   ASSERT saved->>'ok'='true',saved::text;
   changed:=public.multi_day_payout_preview_v1(event);
   ASSERT (changed->>'unpaidObligationVnd')::numeric=1600000 AND changed->>'state'='READY';
   BEGIN
    PERFORM public.multi_day_finalize_payout_v1(event,changed->>'rulesVersion',changed->>'fundingRevision',changed->>'qualificationRevision',changed->>'payoutInputHash',gen_random_uuid());
    RAISE EXCEPTION 'global finalization silently repriced frozen individual obligation';
   EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'individual_obligation_global_amount_or_identity_changed' THEN RAISE;END IF;
   END;
   SELECT x INTO STRICT item FROM jsonb_array_elements(public.get_club_payout_liability_v2('2000-01-01','2100-12-31',club)->'perTournament')x WHERE x->>'tournamentId'=final::text;
   ASSERT (item->>'owed')::numeric=100000 AND item->>'isPartial'='true';
   PERFORM set_config('role','none',true);
   ASSERT (SELECT count(*)=0 FROM public.multi_day_payout_finalizations_v1 WHERE event_id=event);
   ASSERT (SELECT count(*)=1 AND sum(amount_vnd)=100000 FROM private.multi_day_individual_obligations_v1 WHERE event_id=event);
   RAISE EXCEPTION '1168_PRICE_DRIFT_CHECKED_ROLLBACK' USING ERRCODE='ZX168';
  END;
 EXCEPTION WHEN SQLSTATE 'ZX168' THEN ASSERT SQLERRM='1168_PRICE_DRIFT_CHECKED_ROLLBACK';END;
 PERFORM set_config('role','authenticated',true);
 PERFORM set_config('test.e1168.priceDriftDenied','true',true);
 RAISE NOTICE 'EARLYITM1168_CANONICAL_PRICE_DRIFT_GLOBAL_FINALIZE_DENIED_OLD_DEBT_UNCHANGED';
