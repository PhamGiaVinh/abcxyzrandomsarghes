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
  const loginPlayer = async () => {
    const player = createClient(status.API_URL, status.ANON_KEY, { auth });
    const email = `satellite-${randomUUID()}@example.test`;
    const password = randomUUID();
    const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ok(user.data.user?.id && !user.error, `Disposable Auth create failed: ${user.error?.code ?? 'unknown'}`);
    const login = await player.auth.signInWithPassword({ email, password });
    const token = login.data.session?.access_token;
    assert.ok(token && !login.error, `Disposable Auth login failed: ${login.error?.code ?? 'unknown'}`);
    return { actor: user.data.user.id, token, session: login.data.session };
  };
  const players = await Promise.all([loginPlayer(), loginPlayer()]);

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
  const post = (body, accessToken = players[0].token) => fetch('http://127.0.0.1:8000', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(8_000),
  });
  const sockets = [];
  const observeTable = async (tableId, participants = players) => Promise.all(participants.map(async ({ token }) => {
    const client = createClient(status.API_URL, status.ANON_KEY, { accessToken: async () => token });
    sockets.push(client);
    await client.realtime.setAuth();
    const completed = new Map();
    await new Promise((resolve, reject) => {
      client.channel(`edge-action-${tableId}`).on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'online_poker_hands', filter: `table_id=eq.${tableId}`,
      }, ({ new: row }) => {
        if (row.status === 'complete') completed.set(row.id, { revision: Number(row.state_version), at: performance.now() });
      }).subscribe((state, error) => {
        if (state === 'SUBSCRIBED') resolve();
        if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
          reject(new Error(`Disposable action subscription: ${state}`, { cause: error }));
        }
      });
    });
    const receive = async (handId) => {
      const deadline = performance.now() + 8_000;
      while (!completed.has(handId) && performance.now() < deadline) await delay(20);
      assert.ok(completed.has(handId), 'Missing committed action on subscribed table');
      return completed.get(handId);
    };
    return {
      receive,
      async disconnect() {
        await client.removeAllChannels();
        client.realtime.disconnect();
      },
      async latestHand() {
        const { data, error } = await client.from('online_poker_hands').select('state,state_version')
          .eq('table_id', tableId).in('status', ['dealing', 'betting', 'complete'])
          .order('hand_no', { ascending: false }).limit(1).maybeSingle();
        assert.equal(error?.code, undefined);
        return data;
      },
    };
  }));
  try {
    const deadline = performance.now() + 30_000;
    let response;
    while (!response && performance.now() < deadline && child.exitCode === null && !startError) {
      response = await post({ op: 'ping' }).catch(() => null);
      if (!response) await delay(100);
    }
    assert.equal(response?.status, 200, `Disposable Edge ping failed: ${startError ?? child.exitCode ?? 'HTTP'}`);
    assert.deepEqual(await response.json(), { ok: true });
    await run({ post, players, loginPlayer, observeTable, apiUrl: status.API_URL, anonKey: status.ANON_KEY });
  } finally {
    child.kill();
    await exited;
    await Promise.all(sockets.map(async (client) => {
      await client.removeAllChannels();
      client.realtime.disconnect();
    }));
  }
}
