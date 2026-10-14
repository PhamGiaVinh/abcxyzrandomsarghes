import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
import {loadMigration as load74,postcheckSql as postcheck74} from './tracker-public-74-release-plan.mjs';

export function loadMigration(){
 const version='20270128000075',name='tracker_manual_cards_receipts_v1',filename=`${version}_${name}.sql`;
 const hash='4f52194e0c0721552519660abb844e3ccb5e6dba307f45203de08a2a6b6f9a4a';
 const sql=canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${filename}`,import.meta.url),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact75 SQL drift');
 return {version,name,filename,hash,sql};
}
function seams(){
 const i=loadMigration(),scan=scanMigrationSource(i.sql),create=i.sql.indexOf('CREATE TABLE floor_private.tracker_manual_card_receipts_v1'),post=i.sql.indexOf('DO $postcheck$');
 if(create<scan.insertAfterBegin||post<create||i.sql.split('DO $postcheck$').length!==2)throw Error('Reviewed75 SQL seam drift');
 return {i,scan,create,post};
}
function dependencySql(){
 const previous=load74(),objects=postcheck74();
 if(!objects.startsWith('BEGIN READ ONLY;')||!objects.endsWith('COMMIT;'))throw Error('Readonly74 dependency seam drift');
 return `${objects.slice('BEGIN READ ONLY;'.length,-'COMMIT;'.length)}
 DO $manual75_previous_ledger$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${previous.version}' OR name='${previous.name}')<>1
 OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${previous.version}' AND name='${previous.name}'
 AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(replace(replace(statements[1],E'\\r\\n',E'\\n'),E'\\r',E'\\n'),'UTF8'),'sha256'),'hex')='${previous.hash}')
 THEN RAISE EXCEPTION 'manual75_previous_ledger_drift'; END IF; END $manual75_previous_ledger$;`;
}
export function preflightSql(){
 const {i,scan,create}=seams();
 return `BEGIN READ ONLY; ${dependencySql()} ${i.sql.slice(scan.insertAfterBegin,create)}
 SELECT json_build_object('database',current_database(),'actor',current_user,'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${i.version}' OR name='${i.name}'))::text; COMMIT;`;
}
export function classifyPreflight(r){if(r?.database!=='postgres'||r.actor!=='postgres'||r.existing!==0)throw Error('Exact75 baseline or receipt drift');}
export function atomicSql(){
 const {i,scan}=seams(),tag='$manual75_receipt$';if(i.sql.includes(tag))throw Error('Receipt delimiter collision');
 const guard=`SET LOCAL lock_timeout='5s';SELECT pg_advisory_xact_lock(280000,3747);
 ${dependencySql()}
 DO $manual75_ledger_guard$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${i.version}' OR name='${i.name}') THEN RAISE EXCEPTION 'manual75_ledger_drift'; END IF; END $manual75_ledger_guard$;`;
 const receipt=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${i.version}','${i.name}',ARRAY[${tag}${i.sql}${tag}]::text[]);`;
 return i.sql.slice(0,scan.insertAfterBegin)+'\n'+guard+'\n'+i.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)+'\n'+receipt+'\n'+i.sql.slice(scan.insertBeforeCommit);
}
export function postcheckSql(){const {i,scan,post}=seams();return `BEGIN READ ONLY; ${dependencySql()} ${i.sql.slice(post,scan.insertBeforeCommit)} COMMIT;`;}
export function executePackage(transport,report=()=>{}){
 classifyPreflight(transport.json(preflightSql()));const i=loadMigration();
 try{transport.execute(atomicSql());}catch{
  let observed='unavailable';try{const r=transport.json(receiptSql(i));observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{/* Unknown outcome stays unknown. */}
  report(`STOP75 receipt=${observed}; no retry or downstream apply`);throw Error('Exact75 apply outcome requires review');
 }
 const r=transport.json(receiptSql(i));if(r.count!==1||r.exact!==true)throw Error('Exact75 receipt postcheck failed');
 transport.execute(postcheckSql());report(`COMMITTED_EXACT ${i.version} ${i.hash}`);report('MANUAL75_OBJECT_POSTCHECK_PASS');
}
