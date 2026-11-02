import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_CREATE1030_LOCAL,'1');
const tour='46cab483-91e7-4220-aacf-e17bdf05269c',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const tables=['tournaments','tournament_levels','tournament_entries','tournament_registrations','tournament_seats','cashier_buyin_movements','tournament_prize_payments','chip_inventory_ledger','chip_bank_ledger','dealer_attendance','dealer_assignments','tournament_hands','table_operation_receipts','tournament_state_transitions','audit_logs'];
const hash=`md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text)`;
const candidate=process.argv.includes('--candidate');
let patch=candidate?readFileSync('supabase/migrations/20270128000298_ops_create_lifecycle_compatibility_v1.sql','utf8'):'';
if(candidate){assert.equal((patch.match(/^BEGIN;$/gm)??[]).length,1);assert.equal((patch.match(/^COMMIT;$/gm)??[]).length,1);patch=patch.replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');assert.ok(!/^COMMIT;/m.test(patch));}
const base={name:'Create1030 compatibility TEST',start_time:'2030-01-02T13:00:00Z',buy_in:100000,rake_amount:0,service_fee_amount:0,starting_stack:20000,game_type:'nlh',minutes_per_level:20,late_reg_close_level:6};
const config={...base,status:'upcoming',current_level:1};
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
const json=v=>literal(JSON.stringify(v))+'::jsonb';
const argumentsFor=(cfg,req)=>`'${club}',${json(cfg)},'[]'::jsonb,${req},'${actor}'`;
const claims=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
const bad=[{current_level:1},{status:'upcoming'},{status:'completed',current_level:1},{status:'active',current_level:1},{status:'upcoming',current_level:0},{status:'upcoming',current_level:2},{status:'upcoming',current_level:1.5},{status:'upcoming',current_level:'1'},{status:'upcoming',current_level:null}];
const invalidSql=bad.map((fields,index)=>`SELECT jsonb_build_object('phase','invalid${index}','result',public.create_tournament_with_levels_v1(${argumentsFor({...base,...fields},'gen_random_uuid()')}));`).join('\n');
const moneySql=[-1,'100000'].map((buy_in,index)=>`SELECT jsonb_build_object('phase','money${index}','result',public.create_tournament_with_levels_v1(${argumentsFor({...config,buy_in},'gen_random_uuid()')}));`).join('\n');
const metadata="jsonb_build_object('body',md5(prosrc),'owner',proowner,'acl',proacl::text)";
const query=String.raw`BEGIN;SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='10s';
DO $$ BEGIN
ASSERT current_database()='vinpoker_ranking860_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
ASSERT NOT EXISTS(SELECT FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
END $$;
SELECT jsonb_build_object('phase','before','hash',${hash});
SELECT jsonb_build_object('phase','functionBefore','metadata',${metadata}) FROM pg_proc WHERE oid='public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure;
SELECT gen_random_uuid() old_request,gen_random_uuid() new_request \gset
${claims}
SELECT public.create_tournament_with_levels_v1(${argumentsFor(base,":'old_request'::uuid")}) AS old_result \gset
SELECT public.ops_create_tournament('${club}','Create1030 compatibility TEST','2030-01-02T13:00:00Z',100000,20000,20,6,'nlh') AS legacy_result \gset
RESET ROLE;
${patch}
${claims}
SELECT public.create_tournament_with_levels_v1(${argumentsFor(config,":'new_request'::uuid")}) AS new_result \gset
SELECT jsonb_build_object('phase','new','result',:'new_result'::jsonb);
SELECT jsonb_build_object('phase','oldReplay','original',:'old_result'::jsonb,'result',public.create_tournament_with_levels_v1(${argumentsFor(base,":'old_request'::uuid")}));
SELECT jsonb_build_object('phase','newReplay','result',public.create_tournament_with_levels_v1(${argumentsFor(config,":'new_request'::uuid")}));
SELECT jsonb_build_object('phase','newReceipt','result',public.get_tournament_create_receipt_v1(${argumentsFor(config,":'new_request'::uuid")}));
SELECT jsonb_build_object('phase','conflict','result',public.create_tournament_with_levels_v1(${argumentsFor({...config,name:'Conflicting1030 TEST'},":'new_request'::uuid")}));
SELECT jsonb_build_object('phase','rows','legacy',(SELECT to_jsonb(t)-'id'-'created_at'-'updated_at' FROM public.tournaments t WHERE id=(:'legacy_result'::jsonb->>'tournament_id')::uuid),'new',(SELECT to_jsonb(t)-'id'-'created_at'-'updated_at' FROM public.tournaments t WHERE id=(:'new_result'::jsonb->>'tournament_id')::uuid),'old',(SELECT jsonb_build_object('status',status,'current_level',current_level) FROM public.tournaments WHERE id=(:'old_result'::jsonb->>'tournament_id')::uuid));
${invalidSql}
${moneySql}
SAVEPOINT fractional_money;
\set VERBOSITY verbose
\set ON_ERROR_STOP off
SELECT jsonb_build_object('phase','fractionalMoney','result',public.create_tournament_with_levels_v1(${argumentsFor({...config,buy_in:0.5},'gen_random_uuid()')}));
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT fractional_money;
RELEASE SAVEPOINT fractional_money;
RESET ROLE;
SELECT jsonb_build_object('phase','functionInside','metadata',${metadata}) FROM pg_proc WHERE oid='public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure;
ROLLBACK;
BEGIN READ ONLY;
SELECT jsonb_build_object('phase','after','hash',${hash});
SELECT jsonb_build_object('phase','functionAfter','metadata',${metadata}) FROM pg_proc WHERE oid='public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure;
ROLLBACK;`;
const execution=spawnSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',timeout:30000,maxBuffer:4e6});assert.equal(execution.status,0,execution.stderr);const rows=execution.stdout.trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
const phases=Object.fromEntries(rows.map(x=>[x.phase,x]));writeFileSync('D:/Quy trình/output/reports/create1030-'+(candidate?'candidate':'red')+'-native-local-20261027.json',JSON.stringify({candidate,tables,phases,stderr:execution.stderr},null,2)+'\n');
assert.equal(phases.before.hash,phases.after.hash);assert.deepEqual(phases.functionBefore, {...phases.functionAfter,phase:'functionBefore'});assert.equal(phases.new.result.ok,true);assert.deepEqual(phases.rows.new,phases.rows.legacy);assert.deepEqual(phases.rows.old,{status:'active',current_level:null});assert.deepEqual(phases.oldReplay.result,phases.oldReplay.original);assert.deepEqual(phases.newReplay.result,phases.new.result);assert.deepEqual(phases.newReceipt.result,phases.new.result);assert.equal(phases.conflict.result.error,'IDEMPOTENCY_CONFLICT');for(let i=0;i<bad.length;i++)assert.equal(phases['invalid'+i].result.error,'invalid_initial_lifecycle');for(let i=0;i<2;i++)assert.equal(phases['money'+i].result.error,'invalid_create_money');if(phases.fractionalMoney){assert.equal(phases.fractionalMoney.result.error,'invalid_create_money');assert.equal(execution.stderr,'');}else{assert.match(execution.stderr,/22P02:.*invalid input syntax for type bigint: \"0\.5\"/);assert.equal((execution.stderr.match(/ERROR:/g)??[]).length,1);}assert.equal(phases.functionBefore.metadata.owner,phases.functionInside.metadata.owner);assert.equal(phases.functionBefore.metadata.acl,phases.functionInside.metadata.acl);console.log('CREATE1030_NATIVE_COMPATIBILITY_OLD_DEFAULT_REPLAY_INVALID_PAIR_MONEY_ROLLBACK_PASS');
