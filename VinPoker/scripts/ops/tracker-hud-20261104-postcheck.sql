-- Read-only object/ACL inspection. Receipt hashes are separately verified by
-- the atomic runner; ledger success does not replace these object checks.
SELECT jsonb_build_object(
 'privateSchemaPresent',to_regnamespace('tracker_analytics_v1') IS NOT NULL,
 'anonPrivateSchemaUsage',has_schema_privilege('anon','tracker_analytics_v1','USAGE'),
 'authenticatedPrivateSchemaUsage',has_schema_privilege('authenticated','tracker_analytics_v1','USAGE'),
 'anonCanReadSummary',has_function_privilege('anon','public.get_public_player_hud_summary_v1(uuid,uuid,text)','EXECUTE'),
 'anonCanReadHistory',has_function_privilege('anon','public.get_public_player_hud_history_v1(uuid,uuid,timestamptz,uuid)','EXECUTE'),
 'orderedHistoryDefinitionMatches',md5(replace(pg_get_functiondef('public.get_public_player_hud_history_v1(uuid,uuid,timestamptz,uuid)'::regprocedure),chr(13),''))='7fcbf1a0c6ed5da9fedb5d83d699adf4',
 'anonCanClaimJobs',has_function_privilege('anon','public.claim_public_hud_jobs_v1(integer)','EXECUTE'),
 'authenticatedCanClaimJobs',has_function_privilege('authenticated','public.claim_public_hud_jobs_v1(integer)','EXECUTE'),
 'serviceCanClaimJobs',has_function_privilege('service_role','public.claim_public_hud_jobs_v1(integer)','EXECUTE'),
 'anonCanFlushBroadcast',has_function_privilege('anon','public.flush_public_spectator_broadcast_v2(integer)','EXECUTE'),
 'privateBrowserTableGrants',(SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='tracker_analytics_v1' AND grantee IN ('anon','authenticated','PUBLIC')),
 'observerTriggers',(SELECT jsonb_object_agg(tgname,tgenabled) FROM pg_trigger WHERE tgname IN ('hud_hand_changed','hud_outcome_changed','hud_result_changed','hud_visibility_changed','hud_withdrawal_broadcast')),
 'capturedRollbackDefinitions',(SELECT count(*) FROM spectator_projection_v2.compact_generation_originals_v1),
 'boundedCurrentHandIndexes',(SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN ('idx_public_hand_live_latest_v1','idx_public_hand_completed_latest_v1')),
 'capturedReadPlans',(SELECT count(*) FROM spectator_projection_v2.read_plan_originals_v1),
 'readPlanDefinitionsMatch',(SELECT count(*)=4 AND bool_and(CASE WHEN r.signature='public.get_public_tournament_clock_summary(uuid)' THEN EXISTS(SELECT 1 FROM spectator_projection_v2.clock_read_plan_original_v1 c WHERE c.signature=r.signature AND c.original_definition_hash=r.wrapped_definition_hash) ELSE md5(replace(pg_get_functiondef(r.signature::regprocedure),chr(13),''))=r.wrapped_definition_hash END) FROM spectator_projection_v2.read_plan_originals_v1 r),
 'clockReadPlanDefinitionMatches',(SELECT count(*)=1 AND bool_and(md5(replace(pg_get_functiondef(signature::regprocedure),chr(13),''))=wrapped_definition_hash) FROM spectator_projection_v2.clock_read_plan_original_v1),
 'clockReadPlanPrivateBrowserGrants',(SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='spectator_projection_v2' AND table_name='clock_read_plan_original_v1' AND grantee IN ('anon','authenticated','PUBLIC','service_role')),
 'readPlanPrivateBrowserGrants',(SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='spectator_projection_v2' AND table_name='read_plan_originals_v1' AND grantee IN ('anon','authenticated','PUBLIC','service_role')),
 'dispatcherUrlReady',coalesce(current_setting('app.supabase_url',true)='https://orlesggcjamwuknxwcpk.supabase.co',false),
 'workerVaultCredentialPresent',EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='PUBLIC_HUD_WORKER_SECRET' AND length(decrypted_secret)>0),
 'configuration',(SELECT to_jsonb(c) FROM tracker_analytics_v1.config c WHERE singleton),
 'dispatchSchedules',(SELECT jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'active',active)) FROM cron.job WHERE jobname IN ('public-hud-projection-v1-dispatch','public-spectator-v2-dispatch'))
);
