import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildAtomicMigrationQuery,canonicalSqlText} from './ops-1359-release-gate.mjs';
import {psqlEnvironment,receiptSql,validateContext} from './floor-37-47-protected-apply.mjs';

export const sourceSha='49438f75e10fdf62db2ee7656cdaa1063b807ffc';
const item={action:'APPLY',version:'20270128000354',name:'finance_expense_scope_idempotency',
  hash:'4c7615860dba50225a6507f6b2db378f417701a3968bb0063414bdad1ac62632'};
const signature='public.record_club_expense(uuid,public.expense_category,bigint,timestamptz,text,text,text,uuid,uuid,text,uuid,text)';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function prepareExpense354(root) {
  const source=canonicalSqlText(readFileSync(resolve(root,'supabase/migrations',`${item.version}_${item.name}.sql`),'utf8'));
  assert.equal(hash(source),item.hash,'Reviewed expense migration differs');
  const atomic=buildAtomicMigrationQuery(item,source);
  assert.equal(hash(atomic),'7707c7c1a45686b476c4704a5774f3fc25527313f92a4857fb7fc8d91f3d8009','Expense atomic SQL differs');
  return atomic;
}
export function expense354CatalogSql() {
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='5s';
SELECT json_build_object(
 'database',current_database(),'actor',current_user,
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}'),
 'functionHash',(SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('${signature}')),
 'readerHash',(SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.get_club_expenses(uuid,timestamptz,timestamptz)')),
 'functionOwner',(SELECT proowner::regrole::text FROM pg_proc WHERE oid=to_regprocedure('${signature}')),
 'securityDefiner',(SELECT prosecdef FROM pg_proc WHERE oid=to_regprocedure('${signature}')),
 'volatility',(SELECT provolatile::text FROM pg_proc WHERE oid=to_regprocedure('${signature}')),
 'searchPath',(SELECT proconfig FROM pg_proc WHERE oid=to_regprocedure('${signature}')),
 'aclHash',(SELECT md5(proacl::text) FROM pg_proc WHERE oid=to_regprocedure('${signature}')),
 'executors',(SELECT array_agg(DISTINCT x.grantee::regrole::text ORDER BY x.grantee::regrole::text)
   FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) x WHERE p.oid=to_regprocedure('${signature}') AND x.privilege_type='EXECUTE'),
 'anonymousExecute',has_function_privilege('anon',to_regprocedure('${signature}'),'EXECUTE'),
 'uniqueIndexValid',EXISTS(SELECT FROM pg_index i WHERE i.indexrelid=to_regclass('public.uq_club_expenses_idem')
   AND i.indrelid='public.club_expenses'::regclass
   AND i.indisunique AND i.indisvalid AND i.indnkeyatts=2
   AND pg_get_indexdef(i.indexrelid,1,true)='club_id' AND pg_get_indexdef(i.indexrelid,2,true)='idempotency_key'
   AND pg_get_expr(i.indpred,i.indrelid)='(idempotency_key IS NOT NULL)')
); COMMIT;`;
}
function catalogMatches(row,{after=false,aclHash}={}) {
  return row?.database==='postgres' && row.actor==='postgres' && row.ledgerCount===(after?1:0)
    && row.functionHash===(after?'a96cdd76edcbfb03cc1812b26047e179':'ec4209e4c6e11503ecd4e52c5d4be0ee')
    && row.readerHash==='15d1b9d63df67e34ee1d999adc7ffe08' && row.functionOwner==='postgres'
    && row.securityDefiner===true && row.volatility==='v' && row.uniqueIndexValid===true && row.anonymousExecute===false
    && JSON.stringify(row.searchPath)===JSON.stringify([after?'search_path=""':'search_path=public'])
    && JSON.stringify(row.executors)===JSON.stringify(['authenticated','postgres','service_role'])
    && typeof row.aclHash==='string' && /^[a-f0-9]{32}$/.test(row.aclHash)
    && (aclHash===undefined || row.aclHash===aclHash);
}
export function applyExpense354(atomic,transport,report) {
  const pre=transport.json(expense354CatalogSql());
  assert.ok(catalogMatches(pre),'Expense354 preflight differs');
  try { transport.execute(atomic); }
  catch {
    let outcome='unknown';
    try { const receipt=transport.json(receiptSql(item)); outcome=receipt.count===1&&receipt.exact===true?'committed-exact':receipt.count===0?'not-recorded':'drift'; }
    catch { /* Do not repeat an apply with unknown outcome. */ }
    report(`EXPENSE354_STOP receipt=${outcome}`);
    throw Error('Expense354 apply outcome requires review');
  }
  const receipt=transport.json(receiptSql(item));
  assert.ok(receipt.count===1&&receipt.exact===true,'Expense354 exact receipt differs');
  assert.ok(catalogMatches(transport.json(expense354CatalogSql()),{after:true,aclHash:pre.aclHash}),'Expense354 postcheck differs');
  report('EXPENSE354_COMMITTED_EXACT_AND_POSTCHECK_PASS');
}
function main() {
  const mode=process.argv[2];assert.ok(['verify-source','apply'].includes(mode));
  const env=process.env,root=resolve(env.RELEASE_SOURCE_ROOT);
  const revision=path=>execFileSync('git',['-C',path,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  assert.equal(revision(root),sourceSha);
  const atomic=prepareExpense354(root);
  if(mode==='verify-source'){console.log('EXPENSE354_SOURCE_AND_ATOMIC_HASH_PASS');return;}
  assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');
  assert.equal(env.GITHUB_REPOSITORY,'PhamGiaVinh/abcxyzrandomsarghes');
  assert.equal(env.RELEASE_SHA,sourceSha);
  assert.equal(env.CONFIRM_EXPENSE_354,`APPLY_EXPENSE_354_${sourceSha}`);
  assert.equal(revision(process.cwd()),env.GITHUB_SHA);
  const recovery=JSON.parse(readFileSync(env.RECOVERY_RECEIPT_PATH,'utf8'));
  validateContext(env,recovery);
  assert.equal(recovery.databaseOwnerAndEffectiveAclMatch,true);
  const query=sql=>{
    const result=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',
      env:psqlEnvironment(env),timeout:150000,maxBuffer:512000});
    if(result.error||result.status!==0)throw Error('Private PostgreSQL command failed');
    return result.stdout.trim();
  };
  applyExpense354(atomic,{execute:query,json:sql=>JSON.parse(query(sql))},console.log);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try { main(); } catch { console.error('EXPENSE354_STOP inspect exact recovery/receipt before any retry');process.exitCode=1; }
}
