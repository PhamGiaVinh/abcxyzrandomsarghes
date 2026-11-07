import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
const output=process.argv[2];assert.ok(output&&isAbsolute(output)&&process.argv.length===3,'absolute isolated output required');
const read=name=>readFileSync(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
const source22=read('20270128000022_dealer_assignment_off_commit_fence_v1.sql');
const source17=read('20270128000017_dealer_operational_inventory_exact_session_v1.sql');
const md5=value=>createHash('md5').update(value).digest('hex');
const statements=["BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';",
 "DO $$ BEGIN IF to_regclass('floor_private.dealer_initial_assign_receipts') IS NOT NULL THEN RAISE EXCEPTION 'isolated_replacement_receipt_collision';END IF;END $$;",
 "CREATE TABLE floor_private.dealer_initial_assign_receipts(request_key text PRIMARY KEY,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());",
 'ALTER TABLE floor_private.dealer_initial_assign_receipts ENABLE ROW LEVEL SECURITY;',
 'REVOKE ALL ON floor_private.dealer_initial_assign_receipts FROM PUBLIC,anon,authenticated,service_role;'];
const contracts=[
 [source22,'floor_private.assert_dealer_acquisition_intent','uuid','27d662fad4c9fde08bb1fde8c3ed95a8',false],
 [source17,'floor_private.club_operational_inventory','uuid','310a2f467439dbfbd92e1601fed2159a',false],
 [read('20270128000222_dealer_pool_club_operating_day_v1.sql'),'floor_private.dealer_pool_attendance_matches_v1','uuid,uuid,timestamptz','5dc78941356397570def9df8a9b7ed3e',false],
 [source22,'floor_private.guard_dealer_assignment_acquisition','','774abae97f894787b0abb2972d374630',false],
 [source22,'floor_private.guard_dealer_attendance_acquisition','','c78898a57e861adacfb7dab954681ef8',false],
 [source22,'public.worker_assign_dealer_to_session_v1','uuid,uuid,uuid,uuid,timestamptz,text','6773928dd0f7d93d9728db87721e5268',true],
 [read('20270128000273_dealer_pool_operating_day_read_v1.sql'),'public.get_dealer_pool_eligible_attendance_v1','uuid,uuid[]','1fc13b5c0ad03845a8ed7dc918800863',true],
];
for(const [source,name,args,hash,service] of contracts){
 const matches=[...source.matchAll(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION ${name.replace('.','\\.')}\\([\\s\\S]*?AS (\\$[A-Za-z0-9_]*\\$)([\\s\\S]*?)\\1;`,'g'))];
 assert.equal(matches.length,1,'unique replacement dependency '+name);assert.equal(md5(matches[0][2]),hash,'replacement source body drift '+name);
 statements.push(`DO $$ BEGIN IF to_regprocedure('${name}(${args})') IS NOT NULL THEN RAISE EXCEPTION 'isolated_replacement_function_collision: ${name}';END IF;END $$;`,
 matches[0][0],`ALTER FUNCTION ${name}(${args}) OWNER TO postgres;`,`REVOKE ALL ON FUNCTION ${name}(${args}) FROM PUBLIC,anon,authenticated,service_role;`);
 if(service)statements.push(`GRANT EXECUTE ON FUNCTION ${name}(${args}) TO service_role;`);
}
statements.push('COMMIT;',read('20270128000046_dealer_inventory_canonical_table_link_v1.sql'),read('20270128000272_dealer_acquisition_operating_day_v1.sql'),read('20270128000025_dealer_automatic_rest_history_fence_v1.sql'),read('20270128000021_dealer_ready_private_trigger_v1.sql'));
for(const [table,trigger,fn] of [
 ['dealer_assignments','guard_dealer_assignment_off_commit_v1','guard_dealer_assignment_acquisition'],
 ['dealer_attendance','guard_dealer_attendance_off_commit_v1','guard_dealer_attendance_acquisition'],
])statements.push(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.${table}'::regclass AND tgname='${trigger}') THEN RAISE EXCEPTION 'isolated_replacement_trigger_collision';END IF;END $$;`,
 `CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE ON public.${table} FOR EACH ROW EXECUTE FUNCTION floor_private.${fn}();`);
statements.push(`DO $$ DECLARE e record;p pg_proc%ROWTYPE;BEGIN
 FOR e IN SELECT * FROM (VALUES
 ('floor_private.assert_dealer_acquisition_intent(uuid)','27d662fad4c9fde08bb1fde8c3ed95a8',true,'v',false),
 ('floor_private.club_operational_inventory(uuid)','5661b1a9deeae1cbfd2c3d8b1d1621eb',false,'s',false),
 ('floor_private.dealer_pool_attendance_matches_v1(uuid,uuid,timestamptz)','5dc78941356397570def9df8a9b7ed3e',false,'s',false),
 ('floor_private.guard_dealer_assignment_acquisition()','ceb1f949a8e97bb1612ce8128a786643',true,'v',false),
 ('floor_private.guard_dealer_attendance_acquisition()','c78898a57e861adacfb7dab954681ef8',true,'v',false),
 ('floor_private.guard_dealer_automatic_rest_history()','d987493295636f7890e743acb37f5203',true,'v',false),
 ('public.worker_assign_dealer_to_session_v1(uuid,uuid,uuid,uuid,timestamptz,text)','6773928dd0f7d93d9728db87721e5268',true,'v',true),
 ('public.get_dealer_pool_eligible_attendance_v1(uuid,uuid[])','1fc13b5c0ad03845a8ed7dc918800863',true,'s',true)
 ) v(signature,digest,definer,volatility,service_allowed) LOOP
 SELECT * INTO STRICT p FROM pg_proc WHERE oid=e.signature::regprocedure;
 IF md5(replace(p.prosrc,chr(13),''))<>e.digest OR p.proowner<>'postgres'::regrole
 OR p.prosecdef<>e.definer OR p.provolatile::text<>e.volatility OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
 OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
 OR has_function_privilege('service_role',p.oid,'EXECUTE')<>e.service_allowed THEN
 RAISE EXCEPTION 'isolated_replacement_production_contract_drift: %',e.signature;END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM vault.secrets WHERE name='PROCESS_SWING_INTERNAL_SECRET') THEN
 RAISE EXCEPTION 'isolated_replacement_must_not_provision_production_notification_secret';END IF;
END $$;`);
writeFileSync(output,statements.join('\n')+'\n');
