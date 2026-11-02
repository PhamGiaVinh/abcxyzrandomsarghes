// Actual panel/SDK/native SQL rejection; all native transactions ROLLBACK.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {writeFileSync,readFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_SEPAY891_READ_LOCAL,'1');
const db='vinpoker_ranking860_local',tour='4cd3af4d-7e1d-4042-855f-04fb6777e580',actor='675fe35e-60a8-4452-bb90-e79486d54da6',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:2e6,stdio:['pipe','pipe','pipe']}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),`${db}|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data`);
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql('SELECT package_hash FROM floor_private.ranking860_install_backup;'),'d786e04b14c42eaeb0832b97ea47f992eacd755ad1e94d9022f6a28920c778bd');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
const tables=['bank_transactions','payment_settlements','club_payment_config','tournament_registrations','tournament_entries','tournament_seats','cashier_buyin_movements','tournament_prize_payments','notifications','tournaments'];
const proof=()=>sql(`BEGIN READ ONLY;SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_build_array('${t}',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),''))) FROM public.${t} r)`).join(',')})::text);ROLLBACK;`);
const before=proof(),state={scope:'native worklist with one modeled malformed resolved content field; no writes',before,tour,trace:[],writerDenied:0};
const save=()=>writeFileSync('D:/Quy trình/output/reports/sepay891-native-browser-state-local-20261026.json',JSON.stringify(state,null,2)+'\n');
const worklist=scope=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='8s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]') FROM public.sepay_cashier_settlement_worklist('${scope}',200)w;ROLLBACK;`));
assert.equal(worklist('resolved').length,2);let corruptResolved=true;
if(process.argv.includes('--inspect')){const prior=JSON.parse(readFileSync('D:/Quy trình/output/reports/sepay891-native-browser-state-local-20261026.json','utf8'));assert.equal(before,prior.before);console.log('SEPAY891_POSTSTOP_PROTECTED_FACTS_UNCHANGED');process.exit(0);}
const sessions=new Map(),key=randomUUID(),user={id:actor,email:'sepay891@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-26T00:00:00Z'};
const server=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Cache-Control','no-store');const send=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};
 if(req.headers.host!=='127.0.0.1:54329'||(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:5188'))return send(403,{message:'LOCAL891_SCOPE'});if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{const url=new URL(req.url,'http://127.0.0.1:54329');let raw='';for await(const c of req){raw+=c;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
 if(url.pathname==='/__local/manifest')return send(200,{tour,actor,club,email:user.email,runId:'891',model:'native SQL rollback / Auth HTTP modeled'});
 if(url.pathname==='/auth/v1/token'){assert.equal(body.email,user.email);assert.equal(body.password,'LOCAL_TEST_ONLY');const exp=Math.floor(Date.now()/1000)+3600,base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url'),token=base+'.'+createHmac('sha256',key).update(base).digest('base64url');sessions.set(token,true);return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});}
 if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{message:'LOCAL891_LOGIN_REQUIRED'});
 if(url.pathname==='/auth/v1/user')return send(200,user);
 if(req.method==='GET'&&url.pathname.startsWith('/rest/v1/'))return send(200,url.pathname==='/rest/v1/clubs'?[{id:club}]:[]);
 if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/sepay_cashier_settlement_worklist'){
 assert.ok(['actionable','resolved'].includes(body.p_scope));assert.equal(body.p_limit,200);assert.deepEqual(Object.keys(body).sort(),['p_limit','p_scope']);
 const value=worklist(body.p_scope);const malformed=body.p_scope==='resolved'&&corruptResolved;if(malformed){assert.ok(value.length);corruptResolved=false;value[0].content={LOCAL891_INVALID_TEXT:true};}
 state.trace.push({kind:'worklist',scope:body.p_scope,rows:value.length,malformed});state.unchanged=proof()===before;assert.equal(state.unchanged,true);save();return send(200,value);
 }
 state.writerDenied++;state.trace.push({kind:'endpoint_denied',path:url.pathname});save();return send(403,{message:'LOCAL891_ENDPOINT_NOT_ALLOWED'});
 }catch{state.trace.push({kind:'adapter_error'});save();return send(500,{message:'LOCAL891_ADAPTER_FAILED'});}
});save();server.listen(54329,'127.0.0.1',()=>console.log('SEPAY891_NATIVE_CAPACITY_ADAPTER_READY',JSON.stringify({tour})));

process.stdin.once('data',()=>{process.stdin.pause();server.close(()=>{assert.equal(proof(),before);state.finalUnchanged=true;save();console.log('SEPAY891_FINAL_PROTECTED_FACTS_UNCHANGED');process.exit(0);});server.closeAllConnections();});
