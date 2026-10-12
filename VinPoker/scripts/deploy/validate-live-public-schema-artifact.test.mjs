import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  sanitizeSchemaArtifactSql,
  schemaArtifactProblems,
  validateArtifactDirectory,
  validateOperationsRecoveryProvenance,
} from "./validate-live-public-schema-artifact.mjs";

test("Operations recovered snapshot is bound to original capture and exact recovery run",()=>{
  const provenance={originalCaptureRun:37820347781,originalCaptureSha:"0463831bb9f8f142d585fd51c1b0633963b2161f",
    schemaSha256:"d23cfa75a7381453ba0d6216346f6460c816a3b1525ef5d47984c3a995ddc56a",schemaOnly:true,recoveryRun:"38275767630"};
  assert.equal(validateOperationsRecoveryProvenance(provenance,"38275767630"),true);
  for (const patch of [{originalCaptureRun:37229283609},{originalCaptureSha:"09cff8a829caf3f514a615b231ab96f4ed238757"},
    {schemaSha256:"a".repeat(64)},{schemaOnly:false},{recoveryRun:"38275767631"},{extra:"unexpected"}]) {
    assert.throws(()=>validateOperationsRecoveryProvenance({...provenance,...patch},"38275767630"),/operations_recovery_provenance_rejected/);
  }
  for (const invalid of [null,[],{},"private content"])
    assert.throws(()=>validateOperationsRecoveryProvenance(invalid,"38275767630"),/operations_recovery_provenance_rejected/);
  assert.throws(()=>validateOperationsRecoveryProvenance(provenance,"not-a-run"),/operations_recovery_provenance_rejected/);
});

const safeSchema = `
-- INSERT INTO comments must not be interpreted as data.
create table public.example (id uuid primary key);
create function public.example_fn() returns void language plpgsql as $$
begin
  insert into public.example values ('00000000-0000-0000-0000-000000000000');
end;
$$;
`;

function writeArtifact({ schema = safeSchema, checksum = null, extraFile = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "vinpoker-schema-artifact-"));
  const actualChecksum = createHash("sha256").update(schema).digest("hex");
  writeFileSync(join(directory, "live-public-schema.sql"), schema);
  writeFileSync(join(directory, "live-public-schema.sha256"), `${checksum ?? actualChecksum}  live-public-schema.sql\n`);
  if (extraFile) writeFileSync(join(directory, "unexpected.txt"), "x");
  return directory;
}

test("CLI cannot skip recovery verification with missing flags or relabel a safe different snapshot",()=>{
  const directory=writeArtifact();
  const metadataDirectory=mkdtempSync(join(tmpdir(),"vinpoker-schema-provenance-"));
  const provenancePath=join(metadataDirectory,"provenance.json");
  const provenance={originalCaptureRun:37820347781,originalCaptureSha:"0463831bb9f8f142d585fd51c1b0633963b2161f",
    schemaSha256:"d23cfa75a7381453ba0d6216346f6460c816a3b1525ef5d47984c3a995ddc56a",schemaOnly:true,recoveryRun:"38275767630"};
  const run=args=>spawnSync(process.execPath,[fileURLToPath(new URL("./validate-live-public-schema-artifact.mjs",import.meta.url)),
    "--artifact-directory",directory,...args],{encoding:"utf8",timeout:5000});
  try {
    for (const args of [["--operations-recovery-provenance"],["--recovery-run-id"],
      ["--recovery-run-id","38275767630"]]) {
      const missing=run(args); assert.notEqual(missing.status,0);
      assert.match(missing.stderr,/operations_recovery_provenance_rejected/);
    }
    writeFileSync(provenancePath,JSON.stringify(provenance));
    const differentBytes=run(["--operations-recovery-provenance",provenancePath,"--recovery-run-id","38275767630"]);
    assert.notEqual(differentBytes.status,0); assert.match(differentBytes.stderr,/operations_recovery_bytes_rejected/);
    writeFileSync(provenancePath,"untrusted private metadata must not appear in errors");
    const malformed=run(["--operations-recovery-provenance",provenancePath,"--recovery-run-id","38275767630"]);
    assert.notEqual(malformed.status,0); assert.match(malformed.stderr,/operations_recovery_provenance_rejected/);
    assert.doesNotMatch(malformed.stderr,/untrusted private metadata/);
  } finally {
    rmSync(directory,{recursive:true,force:true});
    rmSync(metadataDirectory,{recursive:true,force:true});
  }
});

test("schema artifact scanner ignores comments and quoted function bodies", () => {
  assert.deepEqual(schemaArtifactProblems(safeSchema), []);
});

test("schema artifact scanner rejects top-level data commands", () => {
  assert.deepEqual(schemaArtifactProblems(`${safeSchema}\ninsert into public.example values ('x');`), ["top_level_data_statement"]);
  assert.deepEqual(schemaArtifactProblems(`${safeSchema}\ncopy public.example from stdin;`), ["copy_from_stdin"]);
});

test("schema artifact scanner rejects secret and fixture data indicators without echoing values", () => {
  const fakeEmail = ["test", "example.invalid"].join("@");
  const fakePhone = `+84${"912345678"}`;
  const fakeJwt = `eyJ${"a".repeat(11)}.${"b".repeat(11)}.${"c".repeat(11)}`;
  const fakeSupabaseKey = `sb_secret_${"d".repeat(16)}`;
  const problems = schemaArtifactProblems(`${safeSchema}\n-- ${fakeEmail}\n-- ${fakePhone}\n-- ${fakeJwt}\n-- ${fakeSupabaseKey}`);
  assert.deepEqual(problems, ["sensitive_jwt_like", "sensitive_supabase_key", "sensitive_email", "sensitive_phone"]);
});

test("schema artifact sanitizer removes sensitive literals before the private artifact is checksummed", () => {
  const fakeEmail = ["operator", "example.invalid"].join("@");
  const fakeJwt = `eyJ${"a".repeat(11)}.${"b".repeat(11)}.${"c".repeat(11)}`;
  const rawSchema = [
    safeSchema,
    "create function public.literal_fixture() returns text language sql as $$",
    `select '${fakeEmail}:${fakeJwt}'`,
    "$$;",
  ].join("\n");

  const { sanitizedSql, redactionCount } = sanitizeSchemaArtifactSql(rawSchema);
  assert.equal(redactionCount, 2);
  assert.deepEqual(schemaArtifactProblems(sanitizedSql), []);
  assert.match(sanitizedSql, /redacted_email:redacted_jwt/);
  assert.doesNotMatch(sanitizedSql, /operator@example\.invalid/);
  assert.doesNotMatch(sanitizedSql, /eyJ[a-zA-Z0-9_.-]{20,}/);
});

test("schema artifact validator requires the exact two-file checksummed artifact", () => {
  const directory = writeArtifact();
  try {
    assert.deepEqual(validateArtifactDirectory(directory), {
      schemaSha256: createHash("sha256").update(safeSchema).digest("hex"),
      schemaOnly: true,
      secretsDetected: false,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schema artifact validator rejects checksum mismatch and extra files", () => {
  const checksumMismatch = writeArtifact({ checksum: "0".repeat(64) });
  const extraFile = writeArtifact({ extraFile: true });
  try {
    assert.throws(() => validateArtifactDirectory(checksumMismatch), /checksum mismatch/);
    assert.throws(() => validateArtifactDirectory(extraFile), /exactly/);
  } finally {
    rmSync(checksumMismatch, { recursive: true, force: true });
    rmSync(extraFile, { recursive: true, force: true });
  }
});
