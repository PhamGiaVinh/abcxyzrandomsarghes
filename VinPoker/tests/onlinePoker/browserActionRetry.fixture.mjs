import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { createServer as createVite } from 'vite';
import * as engine from '../../supabase/functions/_shared/pokerEngine/index.ts';
import * as adapter from '../../supabase/functions/_shared/pokerAdapter/index.ts';
import { loadCreateAction } from './createAction.fixture.mjs';

export async function verifyBrowserActionRetry({ sql, actor, handId, seat }) {
  const token = 'DISPOSABLE_BROWSER_ACTOR';
  const actionRequests = [];
  let writes = 0;
  let droppedAfterCommit = false;
  const logs = [];
  const statuses = [];
  let vite;
  const server = createServer(async (req, res) => {
    if (req.url === '/__action-retry-fixture') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<title>Action retry fixture</title>');
      return;
    }
    if (req.url !== '/functions/v1/online-poker-action' || req.method !== 'POST') {
      vite.middlewares(req, res, () => res.writeHead(404).end());
      return;
    }
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const intent = JSON.parse(body);
      actionRequests.push(intent);
      const response = await handler(new Request(base + req.url, { method: 'POST', headers: req.headers, body }));
      statuses.push(response.status);
      const raw = await response.text();
      if (actionRequests.length === 1 && response.ok && writes === 1
        && sql(`SELECT count(*) FROM public.online_poker_actions WHERE hand_id='${handId}'`) === '1') {
        droppedAfterCommit = true;
        res.destroy();
        return;
      }
      res.writeHead(response.status, { 'content-type': 'application/json' }).end(raw);
    } catch (error) {
      statuses.push(500);
      console.error('Browser fixture bridge error class:', error?.name);
      res.writeHead(500).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = query => JSON.parse(sql(`SET ROLE service_role; ${query}`));
  const payload = args => Buffer.from(JSON.stringify(args)).toString('hex');
  const admin = {
    from(name) {
      assert.equal(name, 'online_poker_actions');
      let key;
      const query = {
        select: () => query,
        eq: (_column, value) => { key = value; return query; },
        maybeSingle: async () => ({
          data: json(`SELECT COALESCE((SELECT to_jsonb(r) FROM public.online_poker_actions r
            WHERE idempotency_key=convert_from(decode('${Buffer.from(key).toString('hex')}','hex'),'UTF8')),'null'::jsonb)`),
          error: null,
        }),
      };
      return query;
    },
    async rpc(name, args) {
      if (name === 'op_is_enabled') return { data: json('SELECT to_jsonb(public.op_is_enabled())'), error: null };
      if (name === 'op_load_action_context') {
        assert.equal(args.p_hand_id, handId);
        return { data: json(`SELECT public.op_load_action_context('${handId}')`), error: null };
      }
      assert.equal(name, 'op_submit_action');
      assert.equal(args.p_actor_user_id, actor);
      const data = json(`
        WITH input AS (SELECT convert_from(decode('${payload(args)}','hex'),'UTF8')::jsonb AS p)
        SELECT public.op_submit_action((p->>'p_hand_id')::uuid,(p->>'p_actor_user_id')::uuid,
          p->'p_action',p->'p_new_state',p->'p_board_future',p->'p_events',
          (p->>'p_expected_state_version')::int,(p->>'p_act_deadline')::timestamptz,
          p->>'p_idempotency_key') FROM input
      `);
      writes++;
      return { data, error: null };
    },
  };
  const handler = loadCreateAction((_url, key) => key === 'ANON_TEST'
    ? { auth: { getUser: async supplied => ({ data: { user: supplied === token ? { id: actor } : null }, error: null }) } }
    : admin, logs, base, undefined, { engine, adapter });
  process.env.VITE_SUPABASE_URL = base;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'local-publishable';
  let browser;
  try {
    vite = await createVite({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.addInitScript(({ id, access_token }) => {
      localStorage.setItem('sb-127-auth-token', JSON.stringify({
        access_token, refresh_token: 'disposable-refresh', token_type: 'bearer',
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id },
      }));
    }, { id: actor, access_token: token });
    await page.goto(base + '/__action-retry-fixture');
    let receipt;
    try {
      receipt = await page.evaluate(async ({ handId, seat }) => {
        const { onlinePokerClient } = await import('/src/lib/onlinePoker/client.ts');
        return onlinePokerClient.submitAction({ handId, seat, type: 'fold' });
      }, { handId, seat });
    } catch (error) {
      const outcomes = logs.flat().map(line => {
        try { const item = JSON.parse(line); return { outcome: item.outcome, http: item.http }; }
        catch { return {}; }
      });
      console.error(JSON.stringify({ statuses, outcomes, writes, droppedAfterCommit }));
      throw error;
    }
    assert.ok(droppedAfterCommit, 'Browser must lose the reply after PostgreSQL commits');
    assert.equal(actionRequests.length, 2);
    assert.deepEqual(actionRequests[0], actionRequests[1]);
    assert.equal(writes, 1);
    assert.deepEqual(receipt, { ok: true, handId, stateVersion: 1 });
    assert.equal(sql(`SELECT count(*) FROM public.online_poker_actions WHERE hand_id='${handId}'`), '1');
    console.log('CHROMIUM_BROWSER_SDK_EDGE_HANDLER_POSTGRES_COMMIT_DROP_SAME_KEY_PASS');
  } finally {
    await browser?.close();
    await vite?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
