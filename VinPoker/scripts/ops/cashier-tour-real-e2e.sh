#!/usr/bin/env bash
set -euo pipefail
umask 077
repo_root="$(pwd)"
schema_dir="${SCHEMA_ARTIFACT_DIRECTORY:-}"
schema_mode="${CASHIER_SCHEMA_MODE:-pre03}"
realtime_mode="${LOCAL_OPERATIONS_REALTIME:-0}"
case "$schema_mode" in
  pre03) ;;
  current)
    # Explicit contemporary runtime qualification, not historical migration proof.
    expected_schema_sha=d23cfa75a7381453ba0d6216346f6460c816a3b1525ef5d47984c3a995ddc56a
    ;;
  *) echo "Unsupported Cashier schema mode" >&2; exit 1 ;;
esac
if [[ "$realtime_mode" != 0 && "$realtime_mode" != 1 ]] || [[ "$realtime_mode" == 1 && "$schema_mode" != current ]]; then
  echo "Realtime timing requires explicit contemporary isolated mode" >&2
  exit 1
fi
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

source_sha="$(git -C "$repo_root" rev-parse HEAD)"
[[ "$source_sha" =~ ^[a-f0-9]{40}$ ]]

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
  local exit_code=$?
  if [[ -n "${race_control_pid:-}" && -n "${db_container:-}" ]]; then
    docker exec "$db_container" psql -X -Atq -U postgres -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='isolated_checkout_policy_control';" >/dev/null 2>&1 || true
    kill "$race_control_pid" 2>/dev/null || true
    wait "$race_control_pid" 2>/dev/null || true
  fi
  if [[ -n "${race_browser_container:-}" ]]; then docker rm -f "$race_browser_container" >/dev/null 2>&1 || true; fi
  if [[ -n "${race_browser_pid:-}" ]]; then kill "$race_browser_pid" 2>/dev/null || true; wait "$race_browser_pid" 2>/dev/null || true; fi
  if [[ "$exit_code" != 0 && -n "${edge_container:-}" ]]; then
    mkdir -p "$repo_root/output/operations-latency"
    # Emit fixed classifications only; never persist raw handler logs/claims.
    docker logs "$edge_container" --tail 200 2>&1 | node --input-type=module -e '
      import {readFileSync} from "node:fs";
      const raw=readFileSync(0,"utf8");
      const markers=Object.fromEntries(["BOOT_ERROR","Module not found","failed to create the graph","failed to load module","error sending request for url","AuthSessionMissingError","Invalid JWT","Network is unreachable"].map(marker=>[marker,raw.split(marker).length-1]));
      const referencedPublicImports=["https://esm.sh/@supabase/supabase-js@2.45.0","https://esm.sh/@supabase/supabase-js@2"].filter(specifier=>raw.includes(specifier));
      process.stdout.write(JSON.stringify({kind:"SANITIZED_ISOLATED_EDGE_BOOT_CLASSIFICATIONS",qualification:false,markers,referencedPublicImports}));
    ' >"$repo_root/output/operations-latency/edge-boot-http.json" || true
  fi
  if [[ "$exit_code" != 0 && "$realtime_mode" == 1 && -n "${db_container:-}" ]]; then
    mkdir -p "$repo_root/output/operations-latency"
    # Fixed catalog fields only: no environment, credentials, claims or rows.
    docker exec -i "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
      >"$repo_root/output/operations-latency/realtime-runtime-http.json" <<'REALTIME_DIAGNOSTIC' || true
SELECT jsonb_build_object(
 'kind','ISOLATED_REALTIME_CATALOG_DIAGNOSTIC','qualification',false,
 'walLevel',current_setting('wal_level'),
 'attendancePublication',(SELECT jsonb_agg(jsonb_build_object('publication',pubname,'insert',pubinsert,'update',pubupdate,'delete',pubdelete))
   FROM pg_publication p WHERE EXISTS(SELECT 1 FROM pg_publication_rel r WHERE r.prpubid=p.oid AND r.prrelid='public.dealer_attendance'::regclass)),
 'slots',(SELECT jsonb_agg(jsonb_build_object('plugin',plugin,'active',active,'walStatus',wal_status,'retainedBytes',pg_wal_lsn_diff(pg_current_wal_lsn(),restart_lsn),'unconfirmedBytes',pg_wal_lsn_diff(pg_current_wal_lsn(),confirmed_flush_lsn))) FROM pg_replication_slots),
 'replication',(SELECT jsonb_agg(jsonb_build_object('state',state,'syncState',sync_state)) FROM pg_stat_replication),
 'attendanceReplicaIdentity',(SELECT relreplident FROM pg_class WHERE oid='public.dealer_attendance'::regclass),
 'subscriptions',(SELECT jsonb_agg(jsonb_build_object('entity',to_jsonb(s)->>'entity','role',to_jsonb(s)->>'claims_role','filters',to_jsonb(s)->'filters')) FROM realtime.subscription s),
 'realtimeFunctionPrivileges',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'function',p.proname,'executable',has_function_privilege('supabase_realtime_admin',p.oid,'EXECUTE')))
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE (n.nspname='realtime' AND p.proname IN ('apply_rls','list_changes')) OR (n.nspname='pg_catalog' AND p.proname='pg_logical_slot_get_changes')));
REALTIME_DIAGNOSTIC
    docker exec -i "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
      >"$repo_root/output/operations-latency/realtime-rls-http.json" <<'REALTIME_RLS_DIAGNOSTIC' || true
BEGIN;
SET LOCAL statement_timeout='5s';
DO $diagnostic$
DECLARE source_row public.dealer_attendance;input_wal jsonb;diagnostic jsonb;
BEGIN
 SELECT a.* INTO STRICT source_row FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id
 WHERE d.club_id='a2000000-0000-4000-8000-000000000001' ORDER BY a.check_in_time LIMIT 1;
 input_wal:=jsonb_build_object('action','I','schema','public','table','dealer_attendance','timestamp',clock_timestamp(),
  'pk',jsonb_build_array(jsonb_build_object('name','id','type','uuid')),
  'columns',jsonb_build_array(jsonb_build_object('name','id','type','uuid','value',source_row.id),
   jsonb_build_object('name','dealer_id','type','uuid','value',source_row.dealer_id),
   jsonb_build_object('name','status','type','text','value',source_row.status)));
 SELECT jsonb_build_object('kind','REAL_APPLY_RLS_CONTROLLED_INPUT_DIAGNOSTIC','qualification',false,
  'authenticatedPkSelect',has_column_privilege('authenticated','public.dealer_attendance','id','SELECT'),
  'results',jsonb_agg(jsonb_build_object('rlsEnabled',r.is_rls_enabled,'authorizedSubscriptionCount',coalesce(cardinality(r.subscription_ids),0),'errors',r.errors)))
 INTO diagnostic FROM realtime.apply_rls(input_wal,1048576) r;
 PERFORM set_config('vinpoker.realtime_rls_diagnostic',diagnostic::text,true);
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('vinpoker.realtime_rls_diagnostic',jsonb_build_object('kind','REAL_APPLY_RLS_CONTROLLED_INPUT_DIAGNOSTIC','qualification',false,'sqlState',SQLSTATE)::text,true);
END $diagnostic$;
SELECT current_setting('vinpoker.realtime_rls_diagnostic');
ROLLBACK;
REALTIME_RLS_DIAGNOSTIC
    # Separate temporary slot; never drain or reset the service's own slots.
    # This extra canonical fixture write happens only after a failed test and
    # is diagnostic, not a measured HTTP/UI sample or an acceptance pass.
    docker exec -i "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
      >"$repo_root/output/operations-latency/realtime-decoding-http.json" <<'REALTIME_DECODING_DIAGNOSTIC' || true
SET statement_timeout='10s';
SELECT pg_create_logical_replication_slot('cashier_failed_probe','wal2json',true) \g /dev/null
BEGIN;
SET LOCAL statement_timeout='5s';
SET LOCAL request.jwt.claim.sub='';
SELECT set_config('request.jwt.claims',(SELECT claims::text FROM realtime.subscription WHERE entity='public.dealer_attendance'::regclass LIMIT 1),true) \g /dev/null
SET LOCAL ROLE authenticated;
DO $probe$
DECLARE dealer uuid;r jsonb;
BEGIN
 SELECT d.id INTO STRICT dealer FROM public.dealers d WHERE d.club_id='a2000000-0000-4000-8000-000000000001'
  AND NOT EXISTS(SELECT 1 FROM public.dealer_attendance a WHERE a.dealer_id=d.id) ORDER BY d.id LIMIT 1;
 r:=public.operator_check_in_dealer_v1(dealer,'a2000000-0000-4000-8000-000000000001','ad300000-0000-4000-8000-000000000001',gen_random_uuid());
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'isolated_decoding_probe_write_failed';END IF;
END $probe$;
COMMIT;
WITH decoded AS MATERIALIZED (
 SELECT data::jsonb AS packet FROM pg_logical_slot_get_changes('cashier_failed_probe',NULL,100,
  'format-version','2','include-pk','true','include-timestamp','true','include-type-oids','true',
  'include-transaction','false','actions','insert','add-tables','public.dealer_attendance'))
SELECT jsonb_build_object('kind','ACTUAL_FIXTURE_WAL_DECODING_DIAGNOSTIC','qualification',false,
 'listChangesResult',(SELECT pg_get_function_result(oid) FROM pg_proc WHERE oid='realtime.list_changes(name,name,integer,integer)'::regprocedure),
 'packets',jsonb_agg(jsonb_build_object('action',packet->>'action','primaryKeyCount',jsonb_array_length(packet->'pk'),
  'columnCount',jsonb_array_length(packet->'columns'),'rlsResults',(SELECT jsonb_agg(jsonb_build_object('authorizedSubscriptionCount',coalesce(cardinality(r.subscription_ids),0),'errors',r.errors)) FROM realtime.apply_rls(packet,1048576) r))))
FROM decoded;
SELECT pg_drop_replication_slot('cashier_failed_probe') \g /dev/null
REALTIME_DECODING_DIAGNOSTIC
    if [[ -n "${realtime_container:-}" ]]; then
      docker logs "$realtime_container" --tail 300 2>&1 | node --input-type=module -e '
        import {readFileSync} from "node:fs";
        const raw=readFileSync(0,"utf8");
        const deniedFunctions=[...new Set([...raw.matchAll(/permission denied for function ([a-zA-Z_][a-zA-Z_0-9.]*)/g)].map(match=>match[1]))];
        const deniedSchemas=[...new Set([...raw.matchAll(/permission denied for schema ([a-zA-Z_][a-zA-Z_0-9]*)/g)].map(match=>match[1]))];
        const markers=Object.fromEntries(["Postgrex.Error","ErrorPolling","ReplicationPoller","apply_rls","list_changes","insufficient_privilege","row-level security","too_many_connections"].map(marker=>[marker,raw.split(marker).length-1]));
        process.stdout.write(JSON.stringify({kind:"SANITIZED_REALTIME_LOG_CLASSIFICATIONS",qualification:false,deniedFunctions,deniedSchemas,markers}));
      ' >"$repo_root/output/operations-latency/realtime-log-http.json" || true
    fi
  fi
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
if [[ "$realtime_mode" == 1 ]]; then
  # Same pinned PG17 image used by the HUD stack. The CLI default image has a
  # reproduced denied-EXECUTE crash; retain real RLS/permission checks instead.
  mkdir -p supabase/.temp
  printf '%s' '17.6.1.155@sha256:3866d94d8426927e8db3f1c5d790752292bfbe27b5f1f46e199ae1b7d3c1710b' >supabase/.temp/postgres-version
fi
if grep -q 'orlesggcjamwuknxwcpk' supabase/config.toml; then
  echo "Refusing production project config" >&2
  exit 1
fi

# Warm only the public package dependencies needed by the real handlers.
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
  'verify_jwt = false' \
  '[functions.checkout-dealer]' \
  'verify_jwt = true' \
  '[functions.tournament-reentry]' \
  'verify_jwt = true' >>supabase/config.toml
printf '%s\n' \
  'SEPAY_RECONCILE_SECRET=cashier-edge-reconcile-test' \
  'SEPAY_AUTO_CONFIRM=true' \
  'SEPAY_API_BASE=http://fake-sepay:8787' >supabase/functions/.env

# The temporary project has no application migrations or function source.
# This first start only downloads/prepares the pinned CLI service images.
exclude_services="imgproxy,logflare,mailpit,postgres-meta,realtime,storage-api,studio,supavisor,vector"
if [[ "$realtime_mode" == 1 ]]; then exclude_services="${exclude_services/realtime,/}";fi
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
if [[ "$realtime_mode" == 1 ]]; then
  realtime_container="$(docker ps -q --filter "network=$network" --filter 'name=supabase_realtime_')"
  [[ -n "$realtime_container" ]]
  echo "REALTIME_IMAGE_PROOF:$(docker inspect --format '{{.Config.Image}}' "$realtime_container")"
  probe_external_denied "$realtime_container" Realtime
  [[ "$(docker inspect --format '{{.Config.Image}}' "$db_container")" == 'ghcr.io/supabase/postgres:17.6.1.155@sha256:3866d94d8426927e8db3f1c5d790752292bfbe27b5f1f46e199ae1b7d3c1710b' ]]
fi

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
  docker exec -i "$db_container" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres' <<'CREATOR_DEFAULTS'
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role;
CREATOR_DEFAULTS
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
# Exact later cursor contracts required by the current Edge consumer. This is
# a disposable, already outbound-isolated stack; no remote database is touched.
docker exec "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  'CREATE SCHEMA IF NOT EXISTS private; REVOKE ALL ON SCHEMA private FROM PUBLIC,anon,authenticated;'
for cursor_migration in 20270128000142_sepay_settlement_fair_batch_v1.sql 20270128000195_sepay_pull_progress_v1.sql 20270128000196_sepay_pull_total_fence_v2.sql; do
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    <"$repo_root/supabase/migrations/$cursor_migration"
done
missing_contracts="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  "SELECT string_agg(required.name,',') FROM unnest(ARRAY['cashier_record_verified_bank_v1','cashier_retry_paid_seating_v1','sepay_checkpoint_pull_v2','sepay_claim_pull_v2','sepay_get_active_payment_clubs','sepay_get_club_api_token','sepay_ingest_verified_transactions','sepay_take_settlement_batch_v1','settle_bank_transaction']) required(name) WHERE NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=required.name);")"
if [[ -n "$missing_contracts" ]]; then echo "Missing current Edge RPC contracts: $missing_contracts" >&2; exit 1; fi
echo "EDGE_DEPENDENCY_PROOF: captured baseline plus exact SePay142/195/196; all9 current RPC contracts present; not untouched-baseline-only runtime proof"
if [[ "$schema_mode" == current ]]; then
  # Contemporary operation timing only; do not change historical pre03 proof.
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'REPORT_PREFLIGHT'
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND NOT attisdropped
  AND ((attname='version' AND atttypid='text'::regtype AND attnotnull)
    OR (attname='name' AND atttypid='text'::regtype)
    OR (attname='statements' AND atttypid='text[]'::regtype)))<>3
 THEN RAISE EXCEPTION 'isolated_report_ledger_shape_drift'; END IF;
END $$;
REPORT_PREFLIGHT
  # Exact read-only contracts absent from the captured baseline. Their source
  # definition/dependency guards remain intact; no migration guard is rewritten.
  for report_migration in 20270128000090_public_clock_projection_v1.sql 20270128000264_finance_summary_business_dates_v2.sql; do
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
      <"$repo_root/supabase/migrations/$report_migration"
  done
  echo "REPORT_SCHEMA_PROOF: exact90/264 plus pinned private clock readers; disposable current runtime only"
  # The retained baseline predates the existing session-label uniqueness fix.
  # Keep its canonical function-body precondition intact; otherwise a second
  # open on a closed physical table conflicts with the legacy empty label.
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    <"$repo_root/supabase/migrations/20270128000026_floor_open_session_name_integrity_v1.sql"
  echo "FLOOR_SCHEMA_PROOF: exact26 session-label fix added only to the disposable current runtime"
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    <"$repo_root/supabase/migrations/20261030050418_dealer_table_arrival_ack_v1.sql"
  echo "ARRIVAL_SCHEMA_PROOF: exact arrival acknowledgement contract; no assignment or payroll writer replacement"
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    <"$repo_root/supabase/migrations/20270128000289_dealer_checkout_atomic_v1.sql"
  echo "CHECKOUT_SCHEMA_PROOF: exact289 with original dependency/collision guards; disposable current runtime only"
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    <"$repo_root/supabase/migrations/20270128000112_cashier_cash_intent_receipts_v1.sql"
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'CASH_INTENT_PARITY'
DO $$ BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.cashier_record_cash_buyin_v1(uuid,bigint,uuid)'::regprocedure)<>'96a76df15097db2e6186763497e5420c'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.resolve_cashier_cash_buyin_intent_v1(jsonb,text)'::regprocedure)<>'563ea4b337a1b3762a82a75ddce68901'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='floor_private.cashier_cash_existing_intent_v1(uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure)<>'65eb0f8a93dcf03c4238be8af03b2768'
 OR has_function_privilege('anon','public.resolve_cashier_cash_buyin_intent_v1(jsonb,text)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.resolve_cashier_cash_buyin_intent_v1(jsonb,text)','EXECUTE')
 THEN RAISE EXCEPTION 'isolated_cash_intent_production_contract_mismatch';END IF;
END $$;
CASH_INTENT_PARITY
  echo "CASH_INTENT_SCHEMA_PROOF: exact112 original guards and three read-only production body fingerprints; partial-payment contract only, not modern seating"
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'CHECKIN_PREFLIGHT'
DO $$ BEGIN
 IF to_regprocedure('public.operator_check_in_dealer_v1(uuid,uuid,uuid,uuid)') IS NOT NULL
 OR to_regprocedure('public.get_dealer_checkin_receipt_v1(uuid,uuid,uuid,uuid)') IS NOT NULL
 OR to_regprocedure('floor_private.floor_table_v3_actor_is_dealer_operator(uuid,uuid)') IS NULL
 OR to_regprocedure('floor_private.floor_table_v3_save_receipt(uuid,text,uuid,text,jsonb)') IS NULL
 THEN RAISE EXCEPTION 'isolated_checkin_fixture_catalog_drift';END IF;
END $$;
CHECKIN_PREFLIGHT
  for checkin_migration in 20270128000014_dealer_checkin_club_shift_receipt_v1.sql 20270128000051_dealer_checkin_receipt_reconciliation_v1.sql; do
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
      <"$repo_root/supabase/migrations/$checkin_migration"
  done
  echo "CHECKIN_SCHEMA_PROOF: exact14/51 added only to the disposable contemporary runtime; no historical migration or production claim"
  if [[ "$realtime_mode" == 1 ]]; then
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'REALTIME_FIXTURE'
DO $$ DECLARE source_table text;BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN RAISE EXCEPTION 'isolated_realtime_publication_missing';END IF;
 -- Match the read-only production catalog. Missing Floor sources must be
 -- reconciled through authorized RPCs; publishing everything hides the gap.
 FOREACH source_table IN ARRAY ARRAY['dealer_attendance','dealer_assignments','tournament_seats','tournament_chip_counts'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_publication_rel r JOIN pg_publication p ON p.oid=r.prpubid WHERE p.pubname='supabase_realtime' AND r.prrelid=to_regclass('public.'||source_table)) THEN
   EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',source_table);
  END IF;
 END LOOP;
 FOREACH source_table IN ARRAY ARRAY['table_sessions','tournament_tables','tournament_entries'] LOOP
  IF EXISTS(SELECT 1 FROM pg_publication_rel r JOIN pg_publication p ON p.oid=r.prpubid WHERE p.pubname='supabase_realtime' AND r.prrelid=to_regclass('public.'||source_table)) THEN
   RAISE EXCEPTION 'isolated_production_publication_drift: %',source_table;
  END IF;
 END LOOP;
END $$;
REALTIME_FIXTURE
    echo "REALTIME_FIXTURE_PROOF:production-matching attendance/assignment/seat/chip publications;session/table/entry absent;existingRLSretained;noquotaoverride"
  fi
fi
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
if [[ "$schema_mode" == current ]]; then
  cp -R "$repo_root/supabase/functions/checkout-dealer" supabase/functions/checkout-dealer
  cp -R "$repo_root/supabase/functions/tournament-reentry" supabase/functions/tournament-reentry
fi

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

# Independent users in the same isolated club, using real local Auth. Keep
# credentials in the private temporary directory, never in published artifacts.
staff_fixture='[]'
for staff_index in {1..20}; do
  staff_email="cashier-latency-$staff_index@test.invalid"
  staff_password='CashierLatencyFixture-2026!'
  staff_id="$(create_auth_user "$staff_email" "$staff_password")"
  [[ "$staff_id" =~ ^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[a-f0-9]{12}$ ]]
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -v staff_id="$staff_id" -v staff_index="$staff_index" -v owner_id="$owner_id" <<'STAFF_FIXTURE'
INSERT INTO public.profiles(user_id,display_name) VALUES(:'staff_id'::uuid,'Cashier latency TEST '||:'staff_index');
INSERT INTO public.club_cashiers(club_id,user_id,granted_by) VALUES('a2000000-0000-4000-8000-000000000001',:'staff_id'::uuid,:'owner_id'::uuid);
STAFF_FIXTURE
  if [[ "$schema_mode" == current ]]; then
    docker exec "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
      "INSERT INTO public.club_dealer_controls(club_id,user_id,granted_by) VALUES('a2000000-0000-4000-8000-000000000001','$staff_id'::uuid,'$owner_id'::uuid);"
  fi
  staff_fixture="$(jq -c --arg email "$staff_email" --arg password "$staff_password" '.+[{email:$email,password:$password}]' <<<"$staff_fixture")"
done
printf '%s' "$staff_fixture" >"$test_root/staff-private.json"
checkin_fixture_enabled=''
if [[ "$schema_mode" == current ]]; then
  other_owner_id="$(create_auth_user 'other-owner-latency@test.invalid' 'OtherOwnerLatencyFixture-2026!')"
  [[ "$other_owner_id" =~ ^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[a-f0-9]{12}$ ]]
  checkin_dealer_count=$((360 + 22 * realtime_mode))
  docker exec -i "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -v other_owner_id="$other_owner_id" -v dealer_count="$checkin_dealer_count" >"$test_root/dealer-fixture.json" <<'DEALER_FIXTURE'
BEGIN;
INSERT INTO public.profiles(user_id,display_name) VALUES(:'other_owner_id'::uuid,'Other tenant owner latency TEST');
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
 ('ad200000-0000-4000-8000-000000000002',:'other_owner_id'::uuid,'Other tenant check-in TEST','HCM','approved');
INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES
 ('ad300000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','HTTP latency TEST','00:00','23:59'),
 ('ad300000-0000-4000-8000-000000000002','ad200000-0000-4000-8000-000000000002','Other tenant TEST','00:00','23:59');
INSERT INTO public.dealers(club_id,user_id,full_name,status)
 SELECT 'a2000000-0000-4000-8000-000000000001',NULL,'HTTP latency TEST '||n,'active' FROM generate_series(1,:dealer_count) n;
-- One new synthetic physical asset within the canonical1..100range. The
-- inventory's numbered virtual slots are not pre-existing physical rows.
-- Table1 belongs to the legacy Cashier fixture; no existing asset is repaired.
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES
 ('af700000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','Floor session latency TEST',2,'tournament','inactive','available');
INSERT INTO public.tournaments(id,club_id,name,status,live_status,start_time,buy_in,rake_amount,service_fee_amount,current_level)
VALUES('af300000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','Floor read cadence TEST','registering','registering',now(),1000000,0,0,1);
CREATE TEMP TABLE floor_read_assets AS SELECT n,md5('http-floor-cadence-asset-'||n)::uuid game_table_id FROM generate_series(1,20) n;
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
SELECT game_table_id,'a2000000-0000-4000-8000-000000000001','Floor cadence TEST '||n,n+2,'tournament','inactive','available' FROM floor_read_assets;
INSERT INTO public.dealers(id,club_id,user_id,full_name,status) VALUES
 ('ad400000-0000-4000-8000-000000000002','ad200000-0000-4000-8000-000000000002',NULL,'Other tenant unchecked TEST dealer','active'),
 ('ad400000-0000-4000-8000-000000000003','ad200000-0000-4000-8000-000000000002',NULL,'Other tenant checked TEST dealer','active');
SET LOCAL request.jwt.claim.sub=:'other_owner_id';
SET LOCAL request.jwt.claims='{"role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;BEGIN
 r:=public.operator_check_in_dealer_v1('ad400000-0000-4000-8000-000000000003','ad200000-0000-4000-8000-000000000002','ad300000-0000-4000-8000-000000000002',gen_random_uuid());
 IF r->>'outcome' IS DISTINCT FROM 'checked_in' THEN RAISE EXCEPTION 'other_tenant_attendance_fixture_failed';END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.dealer_attendance WHERE dealer_id='ad400000-0000-4000-8000-000000000003' AND status='checked_in')<>1 THEN RAISE EXCEPTION 'other_tenant_attendance_fixture_missing';END IF;
END $$;
-- Separate synthetic dispatches for canonical handover measurements. These
-- are explicit initial fixture assignments, not evidence of the assign Edge.
INSERT INTO public.clubs(id,owner_id,name,region,status)
SELECT 'ad500000-0000-4000-8000-000000000001',c.user_id,'Handover latency TEST','HCM','approved'
FROM public.club_dealer_controls c WHERE c.club_id='a2000000-0000-4000-8000-000000000001'
AND NOT EXISTS(SELECT 1 FROM public.clubs owned WHERE owned.owner_id=c.user_id)
ORDER BY c.user_id LIMIT 1;
INSERT INTO public.club_dealer_controls(club_id,user_id,granted_by)
SELECT 'ad500000-0000-4000-8000-000000000001'::uuid,c.user_id,b.owner_id
FROM public.club_dealer_controls c CROSS JOIN public.clubs b
WHERE c.club_id='a2000000-0000-4000-8000-000000000001' AND b.id=c.club_id
UNION SELECT 'ad500000-0000-4000-8000-000000000001',owner_id,owner_id FROM public.clubs
WHERE id='a2000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE handover_latency AS SELECT n,md5('http-handover-table-'||n)::uuid table_id,
 md5('http-handover-session-'||n)::uuid session_id,md5('http-handover-assignment-'||n)::uuid assignment_id,
 md5('http-handover-out-dealer-'||n)::uuid outgoing_dealer,md5('http-handover-in-dealer-'||n)::uuid incoming_dealer,
 md5('http-handover-out-attendance-'||n)::uuid outgoing_attendance,md5('http-handover-in-attendance-'||n)::uuid incoming_attendance
FROM generate_series(1,23) n;
ALTER TABLE handover_latency ADD COLUMN incoming_actor uuid;
WITH actors AS (SELECT user_id,row_number() OVER(ORDER BY user_id) slot FROM public.club_dealer_controls
 WHERE club_id='a2000000-0000-4000-8000-000000000001')
UPDATE handover_latency h SET incoming_actor=a.user_id FROM actors a WHERE a.slot=1+((h.n-1)%20);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM handover_latency WHERE incoming_actor IS NULL) THEN RAISE EXCEPTION 'handover_actor_fixture_missing';END IF;END $$;
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
SELECT table_id,'ad500000-0000-4000-8000-000000000001','Handover TEST '||n,n,'cash','active','available' FROM handover_latency;
INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,control_mode,control_epoch,revision)
SELECT session_id,'ad500000-0000-4000-8000-000000000001',table_id,'cash','manual',1,1 FROM handover_latency;
INSERT INTO public.dealers(id,club_id,user_id,full_name,status)
SELECT outgoing_dealer,'ad500000-0000-4000-8000-000000000001'::uuid,NULL::uuid,'Handover outgoing TEST '||n,'active' FROM handover_latency
UNION ALL SELECT incoming_dealer,'ad500000-0000-4000-8000-000000000001',incoming_actor,'Handover incoming TEST '||n,'active' FROM handover_latency;
INSERT INTO public.dealer_attendance(id,dealer_id,status,check_in_time,current_state,pre_assigned_table_id,pre_assigned_at)
SELECT outgoing_attendance,outgoing_dealer,'checked_in',now()-interval '1 hour','assigned',NULL::uuid,NULL::timestamptz FROM handover_latency
UNION ALL SELECT incoming_attendance,incoming_dealer,'checked_in',now()-interval '1 hour','pre_assigned',table_id,now()-interval '1 minute' FROM handover_latency;
INSERT INTO public.dealer_assignments(id,attendance_id,dealer_id,club_id,table_id,table_session_id,status,assigned_at,swing_due_at,version,pre_assigned_attendance_id,pre_assigned_at)
SELECT assignment_id,outgoing_attendance,outgoing_dealer,'ad500000-0000-4000-8000-000000000001',table_id,session_id,'assigned',now()-interval '30 minutes',now(),0,incoming_attendance,now()-interval '1 minute' FROM handover_latency;
SELECT jsonb_build_object('clubId','a2000000-0000-4000-8000-000000000001','shiftId','ad300000-0000-4000-8000-000000000001',
 'floorReadLoad',jsonb_build_object('tournamentId','af300000-0000-4000-8000-000000000001','gameTableIds',(SELECT jsonb_agg(game_table_id ORDER BY n) FROM floor_read_assets)),
 'handoverClubId','ad500000-0000-4000-8000-000000000001',
 'handovers',(SELECT jsonb_agg(to_jsonb(h) ORDER BY n) FROM handover_latency h),
 'floorTable',(SELECT jsonb_build_object('id',g.id,'tableNumber',g.table_number) FROM public.game_tables g
   WHERE g.id='af700000-0000-4000-8000-000000000001' AND g.club_id='a2000000-0000-4000-8000-000000000001'
   AND g.operational_status='available' AND g.table_number=2),
 'dealerIds',(SELECT jsonb_agg(id ORDER BY full_name) FROM public.dealers WHERE club_id='a2000000-0000-4000-8000-000000000001'),
 'otherClubId','ad200000-0000-4000-8000-000000000002','otherShiftId','ad300000-0000-4000-8000-000000000002','otherDealerId','ad400000-0000-4000-8000-000000000002',
 'otherAttendedDealerId','ad400000-0000-4000-8000-000000000003',
 'otherAttendanceId',(SELECT id FROM public.dealer_attendance WHERE dealer_id='ad400000-0000-4000-8000-000000000003' AND status='checked_in'));
COMMIT;
DEALER_FIXTURE
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'CLOCK_FIXTURE'
-- A separate empty TEST tournament: no modification to Cashier or Floor fixtures.
INSERT INTO public.tournaments(id,club_id,name,status,live_status,start_time,buy_in,rake_amount,service_fee_amount,current_level)
VALUES('ac300000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
 'Operations clock TEST','registering','registering',now(),1000000,0,0,1);
INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,duration_minutes,is_break)
VALUES('ac300000-0000-4000-8000-000000000001',1,100,200,200,20,false),
 ('ac300000-0000-4000-8000-000000000001',2,200,400,400,20,false);
CLOCK_FIXTURE
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'FNB_FIXTURE'
-- Explicit opening stock/menu/recipe for isolated paid-order acceptance.
-- Orders,payments,COGS and sale movements are created only by canonical RPCs.
BEGIN;
INSERT INTO public.fnb_settings(club_id,fnb_in_club_net)
VALUES('a2000000-0000-4000-8000-000000000001',true)
ON CONFLICT(club_id) DO UPDATE SET fnb_in_club_net=true;
INSERT INTO public.fnb_ingredients(id,club_id,name,stock_unit,on_hand,avg_unit_cost)
VALUES('afb10000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','Operations TEST water stock','bottle',1000,5000);
INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,tracks_inventory)
VALUES('afb20000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','Operations TEST water',20000,true);
INSERT INTO public.fnb_recipe_items(club_id,menu_item_id,ingredient_id,qty)
VALUES('a2000000-0000-4000-8000-000000000001','afb20000-0000-4000-8000-000000000001','afb10000-0000-4000-8000-000000000001',1);
COMMIT;
FNB_FIXTURE
  checkin_fixture_enabled=1
else
  printf '{}' >"$test_root/dealer-fixture.json"
fi

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
  # Keep only counts/enums from the synthetic provider; never print credentials,
  # reference codes, raw response errors or transaction/customer payloads.
  for reconcile_result in "$first_reconcile" "$second_reconcile"; do
    jq -c '{ok,clubs,settled,auto_confirm,results:[(.results // [])[]|{status,pulled,settled,partial,waiting_seat,failed,pull_status,observation_status}]}' <<<"$reconcile_result" >&2
  done
  docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
    "SELECT jsonb_build_object('registration_status',(SELECT status FROM public.tournament_registrations WHERE id='$registration_id'::uuid),'movements',(SELECT count(*) FROM public.cashier_buyin_movements WHERE registration_id='$registration_id'::uuid),'receipts',(SELECT count(*) FROM public.seat_draw_receipts WHERE registration_id='$registration_id'::uuid),'bank_rows',(SELECT count(*) FROM public.bank_transactions WHERE provider_txn_id='cashier-edge-bank-1'));" >&2
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
  VITE_FLOOR_TABLE_CONTROL_V3=preview VITE_FLOOR_UAT_ENV=preview VITE_FLOOR_REDRAW_SEAT_LOCK_V1=off \
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
mkdir -p "$repo_root/output/operations-latency"
# Share the app's already-isolated network namespace so the real browser uses
# loopback, a secure context with native crypto APIs. No browser security flags,
# crypto stubs, published host ports or external network access are needed.
run_browser_proof() {
  local paid_enabled="${1:-}" reentry_enabled="${2:-}" selector="${3:-}" buy_close_enabled="${4:-}" move_enabled="${5:-}" active_checkout_enabled="${6:-}" replacement_enabled="${7:-}" staff_salary_enabled="${8:-}"
  local -a test_args=(e2e/cashier-tour-real.spec.ts --output=/tmp/cashier-playwright-results)
  local -a container_args=()
  if [[ "$replacement_enabled" == rest-race || "$replacement_enabled" == off-race ]]; then container_args+=(--name "$race_browser_container"); fi
  if [[ -n "$selector" ]]; then test_args+=(--grep "$selector"); fi
docker run --rm "${container_args[@]}" --network "container:$app_container" \
  --volume "$repo_root:/app:ro" --workdir /app \
  --volume "$repo_root/output/operations-latency:/latency" \
  --volume "$test_root/staff-private.json:/fixtures/staff-private.json:ro" \
  --volume "$test_root/dealer-fixture.json:/fixtures/dealer-fixture.json:ro" \
  --env LOCAL_OPERATIONS_STAFF_FILE=/fixtures/staff-private.json \
  --env LOCAL_OPERATIONS_CHECKIN_ENABLED="$checkin_fixture_enabled" \
  --env LOCAL_OPERATIONS_PAID_SEATING_ENABLED="$paid_enabled" \
  --env LOCAL_OPERATIONS_REENTRY_ENABLED="$reentry_enabled" \
  --env LOCAL_OPERATIONS_BUY_CLOSE_ENABLED="$buy_close_enabled" \
  --env LOCAL_OPERATIONS_EXACT_MOVE_ENABLED="$move_enabled" \
  --env LOCAL_OPERATIONS_ACTIVE_CHECKOUT_ENABLED="$active_checkout_enabled" \
  --env LOCAL_OPERATIONS_REPLACEMENT_ENABLED="$replacement_enabled" \
  --env LOCAL_OPERATIONS_STAFF_SALARY_ENABLED="$staff_salary_enabled" \
  --env LOCAL_OPERATIONS_REALTIME="$realtime_mode" \
  --env LOCAL_OPERATIONS_DEALER_FILE=/fixtures/dealer-fixture.json \
  --env LOCAL_OPERATIONS_CHECKIN_REPORT=/latency/dealer-checkin-http.json \
  --env LOCAL_OPERATIONS_LATENCY_REPORT=/latency/cashier-http.json \
  --env LOCAL_OPERATIONS_SOURCE_SHA="$source_sha" \
  --env PLAYWRIGHT_BASE_URL='http://localhost:8080' \
  --env LOCAL_SUPABASE_URL="http://$browser_gateway:8000" \
  --env LOCAL_SUPABASE_ANON_KEY="$anon_key" \
  --env LOCAL_OWNER_EMAIL="$owner_email" \
  --env LOCAL_OWNER_PASSWORD="$owner_password" \
  --env LOCAL_SUPABASE_STORAGE_KEY="$storage_key" \
  --env LOCAL_REFUND_REGISTRATION_ID="$refund_registration_id" \
  --env LOCAL_REFUND_REFERENCE_CODE="$refund_reference_code" \
  mcr.microsoft.com/playwright:v1.60.0-noble \
  npx playwright test "${test_args[@]}"
}
run_browser_proof
echo "BROWSER_PROOF: real Chromium rendered the seated Cashier row through local Auth and Data API without interception"
if [[ "$schema_mode" == current ]]; then
  checkin_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
    "SELECT (SELECT count(*) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='a2000000-0000-4000-8000-000000000001' AND a.status='checked_in' AND a.current_state='available'),
      (SELECT count(*) FROM public.table_operation_receipts WHERE operation_type='operator_check_in_dealer_v1'),
      (SELECT count(*) FROM public.dealer_attendance WHERE dealer_id='ad400000-0000-4000-8000-000000000002'),
      (SELECT count(*) FROM public.dealer_attendance WHERE dealer_id='ad400000-0000-4000-8000-000000000003' AND status='checked_in');")"
  if [[ "$checkin_state" != "$checkin_dealer_count|$((checkin_dealer_count + 1))|0|1" ]]; then echo "Check-in committed-state or tenant-denial postcondition failed ($checkin_state)" >&2; exit 1; fi
  echo "CHECKIN_COMMIT_PROOF:${checkin_dealer_count}staff attendances/receipts plus1other-tenant seeded attendance/receipt; exact retries did not duplicate; denied-write dealer unchanged"
  cash_intent_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
    "WITH registrations AS (SELECT r.* FROM public.tournament_registrations r WHERE r.tournament_id='a3000000-0000-4000-8000-000000000001'
      AND r.player_id IN (SELECT user_id FROM public.club_cashiers WHERE club_id='a2000000-0000-4000-8000-000000000001' AND user_id<>'$owner_id'::uuid))
     SELECT (SELECT count(*) FROM registrations),(SELECT bool_and(status='pending' AND cashier_paid_at IS NULL) FROM registrations),
      (SELECT count(*) FROM public.cashier_buyin_movements m JOIN registrations r ON r.id=m.registration_id WHERE m.direction='in' AND m.purpose='buyin'),
      (SELECT sum(m.applied_amount) FROM public.cashier_buyin_movements m JOIN registrations r ON r.id=m.registration_id WHERE m.direction='in' AND m.purpose='buyin'),
      (SELECT count(*) FROM public.tournament_entries e JOIN registrations r ON r.id=e.registration_id),
      (SELECT count(*) FROM public.table_operation_receipts WHERE operation_type='cashier_cash_buyin_v2');")"
  if [[ "$cash_intent_state" != '20|t|24|24000|0|25' ]]; then echo "Cashier partial intent committed-state conservation failed ($cash_intent_state)" >&2; exit 1; fi
  echo "CASH_INTENT_COMMIT_PROOF:20server-priced pending registrations;24cash movements/24000TEST units;25recorded/cancelled receipts;no entries or paid markers"
fi

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

if [[ "$schema_mode" == current ]]; then
  # Separate stage: preserve the earlier baseline/refund/partial-payment proof,
  # then restore the exact current allocator with its original dependency guards.
  # The public-only capture contains the allocator's helper functions but omits
  # this private blocker queue. Restore only its exact source DDL/RLS/index,
  # not unrelated mode writers. Read-only production catalog confirms ten columns.
  node --input-type=module - "$repo_root" "$test_root/paid-private-dependencies.sql" <<'PAID_PRIVATE_SOURCE'
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const source=readFileSync(process.argv[2]+'/supabase/migrations/20270128000013_floor_mode_request_safe_boundary_v1.sql','utf8').replaceAll('\r','');
const start=source.indexOf('CREATE TABLE floor_private.table_mode_requests_v1 ('),end=source.indexOf('CREATE FUNCTION floor_private.resolve_table_mode_request_v1(');
assert.ok(start>=0&&end>start);
const ddl=source.slice(start,end).trim();
assert.equal(createHash('sha256').update(ddl).digest('hex'),'ec5161591e98e6a71a4ee3cbca17e534cf02b2b56e24709604cd6a74a7aa8fda');
writeFileSync(process.argv[3],`BEGIN;\nDO $$ BEGIN IF to_regclass('floor_private.table_mode_requests_v1') IS NOT NULL THEN RAISE EXCEPTION 'isolated_paid_mode_queue_collision';END IF;END $$;\n${ddl}\nCOMMIT;\n`,{mode:0o600});
PAID_PRIVATE_SOURCE
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    <"$test_root/paid-private-dependencies.sql"
  for paid_migration in \
    20270128000113_cashier_canonical_paid_seating_v1.sql \
    20270128000114_cashier_canonical_reentry_seating_v1.sql \
    20270128000115_cashier_server_priced_reentry_v1.sql \
    20270128000117_cashier_correction_alert_seating_fence_v1.sql \
    20270128000139_cashier_paid_stack_projection_v1.sql \
    20270128000233_cashier_reentry_closed_registration_guard_v1.sql; do
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
      <"$repo_root/supabase/migrations/$paid_migration"
  done
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'PAID_SEATING_PREFLIGHT'
DO $$ BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.confirm_registration_and_assign_seat(uuid,uuid,text)'::regprocedure)<>'f1f8edbbeb1da8b2d883f6322eafdbfd'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='floor_private.pick_cashier_canonical_seat_v1(uuid,text)'::regprocedure)<>'5917c0a1566cc7f63966cf5db4997ff5'
 OR has_function_privilege('authenticated','floor_private.pick_cashier_canonical_seat_v1(uuid,text)','EXECUTE')
 OR has_function_privilege('anon','floor_private.pick_cashier_canonical_seat_v1(uuid,text)','EXECUTE')
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.cashier_create_app_reentry_v1(uuid,uuid)'::regprocedure)<>'8c1fed4cdecbccde55c7f8ba5aa7b169'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public._assign_reentry_seat(uuid,uuid,uuid,uuid,uuid,text,integer)'::regprocedure)<>'e9fe638ef857c549b69283326a91dcd9'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.floor_bust_player_v3(uuid,bigint,bigint,integer,uuid,text)'::regprocedure)<>'5e0a933c3abf478b159de9c621b53001'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.confirm_reentry_and_assign_seat(uuid,uuid,text)'::regprocedure)<>'be049df28a3fcbaf969494aee86efb7a'
 OR has_function_privilege('authenticated','public.cashier_create_app_reentry_v1(uuid,uuid)','EXECUTE')
 OR has_function_privilege('anon','public.cashier_create_app_reentry_v1(uuid,uuid)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.cashier_create_app_reentry_v1(uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'isolated_paid_seating_production_contract_mismatch';END IF;
END $$;
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
SELECT ('ac700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'a2000000-0000-4000-8000-000000000001','Full cash seating TEST '||n,22+n,'tournament','inactive','available'
FROM generate_series(1,3) n;
NOTIFY pgrst,'reload schema';
PAID_SEATING_PREFLIGHT
  echo "PAID_SEATING_SCHEMA_PROOF: exact113/114/115/117/139/233 original guards; six production body fingerprints; three new empty TEST assets only"
  run_browser_proof 1 '' 'current Cashier full payment commits canonical seats'
  paid_seating_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
    "WITH registrations AS (SELECT r.* FROM public.tournament_registrations r WHERE r.tournament_id='a3000000-0000-4000-8000-000000000001'
      AND r.player_id IN (SELECT user_id FROM public.club_cashiers WHERE club_id='a2000000-0000-4000-8000-000000000001' AND user_id<>'$owner_id'::uuid)),
     seats AS (SELECT s.* FROM public.tournament_seats s JOIN public.tournament_entries e ON e.id=s.entry_id JOIN registrations r ON r.id=e.registration_id WHERE s.is_active)
     SELECT (SELECT count(*) FROM registrations WHERE status='confirmed' AND cashier_paid_at IS NOT NULL),
      (SELECT count(*) FROM public.cashier_buyin_movements m JOIN registrations r ON r.id=m.registration_id WHERE m.direction='in' AND m.purpose='buyin'),
      (SELECT sum(m.applied_amount) FROM public.cashier_buyin_movements m JOIN registrations r ON r.id=m.registration_id WHERE m.direction='in' AND m.purpose='buyin'),
      (SELECT count(*) FROM public.tournament_entries e JOIN registrations r ON r.id=e.registration_id),
      (SELECT count(*) FROM seats),(SELECT sum(chip_count) FROM seats),
      (SELECT count(*) FROM seats s JOIN public.tournament_tables t ON t.id=s.tournament_table_id AND t.table_session_id=s.table_session_id JOIN public.table_sessions ts ON ts.id=s.table_session_id AND ts.closed_at IS NULL AND ts.game_table_id=coalesce(t.game_table_id,t.table_id) WHERE ts.tournament_id=s.tournament_id),
      (SELECT count(*) FROM public.seat_draw_receipts d JOIN registrations r ON r.id=d.registration_id WHERE d.status IN ('issued','printed')),
      (SELECT count(*) FROM public.tournament_chip_counts c JOIN public.tournament_entries e ON e.tournament_id=c.tournament_id AND e.player_id=c.player_id AND e.entry_no=c.entry_number JOIN registrations r ON r.id=e.registration_id WHERE c.chip_count=20000);")"
  if [[ "$paid_seating_state" != '20|44|132000000|20|20|400000|20|20|20' ]]; then echo "Full cash canonical seating committed-state conservation failed ($paid_seating_state)" >&2; exit 1; fi
  echo "PAID_SEATING_COMMIT_PROOF:20confirmed registrations/entries/canonical seats/tickets/stack projections;44cash movements/132000000TEST units;400000starting chips;exact retries did not duplicate"
  run_browser_proof '' 1 'current Floor bust and player reentry preserve separate paid entry generations'
  reentry_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
    "WITH registrations AS (SELECT r.* FROM public.tournament_registrations r WHERE r.tournament_id='a3000000-0000-4000-8000-000000000001'
      AND r.player_id IN (SELECT user_id FROM public.club_cashiers WHERE club_id='a2000000-0000-4000-8000-000000000001' AND user_id<>'$owner_id'::uuid)),
     entries AS (SELECT e.* FROM public.tournament_entries e JOIN registrations r ON r.id=e.registration_id)
     SELECT (SELECT count(*) FROM registrations WHERE status='confirmed' AND cashier_paid_at IS NOT NULL),
      (SELECT count(*) FROM registrations r JOIN entries e ON e.id=r.source_entry_id WHERE e.entry_no=1 AND e.status='busted' AND r.price_snapshot->>'source_entry_id'=e.id::text AND (r.price_snapshot->>'total_pay')::bigint=6600000),
      (SELECT count(*) FROM entries WHERE entry_no=1 AND status='busted' AND current_stack=0),
      (SELECT count(*) FROM entries WHERE entry_no=2 AND status='seated' AND current_stack=20000),
      (SELECT count(*) FROM public.tournament_seats s JOIN entries e ON e.id=s.entry_id WHERE s.is_active AND e.entry_no=2 AND s.chip_count=20000),
      (SELECT count(*) FROM public.cashier_buyin_movements m JOIN registrations r ON r.id=m.registration_id WHERE m.direction='in' AND m.purpose='buyin'),
      (SELECT sum(m.applied_amount) FROM public.cashier_buyin_movements m JOIN registrations r ON r.id=m.registration_id WHERE m.direction='in' AND m.purpose='buyin'),
      (SELECT count(*) FROM public.seat_draw_receipts d JOIN registrations r ON r.id=d.registration_id WHERE d.status IN ('issued','printed')),
      (SELECT count(*) FROM public.tournament_chip_counts c JOIN entries e ON e.tournament_id=c.tournament_id AND e.player_id=c.player_id AND e.entry_no=c.entry_number WHERE c.chip_count=20000),
      (SELECT count(*) FROM public.table_operation_receipts WHERE operation_type='floor_bust_player_v3'),
      (SELECT count(*) FROM public.table_operation_receipts WHERE operation_type='cashier_cash_buyin_v2');")"
  if [[ "$reentry_state" != '40|20|20|20|20|64|264000000|40|40|20|65' ]]; then echo "Reentry generation/money/receipt conservation failed ($reentry_state)" >&2; exit 1; fi
  echo "REENTRY_COMMIT_PROOF:20immutable paid source registrations/busted entries plus20new paid entry generations;20active seats;40tickets/projections;64cash movements/264000000TEST units;20bust/65cash receipts;no duplicate retries"
  # Exact current tour-revenue family. The private classifier dependency is
  # restored separately; this does not qualify or replay the Finance wrapper.
  for revenue_migration in \
    20261029092203_owner_tour_rake_live_read_v1.sql \
    20261029092520_tour_revenue_buy_close_snapshot_v1.sql \
    20261029092756_close_tournament_buy_v1.sql \
    20261029100324_tour_revenue_shared_live_source_v1.sql; do
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
      <"$repo_root/supabase/migrations/$revenue_migration"
  done
  node "$repo_root/scripts/ops/prepare-tour-revenue-runtime-dependencies.mjs" "$test_root/revenue-classifier-dependency.sql"
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    <"$test_root/revenue-classifier-dependency.sql"
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    <"$repo_root/supabase/migrations/20261029102508_tour_revenue_buy_state_read_v1.sql"
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'REVENUE_PARITY'
DO $$ DECLARE expected record;actual pg_proc%ROWTYPE;BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.get_owner_tour_rake_live_v1(uuid)','56ded9283dae799954cbc0f90914a225',true,'s'),
  ('public.get_tour_revenue_buy_close_v1(uuid)','db5a1bd401b7c4686631e2fcd21b0d3b',true,'s'),
  ('public.close_tournament_buy_v1(uuid)','bf38ef9402512db5feec27153cd91ca9',true,'v'),
  ('floor_private.tour_revenue_live_source_v1(uuid)','ba5b849a51a1abf21a14a122cc680bf6',true,'s'),
  ('floor_private.capture_tour_revenue_buy_close_v1()','df9d3c4118478ea71f8cb84b798d46e3',true,'v'),
  ('floor_private.keep_tour_revenue_snapshot_immutable_v1()','0f37eb46743e2c7305000afd299f9121',false,'v')
 ) e(signature,body_md5,definer,volatility) LOOP
  SELECT * INTO STRICT actual FROM pg_proc WHERE oid=expected.signature::regprocedure;
  IF md5(replace(actual.prosrc,chr(13),''))<>expected.body_md5 OR actual.proowner<>'postgres'::regrole
   OR actual.prosecdef<>expected.definer OR actual.provolatile::text<>expected.volatility
   OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR has_function_privilege('anon',actual.oid,'EXECUTE') OR has_function_privilege('service_role',actual.oid,'EXECUTE')
   OR has_function_privilege('authenticated',actual.oid,'EXECUTE') IS DISTINCT FROM (expected.signature LIKE 'public.%')
  THEN RAISE EXCEPTION 'isolated_revenue_production_contract_mismatch: %',expected.signature;END IF;
 END LOOP;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='floor_private.tour_revenue_buy_close_v1'::regclass)
 OR has_table_privilege('authenticated','floor_private.tour_revenue_buy_close_v1','SELECT')
 OR EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename IN ('tournaments','tournament_registrations'))
 THEN RAISE EXCEPTION 'isolated_revenue_privacy_or_publication_drift';END IF;
END $$;
NOTIFY pgrst,'reload schema';
REVENUE_PARITY
  echo "REVENUE_SCHEMA_PROOF:six current production body/owner/security/ACL fingerprints;private snapshot RLS;production-matching absent tournament/registration CDC;combined Finance wrapper not qualified"
  run_browser_proof '' '' 'current owner rake closes once and exports the immutable event-day snapshot' 1
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'REVENUE_IMMUTABILITY'
DO $$ DECLARE blocked boolean:=false;BEGIN
 BEGIN UPDATE floor_private.tour_revenue_buy_close_v1 SET captured_at=captured_at WHERE tournament_id='a3000000-0000-4000-8000-000000000001';
 EXCEPTION WHEN SQLSTATE '55000' THEN blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'isolated_revenue_snapshot_was_mutable';END IF;
END $$;
DO $$ BEGIN
 IF (SELECT count(*) FROM floor_private.tour_revenue_buy_close_v1)<>1
 OR NOT EXISTS(SELECT 1 FROM floor_private.tour_revenue_buy_close_v1 s JOIN public.tournaments t ON t.id=s.tournament_id
  WHERE s.tournament_id='a3000000-0000-4000-8000-000000000001' AND s.registration_closed_at=t.registration_closed_at
   AND s.snapshot->>'eventDay'=(t.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text
   AND s.snapshot->>'provisional'='false' AND s.snapshot->>'paidBuys'='41' AND s.snapshot->>'uniquePlayers'='21'
   AND s.snapshot->>'rake'='24600000' AND s.snapshot->>'collected'='270600000')
 THEN RAISE EXCEPTION 'isolated_revenue_saved_snapshot_mismatch';END IF;
END $$;
REVENUE_IMMUTABILITY
  echo "REVENUE_COMMIT_PROOF:one immutable event-day closure snapshot;41paid buys/21unique players;24600000rake/270600000collected TEST units;server reentry closed;actual browser CSV verified"
  # Restore the exact existing movement dependency chain only after the earlier
  # committed conservation proofs. Original migration preconditions remain intact.
  node "$repo_root/scripts/ops/prepare-cashier-runtime-dependencies.mjs" "$test_root/clock-pre32-fixture.sql" --restore-clock-pre32
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    <"$test_root/clock-pre32-fixture.sql"
  for move_migration in \
    20270128000029_floor_deferred_break_intent_v1.sql \
    20270128000032_tournament_seat_display_preservation_v1.sql \
    20270128000033_tournament_seat_move_tuple_v1.sql \
    20270128000034_floor_move_wrapper_receipt_v1.sql \
    20270128000038_floor_break_lowest_number_policy_v1.sql \
    20270128000039_floor_break_ticket_audit_v1.sql \
    20270128000040_floor_break_balanced_plan_v1.sql \
    20270128000041_floor_deferred_move_ticket_audit_v1.sql \
    20270128000042_floor_canonical_move_ticket_integrity_v1.sql \
    20270128000043_floor_move_exact_intent_v1.sql \
    20270128000048_floor_move_or_queue_exact_intent_v1.sql \
    20270128000215_multiday_canonical_seat_relocation_v1.sql; do
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
      <"$repo_root/supabase/migrations/$move_migration"
  done
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'MOVE_PARITY'
DO $$ DECLARE e record;p pg_proc%ROWTYPE;BEGIN
 FOR e IN SELECT * FROM (VALUES
  ('public.move_player_seat_v2(uuid,uuid,integer,bigint,bigint,uuid)','ff4dfb830a158cc916a520891841c80c'),
  ('public.move_player_seat_v3(uuid,uuid,integer,bigint,bigint,uuid)','57c67989cf157f1e5245a2c8fc366396'),
  ('public.move_player_seat_v4(uuid,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,text,uuid)','737256dbd19cec9d74faadf598b9e328'),
  ('public.move_player_seat_v5(uuid,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,text,uuid)','b610100979aaedd16d076728a382ed92'),
  ('public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)','00efba7f6c95125121233f5bf6dc9f48')
 ) v(signature,digest) LOOP
  SELECT * INTO STRICT p FROM pg_proc WHERE oid=e.signature::regprocedure;
  IF md5(replace(p.prosrc,chr(13),''))<>e.digest OR p.proowner<>'postgres'::regrole
   OR NOT p.prosecdef OR p.provolatile<>'v' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE')
   OR NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
  THEN RAISE EXCEPTION 'isolated_exact_move_production_contract_mismatch: %',e.signature;END IF;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
MOVE_PARITY
  run_browser_proof '' '' 'current Floor exact movement conserves paid chips and retries through HTTP' '' 1
  movement_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
    "WITH registrations AS (SELECT r.* FROM public.tournament_registrations r WHERE r.tournament_id='a3000000-0000-4000-8000-000000000001'
      AND r.player_id IN (SELECT user_id FROM public.club_cashiers WHERE club_id='a2000000-0000-4000-8000-000000000001' AND user_id<>'$owner_id'::uuid)),
     entries AS (SELECT e.* FROM public.tournament_entries e JOIN registrations r ON r.id=e.registration_id)
     SELECT (SELECT count(*) FROM registrations WHERE status='confirmed' AND cashier_paid_at IS NOT NULL),
      (SELECT count(*) FROM entries WHERE entry_no=1 AND status='busted' AND current_stack=0),
      (SELECT count(*) FROM entries WHERE entry_no=2 AND status='seated' AND current_stack=20000),
      (SELECT count(*) FROM public.tournament_seats s JOIN entries e ON e.id=s.entry_id WHERE s.is_active AND e.entry_no=2 AND s.chip_count=20000),
      (SELECT sum(s.chip_count) FROM public.tournament_seats s JOIN entries e ON e.id=s.entry_id WHERE s.is_active),
      (SELECT count(*) FROM public.cashier_buyin_movements m JOIN registrations r ON r.id=m.registration_id WHERE m.direction='in' AND m.purpose='buyin'),
      (SELECT sum(m.applied_amount) FROM public.cashier_buyin_movements m JOIN registrations r ON r.id=m.registration_id WHERE m.direction='in' AND m.purpose='buyin'),
      (SELECT count(*) FROM public.seat_draw_receipts d JOIN registrations r ON r.id=d.registration_id),
      (SELECT count(*) FROM public.seat_assignment_history h JOIN entries e ON e.id=h.entry_id WHERE h.reason='isolated exact-move latency TEST'),
      (SELECT count(*) FROM public.table_operation_receipts WHERE operation_type='move_player_seat_v5'),
      (SELECT count(*) FROM public.floor_pending_tracker_moves WHERE tournament_id='a3000000-0000-4000-8000-000000000001' AND status='pending');")"
  if [[ "$movement_state" != '40|20|20|20|400000|64|264000000|61|21|21|0' ]]; then echo "Exact movement committed chip/money/ticket/receipt conservation failed ($movement_state)" >&2; exit 1; fi
  echo "EXACT_MOVE_COMMIT_PROOF:21committed moves/21tickets/history/intent receipts;20active paid entry2 seats/400000chips;40paid registrations/64movements/264000000TEST units unchanged;no pending reservations or duplicate retries"
  # Separate stage, after the earlier assignment/attendance conservation proof.
  # The same23 incoming dealers still occupy23 cash sessions; all outgoing
  # dealers have checked out, so no available replacement fixture is invented.
  run_browser_proof '' '' 'active-table dealer checkout preserves work and reports an unstaffed table' '' '' 1
  active_checkout_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
    "WITH target AS (SELECT md5('http-handover-in-attendance-'||n)::uuid attendance_id FROM generate_series(1,23) n WHERE n<=20 OR n=23)
     SELECT (SELECT count(*) FROM public.dealer_attendance a JOIN target t ON t.attendance_id=a.id WHERE a.status='checked_out' AND a.current_state='checked_out' AND a.total_worked_minutes_today>=60),
      (SELECT count(*) FROM public.dealer_assignments a JOIN target t ON t.attendance_id=a.attendance_id WHERE a.status='completed' AND a.released_at IS NOT NULL AND a.release_reason='dealer_checkout' AND a.needs_replacement),
      (SELECT count(*) FROM private.dealer_checkout_receipts_v1 r JOIN target t ON t.attendance_id=r.attendance_id),
      (SELECT count(*) FROM public.audit_logs a JOIN target t ON t.attendance_id=a.entity_id WHERE a.action='checkout_dealer'),
      (SELECT count(*) FROM public.dealer_assignments WHERE club_id='ad500000-0000-4000-8000-000000000001' AND status='assigned' AND released_at IS NULL);")"
  if [[ "$active_checkout_state" != '21|21|21|21|2' ]]; then echo "Active checkout committed-state conservation failed ($active_checkout_state)" >&2; exit 1; fi
  echo "ACTIVE_CHECKOUT_COMMIT_PROOF:21active dealers checked out once;21released replacement-needed assignments/receipts/audits;worked minutes preserved;2other assigned tables unchanged"
  node "$repo_root/scripts/ops/prepare-dealer-replacement-runtime-dependencies.mjs" "$test_root/replacement-dependencies.sql"
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <"$test_root/replacement-dependencies.sql"
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'REPLACEMENT_FIXTURE'
BEGIN;
INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time)
VALUES('ad300000-0000-4000-8000-000000000003','ad500000-0000-4000-8000-000000000001','Replacement eligibility TEST','00:00','23:59');
INSERT INTO public.dealers(id,club_id,full_name,status,tier,skills)
SELECT md5('checkout-replacement-dealer-'||n)::uuid,'ad500000-0000-4000-8000-000000000001',
 'Replacement eligibility TEST '||n,'active','A',ARRAY['holdem'] FROM generate_series(1,3) n;
INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,current_state,check_in_time,last_released_at,pool_entered_at)
SELECT md5('checkout-replacement-attendance-'||n)::uuid,md5('checkout-replacement-dealer-'||n)::uuid,
 'ad300000-0000-4000-8000-000000000003',(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
 'checked_in','available',now()-interval '1 hour',
 now()-CASE WHEN n=3 THEN interval '1 minute' ELSE interval '20 minutes' END,
 now()-CASE WHEN n=3 THEN interval '1 minute' ELSE interval '20 minutes' END FROM generate_series(1,3) n;
INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES('ad500000-0000-4000-8000-000000000001',false)
ON CONFLICT(club_id) DO UPDATE SET auto_swing_enabled=false;
NOTIFY pgrst,'reload schema';
COMMIT;
REPLACEMENT_FIXTURE
  run_browser_proof '' '' 'active checkout respects automatic OFF and rested replacement eligibility' '' '' '' off
  docker exec "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "UPDATE public.club_settings SET auto_swing_enabled=true WHERE club_id='ad500000-0000-4000-8000-000000000001';"
  run_browser_proof '' '' 'active checkout respects automatic OFF and rested replacement eligibility' '' '' '' on
  replacement_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
    "SELECT (SELECT count(*) FROM public.dealer_assignments WHERE club_id='ad500000-0000-4000-8000-000000000001' AND status='assigned' AND released_at IS NULL),
      (SELECT count(*) FROM public.dealer_attendance WHERE id IN(md5('checkout-replacement-attendance-1')::uuid,md5('checkout-replacement-attendance-2')::uuid) AND status='checked_in' AND current_state='assigned'),
      (SELECT count(*) FROM public.dealer_attendance WHERE id=md5('checkout-replacement-attendance-3')::uuid AND status='checked_in' AND current_state='available'),
      (SELECT count(*) FROM floor_private.dealer_initial_assign_receipts WHERE request_key LIKE 'checkout_replace_%');")"
  if [[ "$replacement_state" != '1|1|1|1' ]]; then echo "Eligible replacement committed-state conservation failed ($replacement_state)" >&2; exit 1; fi
  echo "REPLACEMENT_COMMIT_PROOF:OFF checkout remains unstaffed;ON checkout creates1current-session replacement/receipt;recent-release dealer excluded;no duplicate assignment"
  # Isolated fault injection: the picker sees the old committed rest marker,
  # while the canonical worker must recheck the new marker after its row wait.
  # No privileged connection or Docker socket is exposed to the browser.
  race_fifo="$test_root/replacement-rest-control.fifo"
  race_log_start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  race_browser_container="$network-rest-race"
  mkfifo "$race_fifo"
  docker exec -i "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres \
    <"$race_fifo" >"$test_root/replacement-rest-control.log" 2>&1 &
  race_control_pid=$!
  exec {race_fd}>"$race_fifo"
  printf '%s\n' "BEGIN;SET LOCAL application_name='isolated_checkout_policy_control';SET LOCAL idle_in_transaction_session_timeout='20s';SET LOCAL statement_timeout='10s';UPDATE public.dealer_attendance SET last_released_at=clock_timestamp(),pool_entered_at=clock_timestamp() WHERE id IN(md5('checkout-replacement-attendance-1')::uuid,md5('checkout-replacement-attendance-2')::uuid) AND current_state='available';SELECT 'REST_LOCK_READY';" >&"$race_fd"
  race_ready=false
  for attempt in $(seq 1 50); do
    if grep -qx REST_LOCK_READY "$test_root/replacement-rest-control.log"; then race_ready=true; break; fi
    sleep .1
  done
  if [[ "$race_ready" != true ]]; then
    printf 'ROLLBACK;\n' >&"$race_fd"; exec {race_fd}>&-; wait "$race_control_pid" || true
    echo 'Rest-race control did not hold its transaction' >&2; exit 1
  fi
  run_browser_proof '' '' 'active checkout respects automatic OFF and rested replacement eligibility' '' '' '' rest-race &
  race_browser_pid=$!
  race_blocked=false
  for attempt in $(seq 1 100); do
    if [[ "$(docker exec "$db_container" psql -X -Atq -U postgres -d postgres -c "SELECT EXISTS(SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity c ON c.pid=ANY(pg_blocking_pids(w.pid)) WHERE c.application_name='isolated_checkout_policy_control' AND w.query LIKE '%worker_assign_dealer_to_session_v1%');")" == t ]]; then race_blocked=true; break; fi
    sleep .1
  done
  if [[ "$race_blocked" == true ]]; then printf 'COMMIT;\n' >&"$race_fd"; else printf 'ROLLBACK;\n' >&"$race_fd"; fi
  exec {race_fd}>&-
  wait "$race_control_pid"
  race_control_pid=""
  wait "$race_browser_pid"
  race_browser_pid=""
  if [[ "$race_blocked" != true ]]; then echo 'No real worker row-lock wait observed; rest race not proved' >&2; exit 1; fi
  race_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SELECT (SELECT count(*) FROM public.dealer_assignments WHERE club_id='ad500000-0000-4000-8000-000000000001' AND status='assigned' AND released_at IS NULL),(SELECT count(*) FROM floor_private.dealer_initial_assign_receipts WHERE request_key LIKE 'checkout_replace_%'),(SELECT count(*) FROM public.dealer_attendance WHERE id IN(md5('checkout-replacement-attendance-1')::uuid,md5('checkout-replacement-attendance-2')::uuid) AND current_state='available');")"
  if [[ "$race_state" != '0|1|1' ]]; then echo "Rest-race conservation failed ($race_state)" >&2; exit 1; fi
  # Attribute the rejection to the exact DB guard, not an arbitrary RPC error.
  # Persist fixed enum/count only; raw Edge logs never leave the isolated stack.
  race_rest_denials="$(docker logs --since "$race_log_start" "$edge_container" 2>&1 | node --input-type=module -e 'import {readFileSync} from "node:fs";const raw=readFileSync(0,"utf8");process.stdout.write(String((raw.match(/Auto-replace RPC error: DEALER_REST_REQUIRED\b/g)||[]).length));')"
  if [[ "$race_rest_denials" != 1 ]]; then echo 'Exact rest-denial attribution missing or duplicated' >&2; exit 1; fi
  printf '{"kind":"REAL_CHECKOUT_REST_COMMIT_RACE","workerBlocked":true,"controlCommitted":true,"denial":"DEALER_REST_REQUIRED","denials":1,"activeAssignments":0,"initialAssignmentReceipts":1,"qualification":false}\n' >"$repo_root/output/operations-latency/checkout-rest-guard-http.json"
  echo 'REPLACEMENT_REST_RACE_PROOF:actual worker blocked;fresh rest marker committed;checkout retained;no replacement or new receipt'
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'OFF_RACE_FIXTURE'
BEGIN;
-- Synthetic setup only: no claim this marker reset is a real release history.
CREATE TEMP TABLE off_race_target AS SELECT payload FROM floor_private.dealer_initial_assign_receipts WHERE request_key LIKE 'checkout_replace_%';
DO $$ BEGIN IF (SELECT count(*) FROM off_race_target)<>1 THEN RAISE EXCEPTION 'off_race_target_ambiguous';END IF;END $$;
CREATE TEMP TABLE off_race_spare AS SELECT id FROM public.dealer_attendance WHERE id IN(md5('checkout-replacement-attendance-1')::uuid,md5('checkout-replacement-attendance-2')::uuid) AND current_state='available';
DO $$ BEGIN IF (SELECT count(*) FROM off_race_spare)<>1 THEN RAISE EXCEPTION 'off_race_spare_ambiguous';END IF;END $$;
UPDATE public.dealer_attendance SET last_released_at=now()-interval '20 minutes',pool_entered_at=now()-interval '20 minutes' WHERE id IN(SELECT id FROM off_race_spare);
INSERT INTO public.dealers(id,club_id,full_name,status,tier,skills) VALUES(md5('checkout-replacement-dealer-4')::uuid,'ad500000-0000-4000-8000-000000000001','Replacement eligibility TEST 4','active','A',ARRAY['holdem']);
INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,current_state,check_in_time,last_released_at,pool_entered_at) VALUES(md5('checkout-replacement-attendance-4')::uuid,md5('checkout-replacement-dealer-4')::uuid,'ad300000-0000-4000-8000-000000000003',(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'checked_in','available',now()-interval '1 hour',now()-interval '20 minutes',now()-interval '20 minutes');
GRANT SELECT ON off_race_target,off_race_spare TO service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
DO $$ DECLARE result jsonb;BEGIN
 SELECT public.worker_assign_dealer_to_session_v1((payload->>'club')::uuid,(payload->>'table')::uuid,(payload->>'session')::uuid,(SELECT id FROM pg_temp.off_race_spare),now()+interval '45 minutes','off_race_fixture_assignment') INTO result FROM pg_temp.off_race_target;
 IF result->>'outcome' IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'off_race_fixture_assignment_failed';END IF;
END $$;
COMMIT;
OFF_RACE_FIXTURE

  # Isolated fault injection: the picker sees automatic ON,
  # while the canonical worker must recheck OFF after its settings-row wait.
  # No privileged connection or Docker socket is exposed to the browser.
  race_fifo="$test_root/replacement-off-control.fifo"
  race_log_start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  race_browser_container="$network-off-race"
  mkfifo "$race_fifo"
  docker exec -i "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres \
    <"$race_fifo" >"$test_root/replacement-off-control.log" 2>&1 &
  race_control_pid=$!
  exec {race_fd}>"$race_fifo"
  printf '%s\n' "BEGIN;SET LOCAL application_name='isolated_checkout_policy_control';SET LOCAL idle_in_transaction_session_timeout='20s';SET LOCAL statement_timeout='10s';UPDATE public.club_settings SET auto_swing_enabled=false WHERE club_id='ad500000-0000-4000-8000-000000000001';SELECT 'OFF_LOCK_READY';" >&"$race_fd"
  race_ready=false
  for attempt in $(seq 1 50); do
    if grep -qx OFF_LOCK_READY "$test_root/replacement-off-control.log"; then race_ready=true; break; fi
    sleep .1
  done
  if [[ "$race_ready" != true ]]; then
    printf 'ROLLBACK;\n' >&"$race_fd"; exec {race_fd}>&-; wait "$race_control_pid" || true
    echo 'OFF-race control did not hold its transaction' >&2; exit 1
  fi
  run_browser_proof '' '' 'active checkout respects automatic OFF and rested replacement eligibility' '' '' '' off-race &
  race_browser_pid=$!
  race_blocked=false
  for attempt in $(seq 1 100); do
    if [[ "$(docker exec "$db_container" psql -X -Atq -U postgres -d postgres -c "SELECT EXISTS(SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity c ON c.pid=ANY(pg_blocking_pids(w.pid)) WHERE c.application_name='isolated_checkout_policy_control' AND w.query LIKE '%worker_assign_dealer_to_session_v1%');")" == t ]]; then race_blocked=true; break; fi
    sleep .1
  done
  if [[ "$race_blocked" == true ]]; then printf 'COMMIT;\n' >&"$race_fd"; else printf 'ROLLBACK;\n' >&"$race_fd"; fi
  exec {race_fd}>&-
  wait "$race_control_pid"
  race_control_pid=""
  wait "$race_browser_pid"
  race_browser_pid=""
  if [[ "$race_blocked" != true ]]; then echo 'No real worker row-lock wait observed; OFF race not proved' >&2; exit 1; fi
  race_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SELECT (SELECT count(*) FROM public.dealer_assignments WHERE club_id='ad500000-0000-4000-8000-000000000001' AND status='assigned' AND released_at IS NULL),(SELECT count(*) FROM floor_private.dealer_initial_assign_receipts WHERE request_key LIKE 'checkout_replace_%'),(SELECT count(*) FROM public.dealer_attendance WHERE id IN(md5('checkout-replacement-attendance-1')::uuid,md5('checkout-replacement-attendance-2')::uuid) AND current_state='available');")"
  if [[ "$race_state" != '0|1|0' ]]; then echo "OFF-race conservation failed ($race_state)" >&2; exit 1; fi
  # Attribute the rejection to the exact DB guard, not an arbitrary RPC error.
  # Persist fixed enum/count only; raw Edge logs never leave the isolated stack.
  race_off_denials="$(docker logs --since "$race_log_start" "$edge_container" 2>&1 | node --input-type=module -e 'import {readFileSync} from "node:fs";const raw=readFileSync(0,"utf8");process.stdout.write(String((raw.match(/Auto-replace RPC error: AUTO_SWING_OFF\b/g)||[]).length));')"
  if [[ "$race_off_denials" != 1 ]]; then echo 'Exact OFF-denial attribution missing or duplicated' >&2; exit 1; fi
  printf '{"kind":"REAL_CHECKOUT_OFF_COMMIT_RACE","workerBlocked":true,"controlCommitted":true,"denial":"AUTO_SWING_OFF","denials":1,"activeAssignments":0,"checkoutReplacementReceipts":1,"qualification":false}\n' >"$repo_root/output/operations-latency/checkout-off-guard-http.json"
  echo 'REPLACEMENT_OFF_RACE_PROOF:actual worker blocked;OFF committed;checkout retained;no replacement or new receipt'
  node "$repo_root/scripts/ops/prepare-staff-salary-runtime-dependencies.mjs" "$test_root/staff-salary-current.sql"
  { printf "SET vinpoker.isolated_staff_salary_fixture='cashier-current-salary-v1';\n"; cat "$test_root/staff-salary-current.sql"; } | \
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -v owner_id="$owner_id" <<'STAFF_SALARY_FIXTURE'
BEGIN;
INSERT INTO public.clubs(id,owner_id,name,region,status)
VALUES('af200000-0000-4000-8000-000000000001',:'owner_id'::uuid,'Staff salary HTTP TEST','HCM','approved');
INSERT INTO public.club_settings(club_id,standard_shifts_per_month)
VALUES('af200000-0000-4000-8000-000000000001',26);
INSERT INTO public.staff(id,club_id,user_id,full_name,department,employment_type,monthly_salary_vnd,manual_bhxh_vnd,manual_tax_vnd,status)
SELECT ('af100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'af200000-0000-4000-8000-000000000001',u.id,
 'Staff salary HTTP TEST '||n,'service','full_time',2600000,0,0,'active'
FROM generate_series(1,20) n JOIN auth.users u ON u.email='cashier-latency-'||n||'@test.invalid';
INSERT INTO public.staff(id,club_id,user_id,full_name,department,employment_type,monthly_salary_vnd,manual_bhxh_vnd,manual_tax_vnd,status)
VALUES('af100000-0000-4000-8000-000000000021','af200000-0000-4000-8000-000000000001',:'owner_id'::uuid,
 'Staff salary HTTP TEST 21','service','full_time',2600000,0,0,'inactive');
DO $$ BEGIN IF (SELECT count(*) FROM public.staff WHERE club_id='af200000-0000-4000-8000-000000000001')<>21 THEN RAISE EXCEPTION 'salary_fixture_staff_incomplete';END IF;END $$;
COMMIT;
STAFF_SALARY_FIXTURE
  run_browser_proof '' '' 'inactive earned staff salary HTTP preserves approved period roster' '' '' '' '' 1
fi
