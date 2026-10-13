#!/usr/bin/env bash
set -euo pipefail
repo_root="$(pwd)"
schema_dir="${SCHEMA_ARTIFACT_DIRECTORY:-}"
schema_mode="${CASHIER_SCHEMA_MODE:-pre03}"
case "$schema_mode" in
  pre03) ;;
  current)
    # Explicit contemporary runtime qualification, not historical migration proof.
    expected_schema_sha=d23cfa75a7381453ba0d6216346f6460c816a3b1525ef5d47984c3a995ddc56a
    ;;
  *) echo "Unsupported Cashier schema mode" >&2; exit 1 ;;
esac
if [[ -z "$schema_dir" || ! -f "$schema_dir/live-public-schema.sql" ||
      ! -f "$schema_dir/live-public-schema.sha256" ]]; then
  echo "Verified schema-only baseline artifact is required" >&2
  exit 1
fi
(cd "$schema_dir" && sha256sum --check --status live-public-schema.sha256)
if [[ "$schema_mode" == current ]]; then
  actual_schema_sha="$(sha256sum "$schema_dir/live-public-schema.sql" | cut -d ' ' -f 1)"
  if [[ "$actual_schema_sha" != "$expected_schema_sha" ]]; then
    echo "Contemporary Cashier runtime schema provenance mismatch" >&2
    exit 1
  fi
fi

# This job has no production secrets or linked project. No application SQL or
# handler is loaded until the outbound-network proof succeeds.
for forbidden in SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SEPAY_RECONCILE_SECRET VERCEL_TOKEN; do
  if [[ -n "${!forbidden:-}" ]]; then
    echo "Unexpected remote credential in isolated E2E environment" >&2
    exit 1
  fi
done

test_root="$(mktemp -d -t cashier-e2e-XXXXXXXX)"
network="cashier-e2e-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
browser_network=""
bridge=""
firewall_chain="CASHIER_E2E"
stack_containers=()
ephemeral_containers=()
cleanup() {
  if (( ${#ephemeral_containers[@]} > 0 )); then
    docker rm -f "${ephemeral_containers[@]}" >/dev/null 2>&1 || true
  fi
  supabase stop --workdir "$test_root" --no-backup >/dev/null 2>&1 || true
  if (( ${#stack_containers[@]} > 0 )); then
    docker rm -f "${stack_containers[@]}" >/dev/null 2>&1 || true
  fi
  if [[ -n "$bridge" ]]; then
    sudo iptables -w -D DOCKER-USER -i "$bridge" -j "$firewall_chain" >/dev/null 2>&1 || true
    sudo iptables -w -F "$firewall_chain" >/dev/null 2>&1 || true
    sudo iptables -w -X "$firewall_chain" >/dev/null 2>&1 || true
  fi
  if [[ -n "$browser_network" ]]; then
    docker network rm "$browser_network" >/dev/null 2>&1 || true
  fi
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf -- "$test_root"
}
trap cleanup EXIT

cd "$test_root"
supabase init >/dev/null
if grep -q 'orlesggcjamwuknxwcpk' supabase/config.toml; then
  echo "Refusing production project config" >&2
  exit 1
fi

# Warm only the public package dependencies needed by the two real handlers.
# No application handler, schema, fixture or credential is present yet.
mkdir -p supabase/functions/edge-dependency-cache
cp "$repo_root/supabase/pending-tests/edge-dependency-cache/index.ts" \
  supabase/functions/edge-dependency-cache/index.ts
printf '%s\n' \
  '' \
  '[functions.edge-dependency-cache]' \
  'verify_jwt = false' \
  '[functions.tournament-register]' \
  'verify_jwt = true' \
  '[functions.sepay-reconcile]' \
  'verify_jwt = false' >>supabase/config.toml
printf '%s\n' \
  'SEPAY_RECONCILE_SECRET=cashier-edge-reconcile-test' \
  'SEPAY_AUTO_CONFIRM=true' \
  'SEPAY_API_BASE=http://fake-sepay:8787' >supabase/functions/.env

# The temporary project has no application migrations or function source.
# This first start only downloads/prepares the pinned CLI service images.
exclude_services="imgproxy,logflare,mailpit,postgres-meta,realtime,storage-api,studio,supavisor,vector"
df -h / | tail -n 1
set +e
supabase start --exclude "$exclude_services" >"$test_root/prepare.log" 2>&1
prepare_rc=$?
set -e
if (( prepare_rc != 0 )) || ! supabase status --output json >"$test_root/prepare-status.json" 2>"$test_root/prepare-status.err"; then
  echo "Empty Supabase start/status failed (start exit $prepare_rc)" >&2
  tail -n 25 "$test_root/prepare.log" >&2
  docker ps -a --format 'Container startup: {{.Names}} {{.Status}}' >&2
  df -h / | tail -n 1 >&2
  docker system df >&2
  exit 1
fi
dependency_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --max-time 120 --request POST \
  http://127.0.0.1:54321/functions/v1/edge-dependency-cache)"
if [[ "$dependency_status" != 204 ]]; then
  echo "Edge dependency warm-up failed (HTTP $dependency_status)" >&2
  docker logs "$(docker ps -q --filter 'name=supabase_edge_runtime_')" --tail 40 >&2
  exit 1
fi
prepare_edge="$(docker ps -q --filter 'name=supabase_edge_runtime_')"
if [[ -z "$prepare_edge" ]]; then
  echo "Preparation stack has no Edge runtime to cache" >&2
  exit 1
fi
docker inspect "$prepare_edge" --format '{{json .Mounts}}' |
  jq -c 'map({Type,Destination})'
docker exec "$prepare_edge" sh -c 'du -sh /root/.cache/deno /home/deno/.cache/deno 2>/dev/null || true'
docker pull mcr.microsoft.com/playwright:v1.60.0-noble >/dev/null

# Keep the prepared containers and their real Deno cache volume. A Docker
# commit cannot preserve mounted-volume content. The stack still contains only
# the public dependency warmer, so deny outbound traffic on its existing
# private bridge before loading any VinPoker source, schema or fixture.
project_suffix="_$(basename "$test_root")"
mapfile -t stack_containers < <(docker ps --format '{{.ID}} {{.Names}}' |
  awk -v suffix="$project_suffix" '$2 ~ suffix"$" {print $1}')
if (( ${#stack_containers[@]} < 5 )); then
  echo "Could not inventory the prepared local Supabase stack" >&2
  exit 1
fi
old_network="$(docker inspect "${stack_containers[0]}" --format '{{json .NetworkSettings.Networks}}' |
  jq -er 'keys | if length == 1 then .[0] else error("expected one preparation network") end')"
for container in "${stack_containers[@]}"; do
  container_network="$(docker inspect "$container" --format '{{json .NetworkSettings.Networks}}' |
    jq -er 'keys | if length == 1 then .[0] else error("expected one preparation network") end')"
  if [[ "$container_network" != "$old_network" ]]; then
    echo "Prepared service is not on the expected network" >&2
    exit 1
  fi
done
network="$old_network"
network_json="$(docker network inspect "$network")"
if [[ "$(jq -r '.[0].EnableIPv6' <<<"$network_json")" != "false" ]]; then
  echo "Unexpected IPv6 on Cashier E2E bridge" >&2
  exit 1
fi
subnet="$(jq -r '.[0].IPAM.Config[0].Subnet' <<<"$network_json")"
gateway="$(jq -r '.[0].IPAM.Config[0].Gateway' <<<"$network_json")"
bridge="br-$(jq -r '.[0].Id[:12]' <<<"$network_json")"
if [[ -z "$subnet" || -z "$gateway" || ! "$bridge" =~ ^br-[0-9a-f]{12}$ ]]; then
  echo "Could not resolve exact test bridge/subnet" >&2
  exit 1
fi
sudo iptables -w -N "$firewall_chain"
sudo iptables -w -A "$firewall_chain" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
sudo iptables -w -A "$firewall_chain" -d "$gateway/32" -j REJECT
sudo iptables -w -A "$firewall_chain" -d "$subnet" -j RETURN
sudo iptables -w -A "$firewall_chain" -j REJECT
sudo iptables -w -I DOCKER-USER 1 -i "$bridge" -j "$firewall_chain"
sudo iptables -w -C DOCKER-USER -i "$bridge" -j "$firewall_chain"
supabase status --output json >"$test_root/isolated-status.json" 2>"$test_root/isolated-status.err"

mapfile -t containers < <(docker ps -q --filter "network=$network")
if (( ${#containers[@]} < 5 )); then
  echo "Expected DB, Auth, API and Edge services on isolated network" >&2
  exit 1
fi
for container in "${containers[@]}"; do
  docker inspect "$container" --format '{{json .NetworkSettings.Networks}}' |
    jq -e --arg name "$network" 'keys == [$name]' >/dev/null || {
      echo "Service has another network attached" >&2
      exit 1
    }
  docker inspect "$container" --format '{{json .Config.Env}}' |
    jq -e 'all(.[]; test("^(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)=") | not)' >/dev/null || {
      echo "Service has an outbound proxy configured" >&2
      exit 1
    }
done

db_container="$(docker ps -q --filter "network=$network" --filter 'name=supabase_db_')"
edge_container="$(docker ps -q --filter "network=$network" --filter 'name=supabase_edge_runtime_')"
gateway_container="$(docker ps --filter "network=$network" --format '{{.Names}}' | grep -E '^supabase_(kong|envoy)_' | head -n 1)"
if [[ -z "$db_container" || -z "$edge_container" || -z "$gateway_container" ]]; then
  echo "Could not identify local DB, Edge and API gateway services" >&2
  exit 1
fi
browser_gateway="cashier-api"
browser_network="cashier-browser-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
docker network create --internal "$browser_network" >/dev/null
docker network connect --alias "$browser_gateway" "$browser_network" "$gateway_container"

probe_external_denied() {
  local context="$1" label="$2" status
  status="$(docker run --rm --network "container:$context" \
    mcr.microsoft.com/playwright:v1.60.0-noble \
    node -e 'fetch("http://example.com", {signal: AbortSignal.timeout(6000)}).then(r => console.log(r.status)).catch(() => console.log("blocked"))')"
  if [[ "$status" != "blocked" ]]; then
    echo "$label reached an external HTTP server (status $status)" >&2
    exit 1
  fi
  status="$(docker run --rm --network "container:$context" \
    mcr.microsoft.com/playwright:v1.60.0-noble \
    node -e 'fetch("http://1.1.1.1", {signal: AbortSignal.timeout(6000)}).then(r => console.log(r.status)).catch(() => console.log("blocked"))')"
  if [[ "$status" != "blocked" ]]; then
    echo "$label reached a direct external IP (status $status)" >&2
    exit 1
  fi
}
probe_external_denied "$db_container" DB
probe_external_denied "$edge_container" Edge

# Browser/app context is a separate disposable container on the same network,
# with no Docker socket or host networking.
browser_probe="$(docker run -d --rm --network "$browser_network" \
  mcr.microsoft.com/playwright:v1.60.0-noble sleep 90)"
probe_external_denied "$browser_probe" Browser
docker exec "$browser_probe" node -e \
  'fetch(`http://${process.argv[1]}:8000/auth/v1/health`).then(r => {if (!r.ok) process.exit(1)}).catch(() => process.exit(1))' \
  "$browser_gateway" || {
    echo "Isolated browser cannot reach local Auth/API" >&2
    exit 1
  }
docker stop "$browser_probe" >/dev/null

docker exec "$db_container" sh -c 'test -n "$POSTGRES_PASSWORD" &&
  PGPASSWORD="$POSTGRES_PASSWORD" psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
    -c "CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions" \
    -c "ALTER SYSTEM SET cron.launch_active_jobs = off" \
    -c "SELECT pg_reload_conf()"' >/dev/null
if [[ "$(docker exec "$db_container" psql -X -Atq -U postgres -d postgres -c 'SHOW cron.launch_active_jobs')" != 'off' ]]; then
  echo "Could not disable disposable DB cron jobs" >&2
  exit 1
fi
docker exec "$db_container" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -q -v ON_ERROR_STOP=1 \
  -U supabase_admin -d postgres -c "CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions"' >/dev/null

pg_net_request() {
  local url="$1" request_id response attempt
  request_id="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "SELECT net.http_get(url := '$url', timeout_milliseconds := 3000)")"
  if [[ ! "$request_id" =~ ^[0-9]+$ ]]; then
    echo "pg_net did not enqueue a request" >&2
    exit 1
  fi
  for attempt in {1..20}; do
    response="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres \
      -c "SELECT coalesce(status_code::text, 'none') || '|' || coalesce(error_msg, '') FROM net._http_response WHERE id = $request_id")"
    if [[ -n "$response" ]]; then
      printf '%s' "$response"
      return
    fi
    sleep 1
  done
  echo "pg_net request $request_id had no completed response" >&2
  exit 1
}
internal_result="$(pg_net_request "http://$gateway_container:8000/auth/v1/health")"
if [[ ! "$internal_result" =~ ^2[0-9][0-9]\| ]]; then
  echo "pg_net could not reach local Auth ($internal_result)" >&2
  exit 1
fi
for target in 'http://example.com' 'http://1.1.1.1'; do
  external_result="$(pg_net_request "$target")"
  if [[ ! "$external_result" =~ ^none\|.+ ]]; then
    echo "pg_net external result is not a proved network denial ($external_result)" >&2
    exit 1
  fi
done
echo "ISOLATION_PROOF: DB/pg_net/Edge/browser outbound denied; local Auth reachable; cron off"

# Only after the network proof: restore the owner-captured current public and
# storage schema into the real local Supabase stack. Historical migrations are
# not replayable from zero; no Auth/API/Edge service or RLS rule is stubbed.
# The empty local stack ships its own Storage schema. Replace only that schema
# on this disposable, network-isolated database so the captured live definition
# can be restored without duplicate built-in types such as storage.buckettype.
storage_rows="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "SELECT (SELECT count(*) FROM storage.buckets), (SELECT count(*) FROM storage.objects)")"
if [[ "$storage_rows" != '0|0' ]]; then
  echo "Disposable Storage schema is not empty; refusing baseline replacement" >&2
  exit 1
fi
docker exec "$db_container" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -q -v ON_ERROR_STOP=1 \
  -U supabase_admin -d postgres -c "DROP SCHEMA storage CASCADE"' \
  >"$test_root/storage-replace.log" 2>&1
# The live catalog places pg_trgm operators in public, while a fresh local
# Supabase project may place that extension elsewhere (or omit it).
pg_trgm_schema="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_trgm'")"
if [[ -z "$pg_trgm_schema" ]]; then
  docker exec "$db_container" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -q -v ON_ERROR_STOP=1 \
    -U supabase_admin -d postgres -c "CREATE EXTENSION pg_trgm WITH SCHEMA public"' >/dev/null
elif [[ "$pg_trgm_schema" != public ]]; then
  docker exec "$db_container" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -q -v ON_ERROR_STOP=1 \
    -U supabase_admin -d postgres -c "ALTER EXTENSION pg_trgm SET SCHEMA public"' >/dev/null
fi
if [[ "$schema_mode" == current ]]; then
  # The public snapshot omits this private namespace and its policy dependencies.
  node "$repo_root/scripts/ops/prepare-cashier-runtime-dependencies.mjs" "$test_root/private-dependencies.sql"
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    <"$test_root/private-dependencies.sql"
  # pg_dump ACL statements assume creation defaults do not add named grantees.
  # The empty Supabase service may grant them by default to restore-created RPCs.
  # Reset only the local dump creator defaults; the captured ACLs stay authoritative.
  docker exec "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
    'SELECT pg_get_userbyid(defaclrole), defaclnamespace::regnamespace, defaclobjtype, defaclacl FROM pg_default_acl WHERE defaclobjtype = '\''f'\'';'
  docker exec "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -c \
    'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role; ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role;'
fi
set +e
docker exec -i "$db_container" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -q -v ON_ERROR_STOP=1 \
  -U supabase_admin -d postgres' \
  <"$schema_dir/live-public-schema.sql" >"$test_root/schema-restore.log" 2>&1
restore_rc=$?
set -e
if (( restore_rc != 0 )); then
  echo "Sanitized current-schema restore failed on isolated Supabase (exit $restore_rc)" >&2
  tail -n 35 "$test_root/schema-restore.log" >&2
  exit 1
fi
baseline_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "SELECT to_regclass('public.tournament_registrations') IS NOT NULL,
    to_regclass('public.cashier_buyin_movements') IS NULL")"
if [[ "$schema_mode" == pre03 && "$baseline_state" != 't|t' ]]; then
  echo "Captured baseline is incomplete or already has the Cashier migration" >&2
  exit 1
fi
cashier_migration='20270115000003_cashier_tour_money_v1.sql'
if [[ "$schema_mode" == pre03 ]]; then
set +e
timeout 10m docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
  <"$repo_root/supabase/migrations/$cashier_migration" >"$test_root/migration.log" 2>&1
migration_rc=$?
set -e
if (( migration_rc != 0 )); then
  echo "Exact Cashier migration failed on isolated current-schema baseline (exit $migration_rc)" >&2
  tail -n 45 "$test_root/migration.log" >&2
  exit 1
fi
elif [[ "$baseline_state" != 't|f' ]]; then
  echo "Contemporary runtime baseline lacks the existing Cashier schema" >&2
  exit 1
fi
applied_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "SELECT to_regclass('public.cashier_buyin_movements') IS NOT NULL,
    to_regprocedure('public.cashier_create_app_registration_v1(uuid,uuid)') IS NOT NULL,
    has_function_privilege('anon','public.cashier_create_app_registration_v1(uuid,uuid)','EXECUTE'),
    has_function_privilege('service_role','public.cashier_create_app_registration_v1(uuid,uuid)','EXECUTE'),
    (SELECT count(*) FROM public.cashier_tour_settings WHERE enabled)")"
if [[ "$applied_state" != 't|t|f|t|0' ]]; then
  echo "Cashier schema/ACL/default-off postcondition failed ($applied_state)" >&2
  exit 1
fi
if [[ "$(docker exec "$db_container" psql -X -Atq -U postgres -d postgres -c 'SHOW cron.launch_active_jobs')" != 'off' ]]; then
  echo "Disposable cron guard changed during migration" >&2
  exit 1
fi
echo "SCHEMA_PROOF: mode=$schema_mode; captured schema restored; RPC ACL and default-off verified; cron remains off"
set +e
timeout 10m docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
  <"$repo_root/supabase/pending-tests/cashier_tour_money_v1.sql" \
  >"$test_root/cashier-money-test.log" 2>&1
money_test_rc=$?
set -e
if (( money_test_rc != 0 )); then
  echo "Cashier money/seat rollback-only test failed on captured schema (exit $money_test_rc)" >&2
  tail -n 45 "$test_root/cashier-money-test.log" >&2
  exit 1
fi
echo "MONEY_PROOF: Cashier money/seat rollback-only SQL assertions passed on captured schema"

refund_migration='supabase/migration-archive/remote-history/recovered-source/20270115000011_cashier_refund_without_floor_clearance.sql'
if [[ "$schema_mode" == pre03 ]]; then
set +e
timeout 10m docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
  <"$repo_root/$refund_migration" >"$test_root/refund-migration.log" 2>&1
refund_migration_rc=$?
set -e
if (( refund_migration_rc != 0 )); then
  echo "Exact Cashier refund migration failed on isolated schema (exit $refund_migration_rc)" >&2
  tail -n 45 "$test_root/refund-migration.log" >&2
  exit 1
fi
fi
set +e
timeout 10m docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 \
  -v cashier_no_floor=on -U postgres -d postgres \
  <"$repo_root/supabase/pending-tests/cashier_tour_money_v1.sql" \
  >"$test_root/refund-money-test.log" 2>&1
refund_money_rc=$?
set -e
if (( refund_money_rc != 0 )); then
  echo "Cashier refund rollback-only assertions failed on isolated schema (exit $refund_money_rc)" >&2
  tail -n 45 "$test_root/refund-money-test.log" >&2
  exit 1
fi
echo "REFUND_PROOF: mode=$schema_mode; rollback-only waiting-seat/historical refund assertions passed"

# Load the real handlers only after outbound denial, then exercise them through
# the real local Auth, API gateway, Edge runtime and captured production schema.
rm -rf -- supabase/functions/edge-dependency-cache
cp -R "$repo_root/supabase/functions/_shared" supabase/functions/_shared
cp -R "$repo_root/supabase/functions/tournament-register" supabase/functions/tournament-register
cp -R "$repo_root/supabase/functions/sepay-reconcile" supabase/functions/sepay-reconcile

api_url="$(jq -er '.API_URL' "$test_root/isolated-status.json")"
anon_key="$(jq -er '.ANON_KEY' "$test_root/isolated-status.json")"
service_key="$(jq -er '.SERVICE_ROLE_KEY' "$test_root/isolated-status.json")"
player_email='cashier-edge-player@test.invalid'
player_password='CashierEdgeTest-2026!'
owner_email='cashier-edge-owner@test.invalid'
owner_password='CashierEdgeOwner-2026!'

create_auth_user() {
  local email="$1" password="$2" response
  response="$(jq -nc --arg email "$email" --arg password "$password" \
    '{email:$email,password:$password,email_confirm:true}' |
    curl --silent --show-error --fail-with-body --request POST \
      --header "apikey: $service_key" \
      --header "Authorization: Bearer $service_key" \
      --header 'Content-Type: application/json' \
      --data-binary @- "$api_url/auth/v1/admin/users")"
  jq -er '.id' <<<"$response"
}
player_id="$(create_auth_user "$player_email" "$player_password")"
owner_id="$(create_auth_user "$owner_email" "$owner_password")"

docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -v player_id="$player_id" -v owner_id="$owner_id" \
  <"$repo_root/supabase/pending-tests/cashier_tour_edge_fixture.sql" \
  >"$test_root/edge-fixture.log" 2>&1

registration_json="$(docker run --rm --network "$network" \
  --volume "$repo_root/supabase/pending-tests/cashier-tour-edge-register.mjs:/tests/register.mjs:ro" \
  --env API_BASE="http://$gateway_container:8000" \
  --env ANON_KEY="$anon_key" \
  --env PLAYER_EMAIL="$player_email" \
  --env PLAYER_PASSWORD="$player_password" \
  mcr.microsoft.com/playwright:v1.60.0-noble node /tests/register.mjs)"
registration_id="$(jq -er '.registration_id' <<<"$registration_json")"
reference_code="$(jq -er '.reference_code' <<<"$registration_json")"
uuid_pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
if [[ ! "$registration_id" =~ $uuid_pattern || ! "$player_id" =~ $uuid_pattern ]]; then
  echo "Auth/Edge returned a malformed UUID" >&2
  exit 1
fi
if [[ "$(jq -er '.player_id' <<<"$registration_json")" != "$player_id" ]]; then
  echo "Authenticated Edge registration returned another player" >&2
  exit 1
fi

fake_sepay="$(docker run -d --rm --name "cashier-fake-sepay-${GITHUB_RUN_ID:-local}" \
  --network "$network" --network-alias fake-sepay \
  --volume "$repo_root/supabase/pending-tests/fake-sepay-server.mjs:/tests/server.mjs:ro" \
  --env REFERENCE_CODE="$reference_code" \
  mcr.microsoft.com/playwright:v1.60.0-noble node /tests/server.mjs)"
ephemeral_containers+=("$fake_sepay")
for _ in {1..30}; do
  if docker exec "$fake_sepay" node -e \
    'fetch("http://127.0.0.1:8787/v2/transactions?account_number=999100001").then(r=>process.exit(r.status===401?0:1)).catch(()=>process.exit(1))'; then
    break
  fi
  sleep 1
done

wrong_secret_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --request POST --header 'X-Reconcile-Secret: wrong-test-secret' \
  "$api_url/functions/v1/sepay-reconcile")"
if [[ "$wrong_secret_status" != 401 ]]; then
  echo "SePay reconcile accepted an invalid shared secret ($wrong_secret_status)" >&2
  exit 1
fi
first_reconcile="$(curl --silent --show-error --fail-with-body --request POST \
  --header 'X-Reconcile-Secret: cashier-edge-reconcile-test' \
  "$api_url/functions/v1/sepay-reconcile")"
second_reconcile="$(curl --silent --show-error --fail-with-body --request POST \
  --header 'X-Reconcile-Secret: cashier-edge-reconcile-test' \
  "$api_url/functions/v1/sepay-reconcile")"
if [[ "$(jq -r '.ok' <<<"$first_reconcile")" != true ||
      "$(jq -r '.settled' <<<"$first_reconcile")" != 1 ||
      "$(jq -r '.ok' <<<"$second_reconcile")" != true ||
      "$(jq -r '.settled' <<<"$second_reconcile")" != 0 ]]; then
  echo "SePay reconcile did not settle exactly once" >&2
  exit 1
fi

edge_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  "SELECT
    (SELECT count(*) FROM public.tournament_registrations WHERE id='$registration_id'::uuid),
    (SELECT count(*) FROM public.tournament_registrations
      WHERE tournament_id='a3000000-0000-4000-8000-000000000001' AND player_id='$player_id'::uuid),
    (SELECT count(*) FROM public.cashier_buyin_movements WHERE registration_id='$registration_id'::uuid),
    (SELECT count(*) FROM public.seat_draw_receipts WHERE registration_id='$registration_id'::uuid),
    (SELECT count(*) FROM public.notifications WHERE user_id='$player_id'::uuid
      AND data->>'registration_id'='$registration_id'),
    (SELECT status='confirmed' AND cashier_paid_at IS NOT NULL
      FROM public.tournament_registrations WHERE id='$registration_id'::uuid),
    (SELECT count(*) FROM public.bank_transactions WHERE provider_txn_id='cashier-edge-bank-1');")"
if [[ "$edge_state" != '1|1|1|1|1|t|1' ]]; then
  echo "Auth/Edge idempotency or seat/receipt postcondition failed ($edge_state)" >&2
  exit 1
fi
echo "EDGE_PROOF: real local Auth + gateway + tournament-register + fake-SePay reconcile produced one payment, seat, receipt and notice"

refund_fixture="$(docker exec -i "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 \
  -v player_id="$player_id" -v owner_id="$owner_id" -U postgres -d postgres \
  <"$repo_root/supabase/pending-tests/cashier_tour_real_refund_fixture.sql")"
refund_registration_id="$(jq -er '.registration_id' <<<"$refund_fixture")"
refund_reference_code="$(jq -er '.reference_code' <<<"$refund_fixture")"
if [[ ! "$refund_registration_id" =~ $uuid_pattern || -z "$refund_reference_code" ]]; then
  echo "Disposable waiting-seat refund fixture is invalid" >&2
  exit 1
fi

# Build the real UI against this local gateway and render it in Chromium. The
# browser performs real Auth/Data API calls; no request route is intercepted.
(cd "$repo_root" && \
  VITE_SUPABASE_URL="http://$browser_gateway:8000" \
  VITE_SUPABASE_PUBLISHABLE_KEY="$anon_key" \
  VITE_OPS_TOUR_CASHIER=production \
  npm run build >/dev/null)
app_container="$(docker run -d --rm --network "$browser_network" --network-alias cashier-app \
  --volume "$repo_root:/app:ro" --workdir /app \
  mcr.microsoft.com/playwright:v1.60.0-noble \
  node /app/supabase/pending-tests/static-preview-server.mjs)"
ephemeral_containers+=("$app_container")
app_ready=false
for _ in {1..60}; do
  if docker exec "$app_container" node -e \
    'fetch("http://127.0.0.1:8080/ops/cashier/tour").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'; then
    app_ready=true
    break
  fi
  sleep 1
done
if [[ "$app_ready" != true ]]; then
  echo "Cashier UI preview did not become ready" >&2
  docker logs "$app_container" --tail 40 >&2
  exit 1
fi
storage_key="sb-${browser_gateway%%.*}-auth-token"
docker run --rm --network "$browser_network" \
  --volume "$repo_root:/app:ro" --workdir /app \
  --env PLAYWRIGHT_BASE_URL='http://cashier-app:8080' \
  --env LOCAL_SUPABASE_URL="http://$browser_gateway:8000" \
  --env LOCAL_SUPABASE_ANON_KEY="$anon_key" \
  --env LOCAL_OWNER_EMAIL="$owner_email" \
  --env LOCAL_OWNER_PASSWORD="$owner_password" \
  --env LOCAL_SUPABASE_STORAGE_KEY="$storage_key" \
  --env LOCAL_REFUND_REGISTRATION_ID="$refund_registration_id" \
  --env LOCAL_REFUND_REFERENCE_CODE="$refund_reference_code" \
  mcr.microsoft.com/playwright:v1.60.0-noble \
  npx playwright test e2e/cashier-tour-real.spec.ts --output=/tmp/cashier-playwright-results
echo "BROWSER_PROOF: real Chromium rendered the seated Cashier row through local Auth and Data API without interception"

refund_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  "SELECT (SELECT status='paid' FROM public.cashier_refund_requests WHERE registration_id='$refund_registration_id'::uuid),
    (SELECT status='cancelled' FROM public.tournament_registrations WHERE id='$refund_registration_id'::uuid),
    (SELECT coalesce(sum(applied_amount),0) FROM public.cashier_buyin_movements
      WHERE registration_id='$refund_registration_id'::uuid AND purpose='refund' AND direction='out'),
    (SELECT count(*) FROM public.cashier_buyin_movements
      WHERE registration_id='$refund_registration_id'::uuid AND purpose='refund' AND direction='out'),
    (SELECT count(*) FROM public.tournament_entries WHERE registration_id='$refund_registration_id'::uuid),
    (SELECT count(*) FROM public.seat_draw_receipts WHERE registration_id='$refund_registration_id'::uuid);")"
if [[ "$refund_state" != 't|t|6600000|1|0|0' ]]; then
  echo "Browser waiting-seat refund postcondition failed ($refund_state)" >&2
  exit 1
fi
echo "REFUND_BROWSER_PROOF: Tour B waiting-seat refund paid once, registration closed, no seat/receipt"
