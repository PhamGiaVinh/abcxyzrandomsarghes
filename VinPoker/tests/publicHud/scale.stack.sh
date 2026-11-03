#!/usr/bin/env bash
set -euo pipefail
umask 077
repo_root="$(pwd)"
for forbidden in SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD VERCEL_TOKEN; do
  if [[ -n "${!forbidden:-}" ]]; then echo 'Remote credential present in isolated load job' >&2; exit 1; fi
done
test_root="$(mktemp -d -t vinpoker-hud-stack-XXXXXXXX)"
project_id="hud-scale-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
serve_pid=''
cleanup(){
  result=$?
  if [[ "$result" != 0 ]]; then node "$repo_root/tests/publicHud/scale.diagnostics.mjs" "$test_root" "$project_id" || true; fi
  if [[ -n "$serve_pid" ]]; then kill "$serve_pid" >/dev/null 2>&1 || true; fi
  supabase stop --workdir "$test_root" --no-backup >/dev/null 2>&1 || true
}
trap cleanup EXIT
supabase init --workdir "$test_root" >/dev/null
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
exclude='imgproxy,logflare,mailpit,postgres-meta,storage-api,studio,supavisor,vector'
supabase start --workdir "$test_root" --exclude "$exclude" >"$test_root/start.log" 2>&1
docker inspect "supabase_db_$project_id" >/dev/null
export PUBLIC_HUD_LOCAL_DATABASE=postgres PUBLIC_HUD_ISOLATED_STACK=vinpoker-hud-scale PUBLIC_HUD_LOCAL_PORT=54322 PGPASSWORD=postgres
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -w -v ON_ERROR_STOP=1 -c "COMMENT ON DATABASE postgres IS 'vinpoker-hud-scale-disposable';" >/dev/null
supabase status --workdir "$test_root" -o env >"$test_root/status.env" 2>"$test_root/status.log"
mkdir -p output/hud-scale
PUBLIC_HUD_HTTP_GENERATOR_REPORT="$repo_root/output/hud-scale/generator-transport.json" node tests/publicHud/scale.http.benchmark.mjs
docker inspect --format '{"name":{{json .Name}},"image":{{json .Config.Image}},"memoryLimitBytes":{{.HostConfig.Memory}},"nanoCpus":{{.HostConfig.NanoCpus}}}' \
 "supabase_db_$project_id" "supabase_realtime_$project_id" "supabase_edge_runtime_$project_id" >output/hud-scale/runtime-images.jsonl
export PUBLIC_HUD_SCALE_SEED_REPORT="$repo_root/output/hud-scale/seed.json"
export PUBLIC_HUD_SCALE_READ_REPORT="$repo_root/output/hud-scale/native-read.json"
node tests/publicHud/scale.seed.mjs >output/hud-scale/seed-progress.log 2>&1
node tests/publicHud/scale.read.native.mjs >output/hud-scale/native-read.log 2>&1
PUBLIC_HUD_PLAN_REPORT="$repo_root/output/hud-scale/read-plans.json" node tests/publicHud/read-plans.native.mjs
node tests/publicHud/scale.sources.native.mjs
supabase functions serve --workdir "$test_root" --env-file "$test_root/workers.env" --no-verify-jwt >"$test_root/serve.log" 2>&1 &
serve_pid=$!
node tests/publicHud/scale.edge-runtime.mjs capture "$test_root" "$project_id"
kill -INT "$serve_pid"
wait "$serve_pid" || true
serve_pid=''
node tests/publicHud/scale.edge-runtime.mjs apply "$test_root" "$project_id"
export PUBLIC_HUD_STATUS_FILE="$test_root/status.env" PUBLIC_HUD_WORKER_ENV_FILE="$test_root/workers.env" PUBLIC_HUD_STACK_PROJECT="$project_id"
node tests/publicHud/scale.stack-setup.mjs
ulimit -n 16384
node tests/publicHud/scale.http-ws.mjs
docker stats --no-stream --format '{{json .}}' >output/hud-scale/container-resources.jsonl
