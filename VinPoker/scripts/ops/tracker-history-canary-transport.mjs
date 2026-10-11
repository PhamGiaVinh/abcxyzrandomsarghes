import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT = 'orlesggcjamwuknxwcpk';
const SECRET = 'TRACKER_HISTORY_CANARY_INTERNAL_SECRET';
const SCOPE = 'TRACKER_HISTORY_CANARY_ALLOWED_HAND_IDS';
const ENABLE = 'TRACKER_HISTORY_COMPLETION_WORKER_ENABLED';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOUR = '5a51bec5-4da0-4dd9-861a-cc4e7678478c';
const SESSION = '89d70c57-f141-487a-a9f4-f9dc3d76c420';
const TABLE = '2bc31827-03c8-4cbb-b332-eab2aa38e45c';
const REVIEWED_HANDS = new Set(['7c0ab085-641e-408c-a326-e4addbcee647', 'd469154e-e80e-4a75-8a87-237b7958671a']);

export function validateCanaryContext(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REF !== 'refs/heads/main'
    || !/^[a-f0-9]{40}$/.test(env.TARGET_SHA ?? '')
    || env.TARGET_SHA !== env.GITHUB_SHA || env.TARGET_SHA !== env.SOURCE_CHECKOUT_SHA
    || !env.REPOSITORY_OWNER || env.INITIAL_ACTOR !== env.REPOSITORY_OWNER
    || env.TRIGGERING_ACTOR !== env.REPOSITORY_OWNER
    || env.SUPABASE_PROJECT_REF !== PROJECT || !env.SUPABASE_ACCESS_TOKEN
    || env.OWNER_ACK !== `RUN_SCOPED_HISTORY_CANARY_${env.TARGET_SHA}`) {
    throw Error('history_canary_invalid_context');
  }
  let ids;
  try { ids = JSON.parse(env.HAND_IDS); } catch { throw Error('history_canary_invalid_scope'); }
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 3
    || ids.some(id => typeof id !== 'string' || !UUID.test(id) || !REVIEWED_HANDS.has(id.toLowerCase()))
    || new Set(ids.map(id => id.toLowerCase())).size !== ids.length) {
    throw Error('history_canary_invalid_scope');
  }
  return ids.map(id => id.toLowerCase());
}

export function canaryPreflightSql(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => !REVIEWED_HANDS.has(id))) throw Error('history_canary_invalid_scope');
  return `SELECT pg_catalog.jsonb_build_object(
    'all_rows_visible', (SELECT r.rolsuper OR r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname=current_user),
    'active_history_jobs', (SELECT count(*) FROM cron.job WHERE active AND
      (command ILIKE '%tournament-historical-settlement%' OR jobname ILIKE '%histor%')),
    'hands', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',h.id,'tournament_id',h.tournament_id,'tournament_name',t.name,'source_revision',h.source_revision,
      'status',h.status,'is_voided',h.is_voided,'table_session_id',h.table_session_id,'tournament_table_id',h.tournament_table_id,
      'queue_status',q.status,'due',q.next_attempt_at<=pg_catalog.now(),'unleased',q.lease_token IS NULL,
      'source_fingerprint',pg_catalog.md5(pg_catalog.jsonb_build_object('hand',pg_catalog.to_jsonb(h),
        'players',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(hp) ORDER BY hp.id) FROM public.hand_players hp WHERE hp.hand_id=h.id),
        'actions',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(ha) ORDER BY ha.id) FROM public.hand_actions ha WHERE ha.hand_id=h.id))::text),
      'verified_outcomes',(SELECT count(*) FROM public.tournament_settlement_outcomes o WHERE o.hand_id=h.id
        AND o.source_revision=h.source_revision AND o.verification_scope='historical_display' AND o.status='verified')))
      FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id
      LEFT JOIN public.tracker_historical_display_queue q ON q.hand_id=h.id AND q.source_revision=h.source_revision
      WHERE h.id IN (${ids.map(id => `'${id}'::uuid`).join(',')}))) AS preflight;`;
}

export function assertCanaryPreflight(rows, ids) {
  const p = Array.isArray(rows) && rows.length === 1 ? rows[0]?.preflight : null;
  if (p?.all_rows_visible !== true || p.active_history_jobs !== 0
    || !Array.isArray(p.hands) || p.hands.length !== ids.length
    || p.hands.some(h => !h || typeof h !== 'object')
    || new Set(p.hands.map(h => h.id)).size !== ids.length
    || p.hands.some(h => !ids.includes(h.id) || h.tournament_id !== TOUR
      || h.tournament_name !== 'TEST — Felt UAT (compact)' || h.source_revision !== 31
      || h.status !== 'completed' || h.is_voided !== false || h.table_session_id !== SESSION
      || h.tournament_table_id !== TABLE || h.queue_status !== 'pending' || h.due !== true || h.unleased !== true
      || !/^[a-f0-9]{32}$/.test(h.source_fingerprint ?? '') || !Number.isSafeInteger(h.verified_outcomes) || h.verified_outcomes < 0)) {
    throw Error('history_canary_db_preflight_failed');
  }
}

export function assertCanaryPostcheck(rows, before, stats, ids) {
  const p = Array.isArray(rows) && rows.length === 1 ? rows[0]?.preflight : null;
  const original = before[0].preflight.hands;
  if (p?.all_rows_visible !== true || p.active_history_jobs !== 0 || !Array.isArray(p.hands)
    || p.hands.length !== ids.length || new Set(p.hands.map(h => h?.id)).size !== ids.length) {
    throw Error('history_canary_db_postcheck_failed');
  }
  let completed = 0; let attention = 0;
  for (const h of p.hands) {
    const old = original.find(x => x.id === h?.id);
    if (!old || !ids.includes(h.id) || h.source_fingerprint !== old.source_fingerprint || h.unleased !== true
      || !Number.isSafeInteger(h.verified_outcomes) || h.verified_outcomes < old.verified_outcomes
      || h.verified_outcomes > old.verified_outcomes + 1) throw Error('history_canary_db_postcheck_failed');
    if (h.queue_status === 'completed' && h.verified_outcomes > 0) completed++;
    else if (h.queue_status === 'needs_attention' && h.verified_outcomes === old.verified_outcomes) attention++;
    else throw Error('history_canary_db_postcheck_failed');
  }
  if (completed !== stats.completed || attention !== stats.needs_attention) throw Error('history_canary_db_postcheck_failed');
}

/** Protected finite, reviewed TEST-hand transport; no broad queue drain or service key. */
export async function runHistoryCanary(env, { fetchImpl = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  onProvisionAttempt = () => {} } = {}) {
  const ids = validateCanaryContext(env);
  const api = `https://api.supabase.com/v1/projects/${PROJECT}/secrets`;
  const edge = `https://${PROJECT}.supabase.co/functions/v1/tournament-historical-settlement`;
  let temporarySecret;
  let provisionAttempted = false;
  let result;
  let failure;
  let before;

  async function request(url, init, stage) {
    try {
      const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(55_000), ...init });
      const body = await response.json();
      return { status: response.status, body };
    } catch { throw Error(`history_canary_${stage}`); }
  }
  async function management(method, body, stage) {
    const response = await request(api, { method,
      headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) }, stage);
    if (response.status !== (method === 'POST' ? 201 : 200)) throw Error(`history_canary_${stage}`);
    return response.body;
  }
  async function call(kind, body = {}, authorized = false) {
    return request(`${edge}-${kind}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: `Bearer ${temporarySecret}` } : {}) },
      body: JSON.stringify(body) }, `${kind}_transport_failed`);
  }
  function requireDisabled(response, code) {
    if (response.status !== 404 || response.body?.code !== code) throw Error('history_canary_not_disabled');
  }
  async function secretAbsent() {
    const list = await management('GET', null, 'secret_preflight_failed');
    if (!Array.isArray(list) || list.some(item => typeof item?.name !== 'string')) throw Error('history_canary_secret_preflight_failed');
    return !list.some(item => item.name === SECRET || item.name === SCOPE);
  }

  try {
    requireDisabled(await call('worker'), 'worker_disabled');
    requireDisabled(await call('dispatcher'), 'dispatcher_disabled');
    if (!await secretAbsent()) throw Error('history_canary_secret_exists');
    for (const [kind, version] of [['worker', 11], ['dispatcher', 8]]) {
      const meta = await request(`https://api.supabase.com/v1/projects/${PROJECT}/functions/tournament-historical-settlement-${kind}`, {
        method: 'GET', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } }, 'edge_preflight_failed');
      if (meta.status !== 200 || meta.body?.version !== version || meta.body?.verify_jwt !== false
        || meta.body?.status !== 'ACTIVE') throw Error('history_canary_edge_preflight_failed');
    }
    const preflight = await request(`https://api.supabase.com/v1/projects/${PROJECT}/database/query/read-only`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: canaryPreflightSql(ids) }) }, 'db_preflight_transport_failed');
    if (preflight.status !== 201) throw Error('history_canary_db_preflight_failed');
    assertCanaryPreflight(preflight.body, ids);
    before = preflight.body;
    temporarySecret = randomBytes(32).toString('hex');
    // Set before the request: an unknown POST outcome still requires recovery, not a retry.
    onProvisionAttempt();
    provisionAttempted = true;
    await management('POST', [{ name: SECRET, value: temporarySecret }, { name: SCOPE, value: JSON.stringify(ids) }], 'provision_failed');
    let ready = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const probe = await call('worker', {}, true);
      if (probe.status === 400 && probe.body?.code === 'hand_scope_required') { ready = true; break; }
      if (probe.status !== 401) requireDisabled(probe, 'worker_disabled');
      if (attempt < 5) await wait(1000);
    }
    if (!ready) throw Error('history_canary_enable_not_observed');
    requireDisabled(await call('worker'), 'worker_disabled');
    requireDisabled(await call('dispatcher'), 'dispatcher_disabled');
    const response = await call('worker', { hand_ids: ids, limit: ids.length }, true);
    const stats = response.body;
    const fields = ['claimed', 'completed', 'retried', 'needs_attention', 'unresolved'];
    if (response.status !== 200 || stats?.ok !== true
      || fields.some(key => !Number.isSafeInteger(stats[key]) || stats[key] < 0)
      || stats.claimed !== ids.length || stats.unresolved !== 0 || stats.retried !== 0
      || stats.completed + stats.retried + stats.needs_attention !== stats.claimed) {
      throw Error('history_canary_result_unverified');
    }
    result = Object.fromEntries(fields.map(key => [key, stats[key]]));
  } catch (error) {
    failure = error;
  } finally {
    if (provisionAttempted) {
      let cleanupFailed = false;
      try { await management('POST', [{ name: ENABLE, value: 'false' }], 'disable_failed'); }
      catch { cleanupFailed = true; }
      // Always revoke our temporary credential even when disabling failed.
      try { await management('DELETE', [SECRET, SCOPE], 'revoke_failed'); }
      catch { cleanupFailed = true; }
      try {
        requireDisabled(await call('worker'), 'worker_disabled');
        if (!await secretAbsent()) cleanupFailed = true;
      } catch { cleanupFailed = true; }
      if (cleanupFailed) failure = Error('history_canary_cleanup_failed');
    }
    temporarySecret = undefined;
  }
  if (failure) throw failure;
  const postcheck = await request(`https://api.supabase.com/v1/projects/${PROJECT}/database/query/read-only`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: canaryPreflightSql(ids) }) }, 'db_postcheck_transport_failed');
  if (postcheck.status !== 201) throw Error('history_canary_db_postcheck_failed');
  assertCanaryPostcheck(postcheck.body, before, result, ids);
  return result;
}

/** Only the protected workflow that recorded ownership may invoke this recovery path. */
export async function cleanupOwnedHistoryCanary(env, marker, { fetchImpl = fetch } = {}) {
  validateCanaryContext(env);
  if (!/^\d+$/.test(env.GITHUB_RUN_ID ?? '') || marker?.runId !== env.GITHUB_RUN_ID
    || marker.sourceSha !== env.TARGET_SHA || marker.project !== PROJECT) throw Error('history_canary_invalid_cleanup_owner');
  const api = `https://api.supabase.com/v1/projects/${PROJECT}/secrets`;
  const headers = { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
  let failed = false;
  async function send(url, init, status, code) {
    try {
      const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30_000), ...init });
      const body = await response.json();
      if (response.status !== status || (code && body?.code !== code)) throw Error();
      return body;
    } catch { failed = true; return null; }
  }
  await send(api, { method: 'POST', headers, body: JSON.stringify([{ name: ENABLE, value: 'false' }]) }, 201);
  // Complete both recovery attempts even when the first response was lost.
  await send(api, { method: 'DELETE', headers, body: JSON.stringify([SECRET, SCOPE]) }, 200);
  await send(`https://${PROJECT}.supabase.co/functions/v1/tournament-historical-settlement-worker`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 404, 'worker_disabled');
  const list = await send(api, { method: 'GET', headers }, 200);
  if (!Array.isArray(list) || list.some(item => typeof item?.name !== 'string' || item.name === SECRET || item.name === SCOPE)) failed = true;
  if (failed) throw Error('history_canary_cleanup_failed');
  return { workerOff: true, temporaryCredentialRevoked: true };
}

function markerPath(env) {
  if (!env.RUNNER_TEMP || !/^\d+$/.test(env.GITHUB_RUN_ID ?? '')) throw Error('history_canary_invalid_cleanup_owner');
  return resolve(env.RUNNER_TEMP, `history-canary-owned-${env.GITHUB_RUN_ID}.json`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const mode = process.argv[2];
    if (!['run', 'cleanup'].includes(mode)) throw Error('history_canary_invalid_mode');
    validateCanaryContext(process.env);
    const path = markerPath(process.env);
    if (mode === 'cleanup') {
      let marker;
      try { marker = JSON.parse(readFileSync(path, 'utf8')); }
      catch (error) {
        if (error?.code === 'ENOENT') { console.log('history_canary_no_provision_attempt'); process.exit(0); }
        throw Error('history_canary_invalid_cleanup_owner');
      }
      console.log(JSON.stringify(await cleanupOwnedHistoryCanary(process.env, marker)));
      process.exit(0);
    }
    const result = await runHistoryCanary(process.env, { onProvisionAttempt: () => {
      writeFileSync(path, JSON.stringify({ runId: process.env.GITHUB_RUN_ID, sourceSha: process.env.TARGET_SHA, project: PROJECT }),
        { flag: 'wx', mode: 0o600 });
    } });
    console.log(JSON.stringify({ kind: 'scoped-history-http-canary', sourceSha: process.env.TARGET_SHA,
      handIds: JSON.parse(process.env.HAND_IDS), workerOff: true, temporaryCredentialRevoked: true, ...result }));
  } catch (error) {
    console.error(/^history_canary_[a-z_]+$/.test(error?.message ?? '') ? error.message : 'history_canary_failed');
    process.exitCode = 1;
  }
}
