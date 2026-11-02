// Retained closed journeys: real RPC replay/readback; every replay transaction rolls back.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_CLOSE877_LOCAL,'1');
const clone='vinpoker_ranking860_local',primary='vinpoker_ops_cash115_qualified_c';
const sql=(db,input)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:20000,maxBuffer:2e6,stdio:['pipe','pipe','pipe']}).trim();
assert.equal(sql(clone,"SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),`${clone}|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data`);
assert.equal(sql(clone,"SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql(clone,'SELECT package_hash FROM floor_private.ranking860_install_backup;'),'d786e04b14c42eaeb0832b97ea47f992eacd755ad1e94d9022f6a28920c778bd');
assert.equal(sql(clone,"SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
const tables=['tournaments','tournament_entries','tournament_seats','tournament_hands','tournament_eliminations','tournament_close_report','tournament_state_transitions','cashier_buyin_movements','tournament_prize_payments','tournament_payout_runs','tournament_prizes','table_sessions','tournament_tables'];
const proof=db=>sql(db,`BEGIN READ ONLY;SET LOCAL statement_timeout='15s';SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_build_array('${t}',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),''))) FROM public.${t} r)`).join(',')})::text);ROLLBACK;`);
const before={primary:proof(primary),clone:proof(clone)},cases=[];
for(const [name,tour,actor] of [
 ['Single244','c367013a-3ed3-48af-ad48-3915acadc50e','febf2b51-fdb7-42ff-886c-b3bb1fffdc3e'],
 ['Main167','4cd3af4d-7e1d-4042-855f-04fb6777e580','675fe35e-60a8-4452-bb90-e79486d54da6'],
 ['Manual868','fa868000-0000-4000-8000-000000000002','fa868000-0000-4000-8000-000000000010'],
]){
 const output=sql(clone,`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
 DO $$ DECLARE a jsonb;b jsonb;r jsonb;s jsonb;BEGIN
 SELECT to_jsonb(x) INTO s FROM public.tournament_close_report x WHERE tournament_id='${tour}';ASSERT s IS NOT NULL;
 a:=public.close_tournament('${tour}','close_report');b:=public.close_tournament('${tour}','close_report');
 ASSERT a->>'ok'='true' AND a->>'outcome'='already_closed',a::text;
 ASSERT jsonb_typeof(a->'ok')='boolean' AND jsonb_typeof(a->'reconciled')='boolean' AND jsonb_typeof(a->'club_revenue')='number','receipt field types differ from UI contract';
 ASSERT mod((a->>'club_revenue')::numeric,1)=0 AND abs((a->>'club_revenue')::numeric)<=9007199254740991,'receipt amount outside UI safe-integer contract';
 ASSERT a=b,'replay responses differ';ASSERT a->>'report_id'=s->>'id','replay report identity changed';
 ASSERT (SELECT to_jsonb(x)=s FROM public.tournament_close_report x WHERE tournament_id='${tour}'),'snapshot changed';
 r:=public.get_tournament_close_readiness_v1('${tour}');ASSERT r->>'ok'='true' AND r->>'already_closed'='true',r::text;
 END $$;
 SELECT jsonb_build_object('name','${name}','tour','${tour}','report',(SELECT id FROM public.tournament_close_report WHERE tournament_id='${tour}'),'replays',2,'alreadyClosed',true);
 ROLLBACK;`);
 cases.push(JSON.parse(output));
}
assert.equal(proof(primary),before.primary);assert.equal(proof(clone),before.clone);
const result={scope:'Real retained closed-result replay/readback; NOT first commit/lost-response browser E2E',cases,protectedTables:tables,primaryUnchanged:true,cloneUnchanged:true,transactions:'ROLLBACK',before};
writeFileSync(process.argv.includes('--receipt884')?'D:/Quy trình/output/reports/close884-native-receipt-contract-local-20261026.json':'D:/Quy trình/output/reports/close877-native-replay-local-20261026.json',JSON.stringify(result,null,2)+'\n');console.log('CLOSE877_NATIVE_REPLAY_READBACK_PASS',JSON.stringify(result));
