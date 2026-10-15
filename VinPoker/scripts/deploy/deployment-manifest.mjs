import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MANIFEST_PATH = resolve(scriptDirectory, "deployment-contracts.json");

const PROFILED_CRITICAL_FUNCTIONS = [
  "process-swing",
  "mass-assign",
  "checkout-dealer",
  "tournament-live-clock",
];
const REQUIRED_CRITICAL_POSTURE = new Map([
  ["process-swing", false],
  ["mass-assign", true],
  ["checkout-dealer", true],
  ["assign-dealer", false],
  ["tournament-live-clock", true],
  ["tournament-live-update", true],
  ["ops-club-accounts", true],
  ["cashier-lookup-player", true],
  ["render-payroll-statement", true],
  ["send-payroll-statement", true],
]);
const TARGET_REQUIREMENTS = new Set(["floorClockRevisionV1", "floorDeferredTrackerMoveV1"]);

export function loadDeploymentManifest(path = DEFAULT_MANIFEST_PATH) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  validateDeploymentManifest(manifest);
  return manifest;
}

export function validateDeploymentManifest(manifest, repositoryRoot) {
  if (manifest?.schemaVersion !== 3) throw new Error("deployment manifest schemaVersion must be 3");
  if (typeof manifest.criticalEnvironment !== "string" || !manifest.criticalEnvironment) {
    throw new Error("deployment manifest must name a criticalEnvironment");
  }
  if (!manifest.frontend || !Array.isArray(manifest.frontend.contracts) || manifest.frontend.contracts.length === 0) {
    throw new Error("frontend live contracts must be declared");
  }
  if (!manifest.frontend.receiptEnvironment || !Array.isArray(manifest.frontend.quality?.vitest)) {
    throw new Error("frontend receipt environment and quality tests must be declared");
  }
  if (!manifest.functions || typeof manifest.functions !== "object") {
    throw new Error("deployment manifest functions must be an object");
  }
  for (const profileName of ["dealer_swing_legacy", "dealer_mass_open_v1", "dealer_shortage_alert_v1"]) {
    const profile = manifest.contractProfiles?.[profileName];
    if (!profile || profile.deriveImportedGraphDependencies !== true) {
      throw new Error(`target-aware contract profile ${profileName} must derive imported graph dependencies`);
    }
    if (!Array.isArray(profile.frontend?.additionalContracts)) {
      throw new Error(`target-aware contract profile ${profileName} must declare frontend additions`);
    }
    for (const functionName of PROFILED_CRITICAL_FUNCTIONS) {
      if (!Array.isArray(profile.functions?.[functionName]?.additionalContracts)) {
        throw new Error(`target-aware contract profile ${profileName} must declare ${functionName} additions`);
      }
    }
  }
  if (manifest.contractProfiles.dealer_swing_legacy.extends !== null
      || manifest.contractProfiles.dealer_mass_open_v1.extends !== "dealer_swing_legacy"
      || manifest.contractProfiles.dealer_shortage_alert_v1.extends !== "dealer_mass_open_v1") {
    throw new Error("contract profile inheritance must be legacy -> dealer_mass_open_v1 -> dealer_shortage_alert_v1");
  }

  for (const [name, expectedVerifyJwt] of REQUIRED_CRITICAL_POSTURE) {
    const config = manifest.functions[name];
    if (!config) throw new Error(`critical function ${name} is missing from the deployment manifest`);
    if (config.critical !== true) throw new Error(`critical function ${name} must be marked critical`);
    if (config.autoDeployOnPush !== false) throw new Error(`critical function ${name} must stay manual-only`);
    if (config.verifyJwt !== expectedVerifyJwt) {
      throw new Error(`critical function ${name} has an unexpected verifyJwt posture`);
    }
  }
  if (manifest.functions["tournament-live-clock"].frontendRequirement !== "floorClockRevisionV1") {
    throw new Error("tournament-live-clock must remain tied to the Floor revision frontend requirement");
  }
  if (manifest.functions["tournament-live-update"].frontendRequirement !== "floorDeferredTrackerMoveV1") {
    throw new Error("tournament-live-update must remain tied to the deferred Floor move frontend requirement");
  }
  if (!manifest.frontend.contracts.some((contract) =>
    contract.type === "function" &&
    contract.name === "public.floor_control_tournament_clock" &&
    contract.allowOtherOverloads === false &&
    contract.acl?.authenticated === true &&
    contract.acl?.anon === false &&
    contract.acl?.service_role === false &&
    JSON.stringify(contract.argumentTypes) === JSON.stringify(["uuid", "text", "integer", "text"])
  )) {
    throw new Error("frontend deployment must always probe the exact clock-control RPC and ACL");
  }

  const seenPaths = new Set();
  const retainedRequirements = new Set();
  for (const [name, config] of Object.entries(manifest.functions)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`invalid Edge function name: ${name}`);
    if (typeof config.path !== "string" || !config.path.startsWith("VinPoker/supabase/functions/")) {
      throw new Error(`invalid source path for ${name}`);
    }
    if (seenPaths.has(config.path)) throw new Error(`duplicate source path in manifest: ${config.path}`);
    seenPaths.add(config.path);
    if (typeof config.critical !== "boolean" || typeof config.autoDeployOnPush !== "boolean") {
      throw new Error(`critical/autoDeployOnPush must be boolean for ${name}`);
    }
    if (config.autoDeployOnPush) {
      throw new Error(`Edge function ${name} cannot auto-deploy from the shared production workflow`);
    }
    if (typeof config.verifyJwt !== "boolean") throw new Error(`verifyJwt must be boolean for ${name}`);
    if (config.frontendRequirement !== undefined
        && (typeof config.frontendRequirement !== "string" || !config.frontendRequirement)) {
      throw new Error(`${name} frontend requirement must be a non-empty string`);
    }
    if (config.frontendRequirement !== undefined && !TARGET_REQUIREMENTS.has(config.frontendRequirement)) {
      throw new Error(`${name} references unknown frontend target requirement ${config.frontendRequirement}`);
    }
    if (config.retainedFrontendCompatibility !== undefined) {
      const gate = config.retainedFrontendCompatibility;
      if (typeof gate.requirement !== "string" || !gate.requirement) {
        throw new Error(`${name} retained frontend compatibility requirement must be named`);
      }
      if (retainedRequirements.has(gate.requirement)) {
        throw new Error(`duplicate retained frontend compatibility requirement ${gate.requirement}`);
      }
      retainedRequirements.add(gate.requirement);
      if (gate.whenTargetRequirement !== config.frontendRequirement) {
        throw new Error(`${name} retained compatibility must match its frontend target requirement`);
      }
      if (!Array.isArray(gate.files) || gate.files.length === 0) {
        throw new Error(`${name} retained compatibility must declare exact receipt files`);
      }
      for (const file of gate.files) {
        if (typeof file.path !== "string" || !file.path.startsWith(`${config.path}/`)) {
          throw new Error(`${name} retained compatibility evidence must stay inside its function source`);
        }
        if (!Array.isArray(file.contains) || file.contains.length === 0
            || file.contains.some((marker) => typeof marker !== "string" || !marker)) {
          throw new Error(`${name} retained compatibility evidence markers must be non-empty strings`);
        }
        if (repositoryRoot && !existsSync(resolve(repositoryRoot, file.path))) {
          throw new Error(`${name} retained compatibility evidence file does not exist: ${file.path}`);
        }
      }
    }
    if (!Array.isArray(config.contracts) || config.contracts.length === 0) {
      throw new Error(`live contracts are missing for ${name}`);
    }
    if (config.critical) {
      if (!config.receiptEnvironment || !Array.isArray(config.quality?.denoTests) || config.quality.denoTests.length === 0) {
        throw new Error(`critical receipt environment and Deno tests are missing for ${name}`);
      }
    }
    if (repositoryRoot && !existsSync(resolve(repositoryRoot, config.path))) {
      throw new Error(`source path does not exist for ${name}: ${config.path}`);
    }
  }

  const legacyProfile = resolveContractProfile(manifest, "dealer_swing_legacy");
  const massOpenProfile = resolveContractProfile(manifest, "dealer_mass_open_v1");
  const shortageAlertProfile = resolveContractProfile(manifest, "dealer_shortage_alert_v1");
  const durableNames = [
    "dealer_mass_open_rollout",
    "dealer_open_operations",
    "dealer_open_operation_targets",
    "dealer_open_operation_id",
    "opened_at",
    "get_dealer_mass_open_rollout",
    "get_dealer_open_operation",
    "operator_open_dealer_tables",
    "_refresh_dealer_open_operation",
  ];
  if (durableNames.some((name) => JSON.stringify(legacyProfile).includes(name))) {
    throw new Error("dealer_swing_legacy must not require durable mass-open objects");
  }
  const requireContract = (contracts, predicate, label) => {
    if (!contracts.some(predicate)) throw new Error(`dealer_mass_open_v1 is missing ${label}`);
  };
  for (const component of ["frontend", "process-swing", "mass-assign"]) {
    const contracts = component === "frontend" ? massOpenProfile.frontend : massOpenProfile.functions[component];
    for (const relation of [
      "public.dealer_mass_open_rollout",
      "public.dealer_open_operations",
      "public.dealer_open_operation_targets",
    ]) {
      requireContract(contracts, (item) => item.type === "relation" && item.name === relation, `${component} ${relation}`);
    }
    for (const column of ["opened_at", "dealer_open_operation_id"]) {
      requireContract(
        contracts,
        (item) => item.type === "column" && item.relation === "public.game_tables" && item.name === column,
        `${component} public.game_tables.${column}`,
      );
    }
    requireContract(
      contracts,
      (item) => item.type === "function"
        && item.name === "public._refresh_dealer_open_operation"
        && item.allowOtherOverloads === false
        && item.acl?.service_role === true
        && item.acl?.authenticated === false
        && item.acl?.anon === false,
      `${component} internal refresh helper ACL`,
    );
  }
  requireContract(
    massOpenProfile.functions["checkout-dealer"],
    (item) => item.type === "relation" && item.name === "public.dealer_mass_open_rollout",
    "checkout-dealer rollout relation",
  );
  for (const functionName of [
    "public.get_dealer_mass_open_rollout",
    "public.get_dealer_open_operation",
    "public.operator_open_dealer_tables",
  ]) {
    requireContract(
      massOpenProfile.frontend,
      (item) => item.type === "function"
        && item.name === functionName
        && item.allowOtherOverloads === false
        && item.acl?.authenticated === true
        && item.acl?.anon === false
        && Array.isArray(item.argumentTypes),
      `frontend exact signature/ACL for ${functionName}`,
    );
  }

  const alertNames = [
    "dealer_shortage_alert_incidents",
    "advance_dealer_shortage_alert_incident",
    "complete_dealer_shortage_alert_notification",
  ];
  if ([legacyProfile, massOpenProfile].some((profile) =>
    alertNames.some((name) => JSON.stringify(profile).includes(name))
  )) {
    throw new Error("legacy and mass-open profiles must not require shortage alert objects");
  }
  const alertContracts = shortageAlertProfile.functions["process-swing"];
  requireContract(
    alertContracts,
    (item) => item.type === "relation" && item.name === "public.dealer_shortage_alert_incidents",
    "process-swing shortage alert incident relation",
  );
  for (const [name, argumentsList, argumentTypes] of [
    [
      "public.advance_dealer_shortage_alert_incident",
      ["p_club_id", "p_incident_key", "p_classification", "p_severity", "p_snapshot", "p_error_code", "p_notify_enabled", "p_cooldown_seconds", "p_resolution_debounce_seconds"],
      ["uuid", "text", "text", "smallint", "jsonb", "text", "boolean", "integer", "integer"],
    ],
    [
      "public.complete_dealer_shortage_alert_notification",
      ["p_incident_id", "p_claim_id", "p_delivered"],
      ["uuid", "uuid", "boolean"],
    ],
  ]) {
    requireContract(
      alertContracts,
      (item) => item.type === "function"
        && item.name === name
        && item.allowOtherOverloads === false
        && JSON.stringify(item.arguments) === JSON.stringify(argumentsList)
        && JSON.stringify(item.argumentTypes) === JSON.stringify(argumentTypes)
        && item.acl?.service_role === true
        && item.acl?.authenticated === false
        && item.acl?.anon === false,
      `process-swing exact service-only shortage alert RPC ${name}`,
    );
  }

  return manifest;
}

function contractIdentity(contract) {
  if (contract.type === "relation") return `relation:${contract.name}`;
  if (contract.type === "column") return `column:${contract.relation}.${contract.name}`;
  if (contract.type === "function") {
    return `function:${contract.name}:${contract.arguments ? contract.arguments.join(",") : "*"}`;
  }
  return `unsupported:${JSON.stringify(contract)}`;
}

export function mergeContracts(...groups) {
  const merged = [];
  for (const contract of groups.flat()) {
    if (contract.type === "function" && contract.arguments) {
      for (let index = merged.length - 1; index >= 0; index -= 1) {
        if (merged[index].type === "function"
            && merged[index].name === contract.name
            && !merged[index].arguments) merged.splice(index, 1);
      }
    }
    if (contract.type === "function" && !contract.arguments
        && merged.some((item) => item.type === "function" && item.name === contract.name && item.arguments)) {
      continue;
    }
    const identity = contractIdentity(contract);
    const existing = merged.findIndex((item) => contractIdentity(item) === identity);
    if (existing === -1) merged.push(contract);
    else merged[existing] = { ...merged[existing], ...contract };
  }
  return merged;
}

export function resolveContractProfile(manifest, profileName) {
  const profile = manifest.contractProfiles?.[profileName];
  if (!profile) throw new Error(`unknown target contract profile: ${profileName}`);
  const chain = [];
  const seen = new Set();
  let cursor = profile;
  while (cursor) {
    if (seen.has(cursor)) throw new Error(`contract profile inheritance cycle at ${profileName}`);
    seen.add(cursor);
    chain.unshift(cursor);
    cursor = cursor.extends ? manifest.contractProfiles[cursor.extends] : null;
  }
  const functions = {};
  for (const [name, config] of Object.entries(manifest.functions)) {
    functions[name] = mergeContracts(
      config.contracts,
      ...chain.map((item) => item.functions?.[name]?.additionalContracts ?? []),
    );
  }
  return {
    name: profileName,
    frontend: mergeContracts(
      manifest.frontend.contracts,
      ...chain.map((item) => item.frontend.additionalContracts),
    ),
    functions,
    deriveImportedGraphDependencies: chain.every((item) => item.deriveImportedGraphDependencies),
  };
}

export function resolveTargetContracts(manifest, selection) {
  return resolveContractProfile(manifest, selection.profile);
}

export function parseTargetList(rawTargets) {
  let targets;
  if (rawTargets.trim().startsWith("[")) {
    try {
      targets = JSON.parse(rawTargets);
    } catch {
      throw new Error("targets must be a JSON array or a comma-separated function list");
    }
  } else {
    targets = rawTargets.split(",").map((target) => target.trim()).filter(Boolean);
  }
  if (!Array.isArray(targets) || targets.some((target) => typeof target !== "string")) {
    throw new Error("targets must contain function names");
  }
  if (new Set(targets).size !== targets.length) throw new Error("targets must not contain duplicates");
  return targets;
}
