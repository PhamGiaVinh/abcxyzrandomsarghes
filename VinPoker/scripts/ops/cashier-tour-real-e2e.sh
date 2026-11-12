#!/usr/bin/env bash
set -euo pipefail
umask 077
repo_root="$(pwd)"
schema_dir="${SCHEMA_ARTIFACT_DIRECTORY:-}"
schema_mode="${CASHIER_SCHEMA_MODE:-pre03}"
realtime_mode="${LOCAL_OPERATIONS_REALTIME:-0}"
clock_candidate_probe="${LOCAL_CLOCK_CANDIDATE_PROBE:-0}"
operations_candidate_probe="${LOCAL_OPERATIONS_CANDIDATE_PROBE:-0}"
reentry_transport_probe="${LOCAL_REENTRY_TRANSPORT_PROBE:-0}"
correction_undo_probe="${LOCAL_CORRECTION_UNDO_PROBE:-0}"
redraw_probe="${LOCAL_OPERATIONS_REDRAW_PROBE:-0}"
prize_close_probe="${LOCAL_OPERATIONS_PRIZE_CLOSE_PROBE:-0}"
reentry_fault_mode="${LOCAL_REENTRY_FAULT_MODE:-failure-injection}"
audience_count="${LOCAL_OPERATIONS_AUDIENCE:-0}"
audience_model="${LOCAL_OPERATIONS_AUDIENCE_MODEL:-grid-detail-stress}"
operations_rest_pool="${LOCAL_OPERATIONS_REST_POOL:-10}"
diagnostic_scope="${LOCAL_OPERATIONS_DIAGNOSTIC_SCOPE:-none}"
case "$diagnostic_scope" in none|cashier-payment|dealer-checkin) ;; *) echo 'Unknown targeted diagnostic scope' >&2;exit 1;; esac
if [[ "$diagnostic_scope" != none && ( "$schema_mode" != current || "$operations_candidate_probe" != 1 || "$realtime_mode" != 1 || "$audience_count" == 0 || "$reentry_transport_probe" != 1 || "$correction_undo_probe" != 1 || "$reentry_fault_mode" != healthy || "$redraw_probe" != 0 || "$prize_close_probe" != 1 ) ]]; then
  echo 'Targeted diagnostics require isolated current full34 healthy source preparation and audience; only unrelated scenario execution is skipped' >&2;exit 1
fi
if [[ "$operations_rest_pool" != 10 && "$operations_rest_pool" != 20 ]] ||
   [[ "$operations_rest_pool" == 20 && ( "$schema_mode" != current || "$operations_candidate_probe" != 1 || "$realtime_mode" != 1 || "$audience_count" != 1000 ) ]]; then
  echo 'Pool comparison requires explicit isolated1000 operational mode' >&2;exit 1
fi
case "$audience_model" in selected-table|grid-detail-stress) ;; *) echo 'Unsupported isolated audience model' >&2;exit 1;; esac
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
if [[ "$clock_candidate_probe" != 0 && "$clock_candidate_probe" != 1 ]] || [[ "$clock_candidate_probe" == 1 && ( "$schema_mode" != current || "$realtime_mode" != 1 ) ]]; then
  echo 'Candidate clock probe requires explicit current isolated Realtime mode' >&2; exit 1
fi
if [[ "$operations_candidate_probe" != 0 && "$operations_candidate_probe" != 1 ]] || [[ "$operations_candidate_probe" == 1 && ( "$schema_mode" != current || "$realtime_mode" != 1 || "$clock_candidate_probe" != 0 ) ]]; then
  echo 'Candidate operations probe requires current isolated Realtime mode and excludes clock-only mode' >&2; exit 1
fi
case "$audience_count" in 0|10|1000) ;; *) echo 'Unsupported isolated operational audience' >&2;exit 1;; esac
case "$reentry_fault_mode" in failure-injection|healthy) ;; *) echo 'Unsupported isolated reentry fault mode' >&2;exit 1;; esac
if [[ "$reentry_transport_probe" != 0 && "$reentry_transport_probe" != 1 ]] || [[ "$reentry_transport_probe" == 1 && ( "$schema_mode" != current || "$operations_candidate_probe" != 1 || ( "$audience_count" == 1000 && "$reentry_fault_mode" != healthy ) ) ]] || [[ "$reentry_transport_probe" == 0 && "$reentry_fault_mode" != failure-injection ]]; then
  echo 'Pending reentry transport requires current candidate operations;fault injection is capped at10viewers and healthy mode requires the candidate' >&2;exit 1
fi
if [[ "$audience_count" != 0 && "$operations_candidate_probe" != 1 ]]; then
  echo 'Operational audience requires explicit full candidate operations mode' >&2;exit 1
fi
if [[ "$correction_undo_probe" != 0 && "$correction_undo_probe" != 1 ]] || [[ "$correction_undo_probe" == 1 && ( "$schema_mode" != current || "$operations_candidate_probe" != 1 || "$realtime_mode" != 1 || "$reentry_transport_probe" != 1 || "$reentry_fault_mode" != healthy ) ]]; then
  echo 'Correction Undo probe requires current isolated full operations and healthy reentry candidate' >&2;exit 1
fi
if [[ "$prize_close_probe" != 0 && "$prize_close_probe" != 1 ]] || [[ "$prize_close_probe" == 1 && ( "$schema_mode" != current || "$operations_candidate_probe" != 1 || "$realtime_mode" != 1 || "$correction_undo_probe" != 1 ) ]]; then
  echo "PRIZE_CLOSE_PROBE_REQUIRES_CURRENT_FULL33_OPERATIONS" >&2; exit 1
fi
if [[ "$redraw_probe" != 0 && "$redraw_probe" != 1 ]] || [[ "$redraw_probe" == 1 && ( "$schema_mode" != current || "$operations_candidate_probe" != 1 || "$realtime_mode" != 1 ) ]]; then
  echo 'Redraw probe requires current isolated full operations' >&2;exit 1
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
  if [[ -n "${payment_lock_sampler_pid:-}" ]]; then kill -TERM "$payment_lock_sampler_pid" 2>/dev/null || true;wait "$payment_lock_sampler_pid" 2>/dev/null || true;fi
  if [[ -n "${hud_browser_pid:-}" ]]; then docker rm -f "$network-hud-browser" >/dev/null 2>&1 || true;wait "$hud_browser_pid" 2>/dev/null || true;fi
  if [[ -n "${hud_projector_pid:-}" ]]; then kill -TERM "$hud_projector_pid" 2>/dev/null || true;wait "$hud_projector_pid" 2>/dev/null || true;fi
  if [[ -n "${audience_pid:-}" ]]; then kill "$audience_pid" 2>/dev/null || true;wait "$audience_pid" 2>/dev/null || true;fi
  if [[ -n "${db_pressure_pid:-}" ]]; then kill -TERM "$db_pressure_pid" 2>/dev/null || true;wait "$db_pressure_pid" 2>/dev/null || true;fi
  if [[ -n "${clock_flush_pid:-}" ]]; then kill "$clock_flush_pid" 2>/dev/null || true; wait "$clock_flush_pid" 2>/dev/null || true; fi
  if [[ "$exit_code" != 0 && ( "$clock_candidate_probe" == 1 || "$operations_candidate_probe" == 1 ) && -n "${db_container:-}" ]]; then
    mkdir -p "$repo_root/output/operations-latency"
    # Failure-only fixed TEST scope, counts and booleans. No payloads, message
    # bodies, schema definitions, actor data or credentials leave this runtime.
    docker exec -i "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres \
      >"$repo_root/output/operations-latency/clock-candidate-state-http.json" 2>/dev/null <<'CLOCK_FAILURE_STATE' || true
SET statement_timeout='5s';
SELECT jsonb_build_object('kind','ISOLATED_CLOCK_BROADCAST_FAILURE_STATE','qualification',false,
 'observationScope','Failure cleanup after flusher stop; not the exact timeout snapshot',
 'observedAt',clock_timestamp(),
 'ownedFixture',EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST'),
 'clockSource',(SELECT jsonb_build_object('started',clock_started_at IS NOT NULL,'paused',clock_paused_at IS NOT NULL)
   FROM public.tournaments WHERE id='ac300000-0000-4000-8000-000000000001' AND name='Operations clock TEST'),
 'pendingClock',(SELECT count(*) FROM spectator_projection_v2.broadcast_pending_v1 WHERE tournament_id='ac300000-0000-4000-8000-000000000001' AND component='clock'),
 'messagesPublicationExists',EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime_messages_publication'),
 'messagesTablePublished',EXISTS(SELECT 1 FROM pg_publication_rel r JOIN pg_publication p ON p.oid=r.prpubid
   WHERE p.pubname='supabase_realtime_messages_publication' AND r.prrelid='realtime.messages'::regclass),
 'activeLogicalSlots',(SELECT count(*) FROM pg_replication_slots WHERE active AND slot_type='logical'),
 'messageColumnsSupported',(SELECT count(*)=3 FROM information_schema.columns WHERE table_schema='realtime' AND table_name='messages' AND column_name IN ('topic','event','payload')),
 'topicMessages',(SELECT count(*) FROM realtime.messages m WHERE to_jsonb(m)->>'topic'='public:tournament-viewer-v2:ac300000-0000-4000-8000-000000000001'),
 'clockChangedMessages',(SELECT count(*) FROM realtime.messages m WHERE to_jsonb(m)->>'topic'='public:tournament-viewer-v2:ac300000-0000-4000-8000-000000000001'
   AND to_jsonb(m)->>'event'='changed' AND (to_jsonb(m)->'payload'->'components') @> '["clock"]'::jsonb)
)
WHERE EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST')
 AND EXISTS(SELECT 1 FROM public.tournaments WHERE id='ac300000-0000-4000-8000-000000000001' AND name='Operations clock TEST');
CLOCK_FAILURE_STATE
    if [[ ! -s "$repo_root/output/operations-latency/clock-candidate-state-http.json" ]]; then
      printf '%s\n' '{"kind":"ISOLATED_CLOCK_BROADCAST_FAILURE_STATE","captureUnavailable":true,"qualification":false}' \
        >"$repo_root/output/operations-latency/clock-candidate-state-http.json"
    fi
  fi
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
  if [[ "$exit_code" != 0 && -n "${gateway_container:-}" ]]; then
    mkdir -p "$repo_root/output/operations-latency"
    # Browser scope failures need the gateway's fixed error classifications,
    # not raw request logs, headers, JWTs, response bodies or customer records.
    docker logs "$gateway_container" --tail 100000 2>&1 | node --input-type=module -e '
      import {readFileSync} from "node:fs";
      const raw=readFileSync(0,"utf8");
      const markers=Object.fromEntries(["upstream timed out","connect() failed","no live upstreams","could not be resolved","failed to get a peer","upstream prematurely closed connection","Connection reset by peer","too many open files","Too many open files","worker process exited","worker_connections are not enough","accept4() failed","socket() failed","upstream sent too big header"].map(marker=>[marker,raw.split(marker).length-1]));
      process.stdout.write(JSON.stringify({kind:"SANITIZED_ISOLATED_GATEWAY_FAILURE_CLASSIFICATIONS",qualification:false,markers,limitations:"Last100000gateway log lines include the bounded startup interval;fixed marker counts only;not a per-request causal attribution."}));
    ' >"$repo_root/output/operations-latency/gateway-failure-http.json" || true
  fi
  if [[ "$exit_code" != 0 && -n "${db_container:-}" ]]; then
    mkdir -p "$repo_root/output/operations-latency"
    # A witnessed502 scope read needs DB/PostgREST process diagnostics. Export
    # fixed event counts only,never raw statements,JWTs,headers or request logs.
    for diagnostic_service in database postgrest; do
      diagnostic_container="$db_container"
      if [[ "$diagnostic_service" == postgrest ]]; then diagnostic_container="$(docker ps -aq --filter "network=$network" --filter 'name=supabase_rest_' | head -n 1)";fi
      if [[ -n "$diagnostic_container" ]]; then
        docker logs "$diagnostic_container" --tail 1000 2>&1 | node --input-type=module -e '
          import {readFileSync} from "node:fs";
          const raw=readFileSync(0,"utf8");
          const patterns={segmentationFault:/segmentation fault|terminated by signal 11/gi,outOfMemory:/out of memory|oom.kill|cannot allocate memory/gi,panic:/\bPANIC\b/g,terminatingConnection:/terminating connection/gi,connectionReset:/connection reset|connection refused|connection terminated/gi,recovery:/database system is in recovery|database system was interrupted/gi,poolTimeout:/PGRST003|connection acquisition timeout|timed out acquiring/gi,schemaCacheReload:/schema cache (?:loaded|reloaded)/gi};
          const markers=Object.fromEntries(Object.entries(patterns).map(([key,pattern])=>[key,[...raw.matchAll(pattern)].length]));
          process.stdout.write(JSON.stringify({kind:"SANITIZED_ISOLATED_DATABASE_OR_POSTGREST_PROCESS_EVENTS",qualification:false,markers,limitations:"Last1000container log lines;fixed marker counts only,not per-request causal attribution or a crash-free proof."}));
        ' >"$repo_root/output/operations-latency/$diagnostic_service-process-http.json" || true
      fi
    done
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
        const markers=Object.fromEntries(["Postgrex.Error","ErrorPolling","ReplicationPoller","apply_rls","list_changes","insufficient_privilege","row-level security","too_many_connections","ConnectionRateLimitReached","ClientJoinRateLimitReached","DatabaseConnectionRateLimitReached","IncreaseConnectionPool","DatabaseLackOfConnections","InitializingProjectConnection","RealtimeRestarting"].map(marker=>[marker,raw.split(marker).length-1]));
        process.stdout.write(JSON.stringify({kind:"SANITIZED_REALTIME_LOG_CLASSIFICATIONS",qualification:false,deniedFunctions,deniedSchemas,markers}));
      ' >"$repo_root/output/operations-latency/realtime-log-http.json" || true
    fi
  fi
  if [[ "$audience_count" == 1000 && -n "${db_container:-}" ]]; then
    mkdir -p "$repo_root/output/operations-latency"
    if ! docker exec -i "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
      <"$repo_root/scripts/ops/operations-rpc-profile.sql" \
      >"$repo_root/output/operations-latency/operations-rpc-profile-http.json" 2>/dev/null; then
      printf '%s\n' '{"capture":"unavailable","reason":"statistics_query_failed","qualification":false}' \
        >"$repo_root/output/operations-latency/operations-rpc-profile-http.json"
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
if [[ "$operations_candidate_probe" == 1 ]]; then
  printf '%s\n' '[functions.tournament-historical-settlement]' 'verify_jwt = true' >>supabase/config.toml
fi
if [[ "$prize_close_probe" == 1 ]]; then
  printf '%s\n' '[functions.compute-payouts]' 'verify_jwt = true' >>supabase/config.toml
fi
printf '%s\n' \
  'SEPAY_RECONCILE_SECRET=cashier-edge-reconcile-test' \
  'SEPAY_AUTO_CONFIRM=true' \
  'SEPAY_API_BASE=http://fake-sepay:8787' >supabase/functions/.env
if [[ "$realtime_mode" == 1 ]]; then
  printf '%s\n' 'TELEGRAM_BOT_TOKEN=LOCAL_TEST_ONLY_INVALID_TOKEN' \
    'VINPOKER_ISOLATED_TELEGRAM=cashier-current-only' >>supabase/functions/.env
fi

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
if [[ "$audience_count" == 1000 ]]; then
  mkdir -p "$repo_root/output/operations-latency"
  node "$repo_root/scripts/ops/operations-gateway.mjs" "$gateway_container" "$network" \
    "$repo_root/output/operations-latency/operations-gateway-http.json"
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
if [[ "$realtime_mode" == 1 ]]; then
  telegram_sink="$(docker run -d --rm --network "$network" --network-alias telegram-test-sink \
    --volume "$repo_root/scripts/ops/telegram-test-sink.mjs:/tests/server.mjs:ro" \
    --env VINPOKER_TELEGRAM_TEST_SINK=isolated-cashier-only \
    mcr.microsoft.com/playwright:v1.60.0-noble node /tests/server.mjs)"
  ephemeral_containers+=("$telegram_sink")
  docker network connect --alias telegram-test-sink "$browser_network" "$telegram_sink"
  probe_external_denied "$telegram_sink" Telegram-synthetic-sink
  sink_ready=false
  for _ in {1..30}; do
    if docker exec "$telegram_sink" node -e 'fetch("http://127.0.0.1:8788/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'; then sink_ready=true;break;fi
    sleep 1
  done
  [[ "$sink_ready" == true ]]
fi

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
  if [[ "$operations_candidate_probe" == 1 ]]; then
    if [[ "$prize_close_probe" == 1 ]]; then
      cp -R "$repo_root/supabase/functions/compute-payouts" supabase/functions/compute-payouts
    fi
    cp -R "$repo_root/supabase/functions/tournament-historical-settlement" supabase/functions/tournament-historical-settlement
    # Local CLI may mount functions without src. Bundle the unchanged handler
    # and its canonical pure core into this disposable entry, as for HUD workers.
    # Public remote/npm imports stay external; no production source is rewritten.
    (
      cd "$repo_root"
      node --input-type=module - "$test_root/supabase/functions/tournament-historical-settlement/index.ts" <<'HISTORICAL_EDGE_BUNDLE'
import {build} from 'esbuild';
await build({entryPoints:['supabase/functions/tournament-historical-settlement/index.ts'],outfile:process.argv[2],
 bundle:true,format:'esm',platform:'neutral',external:['https://*','npm:*'],logLevel:'silent'});
HISTORICAL_EDGE_BUNDLE
    )
  fi
  if [[ "$reentry_transport_probe" == 1 ]]; then
    cp "$repo_root/supabase/pending-tests/tournament-reentry-transport.ts" supabase/functions/tournament-reentry/index.ts
  fi
  if [[ "$realtime_mode" == 1 ]]; then
    node "$repo_root/scripts/ops/prepare-checkout-telegram-test.mjs" "$test_root/supabase/functions/checkout-dealer/index.ts"
  fi
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

# Current operations include today's Intelligence pulse. Choose the event day
# before registrations, payments or immutable revenue snapshots are created.
# Keep the historical pre03 fixture and its future event unchanged.
if [[ "$schema_mode" == current && "$realtime_mode" == 1 ]]; then
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'CURRENT_EVENT_DAY'
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
   WHERE t.id='a3000000-0000-4000-8000-000000000001' AND t.name='Cashier Edge TEST Tour'
    AND c.id='a2000000-0000-4000-8000-000000000001' AND c.name='Cashier Edge TEST'
    AND t.status='registering' AND t.registration_closed_at IS NULL AND t.start_time>now())
 OR EXISTS(SELECT 1 FROM public.tournament_registrations WHERE tournament_id='a3000000-0000-4000-8000-000000000001')
 THEN RAISE EXCEPTION 'current_event_day_requires_fresh_owned_fixture';END IF;
END $$;
UPDATE public.tournaments SET start_time=now()
WHERE id='a3000000-0000-4000-8000-000000000001';
COMMIT;
CURRENT_EVENT_DAY
fi

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
-- Reserve actor20 for the independent salary owner below. UUID ordering is
-- random across Auth runs and must not consume that actor for this club.
AND c.user_id=(SELECT id FROM auth.users WHERE email='cashier-latency-19@test.invalid')
AND NOT EXISTS(SELECT 1 FROM public.clubs owned WHERE owned.owner_id=c.user_id)
ORDER BY c.user_id LIMIT 1;
INSERT INTO public.club_dealer_controls(club_id,user_id,granted_by)
SELECT 'ad500000-0000-4000-8000-000000000001'::uuid,c.user_id,b.owner_id
FROM public.club_dealer_controls c CROSS JOIN public.clubs b
WHERE c.club_id='a2000000-0000-4000-8000-000000000001' AND b.id=c.club_id
UNION SELECT 'ad500000-0000-4000-8000-000000000001',owner_id,owner_id FROM public.clubs
WHERE id='a2000000-0000-4000-8000-000000000001';
-- Bind new synthetic attendances to a real owned shift. Its four-hour window
-- spans fixture creation and the bounded test, including a local midnight;
-- derive shift_date from the same current operating-day rule as the matcher.
INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time)
VALUES('ad530000-0000-4000-8000-000000000001','ad500000-0000-4000-8000-000000000001',
 'Handover latency TEST',((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')-interval '1 hour')::time,
 ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')+interval '3 hours')::time);
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
INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state,pre_assigned_table_id,pre_assigned_at)
SELECT outgoing_attendance,outgoing_dealer,s.id,
 ((now()-interval '1 hour') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date-
 CASE WHEN s.end_time<=s.start_time AND ((now()-interval '1 hour') AT TIME ZONE 'Asia/Ho_Chi_Minh')::time<s.end_time THEN 1 ELSE 0 END,
 'checked_in',now()-interval '1 hour','assigned',NULL::uuid,NULL::timestamptz
FROM handover_latency CROSS JOIN public.dealer_shifts s WHERE s.id='ad530000-0000-4000-8000-000000000001'
UNION ALL SELECT incoming_attendance,incoming_dealer,s.id,
 ((now()-interval '1 hour') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date-
 CASE WHEN s.end_time<=s.start_time AND ((now()-interval '1 hour') AT TIME ZONE 'Asia/Ho_Chi_Minh')::time<s.end_time THEN 1 ELSE 0 END,
 'checked_in',now()-interval '1 hour','pre_assigned',table_id,now()-interval '1 minute'
FROM handover_latency CROSS JOIN public.dealer_shifts s WHERE s.id='ad530000-0000-4000-8000-000000000001';
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
floor_redraw_build=off
if [[ "$operations_candidate_probe" == 1 ]]; then floor_redraw_build=preview; fi
(cd "$repo_root" && \
  VITE_SUPABASE_URL="http://$browser_gateway:8000" \
  VITE_SUPABASE_PUBLISHABLE_KEY="$anon_key" \
  VITE_OPS_TOUR_CASHIER=production \
  VITE_FLOOR_TABLE_CONTROL_V3=preview VITE_FLOOR_UAT_ENV=preview VITE_FLOOR_REDRAW_SEAT_LOCK_V1="$floor_redraw_build" \
  VITE_PUBLIC_SPECTATOR_LAST_HAND_HISTORY=preview \
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
current_schema_prepared=0
install_current_paid_schema() {
  # Canonical schema installation is independent of payment/refund fixture rows.
  # Keep the exact current allocator and its original dependency guards.
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
NOTIFY pgrst,'reload schema';
PAID_SEATING_PREFLIGHT
  echo "PAID_SEATING_SCHEMA_PROOF: exact113/114/115/117/139/233 original guards; six production body fingerprints"
  if [[ "$reentry_transport_probe" == 1 ]]; then
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
      <"$repo_root/supabase/migrations/20261107013500_cashier_app_reentry_transport_v1.sql"
    if [[ "$reentry_fault_mode" == failure-injection ]]; then
      { printf "SET vinpoker.isolated_reentry_transport='current-composite-v1';\n";
        cat "$repo_root/supabase/pending-tests/reentry_transport_notification_fault.sql"; } |
        docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
    else
      docker exec "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
        "DO \$\$ BEGIN IF to_regnamespace('ops_reentry_transport_probe_v1') IS NOT NULL THEN RAISE EXCEPTION 'healthy_reentry_must_not_have_fault_fixture';END IF;END \$\$;"
    fi
    node --input-type=module - "$repo_root/output/operations-latency/operations-candidate-package-http.json" <<'REENTRY_TRANSPORT_APPLIED_RECEIPT'
import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';
const report=JSON.parse(readFileSync(process.argv[2],'utf8'));assert.equal(report.pendingReentryTransportMigrations,1);
report.pendingReentryTransportApplied=true;writeFileSync(process.argv[2],JSON.stringify(report,null,2));
REENTRY_TRANSPORT_APPLIED_RECEIPT
  fi
}

install_current_revenue_schema() {
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
}

install_current_replacement_schema() {
  node "$repo_root/scripts/ops/prepare-dealer-replacement-runtime-dependencies.mjs" "$test_root/replacement-dependencies.sql"
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <"$test_root/replacement-dependencies.sql"
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'HANDOVER_SHIFT_PREFLIGHT'
DO $$ BEGIN
 IF (SELECT count(*) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id
     WHERE d.club_id='ad500000-0000-4000-8000-000000000001'
       AND d.full_name LIKE 'Handover % TEST %')<>46
 OR EXISTS(SELECT 1 FROM public.dealers d WHERE d.club_id='ad500000-0000-4000-8000-000000000001'
    AND d.full_name LIKE 'Handover % TEST %'
    AND NOT floor_private.dealer_pool_attendance_matches_v1(d.id,d.club_id,statement_timestamp()))
 THEN RAISE EXCEPTION 'handover_fixture_requires_46_current_operating_day_attendances';END IF;
END $$;
HANDOVER_SHIFT_PREFLIGHT
}

install_current_salary_schema() {
  node "$repo_root/scripts/ops/prepare-staff-salary-runtime-dependencies.mjs" "$test_root/staff-salary-current.sql"
  { printf "SET vinpoker.isolated_staff_salary_fixture='cashier-current-salary-v1';\n"; cat "$test_root/staff-salary-current.sql"; } | \
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
}

install_current_start_schema() {
  node "$repo_root/scripts/ops/prepare-tracker-start-runtime-dependencies.mjs" "$test_root/tracker-start-current.sql"
  { printf "SET vinpoker.isolated_tracker_start_fixture='cashier-current-tracker-v1';\n"; cat "$test_root/tracker-start-current.sql"; } | \
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
}

install_current_finish_schema() {
  node "$repo_root/scripts/ops/prepare-tracker-finish-runtime-dependencies.mjs" "$test_root/tracker-finish-current.sql" ${1:+"$1"}
  { printf "SET vinpoker.isolated_tracker_finish_fixture='cashier-current-manual-finish-v1';\n"; cat "$test_root/tracker-finish-current.sql"; } | \
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
}

install_current_action_schema() {
  # The public-only captured baseline predates the action budget/decided guards.
  # Restore their original guarded migrations before qualifying supplied actions.
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -v install_phase="${1:-stage}" <<'ACTION_GUARD_PREFLIGHT'
SELECT set_config('vinpoker.isolated_action_install', :'install_phase',false);
DO $$ BEGIN
 IF current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
  WHERE t.id='a3000000-0000-4000-8000-000000000001' AND t.name='Cashier Edge TEST Tour'
   AND c.id='a2000000-0000-4000-8000-000000000001' AND c.name='Cashier Edge TEST')
 OR (CASE WHEN current_setting('vinpoker.isolated_action_install',true)='before-audience' THEN
   EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='a3000000-0000-4000-8000-000000000001' AND hand_number IN (9001,9002))
   ELSE (SELECT count(*) FROM public.tournament_hands WHERE tournament_id='a3000000-0000-4000-8000-000000000001' AND hand_number=9002 AND status='in_progress')<>1 END)
 OR EXISTS(SELECT 1 FROM public.hand_actions a JOIN public.tournament_hands h ON h.id=a.hand_id WHERE h.tournament_id='a3000000-0000-4000-8000-000000000001')
 OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid='public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid)'::regprocedure),chr(13),'')) IS DISTINCT FROM '9d3c35935fa68e8137e6fe6577b578b5'
 THEN RAISE EXCEPTION 'current_action_guards_require_owned_empty_action_fixture';END IF;
END $$;
ACTION_GUARD_PREFLIGHT
  for action_guard_migration in \
    20270128000189_tracker_action_stack_bound_v1.sql \
    20270128000301_tracker_decided_hand_action_guard_v1.sql; do
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
      <"$repo_root/supabase/migrations/$action_guard_migration"
  done
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'ACTION_GUARD_POSTCHECK'
DO $$ DECLARE p pg_proc%ROWTYPE;BEGIN
 SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid)'::regprocedure;
 IF md5(replace(p.prosrc,chr(13),''))<>'ccf4f55e6826bef6d4fe35dd7b38c30f' OR md5(replace(pg_get_functiondef(p.oid),chr(13),''))<>'fa4e8a99992729dfe13446dd5300014f'
 OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v' OR p.pronargdefaults<>6
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
 THEN RAISE EXCEPTION 'current_record_action_authority_drift';END IF;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid='floor_private.guard_tracker_action_stack189()'::regprocedure;
 IF md5(replace(p.prosrc,chr(13),''))<>'59c8dbd2fd8a4e2135e782e67e1eea7c' OR md5(replace(pg_get_functiondef(p.oid),chr(13),''))<>'4f064c7755b5a8ee53e39caed61f7429'
 OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v' OR p.pronargdefaults<>0
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
 OR NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgname='trg_guard_tracker_action_stack189' AND t.tgrelid='public.hand_actions'::regclass
  AND t.tgfoid=p.oid AND NOT t.tgisinternal AND t.tgenabled='O' AND md5(replace(pg_get_triggerdef(t.oid),chr(13),''))='2537fe8cd97049cffb7675436f814772')
 THEN RAISE EXCEPTION 'current_action_stack_guard_attachment_drift';END IF;
END $$;
NOTIFY pgrst,'reload schema';
ACTION_GUARD_POSTCHECK
}

loaded_phase_checkpoint() {
  if [[ "$operations_candidate_probe" != 1 || "$audience_count" == 0 ]]; then return; fi
  kill -0 "$audience_pid"
  node --input-type=module - "$repo_root/output/operations-latency/operations-audience-http.json" "$repo_root/output/operations-latency/operations-loaded-phases-http.json" "$1" "$source_sha" "$audience_count" <<'LOADED_PHASE_CHECKPOINT'
import assert from'node:assert/strict';import{readFileSync,writeFileSync,existsSync}from'node:fs';
const a=JSON.parse(readFileSync(process.argv[2],'utf8')),file=process.argv[3],count=Number(process.argv[6]);
assert.equal(a.sha,process.argv[5]);assert.equal(a.phase,'ready');assert.equal(a.viewers,count);assert.equal(a.connected,count);assert.equal(a.initialReady,count);assert.equal(Object.keys(a.errors).length,0);
const r=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{kind:'LIVE_AUDIENCE_OPERATIONAL_PHASE_BOUNDARIES',sha:a.sha,checkpoints:[],qualification:false,limitations:'Readiness at boundaries plus final continuous audience receipt;one Chromium operator/HUD,not1000DOMs. Redraw/prize use separate TEST tours sharing the loaded database.'};
assert.equal(r.sha,a.sha);r.checkpoints.push({phase:process.argv[4],at:new Date().toISOString(),audienceActiveMs:a.activeDurationMs,viewers:a.viewers,connected:a.connected,initialReady:a.initialReady});writeFileSync(file,JSON.stringify(r,null,2));
LOADED_PHASE_CHECKPOINT
}

run_browser_proof() {
  local paid_enabled="${1:-}" reentry_enabled="${2:-}" selector="${3:-}" buy_close_enabled="${4:-}" move_enabled="${5:-}" active_checkout_enabled="${6:-}" replacement_enabled="${7:-}" staff_salary_enabled="${8:-}" deferred_move_enabled="${9:-}" manual_finish_enabled="${10:-}" manual_action_finish_enabled="${11:-}" recorded_action_finish_enabled="${12:-}" telegram_sink_enabled="${13:-}" intelligence_enabled="${14:-}" hud_browser_enabled="${15:-}"
  # These operational stages share committed fixtures. A failed prerequisite
  # must fail the run immediately, not produce misleading downstream failures.
  local -a test_args=(e2e/cashier-tour-real.spec.ts --output=/tmp/cashier-playwright-results --max-failures=1)
  local -a container_args=()
  if [[ "$replacement_enabled" == rest-race || "$replacement_enabled" == off-race ]]; then container_args+=(--name "$race_browser_container"); fi
  if [[ "$hud_browser_enabled" == 1 ]]; then
    container_args+=(--name "$network-hud-browser")
    container_args+=(--volume "$test_root/hud-control/requests:/fixtures/hud-control/requests" --volume "$test_root/hud-control/receipts:/fixtures/hud-control/receipts:ro")
  fi
  if [[ -n "$selector" ]]; then test_args+=(--grep "$selector"); fi
docker run --rm "${container_args[@]}" --network "container:$app_container" \
  --volume "$repo_root:/app:ro" --workdir /app \
  --volume "$repo_root/output/operations-latency:/latency" \
  --volume "$test_root/staff-private.json:/fixtures/staff-private.json:ro" \
  --volume "$test_root/dealer-fixture.json:/fixtures/dealer-fixture.json:ro" \
  --env LOCAL_OPERATIONS_STAFF_FILE=/fixtures/staff-private.json \
  --env LOCAL_OPERATIONS_CHECKIN_ENABLED="$checkin_fixture_enabled" \
  --env LOCAL_OPERATIONS_FLOOR_ROSTER_V6_ENABLED="$operations_candidate_probe" \
  --env LOCAL_OPERATIONS_PAID_SEATING_ENABLED="$paid_enabled" \
  --env LOCAL_OPERATIONS_REENTRY_ENABLED="$reentry_enabled" \
  --env LOCAL_REENTRY_TRANSPORT_PROBE="$reentry_transport_probe" \
  --env LOCAL_CORRECTION_UNDO_PROBE="$correction_undo_probe" \
  --env LOCAL_OPERATIONS_PRIZE_CLOSE_ENABLED="${LOCAL_OPERATIONS_PRIZE_CLOSE_ENABLED:-0}" \
  --env LOCAL_OPERATIONS_REDRAW_ENABLED="${LOCAL_OPERATIONS_REDRAW_ENABLED:-0}" \
  --env LOCAL_REENTRY_FAULT_MODE="$reentry_fault_mode" \
  --env LOCAL_REENTRY_BANK_PROBE_STAGE="${LOCAL_REENTRY_BANK_PROBE_STAGE:-0}" \
  --env LOCAL_OPERATIONS_BUY_CLOSE_ENABLED="$buy_close_enabled" \
  --env LOCAL_OPERATIONS_EXACT_MOVE_ENABLED="$move_enabled" \
  --env LOCAL_OPERATIONS_ACTIVE_CHECKOUT_ENABLED="$active_checkout_enabled" \
  --env LOCAL_OPERATIONS_REPLACEMENT_ENABLED="$replacement_enabled" \
  --env LOCAL_OPERATIONS_STAFF_SALARY_ENABLED="$staff_salary_enabled" \
  --env LOCAL_OPERATIONS_DEFERRED_MOVE_ENABLED="$deferred_move_enabled" \
  --env LOCAL_OPERATIONS_MANUAL_FINISH_ENABLED="$manual_finish_enabled" \
  --env LOCAL_OPERATIONS_MANUAL_ACTION_FINISH_ENABLED="$manual_action_finish_enabled" \
  --env LOCAL_OPERATIONS_RECORDED_ACTION_FINISH_ENABLED="$recorded_action_finish_enabled" \
  --env LOCAL_OPERATIONS_HISTORICAL_PREVIEW_ENABLED="$operations_candidate_probe" \
  --env LOCAL_OPERATIONS_TELEGRAM_SINK_ENABLED="$telegram_sink_enabled" \
  --env LOCAL_OPERATIONS_INTELLIGENCE_ENABLED="$intelligence_enabled" \
  --env LOCAL_OPERATIONS_HUD_BROWSER_ENABLED="$hud_browser_enabled" \
  --env LOCAL_OPERATIONS_HUD_LOAD_BARRIER="${LOCAL_OPERATIONS_HUD_LOAD_BARRIER:-0}" \
  --env LOCAL_OPERATIONS_HUD_CONTROL=/fixtures/hud-control \
  --env LOCAL_OPERATIONS_HUD_CONTROL_NONCE="${hud_control_nonce:-}" \
  --env LOCAL_OPERATIONS_REALTIME="$realtime_mode" \
  --env LOCAL_OPERATIONS_DEALER_FILE=/fixtures/dealer-fixture.json \
  --env LOCAL_OPERATIONS_CHECKIN_REPORT=/latency/dealer-checkin-http.json \
  --env LOCAL_OPERATIONS_LATENCY_REPORT=/latency/cashier-http.json \
  --env LOCAL_OPERATIONS_SOURCE_SHA="$source_sha" \
  --env LOCAL_OPERATIONS_AUDIENCE="$audience_count" \
  --env LOCAL_OPERATIONS_AUDIENCE_MODEL="$audience_model" \
  --env LOCAL_OPERATIONS_DIAGNOSTIC_SCOPE="$diagnostic_scope" \
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
prepare_current_movement_schema() {
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
}
start_candidate_broadcast() {
  [[ -z "${clock_flush_pid:-}" ]]
  LOCAL_CLOCK_CANDIDATE_STATUS="$test_root/isolated-status.json" \
  LOCAL_CLOCK_CANDIDATE_REPORT="$repo_root/output/operations-latency/clock-candidate-broadcast-http.json" \
    node "$repo_root/scripts/ops/clock-candidate-broadcast.mjs" &
  clock_flush_pid=$!
}
finish_candidate_broadcast() {
  kill -TERM "$clock_flush_pid"
  wait "$clock_flush_pid"
  clock_flush_pid=''
  node --input-type=module - "$repo_root/output/operations-latency/clock-candidate-broadcast-http.json" "$repo_root/output/operations-latency/clock-candidate-broadcast-bootstrap-http.json" <<'CLOCK_FLUSH_POSTCHECK'
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const report=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(report.phase,'stopped');assert.equal(report.failures,0);
assert.ok(report.completed>0);assert.ok(report.sent>0);
const bootstrap=JSON.parse(readFileSync(process.argv[3],'utf8'));
assert.equal(bootstrap.kind,'OWNED_CLOCK_REAL_BROADCAST_PUBLICATION_BOOTSTRAP');
assert.equal(typeof bootstrap.before.publication_exists,'boolean');assert.equal(typeof bootstrap.before.messages_published,'boolean');
assert.equal(bootstrap.messagesPublishedAfter,true);assert.equal(bootstrap.productionChanged,false);assert.equal(bootstrap.quotaChanged,false);
CLOCK_FLUSH_POSTCHECK
}
if [[ "$clock_candidate_probe" == 1 || "$operations_candidate_probe" == 1 ]]; then
  # This is a separate integration probe, never historical proof or32case PASS.
  # All source guards and checksums remain intact; no hand/HUD read activation.
  node --input-type=module - "$repo_root" >"$test_root/clock-candidate-migrations.list" <<'CANDIDATE_PATHS'
import {pathToFileURL} from 'node:url';
const root=process.argv[2];
const {loadPackage}=await import(pathToFileURL(root+'/scripts/ops/tracker-hud-20261104-release.mjs').href);
for(const entry of loadPackage(root).entries)console.log(entry.path);
CANDIDATE_PATHS
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'CLOCK_CANDIDATE_PREFLIGHT'
DO $$ BEGIN
 IF current_database()<>'postgres' OR to_regnamespace('tracker_analytics_v1') IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST')
 OR NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='ac300000-0000-4000-8000-000000000001' AND name='Operations clock TEST' AND status='registering')
 THEN RAISE EXCEPTION 'candidate_clock_requires_owned_fresh_fixture';END IF;
END $$;
CLOCK_CANDIDATE_PREFLIGHT
  # Full operations uses the current movement/read dependency chain before
  # candidate wrappers are installed. Never roll those wrappers back mid-test.
  if [[ "$operations_candidate_probe" == 1 ]]; then prepare_current_movement_schema;fi
  # The retained schema capture predates an already-live payout reader release.
  # Restore its exact missing private read dependencies, then apply its original
  # guarded migration. Never replace the candidate019 preimage requirement.
  node "$repo_root/scripts/ops/prepare-clock-payout-runtime-dependencies.mjs" "$test_root/clock-payout-dependencies.sql"
  { printf "SET vinpoker.isolated_clock_candidate='current-clock29-only';\n"; cat "$test_root/clock-payout-dependencies.sql"; } | \
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    <"$repo_root/supabase/migrations/20261103131615_payout_publication_after_cashier.sql"
  if [[ "$operations_candidate_probe" == 1 ]]; then
    # Install the existing current reader at its exact guarded preimage, before
    # candidate read-plan wrappers. No historical migration guard is rewritten.
    node "$repo_root/scripts/ops/prepare-cashier-runtime-dependencies.mjs" "$test_root/floor-v6-reader.sql" --restore-floor-v6-reader
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
      <"$test_root/floor-v6-reader.sql"
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
      <"$repo_root/supabase/migrations/20270128000062_floor_roster_participation_integrity_v6.sql"
  fi
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    <"$repo_root/supabase/migrations/20270128000299_participation_bagged_read_classification_v1.sql"
  candidate_count=0
  while IFS= read -r candidate_path; do
    [[ "$candidate_path" =~ ^supabase/migrations/[0-9]{14}_[a-z0-9_]+\.sql$ ]]
    if ! docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
      <"$repo_root/$candidate_path" >"$test_root/clock-candidate-apply.log" 2>&1; then
      echo "Candidate clock migration precondition/apply failed: $candidate_path" >&2; exit 1
    fi
    candidate_count=$((candidate_count+1))
  done <"$test_root/clock-candidate-migrations.list"
  [[ "$candidate_count" == 31 ]]

  candidate_flags="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c 'SELECT enabled,worker_enabled,backfill_complete FROM tracker_analytics_v1.config WHERE singleton;')"
  [[ "$candidate_flags" == 'f|f|f' ]]
  docker exec "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "NOTIFY pgrst,'reload schema';"
  # Match the existing scale harness: initialize actual DB Broadcast publication
  # before subscribers race lazy tenant setup. Record the observed prior state.
  # This changes only the owned fresh fixture, not production or tenant quotas.
  docker exec -i "$db_container" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -Atq -v ON_ERROR_STOP=1 -U supabase_admin -d postgres' \
    >"$repo_root/output/operations-latency/clock-candidate-broadcast-bootstrap-http.json" <<'CLOCK_BROADCAST_BOOTSTRAP'
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='10s';
CREATE TEMP TABLE clock_broadcast_before AS
 SELECT EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime_messages_publication') publication_exists,
 EXISTS(SELECT 1 FROM pg_publication_rel r JOIN pg_publication p ON p.oid=r.prpubid
  WHERE p.pubname='supabase_realtime_messages_publication' AND r.prrelid='realtime.messages'::regclass) messages_published;
DO $$ BEGIN
 IF current_database()<>'postgres'
 OR NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST')
 OR NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='ac300000-0000-4000-8000-000000000001' AND name='Operations clock TEST')
 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.config WHERE enabled OR worker_enabled OR backfill_complete)
 OR position('fixture_messages' IN pg_get_functiondef('realtime.send(jsonb,text,text,boolean)'::regprocedure))<>0
 THEN RAISE EXCEPTION 'clock_broadcast_requires_owned_real_fixture';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime_messages_publication') THEN
  CREATE PUBLICATION supabase_realtime_messages_publication FOR TABLE realtime.messages;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_publication_rel r JOIN pg_publication p ON p.oid=r.prpubid
  WHERE p.pubname='supabase_realtime_messages_publication' AND r.prrelid='realtime.messages'::regclass)
 THEN RAISE EXCEPTION 'clock_broadcast_publication_not_ready';END IF;
END $$;
COMMIT;
SELECT jsonb_build_object('kind','OWNED_CLOCK_REAL_BROADCAST_PUBLICATION_BOOTSTRAP',
 'observedAt',clock_timestamp(),'before',(SELECT to_jsonb(b) FROM clock_broadcast_before b),
 'messagesPublishedAfter',EXISTS(SELECT 1 FROM pg_publication_rel r JOIN pg_publication p ON p.oid=r.prpubid
  WHERE p.pubname='supabase_realtime_messages_publication' AND r.prrelid='realtime.messages'::regclass),
 'productionChanged',false,'quotaChanged',false,'qualification',false);
CLOCK_BROADCAST_BOOTSTRAP
  if [[ "$clock_candidate_probe" == 1 || "$audience_count" == 0 ]]; then
    start_candidate_broadcast
  fi
  if [[ "$clock_candidate_probe" == 1 ]]; then
    run_browser_proof '' '' 'canonical clock start reaches an already-open anonymous clock screen'
    finish_candidate_broadcast
    echo 'CLOCK_CANDIDATE_PROOF:exact31 migrations;reads/worker/backfill OFF;canonical control plus real HTTP Broadcast flush;clock-only scope'
    exit 0
  fi
  if [[ "$correction_undo_probe" == 1 ]]; then
    node --input-type=module - "$repo_root" >"$test_root/correction-candidate-path" <<'CORRECTION_CANDIDATE_PATH'
import {pathToFileURL} from 'node:url';
const {loadCorrectionPackage}=await import(pathToFileURL(process.argv[2]+'/scripts/ops/tracker-hud-20261104-release.mjs').href);
console.log(loadCorrectionPackage(process.argv[2]).entry.path);
CORRECTION_CANDIDATE_PATH
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'CORRECTION_OWNED_PREFLIGHT'
DO $$ BEGIN
 IF current_database()<>'postgres'
 OR NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST')
 OR NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='a3000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST Tour')
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.undo_tracker_last_action_v1(uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure) IS DISTINCT FROM '60291b40aab10a1deccbe2aae1195215'
 THEN RAISE EXCEPTION 'correction_probe_requires_owned_current_fixture';END IF;
END $$;
CORRECTION_OWNED_PREFLIGHT
    correction_path="$(cat "$test_root/correction-candidate-path")"
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <"$repo_root/$correction_path"
    docker exec "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "NOTIFY pgrst,'reload schema';"
  fi
  if [[ "$prize_close_probe" == 1 ]]; then
    node --input-type=module - "$repo_root" >"$test_root/close-prize-candidate-path" <<'CLOSE_PRIZE_CANDIDATE_PATH'
import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
const root=process.argv[2],{loadClosePackage}=await import(pathToFileURL(resolve(root,'scripts/ops/tracker-hud-close-paid-prize-20261107-release.mjs')));console.log(resolve(root,loadClosePackage(root).entry.path));
CLOSE_PRIZE_CANDIDATE_PATH
    node "$repo_root/scripts/ops/prepare-prize-close-runtime-dependencies.mjs" "$test_root/prize-close-dependencies.sql"
    { printf '%s\n' "SET vinpoker.isolated_prize_close='current-full34-only';"; cat "$test_root/prize-close-dependencies.sql"; } |
      docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
    node "$repo_root/scripts/ops/prepare-manual-cards-runtime-dependencies.mjs" "$test_root/manual-cards-dependencies.sql"
    { printf '%s\n' "SET vinpoker.isolated_manual_cards='current-http-showdown-only';"; cat "$test_root/manual-cards-dependencies.sql"; } |
      docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <"$(cat "$test_root/close-prize-candidate-path")"
  fi
  node --input-type=module - "$repo_root/output/operations-latency/operations-candidate-package-http.json" "$source_sha" "$reentry_transport_probe" "$reentry_fault_mode" "$correction_undo_probe" <<'OPERATIONS_PACKAGE_APPLIED'
import {writeFileSync} from 'node:fs';
writeFileSync(process.argv[2],JSON.stringify({kind:process.argv[4]==='1'?'BASE31_PLUS_PENDING_REENTRY_TRANSPORT_RUNTIME':'EXACT31_CANDIDATE_OPERATIONAL_RUNTIME',sha:process.argv[3],phase:'package-applied',migrations:31,pendingReentryTransportMigrations:process.argv[4]==='1'?1:0,pendingReentryTransportApplied:false,reentryFaultMode:process.argv[4]==='1'?process.argv[5]:null,correctionUndoProbe:process.argv[6]==='1',correctionMigrationApplied:process.argv[6]==='1',hudReads:false,hudWorker:false,backfillComplete:false,mixedSpectators:0,qualification:false,productionChanged:false,limitations:'Full operational stages follow; applied is not passed. Optional transports/correction are additional to base31,not in its release manifest. No mixed1000spectator capacity claim.'},null,2));
OPERATIONS_PACKAGE_APPLIED
  if [[ "$audience_count" != 0 ]]; then
    # Only the fresh isolated runtime is configured; hosted quotas stay intact.
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'AUDIENCE_OWNED_PREFLIGHT'
DO $$ BEGIN
 IF current_database()<>'postgres'
 OR NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST')
 OR NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='a3000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST Tour')
 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.config WHERE enabled OR worker_enabled OR backfill_complete)
 THEN RAISE EXCEPTION 'operational_audience_requires_fresh_owned_fixture';END IF;
END $$;
AUDIENCE_OWNED_PREFLIGHT
    # Install the complete current contracts before continuous viewer admission.
    # Fixture rows and all monetary/conservation assertions stay in their stages.
    install_current_paid_schema
    install_current_revenue_schema
    install_current_replacement_schema
    install_current_salary_schema
    install_current_start_schema
    install_current_finish_schema --before-audience
    install_current_action_schema before-audience
    current_schema_prepared=1
    if [[ "$audience_count" == 1000 ]]; then
      docker exec "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
        -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;' \
        >"$test_root/operations-rpc-statistics-private.log" 2>&1
      # Diagnostic headers only in the owned disposable stack. Verify an actual
      # header in the generator before admitting viewers; no hosted config change.
      docker exec "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
        -c "ALTER ROLE authenticator SET pgrst.server_timing_enabled='true'; NOTIFY pgrst,'reload config';" \
        >"$test_root/operations-server-timing-private.log" 2>&1
    fi
    # Match scale.stack.sh's load-generator FD budget. This is a host-process
    # prerequisite, not a hosted service/quota change or a product speed fix.
    audience_fd_before="$(ulimit -Sn)"
    ulimit -n 16384
    audience_fd_after="$(ulimit -Sn)"
    node --input-type=module - "$audience_fd_before" "$audience_fd_after" "$repo_root/output/operations-latency/operations-audience-generator-http.json" <<'AUDIENCE_GENERATOR_LIMITS'
import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';
const parse=value=>value==='unlimited'?'unlimited':/^\d+$/.test(value)?Number(value):null;
const before=parse(process.argv[2]),after=parse(process.argv[3]);
assert.notEqual(before,null);assert.ok(typeof after==='number'&&after>=16384);
writeFileSync(process.argv[4],JSON.stringify({kind:'ISOLATED_OPERATIONAL_GENERATOR_FD_BUDGET',before,after,scope:'generator-host-process-only',productionChanged:false,qualification:false},null,2));
AUDIENCE_GENERATOR_LIMITS
    docker exec "$realtime_container" /app/bin/realtime rpc '
      case Realtime.Api.update_tenant_by_external_id("realtime-dev", %{max_concurrent_users: 2000, max_events_per_second: 20000, max_joins_per_second: 5000, max_bytes_per_second: 100000000}) do
       {:ok, tenant} when tenant.max_concurrent_users == 2000 and tenant.max_events_per_second == 20000 and tenant.max_joins_per_second == 5000 and tenant.max_bytes_per_second == 100000000 ->
        cached=Enum.reduce_while(1..50, nil, fn _, _ ->
          value=Realtime.Tenants.Cache.get_tenant_by_external_id("realtime-dev")
          case value do
            %{max_concurrent_users: 2000, max_events_per_second: 20000, max_joins_per_second: 5000, max_bytes_per_second: 100000000} -> {:halt,value}
            _ -> Process.sleep(100); {:cont,nil}
          end
        end)
        if is_nil(cached), do: raise "isolated operational cached limits not ready"
        IO.puts(Jason.encode!(%{kind: "ISOLATED_OPERATIONAL_REALTIME_LIMITS", users: tenant.max_concurrent_users, eventsPerSecond: tenant.max_events_per_second, joinsPerSecond: tenant.max_joins_per_second, bytesPerSecond: tenant.max_bytes_per_second, cachedUsers: cached.max_concurrent_users, cachedEventsPerSecond: cached.max_events_per_second, cachedJoinsPerSecond: cached.max_joins_per_second, cachedBytesPerSecond: cached.max_bytes_per_second, productionChanged: false, qualification: false}))
       _ -> raise "isolated operational Realtime configuration failed"
      end' >"$test_root/operations-audience-realtime.log" 2>&1
    node --input-type=module - "$test_root/operations-audience-realtime.log" "$repo_root/output/operations-latency/operations-audience-realtime-http.json" <<'AUDIENCE_REALTIME_RECEIPT'
import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';
const lines=readFileSync(process.argv[2],'utf8').split(/\r?\n/).filter(line=>line.startsWith('{'));
const receipt=lines.map(line=>JSON.parse(line)).find(row=>row.kind==='ISOLATED_OPERATIONAL_REALTIME_LIMITS');
assert.equal(receipt?.users,2000);assert.equal(receipt?.eventsPerSecond,20000);assert.equal(receipt?.joinsPerSecond,5000);assert.equal(receipt?.bytesPerSecond,100000000);
assert.equal(receipt.cachedUsers,2000);assert.equal(receipt.cachedEventsPerSecond,20000);assert.equal(receipt.cachedJoinsPerSecond,5000);assert.equal(receipt.cachedBytesPerSecond,100000000);
assert.equal(receipt.productionChanged,false);writeFileSync(process.argv[3],JSON.stringify(receipt,null,2));
AUDIENCE_REALTIME_RECEIPT
    # The fixed marker is set only inside this already-owned ephemeral stack.
    { printf "COMMENT ON DATABASE postgres IS 'vinpoker-operational-schema-fence-disposable';\nSET vinpoker.isolated_schema_fence='cashier-current-schema-v1';\n";
      cat "$repo_root/supabase/pending-tests/operations_schema_freeze_fixture.sql"; } |
      docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
    docker exec "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "NOTIFY pgrst,'reload schema';"
    node --input-type=module - "$test_root/isolated-status.json" "$repo_root/output/operations-latency/operations-schema-readiness-http.json" <<'CURRENT_SCHEMA_HTTP_READY'
import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';
const status=JSON.parse(readFileSync(process.argv[2],'utf8'));assert.equal(status.API_URL,'http://127.0.0.1:54321');
const headers={apikey:status.ANON_KEY,Authorization:`Bearer ${status.ANON_KEY}`,'Content-Type':'application/json'};
const deadline=Date.now()+15000;let ready=false,attempts=0,last=null;
while(Date.now()<deadline&&!ready){
 attempts++;
 try{
  const marker=await fetch(status.API_URL+'/rest/v1/rpc/fixture_operations_schema_ready_v1',{method:'POST',headers,body:'{}',signal:AbortSignal.timeout(1000)});const acknowledgment=await marker.json();
  const clock=await fetch(status.API_URL+'/rest/v1/rpc/get_public_tournament_clock_summary',{method:'POST',headers,body:JSON.stringify({p_tournament_id:'a3000000-0000-4000-8000-000000000001'}),signal:AbortSignal.timeout(1000)});await clock.arrayBuffer();
  const denied=await fetch(status.API_URL+'/rest/v1/rpc/get_tracker_manual_finish_receipt_v1',{method:'POST',headers,body:JSON.stringify({p_intent:{}}),signal:AbortSignal.timeout(1000)});const denial=await denied.json();
  // PostgREST maps insufficient privilege to401 for anon and403 for an
  // authenticated caller. Both must retain PostgreSQL's exact42501 denial;
  // a missing/schema-stale route, a generic401, or a successful call is unsafe.
  last={markerStatus:marker.status,markerAcknowledged:acknowledgment==='operations-complete-schema-v1',clockStatus:clock.status,privateStatus:denied.status,privateCode:/^(42501|PGRST202)$/.test(denial.code)?denial.code:'other'};
  ready=marker.status===200&&last.markerAcknowledged&&clock.status===200&&[401,403].includes(denied.status)&&denial.code==='42501';
 }catch{last={transportFailed:true};/* Startup only; not a load failure exclusion. */}
 if(!ready)await new Promise(resolve=>setTimeout(resolve,250));
}
writeFileSync(process.argv[3],JSON.stringify({kind:'ISOLATED_COMPLETE_SCHEMA_HTTP_READINESS',ready,attempts,last,qualification:false,productionChanged:false},null,2));
assert.ok(ready,'Current public read and denied private Finish receipt routes must be schema-ready before admission');
CURRENT_SCHEMA_HTTP_READY
    if [[ "$audience_count" == 1000 ]]; then
      LOCAL_OPERATIONS_REST_POOL="$operations_rest_pool" node "$repo_root/scripts/ops/operations-postgrest-pool.mjs" \
        "$db_container" "$test_root/isolated-status.json" "$repo_root/output/operations-latency/operations-postgrest-pool-http.json"
    fi
    schema_before="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c 'SELECT ops_load_fixture_v1.catalog_fingerprint();')"
    [[ "$schema_before" =~ ^[0-9a-f]{32}$ ]]
    docker exec "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c 'UPDATE ops_load_fixture_v1.schema_fence SET frozen=true,admission_at=clock_timestamp() WHERE singleton;'
    node --input-type=module - "$schema_before" "$repo_root/output/operations-latency/operations-schema-freeze-http.json" <<'SCHEMA_FROZEN_RECEIPT'
import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';
assert.match(process.argv[2],/^[a-f0-9]{32}$/);writeFileSync(process.argv[3],JSON.stringify({kind:'ISOLATED_COMPLETE_SCHEMA_BEFORE_CONTINUOUS_AUDIENCE',phase:'frozen-before-admission',before:process.argv[2],after:null,unchanged:null,ddlGuardEnabled:true,schemaCacheAcknowledged:true,cacheProbeScope:'New constant-only fixture signature on the single owned PostgREST instance;not product behavior or latency evidence',qualification:false,productionChanged:false},null,2));
SCHEMA_FROZEN_RECEIPT
    # The pool experiment can recreate PostgREST. Start its HTTP worker only
    # after all fixture DDL, pool startup/readiness and the catalog freeze,
    # before admitting viewers or measuring any operational writes.
    start_candidate_broadcast
    if [[ "$audience_count" == 1000 ]]; then
      LOCAL_OPERATIONS_SOURCE_SHA="$source_sha" node "$repo_root/scripts/ops/operations-db-pressure.mjs" "$db_container" \
        "$repo_root/output/operations-latency/operations-db-pressure-http.json" >"$test_root/db-pressure-private.log" 2>&1 &
      db_pressure_pid=$!
      pressure_ready=false
      for _ in {1..10}; do
        if [[ -f "$repo_root/output/operations-latency/operations-db-pressure-http.json" ]] && jq -e '.phase=="observing" and .errors==0 and (.samples|length)>0' "$repo_root/output/operations-latency/operations-db-pressure-http.json" >/dev/null; then pressure_ready=true;break;fi
        if ! kill -0 "$db_pressure_pid" 2>/dev/null; then echo 'Isolated database observer exited before admission' >&2;exit 1;fi
        sleep 1
      done
      [[ "$pressure_ready" == true ]]
    fi
    LOCAL_OPERATIONS_AUDIENCE_STATUS="$test_root/isolated-status.json" \
    LOCAL_OPERATIONS_AUDIENCE_MODEL="$audience_model" \
    LOCAL_OPERATIONS_AUDIENCE_REPORT="$repo_root/output/operations-latency/operations-audience-http.json" \
    LOCAL_OPERATIONS_SOURCE_SHA="$source_sha" \
      node "$repo_root/scripts/ops/operations-audience.mjs" >"$test_root/operations-audience-private.log" 2>&1 &
    audience_pid=$!
    audience_ready=false
    for _ in {1..120}; do
      if [[ -f "$repo_root/output/operations-latency/operations-audience-http.json" ]] && [[ "$(jq -r '.phase' "$repo_root/output/operations-latency/operations-audience-http.json")" == ready ]]; then audience_ready=true;break;fi
      if ! kill -0 "$audience_pid" 2>/dev/null; then echo 'Operational audience exited before readiness' >&2;exit 1;fi
      sleep 1
    done
    [[ "$audience_ready" == true ]]
  fi
fi
# Validate the fresh46-attendance fixture before the first browser handover.
# Later checkout stages intentionally make those attendances ineligible.
if [[ "$schema_mode" == current && "$current_schema_prepared" != 1 ]]; then install_current_replacement_schema; fi
if [[ "$diagnostic_scope" != none ]]; then
  loaded_phase_checkpoint "targeted-$diagnostic_scope-start"
  if [[ "$diagnostic_scope" == cashier-payment ]]; then
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'TARGETED_PAYMENT_FIXTURE'
BEGIN;
DO $$ BEGIN
 IF shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM 'vinpoker-operational-schema-fence-disposable'
 OR NOT EXISTS(SELECT 1 FROM ops_load_fixture_v1.schema_fence WHERE singleton AND frozen AND admission_at IS NOT NULL)
 OR NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST')
 OR EXISTS(SELECT 1 FROM public.tournaments WHERE id BETWEEN 'a3000000-0000-4000-8000-000000000004' AND 'a3000000-0000-4000-8000-000000000013')
 OR EXISTS(SELECT 1 FROM public.game_tables WHERE id::text LIKE 'ac710000-0000-4000-8000-%')
 OR (SELECT count(*) FROM generate_series(1,100) n WHERE NOT EXISTS(
   SELECT 1 FROM public.game_tables g WHERE g.club_id='a2000000-0000-4000-8000-000000000001' AND g.table_number=n))<30
 THEN RAISE EXCEPTION 'targeted_payment_requires_empty_owned_fixture'; END IF;
END $$;
INSERT INTO public.centerpoint_tournament_ops_release(id,enabled,allowed_club_ids)
VALUES(true,true,ARRAY['a2000000-0000-4000-8000-000000000001'::uuid])
ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,allowed_club_ids=excluded.allowed_club_ids;
INSERT INTO public.tournaments(id,club_id,name,status,live_status,start_time,buy_in,rake_amount,service_fee_amount,free_rake_enabled,free_rake_slots,free_rake_used)
SELECT ('a3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'a2000000-0000-4000-8000-000000000001','Targeted Cashier payment TEST '||n,
 'registering','registering',now(),6000000,600000,0,false,0,0 FROM generate_series(4,13)n;
WITH slots AS(
 SELECT n table_number FROM generate_series(1,100)n
 WHERE NOT EXISTS(SELECT 1 FROM public.game_tables g WHERE g.club_id='a2000000-0000-4000-8000-000000000001' AND g.table_number=n)
 ORDER BY n LIMIT 30
), numbered AS(SELECT row_number() OVER(ORDER BY table_number) n,table_number FROM slots)
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
SELECT ('ac710000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'a2000000-0000-4000-8000-000000000001','Targeted Cashier payment TEST '||n,
 table_number,'tournament','inactive','available' FROM numbered;
COMMIT;
TARGETED_PAYMENT_FIXTURE
    # Original requests only: observe lock waits without changing source functions,
    # budgets or actor claims. Preserve a browser failure before any conservation gate.
    node "$repo_root/scripts/ops/operations-lock-diagnostics.mjs" "$db_container" "$repo_root/output/operations-latency/targeted-payment-locks-http.json" "$source_sha" >"$test_root/targeted-payment-lock-observer-private.log" 2>&1 &
    payment_lock_sampler_pid=$!
    targeted_observer_ready=false
    for _ in {1..30};do
      if ! kill -0 "$payment_lock_sampler_pid" 2>/dev/null;then wait "$payment_lock_sampler_pid";exit 1;fi
      if node -e 'try{process.exit(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).phase==="ready"?0:1)}catch{process.exit(1)}' "$repo_root/output/operations-latency/targeted-payment-locks-http.json";then targeted_observer_ready=true;break;fi
      sleep 1
    done
    [[ "$targeted_observer_ready" == true ]]
    targeted_browser_status=0
    run_browser_proof '' '' 'targeted canonical Cashier payment reproduction across ten fresh tours$' || targeted_browser_status=$?
    kill -TERM "$payment_lock_sampler_pid"
    targeted_observer_status=0
    wait "$payment_lock_sampler_pid" || targeted_observer_status=$?
    payment_lock_sampler_pid=''
    if [[ "$targeted_browser_status" != 0 ]];then exit "$targeted_browser_status";fi
    [[ "$targeted_observer_status" == 0 ]]
    docker exec -i "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres \
      >"$repo_root/output/operations-latency/targeted-payment-conservation-http.json" <<'TARGETED_PAYMENT_CONSERVATION'
WITH tours AS(SELECT id FROM public.tournaments WHERE club_id='a2000000-0000-4000-8000-000000000001' AND name LIKE 'Targeted Cashier payment TEST %'),
 regs AS(SELECT r.* FROM public.tournament_registrations r JOIN tours t ON t.id=r.tournament_id),
 moves AS(SELECT m.* FROM public.cashier_buyin_movements m JOIN regs r ON r.id=m.registration_id WHERE m.direction='in' AND m.purpose='buyin')
SELECT jsonb_build_object('kind','TARGETED_PAYMENT_CANONICAL_CONSERVATION','qualification',false,
 'tours',(SELECT count(*) FROM tours),'registrations',(SELECT count(*) FROM regs),
 'confirmedPaid',(SELECT count(*) FROM regs WHERE status='confirmed' AND cashier_paid_at IS NOT NULL),
 'movements',(SELECT count(*) FROM moves),'cash',(SELECT sum(applied_amount) FROM moves),
 'entries',(SELECT count(*) FROM public.tournament_entries e JOIN tours t ON t.id=e.tournament_id),
 'activeSeats',(SELECT count(*) FROM public.tournament_seats s JOIN tours t ON t.id=s.tournament_id WHERE s.is_active),
 'seatedChips',(SELECT sum(s.chip_count) FROM public.tournament_seats s JOIN tours t ON t.id=s.tournament_id WHERE s.is_active));
TARGETED_PAYMENT_CONSERVATION
    node --input-type=module - "$repo_root/output/operations-latency/targeted-payment-conservation-http.json" <<'TARGETED_PAYMENT_ASSERT'
import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const r=JSON.parse(readFileSync(process.argv[2],'utf8'));
for(const [k,v]of Object.entries({tours:10,registrations:200,confirmedPaid:200,movements:200,cash:1320000000,entries:200,activeSeats:200,seatedChips:4000000}))assert.equal(r[k],v,k);
TARGETED_PAYMENT_ASSERT
  else
    run_browser_proof '' '' 'real check-in HTTP commit, independent observation, exact retry and tenant boundary$'
    targeted_checkin_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SELECT
      (SELECT count(*) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='a2000000-0000-4000-8000-000000000001' AND a.status='checked_in' AND a.current_state='available'),
      (SELECT count(*) FROM public.table_operation_receipts WHERE operation_type='operator_check_in_dealer_v1'),
      (SELECT count(*) FROM public.dealer_attendance WHERE dealer_id='ad400000-0000-4000-8000-000000000002'),
      (SELECT count(*) FROM public.dealer_attendance WHERE dealer_id='ad400000-0000-4000-8000-000000000003' AND status='checked_in');")"
    [[ "$targeted_checkin_state" == "$checkin_dealer_count|$((checkin_dealer_count + 1))|0|1" ]]
  fi
  loaded_phase_checkpoint "targeted-$diagnostic_scope-end"
  targeted_minimum_hold=false
  for _ in {1..35};do
    kill -0 "$audience_pid"
    if node -e 'const a=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.exit(a.phase==="ready"&&a.activeDurationMs>=30000?0:1)' "$repo_root/output/operations-latency/operations-audience-http.json";then targeted_minimum_hold=true;break;fi
    sleep 1
  done
  [[ "$targeted_minimum_hold" == true ]]
  kill -TERM "$audience_pid";wait "$audience_pid";audience_pid=''
  if [[ -n "${db_pressure_pid:-}" ]];then kill -TERM "$db_pressure_pid";wait "$db_pressure_pid";db_pressure_pid='';fi
  kill -TERM "$clock_flush_pid";wait "$clock_flush_pid";clock_flush_pid=''
  targeted_after="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c 'SELECT ops_load_fixture_v1.catalog_fingerprint();')"
  node --input-type=module - "$repo_root/output/operations-latency" "$diagnostic_scope" "$audience_count" "$source_sha" "$targeted_after" <<'TARGETED_FINAL_RECEIPT'
import assert from'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';
const [dir,scope,count,sha,after]=process.argv.slice(2),read=name=>JSON.parse(readFileSync(dir+'/'+name,'utf8'));
const audience=read('operations-audience-http.json'),fence=read('operations-schema-freeze-http.json'),clock=read('clock-candidate-broadcast-http.json');
const runtime=read('operations-candidate-package-http.json');
assert.equal(runtime.pendingReentryTransportApplied,true);assert.equal(runtime.correctionMigrationApplied,true);
assert.equal(audience.phase,'passed');assert.equal(audience.viewers,Number(count));assert.ok(Object.values(audience.checks).every(v=>v===true));
assert.equal(fence.before,after);assert.equal(clock.phase,'stopped');assert.equal(clock.failures,0);
fence.after=after;fence.unchanged=true;fence.phase='unchanged-through-targeted-audience';writeFileSync(dir+'/operations-schema-freeze-http.json',JSON.stringify(fence,null,2));
writeFileSync(dir+'/targeted-operations-result-http.json',JSON.stringify({kind:'TARGETED_OPERATIONAL_REPRODUCTION_NOT_FULL_ACCEPTANCE',phase:'passed',scope,sha,viewers:Number(count),runtimeScope:'base31 plus healthy reentry, Undo and prize-close source preparation as in historical failures',schemaUnchanged:true,audienceContinuous:true,qualification:false,productionChanged:false,limits:'Only the selected diagnostic case ran. Does not replace full operations/HUD qualification, prove historical failure cause, or exercise the clock business flow.'},null,2));
TARGETED_FINAL_RECEIPT
  exit 0
fi
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
  if [[ "$current_schema_prepared" != 1 ]]; then install_current_paid_schema; fi
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'PAID_ASSET_FIXTURE'
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
SELECT ('ac700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'a2000000-0000-4000-8000-000000000001','Full cash seating TEST '||n,22+n,'tournament','inactive','available'
FROM generate_series(1,3) n;
PAID_ASSET_FIXTURE
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
  if [[ "$reentry_transport_probe" == 1 && "$reentry_fault_mode" == failure-injection ]]; then
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'REENTRY_BANK_AMBIGUITY_SETUP'
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres' OR to_regclass('ops_reentry_transport_probe_v1.bank_probe_before') IS NULL
  OR (SELECT count(*) FROM public.platform_bank_accounts WHERE is_active AND account_number='999100001')<>1
  OR NOT EXISTS(SELECT 1 FROM public.platform_bank_accounts WHERE id='a4000000-0000-4000-8000-000000000001'
   AND club_id='a2000000-0000-4000-8000-000000000001' AND is_active AND account_number='999100001')
  OR NOT EXISTS(SELECT 1 FROM public.club_payment_config WHERE club_id='a2000000-0000-4000-8000-000000000001'
   AND is_active AND master_account_number='999100001' AND api_token_vault_key IS NOT NULL)
  OR EXISTS(SELECT 1 FROM public.tournament_registrations WHERE tournament_id='a3000000-0000-4000-8000-000000000001' AND source_entry_id IS NOT NULL)
 THEN RAISE EXCEPTION 'isolated_reentry_bank_preimage_drift';END IF;
END $$;
INSERT INTO ops_reentry_transport_probe_v1.bank_probe_before VALUES(true,ops_reentry_transport_probe_v1.bank_probe_source_snapshot());
INSERT INTO public.platform_bank_accounts(id,club_id,bank_name,account_number,account_holder,is_active)
VALUES('ae400000-0000-4000-8000-000000000099','a2000000-0000-4000-8000-000000000001','AMBIGUOUS TEST BANK','999100001','AMBIGUOUS TEST ONLY',true);
COMMIT;
REENTRY_BANK_AMBIGUITY_SETUP
    LOCAL_REENTRY_BANK_PROBE_STAGE=1 run_browser_proof '' 1 'pending reentry transport rejects ambiguous payment account before creation'
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'REENTRY_BANK_AMBIGUITY_RECOVERY'
BEGIN;
DO $$ DECLARE removed integer; BEGIN
 IF (SELECT snapshot FROM ops_reentry_transport_probe_v1.bank_probe_before WHERE singleton)
  IS DISTINCT FROM ops_reentry_transport_probe_v1.bank_probe_source_snapshot()
  OR (SELECT count(*) FROM public.platform_bank_accounts WHERE is_active AND account_number='999100001')<>2
 THEN RAISE EXCEPTION 'reentry_bank_denial_changed_source';END IF;
 DELETE FROM public.platform_bank_accounts WHERE id='ae400000-0000-4000-8000-000000000099'
  AND club_id='a2000000-0000-4000-8000-000000000001' AND account_number='999100001' AND account_holder='AMBIGUOUS TEST ONLY';
 GET DIAGNOSTICS removed=ROW_COUNT;
 IF removed<>1 OR (SELECT count(*) FROM public.platform_bank_accounts WHERE is_active AND account_number='999100001')<>1 THEN
  RAISE EXCEPTION 'reentry_bank_fixture_recovery_failed';END IF;
END $$;
COMMIT;
REENTRY_BANK_AMBIGUITY_RECOVERY
    node --input-type=module - "$repo_root/output/operations-latency/cashier-http-reentry-bank-ambiguity-http.json" "$repo_root/output/operations-latency/reentry-bank-ambiguity-native-conservation.json" <<'REENTRY_BANK_AMBIGUITY_RECEIPT'
import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';
const file=process.argv[2],report=JSON.parse(readFileSync(file,'utf8'));assert.equal(report.phase,'denied');assert.equal(report.httpStatus,503);
// The browser owns its original receipt inside Docker. Preserve it and write the
// host's subsequent native SQL assertions to a separate private receipt.
writeFileSync(process.argv[3],JSON.stringify({kind:'ISOLATED_REENTRY_BANK_DENIAL_NATIVE_CONSERVATION',sha:report.sha,
 browserReceipt:'cashier-http-reentry-bank-ambiguity-http.json',nativeSourceUnchanged:true,fixtureBankRestored:true,
 qualification:false,productionChanged:false},null,2),{mode:0o600,flag:'wx'});
REENTRY_BANK_AMBIGUITY_RECEIPT
    node "$repo_root/tests/cashier/reentryDisconnect.native.mjs" "$db_container" \
      "$repo_root/output/operations-latency/reentry-transport-disconnect-native.json" "$source_sha"
    docker exec -i "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
      <"$repo_root/supabase/pending-tests/reentry_transport_timeout_rollback.sql" >"$test_root/reentry-timeout-native.log"
    node --input-type=module - "$test_root/reentry-timeout-native.log" "$repo_root/output/operations-latency/reentry-transport-notification-timeout-native.json" "$source_sha" <<'REENTRY_NOTIFICATION_TIMEOUT_RECEIPT'
import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';
const rows=readFileSync(process.argv[2],'utf8').trim().split(/\r?\n/).map(line=>JSON.parse(line));assert.equal(rows.length,2);
const [pending,recovered]=rows;assert.equal(pending.phase,'pending-survived-timeout');assert.equal(pending.timeoutAttempts,1);
assert.ok(Number.isFinite(pending.elapsedMs)&&pending.elapsedMs>=150&&pending.elapsedMs<=3000);
assert.equal(recovered.phase,'outer-rollback-preserved-source');assert.equal(recovered.sourceUnchanged,true);assert.equal(recovered.modeReset,true);
writeFileSync(process.argv[3],JSON.stringify({kind:'REAL_PG_STATEMENT_TIMEOUT_REENTRY_SUBTRANSACTION_ROLLBACK',sha:process.argv[4],
 pendingSurvivedNotificationTimeout:true,timeoutAttempts:1,elapsedMs:pending.elapsedMs,outerRollbackPreservedSource:true,
 edgeHttp:false,committedPayment:false,qualification:false,productionChanged:false,
 limitations:'Native canonical bust/service reentry under real database roles and300ms statement timeout against a5second notification sleep. All source changes rolled back;not verified-player EdgeHTTP,committed-payment or connection-termination proof.'},null,2));
REENTRY_NOTIFICATION_TIMEOUT_RECEIPT
  fi
  reentry_latency_failed=0
  if run_browser_proof '' 1 'current Floor bust and player reentry preserve separate paid entry generations'; then
    :
  else
    # Only the candidate path owns the mandatory final aggregate-failure gate.
    [[ "$operations_candidate_probe" == 1 ]] || exit 1
    # Only continue measurements after every source/retry/Auth assertion passed.
    # The unchanged1s latency failure remains fatal at the final gate below.
    node --input-type=module - "$repo_root/output/operations-latency/cashier-http-bust-reentry-http.json" "$source_sha" <<'REENTRY_LATENCY_ONLY_FAILURE'
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const r=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(r.sha,process.argv[3]);assert.equal(r.kind,'REAL_AUTH_FLOOR_BUST_REENTRY_EDGE_AND_CANONICAL_CASH_SEATING');
assert.equal(r.phase,'latency-failed');assert.equal(r.failure,null);assert.equal(r.graded,20);assert.equal(r.warmup,0);assert.equal(r.qualification,false);assert.equal(r.rows.length,20);
assert.deepEqual(r.rows.map(x=>x.actor),Array.from({length:20},(_,i)=>i));
const keys=['bustMs','bustRetryMs','registrationMs','registrationRetryMs','paymentMs','paymentRetryMs','independentReadMs'];
for(const key of keys){const values=r.rows.map(x=>x[key]);assert.ok(values.every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0));values.sort((a,b)=>a-b);assert.equal(r.distributions[key].samples,20);assert.equal(r.distributions[key].p95Ms,values[18]);assert.equal(r.distributions[key].maxMs,values[19]);}
assert.ok(['bustMs','registrationMs','paymentMs'].some(key=>r.distributions[key].p95Ms>1000));
REENTRY_LATENCY_ONLY_FAILURE
    reentry_latency_failed=1
    echo 'REENTRY_LATENCY_FAILED:retained;collecting later stages after mandatory committed-state conservation'
  fi
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
  if [[ "$reentry_transport_probe" == 1 && "$reentry_fault_mode" == failure-injection ]]; then
    notification_fault_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
      "SELECT CASE WHEN is_called THEN last_value ELSE 0 END,
       (SELECT count(*) FROM public.notifications WHERE data->>'reentry'='true' AND data->>'tournament_id'='a3000000-0000-4000-8000-000000000001')
       FROM ops_reentry_transport_probe_v1.notification_attempts;")"
    [[ "$notification_fault_state" == '20|0' ]]
    node --input-type=module - "$repo_root/output/operations-latency/reentry-transport-notification-fault-http.json" "$source_sha" <<'REENTRY_OPTIONAL_NOTIFICATION_PROOF'
import {writeFileSync} from 'node:fs';
writeFileSync(process.argv[2],JSON.stringify({kind:'REAL_COMPOSITE_REENTRY_NOTIFICATION_SUBTRANSACTION_FAILURE',sha:process.argv[3],
 notificationAttempts:20,committedOptionalNotifications:0,canonicalReentriesPaidAndSeated:20,
 concurrentCreationRequests:20,concurrentCreated:1,qualification:false,productionChanged:false,
 limitations:'Immediate AFTER INSERT exception only;not statement timeout,connection termination,bank ambiguity or closed-buy race proof.'},null,2));
REENTRY_OPTIONAL_NOTIFICATION_PROOF
  elif [[ "$reentry_transport_probe" == 1 ]]; then
    healthy_notifications="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
      "SELECT count(*),count(DISTINCT user_id) FROM public.notifications WHERE data->>'reentry'='true' AND data->>'tournament_id'='a3000000-0000-4000-8000-000000000001';")"
    [[ "$healthy_notifications" == '20|20' ]]
    node --input-type=module - "$repo_root/output/operations-latency/reentry-transport-healthy-notifications-http.json" "$source_sha" <<'REENTRY_HEALTHY_NOTIFICATION_PROOF'
import {writeFileSync} from 'node:fs';
writeFileSync(process.argv[2],JSON.stringify({kind:'REAL_COMPOSITE_REENTRY_HEALTHY_NOTIFICATIONS',sha:process.argv[3],
 faultInjection:false,committedNotifications:20,distinctRecipients:20,canonicalReentriesPaidAndSeated:20,
 concurrentCreationRequests:20,concurrentCreated:1,qualification:false,productionChanged:false,
 limitations:'Healthy in-app notification inserts only;not Telegram delivery,full operational load qualification or connection-termination recovery proof.'},null,2));
REENTRY_HEALTHY_NOTIFICATION_PROOF
  fi
  if [[ "$current_schema_prepared" != 1 ]]; then install_current_revenue_schema; fi
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
  if [[ "$operations_candidate_probe" != 1 ]]; then
    prepare_current_movement_schema
  fi
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
-- No schema changed in this parity read.
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
DO $$ DECLARE target jsonb;spare uuid;result jsonb;BEGIN
 SELECT payload INTO STRICT target FROM floor_private.dealer_initial_assign_receipts WHERE request_key LIKE 'checkout_replace_%';
 SELECT id INTO STRICT spare FROM public.dealer_attendance WHERE id IN(md5('checkout-replacement-attendance-1')::uuid,md5('checkout-replacement-attendance-2')::uuid) AND current_state='available';
 UPDATE public.dealer_attendance SET last_released_at=now()-interval '20 minutes',pool_entered_at=now()-interval '20 minutes' WHERE id=spare;
INSERT INTO public.dealers(id,club_id,full_name,status,tier,skills) VALUES(md5('checkout-replacement-dealer-4')::uuid,'ad500000-0000-4000-8000-000000000001','Replacement eligibility TEST 4','active','A',ARRAY['holdem']);
INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,current_state,check_in_time,last_released_at,pool_entered_at) VALUES(md5('checkout-replacement-attendance-4')::uuid,md5('checkout-replacement-dealer-4')::uuid,'ad300000-0000-4000-8000-000000000003',(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'checked_in','available',now()-interval '1 hour',now()-interval '20 minutes',now()-interval '20 minutes');
PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
 SELECT public.worker_assign_dealer_to_session_v1((target->>'club')::uuid,(target->>'table')::uuid,(target->>'session')::uuid,spare,now()+interval '45 minutes','off_race_fixture_assignment') INTO result;
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
  if [[ "$current_schema_prepared" != 1 ]]; then install_current_salary_schema; fi
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -v owner_id="$owner_id" <<'STAFF_SALARY_FIXTURE'
BEGIN;
DO $$ BEGIN
 IF (SELECT count(*) FROM auth.users WHERE email='cashier-latency-20@test.invalid')<>1
 OR EXISTS(SELECT 1 FROM public.clubs WHERE owner_id=(SELECT id FROM auth.users WHERE email='cashier-latency-20@test.invalid'))
 THEN RAISE EXCEPTION 'salary_fixture_requires_independent_unowned_actor';END IF;
END $$;
INSERT INTO public.clubs(id,owner_id,name,region,status)
SELECT 'af200000-0000-4000-8000-000000000001',id,'Staff salary HTTP TEST','HCM','approved'
FROM auth.users WHERE email='cashier-latency-20@test.invalid';
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
  if [[ "$current_schema_prepared" != 1 ]]; then install_current_start_schema; fi
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -v owner_id="$owner_id" <<'TRACKER_QUEUE_FIXTURE'
INSERT INTO public.club_trackers(club_id,user_id,granted_by)
VALUES('a2000000-0000-4000-8000-000000000001',:'owner_id'::uuid,:'owner_id'::uuid) ON CONFLICT DO NOTHING;
-- The Cashier fixture deliberately has no blind structure. Canonical Tracker
-- start must freeze a real Floor level; retain its guard rather than bypass it.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
   WHERE t.id='a3000000-0000-4000-8000-000000000001' AND t.name='Cashier Edge TEST Tour'
    AND c.id='a2000000-0000-4000-8000-000000000001' AND c.name='Cashier Edge TEST'
    AND t.current_level_id IS NULL)
 OR EXISTS(SELECT 1 FROM public.tournament_levels WHERE tournament_id='a3000000-0000-4000-8000-000000000001')
 OR EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='a3000000-0000-4000-8000-000000000001')
 THEN RAISE EXCEPTION 'deferred_tracker_blind_fixture_preimage_drift';END IF;
END $$;
INSERT INTO public.tournament_levels(id,tournament_id,level_number,small_blind,big_blind,ante,duration_minutes,is_break)
VALUES('af910000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',1,100,200,200,20,false);
UPDATE public.tournaments SET current_level=1,current_level_id='af910000-0000-4000-8000-000000000001'
WHERE id='a3000000-0000-4000-8000-000000000001';
COMMIT;
TRACKER_QUEUE_FIXTURE
  run_browser_proof '' '' 'current Floor deferred move reserves and cancels without joining an active hand' '' '' '' '' '' 1
  deferred_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SELECT
    (SELECT count(*) FROM public.floor_pending_tracker_moves WHERE requested_reason='isolated deferred queue/cancel TEST' AND status='cancelled'),
    (SELECT count(*) FROM public.floor_pending_tracker_moves WHERE requested_reason='isolated deferred queue/cancel TEST' AND status<>'cancelled'),
    (SELECT count(*) FROM floor_private.tracker_hand_seat_snapshots193),
    (SELECT count(*) FROM public.tournament_hands WHERE tournament_id='a3000000-0000-4000-8000-000000000001' AND hand_number=9001 AND status='in_progress'
      AND tracker_level_id='af910000-0000-4000-8000-000000000001' AND tracker_level_number=1
      AND tracker_small_blind=100 AND tracker_big_blind=200 AND tracker_bba=200 AND tracker_is_break=false);")"
  if [[ "$deferred_state" != '21|0|2|1' ]]; then echo "Deferred queue/cancel conservation failed ($deferred_state)" >&2; exit 1; fi
  echo 'DEFERRED_QUEUE_CANCEL_PROOF:21cancelled reservations;zero unresolved;two frozen hand participants;active hand retained'
  if [[ "$current_schema_prepared" != 1 ]]; then install_current_finish_schema; fi
  run_browser_proof '' '' 'canonical zero-pot Finish applies a pending move only after the hand' '' '' '' '' '' '' 1
  finish_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SELECT
    (SELECT count(*) FROM public.floor_pending_tracker_moves WHERE requested_reason='isolated deferred apply TEST' AND status='applied'),
    (SELECT count(*) FROM floor_private.tracker_hand_seat_snapshots193),
    (SELECT count(*) FROM public.tournament_hands WHERE tournament_id='a3000000-0000-4000-8000-000000000001' AND hand_number=9001 AND status='completed'),
    (SELECT count(*) FROM public.tournament_hands WHERE tournament_id='a3000000-0000-4000-8000-000000000001' AND hand_number=9002 AND status='in_progress');")"
  if [[ "$finish_state" != '1|5|1|1' ]]; then echo "Canonical Finish/deferred apply conservation failed ($finish_state)" >&2; exit 1; fi
  echo 'MANUAL_FINISH_APPLY_PROOF:one applied reservation;two old-hand participants;three next-hand participants;single completed hand'
  if [[ "$current_schema_prepared" != 1 ]]; then install_current_action_schema; fi
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -v owner_id="$owner_id" <<'MANUAL_ACTION_ACTORS'
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
  WHERE t.id='a3000000-0000-4000-8000-000000000001' AND t.name='Cashier Edge TEST Tour'
   AND c.id='a2000000-0000-4000-8000-000000000001' AND c.name='Cashier Edge TEST')
 OR (SELECT count(*) FROM public.tournament_hands WHERE tournament_id='a3000000-0000-4000-8000-000000000001' AND hand_number=9002 AND status='in_progress')<>1
 OR EXISTS(SELECT 1 FROM public.hand_actions a JOIN public.tournament_hands h ON h.id=a.hand_id WHERE h.tournament_id='a3000000-0000-4000-8000-000000000001')
 THEN RAISE EXCEPTION 'manual_action_actor_fixture_drift';END IF;
END $$;
INSERT INTO public.club_trackers(club_id,user_id,granted_by)
SELECT 'a2000000-0000-4000-8000-000000000001',u.id,:'owner_id'::uuid
FROM generate_series(1,20) n JOIN auth.users u ON u.email='cashier-latency-'||n||'@test.invalid';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.club_trackers ct JOIN auth.users u ON u.id=ct.user_id
  JOIN generate_series(1,20) n ON u.email='cashier-latency-'||n||'@test.invalid'
  WHERE ct.club_id='a2000000-0000-4000-8000-000000000001')<>20
 THEN RAISE EXCEPTION 'manual_action_twenty_actor_grants_required';END IF;
END $$;
COMMIT;
MANUAL_ACTION_ACTORS
  manual_finish_latency_failed=0
  if run_browser_proof '' '' 'twenty current manual Finish hands preserve supplied actions and payouts' '' '' '' '' '' '' '' 1; then
    :
  else
    [[ "$operations_candidate_probe" == 1 ]] || exit 1
    node --input-type=module - "$repo_root/output/operations-latency/cashier-http-manual-action-finish-http.json" "$source_sha" <<'MANUAL_FINISH_LATENCY_ONLY_FAILURE'
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const r=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(r.sha,process.argv[3]);assert.equal(r.kind,'REAL_AUTH_TWENTY_MANUAL_SUPPLIED_ACTION_FINISH_HTTP');
assert.equal(r.phase,'graded-failed');assert.equal(r.failure,null);assert.equal(r.warmupCompleted,true);assert.equal(r.actors,20);assert.equal(r.qualification,false);assert.equal(r.rows.length,20);
assert.deepEqual(r.rows.map(x=>x.handNumber),Array.from({length:20},(_,i)=>9003+i));
const keys=['startMs','finishMs','retryMs','receiptMs','independentReadMs'];
for(const key of keys){const values=r.rows.map(x=>x[key]);assert.ok(values.every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0));values.sort((a,b)=>a-b);assert.equal(r.distributions[key].samples,20);assert.equal(r.distributions[key].p95Ms,values[18]);assert.equal(r.distributions[key].maxMs,values[19]);}
assert.ok(keys.some(key=>r.distributions[key].p95Ms>1000));
MANUAL_FINISH_LATENCY_ONLY_FAILURE
    manual_finish_latency_failed=1
    echo 'MANUAL_FINISH_LATENCY_FAILED:retained;collecting later stages after mandatory committed-state conservation'
  fi
  action_finish_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SELECT
    (SELECT count(*) FROM public.tournament_hands WHERE tournament_id='a3000000-0000-4000-8000-000000000001' AND hand_number BETWEEN 9002 AND 9022 AND status='completed'),
    (SELECT count(*) FROM public.hand_actions a JOIN public.tournament_hands h ON h.id=a.hand_id WHERE h.tournament_id='a3000000-0000-4000-8000-000000000001' AND h.hand_number BETWEEN 9002 AND 9022),
    (SELECT count(*) FROM floor_private.tracker_hand_seat_snapshots193),
    (SELECT count(*) FROM public.tournament_hands WHERE tournament_id='a3000000-0000-4000-8000-000000000001' AND status='in_progress');")"
  if [[ "$action_finish_state" != '21|105|65|0' ]]; then echo "Manual action Finish conservation failed ($action_finish_state)" >&2; exit 1; fi
  echo 'MANUAL_ACTION_FINISH_PROOF:21completed three-player hands;105exact actions;65seat snapshots;zero active hands'
  if [[ "$correction_undo_probe" == 1 ]]; then
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'CORRECTION_TEST_SCOPE'
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='a3000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST Tour')
 OR EXISTS(SELECT 1 FROM public.tracker_correction_uat_scopes WHERE tournament_id='a3000000-0000-4000-8000-000000000001')
 THEN RAISE EXCEPTION 'correction_test_scope_preimage_drift';END IF;
END $$;
INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled,expires_at)
SELECT t.club_id,tt.tournament_id,tt.id,actor.id,'undo_open_hand',true,now()+interval '10 minutes'
FROM public.tournament_tables tt JOIN public.tournaments t ON t.id=tt.tournament_id CROSS JOIN auth.users actor
WHERE tt.tournament_id='a3000000-0000-4000-8000-000000000001' AND actor.email='cashier-latency-1@test.invalid'
 AND (SELECT count(*) FROM public.tournament_seats s WHERE s.tournament_table_id=tt.id AND s.is_active)=3
 AND EXISTS(SELECT 1 FROM public.tournament_seats s JOIN auth.users p ON p.id=s.player_id WHERE s.tournament_table_id=tt.id AND s.is_active AND p.email='cashier-latency-3@test.invalid');
DO $$ BEGIN
 IF (SELECT count(*) FROM public.tracker_correction_uat_scopes WHERE tournament_id='a3000000-0000-4000-8000-000000000001' AND capability='undo_open_hand' AND enabled AND expires_at>now())<>1
 THEN RAISE EXCEPTION 'correction_test_scope_requires_exact_actor_table';END IF;
END $$;
DO $$ DECLARE
 scope_row public.tracker_correction_uat_scopes%ROWTYPE;
 owner_actor uuid;physical uuid;session_id uuid;dealer uuid:=gen_random_uuid();shift uuid:=gen_random_uuid();attendance uuid;answer jsonb;
BEGIN
 SELECT * INTO STRICT scope_row FROM public.tracker_correction_uat_scopes
 WHERE tournament_id='a3000000-0000-4000-8000-000000000001' AND capability='undo_open_hand' AND enabled;
 SELECT c.owner_id,tt.game_table_id,tt.table_session_id INTO STRICT owner_actor,physical,session_id
 FROM public.tournament_tables tt JOIN public.clubs c ON c.id=scope_row.club_id WHERE tt.id=scope_row.tournament_table_id;
 IF EXISTS(SELECT 1 FROM public.dealers WHERE club_id=scope_row.club_id AND user_id=scope_row.user_id)
 OR EXISTS(SELECT 1 FROM public.dealer_assignments WHERE table_id=physical AND released_at IS NULL AND status IN('assigned','on_break','pre_assigned','reserved'))
 THEN RAISE EXCEPTION 'correction_dealer_fixture_requires_unused_identity_and_session';END IF;
 INSERT INTO public.dealers(id,club_id,user_id,full_name,status) VALUES(dealer,scope_row.club_id,scope_row.user_id,'Undo HTTP TEST dealer','active');
 INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES(shift,scope_row.club_id,'Undo HTTP TEST shift','00:00','23:59');
 PERFORM set_config('request.jwt.claim.sub',owner_actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',owner_actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 answer:=public.operator_check_in_dealer_v1(dealer,scope_row.club_id,shift,gen_random_uuid());
 IF answer->>'ok' IS DISTINCT FROM 'true' OR answer->>'outcome' IS DISTINCT FROM 'checked_in' THEN RAISE EXCEPTION 'correction_canonical_checkin_failed';END IF;
 PERFORM set_config('role','none',true);
 SELECT id INTO STRICT attendance FROM public.dealer_attendance WHERE dealer_id=dealer AND check_out_time IS NULL;
 PERFORM set_config('request.headers',jsonb_build_object('x-vinpoker-dealer-intent','manual','x-vinpoker-dealer-actor',owner_actor)::text,true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM set_config('role','service_role',true);
 answer:=public.worker_assign_dealer_to_session_v1(scope_row.club_id,physical,session_id,attendance,statement_timestamp()+interval '45 minutes','undo-http-fixture:'||dealer::text);
 IF answer->>'outcome' IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'correction_canonical_assignment_failed';END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT count(*) FROM public.dealers d JOIN public.dealer_assignments a ON a.dealer_id=d.id JOIN public.dealer_attendance att ON att.id=a.attendance_id
  WHERE d.user_id=scope_row.user_id AND d.club_id=scope_row.club_id AND a.table_id=physical AND a.table_session_id=session_id
   AND a.status='assigned' AND a.released_at IS NULL AND att.status IN('checked_in','overtime') AND att.check_out_time IS NULL)<>1
 THEN RAISE EXCEPTION 'correction_exact_dealer_assignment_required';END IF;
END $$;
COMMIT;
CORRECTION_TEST_SCOPE
  fi
  run_browser_proof '' '' 'recorded actions enforce budget and merge once through canonical Finish|owner historical preview verifies the canonical recorded hand over real HTTP|anonymous public replay reads the recorded hand through actual HTTP' '' '' '' '' '' '' '' '' 1
  recorded_finish_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SELECT
    (SELECT count(*) FROM public.tournament_hands WHERE tournament_id='a3000000-0000-4000-8000-000000000001' AND hand_number=9023 AND status='completed'),
    (SELECT count(*) FROM public.hand_actions a JOIN public.tournament_hands h ON h.id=a.hand_id WHERE h.tournament_id='a3000000-0000-4000-8000-000000000001' AND h.hand_number=9023),
    (SELECT count(*) FROM floor_private.tracker_hand_seat_snapshots193),
    (SELECT count(*) FROM public.tournament_hands WHERE tournament_id='a3000000-0000-4000-8000-000000000001' AND status='in_progress');")"
  if [[ "$recorded_finish_state" != '1|5|68|0' ]]; then echo "Recorded action Finish conservation failed ($recorded_finish_state)" >&2; exit 1; fi
  echo 'RECORDED_ACTION_FINISH_PROOF:one completed hand;five stable actions;one first action after20contenders;68snapshots;zero active hands'
  if [[ "$realtime_mode" == 1 ]]; then
    docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'TELEGRAM_FIXTURE'
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST')
 OR EXISTS(SELECT 1 FROM public.club_settings WHERE club_id='a2000000-0000-4000-8000-000000000001' AND telegram_chat_id IS NOT NULL)
 OR EXISTS(SELECT 1 FROM public.dealers WHERE full_name LIKE 'Notification TEST%')
 THEN RAISE EXCEPTION 'synthetic_notification_fixture_preimage_drift';END IF;
END $$;
INSERT INTO public.club_settings(club_id,telegram_chat_id) VALUES('a2000000-0000-4000-8000-000000000001','-1000000000001')
 ON CONFLICT(club_id) DO UPDATE SET telegram_chat_id=excluded.telegram_chat_id;
INSERT INTO public.dealers(id,club_id,full_name,status,telegram_username,telegram_user_id)
SELECT md5('http-notification-dealer-'||n)::uuid,'a2000000-0000-4000-8000-000000000001','Notification TEST <'||n||'> & Dealer','active','notify_test_'||n,9900000000000+n
FROM generate_series(1,22) n;
COMMIT;
TELEGRAM_FIXTURE
    run_browser_proof '' '' 'checkout notifications reach the isolated HTTP sink once with dealer tags' '' '' '' '' '' '' '' '' '' 1
    telegram_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SELECT
      (SELECT count(*) FROM public.dealers WHERE full_name LIKE 'Notification TEST%'),
      (SELECT count(*) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.full_name LIKE 'Notification TEST%' AND a.status='checked_out' AND a.current_state='checked_out'),
      (SELECT count(*) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.full_name LIKE 'Notification TEST%' AND a.status='checked_in');")"
    if [[ "$telegram_state" != '22|22|0' ]]; then echo "Notification checkout conservation failed ($telegram_state)" >&2;exit 1;fi
    echo 'TELEGRAM_SYNTHETIC_PROOF:22canonical checkouts;20graded group/DM pairs;single-send20contender race;provider-failure retains checkout'
    run_browser_proof '' '' 'owner Intelligence reads match confirmed registration identities over real HTTP' '' '' '' '' '' '' '' '' '' '' 1
  fi
fi

if [[ "$operations_candidate_probe" == 1 ]]; then
  if [[ "$manual_finish_latency_failed" == 1 ]]; then
    echo 'Operational latency qualification FAILED:manual Finish1s gate;later measurements do not erase it' >&2
    exit 1
  fi
  if [[ "$reentry_latency_failed" == 1 ]]; then
    echo 'Operational latency qualification FAILED:reentry1s gate;later measurements do not erase it' >&2
    exit 1
  fi
  if [[ "$audience_count" != 0 ]]; then
    # Prepare before prize introduces separate-tour hands. The loaded HUD
    # pauses before withdrawal so active spectators keep their public scope.
    mkdir -p "$test_root/hud-control/requests" "$test_root/hud-control/receipts"
    hud_control_nonce="$(node -e 'console.log(require("node:crypto").randomUUID())')"
    LOCAL_OPERATIONS_SOURCE_SHA="$source_sha" LOCAL_OPERATIONS_HUD_CONTROL_NONCE="$hud_control_nonce" node "$repo_root/scripts/ops/prepare-operations-public-hud.mjs" \
      "$test_root/isolated-status.json" "$db_container" "$repo_root/output/operations-latency/operations-hud-backfill-http.json" "$test_root/hud-control" >"$test_root/hud-projector-private.log" 2>&1 &
    hud_projector_pid=$!
    hud_prepared=false
    for ((hud_wait=0;hud_wait<130;hud_wait++)); do
      if ! kill -0 "$hud_projector_pid" 2>/dev/null; then echo 'Isolated HUD preparation stopped before readiness' >&2;wait "$hud_projector_pid";exit 1;fi
      if node -e 'try{const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.exit(v.phase==="serving"&&v.readsEnabled===true&&v.shadow?.passed===true&&v.spectatorReady===true&&v.spectatorFailed===0?0:1)}catch{process.exit(1)}' "$repo_root/output/operations-latency/operations-hud-backfill-http.json"; then hud_prepared=true;break;fi
      sleep 1
    done
    [[ "$hud_prepared" == true ]]
    loaded_phase_checkpoint hud-start
    LOCAL_OPERATIONS_HUD_LOAD_BARRIER=1 run_browser_proof '' '' 'anonymous prepared HUD reads canonical operational history and replay' '' '' '' '' '' '' '' '' '' '' '' 1 &
    hud_browser_pid=$!
    hud_loaded=false
    for ((hud_wait=0;hud_wait<180;hud_wait++)); do
      if ! kill -0 "$hud_browser_pid" 2>/dev/null; then echo 'HUD browser stopped before loaded boundary' >&2;wait "$hud_browser_pid";exit 1;fi
      if node -e 'try{const r=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.exit(r.sha===process.argv[2]&&r.nonce===process.argv[3]&&r.loaded===true?0:1)}catch{process.exit(1)}' "$test_root/hud-control/requests/loaded-ready.json" "$source_sha" "$hud_control_nonce"; then hud_loaded=true;break;fi
      sleep 1
    done
    [[ "$hud_loaded" == true ]]
    loaded_phase_checkpoint hud-loaded
  fi
fi

# Redraw/prize use separate disposable tours under the same database load.
# Their reports retain that scope; they are not the tour watched by the audience.
if [[ "$redraw_probe" == 1 ]]; then
  loaded_phase_checkpoint redraw-start
  # Exact captured redraw writers retain their operational release gate. Save
  # its private preimage, enable only this disposable club, and restore it even
  # when the browser fails. This does not replace any actor/tenant checks.
  redraw_release_before="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SELECT encode(convert_to(coalesce((SELECT to_jsonb(r)::text FROM public.centerpoint_tournament_ops_release r WHERE id),'null'),'UTF8'),'hex');")"
  [[ "$redraw_release_before" =~ ^[a-f0-9]+$ ]]
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'REDRAW_RELEASE_FIXTURE'
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST')
 OR NOT EXISTS(SELECT 1 FROM ops_load_fixture_v1.schema_fence WHERE frozen)
 THEN RAISE EXCEPTION 'redraw_release_fixture_scope_required';END IF;
END $$;
INSERT INTO public.centerpoint_tournament_ops_release(id,enabled,allowed_club_ids)
VALUES(true,true,ARRAY['a2000000-0000-4000-8000-000000000001'::uuid])
ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,allowed_club_ids=excluded.allowed_club_ids;
-- Separate the legacy Cashier compatibility fixture from modern redraw.
-- Entries/payment/seats are created by canonical HTTP below,never copied.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.tournaments WHERE id='a3000000-0000-4000-8000-000000000004')
 OR EXISTS(SELECT 1 FROM public.game_tables WHERE club_id='a2000000-0000-4000-8000-000000000001' AND table_number BETWEEN 91 AND 93)
 THEN RAISE EXCEPTION 'redraw_fresh_fixture_collision';END IF;
END $$;
INSERT INTO public.tournaments(id,club_id,name,status,live_status,start_time,buy_in,rake_amount,service_fee_amount,free_rake_enabled,free_rake_slots,free_rake_used)
VALUES('a3000000-0000-4000-8000-000000000004','a2000000-0000-4000-8000-000000000001','Canonical redraw TEST','registering','registering',now(),6000000,600000,0,false,0,0);
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
SELECT ('ac710000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'a2000000-0000-4000-8000-000000000001','Canonical redraw TEST '||n,90+n,'tournament','inactive','available' FROM generate_series(1,3)n;
COMMIT;
REDRAW_RELEASE_FIXTURE
  if [[ "$audience_count" == 10 ]]; then
    node --test "$repo_root/scripts/ops/operations-lock-diagnostics.test.mjs"
    node "$repo_root/scripts/ops/operations-lock-diagnostics.mjs" "$db_container" "$repo_root/output/operations-latency/redraw-original-payment-locks-http.json" "$source_sha" >"$test_root/payment-lock-observer-private.log" 2>&1 &
    payment_lock_sampler_pid=$!
    lock_observer_ready=false
    for _ in {1..30}; do
      if ! kill -0 "$payment_lock_sampler_pid" 2>/dev/null; then wait "$payment_lock_sampler_pid";exit 1;fi
      if node -e 'try{process.exit(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).phase==="ready"?0:1)}catch{process.exit(1)}' "$repo_root/output/operations-latency/redraw-original-payment-locks-http.json"; then lock_observer_ready=true;break;fi
      sleep 1
    done
    [[ "$lock_observer_ready" == true ]]
  fi
  redraw_browser_status=0
  LOCAL_OPERATIONS_REDRAW_ENABLED=1 run_browser_proof '' '' 'final current Floor seat locks and redraw conserve every paid entry over HTTP' || redraw_browser_status=$?
  if [[ -n "${payment_lock_sampler_pid:-}" ]]; then
    kill -TERM "$payment_lock_sampler_pid"
    wait "$payment_lock_sampler_pid"
    payment_lock_sampler_pid=''
  fi
  if [[ "$redraw_browser_status" != 0 ]]; then
    # A separate, rollback-only diagnostic invocation may recover or fail with
    # a different timing. It never changes the original failed test result.
    docker exec -i "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
      >"$repo_root/output/operations-latency/redraw-postfailure-rollback-probe-http.json" <<'REDRAW_ROLLBACK_PROBE' || true
BEGIN;
SET LOCAL lock_timeout='250ms';SET LOCAL statement_timeout='5s';
DO $probe$
DECLARE r public.tournament_registrations%ROWTYPE;v jsonb;code text;constraint_name text;table_name text;message text;context text;frames jsonb;
BEGIN
 IF shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM 'vinpoker-operational-schema-fence-disposable'
 OR NOT EXISTS(SELECT 1 FROM ops_load_fixture_v1.schema_fence WHERE singleton AND frozen)
 THEN RAISE EXCEPTION 'rollback_probe_requires_owned_disposable';END IF;
 SELECT * INTO r FROM public.tournament_registrations WHERE tournament_id='a3000000-0000-4000-8000-000000000004'
 AND status='pending' AND cashier_seating_error='seating_exception' ORDER BY id LIMIT 1;
 IF r.id IS NULL THEN v:=jsonb_build_object('invoked',false);
 ELSE
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',r.player_id,'role','authenticated')::text,true);
  BEGIN
   v:=public.cashier_try_seat_paid_v1(r.id,r.player_id);
   v:=jsonb_build_object('invoked',true,'exception',false,'seated',v->>'seating_state'='seated');
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE,constraint_name=CONSTRAINT_NAME,table_name=TABLE_NAME,message=MESSAGE_TEXT,context=PG_EXCEPTION_CONTEXT;
   SELECT coalesce(jsonb_agg(jsonb_build_object('function',m[1],'line',m[2]::integer)),'[]'::jsonb) INTO frames
   FROM regexp_matches(context,'PL/pgSQL function ([a-zA-Z0-9_.]+)\([^)]*\) line ([0-9]+)','g') m;
   v:=jsonb_build_object('invoked',true,'exception',true,'sqlstate',code,
    'constraint',CASE WHEN constraint_name ~ '^[a-zA-Z0-9_]{1,128}$' THEN constraint_name END,
    'table',CASE WHEN table_name ~ '^[a-zA-Z0-9_]{1,128}$' THEN table_name END,'messageMd5',md5(message),'frames',frames);
  END;
 END IF;
 PERFORM set_config('vinpoker.rollback_probe_result',(v||jsonb_build_object('kind','SEPARATE_POSTFAILURE_ROLLBACK_DIAGNOSTIC','originalSqlstateProven',false,'qualification',false,'productionChanged',false,'allWritesRolledBack',true))::text,true);
END $probe$;
SELECT current_setting('vinpoker.rollback_probe_result');
ROLLBACK;
REDRAW_ROLLBACK_PROBE
  fi
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<REDRAW_RELEASE_RESTORE
BEGIN;
DO \$\$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.centerpoint_tournament_ops_release WHERE id AND enabled AND allowed_club_ids=ARRAY['a2000000-0000-4000-8000-000000000001'::uuid])
 THEN RAISE EXCEPTION 'redraw_release_fixture_restore_drift';END IF;
END \$\$;
DELETE FROM public.centerpoint_tournament_ops_release WHERE id;
INSERT INTO public.centerpoint_tournament_ops_release
SELECT r.* FROM jsonb_populate_record(NULL::public.centerpoint_tournament_ops_release,NULLIF(convert_from(decode('$redraw_release_before','hex'),'UTF8')::jsonb,'null'::jsonb)) r
WHERE convert_from(decode('$redraw_release_before','hex'),'UTF8')::jsonb<>'null'::jsonb;
DO \$\$ BEGIN
 IF encode(convert_to(coalesce((SELECT to_jsonb(r)::text FROM public.centerpoint_tournament_ops_release r WHERE id),'null'),'UTF8'),'hex')<>'$redraw_release_before'
 THEN RAISE EXCEPTION 'redraw_release_fixture_preimage_not_restored';END IF;
END \$\$;
COMMIT;
REDRAW_RELEASE_RESTORE
  if [[ "$redraw_browser_status" != 0 ]]; then
    # Preserve only cardinalities of the exact plan joins, never profile/seat
    # payloads. A scalar exception alone cannot identify which binding failed.
    docker exec -i "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres \
      >"$repo_root/output/operations-latency/cashier-http-floor-redraw-diagnostic-http.json" <<'REDRAW_JOIN_DIAGNOSTIC'
WITH active AS (
 SELECT * FROM public.tournament_seats WHERE tournament_id='a3000000-0000-4000-8000-000000000004' AND is_active
), entries AS (
 SELECT s.*,e.player_id AS entry_player_id FROM active s JOIN public.tournament_entries e ON e.id=s.entry_id AND e.tournament_id=s.tournament_id
), tables AS (
 SELECT s.*,tt.game_table_id FROM entries s JOIN public.tournament_tables tt ON tt.id=s.tournament_table_id AND tt.status='active'
), sessions AS (
 SELECT s.* FROM tables s JOIN public.table_sessions ts ON ts.id=s.table_session_id AND ts.closed_at IS NULL
), assets AS (
 SELECT s.* FROM sessions s JOIN public.game_tables gt ON gt.id=s.game_table_id
), profiles AS (
 SELECT s.id FROM assets s LEFT JOIN public.profiles p ON p.user_id=s.entry_player_id
)
SELECT jsonb_build_object('kind','READ_ONLY_REDRAW_PLAN_JOIN_CARDINALITIES',
 'activeSeats',(SELECT count(*) FROM active),'entryJoined',(SELECT count(*) FROM entries),
 'tableJoined',(SELECT count(*) FROM tables),'sessionJoined',(SELECT count(*) FROM sessions),
 'assetJoined',(SELECT count(*) FROM assets),'profileJoined',(SELECT count(*) FROM profiles),
 'distinctProfileJoinedSeats',(SELECT count(DISTINCT id) FROM profiles),
 'nullSeatSession',(SELECT count(*) FROM active WHERE table_session_id IS NULL),
 'seatSessionMismatch',(SELECT count(*) FROM active s JOIN public.tournament_tables tt ON tt.id=s.tournament_table_id WHERE s.table_session_id IS DISTINCT FROM tt.table_session_id),
 'openLocks',(SELECT count(*) FROM public.table_session_seat_locks WHERE tournament_id='a3000000-0000-4000-8000-000000000004' AND unlocked_at IS NULL),
 'planBodyMd5',(SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.floor_plan_tournament_redraw_v1(uuid,integer,uuid[],uuid)'::regprocedure),
 'databaseDeadlocks',(SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()),
 'productionChanged',false);
REDRAW_JOIN_DIAGNOSTIC
    exit "$redraw_browser_status"
  fi
  node --input-type=module - "$repo_root/output/operations-latency/cashier-http-floor-redraw-http.json" "$source_sha" <<'FINAL_REDRAW_RECEIPT'
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const r=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(r.sha,process.argv[3]);assert.equal(r.phase,'passed');assert.equal(r.failure,null);
assert.equal(r.locks.length,20);assert.equal(r.redraws.length,20);assert.equal(r.qualification,false);assert.equal(r.legacyOrphanDenied,true);
FINAL_REDRAW_RECEIPT
fi


if [[ "$redraw_probe" == 1 ]]; then loaded_phase_checkpoint redraw-end; fi
if [[ "$prize_close_probe" == 1 ]]; then
  loaded_phase_checkpoint prize-start
  prize_history_before="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SELECT coalesce((SELECT player_history_enabled::text FROM public.club_settings WHERE club_id='a2000000-0000-4000-8000-000000000001'),'missing');")"
  [[ "$prize_history_before" == true || "$prize_history_before" == false || "$prize_history_before" == missing ]]
  docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'PRIZE_CLOSE_FRESH_FIXTURE'
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST')
 OR NOT EXISTS(SELECT 1 FROM ops_load_fixture_v1.schema_fence WHERE frozen)
 OR EXISTS(SELECT 1 FROM public.tournaments WHERE id='a3000000-0000-4000-8000-000000000005')
 OR EXISTS(SELECT 1 FROM public.game_tables WHERE club_id='a2000000-0000-4000-8000-000000000001' AND table_number=94)
 THEN RAISE EXCEPTION 'prize_close_fresh_fixture_scope_required';END IF;
END $$;
INSERT INTO public.tournaments(id,club_id,name,status,live_status,start_time,buy_in,rake_amount,service_fee_amount,free_rake_enabled,free_rake_slots,free_rake_used)
VALUES('a3000000-0000-4000-8000-000000000005','a2000000-0000-4000-8000-000000000001','Canonical paid prize TEST','registering','registering',now(),6000000,600000,0,false,0,0);
INSERT INTO public.tournament_levels(id,tournament_id,level_number,small_blind,big_blind,ante,duration_minutes,is_break)
VALUES('ac720001-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000005',1,100,200,0,20,false);
UPDATE public.tournaments SET current_level=1,current_level_id='ac720001-0000-4000-8000-000000000001'
WHERE id='a3000000-0000-4000-8000-000000000005';
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
VALUES('ac720000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','Canonical paid prize TEST',94,'tournament','inactive','available');
INSERT INTO public.club_settings(club_id,player_history_enabled) VALUES('a2000000-0000-4000-8000-000000000001',true)
ON CONFLICT(club_id) DO UPDATE SET player_history_enabled=true;
COMMIT;
PRIZE_CLOSE_FRESH_FIXTURE
  prize_close_status=0
  LOCAL_OPERATIONS_PRIZE_CLOSE_ENABLED=1 run_browser_proof '' '' 'final current Floor Cashier prizes close over real Auth HTTP' || prize_close_status=$?
  if [[ "$prize_history_before" == missing ]]; then
    docker exec "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "DELETE FROM public.club_settings WHERE club_id='a2000000-0000-4000-8000-000000000001';"
  else
    docker exec "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "UPDATE public.club_settings SET player_history_enabled=$prize_history_before WHERE club_id='a2000000-0000-4000-8000-000000000001';"
  fi
  [[ "$prize_close_status" == 0 ]]
  node --input-type=module - "$repo_root/output/operations-latency/cashier-http-prize-close-http.json" "$source_sha" <<'FINAL_PRIZE_CLOSE_RECEIPT'
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const r=JSON.parse(readFileSync(process.argv[2],'utf8'));assert.equal(r.sha,process.argv[3]);assert.equal(r.phase,'passed');assert.equal(r.failure,null);assert.equal(r.paidRows,1);assert.equal(r.prizeTotal,18000000);assert.equal(r.reconcileDelta,0);assert.equal(r.qualification,false);
assert.deepEqual(r.showdownHands,[{number:880001,pots:[200],endings:[19900,20000,20100]},{number:880002,pots:[59700,200],endings:[100,200,59700]},{number:880003,pots:[300,200],endings:[0,0,60000]}]);
assert.deepEqual(r.payoutUi,{loaded:true,dialogVerified:true,cancelPreservedUnpaid:true,confirmed:true,paidVisible:true});
FINAL_PRIZE_CLOSE_RECEIPT
fi


if [[ "$prize_close_probe" == 1 ]]; then loaded_phase_checkpoint prize-end; fi
if [[ "$operations_candidate_probe" == 1 ]]; then
  loaded_phase_checkpoint before-drain
  if [[ "$audience_count" != 0 ]]; then
    kill -TERM "$audience_pid"
    wait "$audience_pid"
    audience_pid=''
    if [[ -n "${db_pressure_pid:-}" ]]; then
      kill -TERM "$db_pressure_pid"
      wait "$db_pressure_pid"
      db_pressure_pid=''
    fi
    node --input-type=module - "$repo_root/output/operations-latency/operations-audience-http.json" "$audience_count" <<'AUDIENCE_FINAL_RECEIPT'
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const report=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(report.phase,'passed');assert.equal(report.viewers,Number(process.argv[3]));assert.ok(Object.values(report.checks).every(value=>value===true));
AUDIENCE_FINAL_RECEIPT
    schema_after="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SELECT ops_load_fixture_v1.catalog_fingerprint()
      WHERE EXISTS(SELECT 1 FROM ops_load_fixture_v1.schema_fence WHERE singleton AND frozen AND admission_at IS NOT NULL)
      AND EXISTS(SELECT 1 FROM pg_event_trigger WHERE evtname='ops_load_schema_frozen' AND evtenabled='O');")"
    node --input-type=module - "$schema_after" "$repo_root/output/operations-latency/operations-schema-freeze-http.json" <<'SCHEMA_UNCHANGED_RECEIPT'
import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';
const report=JSON.parse(readFileSync(process.argv[3],'utf8'));assert.match(process.argv[2],/^[a-f0-9]{32}$/);report.after=process.argv[2];report.unchanged=report.before===report.after;report.phase=report.unchanged?'unchanged-through-audience':'catalog-drift';writeFileSync(process.argv[3],JSON.stringify(report,null,2));assert.equal(report.unchanged,true,'Catalog/ACL/source contracts changed during continuous audience');
SCHEMA_UNCHANGED_RECEIPT
  fi
  finish_candidate_broadcast
  node --input-type=module - "$repo_root/output/operations-latency/operations-candidate-package-http.json" <<'OPERATIONS_PACKAGE_FINISHED'
import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';
const report=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(report.phase,'package-applied');assert.equal(report.migrations,31);
if(report.pendingReentryTransportMigrations===1)assert.equal(report.pendingReentryTransportApplied,true);
report.mixedSpectators=Number(process.env.LOCAL_OPERATIONS_AUDIENCE??0);report.phase='all-operational-stages-passed';report.limitations='All configured operational stages completed on base31candidate'+(report.pendingReentryTransportMigrations===1?' plus pending reentry transport':'')+'. HUD reads/worker remain OFF. Optional mixed audience has its own mandatory report/checks; this is not the1Mhand/full qualification or hosted cron proof.';
writeFileSync(process.argv[2],JSON.stringify(report,null,2));
OPERATIONS_PACKAGE_FINISHED
  if [[ -n "${hud_browser_pid:-}" ]]; then
    node --input-type=module - "$test_root/hud-control/receipts/audience-drained.json" "$source_sha" "$hud_control_nonce" <<'HUD_DRAIN_BARRIER'
import{writeFileSync}from'node:fs';writeFileSync(process.argv[2],JSON.stringify({sha:process.argv[3],nonce:process.argv[4],drained:true}));
HUD_DRAIN_BARRIER
    wait "$hud_browser_pid"
    hud_browser_pid=''
    kill -TERM "$hud_projector_pid"
    wait "$hud_projector_pid"
    hud_projector_pid=''
    node --input-type=module - "$repo_root/output/operations-latency" <<'PREPARED_HUD_FINAL_RECEIPT'
import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';
const root=process.argv[2],read=name=>JSON.parse(readFileSync(root+'/'+name,'utf8'));
const backfill=read('operations-hud-backfill-http.json'),browser=read('cashier-http-public-hud-ui-http.json');
assert.equal(backfill.phase,'stopped');assert.equal(backfill.readsEnabled,true);assert.equal(backfill.shadow.passed,true);assert.equal(backfill.finalShadow.passed,true);assert.equal(backfill.controls.uniqueApplied,2);assert.equal(backfill.controls.complete,true);assert.equal(browser.phase,'passed');
assert.equal(backfill.spectatorReady,true);assert.equal(backfill.spectatorFailed,0);
assert.ok(Object.values(browser.checks).every(value=>value===true));
const pkg=read('operations-candidate-package-http.json');assert.equal(pkg.phase,'all-operational-stages-passed');
pkg.hudReads=true;pkg.hudWorker=true;pkg.backfillComplete=true;pkg.preparedHudBrowser='passed';
pkg.limitations='HUD read/reopen/settlement phases,redraw and prize ran before audience drain with phase-boundary readiness checks. HUD withdrawal/restore ran after drain. Actual fixture backfill/raw shadow enabled isolated HUD reads for one anonymous browser test. Separate reports define scope;not full1Mhand/load qualification,full HUD lifecycle or hosted cron proof.';
writeFileSync(root+'/operations-candidate-package-http.json',JSON.stringify(pkg,null,2));
PREPARED_HUD_FINAL_RECEIPT
  fi
fi
