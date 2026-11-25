import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const base='http://127.0.0.1:23861';
const out=resolve(process.argv[2]);
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const results=[];
try {
  for(const width of [320,375,414,768,1280]) {
    const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      const url=route.request().url();
      if(url.startsWith(base) || url.startsWith('data:')) return route.continue();
      errors.push('unexpected_external_request');return route.abort();
    });
    await page.goto(`${base}/tests/financePayrollInstallments/ui.preview.html`);
    await page.getByRole('button',{name:'Xem phiếu & lịch sử chi'}).click();
    const dialog=page.getByRole('dialog');
    await dialog.getByLabel('Còn phải trả',{exact:true}).getByText(/3\.000\.000/).waitFor();
    await page.evaluate(()=>document.fonts.ready);
    assert.match(await dialog.getByRole('heading',{name:'Phiếu lương PT',exact:true}).evaluate(el=>getComputedStyle(el).fontFamily),/Space Grotesk/);
    assert.match(await dialog.getByLabel('Đã chốt',{exact:true}).locator('dd').evaluate(el=>getComputedStyle(el).fontFamily),/JetBrains Mono/);
    const bounds=await dialog.boundingBox();
    assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width,`dialog bounds at ${width}`);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`page overflow at ${width}`);
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),`dialog overflow at ${width}`);
    const payment=dialog.getByText(/^TEST-SEPAY-/);
    await payment.scrollIntoViewIfNeeded();
    const paymentBounds=await payment.boundingBox();
    assert.ok(paymentBounds.x>=bounds.x && paymentBounds.x+paymentBounds.width<=bounds.x+bounds.width,`reference wrapping at ${width}`);
    const price=dialog.getByRole('region',{name:'Lịch sử chi',exact:true}).locator('ol li > p').first();
    assert.ok(await price.evaluate(el=>el.getBoundingClientRect().height<=parseFloat(getComputedStyle(el).lineHeight)*1.2),`payment amount split across lines at ${width}`);
    await dialog.getByLabel('Đã chốt',{exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:resolve(out,`pt-details-${width}.png`)});
    await page.evaluate(()=>window.__ptDetailsFixture.settle());
    await dialog.getByLabel('Đã ghi nhận chi',{exact:true}).getByText(/5\.000\.000/).waitFor();
    await dialog.getByLabel('Còn phải trả',{exact:true}).getByText(/^0/).waitFor();
    assert.ok(await page.evaluate(()=>window.__ptDetailsFixture.calls.every(name=>name==='get_pt_statement_installments_v1')));
    await page.getByRole('button',{name:'Đóng phiếu'}).click();
    await dialog.waitFor({state:'hidden'});
    assert.deepEqual(errors,[]);
    results.push({width,dialogFits:true,pageOverflow:false,longReferenceWrapped:true,liveReadRefresh:true,closeWorks:true});
    await page.close();
  }
  writeFileSync(resolve(out,'verification.json'),JSON.stringify({scope:'local presentation fixture, not DB/hosted Auth/web acceptance',results},null,2));
  console.log('PT_DETAILS_LOCAL_RESPONSIVE_FIXTURE_PASS',results.length);
} finally {await browser.close();}
