import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

export async function verifySatellitePlayBrowser({ apiUrl, anonKey, players, tableId, post, nextActor }) {
  assert.equal(apiUrl, 'http://127.0.0.1:54321');
  const vite = await createServer({
    server: { host: '127.0.0.1', port: 0, hmr: false },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiUrl),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(anonKey),
    },
    plugins: [{ name: 'disposable-play-entry', configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== `/poker/table/${tableId}`) return next();
        const html = await server.transformIndexHtml(req.url,
          '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/onlinePoker/satellitePlayBrowser.entry.tsx"></script></body></html>');
        res.writeHead(200, { 'content-type': 'text/html' }).end(html);
      });
    } }],
  });
  let browser;
  try {
    await vite.listen();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    browser = await chromium.launch();
    const pages = await Promise.all(players.map(async (player, index) => {
      const page = await browser.newPage({ viewport: index === 0
        ? { width: 1440, height: 900 } : { width: 390, height: 844 } });
      await page.addInitScript(({ session, origin }) => {
        if (location.origin === origin) localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
      }, { session: player.session, origin });
      await page.route(`${apiUrl}/functions/v1/online-poker-action`, async route => {
        const request = route.request();
        const cors = { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        const token = request.headers().authorization?.replace(/^Bearer /, '') ?? '';
        const response = await post(request.postDataJSON(), token);
        return route.fulfill({ status: response.status, contentType: 'application/json', headers: cors,
          body: await response.text() });
      });
      await page.goto(`${origin}/poker/table/${tableId}`);
      return page;
    }));
    const response = await post({ op: 'start_hand', tableId, idempotencyKey: crypto.randomUUID() });
    assert.equal(response.status, 200);
    const hand = await response.json();
    assert.equal(hand.outcome, 'ok');
    const actor = nextActor(hand.hand_id);
    const actingPage = pages[players.findIndex(player => player.actor === actor)];
    assert.ok(actingPage);
    const fold = actingPage.getByRole('button', { name: 'Bỏ bài', exact: true });
    await fold.click({ timeout: 25_000 });
    await Promise.all(pages.map(page => page.getByText('Kết quả ván #11', { exact: true }).waitFor()));
    console.log('CHROMIUM_SATELLITE_PLAY_REAL_EDGE_AND_PEER_RESULT_PASS');
  } finally {
    await browser?.close();
    await vite.close();
  }
}
