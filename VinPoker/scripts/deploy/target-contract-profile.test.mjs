import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertTargetContractProfile,
  LEGACY_PROFILE,
  MASS_OPEN_PROFILE,
  SHORTAGE_ALERT_PROFILE,
  selectTargetContractProfile,
} from "./target-contract-profile.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PRE_922_SHA = "1fdc210d4ae1689091e0ad874c559592b0ecd690";

function put(root, path, content) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

function makeLegacyTarget() {
  const root = mkdtempSync(join(tmpdir(), "dealer-contract-profile-"));
  put(root, "VinPoker/supabase/functions/process-swing/index.ts", 'import "../_shared/fillEmptyTables.ts";\n');
  put(root, "VinPoker/supabase/functions/mass-assign/index.ts", "export const massAssign = true;\n");
  put(root, "VinPoker/supabase/functions/checkout-dealer/index.ts", "export const checkoutDealer = true;\n");
  put(root, "VinPoker/supabase/functions/_shared/fillEmptyTables.ts", 'client.from("game_tables");\n');
  return root;
}

function addMassOpenSource(root) {
  put(root, "VinPoker/supabase/functions/mass-assign/index.ts", 'import "../_shared/fillOpenOperation.ts";\n');
  put(root, "VinPoker/supabase/functions/_shared/fillOpenOperation.ts", `
    client.from("dealer_open_operations");
    client.from("dealer_open_operation_targets");
    client.from("game_tables").select("dealer_open_operation_id");
    client.from("dealer_mass_open_rollout");
    client.rpc("_refresh_dealer_open_operation");
  `);
  put(root, "VinPoker/src/components/cashier/DealerSwingTab.tsx", `
    dealerMassOpenRpc("operator_open_dealer_tables");
    dealerMassOpenRpc("get_dealer_open_operation");
  `);
}

function extractRevision(sha) {
  const root = mkdtempSync(join(tmpdir(), "dealer-contract-revision-"));
  const targetRoot = join(root, "target");
  const archive = join(root, "target.tar");
  mkdirSync(targetRoot);
  execFileSync("git", ["-C", repositoryRoot, "archive", "--format=tar", `--output=${archive}`, sha]);
  execFileSync("tar", ["-xf", archive, "-C", targetRoot]);
  return { root, targetRoot };
}

test("current reviewed target derives dealer_shortage_alert_v1 from exact imported source", () => {
  const selection = selectTargetContractProfile({ targetRoot: repositoryRoot });
  assert.equal(selection.profile, SHORTAGE_ALERT_PROFILE);
  assert.match(selection.sourceFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(selection.evidence.fillOpenOperationImport.length > 0, true);
  assert.equal(selection.evidence.frontendOperationRpc.length > 0, true);
  assert.equal(selection.evidence.shortageAlertImport.length > 0, true);
  assert.equal(selection.evidence.shortageLedger.length > 0, true);
  assert.equal(selection.requirements.floorClockRevisionV1, true);
  assert.equal(selection.requirements.dealerShortageAlertV1, true);
});

test("pre-922 exact target derives dealer_swing_legacy", () => {
  const extracted = extractRevision(PRE_922_SHA);
  try {
    const selection = selectTargetContractProfile({ targetRoot: extracted.targetRoot });
    assert.equal(selection.profile, LEGACY_PROFILE);
    assert.equal(selection.evidence.fillOpenOperationImport.length, 0);
    assert.equal(selection.evidence.operationRelations.length, 0);
    assert.equal(selection.requirements.floorClockRevisionV1, false);
  } finally {
    rmSync(extracted.root, { recursive: true, force: true });
  }
});

test("partial Floor clock revision markers fail closed", () => {
  const root = makeLegacyTarget();
  try {
    put(
      root,
      "VinPoker/src/components/cashier/tournament-live/ClockPanel.tsx",
      "const request = { expected_control_revision: clock.control_revision };\n",
    );
    assert.throws(
      () => selectTargetContractProfile({ targetRoot: root }),
      (error) => error.code === "UNKNOWN_TARGET_CONTRACT_PROFILE",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical deferred move requires a wired dialog, adapter and V3 Edge", () => {
  const root = makeLegacyTarget();
  const panel = "VinPoker/src/components/cashier/tournament-live/FloorTableMapPanelV3.tsx";
  const dialog = "VinPoker/src/components/cashier/tournament-live/MovePlayerDialog.tsx";
  const client = "VinPoker/src/lib/floorTableControlV3.ts";
  const edge = "VinPoker/supabase/functions/tournament-live-update/index.ts";
  const wiredPanel = 'import { MovePlayerDialog } from "./MovePlayerDialog"; <MovePlayerDialog />';
  const wiredClient = 'movePlayerSeatOrQueueExact: (args: FloorExactMoveIntent) => call("move_player_seat_v5", args)';
  const reject = () => assert.throws(() => selectTargetContractProfile({ targetRoot: root }),
    error => error.code === "UNKNOWN_TARGET_CONTRACT_PROFILE");
  try {
    put(root, "VinPoker/src/lib/featureFlags.ts", "floorDeferredTrackerMoveV1: true");
    put(root, panel, wiredPanel);
    put(root, dialog, "canonical.deferredTrackerMoveEnabled; canonical.movePlayerSeatOrQueueExact(frozen.intent)");
    put(root, client, wiredClient);
    reject();
    put(root, edge, 'supabase.rpc("start_tracker_hand_v3", {})');
    assert.equal(selectTargetContractProfile({ targetRoot: root }).requirements.floorDeferredTrackerMoveV1, true);
    put(root, panel, 'import { MovePlayerDialog } from "./MovePlayerDialog";');
    reject();
    put(root, panel, wiredPanel);
    put(root, client, 'call("move_player_seat_v4", args)');
    reject();
    put(root, client, wiredClient);
    put(root, dialog, "canonical.movePlayerSeatExact(frozen.intent)");
    reject();
    put(root, panel, "queueTrackerMove");
    assert.equal(selectTargetContractProfile({ targetRoot: root }).requirements.floorDeferredTrackerMoveV1, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("operator cannot force current mass-open source through the legacy profile", () => {
  assert.throws(
    () => assertTargetContractProfile({ targetRoot: repositoryRoot, expectedProfile: LEGACY_PROFILE }),
    (error) => error.code === "TARGET_CONTRACT_PROFILE_MISMATCH",
  );
});

test("operator cannot force current shortage-alert source through the mass-open profile", () => {
  assert.throws(
    () => assertTargetContractProfile({ targetRoot: repositoryRoot, expectedProfile: MASS_OPEN_PROFILE }),
    (error) => error.code === "TARGET_CONTRACT_PROFILE_MISMATCH",
  );
});

test("adding the shared fillOpenOperation import switches source to mass-open", () => {
  const root = makeLegacyTarget();
  try {
    assert.equal(selectTargetContractProfile({ targetRoot: root }).profile, LEGACY_PROFILE);
    addMassOpenSource(root);
    assert.equal(selectTargetContractProfile({ targetRoot: root }).profile, MASS_OPEN_PROFILE);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("adding the complete shortage alert module switches mass-open source to alert", () => {
  const root = makeLegacyTarget();
  try {
    addMassOpenSource(root);
    assert.equal(selectTargetContractProfile({ targetRoot: root }).profile, MASS_OPEN_PROFILE);
    put(root, "VinPoker/supabase/functions/process-swing/index.ts", `
      import "../_shared/fillEmptyTables.ts";
      import "./shortageAlert.ts";
    `);
    put(root, "VinPoker/supabase/functions/process-swing/shortageAlert.ts", `
      client.rpc("advance_dealer_shortage_alert_incident");
      client.rpc("complete_dealer_shortage_alert_notification");
    `);
    assert.equal(selectTargetContractProfile({ targetRoot: root }).profile, SHORTAGE_ALERT_PROFILE);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("partial shortage alert markers fail closed", () => {
  const root = makeLegacyTarget();
  try {
    addMassOpenSource(root);
    put(root, "VinPoker/supabase/functions/process-swing/index.ts", `
      import "../_shared/fillEmptyTables.ts";
      import "./shortageAlert.ts";
    `);
    put(root, "VinPoker/supabase/functions/process-swing/shortageAlert.ts", `
      client.rpc("advance_dealer_shortage_alert_incident");
    `);
    assert.throws(
      () => selectTargetContractProfile({ targetRoot: root }),
      (error) => error.code === "UNKNOWN_TARGET_CONTRACT_PROFILE",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("partial or unknown source markers fail closed", () => {
  const root = makeLegacyTarget();
  try {
    put(root, "VinPoker/supabase/functions/_shared/fillEmptyTables.ts", `
      client.from("game_tables");
      client.from("dealer_mass_open_rollout");
    `);
    assert.throws(
      () => selectTargetContractProfile({ targetRoot: root }),
      (error) => error.code === "UNKNOWN_TARGET_CONTRACT_PROFILE",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
