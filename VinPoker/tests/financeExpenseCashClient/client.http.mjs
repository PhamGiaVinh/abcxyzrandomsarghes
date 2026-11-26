import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes,createHmac,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'vinpoker_ops_expense_cash_client');
assert.ok(process.env.RUNNER_TEMP);
const sqlFiles=[
 ['supabase/migrations/20270128000354_finance_expense_scope_idempotency.sql','4c7615860dba50225a6507f6b2db378f417701a3968bb0063414bdad1ac62632'],
 ['supabase/pending-migrations/20261126001901_finance_pt_cash_drawer_link_v1.sql','44106b5d3500dbb9c1b2f4d3a1feecfc6c83f1ff018266e1951f32d8b5eb2dcb'],
 ['supabase/pending-migrations/20261126011530_finance_expense_cash_source_v1.sql','34464adca0c8546bae2e7b81dee1fee43dbd50c2c44dc68be00b5fd0102e92bf'],
 ['supabase/pending-migrations/20261126023026_finance_expense_cash_source_status_v1.sql','28287f7df15621f00c8e5edd9ebd233d2822eead10af96807bca9fbe0840f914'],
 ['supabase/pending-migrations/20261126071752_finance_expense_club_authority_v1.sql','af120dd8ba5cf4ec3aae0700522bb3028915237811a39d591381130841355f46'],
];
for(const [file,hash] of sqlFiles)assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),hash);
const api='http://127.0.0.1:3021',base='http://127.0.0.1:23870',container='expense-cash-client-http';
const secret=randomBytes(48).toString('hex'),tokens=[];
const folder=join(process.env.RUNNER_TEMP,'expense-cash-client');mkdirSync(folder,{recursive:true});
const proof={sourceSha:process.env.SOURCE_SHA,baselineBackendSha:'aca9e00c2fe9a3b0cc1a028bd70c40c4ba48a1e8',baselineBackendRun:'45736731928',authoritySqlSha256:sqlFiles[4][1],sqlSha256:sqlFiles[2][1],browser:[],productionMutation:false,productionCapacityClaim:false};
const id=n=>`18140000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function sql(query){const r=spawnSync('psql',['-XqAt','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'});assert.equal(r.status,0,String(r.stderr).slice(0,1600));return r.stdout.trim();}
const read=q=>JSON.parse(sql(q));
function token(actor){const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),body=enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:actor,role:'authenticated',exp:Math.floor(Date.now()/1000)+1800});const t=body+'.'+createHmac('sha256',secret).update(body).digest('base64url');tokens.push(t);return t;}
async function request(name,args,actor){const r=await fetch(api+'/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token(actor)}`},body:JSON.stringify(args),signal:AbortSignal.timeout(12000)});return {status:r.status,data:await r.json()};}
async function rpc(name,args,actor){const r=await request(name,args,actor);assert.equal(r.status,200,name+': HTTP');assert.equal(r.data.error,undefined);return r.data;}
async function open(f){const r=await rpc('cashier_open_shift_v1',{p_club_id:f.club,p_opening_cash:10000000},f.cashier);assert.equal(r.ok,true);f.shift=r.shift_id;}
async function seed(index){const f={club:id(index*10+1),owner:id(index*10+2),cashier:id(index*10+3),accountant:id(index*10+4)};
 sql(`INSERT INTO auth.users(id) VALUES('${f.owner}'),('${f.cashier}'),('${f.accountant}');
 INSERT INTO public.profiles(user_id,display_name) VALUES('${f.owner}','Expense UI TEST owner ${index}'),('${f.cashier}','Expense UI TEST cashier ${index}'),('${f.accountant}','Expense UI TEST accountant ${index}');
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${f.club}','${f.owner}','Expense UI TEST ${index}','TEST','approved');
 INSERT INTO public.club_cashiers(club_id,user_id) VALUES('${f.club}','${f.cashier}');
 INSERT INTO public.club_accountants(club_id,user_id,granted_by) VALUES('${f.club}','${f.accountant}','${f.owner}');
 INSERT INTO public.cashier_tour_settings(club_id,enabled,expense_cash_source_enabled) VALUES('${f.club}',true,true);`);
 await open(f);return f;
}
function facts(f){return read(`SELECT jsonb_build_object('expenses',(SELECT count(*) FROM public.club_expenses WHERE club_id='${f.club}'),'receipts',(SELECT count(*) FROM public.finance_expense_cash_receipts WHERE club_id='${f.club}'),'movements',(SELECT count(*) FROM public.cashier_buyin_movements WHERE club_id='${f.club}'))`);}
const one=f=>assert.deepEqual(facts(f),{expenses:1,receipts:1,movements:1});
const zero=f=>assert.deepEqual(facts(f),{expenses:0,receipts:0,movements:0});
const journal=(page,f)=>page.evaluate(key=>sessionStorage.getItem(key),`vinpoker:cashier-expense:v1:${f.cashier}:${f.club}`);
let browser,server,livePage;
try{
 // Authority SQL changed: every client case runs on this source; no prior case is reused.
 assert.equal(sql('SELECT count(*) FROM public.clubs'),'0');
 for(const [file] of sqlFiles){const r=spawnSync('psql',['-Xq','-v','ON_ERROR_STOP=1','--single-transaction','-f',file],{encoding:'utf8'});assert.equal(r.status,0,String(r.stderr).slice(0,1600));}
 proof.statusReaderSqlSha256=sqlFiles[3][1];
 assert.equal(sql("SELECT has_table_privilege('authenticated','public.cashier_tour_settings','SELECT')"),'f');
 assert.equal(sql("SELECT has_function_privilege('anon','public.cashier_expense_source_status_v1(uuid)','EXECUTE') OR has_function_privilege('service_role','public.cashier_expense_source_status_v1(uuid)','EXECUTE')"),'f');
 // The terminal-absence client proof depends on these real RLS policies, not
 // merely on a receipt being absent from an independently timed request.
 const policies=read(`SELECT jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'roles',roles,'permissive',permissive,'cmd',cmd,'qual',qual)) FROM pg_policies WHERE schemaname='public' AND tablename IN('cashier_till_shifts','club_expenses','finance_expense_cash_receipts','clubs') AND cmd='SELECT'`);
 const tillPolicies=policies.filter(p=>p.table==='cashier_till_shifts');assert.equal(tillPolicies.length,1);
 assert.deepEqual(tillPolicies[0],{table:'cashier_till_shifts',name:'cashier_till_staff_read',roles:['authenticated'],permissive:'PERMISSIVE',cmd:'SELECT',qual:'is_club_cashier(( SELECT auth.uid() AS uid), club_id)'});
 proof.lookupRls=policies;
 sql(`ALTER ROLE authenticator LOGIN NOINHERIT NOSUPERUSER;GRANT authenticated,anon TO authenticator;
 CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$ SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $auth$;`);
 const d=spawnSync('docker',['run','--detach','--name',container,'--network','host',...['PGRST_DB_URI','PGRST_DB_SCHEMAS','PGRST_DB_ANON_ROLE','PGRST_JWT_SECRET','PGRST_SERVER_HOST','PGRST_SERVER_PORT'].flatMap(k=>['-e',k]),'postgrest/postgrest:v13.0.7'],{encoding:'utf8',env:{...process.env,PGRST_DB_URI:'postgres://authenticator@127.0.0.1:5432/vinpoker_ops_expense_cash_client',PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'3021'}});assert.equal(d.status,0,'isolated API startup');
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch(api,{signal:AbortSignal.timeout(500)})).status<500){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
 server=await createServer({configFile:'tests/financeExpenseCashClient/http.vite.config.ts'});await server.listen();browser=await chromium.launch({headless:true});let index=100;
 for(const width of [320,375,414,768,1280])for(const scenario of ['committed-lost-ack','pending-reload-same-intent','closed-before-submit','revoked-unknown']){
  const f=await seed(index++),page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});livePage=page;
  const writes=[],lookups=[],errors=[];let first=true,denyLookup=scenario==='pending-reload-same-intent';
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/rpc/record_cashier_club_expense_v1'))writes.push(r.postDataJSON());if(r.url().includes('receipts%3A')||decodeURIComponent(r.url()).includes('receipts:'))lookups.push(r.url());});
  await page.addInitScript(input=>{window.__expenseCashInput=input;},{club:f.club,actor:f.cashier,jwt:token(f.cashier),from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+86400000).toISOString()});
  await page.route('**/*',route=>route.request().url().startsWith(base)||route.request().url().startsWith('data:')?route.continue():route.abort());
  await page.route('**/rest/v1/cashier_till_shifts?**',route=>decodeURIComponent(route.request().url()).includes('receipts:')&&denyLookup?route.fulfill({status:503,contentType:'application/json',body:'{"message":"TEST interrupted read"}'}):route.continue());
  await page.route('**/rest/v1/rpc/record_cashier_club_expense_v1',async route=>{
   if(!first)return route.continue();first=false;
   if(scenario==='closed-before-submit'){
    const closed=await rpc('cashier_close_shift_v1',{p_shift_id:f.shift,p_counted_cash:10000000},f.cashier);assert.equal(closed.variance_cash,0);
    return route.continue();
   }
   const response=await route.fetch();assert.ok(response.ok(),'commit must precede withheld ACK');
   if(scenario==='revoked-unknown')sql(`DELETE FROM public.club_cashiers WHERE club_id='${f.club}' AND user_id='${f.cashier}'`);
   return route.fulfill({status:503,contentType:'application/json',body:'{"message":"TEST withheld committed ACK"}'});
  });
  await page.goto(base+'/tests/financeExpenseCashClient/http.preview.html');
  await page.getByLabel('Két chi tiền',{exact:true}).selectOption(f.shift);await page.getByLabel('Số tiền chi',{exact:true}).fill('1.000.000');
  await page.getByRole('button',{name:'Chi từ két',exact:true}).click();
  if(scenario==='closed-before-submit'){
   await page.getByRole('alert').filter({hasText:'Yêu cầu cũ chưa ghi và két đã đóng'}).waitFor();zero(f);assert.equal(await journal(page,f),null);assert.equal(writes.length,1);
   const oldShift=f.shift;await open(f);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByLabel('Két chi tiền',{exact:true}).selectOption(f.shift);
   await page.getByRole('button',{name:'Chi từ két',exact:true}).click();await page.getByText('Đã ghi chi từ két',{exact:true}).waitFor();
   assert.equal(writes.length,2);assert.notEqual(writes[0].p_request_id,writes[1].p_request_id);assert.equal(writes[0].p_shift_id,oldShift);assert.equal(writes[1].p_shift_id,f.shift);
  }else if(scenario==='pending-reload-same-intent'){
   await page.getByRole('alert').filter({hasText:'Chưa xác minh được kết quả'}).waitFor();one(f);const saved=await journal(page,f);assert.ok(saved);assert.equal(writes.length,1);
   await page.reload();await page.getByRole('alert').filter({hasText:'Chưa xác minh được kết quả'}).waitFor();assert.equal(await journal(page,f),saved);assert.equal(writes.length,1);
   denyLookup=false;await page.getByRole('button',{name:'Gửi lại yêu cầu cũ',exact:true}).click();await page.getByText('Đã ghi chi từ két',{exact:true}).waitFor();assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);
  }else if(scenario==='revoked-unknown'){
   await page.getByRole('alert').filter({hasText:'Chưa xác minh được kết quả'}).waitFor();one(f);const saved=await journal(page,f);assert.ok(saved);assert.equal(writes.length,1);
   await page.reload();await page.getByRole('alert').filter({hasText:'Chưa xác minh được kết quả'}).waitFor();assert.equal(await journal(page,f),saved);assert.equal(writes.length,1);assert.equal(await page.getByText('Đã ghi chi từ két',{exact:true}).count(),0);
   sql(`INSERT INTO public.club_cashiers(club_id,user_id) VALUES('${f.club}','${f.cashier}')`);await page.getByRole('button',{name:'Kiểm tra yêu cầu cũ',exact:true}).click();await page.getByText('Đã ghi chi từ két',{exact:true}).waitFor();assert.equal(writes.length,1);
  }else{await page.getByText('Đã ghi chi từ két',{exact:true}).waitFor();assert.equal(writes.length,1);}
  one(f);assert.equal(await journal(page,f),null);assert.ok(lookups.length>0,'real atomic embed query required');
  await page.getByTestId('expense-total').filter({hasText:/^1000000$/}).waitFor();
  for(const url of lookups){const u=new URL(url);assert.equal(u.searchParams.get('id'),`eq.${writes[0].p_shift_id}`);assert.equal(u.searchParams.get('club_id'),`eq.${f.club}`);assert.equal(u.searchParams.get('receipts.request_id'),`eq.${writes[0].p_request_id}`);assert.equal(u.searchParams.get('club.expenses.idempotency_key'),`eq.finance-cash-expense:${writes[0].p_request_id}`);}
  const summary=await rpc('cashier_shift_summary_v1',{p_shift_id:f.shift},f.cashier);assert.equal(summary.expected_cash,9000000);assert.equal(summary.totals.club_expense_cash_out,1000000);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  const cell=page.locator('div').filter({has:page.getByText('Chi phí có chứng từ chi từ két',{exact:true})}).filter({has:page.getByText('1.000.000 VND',{exact:true})});await cell.last().waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  await page.screenshot({path:join(folder,`${scenario}-${width}.png`),fullPage:true,animations:'disabled'});
  await page.reload();await page.getByLabel('Két chi tiền',{exact:true}).waitFor();assert.equal(writes.length,scenario==='closed-before-submit'||scenario==='pending-reload-same-intent'?2:1);one(f);
  proof.browser.push({width,scenario,posts:writes.length,lookupReads:lookups.length,oneCostReceiptMovement:true,recordedCash:9000000,overflow:false,pageErrors:0});await page.close();livePage=null;
 }
 const denied=await seed(index++),foreign=await seed(index++),page=await browser.newPage();livePage=page;
 for(const actor of [denied.accountant,foreign.cashier,null]){const r=await request('cashier_expense_source_status_v1',{p_club_id:denied.club},actor);assert.equal(r.status,403);assert.equal(r.data.code,'42501');}
 assert.deepEqual(await rpc('cashier_expense_source_status_v1',{p_club_id:denied.club},denied.cashier),{club_id:denied.club,enabled:true,expense_cash_source_enabled:true});
 sql(`UPDATE public.cashier_tour_settings SET expense_cash_source_enabled=false WHERE club_id='${denied.club}'`);
 assert.deepEqual(await rpc('cashier_expense_source_status_v1',{p_club_id:denied.club},denied.cashier),{club_id:denied.club,enabled:true,expense_cash_source_enabled:false});
 proof.narrowStatusReader={cashier:true,accountantDenied:true,foreignDenied:true,missingActorDenied:true,adoptionOffVisible:true,settingsTableStillPrivate:true};
 await page.addInitScript(input=>{window.__expenseCashInput=input;},{club:denied.club,actor:denied.accountant,jwt:token(denied.accountant),from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+86400000).toISOString()});
 await page.route('**/*',route=>route.request().url().startsWith(base)||route.request().url().startsWith('data:')?route.continue():route.abort());
 await page.goto(base+'/tests/financeExpenseCashClient/http.preview.html');await page.getByRole('alert').filter({hasText:'chưa có quyền chi từ két'}).waitFor();assert.equal(await page.getByLabel('Két chi tiền',{exact:true}).count(),0);zero(denied);await page.close();livePage=null;
 assert.equal(proof.browser.length,20,'All five widths and four recovery cases must run on the new authority SQL');
 proof.accountantSpendingDenied=true;proof.actualPostgrest=true;proof.scope='actual expense source entry and CashflowPanel with real SDK/HTTP/PostgreSQL; synthetic auth bootstrap, loopback only; not full parent workbench, hosted auth, approval policy, TC3 or capacity';writeFileSync(join(folder,'verification.json'),JSON.stringify(proof));console.log('EXPENSE_CASH_CLIENT_NATIVE_PASS');
}catch(e){let message=String(e.message).replaceAll(secret,'[REDACTED]');for(const t of tokens)message=message.replaceAll(t,'[REDACTED]');writeFileSync(join(folder,'failure.json'),JSON.stringify({...proof,error:message}));if(livePage)await livePage.screenshot({path:join(folder,'failure.png'),fullPage:true}).catch(()=>{});console.error('EXPENSE_CASH_CLIENT_FAILED',message);process.exitCode=1;}
finally{await browser?.close();await server?.close();spawnSync('docker',['rm','--force',container],{stdio:'ignore'});}
