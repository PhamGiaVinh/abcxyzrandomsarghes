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
const tables=['clubs','tournaments','table_sessions','dealer_assignments','tournament_entries','tournament_seats','tournament_hands','tournament_registrations','cashier_buyin_movements','seat_draw_receipts','seat_assignment_history','tournament_chip_counts','notifications','table_operation_receipts'];
const fingerprint=()=>sql(`SELECT jsonb_object_agg(name,digest) FROM (${tables.map(name=>`SELECT '${name}' name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY to_jsonb(t)::text),'')) digest FROM public.${name} t`).join(' UNION ALL ')}) x;`);
const before=fingerprint();
const output=sql(String.raw`\set FIXED_REENTRY true
\set SERVER_PRICED_REENTRY true
\set PAID_REGISTRATION ${fixture.registration}
`+readFileSync(new URL('./reentryCanonicalGap.pg17.sql',import.meta.url),'utf8'));
assert.match(output,/SERVER_PRICED_REENTRY_CASH_SESSION_TICKET_REPLAY_PASS/);assert.equal(fingerprint(),before);
console.log('PORTABLE_CANONICAL_CREATE_OPEN_INITIAL_PAYMENT_REENTRY_MATRIX_ROLLBACK_PASS');
