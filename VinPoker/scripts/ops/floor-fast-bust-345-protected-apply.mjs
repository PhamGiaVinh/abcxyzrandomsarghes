import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';
import {canonicalSqlText,buildAtomicMigrationQuery} from './ops-1359-release-gate.mjs';
import {qualifyFloor345} from './select-floor345-runtime.mjs';
import {validateContext,psqlEnvironment,receiptSql} from './floor-37-47-protected-apply.mjs';

export const MANIFEST_SHA256='83f468cb5f3112a1296f2e106bd43464cce6b0fbac53e6d17768e70a31ba4576';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const hash=b=>createHash('sha256').update(b).digest('hex');
const SOURCE_GUARD="DO $floor345_source_guard$ BEGIN\n IF md5(pg_get_functiondef(to_regprocedure('public.get_floor_tournament_table_roster_v6(uuid)'))) IS DISTINCT FROM 'e5425dc9b81a09d48206b3d270323069'\n OR md5(pg_get_functiondef(to_regprocedure('public.floor_bust_player_v3(uuid,bigint,bigint,integer,uuid,text)'))) IS DISTINCT FROM 'a204a2cf93debeb96a6a0c4f0b495149'\n OR to_regprocedure('public.get_floor_tournament_table_roster_v7(uuid)') IS NOT NULL\n OR to_regprocedure('public.floor_operator_bust_seat_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid,bigint,uuid,text)') IS NOT NULL\n THEN RAISE EXCEPTION 'floor345_source_or_target_drift_stop'; END IF;\nEND $floor345_source_guard$;\n";
const manifestFile=resolve(root,'scripts/ops/floor-fast-bust-345-manifest.json');
export function loadPackage(sourceRoot){
 const rawManifest=canonicalSqlText(readFileSync(manifestFile));
 assert.equal(hash(rawManifest),MANIFEST_SHA256,'Reviewed manifest differs');
 const manifest=JSON.parse(rawManifest);
 assert.equal(manifest.projectRef,'orlesggcjamwuknxwcpk');
 assert.equal(manifest.migrations.length,1);assert.equal(manifest.sourcePr,1638);
 assert.equal(manifest.referenceProductSha,'438290856c05fe426e41be0a385fd4431d4ffe16');
 const path=resolve(sourceRoot,manifest.migrations[0].path);
 assert.ok(lstatSync(path).isFile()&&!lstatSync(path).isSymbolicLink(),'Regular migration source required');
 const sql=canonicalSqlText(readFileSync(path));
 assert.equal(hash(sql),manifest.migrations[0].sha256,'Migration source differs');
 const builder=canonicalSqlText(readFileSync(resolve(root,'../',manifest.builder.path)));
 assert.equal(hash(builder),manifest.builder.sha256,'Reviewed atomic builder differs');
 return {rawManifest,manifest,sql};
}
function checkedManifest(pkg){
 assert.equal(hash(pkg.rawManifest),MANIFEST_SHA256,'Manifest drift');
 const manifest=JSON.parse(pkg.rawManifest);
 assert.equal(hash(pkg.sql),manifest.migrations[0].sha256,'SQL drift');
 return manifest;
}
export function sourcePredicate(manifest){
 return Object.entries(manifest.sourcePreimages).map(([sig,md5])=>
  `md5(pg_get_functiondef(to_regprocedure('${sig}'))) IS NOT DISTINCT FROM '${md5}'`).join(' AND ');
}
export function atomicSql(pkg){
 const m=checkedManifest(pkg),item=m.migrations[0];
 let sql=buildAtomicMigrationQuery(item,pkg.sql);
 const guard=SOURCE_GUARD;
 const marker='CREATE FUNCTION public.get_floor_tournament_table_roster_v7',index=sql.indexOf(marker);
 assert.ok(index>=0&&index<sql.indexOf('INSERT INTO supabase_migrations'),'Source boundary differs');
 sql=sql.slice(0,index)+guard+sql.slice(index);
 assert.equal(hash(sql),m.atomicSqlSha256,'Reviewed atomic wrapper differs');
 return sql;
}
export function preflightSql(pkg){
 const m=checkedManifest(pkg),e=m.migrations[0];
 return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object(
 'database',current_database(),'actor',current_user,
 'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${e.version}' OR name='${e.name}'),
 'baseline',(${sourcePredicate(m)}),
 'targetsAbsent',(${m.newSignatures.map(s=>`to_regprocedure('${s}') IS NULL`).join(' AND ')}))::text;COMMIT;`;
}
export function classifyPreflight(row){
 assert.ok(row?.database==='postgres'&&row.actor==='postgres'&&row.existing===0&&row.baseline===true&&row.targetsAbsent===true,'Floor345 preflight differs; no apply');
}
export function postcheckSql(pkg){
 const m=checkedManifest(pkg);
 return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object(
 'functions',COALESCE((SELECT bool_and(COALESCE(p.prosecdef AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')
 AND p.proconfig=ARRAY['search_path=""']::text[] AND md5(p.prosrc)=e.body_hash
 AND p.provolatile::text=e.volatility AND p.prolang=(SELECT oid FROM pg_language WHERE lanname=e.language)
 AND p.prorettype='jsonb'::regtype AND NOT p.proretset AND has_function_privilege('authenticated',p.oid,'EXECUTE')
 AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('service_role',p.oid,'EXECUTE'),false))
 FROM (VALUES ${m.newSignatures.map((s,i)=>`('${s}','${['7bf15252a5730c4bc6d2bf74e366afcb','082bee09a75c80adbf9ae6e2c652216c'][i]}','${i===0?'s':'v'}','${i===0?'sql':'plpgsql'}')`).join(',')}) e(signature,body_hash,volatility,language)
 LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)),false),
 'baseline',(${sourcePredicate(m)}))::text;COMMIT;`;
}
export function executeMigration(pkg,transport,report=()=>{}){
 const sql=atomicSql(pkg),m=checkedManifest(pkg),item={...m.migrations[0],hash:m.migrations[0].sha256};
 classifyPreflight(transport.json(preflightSql(pkg)));
 try{transport.execute(sql);}catch{
  let observed='unavailable';
  try{const r=transport.json(receiptSql(item));observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{}
  report(`STOP345 receipt=${observed}; no automatic retry`);
  throw Error('Floor345 apply outcome requires review');
 }
 const receipt=transport.json(receiptSql(item));
 assert.ok(receipt.count===1&&receipt.exact===true,'Floor345 receipt differs; stop');
 report("COMMITTED_EXACT "+item.version+" "+item.hash);
 const post=transport.json(postcheckSql(pkg));
 assert.ok(post.functions===true&&post.baseline===true,'Floor345 object/ACL postcheck differs; stop');

 report('FLOOR345_OBJECT_POSTCHECK_PASS');
}
export function validateApproval(mode,env,receipt,observed){
 assert.ok(['plan','apply'].includes(mode),'Protected plan|apply only');
 assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');
 assert.equal(env.GITHUB_REPOSITORY,'PhamGiaVinh/abcxyzrandomsarghes');
 assert.equal(env.MANIFEST_SHA256,MANIFEST_SHA256,'Exact manifest approval required');
 validateContext(env,receipt);
 assert.equal(receipt.databaseOwnerAndEffectiveAclMatch,true,'Restore owner/ACL verification required');
 assert.equal(env.SOURCE_PR_BASE_SHA,env.GITHUB_SHA,'Protected dispatch base differs');
 assert.equal(observed.controllerSha,env.GITHUB_SHA,'Controller checkout differs');
 assert.equal(observed.sourceSha,env.RELEASE_SHA,'Release checkout differs');
 if(mode==='apply')assert.equal(env.CONFIRM_FLOOR_PACKAGE,`APPLY_FLOOR_345_${env.RELEASE_SHA}`,'Exact345 apply confirmation missing');
}
function main(){
 const mode=process.argv[2];assert.ok(['plan','apply'].includes(mode),'Protected plan|apply only');
 const env=process.env;
 const sourceRoot=resolve(env.RELEASE_SOURCE_ROOT);
 const gitSha=path=>execFileSync('git',['-C',path,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 validateApproval(mode,env,JSON.parse(readFileSync(env.RECOVERY_RECEIPT_PATH,'utf8')),
  {controllerSha:gitSha(root),sourceSha:gitSha(sourceRoot)});
 const pkg=loadPackage(sourceRoot);
 qualifyFloor345({repo:resolve(sourceRoot,'..'),base:env.SOURCE_PR_BASE_SHA,head:env.RELEASE_SHA,pr:1638});
 const query=sql=>{
  const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',env:psqlEnvironment(env),maxBuffer:2*1024*1024,timeout:150000});
  if(r.error||r.status!==0)throw Error('Private database command failed; raw output withheld');
  return r.stdout.trim();
 };
 const transport={execute:query,json:sql=>JSON.parse(query(sql).split('\n').find(x=>x.startsWith('{')))};
 atomicSql(pkg);
 if(mode==='plan'){classifyPreflight(transport.json(preflightSql(pkg)));console.log('EXACT_MIGRATION_PENDING 345');return;}
 executeMigration(pkg,transport,x=>console.log(x));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main();}catch{console.error('FLOOR345_PROTECTED_APPLY_STOP: inspect private outcome; no automatic retry');process.exitCode=1;}
}
