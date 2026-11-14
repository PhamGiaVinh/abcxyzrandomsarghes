import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { posix as path } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeploymentManifest, resolveTargetContracts } from "./deployment-manifest.mjs";
import { selectTargetContractProfile } from "./target-contract-profile.mjs";
import { hash, loadObservationPolicy, observationCandidate } from "./verified-deployment-observation.mjs";

const SHARED_PREFIXES = [
  "VinPoker/supabase/functions/_shared/",
  "VinPoker/supabase/functions/_staking_shared/",
];

const LOCAL_IMPORT_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".json"];
const TARGET_SOURCE_PREFIX = "VinPoker/";

const FRONTEND_PREFIXES = ["VinPoker/src/", "VinPoker/public/"];
const FRONTEND_FILES = new Set([
  "VinPoker/index.html",
  "VinPoker/ops.html",
  "VinPoker/package.json",
  "VinPoker/package-lock.json",
  "VinPoker/postcss.config.js",
  "VinPoker/tailwind.config.ts",
  "VinPoker/tsconfig.json",
  "VinPoker/tsconfig.app.json",
  "VinPoker/tsconfig.node.json",
  "VinPoker/vite.config.ts",
  "VinPoker/vercel.json",
  "vercel.json",
]);

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument near ${key ?? "end"}`);
    args.set(key.slice(2), value);
  }
  return args;
}

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isFrontendPath(path) {
  const normalized = normalizePath(path);
  return FRONTEND_FILES.has(normalized) || FRONTEND_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function frontendTreeFingerprint(repositoryRoot,sha){
  const entries=execFileSync('git',['-C',repositoryRoot,'ls-tree','-r','-z',sha],{encoding:'utf8',maxBuffer:16*1024*1024})
    .split('\0').filter(Boolean).filter(row=>isFrontendPath(row.slice(row.indexOf('\t')+1))).sort();
  return hash(JSON.stringify(entries));
}

function git(repositoryRoot, args) {
  return execFileSync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8" }).trim();
}

export function verifyCommitOnMain(repositoryRoot, sha, mainRef = "origin/main") {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("target and receipt SHAs must be 40 lowercase hexadecimal characters");
  git(repositoryRoot, ["cat-file", "-e", `${sha}^{commit}`]);
  try {
    execFileSync("git", ["-C", repositoryRoot, "merge-base", "--is-ancestor", sha, mainRef], { stdio: "ignore" });
  } catch {
    throw new Error(`commit ${sha} is not reachable from ${mainRef}`);
  }
  if (git(repositoryRoot, ["rev-parse", sha]) !== sha) throw new Error(`commit ${sha} did not resolve exactly`);
}

function receiptFor(baselines, component) {
  if (component === "frontend") return baselines.frontend ?? null;
  return baselines.functions?.[component] ?? null;
}

function diffFiles(repositoryRoot, baselineSha, targetSha, paths) {
  const output = git(repositoryRoot, ["diff", "--name-only", baselineSha, targetSha, "--", ...paths]);
  return output ? output.split(/\r?\n/).map(normalizePath).filter(Boolean).sort() : [];
}

function sourceAtCommit(repositoryRoot, sha, path) {
  try {
    return execFileSync(
      "git",
      ["-C", repositoryRoot, "show", `${sha}:${normalizePath(path)}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return null;
  }
}

function isIdentifierStart(char) {
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || char === "_" || char === "$";
}

function isIdentifierPart(char) {
  const code = char.charCodeAt(0);
  return isIdentifierStart(char) || (code >= 48 && code <= 57);
}

function readQuotedModuleString(source, start) {
  const quote = source[start];
  let index = start + 1;
  let value = "";
  let escaped = false;
  while (index < source.length) {
    const char = source[index];
    if (char === quote) return { index: index + 1, token: { type: "string", value, escaped } };
    if (char === "\\") {
      escaped = true;
      if (index + 1 >= source.length) return { error: "unterminated escape in string literal" };
      index += 2;
      continue;
    }
    if (char === "\r" || char === "\n") return { error: "unterminated string literal" };
    value += char;
    index += 1;
  }
  return { error: "unterminated string literal" };
}

function readTemplateLiteral(source, start) {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === "`") {
      return {
        index: index + 1,
        hasModuleKeyword: /\b(?:import|export)\b/.test(source.slice(start + 1, index)),
      };
    }
    index += 1;
  }
  return { error: "unterminated template literal" };
}

function lexModuleTokens(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index + 2);
      if (index === -1) break;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) return { error: "unterminated block comment" };
      index = end + 2;
      continue;
    }
    if (char === "'" || char === '"') {
      const string = readQuotedModuleString(source, index);
      if (string.error) return string;
      tokens.push(string.token);
      index = string.index;
      continue;
    }
    if (char === "`") {
      const template = readTemplateLiteral(source, index);
      if (template.error) return template;
      if (template.hasModuleKeyword) return { error: "template literal may contain a module expression" };
      index = template.index;
      continue;
    }
    if (isIdentifierStart(char)) {
      const start = index;
      index += 1;
      while (index < source.length && isIdentifierPart(source[index])) index += 1;
      tokens.push({ type: "identifier", value: source.slice(start, index) });
      continue;
    }
    tokens.push({ type: "punctuation", value: char });
    index += 1;
  }
  return { tokens };
}

function addModuleSpecifier({ token, localSpecifiers }) {
  if (token.escaped) return { error: "escaped module specifier cannot be resolved safely" };
  if (token.value.startsWith(".")) localSpecifiers.add(token.value);
  return null;
}

function findFromModuleSpecifier(tokens, start) {
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "punctuation" && token.value === ";") return null;
    if (token.type === "identifier" && (token.value === "import" || token.value === "export")) return null;
    if (token.type === "identifier" && token.value === "from" && tokens[index + 1]?.type === "string") {
      return tokens[index + 1];
    }
  }
  return null;
}

function collectLocalModuleSpecifiers(source) {
  const lexed = lexModuleTokens(source);
  if (lexed.error) return { complete: false, localSpecifiers: [], reason: lexed.error };
  const localSpecifiers = new Set();
  for (let index = 0; index < lexed.tokens.length; index += 1) {
    const token = lexed.tokens[index];
    if (token.type !== "identifier") continue;
    if (token.value === "import") {
      const next = lexed.tokens[index + 1];
      if (!next || (next.type === "punctuation" && next.value === ".")) continue;
      if (next.type === "punctuation" && next.value === "(") {
        const specifier = lexed.tokens[index + 2];
        if (specifier?.type !== "string") {
          return { complete: false, localSpecifiers: [...localSpecifiers], reason: "non-literal dynamic import" };
        }
        const afterSpecifier = lexed.tokens[index + 3];
        if (afterSpecifier?.type !== "punctuation" || afterSpecifier.value !== ")") {
          return { complete: false, localSpecifiers: [...localSpecifiers], reason: "non-literal dynamic import" };
        }
        const error = addModuleSpecifier({ token: specifier, localSpecifiers });
        if (error) return { complete: false, localSpecifiers: [...localSpecifiers], reason: error.error };
        continue;
      }
      if (next.type === "string") {
        const error = addModuleSpecifier({ token: next, localSpecifiers });
        if (error) return { complete: false, localSpecifiers: [...localSpecifiers], reason: error.error };
        continue;
      }
      const specifier = findFromModuleSpecifier(lexed.tokens, index + 1);
      if (!specifier) {
        return { complete: false, localSpecifiers: [...localSpecifiers], reason: "unrecognized static import" };
      }
      const error = addModuleSpecifier({ token: specifier, localSpecifiers });
      if (error) return { complete: false, localSpecifiers: [...localSpecifiers], reason: error.error };
      continue;
    }
    if (token.value === "export") {
      const specifier = findFromModuleSpecifier(lexed.tokens, index + 1);
      if (!specifier) continue;
      const error = addModuleSpecifier({ token: specifier, localSpecifiers });
      if (error) return { complete: false, localSpecifiers: [...localSpecifiers], reason: error.error };
    }
  }
  return { complete: true, localSpecifiers: [...localSpecifiers] };
}

function createTargetSourceReader(repositoryRoot, targetSha) {
  const files = new Set(git(repositoryRoot, ["ls-tree", "-r", "--name-only", targetSha])
    .split(/\r?\n/)
    .map(normalizePath)
    .filter(Boolean));
  const sourceCache = new Map();
  return {
    has(path) {
      return files.has(normalizePath(path));
    },
    source(path) {
      const normalized = normalizePath(path);
      if (!files.has(normalized)) return null;
      if (!sourceCache.has(normalized)) sourceCache.set(normalized, sourceAtCommit(repositoryRoot, targetSha, normalized));
      return sourceCache.get(normalized);
    },
  };
}

function resolveLocalImportAtCommit({ sourceReader, importerPath, specifier }) {
  const candidate = path.normalize(path.join(path.dirname(importerPath), specifier));
  if (!candidate.startsWith(TARGET_SOURCE_PREFIX)) {
    return { error: `local import escapes target source root: ${specifier} from ${importerPath}` };
  }
  const candidates = path.extname(candidate)
    ? [candidate]
    : [candidate, ...LOCAL_IMPORT_EXTENSIONS.map((extension) => `${candidate}${extension}`), path.join(candidate, "index.ts")];
  const matches = candidates.filter((candidatePath) => sourceReader.has(candidatePath));
  if (matches.length !== 1) {
    return {
      error: matches.length === 0
        ? `unresolved local import ${specifier} from ${importerPath}`
        : `ambiguous local import ${specifier} from ${importerPath}`,
    };
  }
  return { path: matches[0] };
}

function inspectTargetImportClosure({ sourceReader, entrypoint }) {
  const pending = [entrypoint];
  const visited = new Set();
  while (pending.length > 0) {
    const importerPath = pending.pop();
    if (visited.has(importerPath)) continue;
    const source = sourceReader.source(importerPath);
    if (source === null) return { complete: false, files: [...visited].sort(), reason: `missing source ${importerPath}` };
    visited.add(importerPath);

    const imports = collectLocalModuleSpecifiers(source);
    if (!imports.complete) {
      return {
        complete: false,
        files: [...visited].sort(),
        reason: `${imports.reason} in ${importerPath}`,
      };
    }
    for (const specifier of imports.localSpecifiers) {
      const imported = resolveLocalImportAtCommit({ sourceReader, importerPath, specifier });
      if (imported.error) return { complete: false, files: [...visited].sort(), reason: imported.error };
      pending.push(imported.path);
    }
  }
  return { complete: true, files: [...visited].sort(), reason: null };
}

function inspectRetainedCompatibility(repositoryRoot, receiptSha, gate) {
  const evidenceFiles = [];
  const missingEvidenceFiles = [];
  for (const file of gate.files) {
    const source = receiptSha ? sourceAtCommit(repositoryRoot, receiptSha, file.path) : null;
    if (source !== null && file.contains.every((marker) => source.includes(marker))) {
      evidenceFiles.push(file.path);
    } else {
      missingEvidenceFiles.push(file.path);
    }
  }
  return {
    requirement: gate.requirement,
    whenTargetRequirement: gate.whenTargetRequirement,
    satisfied: Boolean(receiptSha) && missingEvidenceFiles.length === 0,
    evidenceFiles,
    missingEvidenceFiles,
  };
}

export function buildComponentDiffs({ repositoryRoot, targetSha, baselines, manifest, mainRef = "origin/main", observationPolicy = null }) {
  verifyCommitOnMain(repositoryRoot, targetSha, mainRef);
  const result = { frontend: null, functions: {} };
  const targetSource = createTargetSourceReader(repositoryRoot, targetSha);
  const frontendFingerprint=observationPolicy?frontendTreeFingerprint(repositoryRoot,targetSha):null;

  const frontendReceipt = receiptFor(baselines, "frontend");
  if (frontendReceipt?.sha) verifyCommitOnMain(repositoryRoot, frontendReceipt.sha, mainRef);
  const frontendFiles = frontendReceipt?.sha
    ? diffFiles(repositoryRoot, frontendReceipt.sha, targetSha, [...FRONTEND_PREFIXES, ...FRONTEND_FILES])
    : [];
  result.frontend = {
    baselineSha: frontendReceipt?.sha ?? null,
    baselineSource: frontendReceipt?.source ?? "missing",
    changed: frontendReceipt?.sha ? frontendFiles.some(isFrontendPath) : true,
    files: frontendFiles,
  };

  for (const [name, config] of Object.entries(manifest.functions)) {
    const receipt = receiptFor(baselines, name);
    if (receipt?.sha) verifyCommitOnMain(repositoryRoot, receipt.sha, mainRef);
    const targetHasEntrypoint = targetSource.source(`${config.path}/index.ts`) !== null;
    const importClosure = targetHasEntrypoint && (receipt?.sha || observationPolicy)
      ? inspectTargetImportClosure({ sourceReader: targetSource, entrypoint: `${config.path}/index.ts` })
      : { complete: true, files: [], reason: "not_needed" };
    // Keep the complete direct function tree in scope (including tests and
    // configuration) and add the exact target-SHA local import closure. An
    // unknown closure cannot safely narrow the receipt diff, so all VinPoker
    // source is retained for that function until its imports are explicit.
    const diffScope = importClosure.complete
      ? [...new Set([config.path, ...importClosure.files])]
      : [TARGET_SOURCE_PREFIX];
    const files = targetHasEntrypoint && receipt?.sha
      ? diffFiles(repositoryRoot, receipt.sha, targetSha, diffScope)
      : [];
    const directFiles = files.filter((path) => path === config.path || path.startsWith(`${config.path}/`));
    const sharedFiles = files.filter((path) => SHARED_PREFIXES.some((prefix) => path.startsWith(prefix)));
    // A direct function diff is always relevant. Shared diffs are relevant only
    // when the target entrypoint imports them; arbitrary local dependencies
    // outside the historical shared prefixes are also tracked through the same
    // target-SHA closure. If that proof cannot be built, the full source diff
    // is retained so the deployment gate fails closed.
    const dependencyFiles = files.filter((path) => !directFiles.includes(path) && !sharedFiles.includes(path));
    const observed=observationCandidate(observationPolicy,{name,verifyJwt:config.verifyJwt,
      frontendFingerprint,closure:importClosure,
      readRaw:path=>execFileSync('git',['-C',repositoryRoot,'show',`${targetSha}:${path}`],{maxBuffer:4*1024*1024})});
    result.functions[name] = {
      baselineSha: receipt?.sha ?? null,
      baselineSource: receipt?.source ?? "missing",
      targetHasEntrypoint,
      // A target predating this function must retain the existing receipt rather
      // than being forced to deploy source it does not contain. A present target
      // without a receipt remains changed and therefore manual-only.
      changed: targetHasEntrypoint && !observed && (receipt?.sha ? directFiles.length > 0 || sharedFiles.length > 0 || dependencyFiles.length > 0 : true),
      ...(observed?{observedSource:observed}:{}),
      directFiles,
      sharedFiles,
      dependencyFiles,
      sharedImportClosure: {
        status: importClosure.complete ? "complete" : "conservative",
        reachableFiles: importClosure.files,
        reason: importClosure.reason,
      },
      retainedCompatibility: config.retainedFrontendCompatibility
        ? inspectRetainedCompatibility(repositoryRoot, receipt?.sha ?? null, config.retainedFrontendCompatibility)
        : null,
    };
  }
  return result;
}

export function buildDeploymentPlan({
  event,
  componentDiffs,
  selected = [],
  deployFrontend = false,
  forceFrontendRedeploy = false,
  manifest,
  targetSha,
  contractSelection,
}) {
  if (!new Set(["push", "workflow_dispatch"]).has(event)) throw new Error(`unsupported event: ${event}`);
  if (forceFrontendRedeploy && event !== "workflow_dispatch") {
    throw new Error("forced frontend recovery is only allowed for workflow_dispatch");
  }
  if (forceFrontendRedeploy && !deployFrontend) {
    throw new Error("forced frontend recovery requires frontend deployment selection");
  }
  if (forceFrontendRedeploy && componentDiffs.frontend.changed) {
    throw new Error("forced frontend recovery is only allowed when the frontend is unchanged from its receipt");
  }
  if (!contractSelection?.profile
      || !/^sha256:[0-9a-f]{64}$/.test(contractSelection.sourceFingerprint ?? "")
      || !contractSelection.evidence
      || typeof contractSelection.evidence !== "object"
      || !contractSelection.requirements
      || typeof contractSelection.requirements !== "object") {
    throw new Error("target source contract profile evidence is required");
  }
  const uniqueSelected = [...new Set(selected.filter(Boolean))].sort();
  if (uniqueSelected.length !== selected.filter(Boolean).length) throw new Error("selected functions must not repeat");

  const criticalChanged = Object.entries(manifest.functions)
    .filter(([name, config]) => config.critical && componentDiffs.functions[name]?.changed)
    .map(([name]) => name)
    .sort();
  const requiredForFrontend = criticalChanged.filter((name) => {
    const requirement = manifest.functions[name].frontendRequirement;
    return !requirement || contractSelection.requirements[requirement] === true;
  });
  const retainedForFrontend = Object.entries(manifest.functions)
    .filter(([, config]) => config.retainedFrontendCompatibility
      && contractSelection.requirements[config.retainedFrontendCompatibility.whenTargetRequirement] !== true)
    .map(([name]) => name)
    .sort();
  const missingRetainedForFrontend = retainedForFrontend
    .filter((name) => componentDiffs.functions[name]?.retainedCompatibility?.satisfied !== true);
  const sharedChanged = criticalChanged.some((name) => componentDiffs.functions[name].sharedFiles.length > 0)
    || Object.values(componentDiffs.functions).some((diff) => diff.sharedFiles.length > 0);

  if (event === "push") {
    const frontendChanged = componentDiffs.frontend.changed;
    const frontendHeld = frontendChanged
      && (!componentDiffs.frontend.baselineSha
        || missingRetainedForFrontend.length > 0
        || requiredForFrontend.length > 0);
    return enrichPlan({
      targetSha,
      event,
      manifest,
      componentDiffs,
      criticalFunctions: [],
      criticalChanged,
      requiredForFrontend,
      retainedForFrontend,
      missingRetainedForFrontend,
      frontend: frontendChanged && !frontendHeld,
      frontendHeld,
      frontendReason: !frontendChanged
        ? "frontend_unchanged_from_receipt"
        : frontendHeld
          ? !componentDiffs.frontend.baselineSha
            ? "frontend_receipt_missing"
            : missingRetainedForFrontend.length > 0
              ? "retained_compatibility_missing"
              : "critical_dependencies_held"
          : "frontend_diff_verified",
      sharedChanged,
      contractSelection,
    });
  }

  for (const name of uniqueSelected) {
    const config = manifest.functions[name];
    if (!config?.critical) throw new Error(`manual critical deployment is not allowed for ${name}`);
    if (!componentDiffs.functions[name]?.changed) {
      throw new Error(`selected function ${name} is unchanged from its last successful deployment receipt`);
    }
  }

  const incompatibleHistoricalSelections = uniqueSelected.filter((name) => retainedForFrontend.includes(name));
  if (incompatibleHistoricalSelections.length > 0) {
    throw new Error(
      `historical target must retain the compatible deployed Edge receipt instead of deploying: ${incompatibleHistoricalSelections.join(", ")}`,
    );
  }

  if (deployFrontend && !componentDiffs.frontend.changed && !forceFrontendRedeploy) {
    throw new Error("frontend deployment was selected but frontend is unchanged from its last successful deployment receipt");
  }
  if (deployFrontend) {
    if (missingRetainedForFrontend.length > 0) {
      throw new Error(
        `frontend requires retained deployed compatibility evidence before this historical target: ${missingRetainedForFrontend.join(", ")}`,
      );
    }
    const missing = requiredForFrontend.filter((name) => !uniqueSelected.includes(name));
    if (missing.length > 0) {
      throw new Error(`frontend requires all changed critical functions to deploy first: ${missing.join(", ")}`);
    }
  }
  if (uniqueSelected.length === 0 && !deployFrontend) {
    throw new Error("manual dispatch must select at least one changed critical function or changed frontend");
  }

  return enrichPlan({
    targetSha,
    event,
    manifest,
    componentDiffs,
    criticalFunctions: uniqueSelected,
    criticalChanged,
    requiredForFrontend,
    retainedForFrontend,
    missingRetainedForFrontend,
    frontend: deployFrontend,
    frontendHeld: false,
    frontendReason: deployFrontend
      ? forceFrontendRedeploy ? "explicit_receipt_target_recovery" : "critical_dependencies_selected"
      : "not_selected",
    forceFrontendRedeploy,
    sharedChanged,
    contractSelection,
  });
}

function enrichPlan(plan) {
  const resolvedContracts = resolveTargetContracts(plan.manifest, plan.contractSelection);
  const functions = Object.fromEntries(Object.entries(plan.componentDiffs.functions).map(([name, diff]) => [name, {
    ...diff,
    selected: plan.criticalFunctions.includes(name),
    held: diff.changed && !plan.criticalFunctions.includes(name),
    verifyJwt: plan.manifest.functions[name].verifyJwt,
    contractCount: resolvedContracts.functions[name].length,
    denoTests: [
      ...(plan.manifest.functions[name].quality?.denoTests ?? []),
      ...(plan.manifest.functions[name].quality?.denoTestsByContractProfile?.[plan.contractSelection.profile] ?? []),
    ],
  }]));
  return {
    targetSha: plan.targetSha,
    event: plan.event,
    criticalFunctions: plan.criticalFunctions,
    noncriticalFunctions: [],
    criticalChanged: plan.criticalChanged,
    observedForFrontend: Object.entries(plan.componentDiffs.functions).filter(([,diff])=>diff.observedSource).map(([name])=>name).sort(),
    requiredForFrontend: plan.requiredForFrontend,
    retainedForFrontend: plan.retainedForFrontend,
    missingRetainedForFrontend: plan.missingRetainedForFrontend,
    frontend: plan.frontend,
    frontendHeld: plan.frontendHeld,
    frontendReason: plan.frontendReason,
    forceFrontendRedeploy: plan.forceFrontendRedeploy === true,
    sharedChanged: plan.sharedChanged,
    contractProfile: plan.contractSelection.profile,
    contractSourceFingerprint: plan.contractSelection.sourceFingerprint,
    contractProfileEvidence: plan.contractSelection.evidence,
    targetRequirements: plan.contractSelection.requirements,
    components: {
      frontend: {
        ...plan.componentDiffs.frontend,
        contractCount: resolvedContracts.frontend.length,
        vitest: plan.manifest.frontend.quality.vitest,
      },
      functions,
    },
  };
}

export function renderPlanSummary(plan) {
  const rows = Object.entries(plan.components.functions)
    .filter(([, item]) => item.changed || item.selected || item.observedSource)
    .map(([name, item]) => `| Edge ${name} | ${item.baselineSha ?? "MISSING"} | ${item.directFiles.length} | ${item.sharedFiles.length} | ${(item.dependencyFiles ?? []).length} | ${item.observedSource ? "observed candidate; fresh verification required; source unknown" : item.selected ? "selected" : "held"} | ${item.verifyJwt ? "verify" : "no-verify"} | ${item.contractCount} |`);
  const fullDiffs = [
    ["Frontend", plan.components.frontend.baselineSha, plan.components.frontend.files],
    ...Object.entries(plan.components.functions)
      .filter(([, item]) => item.changed || item.selected || item.observedSource)
      .map(([name, item]) => [`Edge ${name}`, item.baselineSha, [...item.directFiles, ...item.sharedFiles, ...(item.dependencyFiles ?? [])]]),
  ].flatMap(([label, baselineSha, files]) => [
    `<details><summary>${label} full diff</summary>`,
    "",
    baselineSha
      ? (files.length > 0 ? files.map((file) => `- \`${file}\``).join("\n") : "- No changed files")
      : "- Receipt missing; component is treated as changed until a successful receipt exists.",
    "",
    "</details>",
    "",
  ]);
  const quality = Object.entries(plan.components.functions)
    .filter(([name]) => plan.criticalFunctions.includes(name))
    .flatMap(([name, item]) => item.denoTests.map((test) => `- Edge \`${name}\`: \`deno test ${test}\``));
  if (plan.frontend) {
    quality.push("- Frontend: `npm ci --ignore-scripts` and `npm run build`");
    quality.push(...plan.components.frontend.vitest.map((test) => `- Frontend: \`vitest run ${test}\``));
  }
  return [
    "## Deployment control-plane plan",
    "",
    `- Target SHA: \`${plan.targetSha}\``,
    `- Target contract profile: \`${plan.contractProfile}\``,
    `- Contract source fingerprint: \`${plan.contractSourceFingerprint}\``,
    `- Target requirements: \`${Object.entries(plan.targetRequirements)
      .map(([name, enabled]) => `${name}=${enabled}`)
      .join(",")}\``,
    `- Event: \`${plan.event}\``,
    `- Frontend baseline: \`${plan.components.frontend.baselineSha ?? "MISSING"}\``,
    `- Frontend diff files: \`${plan.components.frontend.files.length}\``,
    `- Frontend decision: \`${plan.frontend ? "selected" : plan.frontendHeld ? "held" : "not selected"}\` (\`${plan.frontendReason}\`)`,
    `- Explicit frontend receipt recovery: \`${plan.forceFrontendRedeploy}\``,
    `- Required critical Edge before frontend: \`${plan.requiredForFrontend.join(",") || "none"}\``,
    `- Required retained Edge compatibility: \`${plan.retainedForFrontend.join(",") || "none"}\``,
    `- Missing retained compatibility evidence: \`${plan.missingRetainedForFrontend.join(",") || "none"}\``,
    `- Shared source changed: \`${plan.sharedChanged}\``,
    `- Profile evidence: \`${Object.entries(plan.contractProfileEvidence)
      .filter(([, files]) => files.length > 0)
      .map(([name, files]) => `${name}=${files.join("|")}`)
      .join("; ")}\``,
    "",
    "| Component | Receipt baseline | Direct diff | Shared diff | Imported dependency diff | Decision | JWT | Contracts |",
    "|---|---:|---:|---:|---:|---|---|---:|",
    ...rows,
    "",
    "### Full receipt-to-target diffs",
    "",
    ...fullDiffs,
    "### Planned quality gates",
    "",
    ...(quality.length > 0 ? quality : ["- No deployable component selected."]),
    "- Live contract probes must pass before protected-environment approval.",
  ].join("\n");
}

function writeOutputs(path, plan) {
  const lines = [
    `critical_functions=${JSON.stringify(plan.criticalFunctions)}`,
    `noncritical_functions=[]`,
    `critical_changed=${JSON.stringify(plan.criticalChanged)}`,
    `observed_for_frontend=${JSON.stringify(plan.observedForFrontend)}`,
    `required_critical_for_frontend=${JSON.stringify(plan.requiredForFrontend)}`,
    `retained_for_frontend=${JSON.stringify(plan.retainedForFrontend)}`,
    `missing_retained_for_frontend=${JSON.stringify(plan.missingRetainedForFrontend)}`,
    `frontend=${String(plan.frontend)}`,
    `frontend_held=${String(plan.frontendHeld)}`,
    `frontend_reason=${plan.frontendReason}`,
    `force_frontend_redeploy=${String(plan.forceFrontendRedeploy)}`,
    `shared_changed=${String(plan.sharedChanged)}`,
    `contract_profile=${plan.contractProfile}`,
    `contract_source_fingerprint=${plan.contractSourceFingerprint}`,
    `target_requirements=${JSON.stringify(plan.targetRequirements)}`,
    `target_sha=${plan.targetSha}`,
  ];
  appendFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const event = args.get("event");
  const repositoryRoot = args.get("repository");
  const sha = args.get("sha");
  const baselinesPath = args.get("baselines");
  const outputPath = args.get("github-output");
  const planPath = args.get("plan-json");
  const summaryPath = args.get("summary");
  const selected = (args.get("selected") ?? "").split(",").filter(Boolean);
  const deployFrontend = args.get("deploy-frontend") === "true";
  const forceFrontendRedeploy = args.get("force-frontend-redeploy") === "true";
  if (!event || !repositoryRoot || !sha || !baselinesPath || !outputPath || !planPath) {
    throw new Error("event, repository, sha, baselines, github-output and plan-json are required");
  }

  const manifest = loadDeploymentManifest();
  const baselines = JSON.parse(readFileSync(baselinesPath, "utf8"));
  const componentDiffs = buildComponentDiffs({ repositoryRoot, targetSha: sha, baselines, manifest,
    observationPolicy:args.get('verified-observations')==='true'?loadObservationPolicy():null });
  const contractSelection = selectTargetContractProfile({ targetRoot: repositoryRoot });
  const plan = buildDeploymentPlan({
    event,
    componentDiffs,
    selected,
    deployFrontend,
    forceFrontendRedeploy,
    manifest,
    targetSha: sha,
    contractSelection,
  });
  writeOutputs(outputPath, plan);
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  if (summaryPath) appendFileSync(summaryPath, `${renderPlanSummary(plan)}\n`, "utf8");
  console.log(JSON.stringify({ targetSha: sha, criticalFunctions: plan.criticalFunctions, frontend: plan.frontend }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
