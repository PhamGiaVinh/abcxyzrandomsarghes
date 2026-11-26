import assert from 'node:assert/strict';
import {execFileSync, spawn, spawnSync} from 'node:child_process';
import {createHmac, randomBytes, randomUUID, createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import http from 'node:http';
import {join, resolve} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import {chromium, expect} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';

// Owned disposable service only; fixture DDL stays in this DB, with no production credentials.
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.equal(process.env.PGDATABASE, 'vinpoker_ops_l09');
assert.ok(process.env.RUNNER_TEMP);
const sql = text => execFileSync('psql', ['-XqAt', '-v', 'ON_ERROR_STOP=1'], {input: text, encoding: 'utf8'}).trim();
assert.equal(sql('SELECT current_database()'), 'vinpoker_ops_l09');
const out = join(process.env.RUNNER_TEMP, 'l08-client');
mkdirSync(out, {recursive: true});
const ids = Object.fromEntries(['owner', 'operator', 'clubA', 'clubB', 'pt', 'ft', 'other'].map(key => [key, randomUUID()]));
const secret = randomBytes(48).toString('hex');
const api = 'http://127.0.0.1:3023';
const container = 'l08-bulk-salary-http';
const pgPort = Number(process.env.PGPORT);
assert.ok(Number.isInteger(pgPort) && pgPort >= 1024 && pgPort <= 65535);
const localBinary = process.env.L08_POSTGREST_WSL_BINARY;
const localDistro = process.env.L08_POSTGREST_WSL_DISTRO;
if (localBinary) {
  assert.equal(process.platform, 'win32');
  assert.match(localBinary, /^\/tmp\/[A-Za-z0-9_.\/-]+\/postgrest$/);
  assert.equal(localDistro, 'PokerVision-P16-4C-Eval');
}
const token = sub => {
  const now = Math.floor(Date.now() / 1000);
  const body = [
    {alg: 'HS256', typ: 'JWT'},
    {sub, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600},
  ].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
};
const jwt = token(ids.operator);
const sdk = actor => createClient(api, 'isolated-l08-client', {
  auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
  global: {headers: {Authorization: `Bearer ${token(actor)}`},
    fetch: (url, options) => fetch(String(url).replace(api+'/rest/v1/', api+'/'), options)},
});
const receipt = {
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
  schemaCaptureRun: process.env.CAPTURE_RUN,
  schemaCaptureSha: process.env.CAPTURE_SHA,
  actualPostgrest: true, syntheticAuth: true, productionMutation: false, qualification: false,
  cases: [], pageErrors: 0, http: [], requestFailures: [], restPrefixAdapter: true,
  scope: 'Actual BulkSalaryDialog and Supabase SDK through loopback PostgREST/captured-schema PostgreSQL17. Synthetic signed auth and owned TEST fixtures; not hosted auth, parent workbench, salary settlement, full E05 or production acceptance.',
};
let browser, server, localProcess, localPid, created = false;
try {
  sql(`
    DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOINHERIT LOGIN; END IF; END $$;
    ALTER ROLE authenticator LOGIN NOINHERIT;
    GRANT anon,authenticated,service_role TO authenticator;
    -- restore-schema-test-baseline supplies a legacy SQL-only auth.uid stub.
    -- This owned fixture also accepts the actual JSON claim setting used by PostgREST.
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $uid$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $uid$;
    INSERT INTO auth.users(id) VALUES ('${ids.owner}'),('${ids.operator}');
    INSERT INTO public.profiles(user_id,display_name) VALUES ('${ids.owner}','L08 TEST owner'),('${ids.operator}','L08 TEST operator');
    INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
      ('${ids.clubA}','${ids.owner}','L08 TEST A','TEST','approved'),
      ('${ids.clubB}','${ids.operator}','L08 TEST B','TEST','approved');
    INSERT INTO public.club_dealer_controls(club_id,user_id) VALUES ('${ids.clubA}','${ids.operator}');
    INSERT INTO public.dealers(id,club_id,full_name,status,employment_type,standard_hours_per_shift) VALUES
      ('${ids.pt}','${ids.clubA}','TEST L08 PT','active','part_time',null),
      ('${ids.ft}','${ids.clubA}','TEST L08 FT','active','full_time',8),
      ('${ids.other}','${ids.clubB}','TEST L08 OTHER','active','part_time',null);
    CREATE SCHEMA l08_client_fixture;
    REVOKE ALL ON SCHEMA l08_client_fixture FROM PUBLIC,anon,authenticated,service_role;
    CREATE TABLE l08_client_fixture.salary_audit(dealer_id uuid NOT NULL);
    ALTER TABLE l08_client_fixture.salary_audit ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION l08_client_fixture.salary_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
    BEGIN
      IF NEW.id IN ('${ids.pt}'::uuid,'${ids.ft}'::uuid,'${ids.other}'::uuid)
        AND ROW(OLD.hourly_rate_vnd,OLD.monthly_salary_vnd,OLD.base_rate_vnd)
          IS DISTINCT FROM ROW(NEW.hourly_rate_vnd,NEW.monthly_salary_vnd,NEW.base_rate_vnd)
      THEN INSERT INTO l08_client_fixture.salary_audit(dealer_id) VALUES(NEW.id); END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER l08_client_fixture_audit AFTER UPDATE ON public.dealers FOR EACH ROW EXECUTE FUNCTION l08_client_fixture.salary_audit();
  `);
  const keys = ['PGRST_DB_URI', 'PGRST_DB_SCHEMAS', 'PGRST_DB_ANON_ROLE', 'PGRST_JWT_SECRET', 'PGRST_SERVER_HOST', 'PGRST_SERVER_PORT'];
  const apiEnv = {...process.env,
    PGRST_DB_URI: `postgres://authenticator@127.0.0.1:${pgPort}/vinpoker_ops_l09`,
    PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: secret,
    PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: '3023',
  };
  if (localBinary) {
    // Existing local tool only. Secret remains in environment; stdout reports its owned PID only.
    localProcess = spawn('wsl.exe', ['-d', localDistro, '--exec', 'sh', '-c', 'echo $$; exec "$1"', 'l08-postgrest', localBinary],
      {env: {...apiEnv, WSLENV: [...(process.env.WSLENV?.split(':') ?? []), ...keys].join(':')}, windowsHide:true});
    await new Promise((resolve,reject) => {
      let text=''; const timer=setTimeout(()=>reject(new Error('local PostgREST PID timeout')),10000);
      localProcess.stdout.on('data',chunk=>{text+=chunk;const first=text.split(/\r?\n/)[0];if(text.includes('\n') && /^\d+$/.test(first)){localPid=Number(first);clearTimeout(timer);resolve();}});
      localProcess.once('error',error=>{clearTimeout(timer);reject(error);});
    });
    localProcess.stderr.resume();
    receipt.postgrestRuntime = {kind:'existing-local-wsl-binary',version:execFileSync('wsl.exe',['-d',localDistro,'--exec',localBinary,'--version'],{encoding:'utf8'}).trim(),
      binarySha256:execFileSync('wsl.exe',['-d',localDistro,'--exec','sha256sum',localBinary],{encoding:'utf8'}).trim().split(/\s/)[0]};
  } else {
    const run = spawnSync('docker', ['run', '--detach', '--name', container, '--network', 'host', ...keys.flatMap(key=>['-e',key]), 'postgrest/postgrest:v13.0.7'], {encoding:'utf8',env:apiEnv});
    assert.equal(run.status,0,'isolated PostgREST startup'); created=true;
    receipt.postgrestRuntime = {kind:'disposable-ci-container',image:'postgrest/postgrest:v13.0.7'};
  }
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { ready = (await fetch(api)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'isolated PostgREST ready');

  const columns = 'id,club_id,full_name,employment_type,monthly_salary_vnd,base_rate_vnd,hourly_rate_vnd,standard_hours_per_shift';
  const rows = club => JSON.parse(sql(`SELECT coalesce(json_agg(d ORDER BY d.full_name),'[]') FROM (SELECT ${columns} FROM public.dealers WHERE club_id='${club}') d;`));
  const reset = () => {
    sql(`UPDATE public.dealers SET monthly_salary_vnd=null,base_rate_vnd=null,hourly_rate_vnd=null,deleted_at=null WHERE id IN ('${ids.pt}','${ids.ft}','${ids.other}');
      INSERT INTO public.club_dealer_controls(club_id,user_id) SELECT '${ids.clubA}','${ids.operator}' WHERE NOT EXISTS(SELECT FROM public.club_dealer_controls WHERE club_id='${ids.clubA}' AND user_id='${ids.operator}');
      DELETE FROM l08_client_fixture.salary_audit WHERE dealer_id IN ('${ids.pt}','${ids.ft}','${ids.other}');`);
  };
  const changes = id => Number(sql(`SELECT count(*) FROM l08_client_fixture.salary_audit WHERE dealer_id='${id}'`));
  const rate = id => JSON.parse(sql(`SELECT row_to_json(d) FROM (SELECT ${columns} FROM public.dealers WHERE id='${id}') d;`));
  const client = sdk(ids.operator);
  const initialRead = await client.from('dealers').select('id').eq('club_id',ids.clubA);
  receipt.actorFixtureRead = {errorCode:initialRead.error?.code ?? null,rows:initialRead.data?.length ?? 0};
  assert.equal(initialRead.error,null,'actor can read the owned A fixture');
  assert.equal(initialRead.data.length,2);
  const code = await build({
    stdin: {resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {BulkSalaryDialog} from '@/components/cashier/BulkSalaryDialog';
      const root=createRoot(document.getElementById('root'));
      window.__setProps=(dealers,club)=>root.render(React.createElement(BulkSalaryDialog,{key:club,dealers,onDone:()=>{window.__refetches=(window.__refetches??0)+1}}));
      window.__setProps(window.__config.rows,window.__config.club);`},
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: {'@': resolve('src')}, define: {'process.env.NODE_ENV': '"production"'},
    plugins: [{name: 'isolated-auth-client', setup(plugin) {
      plugin.onResolve({filter: /integrations\/supabase\/client$/}, () => ({path: 'client', namespace: 'fixture'}));
      plugin.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({resolveDir: process.cwd(), loader: 'js', contents: `
        import {createClient} from '@supabase/supabase-js';
        // Supabase's gateway strips /rest/v1 before PostgREST; preserve every other request property.
        export const supabase=createClient(window.__config.api,'isolated-l08-client',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:'Bearer '+window.__config.jwt},fetch:(url,options)=>fetch(String(url).replace(window.__config.api+'/rest/v1/',window.__config.api+'/'),options)}});
        // Measurement only: delegate the real SDK builder unchanged. The timer task
        // marks completion after its body parse and the caller's await continuation.
        window.__completedRows=[];
        const prototype=Object.getPrototypeOf(supabase.from('dealers').select('id'));
        const original=prototype.maybeSingle;
        prototype.maybeSingle=function(...args){return Promise.resolve(original.apply(this,args)).then(value=>{
          const id=value.data?.id;setTimeout(()=>window.__completedRows.push(id),0);return value;
        });};` }));
    }}],
  });
  const require = createRequire(import.meta.url);
  const loadConfig = require('tailwindcss/loadConfig.js');
  const css = await postcss([tailwind(loadConfig(resolve('tailwind.config.ts')))])
    .process(readFileSync('src/index.css', 'utf8'), {from: resolve('src/index.css')});
  server = http.createServer((request, response) => {
    if (request.url === '/fixture.js') { response.setHeader('Content-Type','text/javascript'); response.end(code.outputFiles[0].contents); }
    else if (request.url === '/fixture.css') { response.setHeader('Content-Type','text/css'); response.end(css.css); }
    else { response.setHeader('Content-Type','text/html'); response.end('<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext();
  const pageFor = async width => {
    const page = await context.newPage();
    await page.setViewportSize({width, height: 900});
    await page.addInitScript(config => { window.__config = config; }, {api, jwt, club: ids.clubA, rows: rows(ids.clubA)});
    await page.route('**/*', route => {
      const target = new URL(route.request().url()).origin;
      assert.ok(target === origin || target === api, 'no external request permitted');
      return route.continue();
    });
    page.on('pageerror', () => { receipt.pageErrors++; });
    page.on('requestfailed', request => {
      if (new URL(request.url()).origin === api) receipt.requestFailures.push({method:request.method(),error:request.failure()?.errorText});
    });
    page.on('response', async response => {
      if (new URL(response.url()).origin !== api) return;
      try {
        const value=await response.json(), row=Array.isArray(value)?value[0]:value;
        receipt.http.push({method:response.request().method(),status:response.status(),code:value?.code??null,
          rows:Array.isArray(value)?value.length:null,idKnown:[ids.pt,ids.ft,ids.other].includes(row?.id),
          fields:row?Object.keys(row):[]});
      } catch {}
    });
    await page.goto(origin);
    await page.getByRole('button', {name:'Áp lương hàng loạt',exact:true}).click();
    await page.getByRole('button', {name:'Chọn tất cả đang hiển thị'}).click();
    await page.getByLabel('Lương giờ cho PT',{exact:true}).fill('-100000');
    await page.getByLabel('Lương tháng cho FT',{exact:true}).fill('1e3');
    await expect(page.getByRole('button',{name:/Áp lương cho/})).toBeDisabled();
    assert.equal(changes(ids.pt)+changes(ids.ft),0);
    await page.getByLabel('Lương giờ cho PT',{exact:true}).fill('100000');
    await page.getByLabel('Lương tháng cho FT',{exact:true}).fill('2.600.000');
    return page;
  };
  const confirm = async (page, count = 2) => {
    await page.getByRole('button',{name:`Áp lương cho ${count} dealer`,exact:true}).click();
    await page.getByRole('alertdialog').getByRole('button',{name:'Áp lương',exact:true}).click();
    await expect(page.getByRole('status')).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
  };
  const ftPatch = request => request.method()==='PATCH' && new URL(request.url()).searchParams.get('id')===`eq.${ids.ft}`;

  reset();
  {
    const page = await pageFor(1280); await confirm(page);
    await expect(page.getByRole('status')).toContainText('Đã xác minh: TEST L08 PT, TEST L08 FT.');
    assert.equal(changes(ids.pt),1); assert.equal(changes(ids.ft),1);
    assert.equal(rate(ids.pt).hourly_rate_vnd,100000); assert.equal(rate(ids.ft).monthly_salary_vnd,2600000);
    receipt.cases.push({name:'two-confirmed',width:1280,ptChanges:1,ftChanges:1}); await page.close();
  }
  reset();
  {
    const page = await pageFor(320); let raced = false;
    await page.route(api+'/**', async route => {
      if (ftPatch(route.request()) && !raced) {
        raced = true;
        const edit = await client.from('dealers').update({hourly_rate_vnd:999}).eq('id',ids.ft).eq('club_id',ids.clubA).select('id');
        assert.equal(edit.error,null); assert.equal(edit.data.length,1);
      }
      return route.continue();
    });
    await confirm(page);
    await expect(page.getByRole('status')).toContainText('Đã xác minh: TEST L08 PT.');
    await expect(page.getByRole('status')).toContainText('Chưa xác minh: TEST L08 FT.');
    assert.equal(rate(ids.ft).monthly_salary_vnd,null); assert.equal(rate(ids.ft).hourly_rate_vnd,999);
    await page.screenshot({path:join(out,'partial-320.png')});
    await page.evaluate(({data,club})=>window.__setProps(data,club),{data:rows(ids.clubA),club:ids.clubA});
    await confirm(page,1); assert.equal(rate(ids.ft).hourly_rate_vnd,999);
    await page.getByLabel('Lương tháng cho FT',{exact:true}).fill('2500000');
    await confirm(page,1);
    await expect(page.getByRole('status')).toContainText('Đã xác minh: TEST L08 FT.');
    assert.equal(rate(ids.ft).monthly_salary_vnd,2500000);
    receipt.cases.push({name:'one-confirmed-concurrent-edit-refresh-retry',width:320,staleWriteRejected:true,explicitNewIntentVerified:true,ptChanges:changes(ids.pt)});
    await page.close();
  }
  reset();
  {
    const page = await pageFor(375); let patches = 0;
    await page.route(api+'/**', async route => {
      if (!ftPatch(route.request())) return route.continue();
      patches++; await route.fetch(); return route.abort('connectionreset');
    });
    await confirm(page);
    await expect(page.getByRole('status')).toContainText('Chưa xác minh: TEST L08 FT.');
    assert.equal(changes(ids.ft),1); const before = patches;
    await confirm(page,1);
    await expect(page.getByRole('status')).toContainText('Đã xác minh: TEST L08 FT.');
    assert.equal(patches,before); assert.equal(changes(ids.pt),1); assert.equal(changes(ids.ft),1);
    receipt.cases.push({name:'commit-lost-response-retry',width:375,ftChanges:1,ptChanges:1,retryPatchCount:0}); await page.close();
  }
  reset();
  {
    const page = await pageFor(414);
    sql(`DELETE FROM public.club_dealer_controls WHERE club_id='${ids.clubA}' AND user_id='${ids.operator}';`);
    await confirm(page);
    await expect(page.getByRole('status')).toContainText('Chưa xác minh: TEST L08 PT, TEST L08 FT.');
    assert.equal(changes(ids.pt)+changes(ids.ft),0);
    const other = await client.from('dealers').select('id').eq('club_id',ids.clubB).eq('id',ids.other);
    assert.equal(other.error,null); assert.equal(other.data.length,1);
    receipt.cases.push({name:'zero-confirmed-revoked-other-club-retained',width:414,changes:0,otherClubRetained:true}); await page.close();
  }
  reset();
  {
    const page = await pageFor(768);
    sql(`UPDATE public.dealers SET deleted_at=clock_timestamp() WHERE id='${ids.ft}';`);
    await confirm(page);
    await expect(page.getByRole('status')).toContainText('Chưa xác minh: TEST L08 FT.');
    assert.equal(changes(ids.ft),0);
    receipt.cases.push({name:'soft-deleted-after-selection',width:768,ftChanges:0}); await page.close();
  }
  reset();
  {
    const page = await pageFor(375); let release, started, done, oldFtPatches = 0;
    page.on('request', request => { if (ftPatch(request)) oldFtPatches++; });
    const gate = new Promise(resolve=>{release=resolve;});
    const began = new Promise(resolve=>{started=resolve;});
    const finished = new Promise(resolve=>{done=resolve;});
    await page.route(api+'/**', async route => {
      const req=route.request();
      if (req.method()==='GET' && new URL(req.url()).searchParams.get('id')===`eq.${ids.ft}`) {
        started(); await gate; await route.continue(); done(); return;
      }
      return route.continue();
    });
    await page.getByRole('button',{name:'Áp lương cho 2 dealer',exact:true}).click();
    await page.getByRole('alertdialog').getByRole('button',{name:'Áp lương',exact:true}).click();
    await began;
    await page.evaluate(({data,club})=>window.__setProps(data,club),{data:rows(ids.clubB),club:ids.clubB});
    await page.getByRole('button',{name:'Áp lương hàng loạt',exact:true}).click();
    release(); await finished;
    await expect(page.getByText('TEST L08 OTHER',{exact:true})).toBeVisible();
    await page.waitForFunction(id => window.__completedRows.includes(id), ids.ft);
    assert.equal(oldFtPatches,0);
    assert.equal(changes(ids.ft),0); assert.equal(changes(ids.pt),1);
    await expect(page.getByRole('status')).toHaveCount(0);
    receipt.cases.push({name:'club-session-unmounted-during-read',width:375,oldRemainingWrites:0,oldPatchRequests:0,oldReadConsumed:true,noOldResult:true}); await page.close();
  }
  const denied = await sdk(ids.owner).from('dealers').update({hourly_rate_vnd:123}).eq('club_id',ids.clubB).eq('id',ids.other).select('id');
  assert.ok(denied.error || denied.data.length===0); assert.equal(changes(ids.other),0);
  receipt.foreignWriteDenied = true;
  assert.equal(receipt.pageErrors,0); assert.equal(receipt.cases.length,6);
  receipt.componentSha256 = createHash('sha256').update(readFileSync('src/components/cashier/BulkSalaryDialog.tsx')).digest('hex');
  receipt.status='passed';
} catch (error) {
  receipt.status='failed'; receipt.failure=String(error.message).slice(0,1000); throw error;
} finally {
  writeFileSync(join(out,'verification.json'),JSON.stringify(receipt,null,2)+'\n');
  if (browser) await browser.close();
  if (server) await new Promise(resolve=>server.close(resolve));
  if (created) spawnSync('docker',['rm','--force',container],{stdio:'ignore'});
  if (localPid) {
    const same = spawnSync('wsl.exe',['-d',localDistro,'--exec','sh','-c','if test ! -e /proc/$1; then exit 0; fi; test "$(readlink /proc/$1/exe)" = "$2" && kill -TERM "$1"','l08-owned-stop',String(localPid),localBinary],{stdio:'ignore',windowsHide:true});
    assert.equal(same.status,0,'owned local PostgREST stopped');
    if (localProcess) await new Promise(resolve=>localProcess.exitCode!==null?resolve():localProcess.once('exit',resolve));
  }
}
console.log(JSON.stringify(receipt));
