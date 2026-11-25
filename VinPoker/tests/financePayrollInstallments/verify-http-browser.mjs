import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer} from 'vite';
import {chromium} from 'playwright';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'vinpoker_ops_pt_installment');
assert.ok(process.env.RUNNER_TEMP,'explicit disposable browser evidence directory required');
// Ephemeral TEST JWT comes through stdin, never command arguments, files, or logs.
const input=JSON.parse(readFileSync(0,'utf8'));
assert.equal(input.actor,input.salaryOnly?'18000000-0000-4000-8000-000000000013':'18000000-0000-4000-8000-000000000012');
assert.equal(input.binding.club_id,'18000000-0000-4000-8000-000000000001');
function sql(query){
  const r=spawnSync('psql',['-X','-At','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'});
  assert.equal(r.status,0,'isolated browser SQL control failed');return r.stdout.trim();
}
const base='http://127.0.0.1:23862';
const evidenceDirectory=join(process.env.RUNNER_TEMP,'pt-browser-evidence');
mkdirSync(evidenceDirectory,{recursive:true});
const server=await createServer({configFile:'tests/financePayrollInstallments/http.vite.config.ts'});
let browser;
try {
  await server.listen();
  browser=await chromium.launch({headless:true});
  for(const width of [375,1280]) {
    const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
    await page.addInitScript(context=>{
      window.__ptHttp=context;
      if(context.oldIntent) {
        const i=context.oldIntent,s=i.statement;
        sessionStorage.setItem(`vinpoker:pt-statement-payment:v1:${i.actorId}:${s.club_id}:${s.dealer_id}`,JSON.stringify(i));
      }
    },input);
    const failures=[],reads=[];
    page.on('pageerror',error=>failures.push(error.message.replaceAll(input.token,'[REDACTED]')));
    page.on('response',response=>{
      if(response.url().includes('/rest/v1/')) reads.push({name:response.url().split('/').at(-1),status:response.status()});
    });
    await page.route('**/*',route=>{
      const u=route.request().url();
      if(u.startsWith(base) || u.startsWith('data:')) return route.continue();
      failures.push('unexpected_external_request');return route.abort();
    });
    if(input.salaryOnly) {
      const suffix=input.historicalMode?`-${input.historicalMode}`:'';
      await page.goto(`${base}/tests/financePayrollInstallments/http.employee.preview.html`);
      const history=page.getByRole('region',{name:'Lịch sử thanh toán lương PT',exact:true});
      if(!input.historicalMode) {
        await history.getByText(/Chuyển khoản/).waitFor();
        await history.getByText(/2\.000\.000/).waitFor();
        if(input.paymentCount===1) assert.equal(await history.getByText(/Tiền mặt/).count(),0);
        else {await history.getByText(/Tiền mặt/).waitFor();await history.getByText(/3\.000\.000/).waitFor();}
      } else if(input.historicalMode==='inactive') await page.getByRole('alert').waitFor();
      else await page.getByText('Chưa chốt bảng lương tháng này',{exact:true}).waitFor();
      const finalized=page.getByRole('region',{name:'Phiếu lương PT đã chốt',exact:true});
      const expectedRemaining=input.paymentCount===1?'3.000.000':'0';
      const expectedPaid=input.paymentCount===1?'2.000.000':'5.000.000';
      await finalized.getByRole('listitem',{name:`Phiếu ${input.binding.statement_id}`,exact:true}).waitFor();
      await finalized.locator('dl').getByText(`${expectedRemaining} ₫`,{exact:true}).waitFor();
      assert.ok(reads.some(r=>r.name==='list_my_pt_statements_v1' && r.status===200));
      assert.ok(reads.some(r=>r.name==='get_my_pt_wage' && r.status===200));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'employee page overflows');
      if(!input.historicalMode) assert.ok(await history.evaluate(el=>el.scrollWidth<=el.clientWidth),'employee history overflows');
      assert.ok(await finalized.evaluate(el=>el.scrollWidth<=el.clientWidth),'employee finalized history overflows');
      await page.evaluate(()=>document.fonts.ready);
      await page.screenshot({animations:'disabled',path:join(evidenceDirectory,`pt-${input.paymentCount}-${width}-employee${suffix}.png`),fullPage:true});
      await finalized.getByRole('button',{name:`Xem phiếu ${input.binding.statement_id}`,exact:true}).click();
      const dialog=page.getByRole('dialog');
      await dialog.getByLabel('Đã chốt',{exact:true}).getByText(/5\.000\.000/).waitFor();
      await dialog.getByLabel('Còn phải trả',{exact:true}).getByText(`${expectedRemaining} ₫`,{exact:true}).waitFor();
      await dialog.getByLabel('Đã ghi nhận chi',{exact:true}).getByText(`${expectedPaid} ₫`,{exact:true}).waitFor();
      assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),'employee payslip overflows');
      await page.screenshot({animations:'disabled',path:join(evidenceDirectory,`pt-${input.paymentCount}-${width}-employee-payslip${suffix}.png`),fullPage:true});
      assert.equal(await dialog.evaluate(el=>getComputedStyle(el).opacity),'1','captured payslip is still mid-animation');
      // Real link revocation in the same browser session must remove this list
      // and its open detail. Metadata is restored for the next viewport.
      sql(`UPDATE public.dealers SET user_id=NULL WHERE id='${input.binding.dealer_id}'`);
      try {
        await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
        await dialog.waitFor({state:'hidden'});
        await finalized.getByRole('alert').waitFor();
        assert.ok(reads.some(r=>r.name==='list_my_pt_statements_v1' && r.status===403));
        assert.equal(await finalized.getByRole('listitem').count(),0,'revoked finalized money remains');
        await page.screenshot({animations:'disabled',path:join(evidenceDirectory,`pt-${input.paymentCount}-${width}-employee-revoked${suffix}.png`),fullPage:true});
      } finally {sql(`UPDATE public.dealers SET user_id='${input.actor}' WHERE id='${input.binding.dealer_id}'`);}
      assert.ok(reads.every(r=>['get_my_pt_wage','get_my_dealer_payroll','list_my_pt_statements_v1','get_pt_statement_installments_v1'].includes(r.name)),
        'employee attempted a privileged or financial writer');
      assert.deepEqual(failures,[]);await page.close();continue;
    }
    await page.goto(`${base}/tests/financePayrollInstallments/http.preview.html`);
    const control=page.getByRole('region',{name:'Điều khiển phiếu PT TEST',exact:true});
    if(input.oldIntent) {
      const resolveButton=control.getByRole('button',{name:'Lưu đối chiếu yêu cầu chi cũ'});
      await resolveButton.waitFor();
      assert.ok(await control.evaluate(el=>el.scrollWidth<=el.clientWidth),'pending operator panel overflows');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'pending operator page overflows');
      await page.evaluate(()=>document.fonts.ready);
      await page.screenshot({animations:'disabled',path:join(evidenceDirectory,`pt-${input.paymentCount}-${width}-pending.png`),fullPage:true});
      await resolveButton.click();
      await control.getByText(/Yêu cầu cũ đã lưu để đối chiếu/).waitFor();
      assert.ok(reads.some(r=>r.name==='resolve_pt_full_payment_intent_v1' && r.status===200),'no actual server nonpayment proof');
      const saved=await page.evaluate(()=>{
        const i=window.__ptHttp.oldIntent,s=i.statement;
        const active=sessionStorage.getItem(`vinpoker:pt-statement-payment:v1:${i.actorId}:${s.club_id}:${s.dealer_id}`);
        const archive=JSON.parse(sessionStorage.getItem(`vinpoker:pt-statement-payment-archive:v1:${i.actorId}:${s.club_id}:${s.dealer_id}:${i.key}`));
        return {active,original:archive.intent,proof:archive.proof};
      });
      assert.equal(saved.active,null);assert.deepEqual(saved.original,input.oldIntent);
      assert.equal(saved.proof.legacy_payment_recorded,false);assert.equal(saved.proof.intent_key,input.oldIntent.key);
      if(input.paymentCount===2) await control.getByRole('button',{name:'Chốt kỳ PT tiếp theo'}).waitFor();
      else assert.equal(await control.getByRole('button',{name:'Chốt kỳ PT tiếp theo'}).count(),0);
      assert.ok(await control.evaluate(el=>el.scrollWidth<=el.clientWidth),'archived operator panel overflows');
      await page.screenshot({animations:'disabled',path:join(evidenceDirectory,`pt-${input.paymentCount}-${width}-archived.png`),fullPage:true});
    }
    await page.getByRole('button',{name:'Xem phiếu & lịch sử chi'}).click();
    const dialog=page.getByRole('dialog');
    await dialog.getByLabel('Đã ghi nhận chi',{exact:true}).getByText(input.paid).waitFor();
    await dialog.getByLabel('Còn phải trả',{exact:true}).locator('dd').filter({hasText:
      new RegExp(`^${input.remaining.replaceAll('.','\\.')}\\s*₫$`)}).waitFor();
    assert.ok(reads.some(r=>r.name==='get_pt_statement_installments_v1' && r.status===200),'no real successful browser detail RPC');
    assert.equal(await dialog.getByRole('region',{name:'Lịch sử chi',exact:true}).locator('ol li').count(),input.paymentCount);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'browser page overflow');
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),'browser dialog overflow');
    let dialogClosed=false;
    if(input.verifyRevocation) {
      const member=sql(`SELECT row_to_json(c)::text FROM public.club_cashiers c WHERE club_id='${input.binding.club_id}' AND user_id='${input.actor}'`);
      assert.ok(member);
      try {
        sql(`DELETE FROM public.club_cashiers WHERE club_id='${input.binding.club_id}' AND user_id='${input.actor}'`);
        await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
        await dialog.getByRole('alert').waitFor();
        assert.ok(reads.some(r=>r.name==='get_pt_statement_installments_v1' && r.status===403),'revoked detail reader was not denied by actual RPC');
        assert.equal(await dialog.getByLabel('Đã ghi nhận chi',{exact:true}).count(),0,'stale private amount remains after revocation');
        // Radix deliberately aria-hides background regions while the modal is
        // open. Close it before inspecting that operator region's accessible UI.
        await dialog.getByRole('button',{name:'Đóng phiếu'}).click();
        await dialog.waitFor({state:'hidden'});dialogClosed=true;
        await control.getByRole('alert').waitFor();
        assert.ok(reads.some(r=>r.name==='get_part_time_payroll_statement_status_v1' && r.status===403),'revoked status reader was not denied by actual RPC');
        assert.equal(await control.getByText(/Phiếu đã chốt:/).count(),0,'stale payroll control after revocation');
        await page.screenshot({animations:'disabled',path:join(evidenceDirectory,`pt-${input.paymentCount}-${width}-revoked.png`),fullPage:true});
      } finally {
        sql(`INSERT INTO public.club_cashiers SELECT * FROM json_populate_record(NULL::public.club_cashiers,$row$${member}$row$::json)`);
      }
    }
    assert.deepEqual(failures,[]);
    assert.ok(reads.every(r=>['get_pt_statement_installments_v1','get_part_time_payroll_statement_status_v1','resolve_pt_full_payment_intent_v1'].includes(r.name)),
      'browser attempted a financial mutation');
    if(!dialogClosed) {
      await dialog.getByRole('button',{name:'Đóng phiếu'}).click();
      await dialog.waitFor({state:'hidden'});
    }
    await page.close();
  }
  console.log('PT_REAL_BROWSER_RPC_DB_DESKTOP_MOBILE_READ_PASS');
} finally {await browser?.close();await server.close();}
