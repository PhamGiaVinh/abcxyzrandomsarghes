import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {randomBytes,createHmac,createHash} from 'node:crypto';import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {createServer} from 'vite';import {chromium} from 'playwright';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGDATABASE,'vinpoker_ops_pt_cash_client');assert.ok(process.env.RUNNER_TEMP);
const file='supabase/pending-migrations/20261126001901_finance_pt_cash_drawer_link_v1.sql';
assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),process.env.SQL_SHA256);
const api='http://127.0.0.1:3019',base='http://127.0.0.1:23869',container='pt-cash-client-http',secret=randomBytes(48).toString('hex'),tokens=[];
const id=n=>`18130000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function token(actor){const body=enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:actor,role:'authenticated',exp:Math.floor(Date.now()/1000)+1200}),t=body+'.'+createHmac('sha256',secret).update(body).digest('base64url');tokens.push(t);return t;}
function sql(query){const r=spawnSync('psql',['-XqAt','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'});if(r.status!==0)throw Error(String(r.stderr).slice(0,1800));return r.stdout.trim();}
async function request(name,args,actor){const reply=await fetch(api+'/rpc/'+name,{method:'POST',signal:AbortSignal.timeout(12000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${token(actor)}`},body:JSON.stringify(args)});return {status:reply.status,data:await reply.json()};}
async function rpc(name,args,actor){const r=await request(name,args,actor);assert.equal(r.status,200,name+': HTTP');assert.equal(r.data.error,undefined,name+': refused');return r.data;}
async function open(f){const r=await rpc('cashier_open_shift_v1',{p_club_id:f.club,p_opening_cash:10000000},f.cashier);assert.equal(r.ok,true);f.shift=r.shift_id;return r;}
async function seed(index,{opened=true,finalized=false,enabled=true}={}){
 const k=index*10000,f={club:id(k+1),owner:id(k+2),cashier:id(k+3),employee:id(k+4),dealer:id(k+5),request:id(k+6)};
 sql(`INSERT INTO auth.users(id) VALUES('${f.owner}'),('${f.cashier}'),('${f.employee}');
 INSERT INTO public.profiles(user_id,display_name) VALUES('${f.owner}','PT client TEST owner ${index}'),('${f.cashier}','PT client TEST cashier ${index}'),('${f.employee}','PT client TEST employee ${index}');
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${f.club}','${f.owner}','PT client TEST ${index}','TEST','approved');
 INSERT INTO public.club_cashiers(club_id,user_id) VALUES('${f.club}','${f.cashier}');
 INSERT INTO public.cashier_tour_settings(club_id,enabled,pt_cash_drawer_link_enabled) VALUES('${f.club}',true,${enabled});
 SET request.jwt.claim.sub='${f.owner}';
 INSERT INTO public.dealers(id,club_id,user_id,full_name,status,employment_type,hourly_rate_vnd) VALUES('${f.dealer}','${f.club}','${f.employee}','PT client TEST dealer ${index}','active','part_time',50000);
 INSERT INTO public.dealer_pt_wage_rate_history(dealer_id,hourly_rate_vnd,pt_eligible,effective_from,changed_by) VALUES('${f.dealer}',50000,true,'2026-11-01T00:00:00+07:00','${f.owner}');
 INSERT INTO public.dealer_attendance(dealer_id,shift_date,status,current_state,check_in_time,check_out_time)
 SELECT '${f.dealer}',day::date,'checked_out','checked_out',day::timestamptz+interval '8 hours',day::timestamptz+interval '28 hours' FROM generate_series('2026-11-01'::date,'2026-11-05'::date,interval '1 day') AS days(day);`);
 if(opened)await open(f);
 if(finalized){const r=await rpc('finalize_part_time_payroll_statement',{p_request_id:f.request,p_club_id:f.club,p_dealer_id:f.dealer,p_reason:'TEST actual payment client qualification'},f.owner);assert.equal(r.net_amount_vnd,5000000);f.statement=r.statement_id;}
 return f;
}
const dailyArgs=(f,method='cash')=>({p_dealer_id:f.dealer,p_payment_method:method,p_payment_reference:'TEST manual receipt',p_idempotency_key:'daily-'+f.dealer,p_note:'Isolated additional writer proof'});
const payments=f=>JSON.parse(sql(`SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.dealer_pt_wage_payments p WHERE dealer_id='${f.dealer}'`));
const movements=f=>JSON.parse(sql(`SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]') FROM public.cashier_buyin_movements m WHERE club_id='${f.club}'`));
const folder=join(process.env.RUNNER_TEMP,'pt-cash-client');mkdirSync(folder,{recursive:true});
const proof={sourceSha:process.env.SOURCE_SHA,productSha:process.env.PRODUCT_SHA,migrationSha256:process.env.SQL_SHA256,daily:[],browser:[],productionMutation:false,productionCapacityClaim:false};let browser,server,livePage;
try{
 assert.equal(sql('SELECT count(*) FROM public.clubs'),'0');
 const dailyBody=sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pay_part_time_balance(uuid,text,text,text,text)'::regprocedure");assert.equal(dailyBody,'d7e35351a46bd499101d2ff86ce95476');
 const apply=spawnSync('psql',['-Xq','-v','ON_ERROR_STOP=1','--single-transaction','-f',file],{encoding:'utf8'});assert.equal(apply.status,0,String(apply.stderr).slice(0,1800));
 sql(`ALTER ROLE authenticator LOGIN NOINHERIT NOSUPERUSER;GRANT authenticated,anon TO authenticator;
 CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$ SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $auth$;`);
 const docker=spawnSync('docker',['run','--detach','--name',container,'--network','host',...['PGRST_DB_URI','PGRST_DB_SCHEMAS','PGRST_DB_ANON_ROLE','PGRST_JWT_SECRET','PGRST_SERVER_HOST','PGRST_SERVER_PORT'].flatMap(key=>['-e',key]),'postgrest/postgrest:v13.0.7'],{encoding:'utf8',env:{...process.env,PGRST_DB_URI:'postgres://authenticator@127.0.0.1:5432/vinpoker_ops_pt_cash_client',PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'3019'}});assert.equal(docker.status,0);
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch(api,{signal:AbortSignal.timeout(500)})).status<500){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,500));}assert.ok(ready);
 const cash=await seed(1),args=dailyArgs(cash),paid=await rpc('pay_part_time_balance',args,cash.cashier);assert.equal(paid.amount_vnd,5000000);assert.equal(payments(cash).length,1);assert.equal(movements(cash).length,1);assert.equal(movements(cash)[0].dealer_pt_wage_payment_id,paid.payment_id);assert.equal(movements(cash)[0].shift_id,cash.shift);
 const closed=await rpc('cashier_close_shift_v1',{p_shift_id:cash.shift,p_counted_cash:5000000},cash.cashier);assert.equal(closed.expected_cash,5000000);assert.equal(closed.variance_cash,0);
 const replay=await rpc('pay_part_time_balance',args,cash.cashier);assert.equal(replay.payment_id,paid.payment_id);assert.equal(replay.idempotent,true);assert.equal(movements(cash).length,1);proof.daily.push({name:'legacy-daily-cash-close-and-retry',amount:paid.amount_vnd,movements:1,variance:closed.variance_cash});
 const bank=await seed(2),bankPaid=await rpc('pay_part_time_balance',dailyArgs(bank,'bank'),bank.cashier),bankRows=payments(bank);assert.equal(bankPaid.amount_vnd,5000000);assert.equal(bankRows.length,1);assert.equal(bankRows[0].id,bankPaid.payment_id);assert.equal(bankRows[0].payment_method,'bank');assert.equal(bankRows[0].amount_vnd,5000000);assert.equal(bankRows[0].cashier_shift_id,null);assert.equal(movements(bank).length,0);const bankClose=await rpc('cashier_close_shift_v1',{p_shift_id:bank.shift,p_counted_cash:10000000},bank.cashier);assert.equal(bankClose.expected_cash,10000000);proof.daily.push({name:'legacy-daily-bank',cashExpected:bankClose.expected_cash,paymentAmount:bankRows[0].amount_vnd,paymentRows:1,paymentMethod:bankRows[0].payment_method,sourceShift:null,movements:0});
 const none=await seed(3,{opened:false}),noneArgs=dailyArgs(none),noTill=await request('pay_part_time_balance',noneArgs,none.cashier);assert.equal(noTill.data.code,'55000');assert.notEqual(noTill.status,200);assert.equal(payments(none).length,0);assert.equal(movements(none).length,0);await open(none);await rpc('pay_part_time_balance',noneArgs,none.cashier);assert.equal(payments(none).length,1);assert.equal(movements(none).length,1);proof.daily.push({name:'legacy-daily-missing-till-rollback-recovery',beforePayments:0,afterPayments:1,movements:1});
 const legacy=await seed(4,{opened:false,enabled:false});const old=await rpc('pay_part_time_balance',dailyArgs(legacy),legacy.cashier);assert.equal(movements(legacy).length,0);const before=payments(legacy)[0];sql(`UPDATE public.dealer_pt_wage_payments SET voided_at=clock_timestamp(),voided_by='${legacy.owner}' WHERE id='${old.payment_id}'`);const after=payments(legacy)[0];assert.ok(after.voided_at);assert.equal(after.voided_by,legacy.owner);assert.equal(after.cashier_shift_id,null);for(const key of Object.keys(before).filter(key=>!['voided_at','voided_by'].includes(key)))assert.deepEqual(after[key],before[key]);proof.daily.push({name:'unlinked-legacy-void-guard-compatible',movementCount:0,sourceStillNull:true});
 const foreign=await request('pay_part_time_balance',args,bank.cashier);assert.equal(foreign.status,403);assert.equal(payments(cash).length,1);proof.daily.push({name:'legacy-daily-foreign-actor-denied',status:foreign.status});
 server=await createServer({configFile:'tests/financePtCashClient/http.vite.config.ts'});await server.listen();browser=await chromium.launch({headless:true});let fixture=100;
 for(const width of [320,375,414,768,1280])for(const scenario of ['missing-till-reload-retry','committed-lost-ack']){
  const f=await seed(fixture++,{opened:scenario==='committed-lost-ack',finalized:true}),page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});livePage=page;const writes=[],errors=[];let withheld=false;
  page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(r.url().endsWith('/rpc/pay_finalized_part_time_payroll_statement'))writes.push(r.postDataJSON());});
  await page.addInitScript(input=>{window.__ptCashClient=input;},{club:f.club,dealer:f.dealer,actor:f.cashier,jwt:token(f.cashier),from:'2026-11-01T00:00:00+07:00',to:'2026-12-01T00:00:00+07:00'});
  await page.route('**/*',route=>route.request().url().startsWith(base)||route.request().url().startsWith('data:')?route.continue():route.abort());
  if(scenario==='committed-lost-ack')await page.route('**/rest/v1/rpc/pay_finalized_part_time_payroll_statement',async route=>{if(!withheld){withheld=true;const reply=await route.fetch();assert.ok(reply.ok(),'actual payment must commit before withholding its acknowledgement');return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'TEST withheld committed acknowledgement'})});}return route.continue();});
  await page.goto(base+'/tests/financePtCashClient/http.preview.html');await page.getByRole('button',{name:'Phát lương và tất toán',exact:true}).click();
  await page.getByLabel('Mã tham chiếu chi PT',{exact:true}).fill('TEST client '+width);
  await page.getByRole('button',{name:'Xác nhận phát lương',exact:true}).click();
  if(scenario==='missing-till-reload-retry'){
   await page.getByRole('alert').filter({hasText:'Chưa xác minh được khoản chi'}).waitFor();assert.equal(writes.length,1);assert.equal(payments(f).length,0);assert.equal(movements(f).length,0);
   const journalKey=`vinpoker:pt-statement-payment:v1:${f.cashier}:${f.club}:${f.dealer}`;
   const retained=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),journalKey);assert.equal(retained.key,writes[0].p_idempotency_key);assert.equal(retained.method,'cash');assert.equal(retained.reference,'TEST client '+width);assert.equal(retained.statement.statement_id,f.statement);
   await page.screenshot({path:join(folder,`pt-client-${width}-pending.png`),fullPage:true,animations:'disabled'});
   await page.reload();const retry=page.getByRole('button',{name:'Kiểm tra khoản chi PT đã lưu',exact:true});await retry.waitFor();
   const reloaded=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),journalKey);assert.deepEqual(reloaded,retained);
   await open(f);await retry.click();
  }
  const status=page.getByRole('status').filter({hasText:'Phiếu đã chốt:'});await status.getByText(/Còn phải trả: 0/).waitFor();assert.ok((await status.innerText()).includes('Đã ghi nhận chi'));
  await page.getByText('Lương dealer PT có chứng từ chi từ két',{exact:true}).waitFor();await page.getByText('5.000.000 VND',{exact:true}).waitFor();
  const saved=payments(f),cashRows=movements(f);assert.equal(saved.length,1);assert.equal(cashRows.length,1);assert.equal(saved[0].amount_vnd,5000000);assert.equal(saved[0].statement_id,f.statement);assert.equal(cashRows[0].dealer_pt_wage_payment_id,saved[0].id);assert.equal(cashRows[0].shift_id,f.shift);assert.equal(cashRows[0].amount,5000000);
  assert.equal(writes.length,scenario==='missing-till-reload-retry'?2:1);if(writes.length===2)assert.deepEqual(writes[1],writes[0]);
  assert.equal(await page.evaluate(({actor,club,dealer})=>sessionStorage.getItem(`vinpoker:pt-statement-payment:v1:${actor}:${club}:${dealer}`),{actor:f.cashier,club:f.club,dealer:f.dealer}),null);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await page.screenshot({path:join(folder,`pt-client-${width}-${scenario}-paid.png`),fullPage:true,animations:'disabled'});
  const count=writes.length;await page.reload();await page.getByRole('status').filter({hasText:'Phiếu đã chốt:'}).getByText(/Còn phải trả: 0/).waitFor();assert.equal(writes.length,count,'paid page reload sends no new payment');
  proof.browser.push({width,scenario,paymentRequests:writes.length,paymentRows:1,cashMovementRows:1,amount:5000000,sameIntentPreserved:true,paidReadbackVerified:true,reloadNoWrite:true});await page.close();
 }
 assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pay_part_time_balance(uuid,text,text,text,text)'::regprocedure"),dailyBody);
 proof.actualLegacyDailyRpc=true;proof.actualPaymentComponent=true;proof.actualPostgrest=true;proof.scope='additional daily PT writer and isolated payment component recovery; drawer opening is actual HTTP setup, not complete workbench UI; no hosted/full TC2/approval-limit/accrual/capacity claim';writeFileSync(join(folder,'verification.json'),JSON.stringify(proof));console.log('PT_DAILY_WRITER_AND_ACTUAL_PAYMENT_CLIENT_RECOVERY_PASS');
}catch(error){let message=String(error.message).replaceAll(secret,'[REDACTED]');for(const t of tokens)message=message.replaceAll(t,'[REDACTED]');if(livePage&&!livePage.isClosed())await livePage.screenshot({path:join(folder,'failure.png'),fullPage:true}).catch(()=>{});writeFileSync(join(folder,'failure.json'),JSON.stringify({...proof,error:message}));console.error('PT_CASH_CLIENT_FAILED',message);process.exitCode=1;}
finally{await browser?.close();await server?.close();spawnSync('docker',['rm','--force',container],{stdio:'ignore'});}
