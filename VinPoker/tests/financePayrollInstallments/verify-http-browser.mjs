import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createServer} from 'vite';
import {chromium} from 'playwright';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'vinpoker_ops_pt_installment');
// Ephemeral TEST JWT comes through stdin, never command arguments, files, or logs.
const input=JSON.parse(readFileSync(0,'utf8'));
assert.equal(input.actor,'18000000-0000-4000-8000-000000000012');
assert.equal(input.binding.club_id,'18000000-0000-4000-8000-000000000001');
function sql(query){
  const r=spawnSync('psql',['-X','-At','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'});
  assert.equal(r.status,0,'isolated browser SQL control failed');return r.stdout.trim();
}
const base='http://127.0.0.1:23862';
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
    page.on('pageerror',()=>failures.push('browser_runtime_error'));
    page.on('response',response=>{
      if(response.url().includes('/rest/v1/')) reads.push({name:response.url().split('/').at(-1),status:response.status()});
    });
    await page.route('**/*',route=>{
      const u=route.request().url();
      if(u.startsWith(base) || u.startsWith('data:')) return route.continue();
      failures.push('unexpected_external_request');return route.abort();
    });
    await page.goto(`${base}/tests/financePayrollInstallments/http.preview.html`);
    const control=page.getByRole('region',{name:'Điều khiển phiếu PT TEST',exact:true});
    if(input.oldIntent) {
      await control.getByRole('button',{name:'Lưu đối chiếu yêu cầu chi cũ'}).click();
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
    if(input.verifyRevocation) {
      const member=sql(`SELECT row_to_json(c)::text FROM public.club_cashiers c WHERE club_id='${input.binding.club_id}' AND user_id='${input.actor}'`);
      assert.ok(member);
      try {
        sql(`DELETE FROM public.club_cashiers WHERE club_id='${input.binding.club_id}' AND user_id='${input.actor}'`);
        await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
        await dialog.getByRole('alert').waitFor();
        assert.ok(reads.some(r=>r.name==='get_pt_statement_installments_v1' && r.status===403),'revoked detail reader was not denied by actual RPC');
        assert.equal(await dialog.getByLabel('Đã ghi nhận chi',{exact:true}).count(),0,'stale private amount remains after revocation');
        await control.getByRole('alert').waitFor();
        assert.ok(reads.some(r=>r.name==='get_part_time_payroll_statement_status_v1' && r.status===403),'revoked status reader was not denied by actual RPC');
        assert.equal(await control.getByText(/Phiếu đã chốt:/).count(),0,'stale payroll control after revocation');
      } finally {
        sql(`INSERT INTO public.club_cashiers SELECT * FROM json_populate_record(NULL::public.club_cashiers,$row$${member}$row$::json)`);
      }
    }
    assert.deepEqual(failures,[]);
    assert.ok(reads.every(r=>['get_pt_statement_installments_v1','get_part_time_payroll_statement_status_v1','resolve_pt_full_payment_intent_v1'].includes(r.name)),
      'browser attempted a financial mutation');
    await dialog.getByRole('button',{name:'Đóng phiếu'}).click();
    await dialog.waitFor({state:'hidden'});
    await page.close();
  }
  console.log('PT_REAL_BROWSER_RPC_DB_DESKTOP_MOBILE_READ_PASS');
} finally {await browser?.close();await server.close();}
