#!/usr/bin/env bash
# One exact ordinary VACUUM over native PostgreSQL. No schema/role/scheduler SQL.
set -euo pipefail
unset PGHOSTADDR PGSERVICE PGSERVICEFILE
mode="${1:-production}"
readonly image='postgres:17.6-bookworm'
readonly ref='orlesggcjamwuknxwcpk'
readonly source_md5='a0ace27a37b7e89177de9290571b3252'
readonly target='net._http_response'
umask 077
[[ "${GITHUB_RUN_ID:?}" =~ ^[0-9]+$ ]]
readonly work="$(mktemp -d -- "${RUNNER_TEMP:?}/http-response-maintenance-${GITHUB_RUN_ID}.XXXXXX")"
phase=preflight
cleanup() {
  local rc=$?
  if [[ $rc != 0 ]]; then
    echo 'HTTP response maintenance failed; raw diagnostics withheld' >&2
    if [[ -n "${HTTP_MAINTENANCE_REPORT:-}" ]]; then
      node --input-type=module - "$work/diagnostics.log" "$HTTP_MAINTENANCE_REPORT" "$phase" "$rc" <<'FAILURE' || true
import{existsSync,readFileSync,writeFileSync,mkdirSync}from'node:fs';import{dirname,isAbsolute}from'node:path';
const raw=existsSync(process.argv[2])?readFileSync(process.argv[2],'utf8'):'';
const code=raw.match(/\b(?:ERROR|FATAL):\s+([A-Z0-9]{5})\b/)?.[1]??null;
if(isAbsolute(process.argv[3])){mkdirSync(dirname(process.argv[3]),{recursive:true});writeFileSync(process.argv[3],JSON.stringify({kind:'NATIVE_EXACT_HTTP_RESPONSE_MAINTENANCE',passed:false,phase:process.argv[4],exitCode:Number(process.argv[5]),sqlstate:code,finishedAt:new Date().toISOString(),rawDiagnosticsWithheld:true},null,2)+'\n');}
FAILURE
    fi
  fi
  rm -rf -- "$work"
}
trap cleanup EXIT
if [[ "$mode" == --fixture ]]; then
  [[ "${CI:-}" == true && "${PGHOST:-}" == 127.0.0.1 && "${PGDATABASE:-}" == vinpoker_backup_observation_test_* ]]
  [[ "${PGUSER:-}" == postgres ]]
  expected_owner='maintenance_test_admin'
  psql_cmd=(psql)
elif [[ "$mode" == production ]]; then
  [[ "${SUPABASE_PROJECT_REF:-}" == "$ref" && -n "${SUPABASE_DB_PASSWORD:-}" ]]
  export PGHOST='aws-1-ap-southeast-2.pooler.supabase.com' PGPORT=5432
  export PGUSER="postgres.$ref" PGDATABASE=postgres PGSSLMODE=require
  export PGPASSWORD="$SUPABASE_DB_PASSWORD"
  expected_owner='supabase_admin'
  docker pull "$image" >"$work/image.log" 2>&1
  psql_cmd=(docker run --rm -i --network host --env PGHOST --env PGPORT --env PGUSER --env PGDATABASE --env PGPASSWORD --env PGSSLMODE --env PGOPTIONS --env PGAPPNAME "$image" psql)
else
  echo 'Unsupported maintenance mode' >&2; exit 64
fi
# Startup options affect only each maintenance connection, never the role or job.
export PGOPTIONS='-c lock_timeout=1000 -c statement_timeout=300000'
export PGAPPNAME="http-response-maintenance-${GITHUB_RUN_ID}"
query() { "${psql_cmd[@]}" -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate 2>"$work/diagnostics.log"; }
preflight="SELECT jsonb_build_object('actor',current_user,'database',current_database(),
 'server_version_num',current_setting('server_version_num')::int,
 'statement_timeout',current_setting('statement_timeout'),'lock_timeout',current_setting('lock_timeout'),
 'owner',(SELECT relowner::regrole::text FROM pg_class WHERE oid='$target'::regclass),
 'maintain',has_table_privilege(current_user,'$target','MAINTAIN'),
 'source_md5',(SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.run_dealer_ready_backup_cron_v1()'::regprocedure),
 'source_acl_md5',(SELECT md5(proacl::text) FROM pg_proc WHERE oid='public.run_dealer_ready_backup_cron_v1()'::regprocedure),
 'active_vacuums',(SELECT count(*) FROM pg_stat_progress_vacuum WHERE relid='$target'::regclass),
 'heap_bytes',pg_relation_size('$target'),
 'last_vacuum',(SELECT last_vacuum FROM pg_stat_all_tables WHERE relid='$target'::regclass),
 'jobs',(SELECT jsonb_agg(jsonb_build_object('jobid',jobid,'jobname',jobname,'schedule',schedule,'command',command,'active',active,'username',username,'database',database) ORDER BY jobid) FROM cron.job WHERE jobid IN(30,51)));"
printf '%s\n' "$preflight" | query >"$work/before.json"
node --input-type=module - "$work/before.json" "$expected_owner" "$mode" "$source_md5" <<'GUARD'
import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const r=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(r.actor,'postgres');assert.equal(r.owner,process.argv[3]);assert.equal(r.maintain,true);
assert.equal(r.source_md5,process.argv[5]);assert.equal(r.active_vacuums,0);
assert.ok(r.server_version_num>=170000&&r.server_version_num<180000);
assert.equal(r.statement_timeout,'5min');assert.equal(r.lock_timeout,'1s');
assert.ok(r.heap_bytes>=0&&r.heap_bytes<=1024**3);
if(process.argv[4]==='production'){
 assert.equal(r.database,'postgres');assert.equal(r.source_acl_md5,'db23e67d6fad77fdfa003856d807d6af');
 assert.equal(r.jobs.length,2);
 const j=r.jobs.find(x=>x.jobid===30);
 assert.equal(j.jobname,'run-dealer-ready-backup');assert.equal(j.active,true);
 assert.equal(j.schedule,'* * * * *');assert.equal(j.username,'postgres');assert.equal(j.database,'postgres');
 assert.equal(j.command,'SELECT public.run_dealer_ready_backup_cron_v1();');
}
GUARD
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
phase=maintenance
# Top-level standalone command, one invocation, no retry and no FULL/truncation.
printf '%s\n' "VACUUM (ANALYZE, INDEX_CLEANUP ON, TRUNCATE OFF, PARALLEL 0, SKIP_LOCKED, BUFFER_USAGE_LIMIT '2MB') net._http_response;" | query >"$work/vacuum-status.txt"
if grep -q 'WARNING:' "$work/diagnostics.log"; then
  phase=maintenance_skipped_or_warning
  echo 'Maintenance was skipped or warned; completion not accepted' >&2
  exit 1
fi
phase=postcheck
printf '%s\n' "$preflight" | query >"$work/after.json"
node --input-type=module - "$work/before.json" "$work/after.json" "${HTTP_MAINTENANCE_REPORT:?}" "$started" <<'REPORT'
import assert from'node:assert/strict';import{readFileSync,writeFileSync,mkdirSync}from'node:fs';import{dirname,isAbsolute}from'node:path';
const before=JSON.parse(readFileSync(process.argv[2],'utf8')),after=JSON.parse(readFileSync(process.argv[3],'utf8'));
for(const k of ['actor','database','owner','maintain','source_md5','source_acl_md5','jobs'])assert.deepEqual(after[k],before[k],`Changed ${k}`);
assert.equal(after.active_vacuums,0);
assert.notEqual(after.last_vacuum,before.last_vacuum,'No new completed VACUUM recorded');
assert.ok(after.last_vacuum&&Date.parse(after.last_vacuum)>=Date.parse(process.argv[5]),'VACUUM skipped or completion unproven');
const destination=process.argv[4];assert.ok(isAbsolute(destination));mkdirSync(dirname(destination),{recursive:true});
writeFileSync(destination,JSON.stringify({kind:'NATIVE_EXACT_HTTP_RESPONSE_MAINTENANCE',passed:true,startedAt:process.argv[5],finishedAt:new Date().toISOString(),before,after,logicalSourceChanged:false,limitations:['Ordinary VACUUM consumes IO; follow scheduled job/HTTP latency separately','No live row count or Telegram delivery claim']},null,2)+'\n');
console.log('NATIVE_HTTP_RESPONSE_MAINTENANCE_COMPLETION_VERIFIED');
REPORT
