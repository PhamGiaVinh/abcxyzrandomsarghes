import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function selectCashierSchemaMode(pages) {
  assert.ok(Array.isArray(pages) && pages.length > 0, 'PR file pages required');
  assert.ok(pages.every(Array.isArray), 'PR file pages malformed');
  const files = pages.flat();
  assert.ok(files.length > 0, 'PR files required');
  const prefixes = ['VinPoker/supabase/migrations/', 'VinPoker/supabase/migration-archive/', 'VinPoker/supabase/pending-migrations/'];
  let historical = false;
  for (const file of files) {
    assert.ok(file && typeof file.filename === 'string' && file.filename.length > 0, 'PR filename required');
    assert.ok(file.previous_filename === undefined || typeof file.previous_filename === 'string', 'PR previous filename malformed');
    for (const path of [file.filename, file.previous_filename].filter(Boolean)) {
      if (prefixes.some(prefix => path.startsWith(prefix))) historical = true;
    }
  }
  return historical ? 'pre03' : 'current';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(selectCashierSchemaMode(JSON.parse(readFileSync(0, 'utf8'))));
}
