import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildAtomicMigrationQuery,canonicalSqlText} from './ops-1359-release-gate.mjs';
import {psqlEnvironment,receiptSql,validateContext} from './floor-37-47-protected-apply.mjs';

export const sourceSha='4f4097b0d2972cb02a1a2433768f7f06d721d964';
export const item=Object.freeze({action:'APPLY',version:'20270128000355',name:'finance_pt_statement_reads_v1',
 hash:'871cd603ba0dc81818c15c044e41bc6ad003ccca74d01cb1ebb142ebd39c71cc'});
export function validatePtReads355Context(env,recovery,runnerHead,now=Date.now()){
 assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch','PT355 requires owner dispatch');
 assert.equal(env.GITHUB_REPOSITORY,'PhamGiaVinh/abcxyzrandomsarghes','PT355 repository differs');
 assert.match(runnerHead,/^[a-f0-9]{40}$/);assert.equal(runnerHead,env.GITHUB_SHA,'PT355 runner checkout differs');
 assert.equal(recovery?.databaseOwnerAndEffectiveAclMatch,true,'PT355 restore owner/ACL proof missing');
 validateContext({...env,RELEASE_SHA:sourceSha},recovery,now);
}
const hash=s=>createHash('sha256').update(s).digest('hex');
export function preparePtReads355(root){
 const sql=canonicalSqlText(readFileSync(resolve(root,'supabase/migrations',`${item.version}_${item.name}.sql`),'utf8'));
 assert.equal(hash(sql),item.hash,'Reviewed PT355 migration differs');
 const atomic=buildAtomicMigrationQuery(item,sql);
 assert.equal(hash(atomic),'b9b180bf7da05388f42fad296d675e160d4d286554c4eaaf4e3b24d551af4f65','PT355 atomic wrapper differs');
 return atomic;
}
export function ptReads355CatalogSql(){
 return `BEGIN READ ONLY; SET LOCAL statement_timeout='5s';
SELECT json_build_object('database',current_database(),'actor',current_user,
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}'),
 'targetCount',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('get_pt_statement_installments_v1','list_my_pt_statements_v1')),
 'authorizerExact',EXISTS(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure('public.get_dealer_payroll_statement(uuid)')
  AND md5(p.prosrc)='cb89ab61460df145c0731806f29da523' AND pg_get_userbyid(p.proowner)='postgres'
  AND p.prosecdef AND p.provolatile='s' AND p.prokind='f' AND NOT p.proretset AND p.prorettype='jsonb'::regtype
  AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u'
  AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND p.proargnames=ARRAY['p_statement_id']
  AND p.proconfig=ARRAY['search_path=public'] AND p.proacl='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]),
 'legacyIndexExact',EXISTS(SELECT FROM pg_index i WHERE i.indexrelid=to_regclass('public.dealer_pt_wage_payments_statement_uq')
  AND i.indrelid='public.dealer_pt_wage_payments'::regclass AND i.indisunique AND i.indisvalid AND i.indisready
  AND i.indnkeyatts=1 AND i.indnatts=1 AND pg_get_indexdef(i.indexrelid,1,true)='statement_id'
  AND pg_get_expr(i.indpred,i.indrelid)='(statement_id IS NOT NULL)'),
 'readersExact',(SELECT count(*)=2 FROM pg_proc p WHERE
  ((p.oid=to_regprocedure('public.get_pt_statement_installments_v1(uuid)') AND md5(p.prosrc)='191f8b9de02702a828a1628d73ba8658'
    AND p.proargnames=ARRAY['p_statement_id'] AND p.pronargdefaults=0 AND p.proargdefaults IS NULL)
   OR (p.oid=to_regprocedure('public.list_my_pt_statements_v1(uuid,uuid,timestamptz,uuid)') AND md5(p.prosrc)='5788d4c196fba4cd5bae989f858d155c'
    AND p.proargnames=ARRAY['p_club_id','p_dealer_id','p_before_at','p_before_id'] AND p.pronargdefaults=2
    AND pg_get_expr(p.proargdefaults,0)='NULL::timestamp with time zone, NULL::uuid'))
  AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='s'
  AND p.prokind='f' AND NOT p.proretset AND p.prorettype='jsonb'::regtype
  AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u'
  AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
  AND p.proconfig=ARRAY['search_path=""'] AND p.proacl='{postgres=X/postgres,authenticated=X/postgres}'::aclitem[])
);COMMIT;`;
}
function exact(row,after=false){
 return row?.database==='postgres' && row.actor==='postgres' && row.ledgerCount===(after?1:0)
  && row.targetCount===(after?2:0) && row.authorizerExact===true && row.legacyIndexExact===true
  && row.readersExact===after;
}
export function applyPtReads355(atomic,transport,report){
 assert.ok(exact(transport.json(ptReads355CatalogSql())),'PT355 preflight differs');
 try{transport.execute(atomic);}catch{
  let outcome='unknown';try{const r=transport.json(receiptSql(item));outcome=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{}
  report(`PT355_STOP receipt=${outcome}`);throw Error('PT355 apply outcome requires review');
 }
 const receipt=transport.json(receiptSql(item));assert.ok(receipt.count===1&&receipt.exact===true,'PT355 exact receipt differs');
 assert.ok(exact(transport.json(ptReads355CatalogSql()),true),'PT355 postcheck differs');
 report('PT355_COMMITTED_EXACT_AND_POSTCHECK_PASS');
}
export async function verifyPtReadLoadEvidence(r,root){
 assert.equal(r.sourceSha,'f2ef7ad92adfe1aa097856b3da65307f7b401852');
 assert.deepEqual([r.actors,r.slots,r.paceMs,r.pool,r.durationMs,r.productionCapacityClaim,r.fullIntegrationQualification],[20,360,5000,10,1800000,false,false]);
 assert.equal(r.effectiveLoginConfig?.jit,'off');
 const {summarizeReadQualification}=await import(pathToFileURL(resolve(root,'tests/financePayrollReadRelease/load-qualification.mjs')).href);
 const actual=summarizeReadQualification(r);assert.equal(actual.qualification,true,'PT355 standalone load not qualified');
 assert.deepEqual(r.results,actual.results);assert.equal(r.qualification,true);
}
async function main(){
 const mode=process.argv[2];assert.ok(['verify-source','verify-load','apply'].includes(mode));
 const env=process.env,root=resolve(env.RELEASE_SOURCE_ROOT);
 assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceSha,'PT355 source checkout differs');
 const atomic=preparePtReads355(root);
 if(mode==='verify-source'){console.log('PT355_SOURCE_AND_ATOMIC_RECEIPT_VERIFIED');return;}
 if(mode==='verify-load'){
  const r=JSON.parse(readFileSync(env.LOAD_EVIDENCE_PATH,'utf8'));
  await verifyPtReadLoadEvidence(r,root);
  // The source SQL measured at f2 is the same normalized body pinned above at4f.
  console.log('PT355_ORIGINAL_SCHEMA_READ_LOAD_RAW_GRADE_VERIFIED');return;
 }
 assert.equal(env.CONFIRM_PT_355,`APPLY_PT_355_${sourceSha}`);
 const runnerHead=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 validatePtReads355Context(env,JSON.parse(readFileSync(env.RECOVERY_RECEIPT_PATH,'utf8')),runnerHead);
 const query=sql=>{const r=spawnSync('psql',['-XqAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',env:psqlEnvironment(env),timeout:45000,maxBuffer:2*1024*1024});assert.equal(r.status,0,'PT355 SQL failed; raw output withheld');return r.stdout.trim();};
 applyPtReads355(atomic,{execute:query,json:q=>JSON.parse(query(q).split('\n').find(x=>x.startsWith('{')))},s=>console.log(s));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){main().catch(e=>{console.error(e.message);process.exitCode=1;});}
