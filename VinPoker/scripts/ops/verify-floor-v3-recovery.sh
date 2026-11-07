#!/usr/bin/env bash
set -euo pipefail

artifact_dir="${1:-}"
rehearsal_mode="${2:-}"
[[ -z "$rehearsal_mode" || "$rehearsal_mode" == '--hud-full34-rehearsal' ]] || exit 64
if [[ -z "$artifact_dir" ]]; then
  echo "Encrypted recovery artifact directory is required" >&2
  exit 64
fi
: "${FLOOR_BACKUP_AGE_IDENTITY:?Protected recovery identity is unavailable}"
: "${GITHUB_RUN_ID:?Workflow run id is unavailable}"

encrypted_file="$(find "$artifact_dir" -maxdepth 1 -type f -name 'floor-v3-recovery-*.tar.gz.age' -print -quit)"
test -n "$encrypted_file" || { echo "Encrypted recovery payload is missing" >&2; exit 1; }
test -s "$encrypted_file" || { echo "Encrypted recovery payload is empty" >&2; exit 1; }
test -f "$artifact_dir/ciphertext.sha256" || { echo "Ciphertext checksum receipt is missing" >&2; exit 1; }

readonly test_root="${RUNNER_TEMP}/floor-v3-restore-${GITHUB_RUN_ID}"
readonly project_root="$test_root/project"
readonly verified_anon_key_sha256="7289b818ee2251d46c8cf3fc5a94ce961f936cdc7c94b7979b8b1a0936b286b8"
fingerprint_guard="$(cd -- "$(dirname -- "$0")" && pwd)/check-floor-v3-anon-exception.mjs"
readonly fingerprint_guard
readonly firewall_chain="FLOORV3_${GITHUB_RUN_ID}"
readonly plain_archive="$test_root/floor-v3-recovery.tar.gz"
readonly identity_path="$test_root/age-identity.txt"
readonly archive_root="$test_root/restore"
readonly restored_db="postgres"
db_container=""
network=""
bridge=""

cleanup() {
  if [[ -n "$project_root" ]]; then
    supabase stop --workdir "$project_root" --no-backup >/dev/null 2>&1 || true
  fi
  if [[ -n "$bridge" ]]; then
    sudo iptables -w -D DOCKER-USER -i "$bridge" -j "$firewall_chain" >/dev/null 2>&1 || true
    sudo iptables -w -F "$firewall_chain" >/dev/null 2>&1 || true
    sudo iptables -w -X "$firewall_chain" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$test_root"
}
trap cleanup EXIT

umask 077
mkdir -p "$test_root" "$archive_root"
(cd "$artifact_dir" && sha256sum --check --status ciphertext.sha256) || {
  echo "Encrypted recovery checksum failed" >&2
  exit 1
}
printf '%s\n' "$FLOOR_BACKUP_AGE_IDENTITY" >"$identity_path"
age --decrypt --identity "$identity_path" --output "$plain_archive" "$encrypted_file" 2>/dev/null || {
  echo "Stored recovery key could not decrypt the downloaded ciphertext" >&2
  exit 1
}
rm -f -- "$identity_path"
if tar -tzf "$plain_archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "Recovery archive contains an unsafe path" >&2
  exit 1
fi
tar -xzf "$plain_archive" -C "$archive_root" 2>/dev/null || {
  echo "Decrypted recovery archive could not be extracted" >&2
  exit 1
}
rm -f -- "$plain_archive"

payload_root="$archive_root/payload"
for required in database.dump roles-no-passwords.sql table-counts.tsv metadata.txt manifest.sha256 archive-list.txt; do
  test -s "$payload_root/$required" || {
    echo "Required encrypted recovery member is missing or empty" >&2
    exit 1
  }
done
(cd "$payload_root" && sha256sum --check --status manifest.sha256) || {
  echo "Decrypted recovery member checksum failed" >&2
  exit 1
}
database_context_verified=false
if grep -Fxq 'database_context_version=1' "$payload_root/metadata.txt"; then
  test -s "$payload_root/database-context.json"
  grep -Eq '^[a-f0-9]{64}  database-context.json$' "$payload_root/manifest.sha256"
  context_helper="$(cd -- "$(dirname -- "$0")" && pwd)/recovery-database-context.mjs"
  node "$context_helper" restore-sql "$payload_root/database-context.json" "$test_root/restore-database-context.sql" 2>"$test_root/database-context-prepare.log" || {
    echo "Encrypted database context is unsupported; raw metadata withheld" >&2; exit 1;
  }
elif grep -q '^database_context_version=' "$payload_root/metadata.txt"; then
  echo "Unknown database context receipt version" >&2; exit 1
fi
grep -q '^dump_format=single_pg_dump_custom_archive_with_shared_exported_snapshot$' "$payload_root/metadata.txt" || {
  echo "Recovery receipt does not prove one shared MVCC snapshot" >&2
  exit 1
}
grep -Fxq 'credential_exception_project_ref=orlesggcjamwuknxwcpk' "$payload_root/metadata.txt"
grep -Fxq 'credential_exception_functions=public.fn_dispatch_push()' "$payload_root/metadata.txt"
grep -Fxq "credential_exception_token_sha256=$verified_anon_key_sha256" "$payload_root/metadata.txt"
grep -Fxq 'credential_exception_scope=encrypted recovery archive only' "$payload_root/metadata.txt"
grep -Eq 'TABLE DATA public tournaments[[:space:]]' "$payload_root/archive-list.txt"
grep -Eq 'TABLE DATA public tournament_seats[[:space:]]' "$payload_root/archive-list.txt"
grep -Eq 'TABLE DATA supabase_migrations schema_migrations[[:space:]]' "$payload_root/archive-list.txt"

docker pull curlimages/curl:8.12.1 >/dev/null
supabase init --workdir "$project_root" >"$test_root/init.log" 2>&1 || {
  echo "Isolated Supabase PostgreSQL initialization failed; raw logs withheld" >&2
  exit 1
}
sed -i "s/^project_id = .*/project_id = \"$restored_db\"/" "$project_root/supabase/config.toml"
test "$(grep -c "^project_id = \"$restored_db\"$" "$project_root/supabase/config.toml")" = 1

exclude_services="imgproxy,logflare,mailpit,postgres-meta,realtime,storage-api,studio,supavisor,vector"
supabase start --workdir "$project_root" --exclude "$exclude_services" >"$test_root/start.log" 2>&1 || {
  echo "Isolated Supabase database start failed; raw logs withheld" >&2
  exit 1
}
db_container="$(docker ps -q --filter "name=supabase_db_${restored_db}")"
test -n "$db_container" || { echo "Isolated PostgreSQL container was not found" >&2; exit 1; }
test "$(wc -w <<<"$db_container" | tr -d ' ')" = 1 || { echo "Unexpected number of isolated PostgreSQL containers" >&2; exit 1; }
network="$(docker inspect "$db_container" --format '{{json .NetworkSettings.Networks}}' | jq -er 'keys | if length == 1 then .[0] else error("expected one network") end')"
network_json="$(docker network inspect "$network")"
test "$(jq -r '.[0].EnableIPv6' <<<"$network_json")" = false
subnet="$(jq -r '.[0].IPAM.Config[0].Subnet' <<<"$network_json")"
bridge="br-$(jq -r '.[0].Id[:12]' <<<"$network_json")"
[[ -n "$subnet" && "$bridge" =~ ^br-[0-9a-f]{12}$ && "$firewall_chain" =~ ^FLOORV3_[0-9]+$ ]]
sudo iptables -w -N "$firewall_chain"
sudo iptables -w -A "$firewall_chain" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
sudo iptables -w -A "$firewall_chain" -d "$subnet" -j RETURN
sudo iptables -w -A "$firewall_chain" -j REJECT
sudo iptables -w -I DOCKER-USER 1 -i "$bridge" -j "$firewall_chain"
sudo iptables -w -C DOCKER-USER -i "$bridge" -j "$firewall_chain"
if docker run --rm --network "$network" curlimages/curl:8.12.1 --silent --show-error --max-time 5 https://example.com >/dev/null 2>&1; then
  echo "Isolated restore network still has outbound access" >&2
  exit 1
fi

# Even the local restore DB must not launch restored scheduled work or external jobs.
docker exec --user root "$db_container" sh -ceu 'printf "\ncron.launch_active_jobs = off\n" >>"$PGDATA/postgresql.auto.conf"'
docker restart "$db_container" >/dev/null
until docker exec "$db_container" pg_isready -U postgres -d postgres >/dev/null 2>&1; do sleep 1; done
cron_setting="$(docker exec "$db_container" psql -X -Atq -U postgres -d postgres -c 'SHOW cron.launch_active_jobs' 2>/dev/null || true)"
if [[ "$cron_setting" != "off" ]]; then
  echo "Isolated pg_cron execution could not be disabled" >&2
  exit 1
fi

local_superuser_state="$(docker exec "$db_container" sh -ceu \
  'exec env PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -X -Atq -U supabase_admin -d postgres \
    -c "SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user"')"
if [[ "$local_superuser_state" != 'supabase_admin|t' ]]; then
  echo "Disposable Supabase admin role is unavailable or not a superuser" >&2
  exit 1
fi

roles_for_restore="$test_root/roles-for-restore.sql"
postgres_role_after_restore="$test_root/postgres-role-after-restore.sql"
sed -E \
  -e '/^(CREATE ROLE|ALTER ROLE) "?(postgres|supabase_admin)"?([ ;]|$)/d' \
  "$payload_root/roles-no-passwords.sql" >"$roles_for_restore"
grep -E '^ALTER ROLE "?postgres"?([ ;]|$)' \
  "$payload_root/roles-no-passwords.sql" >"$postgres_role_after_restore"
test -s "$roles_for_restore"
test -s "$postgres_role_after_restore"

if ! docker exec -i "$db_container" sh -ceu \
  'exec env PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -X -q -U supabase_admin -d postgres' \
  <"$roles_for_restore" >"$test_root/roles-restore.log" 2>&1; then
  echo "Role metadata restore failed; raw output withheld" >&2
  exit 1
fi
if [[ "$(docker exec "$db_container" sh -ceu \
  'exec env PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -X -Atq -U supabase_admin -d postgres \
    -c "SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user"')" != 'supabase_admin|t' ]]; then
  echo "Disposable Supabase admin lost superuser status during role restore" >&2
  exit 1
fi
unexpected_role_errors="$(grep -E 'ERROR:' "$test_root/roles-restore.log" |
  grep -Ev 'ERROR:[[:space:]]+role \"[^\"]+\" already exists$' || true)"
if [[ -n "$unexpected_role_errors" ]]; then
  echo "Role metadata restore had an unexpected SQL error; raw output withheld" >&2
  exit 1
fi

# PostgreSQL requires a superuser-owned function while recreating a
# superuser-owned event trigger. The encrypted production role receipt is
# replayed immediately after the archive restore, so this elevation exists
# only inside the egress-blocked disposable container.
docker exec "$db_container" sh -ceu \
  'exec env PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -X -v ON_ERROR_STOP=1 -q -U supabase_admin -d postgres -c "ALTER ROLE postgres SUPERUSER"'
if [[ "$(docker exec "$db_container" sh -ceu \
  'exec env PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -X -Atq -U supabase_admin -d postgres \
    -c "SELECT string_agg(rolname || '"'"'|'"'"' || rolsuper, '"'"','"'"' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('"'"'postgres'"'"', '"'"'supabase_admin'"'"')"')" != 'postgres|true,supabase_admin|true' ]]; then
  echo "Disposable restore roles were not elevated as required" >&2
  exit 1
fi

if ! docker exec "$db_container" sh -ceu '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  dropdb -h 127.0.0.1 -U supabase_admin --force postgres
  createdb -h 127.0.0.1 -U supabase_admin --template=template0 --owner=supabase_admin postgres
' >"$test_root/prepare.log" 2>&1; then
  echo "Could not recreate the isolated postgres restore target" >&2
  exit 1
fi

if ! docker exec -i "$db_container" sh -ceu \
  'exec env PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -h 127.0.0.1 -U supabase_admin -d "$1" --exit-on-error --verbose' \
  sh "$restored_db" \
  <"$payload_root/database.dump" >"$test_root/restore.log" 2>&1; then
  restore_diagnostic="$(grep -Ei '^(pg_restore: (error:|from TOC entry|creating (EVENT TRIGGER|FUNCTION))|ERROR:)' "$test_root/restore.log" |
    sed -E \
      -e 's/eyJ[A-Za-z0-9_-]{8,}[.]eyJ[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}/[JWT REDACTED]/g' \
      -e 's#(postgres(ql)?://)[^@[:space:]]+@#\1[REDACTED]@#Ig' \
      -e 's/(password|token|secret)[=:][[:space:]]*[^[:space:]]+/\1=[REDACTED]/Ig' |
    tail -n 8 || true)"
  if [[ -n "$restore_diagnostic" ]]; then
    printf 'Actual database restore failed; sanitized diagnostic follows:\n%s\n' "$restore_diagnostic" >&2
  else
    echo "Actual database restore failed; no safe diagnostic line was available" >&2
  fi
  event_function_diagnostic="$(docker exec -i "$db_container" sh -ceu \
    'exec env PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -X -q -U supabase_admin -d "$1" -At' \
    sh "$restored_db" <<'SQL'
SELECT format(
  'EVENT_FUNCTION=%I.%I OWNER=%I OWNER_SUPERUSER=%s',
  n.nspname,
  p.proname,
  r.rolname,
  r.rolsuper
)
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
JOIN pg_roles AS r ON r.oid = p.proowner
WHERE p.proname = 'rls_auto_enable'
ORDER BY n.nspname;
SQL
  )"
  if [[ -n "$event_function_diagnostic" ]]; then
    printf '%s\n' "$event_function_diagnostic" >&2
  fi
  exit 1
fi

if ! docker exec -i "$db_container" sh -ceu \
  'exec env PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -X -v ON_ERROR_STOP=1 -q -U supabase_admin -d postgres' \
  <"$postgres_role_after_restore" >"$test_root/postgres-role-restore.log" 2>&1; then
  echo "Production postgres role metadata could not be restored; raw output withheld" >&2
  exit 1
fi
if [[ "$(docker exec "$db_container" sh -ceu \
  'exec env PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -X -Atq -U supabase_admin -d postgres \
    -c "SELECT string_agg(rolname || '"'"'|'"'"' || rolsuper, '"'"','"'"' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('"'"'postgres'"'"', '"'"'supabase_admin'"'"')"')" != 'postgres|false,supabase_admin|true' ]]; then
  echo "Restored bootstrap role properties do not match the encrypted production receipt" >&2
  exit 1
fi

if [[ -f "$test_root/restore-database-context.sql" ]]; then
  docker exec -i "$db_container" sh -ceu \
    'exec env PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres' \
    <"$test_root/restore-database-context.sql" >"$test_root/database-context-restore.log" 2>&1 || {
    echo "Database owner/effective ACL recovery failed; raw output withheld" >&2; exit 1;
  }
  database_context_verified=true
fi

python3 - "$payload_root/table-counts.tsv" "$test_root/verify-counts.sql" <<'PY'
import sys

source, target = sys.argv[1:]
with open(source, encoding="utf-8") as counts, open(target, "w", encoding="utf-8") as sql:
    for line in counts:
        schema, table, count = line.rstrip("\n").split("\t")
        ident = lambda value: '"' + value.replace('"', '""') + '"'
        literal = lambda value: "'" + value.replace("'", "''") + "'"
        sql.write(
            f"SELECT {literal(schema)}, {literal(table)}, count(*)::bigint "
            f"FROM {ident(schema)}.{ident(table)};\n"
        )
PY

docker exec -i "$db_container" psql -X -qAt -F $'\t' -U postgres -d "$restored_db" \
  -v ON_ERROR_STOP=1 -f - <"$test_root/verify-counts.sql" >"$test_root/restored-counts.tsv" 2>"$test_root/counts.log" || {
  echo "Restored application table counts could not be verified; raw output withheld" >&2
  exit 1
}
if ! cmp -s "$payload_root/table-counts.tsv" "$test_root/restored-counts.tsv"; then
  echo "Restored application table counts differ from the shared snapshot receipt" >&2
  exit 1
fi

contract="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d "$restored_db" -c "
SELECT
  to_regclass('public.tournaments') IS NOT NULL,
  to_regclass('public.tournament_tables') IS NOT NULL,
  to_regclass('public.tournament_seats') IS NOT NULL,
  to_regclass('public.tournament_entries') IS NOT NULL,
  to_regclass('public.tournament_hands') IS NOT NULL,
  to_regclass('public.game_tables') IS NOT NULL,
  to_regclass('supabase_migrations.schema_migrations') IS NOT NULL;")"
test "$contract" = 't|t|t|t|t|t|t' || {
  echo "Restored Floor/Tracker schema and migration-history contract failed" >&2
  exit 1
}

docker exec "$db_container" psql -X -qAt -F $'\t' -v ON_ERROR_STOP=1 -U postgres -d "$restored_db" -c "
SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
       encode(pg_catalog.sha256(convert_to(m[1], 'UTF8')), 'hex')
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL regexp_matches(pg_get_functiondef(p.oid),
  'eyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}', 'g') AS m
WHERE p.prokind IN ('f', 'p')
  AND n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema'
ORDER BY 1, 2;" 2>"$test_root/restored-credential-scan.log" |
  node "$fingerprint_guard" "$verified_anon_key_sha256"

echo "DECRYPT_FROM_DOWNLOADED_STORED_CIPHERTEXT=PASS"
echo "ACTUAL_ISOLATED_POSTGRES_RESTORE=PASS"
echo "SNAPSHOT_APPLICATION_TABLE_COUNTS=PASS"
echo "FLOOR_TRACKER_SCHEMA_AND_MIGRATION_HISTORY=PASS"
echo "ROLE_METADATA_RESTORED=PASS"
echo "SNAPSHOT_DATABASE_CONTEXT_VERIFIED=$database_context_verified"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'database_context_verified=%s\n' "$database_context_verified" >>"$GITHUB_OUTPUT"
fi
echo "VERIFIED_ANON_FUNCTIONS_PRESERVED=PASS"
echo "RESTORE_NETWORK_EGRESS=BLOCKED"
echo "RESTORED_CRON_JOBS=DISABLED"

if [[ "$rehearsal_mode" == '--hud-full34-rehearsal' ]]; then
  HUD_FULL34_ISOLATION_VERIFIED='egress-blocked-cron-off' node \
    "$(dirname -- "$0")/tracker-hud-full34-isolated.mjs" "$db_container" \
    "$GITHUB_WORKSPACE/candidate/VinPoker" "$RUNNER_TEMP/hud-full34-rehearsal.json"
fi
