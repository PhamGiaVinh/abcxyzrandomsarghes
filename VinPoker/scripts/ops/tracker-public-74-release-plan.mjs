import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';

export function loadMigration(){
 const version='20270128000074',name='tracker_public_hand_visibility_v1',filename=`${version}_${name}.sql`;
 const hash='1b26b18d91807e2aa937c114810ee4e074f66e4c3af30d4ca50c51b433078163';
 const sql=canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${filename}`,import.meta.url),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact74 SQL drift');
 return {version,name,filename,hash,sql};
}
function seams(){
 const i=loadMigration(),scan=scanMigrationSource(i.sql),create=i.sql.indexOf('CREATE FUNCTION floor_private.tracker_hand_read_scope74'),post=i.sql.indexOf('DO $postcheck$');
 if(create<scan.insertAfterBegin||post<create||i.sql.split('DO $postcheck$').length!==2)throw Error('Reviewed74 SQL seam drift');
 return {i,scan,create,post};
}
export function preflightSql(){
 const {i,scan,create}=seams();
 return `BEGIN READ ONLY; ${i.sql.slice(scan.insertAfterBegin,create)}
 SELECT json_build_object('database',current_database(),'actor',current_user,'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${i.version}' OR name='${i.name}'))::text; COMMIT;`;
}
export function classifyPreflight(r){if(r?.database!=='postgres'||r.actor!=='postgres'||r.existing!==0)throw Error('Exact74 baseline or receipt drift');}
export function atomicSql(){
 const {i,scan}=seams(),tag='$visibility74_receipt$';if(i.sql.includes(tag))throw Error('Receipt delimiter collision');
 const guard=`SET LOCAL lock_timeout='5s';SELECT pg_advisory_xact_lock(280000,3747);
 DO $visibility74_ledger_guard$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${i.version}' OR name='${i.name}') THEN RAISE EXCEPTION 'visibility74_ledger_drift'; END IF; END $visibility74_ledger_guard$;`;
 const receipt=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${i.version}','${i.name}',ARRAY[${tag}${i.sql}${tag}]::text[]);`;
 return i.sql.slice(0,scan.insertAfterBegin)+'\n'+guard+'\n'+i.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)+'\n'+receipt+'\n'+i.sql.slice(scan.insertBeforeCommit);
}
export function postcheckSql(){
 const {i,scan,post}=seams();
 return `BEGIN READ ONLY; SELECT set_config('visibility74.original_policies','c3d426ea96e050476850e3bcc19afafc',true); ${i.sql.slice(post,scan.insertBeforeCommit)} COMMIT;`;
}
export function executePackage(transport,report=()=>{}){
 classifyPreflight(transport.json(preflightSql()));const i=loadMigration();
 try{transport.execute(atomicSql());}catch{
  let observed='unavailable';try{const r=transport.json(receiptSql(i));observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{/* unknown */}
  report(`STOP74 receipt=${observed}; no retry or downstream apply`);throw Error('Exact74 apply outcome requires review');
 }
 const r=transport.json(receiptSql(i));if(r.count!==1||r.exact!==true)throw Error('Exact74 receipt postcheck failed');
 transport.execute(postcheckSql());report(`COMMITTED_EXACT ${i.version} ${i.hash}`);report('VISIBILITY74_OBJECT_POSTCHECK_PASS');
}
