import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const sql=input=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441',
 'PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],
 {input,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
assert.equal(sql('SHOW data_directory;'),'/tmp/vinpoker-sol-local-20261016-0e79a729/data');
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const inside=text=>text.replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
const absent=()=>sql(`SELECT to_regprocedure('public.multi_day_save_prize_configuration_v1(uuid,jsonb,text,text,text,text,text,uuid,text)') IS NULL;`);
assert.equal(absent(),'t');
sql('BEGIN;'+inside(read('../../supabase/migrations/20270128000216_multiday_payout_configuration_preview_v1.sql'))
 +inside(read('../../supabase/migrations/20270128000217_multiday_prize_configuration_atomic_v1.sql'))
 +'SAVEPOINT configuration199_cases;'+read('./multiDayPrizeConfiguration.existing.pg17.sql')
 +`ROLLBACK TO SAVEPOINT configuration199_cases;`
 +inside(read('./multiDayPrizeConfiguration.recovery.pg17.sql'))
 +inside(read('./multiDayPayoutConfiguration.recovery.pg17.sql'))
 +`DO $$ BEGIN
   ASSERT to_regprocedure('public.multi_day_save_prize_configuration_v1(uuid,jsonb,text,text,text,text,text,uuid,text)') IS NULL;
   ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='private.multi_day_legacy_payout_hold_v1()'::regprocedure)='4dd39985a1a0afca0baf122dfed216d2';
 END $$;ROLLBACK;`);
assert.equal(absent(),'t');
assert.equal(sql(`SELECT count(*) FROM public.tournament_prizes WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580';`),'0');
assert.equal(sql(`SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='private.multi_day_legacy_payout_hold_v1()'::regprocedure;`),'4dd39985a1a0afca0baf122dfed216d2');
console.log('MULTIDAY199_ATOMIC_CONFIG_CANDIDATE_RECOVERY_ALL_ROLLED_BACK_PASS');
