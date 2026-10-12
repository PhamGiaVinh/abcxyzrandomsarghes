import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

const EXPECTED_SCHEMA_FILE = "live-public-schema.sql";
const EXPECTED_CHECKSUM_FILE = "live-public-schema.sha256";

// The raw protected dump can contain historical literals inside function bodies or
// comments. Keep those values off the artifact while preserving valid SQL around
// them for the disposable migration gate.
const SENSITIVE_LITERAL_PATTERNS = [
  ["jwt_like", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "redacted_jwt"],
  ["database_url", /\bpostgres(?:ql)?:\/\/[^\s'"`]+/gi, "redacted_database_url"],
  ["supabase_pat", /\bsbp_[A-Za-z0-9_-]{16,}\b/g, "redacted_supabase_pat"],
  ["supabase_key", /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}\b/gi, "redacted_supabase_key"],
  ["telegram_token", /\b\d{8,12}:[A-Za-z0-9_-]{20,}\b/g, "redacted_telegram_token"],
  ["vercel_token", /\b(?:vcp|vercel)_[A-Za-z0-9_-]{16,}\b/gi, "redacted_vercel_token"],
  ["email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "redacted_email"],
  ["phone", /(?<![\dA-Za-z])(?:\+?84|0)\d{9,10}(?!\d)/g, "redacted_phone"],
];

function codeOnlySql(sql) {
  let output = "";
  let index = 0;
  let state = "normal";
  let blockDepth = 0;
  let dollarTag = "";

  const blank = (character) => {
    output += character === "\n" ? "\n" : " ";
  };

  while (index < sql.length) {
    const character = sql[index];
    const next = sql[index + 1];

    if (state === "normal") {
      if (character === "-" && next === "-") {
        blank(character);
        blank(next);
        index += 2;
        state = "line_comment";
        continue;
      }
      if (character === "/" && next === "*") {
        blank(character);
        blank(next);
        index += 2;
        blockDepth = 1;
        state = "block_comment";
        continue;
      }
      if (character === "'") {
        blank(character);
        index += 1;
        state = "single_quote";
        continue;
      }
      if (character === '"') {
        blank(character);
        index += 1;
        state = "double_quote";
        continue;
      }
      if (character === "$") {
        const tag = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
        if (tag) {
          output += " ".repeat(tag.length);
          index += tag.length;
          dollarTag = tag;
          state = "dollar_quote";
          continue;
        }
      }
      output += character;
      index += 1;
      continue;
    }

    if (state === "line_comment") {
      blank(character);
      index += 1;
      if (character === "\n") state = "normal";
      continue;
    }

    if (state === "block_comment") {
      if (character === "/" && next === "*") {
        blank(character);
        blank(next);
        blockDepth += 1;
        index += 2;
        continue;
      }
      if (character === "*" && next === "/") {
        blank(character);
        blank(next);
        blockDepth -= 1;
        index += 2;
        if (blockDepth === 0) state = "normal";
        continue;
      }
      blank(character);
      index += 1;
      continue;
    }

    if (state === "single_quote") {
      blank(character);
      if (character === "'" && next === "'") {
        blank(next);
        index += 2;
      } else {
        index += 1;
        if (character === "'") state = "normal";
      }
      continue;
    }

    if (state === "double_quote") {
      blank(character);
      if (character === '"' && next === '"') {
        blank(next);
        index += 2;
      } else {
        index += 1;
        if (character === '"') state = "normal";
      }
      continue;
    }

    if (state === "dollar_quote") {
      if (sql.startsWith(dollarTag, index)) {
        output += " ".repeat(dollarTag.length);
        index += dollarTag.length;
        dollarTag = "";
        state = "normal";
      } else {
        blank(character);
        index += 1;
      }
    }
  }

  if (state === "line_comment") state = "normal";
  if (state !== "normal") throw new Error("schema SQL has an unterminated comment or quoted literal");
  return output;
}

function secretKinds(sql) {
  return SENSITIVE_LITERAL_PATTERNS
    .filter(([, pattern]) => {
      pattern.lastIndex = 0;
      return pattern.test(sql);
    })
    .map(([kind]) => kind);
}

export function sanitizeSchemaArtifactSql(sql) {
  let sanitizedSql = sql;
  let redactionCount = 0;

  for (const [, pattern, replacement] of SENSITIVE_LITERAL_PATTERNS) {
    pattern.lastIndex = 0;
    sanitizedSql = sanitizedSql.replace(pattern, () => {
      redactionCount += 1;
      return replacement;
    });
  }

  return { sanitizedSql, redactionCount };
}

export function schemaArtifactProblems(sql) {
  const code = codeOnlySql(sql);
  const problems = [];
  if (/(?:^|;)\s*COPY\b[\s\S]*?\bFROM\s+stdin\b/i.test(code)) problems.push("copy_from_stdin");
  if (/(?:^|;)\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(code)) problems.push("top_level_data_statement");
  for (const kind of secretKinds(sql)) problems.push(`sensitive_${kind}`);
  return problems;
}

export function validateArtifactDirectory(directory) {
  const resolvedDirectory = resolve(directory);
  const files = readdirSync(resolvedDirectory).sort();
  const expectedFiles = [EXPECTED_CHECKSUM_FILE, EXPECTED_SCHEMA_FILE];
  if (files.length !== expectedFiles.length || files.some((file, index) => file !== expectedFiles[index])) {
    throw new Error("schema artifact must contain exactly live-public-schema.sql and live-public-schema.sha256");
  }

  const schemaPath = resolve(resolvedDirectory, EXPECTED_SCHEMA_FILE);
  const checksumPath = resolve(resolvedDirectory, EXPECTED_CHECKSUM_FILE);
  const schema = readFileSync(schemaPath, "utf8");
  const expectedChecksum = readFileSync(checksumPath, "utf8").trim().match(/^([a-f0-9]{64})\s+\*?live-public-schema\.sql$/)?.[1];
  if (!expectedChecksum) throw new Error("schema artifact checksum file is invalid");

  const actualChecksum = createHash("sha256").update(schema).digest("hex");
  if (actualChecksum !== expectedChecksum) throw new Error("schema artifact checksum mismatch");

  const problems = schemaArtifactProblems(schema);
  if (problems.length) throw new Error(`schema artifact is unsafe: ${problems.join(",")}`);

  return { schemaSha256: actualChecksum, schemaOnly: true, secretsDetected: false };
}

const OPERATIONS_SCHEMA_SHA256="d23cfa75a7381453ba0d6216346f6460c816a3b1525ef5d47984c3a995ddc56a";
export function validateOperationsRecoveryProvenance(provenance, expectedRun) {
  if (!provenance || typeof provenance!=="object" || Array.isArray(provenance)
    || Object.keys(provenance).sort().join()!=="originalCaptureRun,originalCaptureSha,recoveryRun,schemaOnly,schemaSha256"
    || !/^\d+$/.test(expectedRun??"") || typeof expectedRun!=="string"
    || provenance.originalCaptureRun!==37820347781
    || provenance.originalCaptureSha!=="0463831bb9f8f142d585fd51c1b0633963b2161f"
    || provenance.schemaSha256!==OPERATIONS_SCHEMA_SHA256
    || provenance.schemaOnly!==true || provenance.recoveryRun!==expectedRun) {
    throw new Error("operations_recovery_provenance_rejected");
  }
  return true;
}

function readArgument(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1] ?? null;
}

function run() {
  const artifactDirectory = readArgument(process.argv.slice(2), "--artifact-directory");
  if (!artifactDirectory) throw new Error("--artifact-directory is required");
  const result = validateArtifactDirectory(artifactDirectory);
  const provenancePath=readArgument(process.argv.slice(2),"--operations-recovery-provenance");
  const recoveryRun=readArgument(process.argv.slice(2),"--recovery-run-id");
  if (process.argv.includes("--operations-recovery-provenance") || process.argv.includes("--recovery-run-id")) {
    let provenance;
    try { provenance=JSON.parse(readFileSync(provenancePath,"utf8")); }
    catch { throw new Error("operations_recovery_provenance_rejected"); }
    validateOperationsRecoveryProvenance(provenance,recoveryRun);
    if (result.schemaSha256!==OPERATIONS_SCHEMA_SHA256) throw new Error("operations_recovery_bytes_rejected");
  }
  console.log(JSON.stringify({
    artifact_name: "live-public-schema",
    schema_sha256: result.schemaSha256,
    schema_only: result.schemaOnly,
    secrets_detected: result.secretsDetected,
  }));
}

if (process.argv[1] && basename(process.argv[1]) === "validate-live-public-schema-artifact.mjs") {
  try {
    run();
  } catch (error) {
    console.error(`SCHEMA_ARTIFACT_REJECTED: ${error instanceof Error ? error.message : "unknown_error"}`);
    process.exitCode = 1;
  }
}
