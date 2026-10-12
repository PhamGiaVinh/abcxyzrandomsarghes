import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync,writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadDeploymentManifest, mergeContracts } from "./deployment-manifest.mjs";
import { buildComponentDiffs, buildDeploymentPlan } from "./plan-edge-deployment.mjs";
import {
  catalogInventory,
  contractsForTargets,
  findMissingContracts,
  schemaInventory,
  sourceContractsForFrontend,
  assertPhysicalAssetFrontendBackend,
  assertScopedStopFrontendBackend,
} from "./probe-live-schema-contracts.mjs";
import { selectTargetContractProfile } from "./target-contract-profile.mjs";
import { inspectTargetSource } from "./verify-target-source.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const manifest = loadDeploymentManifest();
const PRE_922_SHA = "1fdc210d4ae1689091e0ad874c559592b0ecd690";
const PRE_FLOOR_CLOCK_BRIDGE_RECEIPT_SHA = "37e2306dd34ba2a9bf9447d9b1e22f52c9253e07";
const CRITICAL_TARGETS = "assign-dealer,process-swing,mass-assign,checkout-dealer";
const productionMetricsViewFixture = readFileSync(
  resolve(repositoryRoot, "VinPoker/scripts/deploy/fixtures/dealer_shift_metrics-production-view.sql"),
  "utf8",
);

test("physical declaration frontend requires its exact server RPC contract", () => {
  const contracts = sourceContractsForFrontend({targetRoot:repositoryRoot});
  const asset = contracts.find(item=>item.name==="public.declare_club_physical_table_v1");
  assert.ok(asset,"new component generic wrapper must not escape frontend contract discovery");
  assert.deepEqual(asset.argumentTypes,["uuid","integer","uuid","uuid"]);
  assert.equal(asset.allowOtherOverloads,false);
  assert.deepEqual(asset.acl,{authenticated:true,anon:false,service_role:false});
});
test("scoped Stop component RPC cannot bypass conditional frontend contract/gate",()=>{
  const targetRoot=mkdtempSync(join(tmpdir(),"stop64-frontend-gate-"));
  const folder=join(targetRoot,"VinPoker/src/components/cashier");
  mkdirSync(join(folder,"dealer-swing"),{recursive:true});
  const component=join(folder,"dealer-swing/DealerSwingStopControl.tsx");
  writeFileSync(join(folder,"DealerSwingTab.tsx"),'import { DealerSwingStopControl } from "./dealer-swing/DealerSwingStopControl";');
  writeFileSync(component,'stopApi.rpc("operator_stop_dealer_swing_v1", args);');
  try {
    const contract=sourceContractsForFrontend({targetRoot}).find(item=>item.name==="public.operator_stop_dealer_swing_v1");
    assert.deepEqual(contract.arguments,["p_club_id","p_request_id","p_expected_actor_id"]);
    assert.deepEqual(contract.acl,{authenticated:true,anon:false,service_role:false});
    const fn={schema:"public",name:"operator_stop_dealer_swing_v1",owner:"postgres",securityDefiner:true,
      definitionMd5:"32558a200e5c94c5bfcf0687b2a97ed2",configuration:['search_path=""','lock_timeout=5s'],
      arguments:contract.arguments.map(name=>({name,type:"uuid"})),
      executeAcl:{public:false,anon:false,authenticated:true,service_role:false}};
    const check=functions=>assertScopedStopFrontendBackend({targetRoot,catalog:{schemaVersion:1,relations:[],functions}});
    check([fn]);
    for(const functions of [[],[fn,fn],[{...fn,definitionMd5:undefined}],[{...fn,configuration:['search_path=""']}],
      [{...fn,executeAcl:{public:false,anon:false,authenticated:true,service_role:true}}]])
      assert.throws(()=>check(functions),/NOT_QUALIFIED/);
    assert.throws(()=>assertScopedStopFrontendBackend({targetRoot}),/REQUIRES_QUALIFIED_CATALOG/);
    // Current raw OFF control retains the old contract, not an absent newRPC.
    writeFileSync(component,'supabase.from("club_settings").upsert({auto_swing_enabled:false});');
    assert.equal(sourceContractsForFrontend({targetRoot}).some(item=>item.name===contract.name),false);
    assertScopedStopFrontendBackend({targetRoot});
    for(const unknown of ['api.stop(clubId);','const name="operator_stop_dealer_swing_v1"; stopApi.rpc(name,args);']) {
      writeFileSync(component,unknown);
      assert.throws(()=>sourceContractsForFrontend({targetRoot}),/UNKNOWN_TARGET_SCOPED_STOP_CONTRACT/);
    }
  } finally {rmSync(targetRoot,{recursive:true,force:true});}
});
test("physical declaration gate rejects old63, absent metadata and ACL/owner/path/overload drift",()=>{
  const fn={schema:"public",name:"declare_club_physical_table_v1",owner:"postgres",securityDefiner:true,
    configuration:['search_path=""'],definitionMd5:"c4c0bab3f601386c8b4f44d849c255df",
    arguments:[{name:"p_club_id",type:"uuid"},{name:"p_table_number",type:"integer"},
      {name:"p_request_id",type:"uuid"},{name:"p_expected_actor_id",type:"uuid"}],
    executeAcl:{public:false,anon:false,authenticated:true,service_role:false}};
  const check=functions=>assertPhysicalAssetFrontendBackend({targetRoot:repositoryRoot,catalog:{schemaVersion:1,relations:[],functions}});
  check([fn]);
  assert.throws(()=>check([]),/NOT_QUALIFIED/);
  assert.throws(()=>check([fn,fn]),/NOT_QUALIFIED/);
  for(const delta of [{definitionMd5:"f6539c58bf0ddba6e7ef1fdf97af6e2a"},{definitionMd5:undefined},
    {owner:"other"},{securityDefiner:false},{configuration:["search_path=public"]},
    {executeAcl:{public:true,anon:false,authenticated:true,service_role:false}}])
    assert.throws(()=>check([{...fn,...delta}]),/NOT_QUALIFIED/);
  assert.throws(()=>assertPhysicalAssetFrontendBackend({targetRoot:repositoryRoot}),/REQUIRES_QUALIFIED_CATALOG/);
});
test("canonical prior frontend without declaration retains its existing rollout requirements",()=>{
  const extracted=extractRevision("0f862e4e52c50aecc1c8c73f6f99db38efd3944c");
  try {
    assert.equal(sourceContractsForFrontend({targetRoot:extracted.targetRoot}).some(item=>item.name==="public.declare_club_physical_table_v1"),false);
    assertPhysicalAssetFrontendBackend({targetRoot:extracted.targetRoot});
  } finally {rmSync(extracted.root,{recursive:true,force:true});}
});

const baseSchema = `
CREATE TABLE public.game_tables (
    id uuid NOT NULL,
    opened_at timestamp with time zone,
    dealer_open_operation_id uuid
);

CREATE TABLE public.dealer_open_operations (
    id uuid NOT NULL
);

CREATE FUNCTION public.is_club_dealer_control(_user_id uuid, _club_id uuid) RETURNS boolean
    LANGUAGE sql
    AS $$ SELECT true $$;

CREATE FUNCTION public.assign_dealer_to_table(
    p_attendance_id uuid,
    p_table_id uuid,
    p_assigned_at timestamp with time zone DEFAULT now(),
    p_swing_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone
) RETURNS jsonb
    LANGUAGE sql
    AS $$ SELECT '{}'::jsonb $$;
`;

function contractKey(contract) {
  if (contract.type === "relation") return contract.name;
  if (contract.type === "column") return `${contract.relation}.${contract.name}`;
  if (contract.type === "function") return contract.name;
  return JSON.stringify(contract);
}

function schemaForContracts(contracts, { omit = new Set() } = {}) {
  const selected = contracts.filter((contract) => !omit.has(contractKey(contract)));
  const relations = new Map();
  for (const contract of selected) {
    if (contract.type === "relation") relations.set(contract.name, new Set(["id"]));
    if (contract.type === "column") {
      const columns = relations.get(contract.relation) ?? new Set(["id"]);
      columns.add(contract.name);
      relations.set(contract.relation, columns);
    }
  }

  const lines = [];
  for (const [relation, columns] of [...relations.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const body = [...columns].map((column) => `  ${column} uuid`).join(",\n");
    lines.push(`CREATE TABLE ${relation} (\n${body}\n);`);
  }

  for (const contract of selected.filter((item) => item.type === "function")) {
    const names = contract.arguments ?? [];
    const types = contract.argumentTypes ?? names.map(() => "uuid");
    const args = names.map((name, index) => `${name} ${types[index] ?? "uuid"}`).join(", ");
    const signature = types.join(", ");
    lines.push(`CREATE FUNCTION ${contract.name}(${args}) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`);
    if (contract.acl) {
      lines.push(`REVOKE EXECUTE ON FUNCTION ${contract.name}(${signature}) FROM PUBLIC, anon, authenticated, service_role;`);
      for (const [role, allowed] of Object.entries(contract.acl)) {
        if (allowed) lines.push(`GRANT EXECUTE ON FUNCTION ${contract.name}(${signature}) TO ${role};`);
      }
    }
  }
  return `${lines.join("\n\n")}\n`;
}

function extractRevision(sha) {
  const root = mkdtempSync(join(tmpdir(), "dealer-contract-probe-"));
  const targetRoot = join(root, "target");
  const archive = join(root, "target.tar");
  mkdirSync(targetRoot);
  execFileSync("git", ["-C", repositoryRoot, "archive", "--format=tar", `--output=${archive}`, sha]);
  execFileSync("tar", ["-xf", archive, "-C", targetRoot]);
  return { root, targetRoot };
}

function allContracts(targetRoot) {
  const edge = contractsForTargets({ manifest, rawTargets: CRITICAL_TARGETS, targetRoot });
  const frontend = contractsForTargets({ manifest, rawTargets: "frontend", targetRoot });
  assert.equal(edge.selection.profile, frontend.selection.profile);
  assert.equal(edge.selection.sourceFingerprint, frontend.selection.sourceFingerprint);
  return { selection: edge.selection, contracts: mergeContracts(edge.contracts, frontend.contracts) };
}

test("schema inventory extracts relation, typed signature and argument names", () => {
  const inventory = schemaInventory(baseSchema);
  assert.equal(inventory.relations.has("public.game_tables"), true);
  assert.equal(inventory.relationBodies.get("public.game_tables").includes("opened_at"), true);
  assert.deepEqual(inventory.functions.get("public.is_club_dealer_control"), [{
    argumentNames: ["_user_id", "_club_id"],
    argumentTypes: ["uuid", "uuid"],
    key: "public.is_club_dealer_control(uuid,uuid)",
  }]);
});

test("SQL fallback recognizes the sanitized production CREATE OR REPLACE VIEW excerpt", () => {
  const inventory = schemaInventory(productionMetricsViewFixture.replace(/\n/g, "\r\n"));
  assert.equal(inventory.relations.has("public.dealer_shift_metrics"), true);
  assert.equal(inventory.relationKinds.get("public.dealer_shift_metrics"), "v");
});

test("SQL fallback supports view options without treating comments or malformed DDL as live relations", () => {
  const schema = [
    "-- CREATE OR REPLACE VIEW public.dealer_shift_metrics AS SELECT 1;",
    "CREATE OR REPLACE VIEW public.dealer_shift_metrics WITH (security_barrier=true) AS SELECT 1 AS attendance_id;",
    "CREATE VIEW audit.dealer_shift_metrics AS SELECT 1;",
    "CREATE OR REPLACE VIEW public.incomplete_metrics AS;",
    "CREATE VIEW \"Public\".\"Dealer_Shift_Metrics\" AS SELECT 1;",
    "CREATE MATERIALIZED VIEW public.materialized_metrics AS SELECT 1;",
    "CREATE FOREIGN TABLE public.external_metrics (id uuid) SERVER fake_server;",
  ].join("\n");
  const inventory = schemaInventory(schema);
  assert.equal(inventory.relations.has("public.dealer_shift_metrics"), true);
  assert.equal(inventory.relationKinds.get("public.dealer_shift_metrics"), "v");
  assert.equal(inventory.relations.has("audit.dealer_shift_metrics"), true);
  assert.equal(inventory.relations.has("public.incomplete_metrics"), false);
  assert.equal(inventory.relations.has("Public.Dealer_Shift_Metrics"), true);
  assert.equal(inventory.relations.has("public.materialized_metrics"), true);
  assert.equal(inventory.relationKinds.get("public.materialized_metrics"), "m");
  assert.equal(inventory.relations.has("public.external_metrics"), true);
  assert.equal(inventory.relationKinds.get("public.external_metrics"), "f");
});

test("catalog inventory is canonical and preserves relation kind, ordered columns and execute ACL", () => {
  const catalog = {
    schemaVersion: 1,
    relations: [{
      schema: "public",
      name: "game_tables",
      relkind: "r",
      columns: [
        { ordinal: 2, name: "opened_at", type: "timestamp with time zone" },
        { ordinal: 1, name: "id", type: "uuid" },
      ],
    }],
    functions: [{
      schema: "public",
      name: "get_dealer_mass_open_rollout",
      arguments: [{ ordinal: 1, name: "p_expected_club_id", type: "uuid" }],
      executeAcl: { public: false, anon: false, authenticated: true, service_role: true },
    }],
  };
  const inventory = catalogInventory(catalog);
  assert.equal(inventory.source, "catalog");
  assert.equal(inventory.relationBodies.get("public.game_tables").startsWith("id uuid"), true);
  assert.deepEqual(findMissingContracts(inventory, [{
    type: "function",
    name: "public.get_dealer_mass_open_rollout",
    arguments: ["p_expected_club_id"],
    argumentTypes: ["uuid"],
    acl: { anon: false, authenticated: true, service_role: true },
  }]), []);
});

test("probe accepts matching typed contracts", () => {
  const missing = findMissingContracts(baseSchema, [
    { type: "relation", name: "public.game_tables" },
    { type: "column", relation: "public.game_tables", name: "opened_at" },
    {
      type: "function",
      name: "public.assign_dealer_to_table",
      arguments: ["p_attendance_id", "p_table_id", "p_assigned_at", "p_swing_due_at"],
    },
  ]);
  assert.deepEqual(missing, []);
});

test("Storage bucket clients are not inferred as public database relations", () => {
  const { contracts } = contractsForTargets({
    manifest,
    rawTargets: "render-payroll-statement",
    targetRoot: repositoryRoot,
  });

  assert.equal(
    contracts.some((contract) =>
      contract.type === "relation" && contract.name === "public.dealer_payroll_statements"
    ),
    true,
  );
  assert.equal(
    contracts.some((contract) =>
      contract.type === "relation" && contract.name === "public.payroll-statements"
    ),
    false,
  );
  assert.equal(
    contracts.some((contract) =>
      contract.type === "relation" && contract.name === "storage.objects"
    ),
    true,
  );
});

test("probe reports a missing column and signature without converting them to success", () => {
  const missing = findMissingContracts(baseSchema, [
    { type: "column", relation: "public.game_tables", name: "missing_column" },
    { type: "function", name: "public.is_club_dealer_control", arguments: ["_club_id"] },
  ]);
  assert.deepEqual(missing, [
    "column:public.game_tables.missing_column",
    "function:public.is_club_dealer_control(_club_id)",
  ]);
});

test("operation ACL requires authenticated access, anon denial, service helper access and no overload ambiguity", () => {
  const operationContracts = [
    {
      type: "function",
      name: "public.get_dealer_mass_open_rollout",
      arguments: ["p_expected_club_id"],
      argumentTypes: ["uuid"],
      allowOtherOverloads: false,
      acl: { authenticated: true, anon: false, service_role: true },
    },
    {
      type: "function",
      name: "public._refresh_dealer_open_operation",
      arguments: ["p_operation_id"],
      argumentTypes: ["uuid"],
      allowOtherOverloads: false,
      acl: { authenticated: false, anon: false, service_role: true },
    },
  ];
  const validSchema = schemaForContracts(operationContracts);
  assert.deepEqual(findMissingContracts(validSchema, operationContracts), []);

  const publicExecuteSchema = validSchema.replace(
    "REVOKE EXECUTE ON FUNCTION public.get_dealer_mass_open_rollout(uuid) FROM PUBLIC, anon, authenticated, service_role;",
    "GRANT EXECUTE ON FUNCTION public.get_dealer_mass_open_rollout(uuid) TO PUBLIC;",
  );
  assert.equal(
    findMissingContracts(publicExecuteSchema, operationContracts)
      .includes("acl:public.get_dealer_mass_open_rollout(uuid):anon:expected_deny"),
    true,
  );

  const ambiguousSchema = `${validSchema}\nCREATE FUNCTION public.get_dealer_mass_open_rollout(p_club text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`;
  assert.equal(
    findMissingContracts(ambiguousSchema, operationContracts)
      .includes("overload:public.get_dealer_mass_open_rollout:expected_exactly_one_found_2"),
    true,
  );
});

test("Tracker record_hand validates the reviewed ten-argument overload while preserving the legacy overload", () => {
  const { contracts } = contractsForTargets({
    manifest,
    rawTargets: "tournament-live-update",
    targetRoot: repositoryRoot,
  });
  const recordHand = contracts.find(
    (contract) => contract.type === "function" && contract.name === "public.record_hand",
  );
  assert.equal(recordHand?.allowOtherOverloads, true);

  const reviewedArguments = recordHand.arguments.map((name, index) => ({
    ordinal: index + 1,
    name,
    type: recordHand.argumentTypes[index],
  }));
  const legacyTypes = [
    "uuid", "uuid", "integer", "timestamp with time zone", "jsonb", "jsonb", "jsonb",
  ];
  const catalog = {
    schemaVersion: 1,
    relations: [],
    functions: [
      {
        schema: "public",
        name: "record_hand",
        arguments: reviewedArguments,
        executeAcl: { public: false, anon: false, authenticated: true, service_role: false },
      },
      {
        schema: "public",
        name: "record_hand",
        arguments: legacyTypes.map((type, index) => ({ ordinal: index + 1, name: `legacy_${index}`, type })),
        executeAcl: { public: false, anon: false, authenticated: false, service_role: true },
      },
    ],
  };

  assert.deepEqual(findMissingContracts(catalog, [recordHand]), []);
});

test("ACL probe accepts pg_dump signatures that include argument names", () => {
  const contract = {
    type: "function",
    name: "public._refresh_dealer_open_operation",
    arguments: ["p_operation_id"],
    argumentTypes: ["uuid"],
    allowOtherOverloads: false,
    acl: { authenticated: false, anon: false, service_role: true },
  };
  const schema = `
CREATE FUNCTION public._refresh_dealer_open_operation(p_operation_id uuid) RETURNS jsonb
  LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
REVOKE ALL ON FUNCTION public._refresh_dealer_open_operation(p_operation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public._refresh_dealer_open_operation(p_operation_id uuid) TO service_role;
`;
  assert.deepEqual(findMissingContracts(schema, [contract]), []);
});

test("Floor clock requires the exact revision-token RPC signature and runtime ACL", () => {
  const { contracts } = contractsForTargets({
    manifest,
    rawTargets: "tournament-live-clock",
    targetRoot: repositoryRoot,
  });
  const clockControl = contracts.find(
    (contract) => contract.type === "function" &&
      contract.name === "public.floor_control_tournament_clock",
  );
  assert.deepEqual(clockControl.arguments, [
    "p_tournament_id",
    "p_action",
    "p_delta_seconds",
    "p_expected_control_revision",
  ]);
  assert.deepEqual(clockControl.argumentTypes, ["uuid", "text", "integer", "text"]);
  assert.deepEqual(findMissingContracts(schemaForContracts(contracts), contracts), []);

  const oldSignature = schemaForContracts(contracts).replace(
    "p_expected_control_revision text",
    "p_expected_current_level integer",
  );
  assert.equal(
    findMissingContracts(oldSignature, contracts).some((item) =>
      item.startsWith("function:public.floor_control_tournament_clock")
    ),
    true,
  );
});

test("Ops invite acceptance preserves the source ACL inherited by service_role", () => {
  const acceptInvite = manifest.frontend.contracts.find(
    (contract) => contract.type === "function" &&
      contract.name === "public.accept_my_club_operator_invites",
  );
  assert.deepEqual(acceptInvite?.acl, {
    authenticated: true,
    anon: false,
    service_role: true,
  });
});

test("current target fails without alert objects and passes with the full alert contract", () => {
  const current = allContracts(repositoryRoot);
  assert.equal(current.selection.profile, "dealer_shortage_alert_v1");
  assert.equal(current.selection.requirements.floorClockRevisionV1, true);
  assert.equal(
    current.contracts.some((contract) =>
      contract.type === "function" &&
      contract.name === "public.floor_control_tournament_clock" &&
      contract.argumentTypes?.join(",") === "uuid,text,integer,text"
    ),
    true,
  );
  const omitted = new Set([
    "public.dealer_shortage_alert_incidents",
    "public.advance_dealer_shortage_alert_incident",
    "public.complete_dealer_shortage_alert_notification",
    "public.dealer_mass_open_rollout",
    "public.dealer_open_operations",
    "public.dealer_open_operation_targets",
    "public.game_tables.opened_at",
    "public.game_tables.dealer_open_operation_id",
    "public.get_dealer_mass_open_rollout",
    "public.get_dealer_open_operation",
    "public.operator_open_dealer_tables",
    "public._refresh_dealer_open_operation",
  ]);
  const missing = findMissingContracts(schemaForContracts(current.contracts, { omit: omitted }), current.contracts);
  assert.equal(missing.includes("relation:public.dealer_open_operations"), true);
  assert.equal(missing.includes("relation:public.dealer_open_operation_targets"), true);
  assert.equal(missing.includes("column:public.game_tables.dealer_open_operation_id"), true);
  assert.equal(missing.some((item) => item.startsWith("function:public.operator_open_dealer_tables")), true);
  assert.equal(missing.includes("relation:public.dealer_shortage_alert_incidents"), true);
  assert.equal(missing.some((item) => item.startsWith("function:public.advance_dealer_shortage_alert_incident")), true);
  assert.deepEqual(findMissingContracts(schemaForContracts(current.contracts), current.contracts), []);
});

test("pre-922 rollback source passes without operation objects and fails when a real legacy dependency is missing", () => {
  const extracted = extractRevision(PRE_922_SHA);
  try {
    const legacy = allContracts(extracted.targetRoot);
    assert.equal(legacy.selection.profile, "dealer_swing_legacy");
    assert.equal(legacy.selection.requirements.floorClockRevisionV1, false);
    const legacySchema = schemaForContracts(legacy.contracts);
    assert.doesNotMatch(legacySchema, /dealer_open_operations|dealer_open_operation_targets|dealer_mass_open_rollout/);
    assert.match(legacySchema, /floor_control_tournament_clock/);
    assert.equal(
      legacy.contracts.some((contract) =>
        contract.type === "function" &&
        contract.name === "public.floor_control_tournament_clock" &&
        contract.argumentTypes?.join(",") === "uuid,text,integer,text"
      ),
      true,
    );
    assert.deepEqual(findMissingContracts(legacySchema, legacy.contracts), []);
    assert.equal(
      findMissingContracts(
        schemaForContracts(legacy.contracts, { omit: new Set(["public.floor_control_tournament_clock"]) }),
        legacy.contracts,
      ).some((item) => item.startsWith("function:public.floor_control_tournament_clock")),
      true,
    );

    const missingAttendance = findMissingContracts(
      schemaForContracts(legacy.contracts, { omit: new Set(["public.dealer_attendance"]) }),
      legacy.contracts,
    );
    assert.equal(missingAttendance.includes("relation:public.dealer_attendance"), true);
  } finally {
    rmSync(extracted.root, { recursive: true, force: true });
  }
});

test("pre-922 rollback runs planning, source quality and target-aware contract probe end to end", () => {
  const extracted = extractRevision(PRE_922_SHA);
  try {
    const selection = selectTargetContractProfile({ targetRoot: extracted.targetRoot });
    const quality = inspectTargetSource({
      targetRoot: extracted.targetRoot,
      targets: CRITICAL_TARGETS.split(","),
      manifest,
    });
    assert.deepEqual(Object.keys(quality.functions).sort(), [
      "assign-dealer",
      "checkout-dealer",
      "mass-assign",
      "process-swing",
    ]);

    const currentMain = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "origin/main"], { encoding: "utf8" }).trim();
    const baselines = {
      frontend: { sha: currentMain, source: "github_deployment_receipt" },
      functions: Object.fromEntries(Object.keys(manifest.functions).map((name) => [name, {
        sha: name === "tournament-live-clock" ? PRE_FLOOR_CLOCK_BRIDGE_RECEIPT_SHA : currentMain,
        source: "github_deployment_receipt",
      }])),
    };
    const componentDiffs = buildComponentDiffs({
      repositoryRoot,
      targetSha: PRE_922_SHA,
      baselines,
      manifest,
    });
    assert.equal(componentDiffs.functions["ops-club-accounts"].targetHasEntrypoint, false);
    assert.equal(componentDiffs.functions["ops-club-accounts"].changed, false);
    assert.equal(
      componentDiffs.functions["tournament-live-clock"].retainedCompatibility.satisfied,
      false,
    );
    componentDiffs.functions["tournament-live-clock"].retainedCompatibility = {
      ...componentDiffs.functions["tournament-live-clock"].retainedCompatibility,
      satisfied: true,
      evidenceFiles: manifest.functions["tournament-live-clock"].retainedFrontendCompatibility.files
        .map((file) => file.path),
      missingEvidenceFiles: [],
    };
    const plan = buildDeploymentPlan({
      event: "workflow_dispatch",
      componentDiffs,
      selected: CRITICAL_TARGETS.split(","),
      deployFrontend: true,
      manifest,
      targetSha: PRE_922_SHA,
      contractSelection: selection,
    });
    assert.equal(plan.contractProfile, "dealer_swing_legacy");

    const contracts = allContracts(extracted.targetRoot).contracts;
    assert.deepEqual(findMissingContracts(schemaForContracts(contracts), contracts), []);
  } finally {
    rmSync(extracted.root, { recursive: true, force: true });
  }
});
