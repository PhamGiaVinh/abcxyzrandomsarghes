import assert from 'node:assert/strict';
import {existsSync,writeFileSync} from 'node:fs';
import {sql} from '../publicHud/nativeDb.mjs';
const db='vinpoker_hud_test_showdown_20261107d',tour='de780003-0000-4000-8000-000000000001',owner='de780000-0000-4000-8000-000000000001';
const foreignOwner='de790000-0000-4000-8000-000000000001',foreignClub='de790002-0000-4000-8000-000000000001',foreignTour='de790003-0000-4000-8000-000000000001';
assert.equal(process.env.PUBLIC_HUD_LOCAL_DATABASE,db);
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),db+'|127.0.0.1|55441');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'vinpoker-owned-showdown-20261107d');
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));"),'f');
const output=process.env.NATIVE_CLOSE_BOUNDARIES_REPORT;
assert.match(output??'',/^D:\/Quy-trinh-hud-scale-evidence\/close-paid-prize-boundaries-[a-z0-9-]+\.json$/);assert.equal(existsSync(output),false);
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const auth=actor=>'RESET ROLE;SET LOCAL request.jwt.claim.sub='+q(actor)+';SET LOCAL request.jwt.claims='+q(JSON.stringify({sub:actor,role:'authenticated'}))+';SET LOCAL ROLE authenticated;';
const snapshot=()=>sql("SELECT md5((SELECT to_jsonb(r)::text FROM public.tournament_close_report r WHERE tournament_id="+q(tour)+")||coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY id)::text FROM public.tournament_prize_payments p WHERE tournament_id="+q(tour)+"),''));");
const before=snapshot();
// These additional rows are classifier fixtures, not canonical cash movements.
// All fixture setup and RPC calls are in one transaction, always rolled back.
const query=[
 '\\set VERBOSITY verbose\nBEGIN;',
 "DO $$ BEGIN ASSERT NOT EXISTS(SELECT 1 FROM auth.users WHERE id="+q(foreignOwner)+");ASSERT NOT EXISTS(SELECT 1 FROM public.clubs WHERE id="+q(foreignClub)+");ASSERT NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id="+q(foreignTour)+");END $$;",
 'INSERT INTO auth.users(id) VALUES('+q(foreignOwner)+');',
 "INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES("+q(foreignClub)+','+q(foreignOwner)+",'Close boundary TEST foreign','HCM','approved');",
 "INSERT INTO public.tournaments(id,club_id,name,status,live_status,start_time,buy_in) VALUES("+q(foreignTour)+','+q(foreignClub)+",'Close boundary TEST foreign','registering','registering',now(),1000);",
 'INSERT INTO public.tournament_prize_payments(tournament_id,club_id,finished_place,prize_amount,status,paid_by,method) VALUES('+q(tour)+",'de780002-0000-4000-8000-000000000001',97,999999,'returned',"+q(owner)+",'cash'),("+q(tour)+",'de780002-0000-4000-8000-000000000001',98,888888,'cancelled',"+q(owner)+",'cash'),("+q(foreignTour)+','+q(foreignClub)+",1,777777,'paid',"+q(foreignOwner)+",'cash');",
 auth(owner),
 'SELECT public.get_tournament_close_readiness_v1('+q(tour)+');',
 'SELECT public.get_tournament_close_readiness_v1('+q(foreignTour)+');',
 auth(foreignOwner),
 'SELECT public.get_tournament_close_readiness_v1('+q(tour)+');',
 'SELECT public.close_tournament('+q(tour)+",'foreign owner denial');",
 'SELECT public.record_tournament_prize_payment_v2('+q(tour)+",1,'cash','00000000000000000000000000000000','de790013-0000-4000-8000-000000000001');",
 "SELECT public.get_tournament_prize_payment_receipt_v2('de780013-0000-4000-8000-000000000001');",
 'ROLLBACK;'
].join('\n');
try{
 const rows=sql(query,{captureFailure:true}).split('\n').map(JSON.parse);assert.equal(rows.length,6);
 assert.equal(rows[0].prize_total,18000000);assert.equal(rows[0].reconcile_delta,0);
 for(const r of rows.slice(1,5)){assert.equal(r.ok,false);assert.equal(r.error,'actor_not_allowed');}
 assert.deepEqual(rows[5],{found:false});assert.equal(snapshot(),before);
 assert.equal(sql('SELECT count(*) FROM auth.users WHERE id='+q(foreignOwner)+';'),'0');
 const report={passed:true,productionChanged:false,transactionRolledBack:true,returnedAndCancelledExcluded:true,foreignPaidRowsExcluded:true,bothTenantDirectionsDenied:true,foreignCloseDenied:true,foreignPaymentDenied:true,foreignReceiptHidden:true,immutableReportAndPaidRowsUnchanged:true,limits:'Actual PostgreSQL authenticated RPCs in owned clone. Extra payment rows are rolled-back classifier fixtures, not proof of canonical returned/cancelled payment journeys. No HTTP/UI or payout-versus-close race.'};
 writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
}catch(error){console.log(JSON.stringify({passed:false,sqlstate:String(error.stderr??'').match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]??null,assertionCode:error.code??null}));process.exitCode=1;}
