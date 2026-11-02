import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_CREATE1029_LOCAL,'1');
const tour='46cab483-91e7-4220-aacf-e17bdf05269c',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const tables=['tournaments','tournament_levels','tournament_entries','tournament_registrations','tournament_seats','cashier_buyin_movements','tournament_prize_payments','chip_inventory_ledger','chip_bank_ledger','dealer_attendance','dealer_assignments','tournament_hands','table_operation_receipts','tournament_state_transitions','audit_logs'];
const hash=`md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text)`;
const query=String.raw`BEGIN;SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='10s';
DO $$ BEGIN
ASSERT current_database()='vinpoker_ranking860_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
ASSERT NOT EXISTS(SELECT FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
END $$;
SELECT jsonb_build_object('phase','before','hash',${hash});
SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
SELECT public.ops_create_tournament('${club}','Create1029 compatibility TEST','2030-01-02T13:00:00Z',100000,20000,20,6,'nlh') AS legacy \gset
SELECT public.create_tournament_with_levels_v1('${club}','{"name":"Create1029 compatibility TEST","start_time":"2030-01-02T13:00:00Z","buy_in":100000,"rake_amount":0,"service_fee_amount":0,"starting_stack":20000,"game_type":"nlh","minutes_per_level":20,"late_reg_close_level":6}'::jsonb,'[]'::jsonb,gen_random_uuid(),'${actor}') AS canonical \gset
SELECT jsonb_build_object('phase','outcomes','legacy',:'legacy'::jsonb,'canonical',:'canonical'::jsonb);
SELECT jsonb_build_object('phase','rows','legacy',(SELECT to_jsonb(t)-'id'-'created_at'-'updated_at' FROM public.tournaments t WHERE id=(:'legacy'::jsonb->>'tournament_id')::uuid),'canonical',(SELECT to_jsonb(t)-'id'-'created_at'-'updated_at' FROM public.tournaments t WHERE id=(:'canonical'::jsonb->>'tournament_id')::uuid));
ROLLBACK;
BEGIN READ ONLY;SELECT jsonb_build_object('phase','after','hash',${hash});ROLLBACK;
`;
const output=execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',timeout:30000,maxBuffer:4e6}).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
const phases=Object.fromEntries(output.map(x=>[x.phase,x]));assert.equal(phases.before.hash,phases.after.hash);assert.equal(phases.outcomes.legacy.ok,true);assert.equal(phases.outcomes.canonical.ok,true);const a=phases.rows.legacy,b=phases.rows.canonical;const differences=Object.keys(a).filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k])).map(field=>({field,legacy:a[field],canonical:b[field]}));const result={kind:'NATIVE_CREATE_CONTRACT_PARITY_AUDIT_NOT_UI_OR_ACCEPTANCE',tables,unchanged:true,...phases,differences};writeFileSync('D:/Quy trình/output/reports/create1029-native-contract-parity-local-20261027.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({unchanged:true,differences}));
