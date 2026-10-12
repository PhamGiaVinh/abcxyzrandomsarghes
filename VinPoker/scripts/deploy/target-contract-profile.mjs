import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inspectImportGraph } from "./verify-target-source.mjs";

export const LEGACY_PROFILE = "dealer_swing_legacy";
export const MASS_OPEN_PROFILE = "dealer_mass_open_v1";
export const SHORTAGE_ALERT_PROFILE = "dealer_shortage_alert_v1";

const EDGE_EVIDENCE_ROOTS = [
  "VinPoker/supabase/functions/process-swing/index.ts",
  "VinPoker/supabase/functions/mass-assign/index.ts",
  "VinPoker/supabase/functions/checkout-dealer/index.ts",
];

const FRONTEND_EVIDENCE_FILES = [
  "VinPoker/src/components/cashier/DealerSwingTab.tsx",
  "VinPoker/src/lib/dealerMassOpen.ts",
  "VinPoker/src/components/cashier/dealer-swing/PhysicalTableDeclaration.tsx",
];

const FLOOR_CLOCK_EDGE_ENTRY =
  "VinPoker/supabase/functions/tournament-live-clock/index.ts";
const FLOOR_CLOCK_FRONTEND_FILES = [
  "VinPoker/src/components/cashier/tournament-live/ClockPanel.tsx",
  "VinPoker/src/pages/ops/OpsTournamentCockpit.tsx",
];
const FLOOR_TRACKER_FEATURE_FILE = "VinPoker/src/lib/featureFlags.ts";
const FLOOR_TRACKER_UI_FILE = "VinPoker/src/components/cashier/tournament-live/FloorTableMapPanelV3.tsx";
const FLOOR_TRACKER_DIALOG_FILE = "VinPoker/src/components/cashier/tournament-live/MovePlayerDialog.tsx";
const FLOOR_TRACKER_CLIENT_FILE = "VinPoker/src/lib/floorTableControlV3.ts";
const FLOOR_TRACKER_EDGE_FILE = "VinPoker/supabase/functions/tournament-live-update/index.ts";

function marker(files, sources, predicate) {
  return files.filter((file) => predicate(file, sources.get(file) ?? ""));
}

export function selectTargetContractProfile({ targetRoot }) {
  const files = new Set();
  for (const relativePath of EDGE_EVIDENCE_ROOTS) {
    const entrypoint = resolve(targetRoot, relativePath);
    if (!existsSync(entrypoint)) {
      const error = new Error(`UNKNOWN_TARGET_CONTRACT_PROFILE: missing evidence root ${relativePath}`);
      error.code = "UNKNOWN_TARGET_CONTRACT_PROFILE";
      throw error;
    }
    for (const imported of inspectImportGraph(entrypoint, targetRoot)) files.add(imported);
  }
  for (const relativePath of FRONTEND_EVIDENCE_FILES) {
    if (existsSync(resolve(targetRoot, relativePath))) files.add(relativePath);
  }
  if (existsSync(resolve(targetRoot, FLOOR_CLOCK_EDGE_ENTRY))) {
    for (const imported of inspectImportGraph(
      resolve(targetRoot, FLOOR_CLOCK_EDGE_ENTRY),
      targetRoot,
    )) files.add(imported);
  }
  for (const relativePath of FLOOR_CLOCK_FRONTEND_FILES) {
    if (existsSync(resolve(targetRoot, relativePath))) files.add(relativePath);
  }
  for (const relativePath of [FLOOR_TRACKER_FEATURE_FILE, FLOOR_TRACKER_UI_FILE, FLOOR_TRACKER_DIALOG_FILE, FLOOR_TRACKER_CLIENT_FILE, FLOOR_TRACKER_EDGE_FILE]) {
    if (existsSync(resolve(targetRoot, relativePath))) files.add(relativePath);
  }

  const orderedFiles = [...files].sort();
  const sources = new Map(orderedFiles.map((file) => [file, readFileSync(resolve(targetRoot, file), "utf8")]));
  const evidence = {
    fillEmptyTablesImport: marker(orderedFiles, sources, (file) => file.endsWith("/_shared/fillEmptyTables.ts")),
    fillOpenOperationImport: marker(orderedFiles, sources, (file) => file.endsWith("/_shared/fillOpenOperation.ts")),
    operationRelations: marker(orderedFiles, sources, (_file, source) =>
      source.includes("dealer_open_operations") && source.includes("dealer_open_operation_targets")),
    operationColumn: marker(orderedFiles, sources, (_file, source) => source.includes("dealer_open_operation_id")),
    rollout: marker(orderedFiles, sources, (_file, source) =>
      source.includes("dealer_mass_open_rollout") || source.includes("get_dealer_mass_open_rollout")),
    frontendOperationRpc: marker(orderedFiles, sources, (_file, source) =>
      source.includes("operator_open_dealer_tables") || source.includes("get_dealer_open_operation")),
    shortageAlertImport: marker(
      orderedFiles,
      sources,
      (file) => file.endsWith("/process-swing/shortageAlert.ts"),
    ),
    shortageLedger: marker(orderedFiles, sources, (_file, source) =>
      source.includes("advance_dealer_shortage_alert_incident") &&
      source.includes("complete_dealer_shortage_alert_notification")),
    floorClockRevisionUi: marker(
      orderedFiles,
      sources,
      (file, source) =>
        FLOOR_CLOCK_FRONTEND_FILES.includes(file) &&
        source.includes("expected_control_revision") &&
        source.includes("control_revision"),
    ),
    floorClockRevisionEdge: marker(
      orderedFiles,
      sources,
      (file, source) =>
        file === FLOOR_CLOCK_EDGE_ENTRY &&
        source.includes("p_expected_control_revision") &&
        source.includes("floor_control_tournament_clock"),
    ),
    floorClockRevisionPolicy: marker(
      orderedFiles,
      sources,
      (file, source) =>
        file.endsWith("/tournament-live-clock/controlPolicy.ts") &&
        source.includes("readExpectedControlRevision"),
    ),
    floorTrackerFlag: marker(orderedFiles, sources, (file, source) =>
      file === FLOOR_TRACKER_FEATURE_FILE && /floorDeferredTrackerMoveV1:\s*true\b/.test(source)),
    floorTrackerUi: marker(orderedFiles, sources, (file, source) =>
      file === FLOOR_TRACKER_UI_FILE && (source.includes("queueTrackerMove") || (
        source.includes('from "./MovePlayerDialog"') && source.includes("<MovePlayerDialog") &&
        (sources.get(FLOOR_TRACKER_DIALOG_FILE) ?? "").includes("canonical.movePlayerSeatOrQueueExact(frozen.intent)") &&
        (sources.get(FLOOR_TRACKER_DIALOG_FILE) ?? "").includes("canonical.deferredTrackerMoveEnabled") &&
        (sources.get(FLOOR_TRACKER_CLIENT_FILE) ?? "").includes('movePlayerSeatOrQueueExact: (args: FloorExactMoveIntent) => call("move_player_seat_v5"')
      ))),
    floorTrackerEdge: marker(orderedFiles, sources, (file, source) =>
      file === FLOOR_TRACKER_EDGE_FILE && source.includes('supabase.rpc("start_tracker_hand_v3"')),
  };

  const has = (key) => evidence[key].length > 0;
  const massOpenComplete = has("fillOpenOperationImport")
    && has("operationRelations")
    && has("operationColumn")
    && has("rollout")
    && has("frontendOperationRpc");
  const anyMassOpenMarker = has("fillOpenOperationImport")
    || has("operationRelations")
    || has("operationColumn")
    || has("rollout")
    || has("frontendOperationRpc");
  const shortageAlertComplete = massOpenComplete
    && has("shortageAlertImport")
    && has("shortageLedger");
  const anyShortageAlertMarker = has("shortageAlertImport") || has("shortageLedger");
  const legacyComplete = has("fillEmptyTablesImport") && !anyMassOpenMarker;

  let profile;
  if (shortageAlertComplete) profile = SHORTAGE_ALERT_PROFILE;
  else if (anyShortageAlertMarker) {
    const error = new Error("UNKNOWN_TARGET_CONTRACT_PROFILE: shortage alert source markers are incomplete or contradictory");
    error.code = "UNKNOWN_TARGET_CONTRACT_PROFILE";
    error.evidence = evidence;
    throw error;
  } else if (massOpenComplete) profile = MASS_OPEN_PROFILE;
  else if (legacyComplete) profile = LEGACY_PROFILE;
  else {
    const error = new Error("UNKNOWN_TARGET_CONTRACT_PROFILE: target source markers are incomplete or contradictory");
    error.code = "UNKNOWN_TARGET_CONTRACT_PROFILE";
    error.evidence = evidence;
    throw error;
  }

  const floorClockRevisionComplete =
    evidence.floorClockRevisionUi.length === FLOOR_CLOCK_FRONTEND_FILES.length &&
    evidence.floorClockRevisionEdge.length === 1 &&
    evidence.floorClockRevisionPolicy.length === 1;
  const anyFloorClockRevisionMarker = evidence.floorClockRevisionUi.length > 0 ||
    evidence.floorClockRevisionEdge.length > 0 ||
    evidence.floorClockRevisionPolicy.length > 0;
  if (anyFloorClockRevisionMarker && !floorClockRevisionComplete) {
    const error = new Error(
      "UNKNOWN_TARGET_CONTRACT_PROFILE: Floor clock revision markers are incomplete or contradictory",
    );
    error.code = "UNKNOWN_TARGET_CONTRACT_PROFILE";
    error.evidence = evidence;
    throw error;
  }
  if (has("floorTrackerFlag") && (!has("floorTrackerUi") || !has("floorTrackerEdge"))) {
    const error = new Error("UNKNOWN_TARGET_CONTRACT_PROFILE: enabled deferred Floor move lacks UI or V3 Edge context");
    error.code = "UNKNOWN_TARGET_CONTRACT_PROFILE";
    error.evidence = evidence;
    throw error;
  }

  const hash = createHash("sha256");
  for (const file of orderedFiles) hash.update(`${file}\0${sources.get(file)}\0`);
  return {
    profile,
    sourceFingerprint: `sha256:${hash.digest("hex")}`,
    evidence,
    requirements: {
      floorClockRevisionV1: floorClockRevisionComplete,
      floorDeferredTrackerMoveV1: has("floorTrackerFlag"),
      dealerShortageAlertV1: shortageAlertComplete,
    },
    evidenceFiles: orderedFiles,
  };
}

export function assertTargetContractProfile({ targetRoot, expectedProfile }) {
  const selection = selectTargetContractProfile({ targetRoot });
  if (selection.profile !== expectedProfile) {
    const error = new Error(
      `TARGET_CONTRACT_PROFILE_MISMATCH: exact target selected ${selection.profile}, not ${expectedProfile}`,
    );
    error.code = "TARGET_CONTRACT_PROFILE_MISMATCH";
    throw error;
  }
  return selection;
}
