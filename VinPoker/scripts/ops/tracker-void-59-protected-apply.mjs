import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {validateContext,psqlEnvironment,receiptSql} from './floor-37-47-protected-apply.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export function loadMigration(){
 const version='20270128000059',name='tracker_completed_void_integrity_v1';
 const filename=`${version}_${name}.sql`,hash='83c3ac2381b184627c20439276a62afe1401cb980387ff1dc2b7be7ea711794d';
 const sql=canonicalSqlText(readFileSync(resolve(root,'supabase/migrations',filename),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact59 SQL drift');
 return {version,name,filename,hash,sql};
}
export function dependencyPredicate(){return `(SELECT count(*)=1 AND bool_and(COALESCE(
 md5(replace(p.prosrc,chr(13),''))='c9e37982f4aa9b66905d31645756f28b'
 AND p.prosecdef AND p.proowner='postgres'::regrole AND p.proconfig=ARRAY['search_path=public']::text[]
 AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}',false))
 FROM pg_proc p WHERE p.oid=to_regprocedure('public.void_last_hand(uuid)'))`;}
export function preflightSql(){const i=loadMigration();return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object('database',current_database(),'actor',current_user,
 'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${i.version}' OR name='${i.name}'),'baseline',(${dependencyPredicate()}))::text;COMMIT;`;}
export function classifyPreflight(r){if(r?.database!=='postgres'||r.actor!=='postgres'||r.existing!==0||r.baseline!==true)throw Error('Exact59 precondition drift');}
export function atomicSql(item=loadMigration()){
 const pinned=loadMigration();if(['version','name','filename','hash','sql'].some(k=>item[k]!==pinned[k]))throw Error('Exact59 allowlist mismatch');
 const scan=scanMigrationSource(item.sql),tag='$void59_receipt$';if(item.sql.includes(tag))throw Error('Delimiter collision');
 const guard=`SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';SELECT pg_advisory_xact_lock(280000,3747);
 DO $void59_guard$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')
 OR NOT COALESCE((${dependencyPredicate()}),false) THEN RAISE EXCEPTION 'void59_precondition_drift';END IF;END $void59_guard$;`;
 const receipt=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);`;
 return item.sql.slice(0,scan.insertAfterBegin)+'\n'+guard+'\n'+item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)+receipt+'\n'+item.sql.slice(scan.insertBeforeCommit);
}
export function executePackage(transport,report=()=>{}){
 classifyPreflight(transport.json(preflightSql()));const item=loadMigration();
 try{transport.execute(atomicSql(item));}catch{
  let observed='unavailable';try{const r=transport.json(receiptSql(item));observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{}
  report(`STOP59 receipt=${observed}; no retry`);throw Error('Exact59 apply outcome requires review');
 }
 const r=transport.json(receiptSql(item));if(r.count!==1||r.exact!==true)throw Error('Exact59 receipt postcheck failed; stop');
 transport.execute(readFileSync(resolve(root,'tests/trackerSettlement/completedVoidProjection.readonly-postcheck.sql'),'utf8'));
 report(`COMMITTED_EXACT ${item.version} ${item.hash}`);report('VOID59_OBJECT_POSTCHECK_PASS');
}
function main(){
 const mode=process.argv[2];if(!['plan','apply'].includes(mode))throw Error('Protected plan|apply only');
 validateContext(process.env,JSON.parse(readFileSync(process.env.RECOVERY_RECEIPT_PATH,'utf8')));
 const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});if(head.status!==0||head.stdout.trim()!==process.env.RELEASE_SHA)throw Error('Checkout SHA differs');
 const query=sql=>{const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',env:psqlEnvironment(process.env),maxBuffer:2*1024*1024});if(r.status!==0)throw Error('psql failed; raw output withheld');return r.stdout.trim();};
 const transport={execute:query,json:sql=>JSON.parse(query(sql).split('\n').find(x=>x.startsWith('{')))};
 if(mode==='plan'){classifyPreflight(transport.json(preflightSql()));console.log('EXACT59_PENDING');return;}
 if(process.env.CONFIRM_FLOOR_PACKAGE!==`APPLY_TRACKER_VOID_59_${process.env.RELEASE_SHA}`)throw Error('Exact59 confirmation missing');
 executePackage(transport,x=>console.log(x));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{main();}catch(e){console.error(e.message);process.exitCode=1;}}
