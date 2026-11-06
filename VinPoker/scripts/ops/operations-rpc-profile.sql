-- Isolated-only observer. Never export SQL text, parameters, claims or rows.
BEGIN;
CREATE FUNCTION pg_temp.operations_rpc_profile() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE stats_schema text; result jsonb;
BEGIN
 IF current_database()<>'postgres' THEN RETURN jsonb_build_object('capture','unavailable','reason','fixture_scope');END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST')
 OR NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='a3000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST Tour')
 THEN RETURN jsonb_build_object('capture','unavailable','reason','fixture_scope');END IF;
 SELECT n.nspname INTO stats_schema FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_stat_statements';
 IF stats_schema IS NULL OR stats_schema NOT IN ('public','extensions') THEN RETURN jsonb_build_object('capture','unavailable','reason','statistics_extension');END IF;
 EXECUTE format($query$
 WITH classified AS (
  SELECT CASE
   WHEN strpos(query,'resolve_cashier_cash_buyin_intent_v1')>0 THEN 'resolve_cashier_cash_buyin_intent_v1'
   WHEN strpos(query,'cashier_tour_worklist_v1')>0 THEN 'cashier_tour_worklist_v1'
   WHEN strpos(query,'get_floor_tournament_table_roster_v3')>0 THEN 'get_floor_tournament_table_roster_v3'
   WHEN strpos(query,'get_floor_tournament_table_roster_v6')>0 THEN 'get_floor_tournament_table_roster_v6'
   WHEN strpos(query,'get_public_spectator_projection_source_v2')>0 THEN 'get_public_spectator_projection_source_v2'
   WHEN strpos(query,'publish_public_spectator_projection_v2')>0 THEN 'publish_public_spectator_projection_v2'
   WHEN strpos(query,'claim_public_spectator_projection_v2')>0 THEN 'claim_public_spectator_projection_v2'
   WHEN strpos(query,'get_public_tournament_viewer_snapshot_v2')>0 THEN 'get_public_tournament_viewer_snapshot_v2'
   WHEN strpos(query,'get_public_tournament_table_live_or_last_hand_v2')>0 THEN 'get_public_tournament_table_live_or_last_hand_v2'
   WHEN strpos(query,'get_public_tournament_clock_summary')>0 THEN 'get_public_tournament_clock_summary'
  END rpc,calls,total_exec_time,max_exec_time,shared_blks_hit,shared_blks_read
  FROM %I.pg_stat_statements WHERE toplevel AND dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
   AND query NOT LIKE '%%pg_stat_statements%%'
   -- Exclude migrations/function-definition guards that mention an RPC name.
   -- These measurements cover the actual PostgREST request CTE only.
   AND query ~* '^[[:space:]]*WITH[[:space:]]+pgrst_source[[:space:]]+AS[[:space:]]*[(]'
 ), aggregated AS (
  SELECT rpc,sum(calls)::bigint calls,sum(total_exec_time) execution_ms,max(max_exec_time) max_execution_ms,
   sum(shared_blks_hit)::bigint shared_hits,sum(shared_blks_read)::bigint shared_reads
  FROM classified WHERE rpc IS NOT NULL GROUP BY rpc
 ) SELECT jsonb_build_object('capture',CASE WHEN count(*)>0 THEN 'available' ELSE 'empty' END,'kind','ISOLATED_AGGREGATE_RPC_POSTGRES_TIMINGS',
 'queryScope','PostgREST pgrst_source request CTE only;DDL and native calls excluded',
 'qualification',false,'rpc',coalesce(jsonb_agg(to_jsonb(a) ORDER BY rpc),'[]'::jsonb)) FROM aggregated a
 $query$,stats_schema) INTO result;
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 RETURN jsonb_build_object('capture','unavailable','reason','statistics_query');
END $$;
SELECT pg_temp.operations_rpc_profile();
ROLLBACK;
