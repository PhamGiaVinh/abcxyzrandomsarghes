// Actual panel/SDK/native SQL rejection; all native transactions ROLLBACK.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {writeFileSync,readFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_CHIP894_READ_LOCAL,'1');
const db='vinpoker_ranking860_local',tour='c367013a-3ed3-48af-ad48-3915acadc50e',actor='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',club='d4427834-5f5f-48ef-bde5-e2dc388ed00b';
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:2e6,stdio:['pipe','pipe','pipe']}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),`${db}|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data`);
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql('SELECT package_hash FROM floor_private.ranking860_install_backup;'),'d786e04b14c42eaeb0832b97ea47f992eacd755ad1e94d9022f6a28920c778bd');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
const tables=['bank_transactions','payment_settlements','club_payment_config','tournament_registrations','tournament_entries','tournament_seats','cashier_buyin_movements','tournament_prize_payments','notifications','tournaments','stack_template','stack_template_issuance','tournament_chip_counts','chip_inventory_ledger','chip_bank_ledger'];
const proof=()=>sql(`BEGIN READ ONLY;SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_build_array('${t}',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),''))) FROM public.${t} r)`).join(',')})::text);ROLLBACK;`);
const before=proof(),state={scope:'native original Single244 inventory with one modeled null issuance response; no writes',before,tour,trace:[],writerDenied:0};
const save=()=>writeFileSync('D:/Quy trình/output/reports/chip894-native-browser-state-local-20261026.json',JSON.stringify(state,null,2)+'\n');
const native=query=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='8s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;${query};ROLLBACK;`));
const templates=native(`SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]') FROM(SELECT id,name,stack_value FROM public.stack_template WHERE tournament_id='${tour}' ORDER BY stack_value)w`);assert.equal(templates.length,1);let corruptIssuance=true;
const inventory=native(`SELECT public.get_issued_chip_inventory('${tour}')`);assert.equal(inventory.total_value,180000);assert.equal(inventory.reconciliation_value,180000);
if(process.argv.includes('--inspect')){const prior=JSON.parse(readFileSync('D:/Quy trình/output/reports/chip894-native-browser-state-local-20261026.json','utf8'));assert.equal(before,prior.before);console.log('CHIP894_POSTSTOP_PROTECTED_FACTS_UNCHANGED');process.exit(0);}
assert.equal(sql("SELECT pg_get_function_result('public.get_my_ops_global_capability()'::regprocedure);"),'TABLE(is_super_admin boolean)');
const sessions=new Map(),key=randomUUID(),user={id:actor,email:'chip894@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-26T00:00:00Z'};
const server=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Cache-Control','no-store');const send=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};
 if(req.headers.host!=='127.0.0.1:54329'||(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:5188'))return send(403,{message:'LOCAL894_SCOPE'});if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{const url=new URL(req.url,'http://127.0.0.1:54329');let raw='';for await(const c of req){raw+=c;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
 if(url.pathname==='/__local/manifest')return send(200,{tour,actor,club,email:user.email,runId:'893',model:'native SQL rollback / Auth HTTP modeled'});
 if(url.pathname==='/auth/v1/token'){assert.equal(body.email,user.email);assert.equal(body.password,'LOCAL_TEST_ONLY');const exp=Math.floor(Date.now()/1000)+3600,base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url'),token=base+'.'+createHmac('sha256',key).update(base).digest('base64url');sessions.set(token,true);return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});}
 if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{message:'LOCAL894_LOGIN_REQUIRED'});
 if(url.pathname==='/auth/v1/user')return send(200,user);
 if(req.method==='GET'&&url.pathname.startsWith('/rest/v1/')){
 const name=url.pathname.slice('/rest/v1/'.length);let value;
 if(name==='clubs')value=native(`SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]') FROM(SELECT id,name FROM public.clubs WHERE id='${club}')w`);
 else if(name==='tournaments'){assert.equal(url.searchParams.get('club_id'),'eq.'+club);value=native(`SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]') FROM(SELECT id,name,status,start_time,phase FROM public.tournaments WHERE club_id='${club}' AND deleted_at IS NULL ORDER BY start_time DESC LIMIT 200)w`);}
 else if(name==='stack_template'){assert.equal(url.searchParams.get('tournament_id'),'eq.'+tour);value=templates;}
 else if(name==='stack_template_issuance'){assert.equal(url.searchParams.get('stack_template_id'),'in.('+templates.map(t=>t.id).join(',')+')');value=native(`SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]') FROM(SELECT stack_template_id,issued_count FROM public.stack_template_issuance WHERE stack_template_id='${templates[0].id}')w`);if(corruptIssuance){corruptIssuance=false;state.trace.push({read:name,malformedNull:true,nativeRows:value.length});save();return send(200,null);}}
 else {state.writerDenied++;save();return send(403,{message:'LOCAL894_READ_NOT_IN_SCOPE'});}
 state.trace.push({read:name,rows:value.length});save();return send(200,value);
 }
 if(req.method==='POST'&&url.pathname.startsWith('/rest/v1/rpc/')){
 const name=url.pathname.slice('/rest/v1/rpc/'.length);let value;
 if(name==='get_my_ops_capability_scope'){assert.equal(Object.keys(body).length,0);value=native("SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]') FROM public.get_my_ops_capability_scope()w");}
 else if(name==='get_my_ops_global_capability'){assert.equal(Object.keys(body).length,0);value=native("SELECT coalesce(jsonb_agg(jsonb_build_object('is_super_admin',w.is_super_admin)),'[]') FROM public.get_my_ops_global_capability()w");assert.deepEqual(value,[{is_super_admin:false}]);}
 else if(name==='get_issued_chip_inventory'){assert.equal(body.p_tournament_id,tour);value=native(`SELECT public.get_issued_chip_inventory('${tour}')`);}
 else {state.writerDenied++;save();return send(403,{message:'LOCAL894_RPC_NOT_IN_SCOPE'});}
 state.trace.push({rpc:name,readOnly:true});save();return send(200,value);
 }
 state.writerDenied++;state.trace.push({kind:'endpoint_denied',path:url.pathname});save();return send(403,{message:'LOCAL894_ENDPOINT_NOT_ALLOWED'});
 }catch{state.trace.push({kind:'adapter_error'});save();return send(500,{message:'LOCAL894_ADAPTER_FAILED'});}
});save();server.listen(54329,'127.0.0.1',()=>console.log('CHIP894_NATIVE_CAPACITY_ADAPTER_READY',JSON.stringify({tour})));

process.stdin.once('data',()=>{process.stdin.pause();server.close(()=>{assert.equal(proof(),before);state.finalUnchanged=true;save();console.log('CHIP894_FINAL_PROTECTED_FACTS_UNCHANGED');process.exit(0);});server.closeAllConnections();});
