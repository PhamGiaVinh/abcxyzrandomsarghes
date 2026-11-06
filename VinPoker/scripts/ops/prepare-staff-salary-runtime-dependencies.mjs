import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';

// Restore reviewed current contracts inside the existing disposable fixture.
// This is not a migration, deployment tool, or permission to change production.
const output=process.argv[2];
assert.ok(output&&isAbsolute(output)&&process.argv.length===3,'absolute isolated output required');
const md5=value=>createHash('md5').update(value).digest('hex');
const read=file=>readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
const earned='20261102092616_staff_inactive_ft_earned_days_v1.sql';
const status='20261102112426_staff_checkout_before_inactive_v1.sql';
const authority='20270128000306_staff_salary_wait_authority_v1.sql';
const definitionHashes={get_staff_salary_month:'be3f33c0657d5099f0a70e6ee514db6a',chot_staff_salary_month:'b1084728a87ab5024d6447265edcec57',staff_upsert:'a1bb8108daa79b4210b7298ab986abfc',staff_check_in:'59768aef1d4aabd9b8c63d8f18c1a00d',staff_check_out:'4864a90105cecbd8eed6e51f638ede71',approve_staff_salary_month:'891b544c19ae2271627df721e46fc9e6',submit_staff_salary_month:'dc16b8254d7b6d753b5de743d2f697f9',mark_staff_salary_paid:'b268bfb8ef878a196e70d7d3419df3b6'};
const contracts=[
 ['get_staff_salary_month','uuid,integer,integer',earned,'6051708b7d4c8f8e6d80d0ed400e88ca','9f51edb60d2c6d8f6d156e24a3a26065','s'],
 ['chot_staff_salary_month','uuid,integer,integer',earned,'f459836b68d292ae0de84c5834bffba3','a873268e75e5f6d9c6d236fb633c79b9','v'],
 ['staff_upsert','uuid,text,public.staff_department,text,uuid,text,bigint,integer,numeric,bigint,bigint,text',status,'07ee93b2d09e695b8345a7decae721ff','925fb9829cec16c4af2a80899e4736b8','v'],
 ['staff_check_in','uuid',status,'9c701aa731f9d669c36ae47ad703bd43','1b310431d38efff138c5bb81e1ca8c28','v'],
 ['staff_check_out','uuid','20270128000170_staff_checkout_serialized_close_v1.sql','738330016c056e894f01d8efef49046d','7ec92258d9efcb436dd88d6cc99a4e84','v'],
 ['approve_staff_salary_month','uuid,integer,integer',authority,'cd58b90f7221de525ac3a698b7450595','1984b9bc956f20b6870b38a9ffdf9692','v'],
 ['submit_staff_salary_month','uuid,integer,integer,text',authority,'64a9d0d19e5429cb6c69a68f420f0b7a','dafb1f64b9b2f86507fbd573253315dc','v'],
 ['mark_staff_salary_paid','uuid,text,text','20270128000308_staff_pt_monthly_summary_payment_guard_v1.sql','2897040fd6640d9f05a51f36547a5cf4','8c5291962da7d32c7a7184e664dd097e','v'],
];
const pick=(file,name)=>{
 const matches=[...read(file).matchAll(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION ${name.replace('.','\\.')}\\([\\s\\S]*?AS (\\$[A-Za-z0-9_]*\\$)([\\s\\S]*?)\\1;`,'gi'))];
 assert.equal(matches.length,1,'unique source '+name);return matches[0];
};
const sql=[`BEGIN;SET LOCAL search_path=public;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres' OR current_setting('vinpoker.isolated_staff_salary_fixture',true) IS DISTINCT FROM 'cashier-current-salary-v1'
 OR NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST') THEN
 RAISE EXCEPTION 'staff_salary_requires_owned_disposable_fixture';END IF;
 IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid='public._staff_salary_authorised(uuid,uuid)'::regprocedure),chr(13),''))<>'b9149a9af0071b4537cf5f2d6b41adf3' THEN
 RAISE EXCEPTION 'staff_salary_authority_dependency_drift';END IF;
END $$;`];
const helper=pick('20270128000305_staff_salary_period_serialization_v1.sql','floor_private.staff_salary_period_lock_v1');
assert.equal(md5(helper[2]),'a6fe9f6736291117a23f16bd0edaef44','period lock source drift');
sql.push(`DO $$ DECLARE p pg_proc%ROWTYPE;BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('floor_private.staff_salary_period_lock_v1(uuid,integer,integer)');
 IF FOUND AND (md5(replace(p.prosrc,chr(13),''))<>'a6fe9f6736291117a23f16bd0edaef44' OR p.proowner<>'postgres'::regrole OR p.prosecdef OR NOT p.proisstrict) THEN RAISE EXCEPTION 'staff_salary_period_lock_collision';END IF;
END $$;`,helper[0].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'),
 'ALTER FUNCTION floor_private.staff_salary_period_lock_v1(uuid,integer,integer) OWNER TO postgres;',
 'REVOKE ALL ON FUNCTION floor_private.staff_salary_period_lock_v1(uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;');
for(const [name,args,file,baseline,current,volatility] of contracts){
 const source=pick(file,'public.'+name);assert.equal(md5(source[2]),current,'current production source drift '+name);
 const signature=`public.${name}(${args})`;
 sql.push(`DO $$ DECLARE p pg_proc%ROWTYPE;BEGIN SELECT * INTO STRICT p FROM pg_proc WHERE oid='${signature}'::regprocedure;
 IF p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR md5(replace(p.prosrc,chr(13),'')) NOT IN('${baseline}','${current}') THEN RAISE EXCEPTION 'staff_salary_captured_contract_drift: ${name}';END IF;END $$;`,
 source[0],`ALTER FUNCTION ${signature} OWNER TO postgres;`,
 `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION ${signature} TO authenticated,service_role;`,
 `DO $$ DECLARE p pg_proc%ROWTYPE;BEGIN SELECT * INTO STRICT p FROM pg_proc WHERE oid='${signature}'::regprocedure;
 IF md5(replace(p.prosrc,chr(13),''))<>'${current}' OR md5(replace(pg_get_functiondef(p.oid),chr(13),''))<>'${definitionHashes[name]}' OR p.provolatile::text<>'${volatility}' OR p.proconfig IS DISTINCT FROM ARRAY['${name==='staff_check_out'?'search_path=""':'search_path=public'}']::text[]
 OR has_function_privilege('anon',p.oid,'EXECUTE') OR NOT has_function_privilege('authenticated',p.oid,'EXECUTE') OR NOT has_function_privilege('service_role',p.oid,'EXECUTE') THEN RAISE EXCEPTION 'staff_salary_restored_contract_drift: ${name}';END IF;END $$;`);
}
sql.push(`REVOKE ALL ON FUNCTION public._staff_salary_authorised(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._staff_salary_authorised(uuid,uuid) TO service_role;
DO $$ DECLARE p pg_proc%ROWTYPE;BEGIN
 SELECT * INTO STRICT p FROM pg_proc WHERE oid='floor_private.staff_salary_period_lock_v1(uuid,integer,integer)'::regprocedure;
 IF p.provolatile<>'v' OR NOT p.proisstrict OR p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
 OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE') THEN RAISE EXCEPTION 'staff_salary_period_lock_security_drift';END IF;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid='public._staff_salary_authorised(uuid,uuid)'::regprocedure;
 IF p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'s' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[] THEN RAISE EXCEPTION 'staff_salary_authority_security_drift';END IF;
END $$;NOTIFY pgrst,'reload schema';COMMIT;`);
writeFileSync(output,sql.join('\n')+'\n');
