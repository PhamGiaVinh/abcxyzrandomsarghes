// Existing TEST displays, actual anonymous RPC, every heartbeat rolled back.
// Loopback aliases model token transport; no pairing, grant, or persistent write.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
assert.equal(process.env.VINPOKER_TV1154_LOCAL, '1');
const flights1250=process.env.VINPOKER_TV1250_LOCAL==='1';
const visibility1252=process.env.VINPOKER_TV1252_LOCAL==='1';
const hidden1251=process.env.VINPOKER_TV1251_LOCAL==='1'||visibility1252;
const browser1236=process.env.VINPOKER_TV1236_LOCAL==='1'||flights1250||hidden1251;
const standby1235=process.env.VINPOKER_TV1235_LOCAL==='1'||browser1236;
const visibility1222=process.env.VINPOKER_TV1222_LOCAL==='1';
const held1209=process.env.VINPOKER_TV1209_LOCAL==='1';
const recovery1208=process.env.VINPOKER_TV1208_LOCAL==='1'||held1209;
const switch1202=process.env.VINPOKER_TV1202_LOCAL==='1';
const browser1188 = process.env.VINPOKER_TV1188_LOCAL === '1'||recovery1208;
const verify1188 = browser1188 && process.argv.includes('--verify-browser1188');
const report = visibility1252?'D:/Quy trình/output/reports/tv1252-visibility-browser-native-local-20261028.json':hidden1251?'D:/Quy trình/output/reports/tv1251-visibility-browser-native-local-20261028.json':flights1250?'D:/Quy trình/output/reports/tv1250-flights-standby-native-local-20261028.json':browser1236?'D:/Quy trình/output/reports/tv1236-browser-standby-native-local-20261028.json':standby1235?(process.argv.includes('--standby-contract1235')?'D:/Quy trình/output/reports/tv1235-standby-contract-native-local-20261028.json':process.argv.includes('--qualified1235')?'D:/Quy trình/output/reports/tv1235-standby-qualified-native-local-20261028.json':'D:/Quy trình/output/reports/tv1235-standby-native-local-20261028.json'):visibility1222?'D:/Quy trình/output/reports/tv1222-visibility-native-local-20261028.json':held1209?'D:/Quy trình/output/reports/tv1209-held-error-native-local-20261028.json':recovery1208?'D:/Quy trình/output/reports/tv1208-slow-503-native-local-20261028.json':switch1202?'D:/Quy trình/output/reports/tv1202-switch-native-local-20261028.json':browser1188 ? 'D:/Quy trình/output/reports/tv1188-slow-browser-native-local-20261028.json' : 'D:/Quy trình/output/reports/tv1154-signal-bridge-native-local-20261027.json';
assert.equal(existsSync(report), verify1188);
const db = 'vinpoker_ranking860_local', origin = visibility1252?'http://127.0.0.1:53052':hidden1251?'http://127.0.0.1:53051':flights1250?'http://127.0.0.1:53050':browser1236?'http://127.0.0.1:53036':held1209?'http://127.0.0.1:53009':recovery1208?'http://127.0.0.1:53008':browser1188 ? 'http://127.0.0.1:52988' : 'http://127.0.0.1:5203';
const fixtures = [
  { alias: 'LOCAL1154-A', display: '775f323b-9497-4f02-9941-85903ceecc21', tour: '782a5196-5ea1-44ed-8a27-1b872d5f88d9' },
  { alias: 'LOCAL1154-B', display: '66db01fc-1181-49c3-b964-a7c51761cb23', tour: 'fdf91018-09f3-4cdc-b76a-f688eb216cee' },
  { alias: 'LOCAL1154-D2', display: 'ca1f1e29-0d57-4e59-b7e5-309f7928f3da', tour: '4cd3af4d-7e1d-4042-855f-04fb6777e580' },
];
const sql = q => execFileSync('wsl', ['-d', 'PokerVision-P16-4C-Eval', '--', 'env', 'PGHOST=127.0.0.1', 'PGPORT=55441', 'PGUSER=postgres', 'PGDATABASE='+db, 'psql', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input:q, encoding:'utf8', timeout:20000, maxBuffer:4e6 }).trim();
const read = q => JSON.parse(sql("BEGIN READ ONLY;SET LOCAL statement_timeout='10s';"+q+'ROLLBACK;'));
const guard = read("SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));");
assert.equal(guard.db,db); assert.equal(guard.host,'127.0.0.1'); assert.equal(guard.port,55441);
assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data'); assert.equal(guard.external,0);
assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
const tables = ['tv_displays','tournaments','tournament_events','tournament_tables','tournament_entries','tournament_seats','chip_bag','tournament_hands','cashier_buyin_movements','tournament_prize_payments'];
const fingerprint = () => read("SELECT to_jsonb(md5(jsonb_build_array("+tables.map(t=>"(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public."+t+" x)").join(',')+")::text));");
const state = verify1188 ? JSON.parse(readFileSync(report,'utf8')) : { kind:'ACTUAL_HOOK_SDK_NATIVE_ANON_READS_MODELED_BROADCAST_NOT_BROWSER_OR_FULL_TRANSPORT', guard, before:fingerprint(), reads:[], errors:[], denied:[], oracles:[] };
if ((browser1188||switch1202) && !verify1188) {
  state.kind = 'ACTUAL_DISPLAY_ROUTE_BROWSER_SLOW_NATIVE_ANON_READ_NO_REALTIME_OR_ASSETS';
  state.http = []; state.inFlight = {}; state.maxInFlight = {};
}
const bodyBefore = verify1188 ? state.bodyBefore : read("SELECT to_jsonb(md5(prosrc)) FROM pg_proc WHERE oid='floor_private.tournament_participation_v1(uuid)'::regprocedure;");
const native = (f, branding, standby=false) => {
  const payload = JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='10s';${standby?`UPDATE public.tv_displays SET assigned_tournament_id=NULL WHERE id='${f.display}';`:''}DO $$ BEGIN PERFORM set_config('test.tv1154.token',(SELECT display_token FROM public.tv_displays WHERE id='${f.display}'),true);END $$;SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;SELECT public.get_tv_display_state_v4(current_setting('test.tv1154.token'),${branding});ROLLBACK;`));
  assert.equal(payload.status,'paired');assert.equal(payload.display.id,f.display);if(standby){assert.equal(payload.tournament,null);assert.equal(Object.hasOwn(payload,'clock'),false);}else{assert.equal(payload.tournament.id,f.tour);assert.equal(payload.clock.tournament_id,f.tour);assert.equal(payload.main_event.id,'dbb49f8d-7d47-4c2c-afd9-f57062c9971d');}
  assert.ok(!/https?:/.test(JSON.stringify(payload)),'Remote assets outside this local packet');
  state.reads.push({alias:f.alias,branding,assignmentClearedInRollback:standby,tournament:payload.tournament,clock:payload.clock,counts:payload.participation_counts,tableCount:payload.tables?.length});
  return payload;
};
const standbyRequests=new Map();
let nativeStandby1236=false;state.http1236=[];
let server;let injected1208=false;let nativeReady1209=!held1209;
try {
  if (!verify1188) {
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
      if(req.headers.host!=='127.0.0.1:54329'||(req.headers.origin&&req.headers.origin!==origin)){state.denied.push('origin');return send(403,{message:'LOCAL1154_SCOPE'});}
      if(req.method!=='POST'||req.url!=='/rest/v1/rpc/get_tv_display_state_v4'){state.denied.push(req.method+' '+req.url);return send(403,{message:'LOCAL1154_READ_ONLY'});}
      let raw='';for await(const part of req){raw+=part;assert.ok(raw.length<4096);}
      const body=JSON.parse(raw);assert.deepEqual(Object.keys(body).sort(),['p_display_token','p_include_branding']);
      const fixture=fixtures.find(f=>f.alias===body.p_display_token);assert.ok(fixture);assert.equal(typeof body.p_include_branding,'boolean');
      if(switch1202){const trace={alias:fixture.alias,started:Date.now(),outcome:'pending'};state.http.push(trace);res.once('close',()=>{trace.clientClosed=true;trace.closedAfterMs=Date.now()-trace.started;});const payload=native(fixture,body.p_include_branding);writeFileSync(report,JSON.stringify(state,null,2));if(fixture.alias==='LOCAL1154-A')await new Promise(resolve=>setTimeout(resolve,1500));trace.closedBeforeSend=res.destroyed;trace.outcome='native';trace.durationMs=Date.now()-trace.started;if(!res.destroyed)send(200,payload);writeFileSync(report,JSON.stringify(state,null,2));}
      else if (!browser1188){const ordinal=(standbyRequests.get(fixture.alias)??0)+1;standbyRequests.set(fixture.alias,ordinal);const standby=standby1235&&(browser1236?nativeStandby1236:ordinal===2);const started=Date.now();send(200,native(fixture,body.p_include_branding,standby));if(browser1236){state.http1236.push({alias:fixture.alias,ordinal,standby,started,completed:Date.now()});writeFileSync(report,JSON.stringify(state,null,2));}}
      else {
        const alias = fixture.alias, started = Date.now();
        state.inFlight[alias] = (state.inFlight[alias] ?? 0) + 1;
        state.maxInFlight[alias] = Math.max(state.maxInFlight[alias] ?? 0, state.inFlight[alias]);
        const trace = { alias, branding: body.p_include_branding, started, outcome: 'pending' };
        state.http.push(trace); writeFileSync(report,JSON.stringify(state,null,2)+'\n');
        try {
          await new Promise(resolve => setTimeout(resolve, 5000));
          if(recovery1208&&(!injected1208||!nativeReady1209)){injected1208=true;trace.outcome='injected503';send(503,{message:'LOCAL1208_DELAYED_DISPLAY_READ_FAILURE'});}
          else{send(200,native(fixture,body.p_include_branding));trace.outcome = 'native';}
        } finally {
          trace.durationMs = Date.now() - started; state.inFlight[alias]--;
          writeFileSync(report,JSON.stringify(state,null,2)+'\n');
        }
      }
    } catch(error){state.errors.push(error.message);send(500,{message:'LOCAL1154_READ_ERROR'});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54329,'127.0.0.1',resolve);});
  console.log('TV1154_THREE_EXISTING_DISPLAY_READS_READY');
  await new Promise(resolve=>process.stdin.on('data',chunk=>{const command=String(chunk).trim();if(browser1236&&['standby','resume'].includes(command)){nativeStandby1236=command==='standby';state.modeCommands??=[];state.modeCommands.push({command,at:Date.now()});writeFileSync(report,JSON.stringify(state,null,2));console.log('TV1236_MODE',command);}else if(held1209&&command==='recover'){nativeReady1209=true;state.recoveryEnabledAt=Date.now();console.log('TV1209_NATIVE_READ_RECOVERY_ENABLED');}else{assert.equal(command,'stop');process.stdin.pause();resolve();}}));
  }
  for(const f of ((flights1250||hidden1251)?fixtures.slice(0,2):browser1236?fixtures.slice(2):recovery1208?fixtures.slice(0,1):fixtures))assert.ok(state.reads.filter(r=>r.alias===f.alias).length>=2,'Missing hook SDK read '+f.alias);
  if (browser1188) for (const f of (recovery1208?fixtures.slice(0,1):fixtures)) {
    assert.equal(state.maxInFlight[f.alias],1,'Overlapping same-display HTTP reads');
    assert.ok(state.http.filter(r=>r.alias===f.alias&&r.outcome==='native'&&r.durationMs>=5000).length>=(recovery1208?1:2),'Missing actual browser poll '+f.alias);
  }
  if(recovery1208){if(held1209)assert.ok(state.http.filter(x=>x.outcome==='injected503').length>=1);else assert.equal(state.http.filter(x=>x.outcome==='injected503').length,1);state.kind='ACTUAL_DISPLAY_BROWSER_DELAYED503_RECOVERY_NATIVE_ANON_NOT_REALTIME';}
  assert.equal(state.errors.length,0);
  if(flights1250)for(const fixture of fixtures.slice(0,2)){
    assert.ok(state.http1236.some(row=>row.alias===fixture.alias&&row.standby));
    assert.ok(state.http1236.filter(row=>row.alias===fixture.alias&&!row.standby).length>=2);
  }
  if(browser1236){if(!hidden1251)assert.ok(state.http1236.some(r=>r.standby));assert.ok(state.http1236.filter(r=>!r.standby).length>=2);state.realtimeAccepted=false;state.unexpectedDenied=state.denied.filter(p=>p!=='GET /realtime/v1/websocket?apikey=sb_publishable_LOCAL_TEST_ONLY&vsn=2.0.0');assert.deepEqual(state.unexpectedDenied,[]);}else if (!browser1188) assert.equal(state.denied.length,0);
  else {
    // The real browser SDK attempts Realtime. This read adapter deliberately
    // provides no WebSocket service; retain every denial, never claim Realtime.
    state.realtimeAccepted = false;
    state.unexpectedDenied = state.denied.filter(path=>path !== 'GET /realtime/v1/websocket?apikey=sb_publishable_LOCAL_TEST_ONLY&vsn=2.0.0');
    assert.deepEqual(state.unexpectedDenied,[]);
    state.retainedVerification = verify1188;
  }
} finally {
  if(server?.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  state.after=fingerprint();state.unchanged=state.before===state.after;
  state.bodyBefore=bodyBefore;state.bodyAfter=read("SELECT to_jsonb(md5(prosrc)) FROM pg_proc WHERE oid='floor_private.tournament_participation_v1(uuid)'::regprocedure;");
  writeFileSync(report,JSON.stringify(state,null,2)+'\n');
  assert.equal(state.unchanged,true);assert.equal(state.bodyAfter,bodyBefore);
}
console.log('TV1154_NATIVE_HOOK_UNMOUNT_NATIVE_READS_UNCHANGED');


