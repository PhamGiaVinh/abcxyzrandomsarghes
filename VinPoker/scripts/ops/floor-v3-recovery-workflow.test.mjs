import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { validateAnonExceptionRows } from "./check-floor-v3-anon-exception.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "../..");
const workspaceRoot = resolve(appRoot, "..");
const workflow = readFileSync(resolve(workspaceRoot, ".github/workflows/floor-v3-recovery-backup.yml"), "utf8");
const backup = readFileSync(resolve(scriptDirectory, "create-floor-v3-recovery.sh"), "utf8");
const restore = readFileSync(resolve(scriptDirectory, "verify-floor-v3-recovery.sh"), "utf8");
const verifiedAnonFingerprint = "7289b818ee2251d46c8cf3fc5a94ce961f936cdc7c94b7979b8b1a0936b286b8";

test("Floor recovery workflow is manual, owner-bound, protected, and backup-only", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /refs\/heads\/main/);
  assert.match(workflow, /INITIAL_ACTOR.*REPOSITORY_OWNER/s);
  assert.match(workflow, /TRIGGERING_ACTOR.*REPOSITORY_OWNER/s);
  assert.match(workflow, /CREATE_VERIFY_FLOOR_V3_RECOVERY/);
  assert.match(workflow, /environment: dealer-swing-production-critical/);
  assert.match(workflow, /permissions:[\s\S]*?actions: read[\s\S]*?contents: read/);
  assert.doesNotMatch(workflow, /permissions:[\s\S]*?contents: write/);
  assert.doesNotMatch(workflow, /apply-migration|supabase db push|supabase migration up|supabase functions deploy|vercel --prod|feature.?flag/i);
  assert.doesNotMatch(workflow, /cashier-1304-backup-apply|20270115000011_cashier/i);
  assert.match(workflow, /credential_exception_functions/);
  assert.match(workflow, /credential_exception_sha256/);
  assert.match(workflow, /credential_exception_scope/);
  assert.match(workflow, /retention-days: 30/);
  assert.match(workflow, /Upload encrypted ciphertext only/);
  assert.match(workflow, /Download persisted ciphertext from the completed backup job/);
  assert.match(workflow, /\.event == "workflow_dispatch" and \.head_branch == "main"/);
  assert.match(workflow, /\(\.id \| tostring\) != env\.GITHUB_RUN_ID/);
});

test("database archive and row-count receipt share one exported MVCC snapshot", () => {
  assert.match(backup, /Floor recovery script failed at line %s \(exit %s\); command and values withheld/);
  assert.doesNotMatch(backup, /BASH_COMMAND/);
  assert.match(backup, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(backup, /pg_export_snapshot\(\)/);
  assert.match(backup, /pg_dump --format=custom[\s\S]*?--snapshot=\"\$snapshot_id\"/);
  assert.match(backup, /--mount \"type=bind,src=\$payload_root,dst=\/backup\"/);
  assert.match(backup, /--file=\/backup\/database\.dump/);
  assert.doesNotMatch(backup, /--file=\/dev\/stdout/);
  assert.match(backup, /SET TRANSACTION SNAPSHOT :'snapshot'/);
  assert.match(backup, /docker run --rm -i --network host[\s\S]*?psql -X -qAt -F \$'\\t' -v ON_ERROR_STOP=1 -v snapshot=/);
  assert.match(backup, /SELECT 'public', 'tournaments', count\(\*\)::bigint FROM public\.tournaments[\s\S]*?UNION ALL SELECT 'supabase_migrations', 'schema_migrations', count\(\*\)::bigint FROM supabase_migrations\.schema_migrations/);
  assert.doesNotMatch(backup, /\\gexec/);
  assert.match(backup, /table-counts\.tsv/);
  assert.match(backup, /verified_anon_key_sha256="[0-9a-f]{64}"/);
  assert.match(backup, /check-floor-v3-anon-exception\.mjs/);
  assert.match(backup, /credential_exception_scope=encrypted recovery archive only/);
  assert.match(backup, /pg_get_functiondef\(p\.oid\)[\s\S]*?eyJ\[A-Za-z0-9_-\]/);
  assert.match(backup, /psql -X -qAt -F \$'\\t'/);
  assert.match(backup, /database_scope=full PostgreSQL database[\s\S]*?public, floor_private, supabase_migrations/);
  assert.match(backup, /row_count_receipt_tables=public\.tournaments[\s\S]*?supabase_migrations\.schema_migrations/);
  assert.match(backup, /pg_dumpall --roles-only --no-role-passwords/);
  assert.match(backup, /cli_login_postgres/);
  assert.match(backup, /database\.dump[\s\S]*?pg_restore/);
  assert.match(backup, /--mount "type=bind,src=\$payload_root,dst=\/backup,readonly"[\s\S]*?pg_restore --list \/backup\/database\.dump/);
  assert.match(backup, /schema_list="\$\(docker run --rm -i --network host[\s\S]*?SET TRANSACTION SNAPSHOT :'snapshot'[\s\S]*?FROM pg_catalog\.pg_namespace/);
  assert.match(backup, /Storage API object bytes/);
});

test("only encrypted ciphertext is uploaded and restore is isolated with egress blocked", () => {
  assert.match(backup, /age --recipient/);
  assert.match(backup, /cmp -s/);
  assert.match(workflow, /path: \$\{\{ runner\.temp \}\}\/floor-v3-artifact/);
  assert.match(restore, /sha256sum --check --status ciphertext\.sha256/);
  assert.match(restore, /age --decrypt --identity/);
  assert.match(restore, /supabase start[\s\S]*?--exclude/);
  assert.match(restore, /exclude_services="imgproxy,logflare,mailpit,postgres-meta,realtime,storage-api,studio,supavisor,vector"/);
  assert.match(restore, /DOCKER-USER/);
  assert.match(restore, /restore network still has outbound access/);
  assert.match(restore, /pg_restore[\s\S]*?--exit-on-error/);
  assert.match(restore, /PGPASSWORD="\$POSTGRES_PASSWORD" pg_restore -h 127\.0\.0\.1 -U supabase_admin/);
  assert.match(restore, /readonly restored_db="postgres"/);
  assert.match(restore, /dropdb -h 127\.0\.0\.1 -U supabase_admin --force postgres/);
  assert.match(restore, /createdb -h 127\.0\.0\.1 -U supabase_admin --template=template0 --owner=supabase_admin postgres/);
  assert.match(restore, /Actual database restore failed; sanitized diagnostic follows/);
  assert.match(restore, /--exit-on-error --verbose/);
  assert.match(restore, /pg_restore: \(error:\|from TOC entry\|creating \(EVENT TRIGGER\|FUNCTION\)\)/);
  assert.match(restore, /WHERE p\.proname = 'rls_auto_enable'/);
  assert.match(restore, /EVENT_FUNCTION=%I\.%I OWNER=%I OWNER_SUPERUSER=%s/);
  assert.match(restore, /\[JWT REDACTED\]/);
  assert.doesNotMatch(restore, /cat "\$test_root\/restore\.log"|tail[^\n]*restore\.log/);
  assert.doesNotMatch(restore, /pg_restore[^\n]*--no-owner/);
  assert.match(restore, /cmp -s \"\$payload_root\/table-counts\.tsv\"/);
  assert.match(restore, /cron\.launch_active_jobs = off/);
  assert.match(restore, /roles-no-passwords\.sql/);
  assert.match(restore, /SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user/);
  assert.match(restore, /PGPASSWORD="\$POSTGRES_PASSWORD" psql -h 127\.0\.0\.1 -X -q -U supabase_admin -d postgres/);
  assert.match(restore, /roles_for_restore="\$test_root\/roles-for-restore\.sql"/);
  assert.match(restore, /\^\(CREATE ROLE\|ALTER ROLE\).*\(postgres\|supabase_admin\)/);
  assert.match(restore, /Disposable Supabase admin lost superuser status during role restore/);
  assert.match(restore, /ALTER ROLE postgres SUPERUSER/);
  assert.match(restore, /postgres-role-after-restore\.sql/);
  assert.match(restore, /postgres\|false,supabase_admin\|true/);
  assert.match(restore, /ROLE_METADATA_RESTORED=PASS/);
  assert.match(restore, /VERIFIED_ANON_FUNCTIONS_PRESERVED=PASS/);
  assert.match(restore, /check-floor-v3-anon-exception\.mjs/);
  assert.doesNotMatch(restore, /SUPABASE_DB_PASSWORD|supabase link|supabase db push/);
});

test("encrypted-backup exception accepts no tokens or the exact legacy fingerprint", () => {
  const validRows = [
    `public.fn_dispatch_push()\t${verifiedAnonFingerprint}`,
  ].join("\n");
  assert.equal(validateAnonExceptionRows(validRows, verifiedAnonFingerprint), true);
  const validCli = spawnSync(process.execPath, [resolve(scriptDirectory, "check-floor-v3-anon-exception.mjs"), verifiedAnonFingerprint], {
    input: validRows,
    encoding: "utf8",
  });
  assert.equal(validCli.status, 0, validCli.stderr);

  for (const invalidRows of [
    `${validRows}\npublic.unapproved()\t${verifiedAnonFingerprint}`,
    validRows.replace(verifiedAnonFingerprint, "f".repeat(64)),
    `${validRows}\npublic.notify_dealer_ready_v2()\t${verifiedAnonFingerprint}`,
    validRows.replace("public.fn_dispatch_push()", "public.fn_dispatch_push(integer)"),
    validRows.replace("public.fn_dispatch_push()", "public.fn_dispatch_push()\npublic.fn_dispatch_push()"),
  ]) {
    assert.equal(validateAnonExceptionRows(invalidRows, verifiedAnonFingerprint), false);
    const invalidCli = spawnSync(process.execPath, [resolve(scriptDirectory, "check-floor-v3-anon-exception.mjs"), verifiedAnonFingerprint], {
      input: invalidRows,
      encoding: "utf8",
    });
    assert.equal(invalidCli.status, 1);
    assert.doesNotMatch(invalidCli.stderr, /eyJ[A-Za-z0-9_-]+\./);
  }
});

test("token-free catalogs pass without relaxing rejection of unapproved tokens", () => {
  for (const input of ["", "\n"]) {
    assert.equal(validateAnonExceptionRows(input, verifiedAnonFingerprint), true);
    const cli = spawnSync(process.execPath, [resolve(scriptDirectory, "check-floor-v3-anon-exception.mjs"), verifiedAnonFingerprint], {input, encoding: "utf8"});
    assert.equal(cli.status, 0, cli.stderr);
  }
  assert.equal(validateAnonExceptionRows("", ""), false);
  assert.equal(validateAnonExceptionRows(`public.unapproved()\t${verifiedAnonFingerprint}`, verifiedAnonFingerprint), false);
});
