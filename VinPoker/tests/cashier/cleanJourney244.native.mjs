import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createUnregisteredJourneyFixture} from './paidJourney.fixture.mjs';
// Fresh-only explicit start. Never re-run to recover an unknown create result;
// retain the emitted manifest/fixture table and inspect it instead.
assert.equal(process.env.VINPOKER_CREATE_CLEAN_R11_244,'1');
const sql=input=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441',
 'PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],
 {input,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
assert.equal(sql('SHOW data_directory;'),'/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'clean244_fixture_%';"),'0',
 'fresh-only clean R11 already exists; recover its exact manifest, never create another');
const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p),
 (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.chip_inventory_ledger l),
 (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.chip_bank_ledger l),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_attendance a),
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY club_id) FROM public.club_settings s WHERE auto_swing_enabled)
 )::text);`);
const before=fingerprint();
const fixture=createUnregisteredJourneyFixture(sql);
assert.equal(fingerprint(),before,'clean metadata creation changed existing money/chips/attendance/active-auto scopes');
console.log('CLEAN_R11_244_CANONICAL_TOUR_ZERO_REGISTRATIONS_PAYMENTS_SEATS_CHIPSET_PASS',JSON.stringify({fixture,before,
 model:'LOCAL_METADATA_USERS_CLUB_CANONICAL_TOUR_RPC_NOT_BROWSER_CREATE',next:'SETUP_CHIP_BEFORE_FIRST_REGISTRATION'}));
