// Actual product panel + SDK + PostgreSQL; Auth and HTTP are modeled locally.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID,createHmac} from 'node:crypto';
assert.equal(process.env.VINPOKER_CLOSE879_LOCAL,'1');
const mode=process.argv[2];assert.ok(['--seed','--serve','--inspect'].includes(mode));
const checkpoint=process.env.VINPOKER_RANKING_BROWSER_CHECKPOINT??'879';assert.ok(['879'].includes(checkpoint));
const readOnly874=process.env.VINPOKER_CLOSE874_READ_ONLY==='1';
if(readOnly874){assert.equal(checkpoint,'868');assert.notEqual(mode,'--seed','874 must reuse the closed fixture');}
const clone='vinpoker_ranking860_local',primary='vinpoker_ops_cash115_qualified_c';
const sql=(db,q)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:2e6,stdio:['pipe','pipe','pipe']}).trim();
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const id=n=>`fa${checkpoint}000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(10),tour=id(2),club=id(1),base='http://127.0.0.1:54329',origin='http://127.0.0.1:5188';
const seedEvidence=`D:/Quy trình/output/reports/ranking${checkpoint}-native-browser-state-local-20261026.json`;
const evidence=readOnly874?'D:/Quy trình/output/reports/close874-native-browser-state-local-20261026.json':seedEvidence;
assert.equal(sql(clone,"SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),`${clone}|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data`);
assert.equal(sql(clone,"SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql(clone,'SELECT package_hash FROM floor_private.ranking860_install_backup;'),'d786e04b14c42eaeb0832b97ea47f992eacd755ad1e94d9022f6a28920c778bd');
assert.equal(sql(clone,"SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
const tables=['tournaments','tournament_entries','tournament_seats','tournament_hands','hand_players','tournament_eliminations','cashier_buyin_movements','tournament_prize_payments','tournament_close_report','game_tables','table_sessions','tournament_tables'];
const proof=db=>sql(db,`BEGIN READ ONLY;SET LOCAL statement_timeout='15s';SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_build_array('${t}',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY id),''))) FROM public.${t} r ${checkpoint==='879'&&db===clone&&['tournaments','tournament_entries','tournament_close_report'].includes(t)?`WHERE ${t==='tournaments'?'id':'tournament_id'}<>'${tour}'`:''})`).join(',')})::text);ROLLBACK;`);
const reviewCount=()=>Number(sql(clone,`SELECT count(*) FROM floor_private.tournament_ranking_reviews296 WHERE tournament_id='${tour}';`));
if(mode==='--seed'){
 assert.equal(sql(clone,`SELECT count(*) FROM public.clubs WHERE id='${club}';`),'0','867 fixture consumed; do not recreate');
 const before=proof(primary);
 const fixture=readFileSync('tests/cashier/ranking857.manual-review.rollback.sql','utf8');
 assert.equal(fixture.split('ROLLBACK;').length,2);
 sql(clone,fixture.replaceAll('fa857000',`fa${checkpoint}000`).replace(/^ROLLBACK;\r?$/m,'COMMIT;'));
 assert.equal(proof(primary),before);
 writeFileSync(evidence,JSON.stringify({tour,actor,club,algorithm:'ordered-row-md5-867',primary:before,clone:proof(clone),trace:[],counts:{confirm:0,receipt:0,close:0},reviewCount:reviewCount()},null,2)+'\n');
 console.log('RANK'+checkpoint+'_SYNTHETIC_CLONE_FIXTURE_SEEDED_PRIMARY_UNCHANGED');
}else{
 const initial=JSON.parse(readFileSync(seedEvidence,'utf8'));assert.equal(initial.tour,tour);assert.equal(proof(primary),initial.primary);assert.equal(proof(clone),initial.clone);
 const snapshot=()=>({proofScope:checkpoint==='879'?'12 tables; exact fixture omitted from tournaments,entries,close_report':'12 complete business tables',primaryUnchanged:proof(primary)===initial.primary,cloneBusinessUnchanged:proof(clone)===initial.clone,reviewCount:reviewCount(),reviews:JSON.parse(sql(clone,`SELECT coalesce(jsonb_agg(jsonb_build_object('request',request_id,'hash',source_hash,'order',ordered_entry_ids)),'[]') FROM floor_private.tournament_ranking_reviews296 WHERE tournament_id='${tour}';`))});
 if(mode==='--inspect')console.log(JSON.stringify(snapshot()));
 else{
  const state=readOnly874?{...initial,trace:[],counts:{confirm:0,receipt:0,close:0},finalVerification:undefined,read874:{held:0,aborted:0,delivered:0,writerDenied:0}}:initial;
  const sessions=new Map(),signing=randomUUID();let receiptEnabled=true,drop=false,holdReads=readOnly874;
  const save=()=>writeFileSync(evidence,JSON.stringify(state,null,2)+'\n');
  const user={id:actor,email:`ranking${checkpoint}@example.invalid`,aud:'authenticated',role:'authenticated',created_at:'2026-10-26T00:00:00Z',email_confirmed_at:'2026-10-26T00:00:00Z',app_metadata:{},user_metadata:{display_name:'Floor867 TEST'}};
  const authSql=expr=>JSON.parse(sql(clone,`BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;SELECT to_jsonb(${expr});COMMIT;`));
  const server=createServer(async(req,res)=>{
   const send=(status,data)=>{
    const path=new URL(req.url,base).pathname;
    const reportRead=readOnly874&&(path==='/rest/v1/rpc/get_tournament_close_readiness_v1'||path==='/rest/v1/tournament_registrations'||path==='/rest/v1/tournament_eliminations');
    if(reportRead&&status===200){
     if(holdReads){state.read874.held++;save();res.once('close',()=>{if(!res.writableEnded){state.read874.aborted++;save();}});return;}
     state.read874.delivered++;save();
    }
    res.writeHead(status);res.end(JSON.stringify(data));
   };
   res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept-profile,content-profile');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
   if(req.headers.host!=='127.0.0.1:54329'||(req.headers.origin&&req.headers.origin!==origin))return send(403,{message:'LOCAL867_SCOPE'});
   if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
   try{
    const url=new URL(req.url,base),token=String(req.headers.authorization??'').replace(/^Bearer /,'');
    const chunks=[];for await(const part of req)chunks.push(part);const raw=Buffer.concat(chunks).toString('utf8');
    if(req.method==='GET'&&url.pathname==='/__local/manifest')return send(200,{runId:readOnly874?'874':checkpoint,tour,actor,club,email:user.email,model:'Auth/HTTP modeled; clone PostgreSQL native'});
    if(req.method==='POST'&&url.pathname==='/auth/v1/token'){
     const body=JSON.parse(raw);if(body.email!==user.email||body.password!=='LOCAL_TEST_ONLY')return send(401,{message:'LOCAL867_TEST_LOGIN_ONLY'});
     const exp=Math.floor(Date.now()/1000)+3600,unsigned=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp,iat:exp-3600,iss:base+'/auth/v1'})).toString('base64url');
     const value={access_token:unsigned+'.'+createHmac('sha256',signing).update(unsigned).digest('base64url'),refresh_token:randomUUID(),token_type:'bearer',expires_in:3600,expires_at:exp,user};sessions.set(value.access_token,value);return send(200,value);
    }
    if(!sessions.has(token))return send(401,{message:'LOCAL867_LOGIN_REQUIRED'});
    if(req.method==='GET'&&url.pathname==='/auth/v1/user')return send(200,user);
    if(readOnly874&&req.method==='POST'&&url.pathname==='/__local/close-read-restore'){holdReads=false;return send(200,{ok:true});}
    if(req.method==='POST'&&url.pathname==='/__local/ranking-receipt-enable'){receiptEnabled=true;return send(200,{ok:true});}
    if(req.method==='GET'&&url.pathname.startsWith('/rest/v1/')){
     // Base-role transport is modeled. Native owner authority is checked by each RPC.
     const table=url.pathname.slice('/rest/v1/'.length);
     if(table==='clubs')return send(200,[{id:club}]);
     if(checkpoint==='879'&&['tournament_registrations','tournament_eliminations'].includes(table)){
      assert.equal(url.searchParams.get('tournament_id'),'eq.'+tour);
      const columns=table==='tournament_registrations'?'buy_in,total_pay,reference_code,status':'position,prize';
      const where=table==='tournament_registrations'?" AND status='confirmed'":'';
      const value=JSON.parse(sql(clone,`BEGIN READ ONLY;SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;SELECT coalesce(jsonb_agg(r),'[]') FROM(SELECT ${columns} FROM public.${table} WHERE tournament_id='${tour}'${where})r;ROLLBACK;`));return send(200,value);
     }
     if(['user_roles','dealers','club_chip_masters','club_marketers','club_fnb_staff','club_accountants'].includes(table))return send(200,[]);
     return send(403,{message:'LOCAL867_READ_NOT_IN_SCOPE'});
    }
    if(req.method==='POST'&&url.pathname.startsWith('/rest/v1/rpc/')){
     const name=url.pathname.slice('/rest/v1/rpc/'.length),body=JSON.parse(raw);assert.equal(body.p_tournament_id,tour);let expr;
     if(readOnly874&&name!=='get_tournament_close_readiness_v1'){
      state.read874.writerDenied++;save();return send(403,{message:'LOCAL874_READ_ONLY'});
     }
     if(checkpoint==='879'&&name==='get_tournament_close_readiness_v1')expr=`public.${name}('${tour}')`;
     else if(checkpoint==='879'&&name==='close_tournament'){
      assert.equal(body.p_reason,'close_report');state.counts.close++;state.trace.push({kind:'close',tour});save();expr=`public.${name}('${tour}','close_report')`;
     }
     else if(name==='get_tournament_ranking_review_v1')expr=`public.${name}('${tour}')`;
     else{
      assert.equal(body.p_expected_actor_id,actor);assert.match(body.p_request_id,/^[a-f0-9-]{36}$/);
      if(name==='get_tournament_ranking_review_receipt_v1'){
       state.counts.receipt++;state.trace.push({kind:'receipt',request:body.p_request_id,enabled:receiptEnabled});save();
       if(!receiptEnabled)return send(503,{message:'LOCAL867_RECEIPT_READ_HELD'});
       expr=`public.${name}('${tour}',${quote(body.p_request_id)}::uuid,'${actor}')`;
      }else if(name==='confirm_tournament_ranking_review_v1'){
       assert.match(body.p_expected_source_hash,/^[a-f0-9]{32}$/);assert.deepEqual([...body.p_ordered_entry_ids].sort(),[21,22,23,24].map(id).sort());
       const prior=state.trace.find(x=>x.kind==='confirm');if(prior){assert.equal(body.p_request_id,prior.request);assert.deepEqual(body.p_ordered_entry_ids,prior.order);}
       state.counts.confirm++;state.trace.push({kind:'confirm',request:body.p_request_id,hash:body.p_expected_source_hash,order:body.p_ordered_entry_ids});save();
       expr=`public.${name}('${tour}',${quote(body.p_expected_source_hash)},ARRAY[${body.p_ordered_entry_ids.map(quote).join(',')}]::uuid[],${quote(body.p_request_id)}::uuid,'${actor}')`;
      }else return send(403,{message:'LOCAL867_RPC_NOT_IN_SCOPE'});
     }
     const value=authSql(expr);state.trace.push({kind:'rpc_complete',name,outcome:value.outcome??null});save();
     if(name==='close_tournament'){state.trace.push({kind:'close_committed_response_held',report:value.report_id,outcome:value.outcome});save();res.once('close',()=>{state.trace.push({kind:'close_client_disconnected'});save();});return;}
     if(name==='confirm_tournament_ranking_review_v1'&&drop){drop=false;res.writeHead(200);res.flushHeaders();res.write('{');state.trace.push({kind:'committed_body_truncated'});save();setTimeout(()=>res.destroy(),50);console.log('RANK'+checkpoint+'_CONFIRM_COMMITTED_RESPONSE_TRUNCATED');return;}
     return send(200,value);
    }
    return send(403,{message:'LOCAL867_ROUTE_NOT_IN_SCOPE'});
   }catch(error){console.error('RANK867_REQUEST_FAILED',error instanceof assert.AssertionError?'scope_assertion':error?.stderr?'native_error':'transport_error');return send(500,{message:'LOCAL867_REQUEST_FAILED'});}
  });
  server.listen(54329,'127.0.0.1',()=>console.log('RANK'+checkpoint+'_LOCAL_ADAPTER_READY'));
  process.once('SIGINT',()=>{server.close(()=>{const result=snapshot();state.final=result;save();console.log('RANK867_FINAL',JSON.stringify(result));process.exit(result.primaryUnchanged&&result.cloneBusinessUnchanged?0:1);});});
 }
}
