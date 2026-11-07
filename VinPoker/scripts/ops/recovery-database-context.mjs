// Database-level owner/effective ACL receipt. Plaintext stays inside encrypted recovery workdir.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const contextQuery=`SELECT jsonb_build_object('version',1,'database',d.datname,'owner',pg_get_userbyid(d.datdba),
 'acl',coalesce((SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN NULL ELSE pg_get_userbyid(a.grantee) END,
 'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable)
 ORDER BY CASE WHEN a.grantee=0 THEN '' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
 FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a),'[]'::jsonb))
 FROM pg_database d WHERE d.datname=current_database();`;
const ident=v=>'"'+v.replaceAll('"','""')+'"';
const literal=v=>"'"+v.replaceAll("'","''")+"'";
export function validateContext(value,database='postgres'){
 assert.ok(database==='postgres'||/^vinpoker_hud_test_recovery_context_[a-z0-9_]+$/.test(database));
 assert.deepEqual(Object.keys(value).sort(),['acl','database','owner','version']);
 assert.equal(value.version,1);assert.equal(value.database,database);assert.equal(value.owner,'postgres');
 assert.ok(Array.isArray(value.acl)&&value.acl.length>0&&value.acl.length<=300);
 const seen=new Set();
 for(const row of value.acl){
  assert.deepEqual(Object.keys(row).sort(),['grantable','grantee','grantor','privilege']);
  assert.equal(row.grantor,value.owner,'Non-owner grant chains require separate recovery review');
  assert.ok(row.grantee===null||(typeof row.grantee==='string'&&row.grantee.length>0&&Buffer.byteLength(row.grantee)<=63&&!row.grantee.includes('\0')));
  assert.ok(['CREATE','CONNECT','TEMPORARY'].includes(row.privilege));assert.equal(typeof row.grantable,'boolean');
  assert.ok(row.grantee!==null||!row.grantable,'PUBLIC cannot receive grant option');
  const key=JSON.stringify([row.grantee,row.privilege]);assert.ok(!seen.has(key),'Duplicate ACL entry');seen.add(key);
 }
 return value;
}
export function restoreContextSql(value,database='postgres'){
 validateContext(value,database);const db=ident(database);
 const roles=[...new Set(value.acl.map(r=>r.grantee).filter(r=>r!==null))];
 return `BEGIN;
DO $context_guard$ BEGIN
 IF current_database()<>${literal(database)} OR current_user NOT IN('postgres','supabase_admin')
 THEN RAISE EXCEPTION 'recovery_database_context_target_differs';END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY[${roles.map(literal).join(',')}]::text[]) expected(name)
 WHERE NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=expected.name))
 THEN RAISE EXCEPTION 'recovery_database_context_role_missing';END IF;
END $context_guard$;
ALTER DATABASE ${db} OWNER TO postgres;
SET LOCAL ROLE postgres;
DO $clear_acl$ DECLARE row record;BEGIN
 FOR row IN SELECT DISTINCT a.grantee FROM pg_database d,
 LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database()
 LOOP
  IF row.grantee=0 THEN EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC',current_database());
  ELSE EXECUTE format('REVOKE ALL ON DATABASE %I FROM %I',current_database(),pg_get_userbyid(row.grantee));END IF;
 END LOOP;
END $clear_acl$;
${value.acl.map(r=>`GRANT ${r.privilege} ON DATABASE ${db} TO ${r.grantee===null?'PUBLIC':ident(r.grantee)}${r.grantable?' WITH GRANT OPTION':''};`).join('\n')}
DO $verify_context$ DECLARE actual jsonb;BEGIN
 SELECT (${contextQuery.replace(/;\s*$/,'')}) INTO actual;
 IF actual<>${literal(JSON.stringify(value))}::jsonb THEN RAISE EXCEPTION 'recovery_database_context_postcheck_differs';END IF;
END $verify_context$;
COMMIT;
`;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,input,output]=process.argv.slice(2);
 if(mode==='capture-sql')process.stdout.write("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET TRANSACTION SNAPSHOT :'snapshot';\n"+contextQuery+'\nCOMMIT;\n');
 else{
  assert.equal(mode,'restore-sql');assert.ok(input&&output);
  const value=validateContext(JSON.parse(readFileSync(input,'utf8')));
  writeFileSync(output,restoreContextSql(value),{flag:'wx',mode:0o600});
 }
}
