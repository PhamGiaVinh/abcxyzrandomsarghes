// Actual panel/SDK/native SQL rejection; all native transactions ROLLBACK.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {writeFileSync,readFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_D2_CAPACITY882_LOCAL,'1');
const db='vinpoker_ranking860_local',event='e6551af0-e6d0-4fb0-9342-fdd7465fcaf2',tour='0f56388a-c47f-48fd-970a-4f5589627d4b',actor='ba3e052f-27d5-4da5-b832-0b5d9cecbf2f',club='399956aa-7858-422a-ad34-ca7ee52ff64d';
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:2e6,stdio:['pipe','pipe','pipe']}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),`${db}|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data`);
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql('SELECT package_hash FROM floor_private.ranking860_install_backup;'),'d786e04b14c42eaeb0832b97ea47f992eacd755ad1e94d9022f6a28920c778bd');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}';`),'0');
const table=sql(`SELECT id FROM public.tournament_tables WHERE tournament_id='${tour}' AND status='active' ORDER BY table_number LIMIT 1;`);assert.match(table,/^[a-f0-9-]{36}$/);
const tables=['tournaments','tournament_entries','tournament_seats','tournament_tables','table_sessions','table_session_seat_locks','cashier_buyin_movements','tournament_chip_counts','multi_day_package_release_v1','centerpoint_tournament_ops_release'];
const proof=()=>sql(`BEGIN READ ONLY;SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_build_array('${t}',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),''))) FROM public.${t} r)`).join(',')},(SELECT count(*) FROM private.multi_day_initial_draw_plans_v1),(SELECT count(*) FROM private.multi_day_initial_draw_applications_v1))::text);ROLLBACK;`);
const before=proof(),state={scope:'native capacity rejection only; no persisted preview/apply',before,table,trace:[],writerDenied:0};
const save=()=>writeFileSync('D:/Quy trình/output/reports/d2_882-native-browser-state-local-20261026.json',JSON.stringify(state,null,2)+'\n');
const setup=`BEGIN;SET LOCAL statement_timeout='8s';UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY['${club}'::uuid] WHERE id;UPDATE public.centerpoint_tournament_ops_release SET enabled=true,allowed_club_ids=ARRAY['${club}'::uuid] WHERE id;
 INSERT INTO public.table_session_seat_locks(tournament_id,tournament_table_id,table_session_id,seat_number,reason,locked_by) SELECT '${tour}',t.id,t.table_session_id,n,'LOCAL882 rollback capacity','${actor}' FROM public.tournament_tables t CROSS JOIN LATERAL generate_series(1,t.max_seats)n WHERE t.id='${table}';
 SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
const roster=()=>JSON.parse(sql(`${setup}SELECT public.multi_day_final_roster_v1('${event}');ROLLBACK;`));
const first=roster();assert.equal(first.players.length,1);assert.equal(first.players[0].state,'UNSEATED');const locked=first.tables.find(t=>t.tournamentTableId===table);assert.equal(locked.lockedSeats.length,locked.capacity);
if(process.argv.includes('--inspect')){const prior=JSON.parse(readFileSync('D:/Quy trình/output/reports/d2_882-native-browser-state-local-20261026.json','utf8'));assert.equal(before,prior.before);console.log('D2_882_POSTSTOP_PROTECTED_FACTS_UNCHANGED');process.exit(0);}
const sessions=new Map(),key=randomUUID(),user={id:actor,email:'capacity882@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-26T00:00:00Z'};
const server=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Cache-Control','no-store');const send=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};
 if(req.headers.host!=='127.0.0.1:54329'||(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:5188'))return send(403,{message:'LOCAL882_SCOPE'});if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{const url=new URL(req.url,'http://127.0.0.1:54329');let raw='';for await(const c of req){raw+=c;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
 if(url.pathname==='/__local/manifest')return send(200,{tour,actor,club,d2Event:event,email:user.email,runId:'882',model:'native SQL rollback / Auth HTTP modeled'});
 if(url.pathname==='/auth/v1/token'){assert.equal(body.email,user.email);assert.equal(body.password,'LOCAL_TEST_ONLY');const exp=Math.floor(Date.now()/1000)+3600,base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url'),token=base+'.'+createHmac('sha256',key).update(base).digest('base64url');sessions.set(token,true);return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});}
 if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{message:'LOCAL882_LOGIN_REQUIRED'});
 if(url.pathname==='/auth/v1/user')return send(200,user);
 if(req.method==='GET'&&url.pathname.startsWith('/rest/v1/'))return send(200,url.pathname==='/rest/v1/clubs'?[{id:club}]:[]);
 if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/multi_day_final_roster_v1'){assert.equal(body.p_event_id,event);state.trace.push({kind:'roster'});save();return send(200,roster());}
 if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/multi_day_plan_initial_draw_v1'){
 assert.equal(body.p_event_id,event);assert.deepEqual(body.p_tournament_table_ids,[table]);assert.match(body.p_request_id,/^[a-f0-9-]{36}$/);assert.match(body.p_expected_source_hash,/^[a-f0-9]{32}$/);
 const value=JSON.parse(sql(`${setup}DO $$BEGIN PERFORM public.multi_day_plan_initial_draw_v1('${event}',ARRAY['${table}'::uuid],'${body.p_expected_source_hash}','${body.p_request_id}');RAISE EXCEPTION 'LOCAL882_UNEXPECTED_PLAN';EXCEPTION WHEN check_violation THEN PERFORM set_config('local882.error',jsonb_build_object('code',SQLSTATE,'message',SQLERRM)::text,true);END $$;SELECT current_setting('local882.error');ROLLBACK;`));assert.deepEqual(value,{code:'23514',message:'multi_day_initial_draw_insufficient_capacity'});state.trace.push({kind:'native_rejection',request:body.p_request_id,...value});state.unchanged=proof()===before;assert.equal(state.unchanged,true);save();return send(400,value);
 }
 state.writerDenied++;state.trace.push({kind:'endpoint_denied',path:url.pathname});save();return send(403,{message:'LOCAL882_ENDPOINT_NOT_ALLOWED'});
 }catch{state.trace.push({kind:'adapter_error'});save();return send(500,{message:'LOCAL882_ADAPTER_FAILED'});}
});save();server.listen(54329,'127.0.0.1',()=>console.log('D2_882_NATIVE_CAPACITY_ADAPTER_READY',JSON.stringify({table,event})));
