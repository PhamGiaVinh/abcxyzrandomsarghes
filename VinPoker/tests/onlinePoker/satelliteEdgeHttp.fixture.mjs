import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';

export async function withSatelliteEdgeHttp(statusPath, run) {
  const status = JSON.parse(readFileSync(statusPath, 'utf8'));
  assert.equal(status.API_URL, 'http://127.0.0.1:54321');
  assert.ok(status.ANON_KEY && status.SERVICE_ROLE_KEY, 'Disposable Auth keys unavailable');
  const auth = { persistSession: false, autoRefreshToken: false };
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth });
  const player = createClient(status.API_URL, status.ANON_KEY, { auth });
  const email = `satellite-${randomUUID()}@example.test`;
  const password = randomUUID();
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ok(user.data.user?.id && !user.error, `Disposable Auth create failed: ${user.error?.code ?? 'unknown'}`);
  const login = await player.auth.signInWithPassword({ email, password });
  const token = login.data.session?.access_token;
  assert.ok(token && !login.error, `Disposable Auth login failed: ${login.error?.code ?? 'unknown'}`);

  const child = spawn('deno', [
    'run', '--allow-env', '--allow-net=127.0.0.1:54321,0.0.0.0:8000',
    'supabase/functions/online-poker-action/index.ts',
  ], {
    env: { ...process.env, SUPABASE_URL: status.API_URL, SUPABASE_ANON_KEY: status.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY },
    stdio: 'ignore',
  });
  const exited = new Promise(resolve => child.once('close', resolve));
  let startError;
  child.once('error', error => { startError = error.code; });
  const post = (body, accessToken = token) => fetch('http://127.0.0.1:8000', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(8_000),
  });
  try {
    const deadline = performance.now() + 30_000;
    let response;
    while (!response && performance.now() < deadline && child.exitCode === null && !startError) {
      response = await post({ op: 'ping' }).catch(() => null);
      if (!response) await delay(100);
    }
    assert.equal(response?.status, 200, `Disposable Edge ping failed: ${startError ?? child.exitCode ?? 'HTTP'}`);
    assert.deepEqual(await response.json(), { ok: true });
    await run({ post, actor: user.data.user.id });
  } finally {
    child.kill();
    await exited;
  }
}
