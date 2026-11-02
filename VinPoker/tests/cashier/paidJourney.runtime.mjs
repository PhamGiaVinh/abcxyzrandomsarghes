import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createPaidJourneyFixture} from './paidJourney.fixture.mjs';
const database='vinpoker_ops_cash115_qualified_c';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55441');
assert.equal(process.env.PGUSER,'postgres');assert.equal(process.env.PGDATABASE,database);
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
const binary=prefix.length?'wsl':'psql',flags=['-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync(binary,[...prefix,...flags],{input:q,encoding:'utf8',timeout:30000}).trim();
const fixture=createPaidJourneyFixture(sql);
const tables=['clubs','tournaments','table_sessions','dealer_assignments','tournament_entries','tournament_seats','tournament_hands','tournament_registrations','cashier_buyin_movements','seat_draw_receipts','seat_assignment_history','tournament_chip_counts','notifications','table_operation_receipts','table_session_seat_locks','floor_pending_tracker_moves','tv_displays','tournament_events','tv_tournament_layouts'];
const fingerprint=()=>sql(`SELECT jsonb_object_agg(name,digest) FROM (${tables.map(name=>`SELECT '${name}' name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY to_jsonb(t)::text),'')) digest FROM public.${name} t`).join(' UNION ALL ')}) x;`);
const before=fingerprint();
const output=sql(String.raw`\set FIXED_REENTRY true
\set SERVER_PRICED_REENTRY true
\set PAID_REGISTRATION ${fixture.registration}
\set PAID_MOVE_CASE ${process.argv.includes('--pending-move')?'true':'false'}
\set PAID_CORRECTION_CASE ${process.argv.includes('--legacy-correction')?'true':'false'}
`+readFileSync(new URL(process.argv.includes('--active-hand')?'./paidActiveHand.pg17.sql':process.argv.includes('--seat-blockers')?'./paidSeatLocks.pg17.sql':'./reentryCanonicalGap.pg17.sql',import.meta.url),'utf8'));
assert.match(output,process.argv.includes('--active-hand')?/ACTUAL_HAND_PAID_WAIT_FINISH_PENDING_MODE_THEN_SEAT_PASS/:process.argv.includes('--seat-blockers')?/PAID_SEAT_LOCK_WAIT_UNLOCK_EXACT_SESSION_NO_NEW_MONEY_PASS/:/SERVER_PRICED_REENTRY_CASH_SESSION_TICKET_REPLAY_PASS/);assert.equal(fingerprint(),before);
console.log(process.argv.includes('--legacy-correction')?'LEGACY_CORRECTION_ALERT_WITHOUT_VOICE_PAID_WAIT_PASS':process.argv.includes('--pending-move')?'CANONICAL_PAID_MOVE_FINISH_MODE_WAITING_SEAT_ROLLBACK_PASS':process.argv.includes('--active-hand')?'CANONICAL_ACTIVE_HAND_PAID_WAIT_ROLLBACK_PASS':process.argv.includes('--seat-blockers')?'CANONICAL_PUBLIC_SEAT_LOCK_PAID_WAIT_UNLOCK_ROLLBACK_PASS':'PORTABLE_CANONICAL_CREATE_OPEN_INITIAL_PAYMENT_REENTRY_MATRIX_ROLLBACK_PASS');
