-- Code-only rollback for EMPTY candidate tables. Never discard confirmed ranks/receipts.
-- Execute in an explicit guarded transaction; no CASCADE or historical data reversal.
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM private.multi_day_individual_results_v1)
 OR EXISTS(SELECT 1 FROM private.multi_day_individual_rank_requests_v1) THEN RAISE EXCEPTION 'individual_rank_recovery_history_retained_use_forward_repair';END IF;
 IF (SELECT count(*)=1 AND bool_and(md5(p.prosrc)='2020df2f7f6d01e1d106a2e4743cb737') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='multi_day_individual_rank_source_v1') IS DISTINCT FROM true THEN RAISE EXCEPTION 'individual_rank_recovery_body_drift';END IF;
 IF (SELECT count(*)=1 AND bool_and(md5(p.prosrc)='ce66aaafa982d8f705df1ef58234f740') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_multi_day_individual_rank_review_v1') IS DISTINCT FROM true THEN RAISE EXCEPTION 'individual_rank_recovery_body_drift';END IF;
 IF (SELECT count(*)=1 AND bool_and(md5(p.prosrc)='6a39709a8f564d3db686a396c4042013') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='confirm_multi_day_individual_ranks_v1') IS DISTINCT FROM true THEN RAISE EXCEPTION 'individual_rank_recovery_body_drift';END IF;
 IF (SELECT count(*)=1 AND bool_and(md5(p.prosrc)='7a2693172f86b290360da84579c8c794') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_multi_day_individual_rank_receipt_v1') IS DISTINCT FROM true THEN RAISE EXCEPTION 'individual_rank_recovery_body_drift';END IF;
 IF (SELECT count(*)=1 AND bool_and(md5(p.prosrc)='a2494f46881935de51a1588ac29f0975') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='multi_day_individual_result_entry_fence_v1') IS DISTINCT FROM true THEN RAISE EXCEPTION 'individual_rank_recovery_body_drift';END IF;
END $guard$;
DROP TRIGGER multi_day_individual_result_entry_fence ON public.tournament_entries;
DROP FUNCTION private.multi_day_individual_result_entry_fence_v1();
DROP FUNCTION public.get_multi_day_individual_rank_receipt_v1(uuid,uuid);
DROP FUNCTION public.confirm_multi_day_individual_ranks_v1(uuid,text,uuid[],uuid);
DROP FUNCTION public.get_multi_day_individual_rank_review_v1(uuid);
DROP FUNCTION private.multi_day_individual_rank_source_v1(uuid);
DROP TABLE private.multi_day_individual_rank_requests_v1;
DROP TABLE private.multi_day_individual_results_v1;
