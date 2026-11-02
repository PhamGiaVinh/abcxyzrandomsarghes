// Original Main167 local TEST only. Canonical payout records, never bank/cash transfer.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createHmac,randomUUID} from 'node:crypto';
import {writeFileSync,readFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_MAIN910_COMMIT_LOCAL,'1');
const db='vinpoker_ops_cash115_qualified_c',tour='4cd3af4d-7e1d-4042-855f-04fb6777e580',event='dbb49f8d-7d47-4c2c-afd9-f57062c9971d',actor='675fe35e-60a8-4452-bb90-e79486d54da6',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:25000,maxBuffer:2e6,stdio:['pipe','pipe','pipe']}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),`${db}|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data`);
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
assert.equal(sql(`SELECT count(*) FROM public.tournaments WHERE id='${tour}' AND event_id='${event}' AND club_id='${club}' AND status='completed';`),'1');
assert.equal(sql(`SELECT count(*) FROM public.multi_day_package_release_v1 WHERE enabled AND '${club}'::uuid=ANY(allowed_club_ids);`),'0');
const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
const native=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${auth}${q};ROLLBACK;`));
const tables=['tournaments','tournament_events','tournament_entries','tournament_seats','tournament_hands','hand_players','hand_actions','tournament_prizes','tournament_close_report','cashier_buyin_movements','chip_bag','tournament_chip_counts','chip_inventory_ledger','chip_bank_ledger','dealer_attendance','dealer_assignments','notifications','multi_day_final_participations_v1','multi_day_payout_finalizations_v1','multi_day_package_release_v1'];
const proof=()=>sql(`BEGIN READ ONLY;SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_build_array('${t}',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),''))) FROM public.${t} r)`).join(',')})::text);ROLLBACK;`);
const validId=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const quoteIds=ids=>{assert.ok(ids.every(validId));return ids.length?ids.map(v=>`'${v}'::uuid`).join(','):"NULL::uuid";};
const rowProof=(table,where='true')=>sql(`BEGIN READ ONLY;SELECT md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) FROM ${table} r WHERE ${where};ROLLBACK;`);
const path='D:/Quy trình/output/reports/main910-native-browser-state-local-20261026.json';
function verify(state){
 assert.equal(proof(),state.before);
 assert.equal(rowProof('public.tournament_prize_payments',state.records.length?`id NOT IN(${quoteIds(state.records.map(r=>r.payment))}) OR id IS NULL`:'true'),state.paymentBaseline);
 assert.equal(rowProof('private.multi_day_payment_commits_v1',state.records.length?`payment_id NOT IN(${quoteIds(state.records.map(r=>r.payment))}) OR payment_id IS NULL`:'true'),state.commitBaseline);
 assert.equal(rowProof('floor_private.payout_payment_receipts_v1',state.records.length?`NOT(actor_id='${actor}' AND request_id IN(${quoteIds(state.records.map(r=>r.request))}))`:'true'),state.receiptBaseline);
 const rows=JSON.parse(sql(`BEGIN READ ONLY;SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'tour',tournament_id,'part',multi_day_participation_id,'rank',finished_place,'amount',prize_amount,'actor',paid_by,'method',method,'status',status)),'[]') FROM public.tournament_prize_payments WHERE id IN(${quoteIds(state.records.map(r=>r.payment))});ROLLBACK;`));
 assert.equal(rows.length,state.records.length);
 for(const r of state.records){const row=rows.find(x=>x.id===r.payment);assert.ok(row);assert.equal(row.tour,tour);assert.equal(row.part,r.participation);assert.equal(row.rank,r.rank);assert.equal(row.amount,r.amount);assert.equal(row.actor,actor);assert.equal(row.method,'cash');assert.equal(row.status,'paid');}
 const current=native(`SELECT public.get_tournament_payout_recipients('${tour}')`);
 assert.equal(current.places.length,15);assert.equal(Number(current.owedTotal),2500000);
 assert.equal(Number(current.paidTotal),state.initialPaid+state.records.reduce((n,r)=>n+r.amount,0));
 assert.equal(current.paidCount,state.initialPaidCount+state.records.length);
 return current;
}
if(process.argv.includes('--verify-recorded')){const state=JSON.parse(readFileSync(path,'utf8'));const current=verify(state);console.log('MAIN910_DURABLE_RECORDS_FROZEN_FACTS_FLAGS_AND_PRIOR_PAYMENTS_READONLY_VERIFIED',JSON.stringify({paid:current.paidTotal,paidCount:current.paidCount,unpaid:Number(current.owedTotal)-Number(current.paidTotal)}));process.exit(0);}
const source=native(`SELECT public.get_tournament_payout_recipients('${tour}')`);assert.equal(source.mode,'multi_day');assert.equal(source.places.length,15);assert.equal(Number(source.owedTotal),2500000);
assert.equal(sql("SELECT count(*)||'|'||sum(prize_amount) FROM public.tournament_prize_payments WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e';"),'2|900000.00');
const run=randomUUID(),state={run,scope:'original Main167 LOCAL operational payout recording; package qualified and fully restored inside each transaction; no real transfer',before:proof(),paymentBaseline:rowProof('public.tournament_prize_payments'),commitBaseline:rowProof('private.multi_day_payment_commits_v1'),receiptBaseline:rowProof('floor_private.payout_payment_receipts_v1'),initialPaid:Number(source.paidTotal),initialPaidCount:source.paidCount,records:[],attempts:[],trace:[],denied:0};
const save=()=>{const text=JSON.stringify(state,null,2)+'\n';writeFileSync(path,text);writeFileSync(path.replace('.json','-'+run+'.json'),text);};
const sessions=new Set(),key=randomUUID(),user={id:actor,email:'main910@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-26T00:00:00Z'};
const server=createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile,prefer');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Cache-Control','no-store');const send=(status,value)=>{res.writeHead(status);res.end(JSON.stringify(value));};
 if(req.headers.host!=='127.0.0.1:54329'||req.headers.origin&&req.headers.origin!=='http://127.0.0.1:5188')return send(403,{message:'LOCAL910_SCOPE'});
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{
 const url=new URL(req.url,'http://127.0.0.1:54329');let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
 if(url.pathname==='/__local/manifest')return send(200,{tour,actor,club,email:user.email,runId:run,model:'native PostgreSQL COMMIT, Auth/HTTP modeled, no real transfer'});
 if(url.pathname==='/auth/v1/token'){assert.equal(body.email,user.email);assert.equal(body.password,'LOCAL_TEST_ONLY');const exp=Math.floor(Date.now()/1000)+3600,base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url'),token=base+'.'+createHmac('sha256',key).update(base).digest('base64url');sessions.add(token);return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});}
 if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{message:'LOCAL910_LOGIN_REQUIRED'});
 if(url.pathname==='/auth/v1/user')return send(200,user);
 if(req.method==='GET'&&url.pathname.startsWith('/rest/v1/')){
 const table=url.pathname.slice('/rest/v1/'.length);let value;
 if(table==='user_roles')value=native(`SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]') FROM(SELECT role FROM public.user_roles WHERE user_id='${actor}')w`);
 else if(table==='dealers')value=native(`SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]') FROM(SELECT id FROM public.dealers WHERE user_id='${actor}' AND deleted_at IS NULL LIMIT 1)w`);
 else if(table==='clubs')value=native(`SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]') FROM(SELECT id FROM public.clubs WHERE owner_id='${actor}' LIMIT 1)w`);
 else {state.denied++;save();return send(403,{message:'LOCAL910_READ_NOT_IN_SCOPE'});}
 return send(200,value);
 }
 if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/get_tournament_payout_recipients'){assert.equal(body.p_tournament_id,tour);const value=native(`SELECT public.get_tournament_payout_recipients('${tour}')`);state.trace.push({rpc:'recipients',paid:value.paidTotal,paidCount:value.paidCount});save();return send(200,value);}
 if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/get_tournament_prize_payment_receipt_v2'){
 assert.ok(validId(body.p_request_id));const value=native(`SELECT public.get_tournament_prize_payment_receipt_v2('${body.p_request_id}')`);if(value.found)assert.equal(value.payload.tournament_id,tour);state.trace.push({rpc:'receipt',request:body.p_request_id,found:value.found});verify(state);save();return send(200,value);
 }
 if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/record_multi_day_prize_payment_v1'){
 assert.equal(body.p_event_id,event);assert.ok(validId(body.p_participation_id)&&validId(body.p_request_id));assert.equal(body.p_method,'cash');assert.match(body.p_expected_token,/^[a-f0-9]{32}$/);
 const current=native(`SELECT public.get_tournament_payout_recipients('${tour}')`),target=current.places.find(p=>p.multiDayParticipationId===body.p_participation_id),prior=state.records.find(r=>r.request===body.p_request_id);
 assert.ok(target&&source.places.some(p=>p.multiDayParticipationId===target.multiDayParticipationId));
 if(!prior){assert.equal(target.isPaid,false);assert.equal(body.p_expected_token,target.confirmationToken);}else assert.equal(prior.participation,body.p_participation_id);
 const amount=prior?.amount??target.prizeAmount;state.attempts.push({request:body.p_request_id,participation:body.p_participation_id,rank:target.finishedPlace,amount});save();
 const statement=String.raw`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';
 DO $$BEGIN PERFORM 1 FROM public.multi_day_package_release_v1 WHERE id FOR UPDATE;END $$;
 CREATE TEMP TABLE gate910_before ON COMMIT DROP AS SELECT * FROM public.multi_day_package_release_v1;
 UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY(SELECT DISTINCT x FROM unnest(coalesce(allowed_club_ids,'{}'::uuid[])||ARRAY['${club}'::uuid])x) WHERE id;
 ${auth}
 DO $$DECLARE r jsonb;BEGIN
 r:=public.record_multi_day_prize_payment_v1('${event}','${body.p_participation_id}','cash','${body.p_expected_token}','${body.p_request_id}');
 ASSERT r->>'ok'='true' AND r->>'outcome'='recorded',r::text;
 ASSERT (r->>'prize_amount')::numeric=${amount} AND r->>'entry_id'='${target.entryId}' AND r->>'recipient_ref'='${target.recipientRef}';
 PERFORM set_config('local910.result',r::text,true);END $$;
 RESET ROLE;
 UPDATE public.multi_day_package_release_v1 g SET enabled=b.enabled,allowed_club_ids=b.allowed_club_ids,updated_at=b.updated_at FROM gate910_before b WHERE g.id=b.id;
 DO $$BEGIN ASSERT (SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM public.multi_day_package_release_v1 g)=(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM gate910_before b),'local gate not fully restored';END $$;
 SELECT current_setting('local910.result');COMMIT;`;
 const result=JSON.parse(sql(statement));
 if(!prior)state.records.push({request:body.p_request_id,participation:body.p_participation_id,rank:target.finishedPlace,payment:result.payment_id,amount});
 verify(state);if(state.records.length===1&&!state.faultKey)state.faultKey=body.p_request_id;
 const fault=state.faultKey===body.p_request_id;state.trace.push({rpc:'record',request:body.p_request_id,payment:result.payment_id,rank:target.finishedPlace,amount,responseLoss:fault});save();return fault?send(503,{message:'LOCAL910_COMMITTED_RESPONSE_LOSS'}):send(200,result);
 }
 state.denied++;state.trace.push({kind:'endpoint_denied',path:url.pathname});save();return send(403,{message:'LOCAL910_NOT_IN_SCOPE'});
 }catch{state.trace.push({kind:'adapter_error'});save();return send(500,{message:'LOCAL910_UNCONFIRMED_ADAPTER_RESULT'});}
});
save();server.listen(54329,'127.0.0.1',()=>console.log('MAIN910_CANONICAL_LOCAL_PAYMENT_ADAPTER_READY',JSON.stringify({run,initialPaid:state.initialPaid,initialPaidCount:state.initialPaidCount})));
process.stdin.once('data',()=>{process.stdin.pause();server.close(()=>{const current=verify(state);state.final={protectedUnchanged:true,paid:Number(current.paidTotal),paidCount:current.paidCount,unpaid:Number(current.owedTotal)-Number(current.paidTotal)};save();console.log('MAIN910_FINAL_EXACT_RECORDS_AND_FLAGS_RESTORED',JSON.stringify(state.final));process.exit(0);});server.closeAllConnections();});
