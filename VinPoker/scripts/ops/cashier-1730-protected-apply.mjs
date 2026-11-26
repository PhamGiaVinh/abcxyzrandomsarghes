import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildAtomicMigrationQuery, canonicalSqlText } from './ops-1359-release-gate.mjs';
import { psqlEnvironment, receiptSql, validateContext } from './floor-37-47-protected-apply.mjs';

export const sourceSha = '47bf50e95126b6b25e94b0075efb3274a13d5e96';
const item = {
  action: 'APPLY',
  version: '20261121055644',
  name: 'multiday_prize_cash_drawer_v1',
  hash: '886f612574e9dad17942f9359c7ceddb0aba715f2e757a78767c99a810dcf57f',
};
const hash = value => createHash('sha256').update(value).digest('hex');

export function prepare1730(root) {
  const source = canonicalSqlText(readFileSync(resolve(root, 'supabase/pending-migrations', item.version + '_' + item.name + '.sql')));
  assert.equal(hash(source), item.hash, 'Reviewed migration differs');
  const atomic = buildAtomicMigrationQuery(item, source);
  assert.equal(hash(atomic), '4933ccee5d82fe4f7478ccce9dec2c0bca6cc2a18e9e2b0e503d2d4da71e6e38', 'Atomic SQL differs');
  return atomic;
}

const catalogSql = () => `
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT json_build_object(
  'database', current_database(), 'actor', current_user,
  'ledgerCount', (SELECT count(*) FROM supabase_migrations.schema_migrations
    WHERE version='${item.version}' OR name='${item.name}'),
  'fenceHash', (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc
    WHERE oid=to_regprocedure('private.multi_day_payout_source_fence_v1()')),
  'verifier', to_regprocedure('private.is_verified_multi_day_payment_v1(public.tournament_prize_payments)') IS NOT NULL,
  'legacyChecks', (SELECT count(*) FROM pg_constraint
    WHERE conrelid='public.cashier_buyin_movements'::regclass AND convalidated
      AND conname IN ('cashier_movement_shape','cashier_buyin_movements_purpose_check')),
  'drawerFunction', (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc
    WHERE oid=to_regprocedure('private.cashier_record_prize_drawer_outflow_v1()')),
  'shiftSummary', (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc
    WHERE oid=to_regprocedure('public.cashier_shift_summary_v1(uuid)')),
  'rangeSummary', (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc
    WHERE oid=to_regprocedure('public.cashier_cashflow_range_v1(uuid,timestamptz,timestamptz)')),
  'columnPresent', EXISTS (SELECT FROM pg_attribute
    WHERE attrelid='public.cashier_buyin_movements'::regclass AND attname='prize_payment_id'
      AND attnum>0 AND NOT attisdropped),
  'indexPresent', to_regclass('public.cashier_movement_prize_payment_unique') IS NOT NULL,
  'indexValid', EXISTS (SELECT FROM pg_index
    WHERE indexrelid=to_regclass('public.cashier_movement_prize_payment_unique')
      AND indisunique AND indisvalid),
  'triggerPresent', EXISTS (SELECT FROM pg_trigger
    WHERE tgrelid='public.tournament_prize_payments'::regclass AND tgname='cashier_prize_drawer_outflow'),
  'triggerEnabled', EXISTS (SELECT FROM pg_trigger
    WHERE tgrelid='public.tournament_prize_payments'::regclass AND tgname='cashier_prize_drawer_outflow'
      AND tgenabled='O' AND tgfoid=to_regprocedure('private.cashier_record_prize_drawer_outflow_v1()'))
);
COMMIT;`;
export function apply1730(atomic, transport, report) {
  const pre = transport.json(catalogSql());
  assert.ok(pre?.database === 'postgres' && pre.actor === 'postgres' && pre.ledgerCount === 0 &&
    pre.fenceHash === '442f372d4edb76d720a21cbcd000266d' && pre.verifier === true &&
    pre.legacyChecks === 2 && pre.drawerFunction === null && pre.columnPresent === false &&
    pre.indexPresent === false && pre.triggerPresent === false, 'Cashier 1730 preflight differs');
  try {
    transport.execute(atomic);
  } catch {
    let outcome = 'unknown';
    try {
      const receipt = transport.json(receiptSql(item));
      outcome = receipt.count === 1 && receipt.exact === true ? 'committed-exact' : receipt.count === 0 ? 'not-recorded' : 'drift';
    } catch { /* Database outcome stays unknown. */ }
    report('CASHIER1730_STOP receipt=' + outcome);
    throw new Error('Cashier 1730 apply outcome requires review');
  }
  const receipt = transport.json(receiptSql(item));
  assert.ok(receipt.count === 1 && receipt.exact === true, 'Cashier 1730 exact receipt differs');
  const post = transport.json(catalogSql());
  assert.ok(post.ledgerCount === 1 && post.columnPresent === true && post.indexValid === true &&
    post.triggerEnabled === true && post.fenceHash === '1da6ba42509a0677f12276345d4ea36d' &&
    post.drawerFunction === 'a3b81f02c6afbcaedeb0075551c2dff6' &&
    post.shiftSummary === '1e782ef7572000335d88f2982b0a6a28' &&
    post.rangeSummary === '6e50425deb32527e1784a56ecc88307e', 'Cashier 1730 deployed catalog differs');
  report('CASHIER1730_COMMITTED_EXACT_AND_POSTCHECK_PASS');
}
function main() {
  const mode = process.argv[2];
  assert.ok(mode === 'verify-source' || mode === 'apply');
  const env = process.env;
  const root = resolve(env.RELEASE_SOURCE_ROOT);
  const revision = path => execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(revision(root), sourceSha);
  const atomic = prepare1730(root);
  if (mode === 'verify-source') {
    console.log('CASHIER1730_SOURCE_AND_ATOMIC_HASH_PASS');
    return;
  }
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(env.GITHUB_REPOSITORY, 'PhamGiaVinh/abcxyzrandomsarghes');
  assert.equal(env.RELEASE_SHA, sourceSha);
  assert.equal(env.CONFIRM_CASHIER_1730, 'APPLY_CASHIER_1730_' + sourceSha);
  assert.equal(revision(process.cwd()), env.GITHUB_SHA);
  const receipt = JSON.parse(readFileSync(env.RECOVERY_RECEIPT_PATH, 'utf8'));
  validateContext(env, receipt);
  assert.equal(receipt.databaseOwnerAndEffectiveAclMatch, true);
  const query = sql => {
    const p = spawnSync('psql', ['-X','-qAt','-v','ON_ERROR_STOP=1'], {
      input: sql, encoding: 'utf8', env: psqlEnvironment(env), timeout: 150_000, maxBuffer: 512_000,
    });
    if (p.error || p.status !== 0) throw new Error('Private PostgreSQL command failed');
    return p.stdout.trim();
  };
  apply1730(atomic, { execute: query, json: sql => JSON.parse(query(sql)) }, console.log);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); }
  catch { console.error('CASHIER1730_STOP inspect reviewed receipt before any retry'); process.exitCode = 1; }
}
