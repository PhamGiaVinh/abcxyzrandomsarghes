import assert from 'node:assert/strict';import {readFileSync,writeFileSync,existsSync} from 'node:fs';import {execFileSync} from 'node:child_process';
const [input,output]=process.argv.slice(2);assert.ok(input&&output,'Provide retained race report and new output path');assert.equal(existsSync(output),false);
const prior=JSON.parse(readFileSync(input,'utf8'));assert.equal(prior.phase,'CANONICAL_ONE_FREE_SEAT_LOCK_AND_POSTCOMMIT_RETRY_PASS');const f=prior.fixture;
for(const id of [f.actor,f.club,f.tour,...f.registrations])assert.match(id,/^[a-f0-9-]{36}$/);
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55442','PGUSER=postgres','PGDATABASE=vinpoker_ops_guard_main_20261028_v2','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||current_setting('data_directory');"),'vinpoker_ops_guard_main_20261028_v2|/tmp/vinpoker-main-guards-20261028/data');
assert.equal(sql(`SELECT count(*) FROM public.clubs WHERE id='${f.club}' AND owner_id='${f.actor}';`),'1');
const player=sql(`SELECT player_id FROM public.tournament_registrations WHERE id='${f.registrations[1]}' AND tournament_id='${f.tour}';`);assert.match(player,/^[a-f0-9-]{36}$/);
const fingerprint=()=>sql(`BEGIN READ ONLY;SELECT md5(jsonb_build_array(${['tournament_registrations','tournament_entries','tournament_seats','seat_draw_receipts','cashier_buyin_movements'].map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.${t} x WHERE tournament_id='${f.tour}')`).join(',')})::text);ROLLBACK;`);
const call=(uid,actor,role='authenticated',reg=f.registrations[0])=>JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${uid}';SET LOCAL request.jwt.claims='${JSON.stringify({role,...(uid?{sub:uid}:{})})}';SET LOCAL ROLE ${role};SELECT public.confirm_registration_and_assign_seat('${reg}',${actor?"'"+actor+"'":"NULL"},'random_balanced');ROLLBACK;`));
const report={kind:'RETAINED_LOCAL_CONFIRM_ACTOR_BINDING_MATRIX_NOT_HOSTED',fixture:f,before:fingerprint(),cases:{}};
report.cases.nullActor=call(f.actor,null);report.cases.forgedOwner=call(player,f.actor);report.cases.nonCashier=call(player,player);report.cases.pendingForgedOwner=call(player,f.actor,'authenticated',f.registrations[1]);report.cases.serviceWithoutUser=call('',f.actor,'service_role');
for(const value of Object.values(report.cases)){assert.equal(value.ok,false);assert.equal(value.error,'actor_not_allowed');}
assert.equal(sql("SELECT has_function_privilege('anon','public.confirm_registration_and_assign_seat(uuid,uuid,text)'::regprocedure,'EXECUTE');"),'f');
report.cases.ownerReceipt=call(f.actor,f.actor);assert.equal(report.cases.ownerReceipt.ok,true);assert.equal(report.cases.ownerReceipt.idempotent,true);
for(const key of ['entry_id','seat_id','receipt_id','receipt_code'])assert.equal(report.cases.ownerReceipt[key],prior.responses[0][key]);
report.after=fingerprint();assert.equal(report.after,report.before);report.phase='CONFIRM_ACTOR_BINDING_DENIAL_AND_EXACT_RECEIPT_PASS';writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(report.phase);
