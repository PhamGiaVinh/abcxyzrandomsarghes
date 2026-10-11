import test from 'node:test';
import assert from 'node:assert/strict';
import { runHistoryCanary, validateCanaryContext, canaryPreflightSql, assertCanaryPreflight, assertCanaryPostcheck, cleanupOwnedHistoryCanary } from './tracker-history-canary-transport.mjs';

const hand = '7c0ab085-641e-408c-a326-e4addbcee647';
const sha = 'a'.repeat(40);
const env = { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: sha, TARGET_SHA: sha, SOURCE_CHECKOUT_SHA: sha,
  INITIAL_ACTOR: 'owner', TRIGGERING_ACTOR: 'owner', REPOSITORY_OWNER: 'owner',
  SUPABASE_PROJECT_REF: 'orlesggcjamwuknxwcpk', SUPABASE_ACCESS_TOKEN: 'fake-test-token',
  HAND_IDS: JSON.stringify([hand]), OWNER_ACK: `RUN_SCOPED_HISTORY_CANARY_${sha}` };
const key = 'TRACKER_HISTORY_CANARY_INTERNAL_SECRET';
const flag = 'TRACKER_HISTORY_COMPLETION_WORKER_ENABLED';
const preflight = [{ preflight: { all_rows_visible: true, active_history_jobs: 0, hands: [{
  id: hand, tournament_id: '5a51bec5-4da0-4dd9-861a-cc4e7678478c', tournament_name: 'TEST — Felt UAT (compact)',
  source_revision: 31, status: 'completed', is_voided: false,
  table_session_id: '89d70c57-f141-487a-a9f4-f9dc3d76c420', tournament_table_id: '2bc31827-03c8-4cbb-b332-eab2aa38e45c',
  queue_status: 'pending', due: true, unleased: true, source_fingerprint: 'a'.repeat(32), verified_outcomes: 0 }] } }];

function fixture({ existing = false, lostResponse = false, badResult = false, failCleanup = false,
  workerOn = false, dispatcherOn = false, lostProvision = false } = {}) {
  const calls = []; let enabled = workerOn; let secret = existing ? 'existing-test-only' : null; let committed = false;
  const fetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init.method ?? 'GET', body, auth: init.headers?.Authorization, redirect: init.redirect });
    if (url.startsWith('https://api.supabase.com/') && url.includes('/functions/'))
      return Response.json({ version: url.endsWith('-worker') ? 11 : 8, verify_jwt: false, status: 'ACTIVE' });
    if (url.endsWith('/database/query/read-only')) {
      const rows = structuredClone(preflight);
      if (committed) Object.assign(rows[0].preflight.hands[0], { queue_status: 'completed', verified_outcomes: 1 });
      return Response.json(rows, { status: 201 });
    }
    if (url.endsWith('/secrets')) {
      if (!init.method || init.method === 'GET') return Response.json(secret ? [{ name: key }] : []);
      if (init.method === 'DELETE') { secret = null; return Response.json({}); }
      for (const item of body) {
        if (item.name === key) {
          secret = item.value;
          if (lostProvision) throw Error(`provision response lost ${secret}`);
        }
        if (item.name === flag) {
          if (failCleanup && item.value === 'false') throw Error('fake-test-token private-network-error');
          enabled = item.value === 'true';
        }
      }
      return Response.json({}, { status: 201 });
    }
    if (url.endsWith('-dispatcher')) return dispatcherOn
      ? Response.json({ message: 'Unauthorized' }, { status: 401 })
      : Response.json({ code: 'dispatcher_disabled' }, { status: 404 });
    if (!enabled && (!secret || init.headers?.Authorization !== `Bearer ${secret}`)) return Response.json({ code: 'worker_disabled' }, { status: 404 });
    if (!init.headers?.Authorization) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    if (!body?.hand_ids) return Response.json({ code: 'hand_scope_required' }, { status: 400 });
    if (lostResponse) throw Error(`response lost ${secret}`);
    committed = true;
    return Response.json({ ok: true, claimed: badResult ? 99 : 1, completed: 1,
      retried: 0, needs_attention: 0, unresolved: 0 });
  };
  return { calls, fetchImpl, state: () => ({ enabled, secret }) };
}

test('protected owner/exact main/project and finite unique scope are mandatory before HTTP', () => {
  assert.deepEqual(validateCanaryContext(env), [hand]);
  for (const delta of [{ GITHUB_ACTIONS: 'false' }, { GITHUB_REF: 'refs/heads/pr' },
    { TARGET_SHA: 'b'.repeat(40) }, { SOURCE_CHECKOUT_SHA: 'b'.repeat(40) },
    { TRIGGERING_ACTOR: 'outsider' }, { INITIAL_ACTOR: 'outsider' },
    { SUPABASE_PROJECT_REF: 'other' }, { SUPABASE_ACCESS_TOKEN: '' },
    { OWNER_ACK: 'approved' }, { HAND_IDS: '[]' }, { HAND_IDS: JSON.stringify([hand, hand]) },
    { HAND_IDS: '["not-a-uuid"]' }, { HAND_IDS: '["11111111-1111-4111-8111-111111111111"]' }]) assert.throws(() => validateCanaryContext({ ...env, ...delta }));
});

test('DB scope is exact TEST tour/session/revision and cannot hide cron rows through RLS', () => {
  assertCanaryPreflight(preflight, [hand]);
  for (const delta of [{ all_rows_visible: false }, { active_history_jobs: 1 }, { active_history_jobs: null }, { hands: [] }, { hands: [null] }])
    assert.throws(() => assertCanaryPreflight([{ preflight: { ...preflight[0].preflight, ...delta } }], [hand]));
  for (const delta of [{ tournament_id: hand }, { tournament_name: 'Real tournament' },
    { source_revision: 32 }, { is_voided: true }, { table_session_id: hand },
    { tournament_table_id: hand }, { queue_status: 'processing' }, { due: false }, { unleased: false }])
    assert.throws(() => assertCanaryPreflight([{ preflight: { ...preflight[0].preflight,
      hands: [{ ...preflight[0].preflight.hands[0], ...delta }] } }], [hand]));
  assert.match(canaryPreflightSql([hand]), /cron\.job/);
  assert.throws(() => canaryPreflightSql(["';delete from public.tournaments;--"]));
});

test('memory-only credential invokes exactly selected hands and returns worker to OFF', async () => {
  const f = fixture();
  const result = await runHistoryCanary(env, { fetchImpl: f.fetchImpl });
  assert.equal(result.completed, 1);
  assert.deepEqual(f.state(), { enabled: false, secret: null });
  const scoped = f.calls.filter(c => c.url.endsWith('-worker') && c.body?.hand_ids);
  assert.equal(scoped.length, 1);
  assert.deepEqual(scoped[0].body, { hand_ids: [hand], limit: 1 });
  assert.notEqual(scoped[0].auth, `Bearer ${env.SUPABASE_ACCESS_TOKEN}`);
  assert.equal(JSON.stringify(result).includes('fake-test-token'), false);
  assert.equal(f.calls.every(c => c.redirect === 'error'), true);
  assert.equal(f.calls.some(c => c.body?.some?.(item => item.name === flag && item.value === 'true')), false);
  assert.equal(f.calls.some(c => c.method === 'DELETE' && c.body.includes('TRACKER_HISTORY_CANARY_ALLOWED_HAND_IDS')), true);
});

test('an existing canary credential is never overwritten or removed', async () => {
  const f = fixture({ existing: true });
  await assert.rejects(runHistoryCanary(env, { fetchImpl: f.fetchImpl }), /canary_secret_exists/);
  assert.equal(f.calls.some(c => c.url.endsWith('/secrets') && c.method !== 'GET'), false);
  assert.equal(f.state().secret, 'existing-test-only');
});

for (const fault of ['lostResponse', 'badResult']) test(`${fault}: no mutation retry, cleanup still runs`, async () => {
  const f = fixture({ [fault]: true });
  await assert.rejects(runHistoryCanary(env, { fetchImpl: f.fetchImpl }), /history_canary_/);
  assert.equal(f.calls.filter(c => c.url.endsWith('-worker') && c.body?.hand_ids).length, 1);
  assert.deepEqual(f.state(), { enabled: false, secret: null });
});

test('cleanup failure is not PASS, does not expose raw transport error, and still revokes temporary credential', async () => {
  const f = fixture({ failCleanup: true });
  await assert.rejects(runHistoryCanary(env, { fetchImpl: f.fetchImpl }), error =>
    error.message === 'history_canary_cleanup_failed' && !error.message.includes('fake-test-token'));
  assert.equal(f.state().secret, null);
});

for (const flag of ['workerOn', 'dispatcherOn']) test(`${flag}: abort before any secret or enable mutation`, async () => {
  const f = fixture({ [flag]: true });
  await assert.rejects(runHistoryCanary(env, { fetchImpl: f.fetchImpl }), /history_canary_not_disabled/);
  assert.equal(f.calls.some(c => c.url.endsWith('/secrets') && c.method !== 'GET'), false);
});

test('unknown secret-provision outcome gets cleanup without a second provision', async () => {
  const f = fixture({ lostProvision: true });
  await assert.rejects(runHistoryCanary(env, { fetchImpl: f.fetchImpl }), error => error.message === 'history_canary_provision_failed');
  assert.equal(f.calls.filter(c => c.body?.some?.(item => item.name === key)).length, 1);
  assert.deepEqual(f.state(), { enabled: false, secret: null });
});

test('ownership marker is emitted before first provisioning POST and contains no credential', async () => {
  const f = fixture(); let marked = false;
  await runHistoryCanary(env, { onProvisionAttempt: () => { marked = true; },
    fetchImpl: (url, init) => {
      if (url.endsWith('/secrets') && init.method === 'POST') assert.equal(marked, true);
      return f.fetchImpl(url, init);
    } });
  assert.equal(marked, true);
});

test('independent cleanup rejects other run/source owners before touching live configuration', async () => {
  const f = fixture({ workerOn: true, existing: true });
  const e = { ...env, GITHUB_RUN_ID: '123' };
  const marker = { runId: '123', sourceSha: sha, project: env.SUPABASE_PROJECT_REF };
  for (const delta of [{ runId: '124' }, { sourceSha: 'b'.repeat(40) }, { project: 'foreign' }]) {
    await assert.rejects(cleanupOwnedHistoryCanary(e, { ...marker, ...delta }, { fetchImpl: f.fetchImpl }), /invalid_cleanup_owner/);
  }
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await cleanupOwnedHistoryCanary(e, marker, { fetchImpl: f.fetchImpl }),
    { workerOff: true, temporaryCredentialRevoked: true });
  assert.deepEqual(f.state(), { enabled: false, secret: null });
});

for (const fault of ['edge-version', 'edge-jwt', 'db-visibility', 'db-revision']) {
  test(`${fault}: drift aborts before provisioning and never touches live flags`, async () => {
    const f = fixture();
    const fetchImpl = async (url, init) => {
      if (url.includes('/functions/') && url.startsWith('https://api.supabase.com/')) {
        if (fault === 'edge-version') return Response.json({ version: 999, verify_jwt: false, status: 'ACTIVE' });
        if (fault === 'edge-jwt') return Response.json({ version: 10, verify_jwt: true, status: 'ACTIVE' });
      }
      if (url.endsWith('/database/query/read-only') && fault.startsWith('db-')) {
        const rows = structuredClone(preflight);
        if (fault === 'db-visibility') rows[0].preflight.all_rows_visible = false;
        if (fault === 'db-revision') rows[0].preflight.hands[0].source_revision++;
        return Response.json(rows, { status: 201 });
      }
      return f.fetchImpl(url, init);
    };
    await assert.rejects(runHistoryCanary(env, { fetchImpl }), /history_canary_/);
    assert.equal(f.calls.some(c => c.url.endsWith('/secrets') && c.method !== 'GET'), false);
    assert.deepEqual(f.state(), { enabled: false, secret: null });
  });
}

test('failed ownership marker prevents provisioning rather than leaving an unowned secret', async () => {
  const f = fixture();
  await assert.rejects(runHistoryCanary(env, { fetchImpl: f.fetchImpl,
    onProvisionAttempt: () => { throw Error('history_canary_marker_failed'); } }), /marker_failed/);
  assert.equal(f.calls.some(c => c.url.endsWith('/secrets') && c.method !== 'GET'), false);
});

test('HTTP success cannot hide a changed source, pending lease, missing outcome or statistics mismatch', () => {
  const good = structuredClone(preflight);
  Object.assign(good[0].preflight.hands[0], { queue_status: 'completed', verified_outcomes: 1 });
  const stats = { completed: 1, needs_attention: 0 };
  assertCanaryPostcheck(good, preflight, stats, [hand]);
  for (const delta of [{ source_fingerprint: 'b'.repeat(32) }, { unleased: false },
    { queue_status: 'pending' }, { verified_outcomes: 0 }, { verified_outcomes: 2 }, { id: 'foreign' }]) {
    const bad = structuredClone(good);
    Object.assign(bad[0].preflight.hands[0], delta);
    assert.throws(() => assertCanaryPostcheck(bad, preflight, stats, [hand]), /postcheck_failed/);
  }
  assert.throws(() => assertCanaryPostcheck(good, preflight, { completed: 0, needs_attention: 1 }, [hand]), /postcheck_failed/);
});
