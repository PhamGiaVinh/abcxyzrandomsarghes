import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';

const specifications=[
 ['20270128000070','tracker_voice_card_actor_epoch_fences_v1','5a25a790d88f06969a13ad3a801998869b260f8fb69e71cbb08691e922c9aea2'],
 ['20270128000071','tracker_voice_finish_actor_session_fence_v1','1a747f345d56b6ff4b5c13186dd5e98f9db384e918659808b638e39be6203993'],
];
const pins=[
 ['update_community_cards(uuid,jsonb,uuid)','fad65f1d894c364249dd51f25ac06dde','162b0102d6f7b5181198aa9d562c2fbf',false,'public','authenticated'],
 ['show_hole_cards(uuid,jsonb,uuid)','320f5edc67f9ac874b89684d872447c3','1abb19cb93839c91c0f6e52466905cf1',false,'public','authenticated'],
 ['commit_tracker_voice_board_v0(uuid,text,text)','a2690a56143d9cce0210e66c13e2763a','360cb1872c04cf9185dbe7e2362d3ffb',true,'public','authenticated'],
 ['commit_tracker_voice_hole_cards_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,jsonb)','d065ca95f25b40a7783e647a57019e40','49454de61d8beab357877a0c4f7748f3',true,'public','service_role'],
 ['_tracker_voice_hand_state_version(uuid)','02fb54cede4cf42423abe72271375a8b','f1f8d600607c96653f1ea1c0f950c119',false,'public',null],
 ['record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)','b3bb09d6a873becb061ea05d6cecd4dd','16006fec6f3b9274581de471a9dc296a',true,'""','authenticated'],
];
export function loadPackage(){return specifications.map(([version,name,hash])=>{
 const filename=`${version}_${name}.sql`;
 const sql=canonicalSqlText(readFileSync(new URL(`../../supabase/migrations/${filename}`,import.meta.url),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Voice70/71 immutable SQL drift');
 return {version,name,hash,filename,sql};
});}
function ledgerPredicate(item){return `EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' AND name='${item.name}' AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(replace(replace(statements[1],E'\\r\\n',E'\\n'),E'\\r',E'\\n'),'UTF8'),'sha256'),'hex')='${item.hash}')`;}
function objectPredicate(stage){
 const checks=pins.map(([sig,before,after,definer,path,role],index)=>{
  const digest=stage===0||(stage===1&&index===5)?before:after;
  const acl=role?`{postgres=X/postgres,${role}=X/postgres}`:'{postgres=X/postgres}';
  return `EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.${sig}') AND md5(replace(pg_get_functiondef(oid),chr(13),''))='${digest}' AND proowner='postgres'::regrole AND prosecdef=${definer} AND proconfig=ARRAY['search_path=${path}']::text[] AND proacl::text='${acl}')`;
 });
 checks.push(`md5(replace(pg_get_functiondef('public._tracker_voice_assignment_context(uuid,uuid,uuid)'::regprocedure),chr(13),''))='96ba904dfcdfaa23dba36b6862aba168'`);
 checks.push(`md5(replace(pg_get_functiondef('public.is_club_tracker(uuid,uuid)'::regprocedure),chr(13),''))='754a878cd17019d6cb0b27aad6a10e84'`);
 checks.push(`md5(replace(pg_get_functiondef('public.commit_tracker_voice_finish_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb)'::regprocedure),chr(13),''))='3a0ce90325bc229ada7103893de6c3e4' AND NOT has_function_privilege('authenticated','public.commit_tracker_voice_finish_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb)','EXECUTE') AND has_function_privilege('service_role','public.commit_tracker_voice_finish_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb)','EXECUTE')`);
 for(const [name,digest] of [['_tracker_card_board_source_v1','f6bfc487e7c3f316f754b7fed51ff85f'],['_tracker_card_hole_source_v1','53374e21fe6d323affa8a074402f4b85']]){
  const sig=`public.${name}(uuid,jsonb,uuid,boolean)`;
  checks.push(stage===0?`to_regprocedure('${sig}') IS NULL`:`EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('${sig}') AND md5(replace(pg_get_functiondef(oid),chr(13),''))='${digest}' AND proowner='postgres'::regrole AND NOT prosecdef AND pronargdefaults=0 AND proconfig=ARRAY['search_path=""']::text[] AND proacl::text='{postgres=X/postgres,authenticated=X/postgres}')`);
 }
 return checks.join('\nAND ');
}
function baselinePredicate(stage){
 const packageItems=loadPackage();
 const prior={version:'20270128000069',name:'chip_issuance_exact_intent_v1',hash:'c92283d9084afe9dd68c1967e80366f3af9fe55cea1589b04f67239df8374b5f'};
 return `${ledgerPredicate(prior)} AND ${stage>0?ledgerPredicate(packageItems[0]):'true'} AND (${objectPredicate(stage)})`;
}
export function preflightSql(){const items=loadPackage();return `BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; SELECT json_build_object('database',current_database(),'actor',current_user,'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN (${items.map(i=>`'${i.version}'`).join(',')}) OR name IN (${items.map(i=>`'${i.name}'`).join(',')})),'baseline',(${baselinePredicate(0)}))::text; COMMIT;`;}
export function classifyPreflight(r){if(r?.database!=='postgres'||r.actor!=='postgres'||r.existing!==0||r.baseline!==true)throw Error('Voice70/71 baseline or existing package drift');}
export function postcheckSql(stage){if(![1,2].includes(stage))throw Error('Unknown Voice stage');return `BEGIN READ ONLY; DO $voice_post$ BEGIN IF NOT COALESCE((${baselinePredicate(stage)}),false) OR ${stage===2?`NOT (${ledgerPredicate(loadPackage()[1])})`:'false'} THEN RAISE EXCEPTION 'voice_package_object_postcheck_failed'; END IF; END $voice_post$; COMMIT;`;}
export function atomicSql(item){
 const items=loadPackage(),index=items.findIndex(i=>i.version===item?.version);
 if(index<0||['version','name','hash','filename','sql'].some(k=>items[index][k]!==item[k]))throw Error('Voice allowlist mismatch');
 const scan=scanMigrationSource(item.sql),tag='$voice_package_receipt$';
 if(item.sql.includes(tag))throw Error('Voice receipt delimiter collision');
 const guard=`SET LOCAL lock_timeout='5s'; SELECT pg_advisory_xact_lock(280000,3747); DO $voice_package_guard$ BEGIN IF current_user<>'postgres' OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}') OR NOT COALESCE((${baselinePredicate(index)}),false) THEN RAISE EXCEPTION 'voice_package_precondition_drift'; END IF; END $voice_package_guard$;`;
 const receipt=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);`;
 return item.sql.slice(0,scan.insertAfterBegin)+'\n'+guard+'\n'+item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)+'\n'+receipt+'\n'+item.sql.slice(scan.insertBeforeCommit);
}
export function executePackage(transport,report=()=>{}){
 classifyPreflight(transport.json(preflightSql()));
 for(const [index,item] of loadPackage().entries()){
  try{transport.execute(atomicSql(item));}catch{
   let observed='unavailable';try{const r=transport.json(receiptSql(item));observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{/* unknown outcome */}
   report(`STOP ${item.version} receipt=${observed}; no retry or downstream apply`);throw Error('Voice apply outcome requires review');
  }
  const r=transport.json(receiptSql(item));if(r.count!==1||r.exact!==true)throw Error('Voice receipt postcheck failed; stop');
  transport.execute(postcheckSql(index+1));
  report(`COMMITTED_EXACT ${item.version} ${item.hash}`);
 }
 report('VOICE70_71_OBJECT_POSTCHECK_PASS');
}
