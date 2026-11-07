#!/usr/bin/env bash
set -euo pipefail

on_unexpected_error() {
  local status=$?
  local failed_line="$1"
  trap - ERR
  printf 'Floor recovery script failed at line %s (exit %s); command and values withheld\n' "$failed_line" "$status" >&2
  exit "$status"
}
trap 'on_unexpected_error "$LINENO"' ERR

artifact_dir="${1:-}"
if [[ -z "$artifact_dir" ]]; then
  echo "Encrypted output directory is required" >&2
  exit 64
fi

for command in age docker sha256sum tar; do
  command -v "$command" >/dev/null || {
    echo "Required recovery tool is unavailable: $command" >&2
    exit 69
  }
done

: "${SUPABASE_PROJECT_REF:?Protected project reference is unavailable}"
: "${SUPABASE_DB_PASSWORD:?Protected database credential is unavailable}"
: "${FLOOR_BACKUP_AGE_IDENTITY:?Protected recovery identity is unavailable}"
: "${GITHUB_RUN_ID:?Workflow run id is unavailable}"
test "$SUPABASE_PROJECT_REF" = "orlesggcjamwuknxwcpk"

readonly project_ref="orlesggcjamwuknxwcpk"
readonly pooler_host="aws-1-ap-southeast-2.pooler.supabase.com"
readonly postgres_image="postgres:17.6-bookworm"
readonly age_recipient="age19stq5ucnrewh6jpma9lwnhe8l4428gt8pwdjy8xl25vpghw3wsssr92tjv"
# Owner-approved, project-source-verified legacy anon key fingerprint.
# SHA-256 is over the exact UTF-8 JWT literal; never store the key itself here.
readonly verified_anon_key_sha256="7289b818ee2251d46c8cf3fc5a94ce961f936cdc7c94b7979b8b1a0936b286b8"
fingerprint_guard="$(cd -- "$(dirname -- "$0")" && pwd)/check-floor-v3-anon-exception.mjs"
readonly fingerprint_guard
readonly work_root="${RUNNER_TEMP}/floor-v3-recovery-${GITHUB_RUN_ID}"
readonly payload_root="$work_root/payload"
readonly archive_path="$work_root/floor-v3-recovery.tar.gz"
readonly ciphertext_path="$artifact_dir/floor-v3-recovery-${GITHUB_RUN_ID}.tar.gz.age"
readonly identity_path="$work_root/age-identity.txt"
readonly canary_plain="$work_root/age-canary.txt"
readonly canary_cipher="$work_root/age-canary.txt.age"
readonly snapshot_app="floor-v3-recovery-${GITHUB_RUN_ID}"

snapshot_pid=""
snapshot_in=""
snapshot_out=""
cleanup() {
  if [[ -n "$snapshot_pid" ]]; then
    if [[ -n "$snapshot_in" ]]; then
      { printf 'ROLLBACK;\n\\q\n' >&"$snapshot_in"; } 2>/dev/null || true
    fi
    wait "$snapshot_pid" 2>/dev/null || true
  fi
  rm -rf -- "$work_root"
}
trap cleanup EXIT

umask 077
mkdir -p "$payload_root" "$artifact_dir"
printf '%s\n' "$FLOOR_BACKUP_AGE_IDENTITY" >"$identity_path"
printf 'floor-v3-age-key-canary\n' >"$canary_plain"
age --recipient "$age_recipient" --output "$canary_cipher" "$canary_plain"
age --decrypt --identity "$identity_path" --output "$work_root/age-canary-restored.txt" "$canary_cipher"
cmp -s "$canary_plain" "$work_root/age-canary-restored.txt" || {
  echo "Stored recovery identity does not match the reviewed age recipient" >&2
  exit 1
}
rm -f -- "$canary_plain" "$work_root/age-canary-restored.txt" "$canary_cipher" "$identity_path"

export PGHOST="$pooler_host"
export PGPORT="5432"
export PGUSER="postgres.${project_ref}"
export PGDATABASE="postgres"
export PGPASSWORD="$SUPABASE_DB_PASSWORD"
export PGSSLMODE="require"
export PGAPPNAME="$snapshot_app"

docker pull "$postgres_image" >/dev/null
client_version="$(docker run --rm "$postgres_image" pg_dump --version | sed 's/^pg_dump (PostgreSQL) //')"
server_version="$(docker run --rm --network host --env PGHOST --env PGPORT --env PGUSER --env PGDATABASE --env PGPASSWORD --env PGSSLMODE --env PGAPPNAME "$postgres_image" psql -X -qAt -v ON_ERROR_STOP=1 -c 'SHOW server_version')"
[[ "$client_version" == 17.* && "$server_version" == 17.* ]] || {
  echo "Pinned PostgreSQL client/server major version check failed" >&2
  exit 1
}

# Permit only the remaining exact live trigger function and project anon-key
# fingerprint verified via Supabase project key inventory on 2026-09-25.
# Any other token-shaped literal or signature drift fails before pg_dump.
docker run --rm --network host \
  --env PGHOST --env PGPORT --env PGUSER --env PGDATABASE --env PGPASSWORD --env PGSSLMODE --env PGAPPNAME \
  "$postgres_image" psql -X -qAt -F $'\t' -v ON_ERROR_STOP=1 -c "
SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
       encode(pg_catalog.sha256(convert_to(m[1], 'UTF8')), 'hex')
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 CROSS JOIN LATERAL regexp_matches(pg_get_functiondef(p.oid),
   'eyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}', 'g') AS m
WHERE p.prokind IN ('f', 'p')
  AND n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema'
ORDER BY 1, 2;" \
  2>"$work_root/credential_scan.log" | node "$fingerprint_guard" "$verified_anon_key_sha256" || {
  echo "Live function fingerprint preflight failed; raw tool output withheld" >&2
  exit 1
}

# One exported MVCC snapshot is shared by the full database dump and the row-count receipt.
coproc SNAPSHOT_OWNER {
  docker run --rm -i --network host \
    --env PGHOST --env PGPORT --env PGUSER --env PGDATABASE --env PGPASSWORD --env PGSSLMODE --env PGAPPNAME \
    "$postgres_image" psql -X -qAt -v ON_ERROR_STOP=1
}
snapshot_pid="$SNAPSHOT_OWNER_PID"
snapshot_out="${SNAPSHOT_OWNER[0]}"
snapshot_in="${SNAPSHOT_OWNER[1]}"
printf "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot() || E'\\t' || to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');\n" >&"$snapshot_in"
IFS=$'\t' read -r snapshot_id snapshot_at <&"$snapshot_out"
[[ "$snapshot_id" =~ ^[A-Fa-f0-9-]+$ && "$snapshot_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2} ]] || {
  echo "PostgreSQL did not return a valid exported snapshot receipt" >&2
  exit 1
}

docker run --rm --network host \
  --user "$(id -u):$(id -g)" \
  --mount "type=bind,src=$payload_root,dst=/backup" \
  --env PGHOST --env PGPORT --env PGUSER --env PGDATABASE --env PGPASSWORD --env PGSSLMODE --env PGAPPNAME \
  "$postgres_image" pg_dump --format=custom --blobs --snapshot="$snapshot_id" \
  --file=/backup/database.dump 2>"$work_root/pg_dump.log" || {
    dump_diagnostic="$(grep -Ei 'pg_dump: error:|could not (connect|send|receive|read|write)|connection reset|server closed|SSL connection|terminating connection|ERROR:' "$work_root/pg_dump.log" |
      sed -E \
        -e 's/eyJ[A-Za-z0-9_-]{8,}[.]eyJ[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}/[JWT REDACTED]/g' \
        -e 's#(postgres(ql)?://)[^@[:space:]]+@#\1[REDACTED]@#Ig' \
        -e 's/(password|token|secret)[=:][[:space:]]*[^[:space:]]+/\1=[REDACTED]/Ig' \
        -e 's/(authorization:[[:space:]]*bearer[[:space:]]+)[^[:space:]]+/\1[REDACTED]/Ig' |
      tail -n 5 || true)"
    if [[ -n "$dump_diagnostic" ]]; then
      printf 'PostgreSQL database dump failed; sanitized diagnostic follows:\n%s\n' "$dump_diagnostic" >&2
    else
      echo "PostgreSQL database dump failed; no safe diagnostic line was available" >&2
    fi
    exit 1
  }
test -s "$payload_root/database.dump"

docker run --rm --network host \
  --env PGHOST --env PGPORT --env PGUSER --env PGDATABASE --env PGPASSWORD --env PGSSLMODE --env PGAPPNAME \
  "$postgres_image" pg_dumpall --roles-only --no-role-passwords \
  >"$payload_root/roles-no-passwords.sql" 2>"$work_root/roles_dump.log" || {
  echo "PostgreSQL role metadata dump failed; raw tool output withheld" >&2
  exit 1
}
sed -E -i \
  -e '/^(CREATE ROLE|ALTER ROLE) "?cli_login_postgres"?([ ;]|$)/d' \
  -e '/^GRANT .* TO "?cli_login_postgres"?([ ;]|$)/d' \
  -e '/^GRANT "?cli_login_postgres"? TO /d' \
  "$payload_root/roles-no-passwords.sql"
if grep -Eq '(^|[[:space:]])cli_login_postgres([[:space:];]|$)' "$payload_root/roles-no-passwords.sql"; then
  echo "Temporary CLI login role was not fully excluded from role metadata" >&2
  exit 1
fi
if grep -Eiq '(^|[[:space:]])PASSWORD([[:space:]]|=)' "$payload_root/roles-no-passwords.sql"; then
  echo "Role dump unexpectedly contains a password clause" >&2
  exit 1
fi

docker run --rm -i --network host \
  --env PGHOST --env PGPORT --env PGUSER --env PGDATABASE --env PGPASSWORD --env PGSSLMODE --env PGAPPNAME \
  "$postgres_image" psql -X -qAt -F $'\t' -v ON_ERROR_STOP=1 -v snapshot="$snapshot_id" \
  >"$payload_root/table-counts.tsv" 2>"$work_root/counts.log" <<'SQL' || {
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET TRANSACTION SNAPSHOT :'snapshot';
SELECT 'public', 'tournaments', count(*)::bigint FROM public.tournaments
UNION ALL SELECT 'public', 'tournament_tables', count(*)::bigint FROM public.tournament_tables
UNION ALL SELECT 'public', 'tournament_seats', count(*)::bigint FROM public.tournament_seats
UNION ALL SELECT 'public', 'tournament_entries', count(*)::bigint FROM public.tournament_entries
UNION ALL SELECT 'public', 'tournament_hands', count(*)::bigint FROM public.tournament_hands
UNION ALL SELECT 'public', 'game_tables', count(*)::bigint FROM public.game_tables
UNION ALL SELECT 'supabase_migrations', 'schema_migrations', count(*)::bigint FROM supabase_migrations.schema_migrations
ORDER BY 1, 2;
COMMIT;
SQL
  echo "Snapshot table-count receipt failed; raw tool output withheld" >&2
  exit 1
}
test -s "$payload_root/table-counts.tsv"
context_helper="$(cd -- "$(dirname -- "$0")" && pwd)/recovery-database-context.mjs"
node "$context_helper" capture-sql >"$work_root/database-context-capture.sql"
docker run --rm -i --network host \
  --env PGHOST --env PGPORT --env PGUSER --env PGDATABASE --env PGPASSWORD --env PGSSLMODE --env PGAPPNAME \
  "$postgres_image" psql -X -qAt -v ON_ERROR_STOP=1 -v snapshot="$snapshot_id" \
  <"$work_root/database-context-capture.sql" >"$payload_root/database-context.json" 2>"$work_root/database-context.log" || {
  echo "Snapshot database context capture failed; raw output withheld" >&2; exit 1;
}
node "$context_helper" restore-sql "$payload_root/database-context.json" "$work_root/database-context-validation.sql" 2>"$work_root/database-context-validation.log" || {
  echo "Snapshot database context is unsupported; raw metadata withheld" >&2; exit 1;
}
if ! awk -F '\t' 'NF == 3 { seen[$1 "." $2]=1 } END { exit !(seen["public.tournaments"] && seen["public.tournament_tables"] && seen["public.tournament_seats"] && seen["public.tournament_entries"] && seen["public.tournament_hands"] && seen["public.game_tables"] && seen["supabase_migrations.schema_migrations"]) }' "$payload_root/table-counts.tsv"; then
  echo "Snapshot is missing a required Floor/Tracker table receipt" >&2
  exit 1
fi

docker run --rm \
  --mount "type=bind,src=$payload_root,dst=/backup,readonly" \
  "$postgres_image" pg_restore --list /backup/database.dump \
  >"$payload_root/archive-list.txt" 2>"$work_root/archive_list.log" || {
  echo "Database archive catalog validation failed; raw tool output withheld" >&2
  exit 1
}
for table in tournaments tournament_tables tournament_seats tournament_entries tournament_hands game_tables; do
  grep -Eq "TABLE DATA public ${table}[[:space:]]" "$payload_root/archive-list.txt" || {
    echo "Database archive does not contain required Floor/Tracker table data" >&2
    exit 1
  }
done
grep -Eq 'TABLE DATA supabase_migrations schema_migrations[[:space:]]' "$payload_root/archive-list.txt" || {
  echo "Database archive does not contain migration history" >&2
  exit 1
}

schema_list="$(docker run --rm -i --network host \
  --env PGHOST --env PGPORT --env PGUSER --env PGDATABASE --env PGPASSWORD --env PGSSLMODE --env PGAPPNAME \
  "$postgres_image" psql -X -qAt -v ON_ERROR_STOP=1 -v snapshot="$snapshot_id" \
  2>"$work_root/schema_list.log" <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET TRANSACTION SNAPSHOT :'snapshot';
SELECT string_agg(nspname, ',' ORDER BY nspname)
FROM pg_catalog.pg_namespace
WHERE nspname !~ '^pg_' AND nspname <> 'information_schema';
COMMIT;
SQL
)"
schema_list="${schema_list//$'\n'/}"

project_fingerprint="$(printf '%s' "$project_ref" | sha256sum | awk '{print $1}')"
snapshot_finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat >"$payload_root/metadata.txt" <<EOF
source_sha=${TARGET_SHA:?Exact reviewed source SHA is unavailable}
project_fingerprint=$project_fingerprint
snapshot_id=$snapshot_id
snapshot_at=$snapshot_at
snapshot_export_finished_at=$snapshot_finished_at
database_server_version=$server_version
pg_dump_client_version=$client_version
included_database_schemas=$schema_list
database_scope=full PostgreSQL database; every pg_dump-managed schema and object including public, floor_private, supabase_migrations, and dependencies present at snapshot time
row_count_receipt_tables=public.tournaments,public.tournament_tables,public.tournament_seats,public.tournament_entries,public.tournament_hands,public.game_tables,supabase_migrations.schema_migrations
dump_format=single_pg_dump_custom_archive_with_shared_exported_snapshot
roles=pg_dumpall_roles_only_without_passwords; captured separately from MVCC snapshot
database_context_version=1
database_context_scope=database owner and effective ACL; shared exported snapshot; encrypted payload only
credential_exception_project_ref=$project_ref
credential_exception_functions=public.fn_dispatch_push()
credential_exception_token_sha256=$verified_anon_key_sha256
credential_exception_fingerprint=SHA-256 over exact UTF-8 JWT literal extracted from each live function definition
credential_exception_scope=encrypted recovery archive only
exclusions=PostgreSQL system catalogs; Supabase Storage API object bytes; project settings; Auth provider secrets; Edge Functions; external secrets
EOF
(
  cd "$payload_root"
  sha256sum database.dump roles-no-passwords.sql table-counts.tsv database-context.json archive-list.txt metadata.txt >manifest.sha256
)
tar -czf "$archive_path" -C "$work_root" payload
age --recipient "$age_recipient" --output "$ciphertext_path" "$archive_path"
test -s "$ciphertext_path"
(cd "$artifact_dir" && sha256sum "$(basename "$ciphertext_path")" >ciphertext.sha256)

echo "RECOVERY_CIPHERTEXT_CREATED=YES"
echo "SNAPSHOT_AT=$snapshot_at"
echo "SNAPSHOT_EXPORT_FINISHED_AT=$snapshot_finished_at"
echo "DATABASE_SERVER_VERSION=$server_version"
echo "PG_DUMP_CLIENT_VERSION=$client_version"
echo "INCLUDED_SCHEMAS=$schema_list"
echo "CREDENTIAL_EXCEPTION_FUNCTIONS=public.fn_dispatch_push()"
echo "CREDENTIAL_EXCEPTION_SHA256=$verified_anon_key_sha256"
echo "CREDENTIAL_EXCEPTION_SCOPE=encrypted_recovery_archive_only"
echo "TABLE_COUNT_RECEIPT=Floor/Tracker tables and migration history"
echo "STORAGE_API_OBJECT_BYTES_INCLUDED=NO"
ciphertext_sha256="$(awk '{print $1}' "$artifact_dir/ciphertext.sha256")"
ciphertext_bytes="$(stat -c '%s' "$ciphertext_path")"
echo "CIPHERTEXT_SHA256=$ciphertext_sha256"
echo "CIPHERTEXT_BYTES=$ciphertext_bytes"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    printf 'snapshot_at=%s\n' "$snapshot_at"
    printf 'snapshot_finished_at=%s\n' "$snapshot_finished_at"
    printf 'server_version=%s\n' "$server_version"
    printf 'schema_list=%s\n' "$schema_list"
    printf 'credential_exception_functions=public.fn_dispatch_push()\n'
    printf 'credential_exception_sha256=%s\n' "$verified_anon_key_sha256"
    printf 'credential_exception_scope=encrypted_recovery_archive_only\n'
    printf 'ciphertext_sha256=%s\n' "$ciphertext_sha256"
    printf 'ciphertext_bytes=%s\n' "$ciphertext_bytes"
  } >>"$GITHUB_OUTPUT"
fi

# Keep the MVCC snapshot open through every snapshot-bound operation.
printf 'COMMIT;\n\\q\n' >&"$snapshot_in"
wait "$snapshot_pid"
snapshot_pid=""
snapshot_in=""
snapshot_out=""
