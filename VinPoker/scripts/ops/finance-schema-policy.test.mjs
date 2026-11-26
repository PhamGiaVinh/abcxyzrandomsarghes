import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {selectCashierSchemaMode} from './select-cashier-schema-mode.mjs';

const root=mkdtempSync(join(tmpdir(),'finance-policy-tree-'));
after(()=>{assert.equal(dirname(resolve(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true});});
const actualRepo=fileURLToPath(new URL('../../..',import.meta.url));
const source='e231ba934bbbc7e0608499dc05bb306f1f51f544';
const baseSource='9fcf0ad20a49d94d02092837ee9b45636d9f9f62';
const git=(...args)=>execFileSync('git',['-C',root,...args],{maxBuffer:16*1024*1024});
const original=(revision,path)=>execFileSync('git',['-C',actualRepo,'show',`${revision}:${path}`],{maxBuffer:16*1024*1024});
const prefix='VinPoker/scripts/ops/';
const policyPath=prefix+'finance-source-qualified-scope-20261126.json';
const receiptPath=prefix+'fixtures/finance-source-runtime-receipt-20261126.json';
const trusted=[policyPath,receiptPath,prefix+'select-cashier-schema-mode.mjs',
 prefix+'cashier-hud35-qualified-scope.json',prefix+'fixtures/cashier-ci-hud35-qualified-receipt-20261107.json',
 prefix+'cashier-source342-344-qualified-scope.json',prefix+'fixtures/cashier-source342-344-runtime-receipt.json',
 prefix+'finance-schema-policy.test.mjs',prefix+'cashier-schema-mode.test.mjs','.github/workflows/cashier-tour-real-e2e.yml',
 'VinPoker/e2e/cashier-tour-real.spec.ts'];
const policy=JSON.parse(readFileSync(resolve(actualRepo,policyPath),'utf8'));
git('init','--quiet');git('config','user.name','Local policy fixture');git('config','user.email','policy@test.invalid');
const sourceObjects=execFileSync('git',['-C',actualRepo,'rev-parse','--git-path','objects']).toString().trim();
writeFileSync(join(root,'.git','objects','info','alternates'),resolve(actualRepo,sourceObjects).replaceAll('\\','/')+'\n');
const blobs=new Map();
function commit(files,parent,modes=new Map()){
 git('read-tree',baseSource);
 let index='';
 for(const [path,value] of files){const bytes=Buffer.isBuffer(value)?value:Buffer.from(value),digest=createHash('sha256').update(bytes).digest('hex');
  if(!blobs.has(digest))blobs.set(digest,execFileSync('git',['-C',root,'hash-object','-w','--stdin'],{input:bytes}).toString().trim());
  index+=`${modes.get(path)??'100644'} ${blobs.get(digest)}\t${path}\0`;
 }
 execFileSync('git',['-C',root,'update-index','-z','--index-info'],{input:index});
 // Metadata-only fixtures retain opaque historical blobs through alternates.
 // Required policy/SQL/runtime contents are still explicitly read and hashed
 // by the production validator; a missing required blob cannot qualify.
 const tree=git('write-tree','--missing-ok').toString().trim();return git('commit-tree',tree,...(parent?['-p',parent]:[]),'-m','bounded policy fixture').toString().trim();
}
// Model Git's tracked LF bytes, not Windows checkout CRLF conversion.
const baseline=new Map(trusted.map(path=>[path,Buffer.from(readFileSync(resolve(actualRepo,path),'utf8').replace(/\r\n?/g,'\n'))]));
const unlisted=['VinPoker/package-lock.json','VinPoker/src/hooks/useAuth.tsx','VinPoker/scripts/ops/cashier-tour-real-e2e.sh'];
for(const path of unlisted)baseline.set(path,original(baseSource,path));
for(const row of [...policy.migrationScope,...policy.runtimePins]){
 if(execFileSync('git',['-C',actualRepo,'ls-tree',baseSource,'--',row.path]).length)baseline.set(row.path,original(baseSource,row.path));
}
const historic='VinPoker/supabase/migrations/20270115000003_cashier_tour_money_v1.sql';
baseline.set(historic,original(baseSource,historic));
const base=commit(baseline);
const candidate=new Map(baseline);
for(const row of [...policy.migrationScope,...policy.runtimePins])candidate.set(row.path,original(source,row.path));
const head=commit(candidate,base);
const pages=(to=head,from=base)=>{const fields=git('diff','--no-renames','--name-status','-z',from,to).toString().split('\0');fields.pop();const files=[];for(let i=0;i<fields.length;i+=2)files.push({filename:fields[i+1],status:{A:'added',M:'modified',D:'removed'}[fields[i]]});return [files];};
const context=(to=head,from=base)=>({repo:root,base:from,head:to});
let classify=selectCashierSchemaMode;
if(process.env.FINANCE_POLICY_LEGACY_REPRO==='1'){
 const entry=join(root,'legacy-selector.mjs');writeFileSync(entry,original(baseSource,prefix+'select-cashier-schema-mode.mjs'));
 classify=(await import(pathToFileURL(entry))).selectCashierSchemaMode;
}
function changed(path,value){const files=new Map(candidate);if(value===null)files.delete(path);else files.set(path,Buffer.from(value));const next=commit(files,base);return classify(pages(next),context(next));}

test('admits the complete byte-pinned new finance package only through trusted base',()=>{
 assert.equal(classify(pages(),context()),'current');
});
test('does not admit partial, extra, deleted or edited finance SQL',()=>{
 for(const row of policy.migrationScope.filter(f=>f.status==='A')){
  assert.equal(changed(row.path,null),'pre03');
  assert.equal(changed(row.path,Buffer.concat([candidate.get(row.path),Buffer.from('\n-- drift')])),'pre03');
 }
 assert.equal(changed('VinPoker/supabase/pending-migrations/20990101000000_unknown.sql','SELECT 1;'),'pre03');
 assert.equal(changed(historic,'-- altered historical migration'),'pre03');
});
test('catalog preimage and postimage both remain exact',()=>{
 const row=policy.migrationScope.find(f=>f.status==='M');assert.equal(changed(row.path,'{}\n'),'pre03');
 const badBase=new Map(baseline);badBase.set(row.path,Buffer.from('{}\n'));const differentBase=commit(badBase);
 const differentHead=commit(candidate,differentBase);assert.equal(classify(pages(differentHead,differentBase),context(differentHead,differentBase)),'pre03');
});
test('a product PR cannot edit its policy, receipt, selector, tests or required workflow',()=>{
 for(const path of trusted)assert.equal(changed(path,Buffer.concat([candidate.get(path),Buffer.from('\n ')])),'pre03');
});
test('runtime source and native producer inputs remain byte pinned',()=>{
 for(const path of ['VinPoker/src/components/clubExpenses/CashierExpenseEntry.tsx',
  'VinPoker/tests/financeExpenseCashClient/client.http.mjs','.github/workflows/finance-expense-cash-client.yml']){
  assert.equal(changed(path,Buffer.concat([candidate.get(path),Buffer.from('\n// drift')])),'pre03');
 }
});
test('extra dependency auth and runtime-script edits cannot accompany the package',()=>{
 for(const path of unlisted)assert.equal(changed(path,Buffer.concat([candidate.get(path),Buffer.from('\n ')])),'pre03');
});
test('inherited dependency drift cannot reuse the old native receipt',()=>{
 for(const path of unlisted){
  const old=new Map(baseline),next=new Map(candidate),bytes=Buffer.concat([baseline.get(path),Buffer.from('\n ')]);
  old.set(path,bytes);next.set(path,bytes);const b=commit(old),h=commit(next,b);
  assert.equal(classify(pages(h,b),context(h,b)),'pre03');
 }
});
test('malformed or incomplete file pages do not hide a migration',()=>{
 assert.throws(()=>classify([pages()[0].slice(1)],context()),/tree diff/);
 assert.throws(()=>classify([[...pages()[0],pages()[0][0]]],context()),/Duplicate/);
 assert.throws(()=>classify([Array(3000).fill(pages()[0][0])],context()),/cap/);
 assert.throws(()=>classify([[{filename:'x',status:'copied'}]],context()),/tree diff/);
});
test('rename-shaped API metadata never exempts the package',()=>{
 const input=pages();input[0].find(f=>f.filename===policy.migrationScope.find(f=>f.status==='A').path).previous_filename='VinPoker/supabase/migrations/old.sql';
 assert.equal(classify(input,context()),'pre03');
});
test('symlink or executable SQL and actual rename trees remain historical',()=>{
 const path=policy.migrationScope.find(f=>f.status==='A').path;
 for(const mode of ['100755','120000']){const next=commit(candidate,base,new Map([[path,mode]]));assert.equal(classify(pages(next),context(next)),'pre03');}
 const moved=new Map(candidate);moved.delete(path);moved.set(path.replace('.sql','_renamed.sql'),candidate.get(path));const next=commit(moved,base);assert.equal(classify(pages(next),context(next)),'pre03');
});
test('tampered base receipts cannot manufacture a qualification',()=>{
 const forgedBase=new Map(baseline),forgedHead=new Map(candidate);
 const receipt=JSON.parse(baseline.get(receiptPath));receipt.producer.conclusion='failure';const bytes=Buffer.from(JSON.stringify(receipt));
 forgedBase.set(receiptPath,bytes);forgedHead.set(receiptPath,bytes);const b=commit(forgedBase),h=commit(forgedHead,b);
 assert.equal(classify(pages(h,b),context(h,b)),'pre03');
 const noPolicyBase=new Map(baseline);noPolicyBase.delete(policyPath);const missing=commit(noPolicyBase),introduced=commit(candidate,missing);
 assert.equal(classify(pages(introduced,missing),context(introduced,missing)),'pre03');
});
