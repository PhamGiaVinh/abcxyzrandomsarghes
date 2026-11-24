// Local schema-clone proof; capture contains private fixture rows and must never be committed.
// Requires an empty owned finance_free_test_schema DB on loopback:6543, restored
// from the schema-only clone identified in the reviewed manifest. No remote URLs accepted.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const psql=process.env.PSQL_BIN || 'psql';
assert.ok(process.env.CAPTURE_FILE, 'read-only reviewed capture path required');
const args=['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','6543','-U','postgres','-d','finance_free_test_schema'];
function sql(q){return execFileSync(psql,args,{input:q,encoding:'utf8',windowsHide:true,maxBuffer:12e6}).trim();}
assert.equal(sql("SELECT host(inet_server_addr())||':'||inet_server_port()||':'||current_database();"),'127.0.0.1:6543:finance_free_test_schema');
const capture=JSON.parse(readFileSync(process.env.CAPTURE_FILE,'utf8')).rows[0].capture;
const manifest=JSON.parse(readFileSync('docs/runbooks/free-felt-test-finance-20261124-manifest.json','utf8'));
assert.ok(process.env.SCHEMA_FILE,'reviewed schema-only clone path required');
assert.equal(createHash('sha256').update(readFileSync(process.env.SCHEMA_FILE)).digest('hex'),manifest.schemaCloneSha256);
assert.deepEqual(capture.registrations.map(r=>r.id).sort(),manifest.registrationIds.toSorted());
assert.equal(capture.tournament.id,manifest.tournamentId);
assert.equal(capture.functions.length,manifest.functions.length);
for(const f of capture.functions){
  assert.equal(createHash('md5').update(f.definition).digest('hex'),manifest.functions.find(m=>m.signature===f.oid)?.definitionMd5,f.oid);
}
// Schema-only clone, updated with exact live definitions for every registration/payment/refund trigger and report reader.
sql(capture.functions.map(f=>f.definition+';').join('\n'));
for(const f of capture.functions){assert.equal(sql(`SELECT md5(replace(pg_get_functiondef('${f.oid.replaceAll("'","''")}'::regprocedure),chr(13),''));`),createHash('md5').update(f.definition.replace(/\r/g,'')).digest('hex'),f.oid);}
assert.equal(sql('SELECT count(*) FROM tournament_registrations;'),'0');
const tour=capture.tournament,regs=capture.registrations;
const actor='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const qjson=x=>"'"+JSON.stringify(x).replaceAll("'","''")+"'::jsonb";
// Fixture setup only: bypass insert-side notification/FK writers, restore triggers before the actual correction.
sql(`BEGIN; SET LOCAL session_replication_role=replica;
INSERT INTO auth.users(id) VALUES('${actor}');
INSERT INTO clubs(id,owner_id,name,region,bot_enabled) VALUES('${tour.club_id}','${actor}','TEST isolated finance','TEST',false);
INSERT INTO tournaments SELECT * FROM jsonb_populate_record(NULL::tournaments,${qjson(tour)});
INSERT INTO club_expenses(club_id,category,amount_vnd,description,incurred_at,entered_by,idempotency_key)
VALUES('${tour.club_id}',enum_first(NULL::expense_category),123000,'TEST unaffected expense','2026-11-02T00:00:00+07','${actor}','FREE-FELT-ISOLATED-EXPENSE');
COMMIT;`);
const auth=`SET request.jwt.claim.sub='${actor}'; SET request.jwt.claim.role='authenticated';`;
const query="SELECT get_club_finance_summary_v2('2026-11-01','2026-11-24','22222222-2222-2222-2222-222222222222');";
const baseline=JSON.parse(sql(auth+query));
assert.equal(baseline.cost.clubExpenses,123000);
sql(`BEGIN; SET LOCAL session_replication_role=replica;
INSERT INTO tournament_registrations SELECT * FROM jsonb_populate_recordset(NULL::tournament_registrations,${qjson(regs)});
INSERT INTO floor_private.tour_revenue_buy_close_v1 SELECT * FROM jsonb_populate_record(NULL::floor_private.tour_revenue_buy_close_v1,${qjson(capture.closedSnapshot)});
INSERT INTO tournament_hands(tournament_id,hand_number,hand_time) SELECT '${tour.id}',n,'2026-07-03T02:02:15.987+07'::timestamptz FROM generate_series(1,31)n;
COMMIT;`);
let oldError='';try{sql(auth+query);}catch(e){oldError=String(e.stderr);}
assert.match(oldError,/finance_report_event_start_unavailable/);
const hash=sql("SET TIME ZONE 'UTC'; SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM tournament_registrations r;");
assert.equal(hash,manifest.expectedPreimageMd5Utc);
const beforeTour=sql(`SET TIME ZONE 'UTC'; SELECT md5(to_jsonb(t)::text) FROM tournaments t WHERE id='${tour.id}';`);
const oldClose=sql(`SELECT md5(snapshot::text) FROM floor_private.tour_revenue_buy_close_v1 WHERE tournament_id='${tour.id}';`);
assert.equal(oldClose,manifest.closedSnapshotJsonMd5);
const ack=`SET vinpoker.free_test_repair_ack='PREPARE_FREE_FELT_2_REGISTRATIONS_20261124'; SET vinpoker.free_test_expected_preimage_md5='${hash}';`;
sql(ack+readFileSync('scripts/production/repairs/repair_free_felt_test_finance_20261124.sql','utf8'));
const report=JSON.parse(sql(auth+query));
assert.equal(report.revenue.total,0);assert.equal(report.revenue.rake,0);assert.equal(report.revenue.serviceFee,0);
assert.deepEqual(report.revenue,baseline.revenue);assert.deepEqual(report.cost,baseline.cost);assert.equal(report.net,baseline.net);
const live=JSON.parse(sql("SELECT floor_private.tour_revenue_live_source_v1('22222222-2222-2222-2222-222222222222');")).tours.find(x=>x.tournamentId===tour.id);
assert.equal(live.unavailableBuys,0);assert.equal(live.rake,0);assert.equal(live.collected,0);
assert.equal(sql(`SET TIME ZONE 'UTC'; SELECT md5(to_jsonb(t)::text) FROM tournaments t WHERE id='${tour.id}';`),beforeTour);
assert.equal(sql(`SELECT md5(snapshot::text) FROM floor_private.tour_revenue_buy_close_v1 WHERE tournament_id='${tour.id}';`),oldClose);
sql(ack+readFileSync('scripts/production/repairs/rollback_free_felt_test_finance_20261124.sql','utf8'));
assert.equal(sql("SET TIME ZONE 'UTC'; SELECT md5(jsonb_agg(to_jsonb(r)-'updated_at' ORDER BY id)::text) FROM tournament_registrations r;"),sql("SET TIME ZONE 'UTC'; SELECT md5(jsonb_agg(before_row-'updated_at' ORDER BY registration_id)::text) FROM floor_private.free_felt_finance_20261124_backup;"));
console.log('CURRENT_TRIGGER_REPORT_NATIVE_PASS: exact live trigger/report definitions, real private classifier and finance_v2; old error -> zero totals; tournament unchanged; rollback with actual triggers. Full schema clone provenance remains separately recorded.');

