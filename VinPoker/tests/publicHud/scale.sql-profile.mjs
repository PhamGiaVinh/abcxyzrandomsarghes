// Aggregate existing PostgreSQL statement timing; never export SQL text/args.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {sql,jsonSql} from './nativeDb.mjs';
assert.equal(process.env.PUBLIC_HUD_ISOLATED_STACK,'vinpoker-hud-scale');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'vinpoker-hud-scale-disposable');
sql('CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;');
const schema=sql("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_stat_statements';");
assert.ok(['public','extensions'].includes(schema),'Unexpected statement statistics schema');
const readers=['get_public_player_hud_summary_v1','get_public_player_hud_summary_batch_v1','get_public_player_hud_history_v1','get_public_tournament_table_live_or_last_hand_v2','get_public_tournament_viewer_snapshot_v2','get_tournament_clock','get_public_tournament_clock_summary','get_public_hud_job_source_v1','claim_public_hud_jobs_with_source_v1','publish_public_hud_hand_v1','process_public_hud_metadata_v1','get_public_spectator_projection_source_v2','publish_public_spectator_projection_v2'];
const classification=readers.map(name=>`WHEN strpos(query,'${name}')>0 THEN '${name}'`).join('\n');
sql(`CREATE VIEW spectator_projection_v2.fixture_rpc_profile AS
 WITH classified AS (
 SELECT CASE ${classification} ELSE NULL END AS rpc,calls,total_exec_time,total_plan_time,rows,shared_blks_hit,shared_blks_read
 FROM ${schema}.pg_stat_statements WHERE toplevel AND dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
 AND query NOT LIKE '%pg_stat_statements%')
 SELECT rpc,sum(calls)::bigint AS calls,sum(total_exec_time) AS execution_ms,sum(total_plan_time) AS planning_ms,
 sum(rows)::bigint AS rows,sum(shared_blks_hit)::bigint AS shared_hits,sum(shared_blks_read)::bigint AS shared_reads
 FROM classified WHERE rpc IS NOT NULL GROUP BY rpc;
 CREATE VIEW spectator_projection_v2.fixture_rpc_profile_info AS SELECT dealloc,stats_reset FROM ${schema}.pg_stat_statements_info;
 REVOKE ALL ON spectator_projection_v2.fixture_rpc_profile,spectator_projection_v2.fixture_rpc_profile_info FROM PUBLIC,anon,authenticated,service_role;`);
const initial=jsonSql("SELECT jsonb_build_object('at',clock_timestamp(),'track',current_setting('pg_stat_statements.track',true),'trackPlanning',current_setting('pg_stat_statements.track_planning',true),'statsInfo',(SELECT to_jsonb(v) FROM spectator_projection_v2.fixture_rpc_profile_info v),'rpc',(SELECT coalesce(jsonb_agg(v ORDER BY rpc),'[]') FROM spectator_projection_v2.fixture_rpc_profile v));");
writeFileSync('output/hud-scale/sql-profile-baseline.json',JSON.stringify(initial,null,2));
