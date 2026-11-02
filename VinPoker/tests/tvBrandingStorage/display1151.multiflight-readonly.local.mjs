// Existing TEST displays, actual anonymous RPC, every heartbeat rolled back.
// Loopback aliases model token transport; no pairing, grant, or persistent write.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
assert.equal(process.env.VINPOKER_TV1151_LOCAL, '1');
const report = 'D:/Quy trình/output/reports/tv1151-multiflight-native-browser-local-20261027.json';
assert.equal(existsSync(report), false);
const db = 'vinpoker_ranking860_local', origin = 'http://127.0.0.1:5203';
const fixtures = [
  { alias: 'LOCAL1151-A', display: '775f323b-9497-4f02-9941-85903ceecc21', tour: '782a5196-5ea1-44ed-8a27-1b872d5f88d9' },
  { alias: 'LOCAL1151-B', display: '66db01fc-1181-49c3-b964-a7c51761cb23', tour: 'fdf91018-09f3-4cdc-b76a-f688eb216cee' },
  { alias: 'LOCAL1151-D2', display: 'ca1f1e29-0d57-4e59-b7e5-309f7928f3da', tour: '4cd3af4d-7e1d-4042-855f-04fb6777e580' },
];
const sql = q => execFileSync('wsl', ['-d', 'PokerVision-P16-4C-Eval', '--', 'env', 'PGHOST=127.0.0.1', 'PGPORT=55441', 'PGUSER=postgres', 'PGDATABASE='+db, 'psql', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input:q, encoding:'utf8', timeout:20000, maxBuffer:4e6 }).trim();
const read = q => JSON.parse(sql("BEGIN READ ONLY;SET LOCAL statement_timeout='10s';"+q+'ROLLBACK;'));
const guard = read("SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));");
assert.equal(guard.db,db); assert.equal(guard.host,'127.0.0.1'); assert.equal(guard.port,55441);
assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data'); assert.equal(guard.external,0);
assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
const tables = ['tv_displays','tournaments','tournament_events','tournament_tables','tournament_entries','tournament_seats','chip_bag','tournament_hands','cashier_buyin_movements','tournament_prize_payments'];
const fingerprint = () => read("SELECT to_jsonb(md5(jsonb_build_array("+tables.map(t=>"(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public."+t+" x)").join(',')+")::text));");
const state = { kind:'ACTUAL_ANON_NATIVE_THREE_DISPLAY_BROWSER_READS_NOT_FULL_TV_OR_JOURNEY_ACCEPTANCE', guard, before:fingerprint(), reads:[], errors:[], denied:[], oracles:[] };
const bodyBefore = read("SELECT to_jsonb(md5(prosrc)) FROM pg_proc WHERE oid='floor_private.tournament_participation_v1(uuid)'::regprocedure;");
const native = (f, branding) => {
  const payload = JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='10s';DO $$ BEGIN PERFORM set_config('test.tv1151.token',(SELECT display_token FROM public.tv_displays WHERE id='${f.display}'),true);END $$;SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;SELECT public.get_tv_display_state_v4(current_setting('test.tv1151.token'),${branding});ROLLBACK;`));
  assert.equal(payload.status,'paired');assert.equal(payload.display.id,f.display);assert.equal(payload.tournament.id,f.tour);
  assert.equal(payload.clock.tournament_id,f.tour);assert.equal(payload.main_event.id,'dbb49f8d-7d47-4c2c-afd9-f57062c9971d');
  assert.ok(!/https?:/.test(JSON.stringify(payload)),'Remote assets outside this local packet');
  state.reads.push({alias:f.alias,branding,tournament:payload.tournament,clock:payload.clock,counts:payload.participation_counts,tableCount:payload.tables?.length});
  return payload;
};
let server;
try {
  for (const f of fixtures) {
    const p=native(f,true);
    state.oracles.push({alias:f.alias,display:f.display,tour:f.tour,tournament:p.tournament,clock:p.clock,counts:p.participation_counts});
  }
  server=createServer(async(req,res)=>{
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    res.setHeader('Cache-Control','no-store');res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept-profile,content-profile,x-retry-count');
    if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
    try {
      if(req.headers.host!=='127.0.0.1:54329'||(req.headers.origin&&req.headers.origin!==origin)){state.denied.push('origin');return send(403,{message:'LOCAL1151_SCOPE'});}
      if(req.method!=='POST'||req.url!=='/rest/v1/rpc/get_tv_display_state_v4'){state.denied.push(req.method+' '+req.url);return send(403,{message:'LOCAL1151_READ_ONLY'});}
      let raw='';for await(const part of req){raw+=part;assert.ok(raw.length<4096);}
      const body=JSON.parse(raw);assert.deepEqual(Object.keys(body).sort(),['p_display_token','p_include_branding']);
      const fixture=fixtures.find(f=>f.alias===body.p_display_token);assert.ok(fixture);assert.equal(typeof body.p_include_branding,'boolean');
      send(200,native(fixture,body.p_include_branding));
    } catch(error){state.errors.push(error.message);send(500,{message:'LOCAL1151_READ_ERROR'});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54329,'127.0.0.1',resolve);});
  console.log('TV1151_THREE_EXISTING_DISPLAY_READS_READY');
  await new Promise(resolve=>process.stdin.on('data',chunk=>{assert.equal(String(chunk).trim(),'stop');process.stdin.pause();resolve();}));
  for(const f of fixtures)assert.ok(state.reads.filter(r=>r.alias===f.alias).length>=2,'Missing browser read '+f.alias);
  assert.equal(state.errors.length,0);assert.equal(state.denied.length,0);
} finally {
  if(server?.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  state.after=fingerprint();state.unchanged=state.before===state.after;
  state.bodyBefore=bodyBefore;state.bodyAfter=read("SELECT to_jsonb(md5(prosrc)) FROM pg_proc WHERE oid='floor_private.tournament_participation_v1(uuid)'::regprocedure;");
  writeFileSync(report,JSON.stringify(state,null,2)+'\n');
  assert.equal(state.unchanged,true);assert.equal(state.bodyAfter,bodyBefore);
}
console.log('TV1151_NATIVE_MULTIFLIGHT_READS_UNCHANGED');
