import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.VINPOKER_ONLINE769_NATIVE,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
const proof=()=>sql(`BEGIN READ ONLY;SELECT md5(jsonb_build_array(${['online_poker_tables','online_poker_seats','online_poker_config','cashier_buyin_movements','tournament_prize_payments'].map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text);ROLLBACK;`);
const before=proof();
const migration=readFileSync(new URL('../../supabase/migrations/20270128000287_online_create_receipt_v1.sql',import.meta.url),'utf8');
assert.ok(migration.trimEnd().endsWith('COMMIT;'));
const prefix=migration.slice(0,migration.lastIndexOf('COMMIT;'));
const basic=readFileSync(new URL('./create768.receipt.rollback.sql',import.meta.url),'utf8');
const fault=`
CREATE FUNCTION pg_temp.online769_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.payload->>'name'='LOCAL769-FAULT' THEN
  ASSERT EXISTS(SELECT 1 FROM public.online_poker_tables t JOIN public.online_poker_seats s ON s.table_id=t.id
   WHERE t.name='LOCAL769-FAULT' AND t.created_by=NEW.actor_id AND s.user_id=NEW.actor_id AND s.stack=5000),'fault was not after canonical create';
  RAISE EXCEPTION 'LOCAL769_AFTER_TABLE_BEFORE_RECEIPT' USING ERRCODE='22000';
 END IF;RETURN NEW;END $$;
CREATE TRIGGER online769_fail_receipt BEFORE INSERT ON private.online_create_requests_v1 FOR EACH ROW EXECUTE FUNCTION pg_temp.online769_fail_receipt();
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.op_create_open_table_v2('LOCAL769-FAULT',25,50,5000,9,'3bec72d2-0dc2-4504-8b59-d230531079f1');
  RAISE EXCEPTION 'receipt fault not injected';
 EXCEPTION WHEN data_exception THEN ASSERT SQLERRM='LOCAL769_AFTER_TABLE_BEFORE_RECEIPT';END;
 ASSERT NOT EXISTS(SELECT 1 FROM public.online_poker_tables WHERE name='LOCAL769-FAULT');
 ASSERT public.op_get_create_receipt_v1('3bec72d2-0dc2-4504-8b59-d230531079f1')->>'outcome'='not_found';
END $$;
RESET ROLE;DO $$ BEGIN ASSERT (SELECT count(*)=2 FROM private.online_create_requests_v1);END $$;
DROP TRIGGER online769_fail_receipt ON private.online_create_requests_v1;
SET LOCAL ROLE authenticated;
DO $$ DECLARE a jsonb;b jsonb;BEGIN
 a:=public.op_create_open_table_v2('LOCAL769-FAULT',25,50,5000,9,'3bec72d2-0dc2-4504-8b59-d230531079f1');
 b:=public.op_create_open_table_v2('LOCAL769-FAULT',25,50,5000,9,'3bec72d2-0dc2-4504-8b59-d230531079f1');
 ASSERT a->>'outcome'='ok' AND b->>'replayed'='true' AND a->>'table_id'=b->>'table_id';
 ASSERT (SELECT count(*)=1 FROM public.online_poker_tables WHERE name='LOCAL769-FAULT');
 RAISE NOTICE 'ONLINE769_AFTER_CANONICAL_CREATE_RECEIPT_FAULT_ATOMIC_ROLLBACK_SAME_KEY_RETRY_ONE_TABLE_PASS';
END $$;RESET ROLE;
`;
assert.equal(basic.split('\nROLLBACK;\nSELECT').length,2,'test rollback seam drift');
console.log(sql(prefix+basic.replace('\nROLLBACK;\nSELECT',()=>fault+'\nROLLBACK;\nSELECT')));
assert.equal(proof(),before);
for(const isolation of ['REPEATABLE READ','SERIALIZABLE']){
 const body=prefix.replace('BEGIN;','BEGIN ISOLATION LEVEL '+isolation+';')+`
 SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
 SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';SET LOCAL ROLE authenticated;
 DO $$ BEGIN
 BEGIN PERFORM public.op_create_open_table_v2('LOCAL769-ISOLATION',25,50,5000,9,'68e9499b-87c9-488e-b2c3-59c4a5cfc42d');RAISE EXCEPTION 'non-RC accepted';
 EXCEPTION WHEN serialization_failure THEN ASSERT SQLERRM='online_create_requires_read_committed';END;END $$;ROLLBACK;`;
 sql(body);assert.equal(proof(),before);console.log('ONLINE769_NON_RC_DENIED',isolation);
}
assert.equal(sql("SELECT to_regclass('private.online_create_requests_v1') IS NULL AND to_regprocedure('public.op_create_open_table_v2(text,bigint,bigint,bigint,integer,uuid)') IS NULL;"),'t');
console.log('ONLINE769_ALL_CANDIDATE_OBJECTS_ROLLED_BACK_FULL_PROTECTED_PROOF_UNCHANGED');
