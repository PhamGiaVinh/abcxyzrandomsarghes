import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHmac,randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';

assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'vinpoker_ops_payroll_period');
assert.ok(process.env.RUNNER_TEMP);
const id=n=>`18110000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const club=id(1),other=id(2),owner=id(11),otherOwner=id(12);
const secret=randomBytes(48).toString('hex'),api='http://127.0.0.1:3017',base='http://127.0.0.1:23867',container='payroll-period-http';
function command(program,args,options={}){
 const result=spawnSync(program,args,{encoding:'utf8',...options});
 if(result.status!==0)throw Error(program==='psql'?String(result.stderr).slice(0,1500):'isolated setup failure');
 return result.stdout.trim();
}
const sql=query=>command('psql',['-XqAt','-v','ON_ERROR_STOP=1','-c',query]);
const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function token(actor){const body=enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:actor,role:'authenticated',exp:Math.floor(Date.now()/1000)+1200});return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');}
const jwt=token(owner),otherJwt=token(otherOwner);
const folder=join(process.env.RUNNER_TEMP,'payroll-period-browser');mkdirSync(folder,{recursive:true});
let server,browser,lastPage;
const observed=[],faults=[];
try{
 const catalogFingerprint=()=>sql("SELECT md5(string_agg(pg_get_functiondef(p.oid),chr(10) ORDER BY p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN('f','p')");
 const originalCatalog=catalogFingerprint();
 sql(`DO $$ BEGIN IF current_database()<>'vinpoker_ops_payroll_period' OR EXISTS(SELECT FROM public.clubs) THEN RAISE EXCEPTION 'empty_owned_fixture_required';END IF;END $$;
 ALTER ROLE authenticator LOGIN NOINHERIT NOSUPERUSER;GRANT authenticated,anon TO authenticator;
 CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$ SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $auth$;
 INSERT INTO auth.users(id) VALUES('${owner}'),('${otherOwner}');
 INSERT INTO public.profiles(user_id,display_name) VALUES('${owner}','Period TEST owner A'),('${otherOwner}','Period TEST owner B');
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${club}','${owner}','Period TEST A','TEST','approved'),('${other}','${otherOwner}','Period TEST B','TEST','approved');
 INSERT INTO public.club_accountants(club_id,user_id,granted_by) VALUES('${other}','${owner}','${otherOwner}');
 INSERT INTO public.staff(id,club_id,full_name,department,employment_type,monthly_salary_vnd,manual_bhxh_vnd,manual_tax_vnd,status)
 VALUES('${id(21)}','${club}','Period TEST staff A','service','full_time',2600000,0,0,'active'),('${id(22)}','${other}','Period TEST staff B','service','full_time',7800000,0,0,'active');
 INSERT INTO public.staff_attendance(id,staff_id,shift_date,status,check_in_time,check_out_time) VALUES
 ('${id(31)}','${id(21)}','2024-02-10','checked_out','2024-02-10T10:00:00+07:00','2024-02-10T18:00:00+07:00'),
 ('${id(32)}','${id(21)}','2024-03-10','checked_out','2024-03-10T10:00:00+07:00','2024-03-10T18:00:00+07:00'),
 ('${id(33)}','${id(21)}','2024-03-11','checked_out','2024-03-11T10:00:00+07:00','2024-03-11T18:00:00+07:00'),
 ('${id(34)}','${id(22)}','2024-02-10','checked_out','2024-02-10T10:00:00+07:00','2024-02-10T18:00:00+07:00');`);
 const receipts=[];
 for(const [clubId,month,end,expected] of [[club,2,'2024-02-29',100000],[club,3,'2024-03-31',200000],[other,2,'2024-02-29',300000]]){
  const start=`2024-${String(month).padStart(2,'0')}-01`;
  const receipt=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${owner}';SET LOCAL request.jwt.claims='{"sub":"${owner}","role":"authenticated"}';SET LOCAL ROLE authenticated;
   SELECT public.chot_staff_salary_month('${clubId}',2024,${month});COMMIT;`));
  assert.equal(receipt.status,'ok');assert.equal(Number(receipt.total_net_vnd),expected,'canonical payroll fixture amount');
  const saved=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${owner}';SET LOCAL request.jwt.claims='{"sub":"${owner}","role":"authenticated"}';SET LOCAL ROLE authenticated;
   SELECT public.save_payroll_period_v2('${clubId}',2024,${month},'${start}','${end}','[]','${id(40+receipts.length)}');COMMIT;`));
  assert.equal(saved.outcome,'saved');receipts.push({club:clubId,year:2024,month,staffNet:expected,dealerSaved:saved.periodId??saved.period_id??null});
 }
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
 'staff',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.staff s),
 'attendance',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.staff_attendance s),
 'staffRuns',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.staff_salary_runs s),
 'staffPeriods',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.staff_salary_periods s),
 'dealerPeriods',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.payroll_periods s),
 'dealerRows',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_payroll s),
 'payments',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.payment_records s),
 'cash',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.cashier_buyin_movements s))::text)`);
 const before=fingerprint();
 command('docker',['run','--detach','--name',container,'--network','host',...['PGRST_DB_URI','PGRST_DB_SCHEMAS','PGRST_DB_ANON_ROLE','PGRST_JWT_SECRET','PGRST_SERVER_HOST','PGRST_SERVER_PORT'].flatMap(key=>['-e',key]),'postgrest/postgrest:v13.0.7'],{
  env:{...process.env,PGRST_DB_URI:'postgres://authenticator@127.0.0.1:5432/vinpoker_ops_payroll_period',PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'3017'},
 });
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch(api,{signal:AbortSignal.timeout(500)})).status<500){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,500));}assert.ok(ready,'isolated API ready');
 server=await createServer({configFile:'tests/financePayrollPeriod/http.vite.config.ts'});await server.listen();browser=await chromium.launch({headless:true});
 for(const width of [320,375,414,768,1280]){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'}),reads=[],errors=[];
  lastPage=page;
  await page.addInitScript(value=>{window.__payrollPeriodInput=value;},{owner,jwt});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{
   if(request.url().includes('/rest/v1/'))reads.push({method:request.method(),path:new URL(request.url()).pathname,args:request.method()==='POST'?request.postDataJSON():Object.fromEntries(new URL(request.url()).searchParams)});
  });
  await page.route('**/*',route=>route.request().url().startsWith(base)||route.request().url().startsWith('data:')?route.continue():route.abort());
  const route=`${base}/tests/financePayrollPeriod/http.preview.html?club=${club}&from=2024-02-02&to=2024-02-20`;
  await page.goto(route);await page.getByText('Period TEST staff A',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Kỳ lương',{exact:true}).inputValue(),'2024-02');
  assert.ok((await page.locator('body').innerText()).includes('100.000'));
  await page.getByText(/không tính lại lương theo khoảng ngày/).waitFor();
  await page.screenshot({path:join(folder,`payroll-${width}-february.png`),fullPage:true,animations:'disabled'});
  await page.getByLabel('Kỳ lương',{exact:true}).fill('2024-03');
  await page.getByRole('heading',{name:'Bảng lương 03/2024',exact:true}).waitFor();
  await page.waitForFunction(()=>document.body.innerText.includes('200.000'));
  assert.equal(new URL(page.url()).searchParams.get('from'),'2024-03-01');assert.equal(new URL(page.url()).searchParams.get('to'),'2024-03-31');
  await page.getByRole('button',{name:'Dealer',exact:true}).click();
  await page.getByText('Chưa có dữ liệu lương cho tháng này',{exact:true}).waitFor();
  assert.ok(reads.some(read=>read.path.endsWith('/calculate_club_payroll')&&read.args.p_club_id===club&&read.args.p_start_date==='2024-03-01'&&read.args.p_end_date==='2024-03-31'));
  assert.ok(reads.some(read=>read.path.endsWith('/payroll_periods')&&read.args.club_id===`eq.${club}`&&read.args.period_month==='eq.3'&&read.args.period_year==='eq.2024'));
  const februaryPeriod=page.waitForResponse(response=>response.url().includes('/payroll_periods?')&&new URL(response.url()).searchParams.get('period_month')==='eq.2'&&response.ok());
  await page.getByLabel('Kỳ lương',{exact:true}).fill('2024-02');
  await page.waitForFunction(()=>document.querySelector('input[type="month"]')?.value==='2024-02');
  await februaryPeriod;
  await page.getByText('Chưa có dữ liệu lương cho tháng này',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Nhân viên',exact:true}).click();await page.getByText('Period TEST staff A',{exact:true}).waitFor();
  await page.getByRole('combobox').click();await page.getByRole('option',{name:'Period TEST B',exact:true}).click();
  await page.getByText('Period TEST staff B',{exact:true}).waitFor();assert.equal(await page.getByText('Period TEST staff A',{exact:true}).count(),0);
  assert.ok((await page.locator('body').innerText()).includes('300.000'));assert.equal(new URL(page.url()).searchParams.get('club'),other);
  await page.screenshot({path:join(folder,`payroll-${width}-club-b.png`),fullPage:true,animations:'disabled'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'payroll viewport fits');
  assert.deepEqual(errors,[]);assert.ok(reads.some(read=>read.path.endsWith('/get_staff_salary_report')&&read.args.p_club_id===club&&read.args.p_year===2024&&read.args.p_month===2));
  assert.ok(reads.some(read=>read.path.endsWith('/get_staff_salary_report')&&read.args.p_club_id===club&&read.args.p_year===2024&&read.args.p_month===3));
  assert.ok(reads.some(read=>read.path.endsWith('/get_staff_salary_report')&&read.args.p_club_id===other&&read.args.p_year===2024&&read.args.p_month===2));
  assert.ok(reads.every(read=>read.method==='GET'||['get_my_ops_capability_scope','get_my_ops_global_capability','get_accountant_capabilities','get_my_floor_operator_scope','dealer_control_club_ids','get_staff_salary_report','get_staff_salary_month','calculate_club_payroll'].includes(read.path.split('/').at(-1))),'browser sends read-only requests');
  observed.push({width,staffMonths:[2,3],clubs:[club,other],staffNets:[100000,200000,300000],dealerSavedMonthFilters:[2,3],browserReads:reads});await page.close();
 }
 const page=await browser.newPage({viewport:{width:375,height:1000},reducedMotion:'reduce'});lastPage=page;
 await page.addInitScript(value=>{window.__payrollPeriodInput=value;},{owner,jwt});
 await page.route('**/*',route=>route.request().url().startsWith(base)||route.request().url().startsWith('data:')?route.continue():route.abort());
 let salaryReads=0;page.on('request',request=>{if(request.url().includes('/rpc/get_staff_salary_'))salaryReads++;});
 await page.goto(`${base}/tests/financePayrollPeriod/http.preview.html?club=${club}&from=2024-02-02&to=2024-03-20`);
 await page.getByRole('alert').filter({hasText:'Khoảng ngày trải qua nhiều tháng'}).waitFor();
 assert.equal(salaryReads,0,'unresolved multi-month range must not load current payroll');
 await page.getByLabel('Kỳ lương',{exact:true}).fill('2024-03');await page.getByText('Period TEST staff A',{exact:true}).waitFor();
 await page.waitForFunction(()=>document.body.innerText.includes('200.000'));await page.close();
 const delayed=await browser.newPage({viewport:{width:375,height:1000},reducedMotion:'reduce'});lastPage=delayed;
 await delayed.addInitScript(value=>{window.__payrollPeriodInput=value;},{owner,jwt});
 await delayed.route('**/*',route=>route.request().url().startsWith(base)||route.request().url().startsWith('data:')?route.continue():route.abort());
 let release;const hold=new Promise(resolve=>{release=resolve;});let held;const pending=new Promise(resolve=>{held=resolve;});let first=true;
 await delayed.route('**/rest/v1/rpc/get_staff_salary_report',async route=>{
  if(first&&route.request().postDataJSON().p_month===2){first=false;const response=await route.fetch();assert.ok(response.ok());held();await hold;return route.fulfill({response});}
  return route.continue();
 });
 await delayed.goto(`${base}/tests/financePayrollPeriod/http.preview.html?club=${club}&from=2024-02-01&to=2024-02-29`);
 let pendingTimer;try{await Promise.race([pending,new Promise((_,reject)=>{pendingTimer=setTimeout(()=>reject(Error('original February request was not held')),15000);})]);}finally{clearTimeout(pendingTimer);}
 await delayed.getByLabel('Kỳ lương',{exact:true}).fill('2024-03');
 await delayed.waitForFunction(()=>document.body.innerText.includes('200.000'));
 const oldReply=delayed.waitForResponse(response=>response.url().endsWith('/rpc/get_staff_salary_report')&&response.request().postDataJSON().p_month===2);
 release();await oldReply;await delayed.getByRole('heading',{name:'Bảng lương 03/2024',exact:true}).waitFor();
 // Wait for the original HTTP response to be consumed, then inspect the rendered amount.
 await delayed.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.ok(!(await delayed.locator('body').innerText()).includes('100.000'),'late February response cannot replace March');
 await delayed.screenshot({path:join(folder,'payroll-375-stale-february-ignored.png'),fullPage:true,animations:'disabled'});await delayed.close();
 const denied=await fetch(api+'/rpc/get_staff_salary_report',{method:'POST',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${otherJwt}`},body:JSON.stringify({p_club_id:club,p_year:2024,p_month:2})});
 assert.equal(denied.status,403);assert.equal((await denied.json()).code,'42501');
 assert.equal(fingerprint(),before,'browser readers and denied actor must not change any payroll/payment/cash facts');
 assert.equal(catalogFingerprint(),originalCatalog,'all captured public functions must remain unchanged');
 writeFileSync(join(folder,'verification.json'),JSON.stringify({sourceSha:process.env.SOURCE_SHA,productSha:process.env.PRODUCT_SHA,actualParentStaffDealerHooks:true,actualPostgrest:true,originalCapturedPublicFunctions:true,fixtures:receipts,observed,multipleMonthsRequireSelection:true,lateOriginalFebruaryReplyIgnored:true,foreignActorDenied:true,monetaryFactsUnchanged:true,productionMutation:false,productionCapacityClaim:false,scope:'isolated historical payroll scope; synthetic auth bootstrap; empty canonical dealer periods; no payroll writer/payment/hosted TEST/full TC2 or TC6 acceptance'}));
 console.log('PAYROLL_PERIOD_ACTUAL_BROWSER_API_FIVE_WIDTHS_PASS');
}catch(error){
 if(lastPage&&!lastPage.isClosed())await lastPage.screenshot({path:join(folder,'failure.png'),fullPage:true,animations:'disabled'}).catch(()=>{});
 faults.push(String(error.message).replaceAll(jwt,'[REDACTED]').replaceAll(otherJwt,'[REDACTED]').replaceAll(secret,'[REDACTED]'));
 writeFileSync(join(folder,'failure.json'),JSON.stringify({sourceSha:process.env.SOURCE_SHA,productSha:process.env.PRODUCT_SHA,faults,productionMutation:false}));
 console.error('PAYROLL_PERIOD_FAILED',faults[0]);process.exitCode=1;
}finally{await browser?.close();await server?.close();spawnSync('docker',['rm','--force',container],{stdio:'ignore'});}
