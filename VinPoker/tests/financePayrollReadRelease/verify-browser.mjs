import assert from 'node:assert/strict';import {readFileSync,mkdirSync} from 'node:fs';import {join} from 'node:path';import {spawnSync} from 'node:child_process';import {createServer} from 'vite';import {chromium} from 'playwright';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGDATABASE,'vinpoker_ops_pt_read_release');assert.ok(process.env.RUNNER_TEMP);
const input=JSON.parse(readFileSync(0,'utf8'));
assert.equal(input.actor,input.salaryOnly?'18000000-0000-4000-8000-000000000013':'18000000-0000-4000-8000-000000000012');
assert.equal(input.binding.club_id,'18000000-0000-4000-8000-000000000001');assert.equal(input.binding.dealer_id,'18000000-0000-4000-8000-000000000051');
function sql(q){const r=spawnSync('psql',['-XAt','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8'});assert.equal(r.status,0,'isolated browser metadata control failed');return r.stdout.trim();}
const base='http://127.0.0.1:23863',out=join(process.env.RUNNER_TEMP,'pt-read-browser');mkdirSync(out,{recursive:true});
const server=await createServer({configFile:'tests/financePayrollReadRelease/http.vite.config.ts'});let browser;
try {await server.listen();browser=await chromium.launch({headless:true});for(const width of [375,1280]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});await page.addInitScript(c=>{window.__ptHttp=c;},input);
  const errors=[],reads=[];page.on('pageerror',e=>errors.push(e.message.replaceAll(input.token,'[REDACTED]')));
  page.on('response',r=>{if(r.url().includes('/rest/v1/'))reads.push({name:r.url().split('/').at(-1),status:r.status()});});
  await page.route('**/*',route=>{const u=route.request().url();if(u.startsWith(base)||u.startsWith('data:'))return route.continue();errors.push('unexpected_external_request');return route.abort();});
  await page.goto(`${base}/tests/financePayrollReadRelease/${input.salaryOnly?'http.employee.preview.html':'http.preview.html'}`);
  const scope=input.salaryOnly?page.getByRole('region',{name:'Phiếu lương PT đã chốt',exact:true}):page.locator('main');
  const expectedPaid=input.paid?'5.000.000':'0',expectedDebt=input.paid?'0':'5.000.000';
  if(input.salaryOnly){
    await scope.getByRole('listitem',{name:`Phiếu ${input.binding.statement_id}`,exact:true}).waitFor();
    // Unpaid approval and debt are both5M; select the semantic term/value pair,
    // not an arbitrary first occurrence of an otherwise identical amount.
    const debt=scope.locator('dl > div').filter({has:page.getByText('Còn phải trả',{exact:true})});
    await debt.getByText(`${expectedDebt} ₫`,{exact:true}).waitFor();
    if(input.historicalMode==='inactive')await page.getByRole('alert').waitFor();
    else if(input.historicalMode==='full_time')await page.getByText('Chưa chốt bảng lương tháng này',{exact:true}).waitFor();
    else if(input.paid)await page.getByRole('region',{name:'Lịch sử thanh toán lương PT'}).getByText(/Chuyển khoản/).waitFor();
  }else await scope.getByText(/Phiếu đã chốt:/).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const suffix=`${input.salaryOnly?'recipient':'operator'}-${input.paid?'paid':'unpaid'}-${input.historicalMode??'active'}-${width}`;
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:join(out,`${suffix}.png`),fullPage:true,animations:'disabled'});
  await scope.getByRole('button',{name:input.salaryOnly?`Xem phiếu ${input.binding.statement_id}`:'Xem phiếu & lịch sử chi',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Đã chốt',{exact:true}).getByText('5.000.000 ₫',{exact:true}).waitFor();
  await dialog.getByLabel('Đã ghi nhận chi',{exact:true}).getByText(`${expectedPaid} ₫`,{exact:true}).waitFor();
  await dialog.getByLabel('Còn phải trả',{exact:true}).getByText(`${expectedDebt} ₫`,{exact:true}).waitFor();
  assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));await page.screenshot({path:join(out,`${suffix}-detail.png`),fullPage:true,animations:'disabled'});
  assert.equal(await dialog.evaluate(el=>getComputedStyle(el).opacity),'1','capture must finish finite modal animation');
  if(input.salaryOnly){
    sql(`UPDATE public.dealers SET user_id=NULL WHERE id='${input.binding.dealer_id}'`);
    try{await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await dialog.waitFor({state:'hidden'});await scope.getByRole('alert').waitFor();assert.ok(reads.some(r=>r.name==='list_my_pt_statements_v1'&&r.status===403));assert.equal(await scope.getByRole('listitem').count(),0);}
    finally{sql(`UPDATE public.dealers SET user_id='${input.actor}' WHERE id='${input.binding.dealer_id}'`);}
  }else{
    const member=sql(`SELECT row_to_json(c)::text FROM public.club_cashiers c WHERE club_id='${input.binding.club_id}' AND user_id='${input.actor}'`);assert.ok(member);
    sql(`DELETE FROM public.club_cashiers WHERE club_id='${input.binding.club_id}' AND user_id='${input.actor}'`);
    try{await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await dialog.waitFor({state:'hidden'});await scope.getByRole('alert').waitFor();assert.ok(reads.some(r=>r.name==='get_part_time_payroll_statement_status_v1'&&r.status===403));assert.equal(await scope.getByText(/Phiếu đã chốt:/).count(),0);}
    finally{sql(`INSERT INTO public.club_cashiers SELECT * FROM json_populate_record(NULL::public.club_cashiers,$row$${member}$row$::json)`);}
  }
  assert.ok(reads.every(r=>['get_part_time_payroll_statement_status_v1','get_pt_statement_installments_v1','list_my_pt_statements_v1','get_my_pt_wage','get_my_dealer_payroll'].includes(r.name)),'browser attempted a writer');
  assert.deepEqual(errors,[]);await page.screenshot({path:join(out,`${suffix}-revoked.png`),fullPage:true,animations:'disabled'});await page.close();
}console.log('PT_READ_STANDALONE_BROWSER_PASS');}finally{await browser?.close();await server.close();}
