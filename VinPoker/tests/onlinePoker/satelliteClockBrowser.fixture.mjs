import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { createServer as createVite } from 'vite';

export async function verifySatelliteClockBrowser({ sql, actor, pilot, ticketScenario, twoTablePilot, finalTablePilot }) {
  const statements = {
    get_online_satellite_pilot_v1: "public.get_online_satellite_pilot_v1((p->>'p_pilot_id')::uuid)",
    register_online_satellite_pilot_v1: "public.register_online_satellite_pilot_v1((p->>'p_pilot_id')::uuid)",
    get_online_satellite_table_v1: "public.get_online_satellite_table_v1((p->>'p_pilot_id')::uuid)",
    get_online_satellite_round_operations_v1:
      "public.get_online_satellite_round_operations_v1((p->>'p_pilot_id')::uuid)",
    move_online_satellite_round_seat_v2:
      "public.move_online_satellite_round_seat_v2((p->>'p_pilot_id')::uuid,(p->>'p_seat_id')::uuid,(p->>'p_destination')::uuid,(p->>'p_destination_seat')::int,(p->>'p_expected_round')::bigint,(p->>'p_expected_placement')::bigint)",
    retire_online_satellite_round_table_v1:
      "public.retire_online_satellite_round_table_v1((p->>'p_pilot_id')::uuid,(p->>'p_table_id')::uuid,(p->>'p_expected_round')::bigint)",
    provision_online_satellite_table_v1:
      "public.provision_online_satellite_table_v1((p->>'p_pilot_id')::uuid,p->'p_levels',(p->>'p_qualification_slots')::integer)",
    provision_online_satellite_two_tables_v1:
      "public.provision_online_satellite_two_tables_v1((p->>'p_pilot_id')::uuid,p->'p_levels',(p->>'p_qualification_slots')::integer)",
    open_online_satellite_round_v1:
      "public.open_online_satellite_round_v1((p->>'p_pilot_id')::uuid,(p->>'p_expected_round')::bigint)",
    set_online_satellite_clock_v1:
      "public.set_online_satellite_clock_v1((p->>'p_pilot_id')::uuid,(p->>'p_expected_revision')::bigint,(p->>'p_running')::boolean)",
    get_my_online_satellite_result_v1: "public.get_my_online_satellite_result_v1((p->>'p_pilot_id')::uuid)",
    get_online_satellite_test_issuance_v1: "public.get_online_satellite_test_issuance_v1((p->>'p_pilot_id')::uuid)",
    issue_online_satellite_test_tickets_v1:
      "public.issue_online_satellite_test_tickets_v1((p->>'p_pilot_id')::uuid,(p->>'p_request_id')::uuid,(p->>'p_expires_at')::timestamptz)",
    get_my_online_satellite_test_ticket_v1: "public.get_my_online_satellite_test_ticket_v1((p->>'p_pilot_id')::uuid)",
    redeem_online_satellite_test_ticket_v1:
      "public.redeem_online_satellite_test_ticket_v1((p->>'p_ticket_id')::uuid,(p->>'p_destination_id')::uuid)",
  };
  let vite;
  let droppedIssueReply = false;
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
      const requestActor = req.headers['x-disposable-fixture-role'] === 'participant' ? ticketScenario.player : actor;
      const result = sql(`SET ROLE authenticated; SET request.jwt.claim.sub='${requestActor}';
        WITH input AS (SELECT convert_from(decode('${encoded}','hex'),'UTF8')::jsonb AS p)
        SELECT COALESCE(${statements[rpc]}, 'null'::jsonb) FROM input`);
      if (rpc === 'issue_online_satellite_test_tickets_v1' && !droppedIssueReply && JSON.parse(result).outcome === 'ok') {
        droppedIssueReply = true;
        res.destroy();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(result);
    } catch (error) {
      console.error(error.message);
      res.writeHead(400, { 'content-type': 'application/json' }).end('{"message":"Fixture RPC failed"}');
    }
  });
  let browser;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    vite = await createVite({
      server: { middlewareMode: true, hmr: false }, appType: 'custom',
      define: { 'import.meta.env.VITE_ONLINE_SATELLITE_RUNTIME': JSON.stringify('true') },
    });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const fixtureUrl = (user, targetPilot) =>
      `http://127.0.0.1:${server.address().port}/__satellite-clock-fixture?actor=${user}&pilot=${targetPilot}`;
    await page.goto(fixtureUrl(actor, pilot));
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
    await page.goto(fixtureUrl(actor, ticketScenario.pilot));
    await page.getByLabel('Hạn dùng (giờ Việt Nam)').fill('2099-01-01T18:00');
    await page.getByRole('button', { name: 'Phát vé TEST', exact: true }).click();
    await page.getByText('Đã phát 2 vé TEST cho Disposable browser ticket target.', { exact: true }).waitFor();
    assert.ok(droppedIssueReply);
    const participant = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await participant.setExtraHTTPHeaders({ 'x-disposable-fixture-role': 'participant' });
    await participant.goto(fixtureUrl(ticketScenario.player, ticketScenario.pilot));
    await participant.getByRole('button', { name: 'Đổi vé TEST', exact: true }).click();
    await participant.getByText('Đã tạo entry TEST tại giải đích.', { exact: true }).waitFor();
    const entry = () => sql(`SELECT id FROM online_satellite_private.test_target_entries
      WHERE destination_id='${ticketScenario.destination}' AND player_user_id='${ticketScenario.player}'`);
    const firstEntry = entry();
    assert.match(firstEntry, /^[0-9a-f-]{36}$/);
    await participant.reload();
    await participant.getByText('Đã tạo entry TEST tại giải đích.', { exact: true }).waitFor();
    assert.equal(entry(), firstEntry);
    console.log('CHROMIUM_SATELLITE_TICKET_ISSUE_LOST_REPLY_AND_REDEEM_DISTINCT_ACTORS_PASS');
    await participant.goto(fixtureUrl(ticketScenario.player, twoTablePilot) + '&register=1');
    await participant.getByRole('button', { name: 'Đăng ký một ghế' }).click();
    await participant.getByText('Máy chủ đã xác nhận đăng ký.', { exact: true }).waitFor();
    const browserEntry = sql(`SELECT id FROM online_satellite_private.entries
      WHERE pilot_id='${twoTablePilot}' AND player_user_id='${ticketScenario.player}'`);
    assert.match(browserEntry, /^[0-9a-f-]{36}$/);
    sql(`UPDATE online_satellite_private.pilots SET registration_closes_at=clock_timestamp()-interval '1 second'
      WHERE id='${twoTablePilot}'`);
    await page.goto(fixtureUrl(actor, twoTablePilot));
    await page.getByRole('checkbox', { name: /Tạo hai bàn TEST/ }).check();
    await page.getByRole('spinbutton', { name: 'Số suất TEST', exact: true }).fill('2');
    await page.getByRole('spinbutton', { name: 'Small blind', exact: true }).fill('5');
    await page.getByRole('spinbutton', { name: 'Big blind', exact: true }).fill('10');
    await page.getByRole('button', { name: 'Tạo bàn và khóa lịch' }).click();
    await page.getByRole('button', { name: 'Chuyển ghế', exact: true }).waitFor();
    const assignedTable = sql(`SELECT s.table_id FROM online_satellite_private.round_tables m
      JOIN public.online_poker_seats s ON s.table_id=m.table_id
      WHERE m.pilot_id='${twoTablePilot}' AND s.user_id='${ticketScenario.player}'`);
    await participant.getByRole('link', { name: 'Mở bàn Satellite' }).click();
    const assignedLink = participant.getByRole('link', { name: 'Vào bàn', exact: true });
    await assignedLink.waitFor();
    assert.equal(await assignedLink.getAttribute('href'), `/poker/table/${assignedTable}`);
    console.log('CHROMIUM_SATELLITE_REGISTRATION_TO_ASSIGNED_TABLE_PASS');
    const { seat, anchor, target } = JSON.parse(sql(`SELECT json_build_object(
      'seat',s.id,'anchor',c.table_id,'target',m.table_id)
      FROM online_satellite_private.table_clocks c
      JOIN online_satellite_private.round_tables m ON m.pilot_id=c.pilot_id AND m.table_id<>c.table_id
      JOIN public.online_poker_seats s ON s.table_id=c.table_id AND s.seat_no=1
      WHERE c.pilot_id='${twoTablePilot}'`));
    const chooseMove = async (tableId, seatNo) => {
      await page.getByLabel('Người cần chuyển').selectOption(seat);
      await page.getByLabel('Ghế đích').selectOption(`${tableId}:${seatNo}`);
      await page.getByRole('button', { name: 'Chuyển ghế', exact: true }).click();
      await page.getByText('Đã chuyển ghế.', { exact: true }).waitFor();
      assert.equal(sql(`SELECT table_id||':'||seat_no||':'||stack FROM public.online_poker_seats WHERE id='${seat}'`),
        `${tableId}:${seatNo}:100`);
    };
    await chooseMove(target, 3);
    await page.getByLabel('Người cần chuyển').locator('option').filter({ hasText: 'Bàn 2 · Ghế 3' }).waitFor({ state: 'attached' });
    await chooseMove(anchor, 1);
    console.log('CHROMIUM_SATELLITE_MOVE_SEAT_ROUND_AND_PLACEMENT_PASS');
    await page.getByRole('button', { name: 'Chạy đồng hồ' }).click();
    await page.getByText('Đồng hồ đang chạy', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Mở vòng tiếp theo' }).click();
    await page.getByText('Đã mở vòng chơi.', { exact: true }).waitFor();
    await page.getByText('Chờ chia ván', { exact: true }).nth(1).waitFor();
    assert.equal(sql(`SELECT count(*) FROM online_satellite_private.round_deals
      WHERE pilot_id='${twoTablePilot}' AND round_no=1 AND hand_id IS NULL`), '2');
    await page.reload();
    await page.getByRole('button', { name: 'Mở vòng tiếp theo' }).click();
    await page.getByText('Còn bàn chưa hoàn tất vòng hiện tại.', { exact: true }).waitFor();
    console.log('CHROMIUM_SATELLITE_PROVISION_TWO_TABLES_OPEN_ROUND_PASS');
    await page.goto(fixtureUrl(actor, finalTablePilot));
    await page.getByRole('checkbox', { name: /Tạo hai bàn TEST/ }).check();
    await page.getByRole('spinbutton', { name: 'Số suất TEST', exact: true }).fill('2');
    await page.getByRole('spinbutton', { name: 'Small blind', exact: true }).fill('5');
    await page.getByRole('spinbutton', { name: 'Big blind', exact: true }).fill('10');
    await page.getByRole('button', { name: 'Tạo bàn và khóa lịch' }).click();
    await page.getByRole('button', { name: 'Chuyển ghế', exact: true }).waitFor();
    const finalAnchor = sql(`SELECT table_id FROM online_satellite_private.table_clocks WHERE pilot_id='${finalTablePilot}'`);
    for (const [index, label] of ['Bàn 2 · Ghế 1', 'Bàn 2 · Ghế 2'].entries()) {
      const option = page.getByLabel('Người cần chuyển').locator('option').filter({ hasText: label });
      const seatId = await option.getAttribute('value');
      assert.ok(seatId);
      await page.getByLabel('Người cần chuyển').selectOption(seatId);
      await page.getByLabel('Ghế đích').selectOption(`${finalAnchor}:${index+3}`);
      await page.getByRole('button', { name: 'Chuyển ghế', exact: true }).click();
      await option.waitFor({ state: 'detached' });
    }
    await page.getByRole('button', { name: 'Đóng bàn 2', exact: true }).click();
    await page.getByText('Đã đóng bàn.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Chạy đồng hồ' }).click();
    await page.getByRole('button', { name: 'Mở vòng tiếp theo' }).click();
    await page.getByText('Đã mở vòng chơi.', { exact: true }).waitFor();
    assert.equal(sql(`SELECT table_id FROM online_satellite_private.round_deals WHERE pilot_id='${finalTablePilot}'`), finalAnchor);
    assert.equal(sql(`SELECT sum(stack) FROM public.online_poker_seats WHERE table_id='${finalAnchor}'`), '400');
    console.log('CHROMIUM_SATELLITE_CLOSE_DRAINED_TABLE_FINAL_ROUND_PASS');
  } finally {
    await browser?.close();
    await vite?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
