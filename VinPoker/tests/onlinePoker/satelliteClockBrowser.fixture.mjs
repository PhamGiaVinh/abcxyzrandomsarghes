import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { createServer as createVite } from 'vite';

export async function verifySatelliteClockBrowser({ sql, actor, pilot }) {
  const statements = {
    get_online_satellite_table_v1: "public.get_online_satellite_table_v1((p->>'p_pilot_id')::uuid)",
    provision_online_satellite_table_v1:
      "public.provision_online_satellite_table_v1((p->>'p_pilot_id')::uuid,p->'p_levels',(p->>'p_qualification_slots')::integer)",
    set_online_satellite_clock_v1:
      "public.set_online_satellite_clock_v1((p->>'p_pilot_id')::uuid,(p->>'p_expected_revision')::bigint,(p->>'p_running')::boolean)",
  };
  let vite;
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    if (path === '/__satellite-clock-fixture') {
      const html = await vite.transformIndexHtml(path,
        '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/onlinePoker/satelliteClockBrowser.entry.tsx"></script></body></html>');
      res.writeHead(200, { 'content-type': 'text/html' }).end(html);
      return;
    }
    const rpc = path.match(/^\/rest\/v1\/rpc\/(\w+)$/)?.[1];
    if (!rpc || !Object.hasOwn(statements, rpc) || req.method !== 'POST') {
      vite.middlewares(req, res, () => res.writeHead(404).end());
      return;
    }
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const encoded = Buffer.concat(chunks).toString('hex');
      const result = sql(`SET ROLE authenticated; SET request.jwt.claim.sub='${actor}';
        WITH input AS (SELECT convert_from(decode('${encoded}','hex'),'UTF8')::jsonb AS p)
        SELECT COALESCE(${statements[rpc]}, 'null'::jsonb) FROM input`);
      res.writeHead(200, { 'content-type': 'application/json' }).end(result);
    } catch (error) {
      console.error(error.message);
      res.writeHead(400, { 'content-type': 'application/json' }).end('{"message":"Fixture RPC failed"}');
    }
  });
  let browser;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    vite = await createVite({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/__satellite-clock-fixture?actor=${actor}&pilot=${pilot}`);
    await page.getByRole('spinbutton', { name: 'Small blind', exact: true }).fill('5', { timeout: 15000 });
    await page.getByRole('spinbutton', { name: 'Big blind', exact: true }).fill('10');
    await page.getByRole('button', { name: 'Tạo bàn và khóa lịch' }).click();
    const play = page.getByRole('link', { name: 'Vào bàn', exact: true });
    await play.waitFor();
    const table = sql(`SELECT table_id FROM online_satellite_private.table_clocks WHERE pilot_id='${pilot}'`);
    assert.equal(await play.getAttribute('href'), `/poker/table/${table}`);
    await page.getByRole('button', { name: 'Chạy đồng hồ' }).click();
    await page.getByText('Đồng hồ đang chạy', { exact: true }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Tạm dừng đồng hồ' }).click();
    await page.getByText('Đồng hồ đang tạm dừng', { exact: true }).waitFor();
    assert.equal(sql(`SELECT revision||':'||(running_since IS NULL)::text
      FROM online_satellite_private.table_clocks WHERE pilot_id='${pilot}'`), '3:true');
    console.log('CHROMIUM_SATELLITE_CLOCK_UI_SDK_POSTGRES_PASS');
  } finally {
    await browser?.close();
    await vite?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
