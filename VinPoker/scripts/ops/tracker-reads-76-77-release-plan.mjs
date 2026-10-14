import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {loadMigration as load75,postcheckSql as postcheck75} from './tracker-manual-75-release-plan.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
export function loadMigrations(){return [
 ['20270128000076','tracker_hand_input_scoped_read_v1','9dbdc7a37578e1b34acbb3df4343d308b8f5617907ceafc295bbc312162b0714'],
 ['20270128000077','tracker_roster_scoped_read_v2','e717a92d9a398aa77cb62300930b295bdd9e904c9dc1ccedfc4ff449058342d4'],
].map(([version,name,hash])=>{const filename=`${version}_${name}.sql`;const sql=canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${filename}`,import.meta.url),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact scoped-read SQL drift');return {version,name,hash,filename,sql};});}
function dependency(){const item=load75(),post=postcheck75();
 if(!post.startsWith('BEGIN READ ONLY;')||!post.endsWith('COMMIT;'))throw Error('Readonly75 seam drift');
 return `${post.slice('BEGIN READ ONLY;'.length,-'COMMIT;'.length)}
 DO $reads_previous_receipt$ BEGIN IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')<>1
 OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' AND name='${item.name}' AND cardinality(statements)=1
 AND encode(extensions.digest(convert_to(replace(replace(statements[1],E'\\r\\n',E'\\n'),E'\\r',E'\\n'),'UTF8'),'sha256'),'hex')='${item.hash}')
 THEN RAISE EXCEPTION 'reads_previous75_receipt_drift'; END IF; END $reads_previous_receipt$;`;}
function absent(){return `DO $reads_ledger$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN ('20270128000076','20270128000077') OR name IN ('tracker_hand_input_scoped_read_v1','tracker_roster_scoped_read_v2')) THEN RAISE EXCEPTION 'reads76_77_ledger_collision'; END IF; END $reads_ledger$;`;}
export function preflightSql(){const first=loadMigrations()[0],scan=scanMigrationSource(first.sql),create=first.sql.indexOf('CREATE FUNCTION floor_private.tracker_hand_input_context_v4');
 if(create<scan.insertAfterBegin)throw Error('Context76 seam drift');
 return `BEGIN READ ONLY;${dependency()}${absent()}${first.sql.slice(scan.insertAfterBegin,create)}
 SELECT json_build_object('database',current_database(),'actor',current_user,'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20270128000076','20270128000077')))::text;COMMIT;`;}
export function atomicSql(){return `BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';SELECT pg_advisory_xact_lock(280000,3747);${dependency()}${absent()}
 ${loadMigrations().map(item=>{const scan=scanMigrationSource(item.sql),tag=`$reads_${item.version}$`;if(item.sql.includes(tag))throw Error('Receipt delimiter collision');return item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)+`
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);`;}).join('\n')}
 COMMIT;`;}
export function postcheckSql(){return `BEGIN READ ONLY;${dependency()}${loadMigrations().map(item=>{const scan=scanMigrationSource(item.sql),post=item.sql.indexOf('DO $postcheck$');if(post<0||item.sql.split('DO $postcheck$').length!==2)throw Error('Reads postcheck seam drift');return item.sql.slice(post,scan.insertBeforeCommit);}).join('\n')}COMMIT;`;}
export function executePackage(transport,report=()=>{}){
 const baseline=transport.json(preflightSql());if(baseline?.database!=='postgres'||baseline.actor!=='postgres'||baseline.existing!==0)throw Error('Exact scoped-read baseline required');
 const items=loadMigrations();try{transport.execute(atomicSql());}catch{
  for(const item of items){let status='unavailable';try{const r=transport.json(receiptSql(item));status=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{}
   report(`STOP ${item.version} ${status}; no retry or downstream deploy`);}throw Error('Scoped-read apply outcome requires review');}
 for(const item of items){const r=transport.json(receiptSql(item));if(r.count!==1||r.exact!==true)throw Error('Exact scoped-read receipt postcheck failed');}
 transport.execute(postcheckSql());report('SCOPED_READS76_77_COMMITTED_EXACT_OBJECT_POSTCHECK_PASS');
}
