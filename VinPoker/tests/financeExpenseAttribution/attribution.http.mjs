import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {createHmac,randomBytes} from 'node:crypto';import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {createServer} from 'vite';import {chromium} from 'playwright';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGDATABASE,'vinpoker_ops_expense_attribution');assert.ok(process.env.RUNNER_TEMP);
const id=n=>`18100000-0000-4000-8000-${String(n).padStart(12,'0')}`,club=id(1),other=id(2),owner=id(11),secret=randomBytes(48).toString('hex'),api='http://127.0.0.1:3016',base='http://127.0.0.1:23866',container='expense-attribution-http';
function command(p,args,options={}){const r=spawnSync(p,args,{encoding:'utf8',...options});if(r.status!==0)throw Error(p==='psql'?String(r.stderr).slice(0,1200):'isolated setup failure');return r.stdout.trim();}
const sql=q=>command('psql',['-XqAt','-v','ON_ERROR_STOP=1','-c',q]);
const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url'),body=enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:owner,role:'authenticated',exp:Math.floor(Date.now()/1000)+900}),jwt=body+'.'+createHmac('sha256',secret).update(body).digest('base64url');
const folder=join(process.env.RUNNER_TEMP,'expense-attribution-browser');mkdirSync(folder,{recursive:true});let server,browser;
try{
 sql(`DO $$ BEGIN IF EXISTS(SELECT FROM public.clubs) THEN RAISE EXCEPTION 'empty_fixture_required';END IF;END $$;
 ALTER ROLE authenticator LOGIN NOINHERIT NOSUPERUSER;GRANT authenticated,anon TO authenticator;
 CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$ SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $auth$;
 INSERT INTO auth.users(id) VALUES('${owner}'),('${id(22)}');
 INSERT INTO public.profiles(user_id,display_name) VALUES('${owner}','Attribution TEST owner A'),('${id(22)}','Attribution TEST owner B');
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${club}','${owner}','Attribution TEST A','TEST','approved'),('${other}','${id(22)}','Attribution TEST B','TEST','approved');
 INSERT INTO public.tournaments(id,club_id,name,status,live_status) VALUES('${id(71)}','${club}','Attribution TEST tour A','upcoming','registering'),('${id(72)}','${other}','Attribution TEST tour B','upcoming','registering');
 INSERT INTO public.tournament_series(id,club_id,name,start_date,end_date) VALUES('${id(61)}','${club}','Attribution TEST series A','2026-11-01','2026-11-30'),('${id(62)}','${other}','Attribution TEST series B','2026-11-01','2026-11-30');`);
 command('docker',['run','--detach','--name',container,'--network','host',...['PGRST_DB_URI','PGRST_DB_SCHEMAS','PGRST_DB_ANON_ROLE','PGRST_JWT_SECRET','PGRST_SERVER_HOST','PGRST_SERVER_PORT'].flatMap(k=>['-e',k]),'postgrest/postgrest:v13.0.7'],{env:{...process.env,PGRST_DB_URI:'postgres://authenticator@127.0.0.1:5432/vinpoker_ops_expense_attribution',PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'3016'}});
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch(api,{signal:AbortSignal.timeout(500)})).status<500){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
 server=await createServer({configFile:'tests/financeExpenseAttribution/http.vite.config.ts'});await server.listen();browser=await chromium.launch({headless:true});let total=0;const observed=[];
 for(const width of [320,375,414,768,1280]){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'}),posts=[],errors=[];let lost=false;
  await page.addInitScript(value=>{window.__expenseInput=value;},{club,owner,jwt});page.on('pageerror',()=>errors.push('page_error'));
  await page.route('**/*',route=>route.request().url().startsWith(base)||route.request().url().startsWith('data:')?route.continue():route.abort());
  await page.route('**/rest/v1/rpc/record_club_expense',async route=>{
   posts.push(route.request().postDataJSON());if(!lost){lost=true;const reply=await route.fetch();assert.ok(reply.ok(),'original attributed expense must commit');return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'synthetic withheld acknowledgement'})});}return route.continue();
  });
  await page.goto(base+'/tests/financeExpenseAttribution/http.preview.html');await page.waitForFunction(()=>document.getElementById('total')?.textContent!=='Chưa xác minh');
  await page.getByLabel('Số tiền',{exact:true}).fill('100000');await page.getByLabel('Ngày',{exact:true}).fill('2026-11-25');await page.getByLabel('Mô tả',{exact:true}).fill(`TEST tournament expense ${width}`);
  await page.getByLabel('Phạm vi khoản chi',{exact:true}).selectOption('tournament');await page.getByRole('option',{name:'Attribution TEST tour A',exact:true}).waitFor({state:'attached'});
  assert.equal(await page.getByRole('option',{name:'Attribution TEST tour B',exact:true}).count(),0);
  await page.getByLabel('Giải nhận chi phí',{exact:true}).selectOption(id(71));await page.getByLabel('Đường dẫn chứng từ (nếu có)',{exact:true}).fill(`https://example.test/receipt-${width}.pdf`);
  await page.getByRole('button',{name:'Ghi chi phí',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(posts.length,1);
  await page.reload();await page.getByLabel('Số tiền',{exact:true}).waitFor();assert.equal(await page.getByLabel('Số tiền',{exact:true}).inputValue(),'100000');assert.equal(await page.getByLabel('Giải nhận chi phí',{exact:true}).inputValue(),id(71));
  assert.equal(await page.getByLabel('Đường dẫn chứng từ (nếu có)',{exact:true}).inputValue(),`https://example.test/receipt-${width}.pdf`);
  assert.equal(await page.getByRole('link',{name:'Mở giải đã chọn',exact:true}).getAttribute('href'),'/tournament/'+id(71));
  await page.screenshot({path:join(folder,`expense-${width}-pending.png`),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Ghi chi phí',exact:true}).click();await page.getByText('Đã ghi',{exact:true}).waitFor();assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1]);total+=100000;
  await page.waitForFunction(value=>document.getElementById('total')?.textContent===String(value),total);
  const recordedTour=page.locator('li').filter({hasText:`TEST tournament expense ${width}`});
  assert.equal(await recordedTour.getByRole('link',{name:'Mở giải đã liên kết',exact:true}).getAttribute('href'),'/tournament/'+id(71));
  assert.equal(await recordedTour.getByRole('link',{name:'Xem chứng từ',exact:true}).getAttribute('href'),`https://example.test/receipt-${width}.pdf`);
  assert.equal(sql(`SELECT count(*) FROM public.club_expenses WHERE idempotency_key='${posts[0].p_idempotency_key}' AND tournament_id='${id(71)}' AND series_id IS NULL AND attachment_url='https://example.test/receipt-${width}.pdf'`),'1');
  await page.getByLabel('Phạm vi khoản chi',{exact:true}).selectOption('series');await page.getByRole('option',{name:'Attribution TEST series A',exact:true}).waitFor({state:'attached'});await page.getByLabel('Series nhận chi phí',{exact:true}).selectOption(id(61));
  await page.getByLabel('Số tiền',{exact:true}).fill('200000');await page.getByLabel('Mô tả',{exact:true}).fill(`TEST series expense ${width}`);await page.getByRole('button',{name:'Ghi chi phí',exact:true}).click();
  total+=200000;await page.waitForFunction(value=>document.getElementById('total')?.textContent===String(value),total);
  const recordedSeries=page.locator('li').filter({hasText:`TEST series expense ${width}`});
  assert.equal(await recordedSeries.getByRole('link',{name:'Mở series đã liên kết',exact:true}).getAttribute('href'),'/series/'+id(61));
  assert.equal(posts[2].p_tournament_id,null);assert.equal(posts[2].p_series_id,id(61));
  await page.getByLabel('Phạm vi khoản chi',{exact:true}).selectOption('club');await page.getByLabel('Số tiền',{exact:true}).fill('300000');await page.getByLabel('Mô tả',{exact:true}).fill(`TEST common expense ${width}`);await page.getByRole('button',{name:'Ghi chi phí',exact:true}).click();total+=300000;
  await page.waitForFunction(value=>document.getElementById('total')?.textContent===String(value),total);assert.equal(posts[3].p_tournament_id,null);assert.equal(posts[3].p_series_id,null);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(folder,`expense-${width}-reported.png`),fullPage:true,animations:'disabled'});assert.deepEqual(errors,[]);observed.push({width,requests:posts.length,canonicalDocuments:3,reportTotal:total});await page.close();
 }
 const fingerprint=()=>sql(`SELECT md5(jsonb_agg(to_jsonb(e) ORDER BY id)::text) FROM public.club_expenses e`),before=fingerprint();
 for(const [key,value]of [['p_tournament_id',id(72)],['p_series_id',id(62)]]){
  const reply=await fetch(api+'/rpc/record_club_expense',{method:'POST',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${jwt}`},body:JSON.stringify({p_club_id:club,p_category:'misc',p_amount_vnd:100000,p_incurred_at:'2026-11-25T12:00:00+07:00',p_payment_status:'unpaid',p_idempotency_key:'deny-'+key,[key]:value})});assert.equal(reply.status,403);assert.equal((await reply.json()).code,'42501');
 }
 assert.equal(fingerprint(),before);assert.equal(sql('SELECT count(*) FROM public.club_expenses'),'15');assert.equal(sql(`SELECT sum(amount_vnd) FROM public.club_expenses WHERE club_id='${club}'`),'3000000');assert.equal(sql('SELECT count(*) FROM public.cashier_buyin_movements'),'0');
 writeFileSync(join(folder,'verification.json'),JSON.stringify({sourceSha:process.env.SOURCE_SHA,actualPostgrest:true,actualFormAndHooks:true,lostAcknowledgementRetryRetainsEvidence:true,foreignReferencesDeniedWithoutWrites:true,observed,documents:15,total:3000000,featureDefaultOff:true,productionMutation:false,productionCapacityClaim:false,scope:'isolated optional expense attribution; no approval/funding/recognition/evidence-content verification'}));console.log('EXPENSE_ATTRIBUTION_FORM_HTTP_REPORT_RETRY_FIVE_WIDTHS_PASS');
}catch(e){console.error('EXPENSE_ATTRIBUTION_FAILED',String(e.message).replaceAll(jwt,'[REDACTED]').replaceAll(secret,'[REDACTED]'));process.exitCode=1;}
finally{await browser?.close();await server?.close();spawnSync('docker',['rm','--force',container],{stdio:'ignore'});}
