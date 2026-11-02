import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_CREATE1030_LOCAL,'1');
const tour='46cab483-91e7-4220-aacf-e17bdf05269c',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const tables=['tournaments','tournament_levels','tournament_entries','tournament_registrations','tournament_seats','cashier_buyin_movements','tournament_prize_payments','chip_inventory_ledger','chip_bank_ledger','dealer_attendance','dealer_assignments','tournament_hands','table_operation_receipts','tournament_state_transitions','audit_logs'];
const hash=`md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text)`;
const strip=path=>{let s=readFileSync(path,'utf8');assert.equal((s.match(/^BEGIN;$/gm)??[]).length,1);assert.equal((s.match(/^COMMIT;$/gm)??[]).length,1);return s.replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');};
const forward=strip('supabase/migrations/20270128000298_ops_create_lifecycle_compatibility_v1.sql'),rollback=strip('tests/floorProduction/create1030.lifecycle-rollback.sql');
const meta=phase=>`SELECT jsonb_build_object('phase','${phase}','body',md5(prosrc),'owner',proowner,'acl',proacl::text) FROM pg_proc WHERE oid='public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure;`;
const query=`BEGIN;SET LOCAL statement_timeout='15s';
DO $$ BEGIN
ASSERT current_database()='vinpoker_ranking860_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
END $$;
SELECT jsonb_build_object('phase','before','hash',${hash});${meta('original')}
${forward}
${meta('candidate')}
${rollback}
${meta('restored')}
ROLLBACK;
BEGIN READ ONLY;SELECT jsonb_build_object('phase','after','hash',${hash});${meta('final')}ROLLBACK;`;
const execution=spawnSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',timeout:30000,maxBuffer:4e6});assert.equal(execution.status,0,execution.stderr);const rows=execution.stdout.trim().split('\n').map(x=>JSON.parse(x));const phases=Object.fromEntries(rows.map(x=>[x.phase,x]));writeFileSync('D:/Quy trình/output/reports/create1030-rollback-rehearsal-local-20261027.json',JSON.stringify({tables,phases},null,2)+'\n');assert.equal(phases.before.hash,phases.after.hash);assert.equal(phases.original.body,'e0138e0be86fc4cfdaf325a216a415b7');assert.equal(phases.candidate.body,'3fb4d9a225b94f23c80751da468b9f5e');for(const phase of ['restored','final'])assert.deepEqual({...phases[phase],phase:'original'},phases.original);assert.equal(phases.original.owner,phases.candidate.owner);assert.equal(phases.original.acl,phases.candidate.acl);console.log('CREATE1030_FORWARD_ROLLBACK_BODY_AND_PROTECTED_FACTS_REHEARSAL_PASS');
