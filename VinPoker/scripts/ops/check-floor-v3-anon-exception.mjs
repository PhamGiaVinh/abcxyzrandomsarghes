#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function validateAnonExceptionRows(input, expectedSha256) {
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) return false;
  // A successful catalog scan can find no embedded tokens after cleanup.
  // The shell caller retains pipefail, so a failed scan cannot qualify here.
  if (input.trimEnd() === "") return true;
  const expectedRows = [
    "public.fn_dispatch_push()\t" + expectedSha256,
  ].sort().join("\n");
  const actualRows = input.trimEnd().split("\n").sort().join("\n");
  return actualRows === expectedRows;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fingerprint = process.argv[2] ?? "";
  const input = readFileSync(0, "utf8");
  if (!validateAnonExceptionRows(input, fingerprint)) {
    process.stderr.write(
      "Backup refused: token-bearing function signatures or fingerprints exceed the exact encrypted-backup exception\n",
    );
    process.exit(1);
  }
}
