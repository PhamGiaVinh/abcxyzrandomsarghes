import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContext, psqlEnvironment } from './floor-37-47-protected-apply.mjs';
import { classifyPreflight, preflightSql, executePackage } from './floor-manual-66-release-plan.mjs';

export function validateRelease(env, recovery, checkoutSha, mode) {
  if (!['plan', 'apply'].includes(mode)) throw Error('Protected plan|apply only');
  validateContext(env, recovery);
  if (checkoutSha !== env.RELEASE_SHA) throw Error('Checkout SHA differs');
  if (mode === 'apply' && env.CONFIRM_FLOOR_PACKAGE !== `APPLY_FLOOR_MANUAL_66_${env.RELEASE_SHA}`) throw Error('Exact66 confirmation missing');
}
function main() {
  const mode = process.argv[2];
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (head.status !== 0) throw Error('Checkout SHA unavailable');
  const recovery = JSON.parse(readFileSync(process.env.RECOVERY_RECEIPT_PATH, 'utf8'));
  validateRelease(process.env, recovery, head.stdout.trim(), mode);
  const query = sql => {
    const r = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
      input: sql, encoding: 'utf8', env: psqlEnvironment(process.env), maxBuffer: 2 * 1024 * 1024, timeout: 130000,
    });
    if (r.status !== 0) throw Error('psql failed; raw output withheld');
    return r.stdout.trim();
  };
  const transport = { execute: query, json: sql => JSON.parse(query(sql).split('\n').find(x => x.startsWith('{'))) };
  if (mode === 'plan') { classifyPreflight(transport.json(preflightSql())); console.log('EXACT66_PENDING'); return; }
  executePackage(transport, x => console.log(x));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {
    console.error('Protected Manual66 failed; inspect safe receipt evidence, do not retry blindly');
    process.exitCode = 1;
  }
}
