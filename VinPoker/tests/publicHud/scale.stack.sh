#!/usr/bin/env bash
set -euo pipefail
umask 077
repo_root="$(pwd)"
for forbidden in SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD VERCEL_TOKEN; do
  if [[ -n "${!forbidden:-}" ]]; then echo 'Remote credential present in isolated load job' >&2; exit 1; fi
done
node --input-type=module -e "import {pendingSourceProbeEnabled,writerWaitDiagnosticEnabled} from './tests/publicHud/scale.write.protocol.mjs';pendingSourceProbeEnabled(process.env);writerWaitDiagnosticEnabled(process.env);"
node --test tests/publicHud/scale.postgrest-metrics.test.mjs
test_root="$(mktemp -d -t vinpoker-hud-stack-XXXXXXXX)"
project_id="hud-scale-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
serve_pid=''
cleanup(){
  result=$?
  if [[ "$result" != 0 ]]; then node "$repo_root/tests/publicHud/scale.diagnostics.mjs" "$test_root" "$project_id" || true; fi
  if [[ -n "$serve_pid" ]]; then kill "$serve_pid" >/dev/null 2>&1 || true; fi
  node "$repo_root/tests/publicHud/scale.isolate-diagnostics.mjs" "$project_id" || true
  supabase stop --workdir "$test_root" --no-backup >/dev/null 2>&1 || true
}
trap cleanup EXIT
supabase init --workdir "$test_root" >/dev/null
# CLI 2.101.0's default 17.6.1.106 crashes on denied function EXECUTE.
# Use the CLI's version-file input with an official, fixed image; preserve
# all ACL denial tests and the remaining stack configuration.
postgres_image='ghcr.io/supabase/postgres:17.6.1.155@sha256:3866d94d8426927e8db3f1c5d790752292bfbe27b5f1f46e199ae1b7d3c1710b'
mkdir -p "$test_root/supabase/.temp"
printf '%s' '17.6.1.155@sha256:3866d94d8426927e8db3f1c5d790752292bfbe27b5f1f46e199ae1b7d3c1710b' >"$test_root/supabase/.temp/postgres-version"
python3 - "$test_root/supabase/config.toml" "$project_id" <<'PY'
import pathlib,re,sys,tomllib
p=pathlib.Path(sys.argv[1]); body=p.read_text()
body=re.sub(r'^project_id\s*=.*$',f'project_id = "{sys.argv[2]}"',body,count=1,flags=re.M)
body=re.sub(r'(\[edge_runtime\][\s\S]*?\npolicy\s*=\s*)"[^"]*"',r'\1"per_worker"',body,count=1)
config=tomllib.loads(body)
assert config['project_id'].startswith('hud-scale-')
assert config['edge_runtime']['policy']=='per_worker'
p.write_text(body)
PY
for fn in _shared public-player-hud public-hud-projector-v1 public-spectator-projector-v2; do
  mkdir -p "$test_root/supabase/functions"
  cp -a "$repo_root/supabase/functions/$fn" "$test_root/supabase/functions/$fn"
done
node tests/publicHud/scale.bundle.mjs "$test_root"
for fn in public-player-hud public-hud-projector-v1 public-spectator-projector-v2; do
  printf '\n[functions.%s]\nverify_jwt = false\n' "$fn" >>"$test_root/supabase/config.toml"
done
printf 'PUBLIC_HUD_WORKER_SECRET=%s\nPUBLIC_SPECTATOR_WORKER_SECRET=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" >"$test_root/workers.env"
printf 'PUBLIC_HUD_ISOLATE_DIAGNOSTICS=isolated-hud-runtime-diagnostics-v1\n' >>"$test_root/workers.env"
exclude='imgproxy,logflare,mailpit,postgres-meta,storage-api,studio,supavisor,vector'
supabase start --workdir "$test_root" --exclude "$exclude" >"$test_root/start.log" 2>&1
docker inspect "supabase_db_$project_id" >/dev/null
[[ "$(docker inspect --format '{{.Config.Image}}' "supabase_db_$project_id")" == "$postgres_image" ]]
export PUBLIC_HUD_LOCAL_DATABASE=postgres PUBLIC_HUD_ISOLATED_STACK=vinpoker-hud-scale PUBLIC_HUD_LOCAL_PORT=54322 PGPASSWORD=postgres
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -w -v ON_ERROR_STOP=1 -c "COMMENT ON DATABASE postgres IS 'vinpoker-hud-scale-disposable';" >/dev/null
supabase status --workdir "$test_root" -o env >"$test_root/status.env" 2>"$test_root/status.log"
mkdir -p output/hud-scale
node tests/publicHud/scale.postgrest.mjs "$project_id" "$test_root"
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -w -X -qAt -v ON_ERROR_STOP=1 \
 -c "SELECT jsonb_build_object('postgres',version(),'supautils',current_setting('supautils.version',true));" >output/hud-scale/database-runtime.json
PUBLIC_HUD_HTTP_GENERATOR_REPORT="$repo_root/output/hud-scale/generator-transport.json" node tests/publicHud/scale.http.benchmark.mjs
docker inspect --format '{"name":{{json .Name}},"image":{{json .Config.Image}},"memoryLimitBytes":{{.HostConfig.Memory}},"nanoCpus":{{.HostConfig.NanoCpus}}}' \
 "supabase_db_$project_id" "supabase_realtime_$project_id" "supabase_edge_runtime_$project_id" >output/hud-scale/runtime-images.jsonl
export PUBLIC_HUD_STACK_PROJECT="$project_id"
export PUBLIC_HUD_SCALE_SEED_REPORT="$repo_root/output/hud-scale/seed.json"
export PUBLIC_HUD_SCALE_READ_REPORT="$repo_root/output/hud-scale/native-read.json"
# Counterfactual observer jobs must never enter the audience database. Build the
# same deterministic complete fixture in a separate owned database, then drop it.
comparison_database="vinpoker_hud_test_pair_${GITHUB_RUN_ID:-local}_${GITHUB_RUN_ATTEMPT:-1}"
[[ "$comparison_database" =~ ^vinpoker_hud_test_pair_[a-z0-9_]+$ ]]
createdb -h 127.0.0.1 -p 54322 -U postgres --template=template0 "$comparison_database"
psql -h 127.0.0.1 -p 54322 -U postgres -d "$comparison_database" -w -X -qAt -v ON_ERROR_STOP=1 \
 -c "COMMENT ON DATABASE \"$comparison_database\" IS 'vinpoker-hud-writer-control-disposable';" >/dev/null
PUBLIC_HUD_LOCAL_DATABASE="$comparison_database" PUBLIC_HUD_ISOLATED_STACK= PUBLIC_HUD_WRITER_DIAGNOSTIC=isolated-comparison-admin PUBLIC_HUD_SCALE_SEED_REPORT="$repo_root/output/hud-scale/writer-isolated-seed.json" \
 node tests/publicHud/scale.seed.mjs >output/hud-scale/writer-isolated-seed.log 2>&1
if [[ "${PUBLIC_HUD_WRITER_WAIT_DIAGNOSTIC:-0}" == '1' ]]; then
 PUBLIC_HUD_LOCAL_DATABASE="$comparison_database" PUBLIC_HUD_ISOLATED_STACK= \
  node tests/publicHud/writer-wait-observer.native.mjs
fi
PUBLIC_HUD_LOCAL_DATABASE="$comparison_database" PUBLIC_HUD_ISOLATED_STACK= PUBLIC_HUD_WRITER_CONTROL=isolated-native-only PUBLIC_HUD_WRITER_OBSERVER_CANONICAL=pre019 \
 PUBLIC_HUD_WRITER_CONTROL_REPORT="$repo_root/output/hud-scale/writer-matched-observers.json" \
  node tests/publicHud/writer-control.native.mjs >output/hud-scale/writer-matched-observers.log 2>&1
if [[ -n "${GITHUB_RUN_ID:-}" ]]; then
 PUBLIC_HUD_LOCAL_DATABASE="$comparison_database" PUBLIC_HUD_ISOLATED_STACK= PUBLIC_HUD_WRITER_CONTROL=isolated-native-only \
 PUBLIC_HUD_WRITER_CONTROL_REPORT="$repo_root/output/hud-scale/writer-matched-observers.json" \
  node tests/publicHud/writer-evidence.native.mjs >output/hud-scale/writer-evidence-validation.log 2>&1
fi
dropdb -h 127.0.0.1 -p 54322 -U postgres "$comparison_database"
if [[ "${PUBLIC_HUD_WRITER_WAIT_DIAGNOSTIC:-0}" == '1' ]]; then
 # All original pair statistics and failures remain in the diagnostic receipt.
 # Do not admit viewers or manufacture an HTTP/qualification result.
 echo 'Writer-only wait observation complete; no audience or qualification.'
 exit 0
fi
claim_database="vinpoker_hud_test_claim_${GITHUB_RUN_ID:-local}_${GITHUB_RUN_ATTEMPT:-1}"
createdb -h 127.0.0.1 -p 54322 -U postgres "$claim_database"
PUBLIC_HUD_LOCAL_DATABASE="$claim_database" PUBLIC_HUD_ISOLATED_STACK= \
 PUBLIC_HUD_CLAIM_SOURCE_REPORT="$repo_root/output/hud-scale/claim-source.json" \
 node tests/publicHud/claim-source.native.mjs --initialize
dropdb -h 127.0.0.1 -p 54322 -U postgres "$claim_database"
export PUBLIC_HUD_GENERATION_INDEX_REPORT="$repo_root/output/hud-scale/compact-generation-index.json"
node tests/publicHud/scale.seed.mjs >output/hud-scale/seed-progress.log 2>&1
if [[ "${PUBLIC_HUD_SOURCE_GENERATION_PROBE:-0}" == 1 ]]; then
  # The historical migration probe requires its original writer preimage;
  # candidate seed ran it synchronously before342, with all guards intact.
  node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const report=JSON.parse(readFileSync(process.env.PUBLIC_HUD_GENERATION_INDEX_REPORT,'utf8'));
assert.equal(report.kind,'NATIVE_COMPACT_GENERATION_LOOKUP_INDEX_NOT_WRITER_QUALIFICATION');
assert.deepEqual(report.checks,['actual-generic-lookup-uses-partial-index','source-generations-unchanged','writer-OID-definition-and-table-owner-ACL-RLS-preserved','duplicate-apply-denied','reverse-absence-and-definition-drift-denied','exact-reverse-and-transactional-original-index-preservation']);
assert.equal(report.plan.index,'idx_compact_generation_lookup_v1');
assert.equal(report.productionChanged,false);
JS
else
  node tests/publicHud/compact-generation-index.native.mjs
fi
node tests/publicHud/enqueue-writes.native.mjs >output/hud-scale/enqueue-write-contract.json
node tests/publicHud/enqueue-writes.recovery.native.mjs >output/hud-scale/enqueue-write-recovery.json
PUBLIC_HUD_SOURCE_WRITE_REPORT="$repo_root/output/hud-scale/source-write-idempotency.json" node tests/publicHud/source-writes.native.mjs
PUBLIC_HUD_HISTORY_PLAN_REPORT="$repo_root/output/hud-scale/history-plans.json" node tests/publicHud/history-plans.native.mjs
PUBLIC_HUD_HISTORY_AMOUNTS_APPLY=isolated-native-only PUBLIC_HUD_HISTORY_AMOUNTS_REPORT="$repo_root/output/hud-scale/history-amounts.json" node tests/publicHud/history-amounts.native.mjs
PUBLIC_HUD_NULL_PROOF_REPORT="$repo_root/output/hud-scale/null-proof.json" node tests/publicHud/null-proof.native.mjs
PUBLIC_HUD_HISTORY_SEED_APPLY=isolated-native-only PUBLIC_HUD_HISTORY_SEED_REPORT="$repo_root/output/hud-scale/history-seed.json" node tests/publicHud/history-seed.native.mjs
PUBLIC_HUD_RESULT_SCOPE_REPORT="$repo_root/output/hud-scale/result-withdrawal.json" node tests/publicHud/result-withdrawal.native.mjs
PUBLIC_HUD_HAND_WITHDRAWAL_REPORT="$repo_root/output/hud-scale/hand-withdrawal.json" node tests/publicHud/hand-withdrawal.native.mjs
node tests/publicHud/scale.read.native.mjs >output/hud-scale/native-read.log 2>&1
PUBLIC_HUD_PLAN_REPORT="$repo_root/output/hud-scale/read-plans.json" node tests/publicHud/read-plans.native.mjs
PUBLIC_HUD_CLOCK_PLAN_REPORT="$repo_root/output/hud-scale/clock-read-plan.json" node tests/publicHud/clock-read-plan.native.mjs
PUBLIC_HUD_CLOCK_COUNTS_REPORT="$repo_root/output/hud-scale/clock-counts.json" node tests/publicHud/clock-counts.native.mjs
PUBLIC_HUD_CLOCK_NUMERIC_REPORT="$repo_root/output/hud-scale/clock-numeric.json" node tests/publicHud/clock-numeric.native.mjs
PUBLIC_HUD_SUMMARY_BATCH_REPORT="$repo_root/output/hud-scale/summary-batch.json" node tests/publicHud/summary-batch.native.mjs
PUBLIC_HUD_TABLE_PREPARED_REPORT="$repo_root/output/hud-scale/current-table-prepared.json" node tests/publicHud/current-table-prepared.native.mjs
PUBLIC_HUD_BUNDLE_REPORT="$repo_root/output/hud-scale/table-clock-bundle.json" node tests/publicHud/table-clock-bundle.native.mjs
node tests/publicHud/identity-membership.native.mjs
PUBLIC_HUD_IDENTITY_KEYSET_REPORT="$repo_root/output/hud-scale/identity-keyset.json" node tests/publicHud/identity-keyset.native.mjs
PUBLIC_HUD_IDENTITY_PLAN_REPORT="$repo_root/output/hud-scale/identity-lookup.json" node tests/publicHud/identity-lookup.native.mjs
PUBLIC_HUD_AMENDMENT_NATIVE_REPORT="$repo_root/output/hud-scale/amendment-native.json" node tests/publicHud/scale.amendments.native.mjs
node tests/publicHud/scale.sources.native.mjs
PUBLIC_HUD_VISIBILITY_WAKE_REPORT="$repo_root/output/hud-scale/visibility-wake.json" node tests/publicHud/visibility-wake.native.mjs --already-applied
node tests/publicHud/scale.sql-profile.mjs
if [[ "${PUBLIC_HUD_SCALE_VIEWERS:-10}" == 1000 && "${PUBLIC_HUD_SCALE_SECONDS:-30}" == 30 ]]; then
  node tests/publicHud/history-current-profile.native.mjs
fi
supabase functions serve --workdir "$test_root" --env-file "$test_root/workers.env" --no-verify-jwt >"$test_root/serve.log" 2>&1 &
serve_pid=$!
node tests/publicHud/scale.edge-runtime.mjs capture "$test_root" "$project_id"
kill -INT "$serve_pid"
wait "$serve_pid" || true
serve_pid=''
node tests/publicHud/scale.edge-runtime.mjs apply "$test_root" "$project_id"
export PUBLIC_HUD_STATUS_FILE="$test_root/status.env" PUBLIC_HUD_WORKER_ENV_FILE="$test_root/workers.env" PUBLIC_HUD_STACK_PROJECT="$project_id"
node tests/publicHud/scale.stack-setup.mjs
if [[ "${PUBLIC_HUD_CLOCK_UI_PROBE:-0}" == 1 ]]; then
  node tests/publicHud/scale.clock-ui.mjs
fi
ulimit -n 16384
node tests/publicHud/scale.http-ws.mjs
node tests/publicHud/scale.rollback-runtime.mjs
docker stats --no-stream --format '{{json .}}' >output/hud-scale/container-resources.jsonl
