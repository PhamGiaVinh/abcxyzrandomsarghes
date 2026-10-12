import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const workflow = readFileSync(resolve(root, ".github/workflows/vbackerworkflowmain.yml"), "utf8");
const validationWorkflow = readFileSync(
  resolve(root, ".github/workflows/deployment-control-plane-validation.yml"),
  "utf8",
);
const schemaCaptureWorkflow = readFileSync(resolve(root, ".github/workflows/capture-live-public-schema.yml"), "utf8");
const physicalAssetApplyWorkflow = readFileSync(resolve(root, ".github/workflows/physical-asset-63-65-protected-apply.yml"), "utf8");

test("current-schema clones restore completed PG17 files rather than docker stdout streams", () => {
  const currentSchema = readFileSync(resolve(root, ".github/workflows/dealer-checkin-current-schema.yml"), "utf8");
  assert.doesNotMatch(currentSchema, /docker exec[^\n]*pg_dump[^\n]*\|/);
  for (const name of ["stop64-atomic", "roster62-atomic", "stack61-atomic", "undo-generation"]) {
    const dump = currentSchema.indexOf(`-f /tmp/${name}-schema.sql`);
    const copy = currentSchema.indexOf(`docker cp vinpoker-current-schema-pg17:/tmp/${name}-schema.sql`);
    const restore = currentSchema.indexOf(`psql -X -v ON_ERROR_STOP=1 -f "$RUNNER_TEMP/${name}-schema.sql"`);
    assert.ok(dump >= 0 && copy > dump && restore > copy, `${name}: complete dump, copy, then checked restore required`);
  }
});

test("operations baseline recovery is owner-protected, exact, private and isolated from prior baseline", () => {
  const recovery = schemaCaptureWorkflow.split("\n  recover-operations-baseline:")[1];
  assert.ok(recovery,"separate reviewed operations recovery job required");
  assert.match(recovery,/RECOVER_OPERATIONS_SCHEMA_ONLY/);
  assert.match(recovery,/github\.actor == github\.repository_owner/);
  assert.match(recovery,/github\.triggering_actor == github\.repository_owner/);
  assert.match(recovery,/environment: dealer-swing-production-critical/);
  assert.match(recovery,/37820347781/);
  assert.match(recovery,/0463831bb9f8f142d585fd51c1b0633963b2161f/);
  assert.match(recovery,/RECOVERY_PROFILE: operations/);
  assert.match(recovery,/retention-days: 90/);
  const secrets=[...new Set([...recovery.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(m=>m[1]))].sort();
  assert.deepEqual(secrets,Array.from({length:17},(_,i)=>`VINPOKER_OPS_SCHEMA_RECOVERY_${String(i+1).padStart(2,"0")}`).sort());
  assert.doesNotMatch(recovery,/supabase\s+(?:link|db|functions)|secrets\.SUPABASE|vercel\s+(?:deploy|--prod)/i);
  const original=schemaCaptureWorkflow.split("\n  recover-reviewed-baseline:")[1].split("\n  recover-operations-baseline:")[0];
  assert.match(original,/37229283609/);
  assert.match(original,/name: reviewed-pre-release-schema-provenance/);
  assert.doesNotMatch(recovery,/name: reviewed-pre-release-schema-provenance/);
  assert.doesNotMatch(original,/VINPOKER_OPS_SCHEMA_RECOVERY/);
});

test("recovery refuses missing owner, unknown profile and cross-profile bytes before output", () => {
  const run = (env={}) => spawnSync(process.execPath,[resolve(root,"VinPoker/scripts/deploy/recover-reviewed-schema-artifact.mjs")],
    {cwd:root,env:{PATH:process.env.PATH,...env},encoding:"utf8"});
  const owner={GITHUB_ACTOR:"synthetic-owner",GITHUB_TRIGGERING_ACTOR:"synthetic-owner",GITHUB_REPOSITORY_OWNER:"synthetic-owner"};
  const missing=run(); assert.notEqual(missing.status,0); assert.match(missing.stderr,/owner_context_required/);
  for (const profile of ["arbitrary","__proto__","toString"]) {
    const unknown=run({...owner,RECOVERY_PROFILE:profile});
    assert.notEqual(unknown.status,0); assert.match(unknown.stderr,/unknown_recovery_profile/);
  }
  const outsider=run({...owner,GITHUB_TRIGGERING_ACTOR:"outsider"});
  assert.notEqual(outsider.status,0); assert.match(outsider.stderr,/owner_context_required/);
  const encoded=gzipSync(Buffer.from("synthetic schema, never a real dump")).toString("base64");
  const chunks=Object.fromEntries(Array.from({length:17},(_,i)=>[`BASELINE_${String(i+1).padStart(2,"0")}`,
    encoded.slice(Math.floor(i*encoded.length/17),Math.floor((i+1)*encoded.length/17))]));
  const mismatch=run({...owner,...chunks,RECOVERY_PROFILE:"operations"});
  assert.notEqual(mismatch.status,0); assert.match(mismatch.stderr,/original baseline bytes must match/);
  assert.match(mismatch.stderr,/d23cfa75a7381453ba0d6216346f6460c816a3b1525ef5d47984c3a995ddc56a/);
  assert.doesNotMatch(mismatch.stdout,/synthetic schema/);
});

test("Operations recovery preserves exact privately supplied reviewed bytes and provenance",
  {skip:!process.env.OPERATIONS_RECOVERY_TEST_SCHEMA_DIR},()=>{
    const schema=readFileSync(resolve(process.env.OPERATIONS_RECOVERY_TEST_SCHEMA_DIR,"live-public-schema.sql"));
    const expected="d23cfa75a7381453ba0d6216346f6460c816a3b1525ef5d47984c3a995ddc56a";
    assert.equal(createHash("sha256").update(schema).digest("hex"),expected);
    const encoded=gzipSync(schema).toString("base64");
    const chunks=Object.fromEntries(Array.from({length:17},(_,i)=>[`BASELINE_${String(i+1).padStart(2,"0")}`,
      encoded.slice(Math.floor(i*encoded.length/17),Math.floor((i+1)*encoded.length/17))]));
    const directory=mkdtempSync(resolve(tmpdir(),"vinpoker-operations-recovery-test-"));
    const child=spawnSync(process.execPath,[resolve(root,"VinPoker/scripts/deploy/recover-reviewed-schema-artifact.mjs")],
      {cwd:root,env:{PATH:process.env.PATH,...chunks,RECOVERY_PROFILE:"operations",
        GITHUB_ACTOR:"synthetic-owner",GITHUB_TRIGGERING_ACTOR:"synthetic-owner",GITHUB_REPOSITORY_OWNER:"synthetic-owner",
        GITHUB_RUN_ID:"synthetic-local-recovery",RUNNER_TEMP:directory},encoding:"utf8"});
    assert.equal(child.status,0,"private recovery process must validate without exposing contents");
    assert.match(child.stdout,/EXACT_REVIEWED_TEST_BASELINE_RECOVERED_AND_VALIDATED/);
    const restored=readFileSync(resolve(directory,"reviewed-operations-schema/live-public-schema.sql"));
    assert.equal(createHash("sha256").update(restored).digest("hex"),expected);
    assert.equal(restored.equals(schema),true);
    assert.deepEqual(JSON.parse(readFileSync(resolve(directory,"reviewed-operations-schema.provenance.json"),"utf8")),{
      originalCaptureRun:37820347781,originalCaptureSha:"0463831bb9f8f142d585fd51c1b0633963b2161f",
      schemaSha256:expected,schemaOnly:true,recoveryRun:"synthetic-local-recovery"});
    console.log(`OPERATIONS_EXACT_BYTES_RECOVERY_PASS privateArtifactDirectory=${directory}`);
  });
const payrollDisposableWorkflow = readFileSync(
  resolve(root, ".github/workflows/dealer-pt-wage-disposable-validation.yml"),
  "utf8",
);
const payrollApplyWorkflow = readFileSync(
  resolve(root, ".github/workflows/dealer-pt-wage-global-continuous-accrual-apply.yml"),
  "utf8",
);
const payrollReadinessAclApplyWorkflow = readFileSync(
  resolve(root, ".github/workflows/dealer-pt-wage-readiness-acl-apply.yml"),
  "utf8",
);
const payrollDeliveryHsopGateWorkflow = readFileSync(
  resolve(root, ".github/workflows/dealer-payroll-statement-delivery-hsop-uat.yml"),
  "utf8",
);
const payrollDeliveryRepairWorkflow = readFileSync(
  resolve(root, ".github/workflows/dealer-payroll-statement-delivery-repair-hsop.yml"),
  "utf8",
);
const payrollStatementHsopGateWorkflow = readFileSync(
  resolve(root, ".github/workflows/dealer-payroll-statement-hsop-uat.yml"),
  "utf8",
);

test("asset63+65 apply remains manual, exact owner/source/checks and human protected", () => {
  assert.match(physicalAssetApplyWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(physicalAssetApplyWorkflow, /pull_request:|\n\s+push:/);
  assert.match(physicalAssetApplyWorkflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(physicalAssetApplyWorkflow, /environment: dealer-swing-production-critical/);
  assert.match(physicalAssetApplyWorkflow, /required_reviewers/);
  assert.match(physicalAssetApplyWorkflow, /INITIAL_ACTOR.*GITHUB_REPOSITORY_OWNER/);
  assert.match(physicalAssetApplyWorkflow, /TRIGGERING_ACTOR.*GITHUB_REPOSITORY_OWNER/);
  assert.match(physicalAssetApplyWorkflow, /\.head\.sha.*RELEASE_SHA/);
  assert.match(physicalAssetApplyWorkflow, /check-runs\?per_page=100/);
  assert.match(physicalAssetApplyWorkflow, /\.app\.slug=="github-actions"/);
  assert.match(physicalAssetApplyWorkflow, /--paginate --slurp/);
  assert.match(physicalAssetApplyWorkflow, /Pinned actionlint on exact source revision/);
  assert.match(physicalAssetApplyWorkflow, /concurrency: \{group: vinpoker-production-database-release, cancel-in-progress: false\}/);
  assert.doesNotMatch(physicalAssetApplyWorkflow, /continue-on-error: true|supabase\s+(?:db\s+(?:push|reset)|migration\s+repair|functions\s+deploy)|vercel\s+(?:deploy|--prod)/i);
});
test("asset63+65 downloads only qualified backup metadata and checks other releases", () => {
  assert.match(physicalAssetApplyWorkflow, /floor-v3-recovery-backup\.yml/);
  assert.match(physicalAssetApplyWorkflow, /\.conclusion.*success/);
  assert.match(physicalAssetApplyWorkflow, /\.head_sha.*RECOVERY_BASE_SHA/);
  assert.match(physicalAssetApplyWorkflow, /\.expired==false/);
  assert.match(physicalAssetApplyWorkflow, /unzip -Z1.*recovery-verification\.json/);
  assert.match(physicalAssetApplyWorkflow, /for status in in_progress waiting queued/);
  assert.match(physicalAssetApplyWorkflow, /test -z "\$active"/);
  assert.match(physicalAssetApplyWorkflow, /physical-asset-63-65-protected-apply\.mjs plan/);
  assert.match(physicalAssetApplyWorkflow, /physical-asset-63-65-protected-apply\.mjs apply/);
  assert.doesNotMatch(physicalAssetApplyWorkflow, /PGPASSWORD:.*vars\./);
});
test("asset workflow and runner checks are included in pinned control-plane CI", () => {
  assert.match(validationWorkflow, /\.github\/workflows\/physical-asset-63-65-protected-apply\.yml/);
  assert.match(validationWorkflow, /physical-asset-63-65-protected-apply\.test\.mjs/);
  assert.match(validationWorkflow, /physical-asset-63-65-release-plan\.test\.mjs/);
});
test("frontend cannot run after a required critical deployment failure", () => {
  assert.match(workflow, /needs\.plan\.outputs\.critical_functions == '\[\]' \|\| needs\.deploy-critical-edge\.result == 'success'/);
  assert.match(workflow, /needs\.target-preflight\.result == 'success'/);
});

test("control-plane tooling and target source use separate checkouts", () => {
  assert.match(workflow, /path: control-plane/);
  assert.match(workflow, /path: target-source/);
  assert.doesNotMatch(workflow, /target-source\/VinPoker\/scripts\/deploy/);
});

test("receipts are written only after their corresponding deployment step", () => {
  const edgeDeploy = workflow.indexOf("Deploy only this exact target function");
  const edgeReceipt = workflow.indexOf("Record receipt only after successful Edge deploy");
  const frontendDeploy = workflow.indexOf("Deploy prebuilt bundle to Vercel");
  const frontendReceipt = workflow.indexOf("Record receipt only after successful frontend deploy");
  assert.equal(edgeDeploy > -1 && edgeReceipt > edgeDeploy, true);
  assert.equal(frontendDeploy > -1 && frontendReceipt > frontendDeploy, true);
});

test("shared workflow has no automatic Edge deployment path", () => {
  assert.doesNotMatch(workflow, /deploy-noncritical-edge:/);
  assert.doesNotMatch(workflow, /supabase\s+functions\s+deploy/);
});

test("frontend deployment is manual-only", () => {
  const frontendDeploy = workflow.slice(workflow.indexOf("deploy-frontend:"));
  assert.match(frontendDeploy, /github\.event_name == 'workflow_dispatch'/);
});

test("frontend receipt verification has a bounded Vercel alias convergence window", () => {
  const frontendDeploy = workflow.slice(workflow.indexOf("deploy-frontend:"));
  assert.match(frontendDeploy, /shell_verify_attempts=72/);
  assert.match(frontendDeploy, /shell_verify_interval_seconds=5/);
  assert.equal((frontendDeploy.match(/\$\(seq 1 "\$shell_verify_attempts"\)/gu) ?? []).length, 2);
  assert.match(frontendDeploy, /FRONTEND_DEPLOYMENT_URL_VERIFY=NOT_CONVERGED/);
  assert.doesNotMatch(frontendDeploy, /test "\$verified" = true/);
  assert.match(frontendDeploy, /test "\$canonical_verified" = true/);
});

test("Floor clock deploy remains an explicit protected critical selection", () => {
  const criticalJob = workflow.slice(
    workflow.indexOf("deploy-critical-edge:"),
    workflow.indexOf("deploy-frontend:"),
  );
  assert.match(workflow, /deploy_tournament_live_clock:/);
  assert.match(workflow, /selected\+=\("tournament-live-clock"\)/);
  assert.match(workflow, /validate-critical-environment:/);
  assert.match(
    criticalJob,
    /needs:\s*\n\s*- plan\s*\n\s*- target-preflight\s*\n\s*- validate-critical-environment/,
  );
});

test("Floor Tracker Edge deploy is exact-source and protected", () => {
  assert.match(workflow, /deploy_tournament_live_update:/);
  assert.match(workflow, /DEPLOY_TOURNAMENT_LIVE_UPDATE: \$\{\{ inputs\.deploy_tournament_live_update \|\| false \}\}/);
  assert.match(workflow, /selected\+=\("tournament-live-update"\)/);
  assert.match(workflow, /name: dealer-swing-production-critical/);
});

test("Ops club-account deploy remains an explicit protected critical selection", () => {
  const criticalJob = workflow.slice(
    workflow.indexOf("deploy-critical-edge:"),
    workflow.indexOf("deploy-frontend:"),
  );
  assert.match(workflow, /deploy_ops_club_accounts:/);
  assert.match(workflow, /selected\+=\("ops-club-accounts"\)/);
  assert.match(workflow, /validate-critical-environment:/);
  assert.match(criticalJob, /environment:\s*\n\s*name: dealer-swing-production-critical/);
});

test("assign-dealer deploy is an explicit protected critical selection", () => {
  const criticalJob = workflow.slice(
    workflow.indexOf("deploy-critical-edge:"),
    workflow.indexOf("deploy-frontend:"),
  );
  assert.match(workflow, /deploy_dealer_functions:/);
  assert.match(workflow, /assign-dealer\|checkout-dealer\|mass-assign\|process-swing/);
  assert.match(workflow, /selected\+=\("\$function_name"\)/);
  assert.match(workflow, /Unsupported dealer Edge function/);
  assert.match(workflow, /Duplicate dealer Edge function/);
  assert.match(criticalJob, /environment:\s*\n\s*name: dealer-swing-production-critical/);
});

test("every live probe derives its profile from the exact target checkout", () => {
  const probes = [...workflow.matchAll(/probe-live-schema-contracts\.mjs([\s\S]{0,300})/g)];
  assert.equal(probes.length, 4);
  for (const probe of probes) assert.match(probe[1], /--target-root/);
  assert.doesNotMatch(workflow, /inputs\.contract_profile|CONTRACT_PROFILE_OVERRIDE|--profile\b/i);
  assert.match(workflow, /contract_profile: \$\{\{ steps\.plan\.outputs\.contract_profile \}\}/);
});

test("live contract approval uses the read-only catalog instead of parsing a raw SQL dump", () => {
  assert.match(workflow, /capture-live-schema-contract-catalog\.mjs/);
  const probes = [...workflow.matchAll(/probe-live-schema-contracts\.mjs([\s\S]{0,300})/g)];
  assert.equal(probes.length, 4);
  for (const probe of probes) assert.match(probe[1], /--catalog/);
  const targetPreflight = workflow.slice(workflow.indexOf("target-preflight:"), workflow.indexOf("validate-critical-environment:"));
  assert.doesNotMatch(targetPreflight, /VERCEL_TOKEN|VERCELTOKEN/);
  assert.match(workflow, /deploy-frontend:[\s\S]*Verify frontend scoped credentials[\s\S]*VERCEL_TOKEN/);
});

test("target preflight invokes catalog tooling from the control-plane checkout", () => {
  const targetPreflight = workflow.slice(workflow.indexOf("target-preflight:"), workflow.indexOf("validate-critical-environment:"));
  assert.match(
    targetPreflight,
    /node "\$\{GITHUB_WORKSPACE\}\/control-plane\/VinPoker\/scripts\/deploy\/capture-live-schema-contract-catalog\.mjs"/,
  );
  assert.doesNotMatch(targetPreflight, /node control-plane\/VinPoker\/scripts\/deploy\/capture-live-schema-contract-catalog\.mjs/);
});

test("frontend-only target preflight skips the unused full schema dump but keeps the catalog gate", () => {
  const targetPreflight = workflow.slice(workflow.indexOf("target-preflight:"), workflow.indexOf("validate-critical-environment:"));
  assert.match(targetPreflight, /CRITICAL_TARGETS: \$\{\{ needs\.plan\.outputs\.critical_functions \}\}/);
  assert.match(
    targetPreflight,
    /if \[\[ "\$\{CRITICAL_TARGETS\}" != "\[\]" \]\]; then\s+# Critical Edge deployments retain the full schema dump as offline evidence\.\s+supabase db dump --linked --schema public --file "\$\{RUNNER_TEMP\}\/live-schema\.sql"\s+fi/,
  );
  assert.match(targetPreflight, /capture-live-schema-contract-catalog\.mjs/);
  assert.match(targetPreflight, /Probe frontend live contracts/);
});

test("profile-specific Deno tests run only for the exact derived target contract", () => {
  const stepStart = workflow.indexOf("- name: Run current policy and target Deno tests");
  const stepEnd = workflow.indexOf("\n      - name:", stepStart + 1);
  const denoTestStep = workflow.slice(stepStart, stepEnd);

  assert.notEqual(stepStart, -1);
  assert.notEqual(stepEnd, -1);
  assert.match(
    denoTestStep,
    /env:\s*[\s\S]*CONTRACT_PROFILE: \$\{\{ needs\.plan\.outputs\.contract_profile \}\}/,
  );
  assert.match(denoTestStep, /--arg profile "\$CONTRACT_PROFILE"/);
  assert.match(denoTestStep, /denoTestsByContractProfile\[\$profile\]/);
});

test("pinned actionlint validation is read-only and uses no production secret", () => {
  assert.match(validationWorkflow, /pull_request:/);
  assert.match(validationWorkflow, /contents: read/);
  assert.match(validationWorkflow, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/);
  assert.match(validationWorkflow, /actionlint_1\.7\.7_linux_amd64\.tar\.gz/);
  assert.match(validationWorkflow, /023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757/);
  assert.match(validationWorkflow, /sha256sum --check --strict/);
  assert.match(validationWorkflow, /\.github\/workflows\/vbackerworkflowmain\.yml/);
  assert.match(validationWorkflow, /\.github\/workflows\/dealer-payroll-statement-contract-apply\.yml/);
  assert.match(validationWorkflow, /\.github\/workflows\/dealer-payroll-statement-hsop-uat\.yml/);
  assert.match(validationWorkflow, /\.github\/workflows\/dealer-payroll-statement-delivery-hsop-uat\.yml/);
  assert.match(validationWorkflow, /\.github\/workflows\/dealer-payroll-statement-delivery-repair-hsop\.yml/);
  assert.match(validationWorkflow, /\.github\/workflows\/deployment-control-plane-validation\.yml/);
  assert.doesNotMatch(validationWorkflow, /find \.github\/workflows/);
  assert.doesNotMatch(validationWorkflow, /\bsecrets\./);
  assert.doesNotMatch(validationWorkflow, /supabase\s+(?:functions\s+deploy|db\s+(?:push|reset))/i);
  assert.doesNotMatch(validationWorkflow, /vercel\s+(?:deploy|--prod)/i);
});

test("payroll Telegram HSOP runtime gate stays manual, exact-source, and narrowly scoped", () => {
  assert.match(payrollDeliveryHsopGateWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(payrollDeliveryHsopGateWorkflow, /pull_request:/);
  assert.match(payrollDeliveryHsopGateWorkflow, /control_sha:/);
  assert.match(payrollDeliveryHsopGateWorkflow, /frontend_receipt_sha:/);
  assert.match(payrollDeliveryHsopGateWorkflow, /render_receipt_sha:/);
  assert.match(payrollDeliveryHsopGateWorkflow, /sender_receipt_sha:/);
  assert.match(payrollDeliveryHsopGateWorkflow, /enable_hsop/);
  assert.match(payrollDeliveryHsopGateWorkflow, /disable_hsop/);
  assert.match(payrollDeliveryHsopGateWorkflow, /dealer-swing-production-critical/);
  assert.match(payrollDeliveryHsopGateWorkflow, /required_reviewers/);
  assert.match(payrollDeliveryHsopGateWorkflow, /merge-base --is-ancestor/);
  assert.match(payrollDeliveryHsopGateWorkflow, /verify-dealer-payroll-statement-delivery-receipts\.mjs/);
  assert.match(payrollDeliveryHsopGateWorkflow, /set-dealer-payroll-statement-delivery-hsop-uat\.mjs/);
  assert.doesNotMatch(payrollDeliveryHsopGateWorkflow, /all_clubs_enabled\s*=\s*true/);
  assert.doesNotMatch(payrollDeliveryHsopGateWorkflow, /supabase\s+(?:db\s+(?:push|reset)|functions\s+deploy)/i);
  assert.doesNotMatch(payrollDeliveryHsopGateWorkflow, /vercel\s+(?:deploy|--prod)/i);
});

test("payroll Telegram forward repair is protected, exact, and cannot replay historical migrations", () => {
  assert.match(payrollDeliveryRepairWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(payrollDeliveryRepairWorkflow, /pull_request:/);
  assert.match(payrollDeliveryRepairWorkflow, /control_sha:/);
  assert.match(payrollDeliveryRepairWorkflow, /frontend_receipt_sha:/);
  assert.match(payrollDeliveryRepairWorkflow, /render_receipt_sha:/);
  assert.match(payrollDeliveryRepairWorkflow, /sender_receipt_sha:/);
  assert.match(payrollDeliveryRepairWorkflow, /REPAIR_AND_ENABLE_DEALER_PAYROLL_DELIVERY_HSOP/);
  assert.match(payrollDeliveryRepairWorkflow, /dealer-swing-production-critical/);
  assert.match(payrollDeliveryRepairWorkflow, /required_reviewers/);
  assert.match(payrollDeliveryRepairWorkflow, /merge-base --is-ancestor/);
  assert.match(payrollDeliveryRepairWorkflow, /repair-dealer-payroll-statement-delivery\.mjs --repair/);
  assert.match(payrollDeliveryRepairWorkflow, /verify-dealer-payroll-statement-delivery-receipts\.mjs/);
  assert.match(payrollDeliveryRepairWorkflow, /set-dealer-payroll-statement-delivery-hsop-uat\.mjs --enable-hsop/);
  assert.doesNotMatch(payrollDeliveryRepairWorkflow, /2027011300000(?:0|1|4)/);
  assert.doesNotMatch(payrollDeliveryRepairWorkflow, /all_clubs_enabled\s*=\s*true/);
  assert.doesNotMatch(payrollDeliveryRepairWorkflow, /supabase\s+(?:db\s+(?:push|reset)|functions\s+deploy)/i);
  assert.doesNotMatch(payrollDeliveryRepairWorkflow, /vercel\s+(?:deploy|--prod)/i);
});

test("payroll statement HSOP runtime gate stays manual, exact-source, and narrowly scoped", () => {
  assert.match(payrollStatementHsopGateWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(payrollStatementHsopGateWorkflow, /pull_request:/);
  assert.match(payrollStatementHsopGateWorkflow, /source_sha:/);
  assert.match(payrollStatementHsopGateWorkflow, /enable_hsop/);
  assert.match(payrollStatementHsopGateWorkflow, /disable_hsop/);
  assert.match(payrollStatementHsopGateWorkflow, /dealer-swing-production-critical/);
  assert.match(payrollStatementHsopGateWorkflow, /required_reviewers/);
  assert.match(payrollStatementHsopGateWorkflow, /merge-base --is-ancestor/);
  assert.match(payrollStatementHsopGateWorkflow, /verify-dealer-payroll-statement-delivery-receipts\.mjs/);
  assert.match(payrollStatementHsopGateWorkflow, /set-dealer-payroll-statement-hsop-uat\.mjs/);
  assert.doesNotMatch(payrollStatementHsopGateWorkflow, /all_clubs_enabled\s*=\s*true/);
  assert.doesNotMatch(payrollStatementHsopGateWorkflow, /supabase\s+(?:db\s+(?:push|reset)|functions\s+deploy)/i);
  assert.doesNotMatch(payrollStatementHsopGateWorkflow, /vercel\s+(?:deploy|--prod)/i);
});

test("schema capture requires owner dispatch on exact main and retains no raw output in summaries", () => {
  assert.match(schemaCaptureWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(schemaCaptureWorkflow, /pull_request:/);
  assert.match(schemaCaptureWorkflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(schemaCaptureWorkflow, /dealer-swing-production-critical/);
  assert.match(schemaCaptureWorkflow, /github\.actor == github\.repository_owner/);
  assert.match(schemaCaptureWorkflow, /github\.triggering_actor == github\.repository_owner/);
  assert.match(schemaCaptureWorkflow, /test "\$INITIAL_ACTOR" = "\$REPOSITORY_OWNER"/);
  assert.match(schemaCaptureWorkflow, /test "\$TRIGGERING_ACTOR" = "\$REPOSITORY_OWNER"/);
  assert.match(schemaCaptureWorkflow, /CAPTURE_SCHEMA_ONLY/);
  assert.match(schemaCaptureWorkflow, /test "\$TARGET_SHA" = "\$GITHUB_SHA"/);
  assert.match(schemaCaptureWorkflow, /git rev-parse origin\/main/);
  assert.doesNotMatch(schemaCaptureWorkflow, /required_reviewers/);
  assert.match(schemaCaptureWorkflow, /supabase db dump --linked --schema public,storage,floor_private,private,spectator_projection_v2/);
  assert.match(schemaCaptureWorkflow, /sanitize-live-public-schema-artifact\.mjs/);
  assert.match(schemaCaptureWorkflow, /validate-live-public-schema-artifact\.mjs/);
  assert.match(schemaCaptureWorkflow, /raw_schema_path="\$\{RUNNER_TEMP\}\/live-public-schema\.raw\.sql"/);
  assert.match(schemaCaptureWorkflow, /rm -f "\$\{RUNNER_TEMP\}\/live-public-schema\.raw\.sql"/);
  assert.match(schemaCaptureWorkflow, /schema_artifact_sanitized=true/);
  assert.match(schemaCaptureWorkflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(schemaCaptureWorkflow, /retention-days: 3/);
  assert.doesNotMatch(schemaCaptureWorkflow, /supabase\s+(?:db\s+(?:push|reset)|functions\s+deploy)/i);
  assert.doesNotMatch(schemaCaptureWorkflow, /vercel\s+(?:deploy|--prod)/i);
  assert.equal(
    schemaCaptureWorkflow
      .split("\n")
      .some((line) => /\b(?:echo|printf)\b/i.test(line) && /(?:SUPABASE|TOKEN|PASSWORD)/i.test(line) && !/sha256sum/i.test(line)),
    false,
  );
});

test("payroll disposable validation requires a checksummed artifact without production access", () => {
  assert.match(payrollDisposableWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(payrollDisposableWorkflow, /pull_request:/);
  assert.match(payrollDisposableWorkflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(payrollDisposableWorkflow, /schema_artifact_run_id:/);
  assert.match(payrollDisposableWorkflow, /schema_sha256:/);
  assert.match(payrollDisposableWorkflow, /postgres: \["16", "17"\]/);
  assert.match(payrollDisposableWorkflow, /actions\/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093/);
  assert.match(payrollDisposableWorkflow, /sha256sum --check --status/);
  assert.doesNotMatch(payrollDisposableWorkflow, /\bsecrets\./);
  assert.doesNotMatch(payrollDisposableWorkflow, /supabase\s+(?:link|db\s+(?:dump|push|reset)|functions\s+deploy)/i);
  assert.doesNotMatch(payrollDisposableWorkflow, /vercel\s+(?:deploy|--prod)/i);
});

test("global PT wage apply is manual, protected, source-pinned, and dark by default", () => {
  assert.match(payrollApplyWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(payrollApplyWorkflow, /pull_request:/);
  assert.match(payrollApplyWorkflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(payrollApplyWorkflow, /dealer-swing-production-critical/);
  assert.match(payrollApplyWorkflow, /required_reviewers/);
  assert.match(payrollApplyWorkflow, /c3457d4cbd1c0b7f54917f629d15efef3637f5b9/);
  assert.match(payrollApplyWorkflow, /--preflight/);
  assert.match(payrollApplyWorkflow, /--apply/);
  assert.match(payrollApplyWorkflow, /APPLY_DEALER_PT_WAGE_GLOBAL_CONTINUOUS_ACCRUAL_V2_20270106000001/);
  assert.match(payrollApplyWorkflow, /--source-root/);
  assert.match(payrollApplyWorkflow, /git -C control-plane merge-base --is-ancestor/);
  assert.match(payrollApplyWorkflow, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/);
  assert.doesNotMatch(payrollApplyWorkflow, /supabase\s+(?:db\s+(?:push|reset)|functions\s+deploy)/i);
  assert.doesNotMatch(payrollApplyWorkflow, /vercel\s+(?:deploy|--prod)/i);
  assert.equal(
    payrollApplyWorkflow.split("\n").some((line) => /\b(?:echo|printf)\b/i.test(line) && /(?:SUPABASE|TOKEN|PASSWORD)/i.test(line)),
    false,
  );
});

test("readiness ACL repair apply is manual, protected, source-pinned, and cannot widen rollout", () => {
  assert.match(payrollReadinessAclApplyWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(payrollReadinessAclApplyWorkflow, /pull_request:/);
  assert.match(payrollReadinessAclApplyWorkflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(payrollReadinessAclApplyWorkflow, /dealer-swing-production-critical/);
  assert.match(payrollReadinessAclApplyWorkflow, /required_reviewers/);
  assert.match(payrollReadinessAclApplyWorkflow, /6939b6d72c9533ce68101624b22e7a5be73d3b83/);
  assert.match(payrollReadinessAclApplyWorkflow, /--preflight/);
  assert.match(payrollReadinessAclApplyWorkflow, /--apply/);
  assert.match(payrollReadinessAclApplyWorkflow, /APPLY_DEALER_PT_WAGE_READINESS_ACL_20270106000002/);
  assert.match(payrollReadinessAclApplyWorkflow, /--source-root/);
  assert.match(payrollReadinessAclApplyWorkflow, /git -C control-plane merge-base --is-ancestor/);
  assert.match(payrollReadinessAclApplyWorkflow, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/);
  assert.doesNotMatch(payrollReadinessAclApplyWorkflow, /supabase\s+(?:db\s+(?:push|reset)|functions\s+deploy)/i);
  assert.doesNotMatch(payrollReadinessAclApplyWorkflow, /vercel\s+(?:deploy|--prod)/i);
  assert.equal(
    payrollReadinessAclApplyWorkflow.split("\n").some((line) => /\b(?:echo|printf)\b/i.test(line) && /(?:SUPABASE|TOKEN|PASSWORD)/i.test(line)),
    false,
  );
});
