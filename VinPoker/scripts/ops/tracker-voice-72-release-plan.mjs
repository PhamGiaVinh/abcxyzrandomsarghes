import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
import {loadPackage as load71,postcheckSql as postcheck71} from './tracker-voice-70-71-release-plan.mjs';
export function loadMigration(){
  const version='20270128000072',name='tracker_voice_assignment_lifecycle_v1',filename=`${version}_${name}.sql`;
  const hash='6a0b7cb216c6eec027e4ff0b4eb7e5a7a4478ba0bf879b14a65906ce8c4edb09';
  const sql=canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${filename}`,import.meta.url),'utf8'));
  if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact72 SQL drift');
  return {version,name,filename,hash,sql};
}
function ordered71Check(final=false){
 const sql=postcheck71(2),pin='96ba904dfcdfaa23dba36b6862aba168';
 if(sql.split(pin).length!==2||!sql.startsWith('BEGIN READ ONLY; ')||!sql.endsWith(' COMMIT;'))throw Error('Reviewed71 postcheck seam drift');
 return sql.slice('BEGIN READ ONLY; '.length,-' COMMIT;'.length).replace(pin,final?'0a9e1f4e0972015b1554d6cd10f5ee2a':pin);
}
export function baselinePredicate(){return load71().map(i=>`EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${i.version}' AND name='${i.name}' AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(replace(replace(statements[1],chr(13)||chr(10),chr(10)),chr(13),chr(10)),'UTF8'),'sha256'),'hex')='${i.hash}')`).join(' AND ')+`
 AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public._tracker_voice_assignment_context(uuid,uuid,uuid)')
 AND md5(replace(pg_get_functiondef(oid),chr(13),''))='96ba904dfcdfaa23dba36b6862aba168'
 AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[] AND proacl::text='{postgres=X/postgres}')`;}
export function preflightSql(){const i=loadMigration();return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';
  ${ordered71Check()}
  SELECT json_build_object('database',current_database(),'actor',current_user,
    'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${i.version}' OR name='${i.name}'),
    'baseline',(${baselinePredicate()}))::text;COMMIT;`;}
export function classifyPreflight(r){if(r?.database!=='postgres'||r.actor!=='postgres'||r.existing!==0||r.baseline!==true)throw Error('Exact72 precondition drift');}
export function postcheckSql(){return 'BEGIN READ ONLY; '+ordered71Check(true)+`
 DO $voice72_metadata$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public._tracker_voice_assignment_context(uuid,uuid,uuid)'::regprocedure
 AND proowner='postgres'::regrole AND prosecdef AND proacl::text='{postgres=X/postgres}' AND proconfig=ARRAY['search_path=""']::text[]) THEN RAISE EXCEPTION 'voice72_metadata_postcheck_failed'; END IF;
 END $voice72_metadata$; COMMIT;`;}
export function atomicSql(item=loadMigration()){
  const pin=loadMigration();if(['version','name','filename','hash','sql'].some(k=>item[k]!==pin[k]))throw Error('Exact72 allowlist mismatch');
  const scan=scanMigrationSource(item.sql),tag='$voice72_receipt$';if(item.sql.includes(tag))throw Error('Delimiter collision');
  const guard=`SET LOCAL lock_timeout='5s';SELECT pg_advisory_xact_lock(280000,3747);\n${ordered71Check()}
    DO $voice72_guard$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')
      OR NOT COALESCE((${baselinePredicate()}),false) THEN RAISE EXCEPTION 'voice72_precondition_drift';END IF;END $voice72_guard$;`;
  const receipt=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
    VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);`;
  return item.sql.slice(0,scan.insertAfterBegin)+'\n'+guard+'\n'+item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)
    +'\n'+receipt+'\n'+item.sql.slice(scan.insertBeforeCommit);
}
export function executePackage(transport,report=()=>{}){
  classifyPreflight(transport.json(preflightSql()));const i=loadMigration();
  try{transport.execute(atomicSql(i));}catch{
    let observed='unavailable';try{const r=transport.json(receiptSql(i));observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{/* unknown */}
    report(`VOICE72 receipt=${observed}; no retry`);throw Error('Exact72 apply outcome requires review');
  }
  const r=transport.json(receiptSql(i));if(r.count!==1||r.exact!==true)throw Error('Exact72 receipt postcheck failed');
  transport.execute(postcheckSql());report(`COMMITTED_EXACT ${i.version} ${i.hash}`);report('VOICE72_OBJECT_POSTCHECK_PASS');
}
