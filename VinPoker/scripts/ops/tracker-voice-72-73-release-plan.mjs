import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
import {loadMigration as load72,atomicSql as atomic72,preflightSql as preflight72,postcheckSql as postcheck72} from './tracker-voice-72-release-plan.mjs';

export function loadPackage(){
 const version='20270128000073',name='dealer_voice_swing_lock_order_v1',filename=`${version}_${name}.sql`;
 const hash='5b44af84a9e20627152471141bca6ca42539f1ca658bbaade89a061a7066530b';
 const sql=canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${filename}`,import.meta.url),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact73 SQL drift');
 return [load72(),{version,name,filename,hash,sql}];
}
function operatorPredicate(final=false){return `EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)') AND md5(replace(pg_get_functiondef(oid),chr(13),''))='${final?'a25a91e02d6f2c0399e5aba1086e4acf':'3f3e35df593064562056326969364bac'}' AND md5(jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'acl',proacl::text,'config',proconfig,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)::text)='0289c33bd59043938c89f034dc7235c5')`;}
export function preflightSql(){
 const sql=preflight72(),item=loadPackage()[1];
 if(sql.split('COMMIT;').length!==2)throw Error('Reviewed72 preflight seam drift');
 return sql.replace('COMMIT;',`DO $package73_guard$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}') OR NOT (${operatorPredicate()}) THEN RAISE EXCEPTION 'package73_precondition_drift'; END IF; END $package73_guard$; COMMIT;`);
}
export function classifyPreflight(r){if(r?.database!=='postgres'||r.actor!=='postgres'||r.existing!==0||r.baseline!==true)throw Error('Voice72/73 baseline or existing package drift');}
export function atomicSql(){
 const [first,second]=loadPackage(),prefix=atomic72(first),scanFirst=scanMigrationSource(prefix),scanSecond=scanMigrationSource(second.sql),tag='$voice73_receipt$';
 if(second.sql.includes(tag))throw Error('Voice73 receipt delimiter collision');
 const guard=`DO $voice73_guard$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${second.version}' OR name='${second.name}') OR NOT (${operatorPredicate()}) THEN RAISE EXCEPTION 'package73_precondition_drift'; END IF; END $voice73_guard$;`;
 const receipt=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${second.version}','${second.name}',ARRAY[${tag}${second.sql}${tag}]::text[]);`;
 // One transaction: failure anywhere in73 also removes72 mutation/receipt.
 return prefix.slice(0,scanFirst.insertBeforeCommit)+'\n'+guard+'\n'+second.sql.slice(scanSecond.insertAfterBegin,scanSecond.insertBeforeCommit)+'\n'+receipt+'\n'+prefix.slice(scanFirst.insertBeforeCommit);
}
export function postcheckSql(){
 const sql=postcheck72();if(sql.split('COMMIT;').length!==2)throw Error('Reviewed72 postcheck seam drift');
 return sql.replace('COMMIT;',`DO $voice73_post$ BEGIN IF NOT (${operatorPredicate(true)}) THEN RAISE EXCEPTION 'voice73_object_postcheck_failed'; END IF; END $voice73_post$; COMMIT;`);
}
export function executePackage(transport,report=()=>{}){
 classifyPreflight(transport.json(preflightSql()));
 try{transport.execute(atomicSql());}catch{
  for(const item of loadPackage()){
   let observed='unavailable';try{const r=transport.json(receiptSql(item));observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{/* unknown outcome */}
   report(`STOP ${item.version} receipt=${observed}; no retry or downstream apply`);
  }
  throw Error('Voice72/73 apply outcome requires review');
 }
 for(const item of loadPackage()){const r=transport.json(receiptSql(item));if(r.count!==1||r.exact!==true)throw Error('Voice72/73 receipt postcheck failed');}
 transport.execute(postcheckSql());
 for(const item of loadPackage())report(`COMMITTED_EXACT ${item.version} ${item.hash}`);
 report('VOICE72_73_OBJECT_POSTCHECK_PASS');
}
