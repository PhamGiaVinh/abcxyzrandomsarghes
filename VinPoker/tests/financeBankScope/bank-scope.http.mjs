import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHmac,randomBytes,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGDATABASE,'vinpoker_ops_bank_scope');assert.ok(process.env.RUNNER_TEMP);
const base='http://127.0.0.1:23865',api='http://127.0.0.1:3014',container='finance-bank-scope-http';
const id=n=>`18000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input={clubA:id(1),clubB:id(2),admin:id(11),owner:id(13)};
const secret=randomBytes(48).toString('hex');
const token=sub=>{const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');const body=enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub,role:'authenticated',exp:Math.floor(Date.now()/1000)+900});return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');};
const packet={...input,adminToken:token(input.admin),ownerToken:token(input.owner)};
function command(p,args,options={}){const r=spawnSync(p,args,{encoding:'utf8',...options});assert.equal(r.status,0,`${p}: isolated bank setup failed`);return r.stdout.trim();}
const sql=q=>command('psql',['-XqAt','-v','ON_ERROR_STOP=1','-c',q]);
const evidence=join(process.env.RUNNER_TEMP,'bank-scope-browser');mkdirSync(evidence,{recursive:true});
const snapshot=()=>sql(`SELECT md5(jsonb_agg(to_jsonb(b) ORDER BY id)::text) FROM public.platform_bank_accounts b`);
let server,browser;
try{
 sql(`DO $$ BEGIN IF EXISTS(SELECT FROM public.clubs) THEN RAISE EXCEPTION 'empty_bank_scope_fixture_required';END IF;END $$;
 ALTER ROLE authenticator LOGIN NOINHERIT NOSUPERUSER;GRANT authenticated,anon TO authenticator;
 CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $auth$;
 INSERT INTO auth.users(id) VALUES('${id(11)}'),('${id(13)}'),('${id(14)}');
 INSERT INTO public.profiles(user_id,display_name) VALUES('${id(11)}','TEST admin'),('${id(13)}','TEST owner A'),('${id(14)}','TEST owner B');
 INSERT INTO public.user_roles(user_id,role) VALUES('${id(11)}','super_admin');
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${id(1)}','${id(13)}','TEST bank A','TEST','approved'),('${id(2)}','${id(14)}','TEST bank B','TEST','approved');
 INSERT INTO public.platform_bank_accounts(id,club_id,bank_name,bank_bin,account_number,account_holder,account_type,is_active)
 VALUES('${id(51)}','${id(1)}','VCB','970436','111111111','TEST owner A','escrow',true),('${id(52)}','${id(2)}','VCB','970436','222222222','TEST owner B','escrow',true);`);
 command('docker',['run','--detach','--name',container,'--network','host','-e','PGRST_DB_URI','-e','PGRST_DB_SCHEMAS','-e','PGRST_DB_ANON_ROLE','-e','PGRST_JWT_SECRET','-e','PGRST_SERVER_HOST','-e','PGRST_SERVER_PORT','postgrest/postgrest:v13.0.7'],{env:{...process.env,
  PGRST_DB_URI:'postgres://authenticator@127.0.0.1:5432/vinpoker_ops_bank_scope',PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'3014'}});
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch(api,{signal:AbortSignal.timeout(500)})).status<500){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
 server=await createServer({configFile:'tests/financeBankScope/http.vite.config.ts'});await server.listen();browser=await chromium.launch({headless:true});
 for(const width of [320,375,414,768,1280]){
  sql(`UPDATE public.platform_bank_accounts SET account_number='222222222',bank_name='VCB',bank_bin='970436' WHERE id='${id(52)}'`);
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),failures=[],patches=[];
  await page.addInitScript(value=>{window.__bankInput=value;},packet);
  page.on('pageerror',()=>failures.push('browser_page_error'));
  page.on('request',request=>{if(request.method()==='PATCH')patches.push({url:request.url(),body:request.postDataJSON()});});
  await page.route('**/*',route=>{if(route.request().url().startsWith(base)||route.request().url().startsWith('data:'))return route.continue();failures.push('external_request');return route.abort();});
  let release;const held=new Promise(r=>{release=r;});let signal;const fetched=new Promise(r=>{signal=r;});let heldOnce=false;
  await page.route('**/rest/v1/platform_bank_accounts?**',async route=>{
   const u=new URL(route.request().url());
   if(!heldOnce&&route.request().method()==='GET'&&u.searchParams.get('club_id')===`eq.${input.clubA}`){
    heldOnce=true;const response=await route.fetch();signal();await held;await route.fulfill({response});
   }else await route.continue();
  });
  await page.goto(base+'/tests/financeBankScope/http.preview.html');await fetched;
  await page.getByRole('button',{name:'CLB B',exact:true}).click();await page.getByLabel('Số tài khoản *',{exact:true}).fill('222222223');
  await page.getByRole('combobox').click();await page.getByRole('option',{name:/970418/}).click();
  release();await page.waitForResponse(r=>r.url().includes('club_id=eq.'+input.clubA)&&r.request().method()==='GET');
  assert.equal(await page.getByLabel('Số tài khoản *',{exact:true}).inputValue(),'222222223','old club response restored wrong bank');
  const refreshed=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).searchParams.get('club_id')===`eq.${input.clubB}`);
  await page.getByRole('button',{name:'Lưu',exact:true}).click();await page.getByText('Đã lưu',{exact:true}).waitFor();await refreshed;
  await page.getByLabel('Số tài khoản *',{exact:true}).waitFor();
  assert.equal(patches.length,1,'bank BIN saved in a second patch');
  const u=new URL(patches[0].url);assert.equal(u.searchParams.get('id'),`eq.${id(52)}`);assert.equal(u.searchParams.get('club_id'),`eq.${input.clubB}`);assert.equal(u.searchParams.get('account_type'),'eq.escrow');
  assert.equal(patches[0].body.bank_bin,'970418');assert.equal(patches[0].body.bank_name,'BIDV');assert.equal(patches[0].body.club_id,undefined);
  assert.equal(sql(`SELECT account_number FROM public.platform_bank_accounts WHERE id='${id(51)}'`),'111111111');
  assert.equal(sql(`SELECT account_number FROM public.platform_bank_accounts WHERE id='${id(52)}'`),'222222223');
  assert.equal(sql(`SELECT bank_name||':'||bank_bin FROM public.platform_bank_accounts WHERE id='${id(52)}'`),'BIDV:970418');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:join(evidence,`bank-${width}-scoped-save.png`),fullPage:true,animations:'disabled'});
  // Club bank receiving details are intentionally public while active. A read
  // is not edit authority: the distinct owner of A cannot update B through RLS.
  await page.getByRole('button',{name:'Đăng nhập chủ A',exact:true}).click();
  await page.getByLabel('Số tài khoản *',{exact:true}).fill('999999999');await page.getByRole('button',{name:'Lưu',exact:true}).click();
  await page.getByRole('alert').waitFor();assert.equal(sql(`SELECT account_number FROM public.platform_bank_accounts WHERE id='${id(52)}'`),'222222223');
  assert.equal(await page.getByRole('button',{name:'Lưu',exact:true}).count(),0);
  await page.screenshot({path:join(evidence,`bank-${width}-write-denied.png`),fullPage:true,animations:'disabled'});
  assert.deepEqual(failures,[]);await page.close();
 }

 // Recover a committed create after its response is lost, including a stale
 // empty recovery read. Retrying the exact id must conflict, never add a row.
 for(const width of [320,375,414,768,1280]){
  const club=id(1000+width),owner=id(10000+width);
  sql(`INSERT INTO auth.users(id) VALUES('${owner}');
   INSERT INTO public.profiles(user_id,display_name) VALUES('${owner}','TEST recovery owner ${width}');
   INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${club}','${owner}','TEST create recovery ${width}','TEST','approved')`);
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  await page.addInitScript(value=>{window.__bankInput=value;},{...packet,clubA:club});
  const posts=[];let lostOnce=false,staleOnce=false;
  await page.route('**/rest/v1/platform_bank_accounts?**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.method()==='POST'){
    posts.push(request.postDataJSON());
    if(!lostOnce){lostOnce=true;const response=await route.fetch();assert.ok(response.ok(),'first create must really commit');
     return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'synthetic lost committed acknowledgement'})});}
   }
   if(lostOnce&&!staleOnce&&request.method()==='GET'&&url.searchParams.get('id')===`eq.${posts[0].id}`){
    staleOnce=true;return route.fulfill({status:200,contentType:'application/json',body:'[]'});
   }
   return route.continue();
  });
  await page.goto(base+'/tests/financeBankScope/http.preview.html');
  await page.getByLabel('Tên ngân hàng',{exact:true}).fill('TEST new receiving bank');
  await page.getByLabel('Số tài khoản *',{exact:true}).fill('333333333');
  await page.getByLabel('Chủ tài khoản *',{exact:true}).fill('TEST new owner');
  await page.getByRole('button',{name:'Lưu',exact:true}).click();await page.getByRole('alert').waitFor();
  assert.equal(posts.length,1);assert.match(posts[0].id,/^[a-f0-9-]{36}$/);
  assert.equal(sql(`SELECT count(*) FROM public.platform_bank_accounts WHERE club_id='${club}'`),'1');
  await page.reload();await page.getByLabel('Số tài khoản *',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Số tài khoản *',{exact:true}).inputValue(),'333333333');
  assert.ok(await page.getByLabel('Số tài khoản *',{exact:true}).isDisabled());assert.ok(staleOnce);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:join(evidence,`bank-${width}-create-pending.png`),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Thử lại cùng yêu cầu',exact:true}).click();
  await page.getByText('Đã lưu',{exact:true}).waitFor();await page.getByRole('button',{name:'Lưu',exact:true}).waitFor();
  assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1]);
  assert.equal(sql(`SELECT count(*) FROM public.platform_bank_accounts WHERE club_id='${club}'`),'1');
  assert.equal(sql(`SELECT account_number FROM public.platform_bank_accounts WHERE id='${posts[0].id}'`),'333333333');
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),`vinpoker:bank-create:v1:${input.admin}:${club}`),null);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:join(evidence,`bank-${width}-create-recovered.png`),fullPage:true,animations:'disabled'});await page.close();
 }
 const beforeFailure=snapshot(),page=await browser.newPage({viewport:{width:320,height:900}});
 await page.addInitScript(value=>{window.__bankInput=value;},packet);
 await page.route('**/rest/v1/platform_bank_accounts?**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'synthetic delivery failure'})}));
 await page.goto(base+'/tests/financeBankScope/http.preview.html');await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Lưu',exact:true}).count(),0);
 await page.screenshot({path:join(evidence,'bank-320-read-failed.png'),fullPage:true,animations:'disabled'});assert.equal(snapshot(),beforeFailure);await page.close();
 assert.equal(sql('SELECT count(*) FROM public.dealer_pt_wage_payments'),'0');assert.equal(sql('SELECT count(*) FROM public.club_expenses'),'0');
 writeFileSync(join(evidence,'verification.json'),JSON.stringify({sourceSha:process.env.SOURCE_SHA,widths:[320,375,414,768,1280],actualPostgrest:true,lateReadIgnored:true,scopedAtomicUpdate:true,
  sameCreateIdAfterLostAckAndReload:true,duplicateIdRecoveredWithoutOverwrite:true,oneDatabaseRowPerRetriedCreate:true,rlsOwnerCrossClubWriteDenied:true,readFailureNoCreate:true,hostedAuthentication:false,productionMutation:false,productionCapacityClaim:false,scope:'isolated receiving-bank configuration UI; no outgoing source-account or drawer/payment integration',fixtureDigest:createHash('sha256').update(snapshot()).digest('hex')}));
 console.log('BANK_SCOPE_REAL_HTTP_DB_FIVE_VIEWPORTS_ATOMIC_BIN_RLS_DENY_READ_ERROR_PASS');
}catch(e){const message=String(e.message).replaceAll(packet.adminToken,'[REDACTED]').replaceAll(packet.ownerToken,'[REDACTED]').replaceAll(secret,'[REDACTED]');console.error('BANK_SCOPE_ISOLATED_FAIL',message);process.exitCode=1;}
finally{await browser?.close();await server?.close();spawnSync('docker',['rm','--force',container],{stdio:'ignore'});}
