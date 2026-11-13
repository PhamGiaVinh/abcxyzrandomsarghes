import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {qualifyFloor345} from './select-floor345-runtime.mjs';
const policyPath='VinPoker/scripts/ops/floor345-runtime-scope.json';
const selectorPath='VinPoker/scripts/ops/select-floor345-runtime.mjs';
const workflow='.github/workflows/dealer-checkin-current-schema.yml';
const sql='VinPoker/supabase/migrations/20270128000345_floor_operator_fast_bust_v1.sql';
const catalog='VinPoker/supabase/migration-archive/catalog.json';
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(mutate=()=>{},baseCatalog='reviewed catalog',baseWorkflow='retained runtime'){
 const repo=mkdtempSync(join(tmpdir(),'floor345-scope-'));
 const git=(...a)=>execFileSync('git',['-C',repo,...a],{stdio:['ignore','pipe','pipe']}).toString().trim();
 const written=new Set();
 const put=(p,s)=>{written.add(p);const f=join(repo,p);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,s);};
 git('init','-q');git('config','user.email','test@example.invalid');git('config','user.name','Isolated test');
 const policy={kind:'EXACT_FLOOR345_CURRENT_RUNTIME_NOT_HISTORICAL',historicalCoverage:false,pr:1638,
  guards:[policyPath,selectorPath],files:[{path:sql,status:'A',sha256:hash('reviewed migration')},
   {path:catalog,status:'M',sha256:hash('catalog plus345'),preimageSha256:hash('reviewed catalog')}],
  integrationWorkflow:{path:workflow,sha256:hash('reviewed integration'),preimageSha256:hash('retained runtime')}};
 put(policyPath,JSON.stringify(policy));put(selectorPath,'protected validator');put(workflow,baseWorkflow);put(catalog,baseCatalog);
 git('add',policyPath,selectorPath,workflow,catalog);git('commit','-qm','protected base');const base=git('rev-parse','HEAD');
 put(sql,'reviewed migration');put(catalog,'catalog plus345');put(workflow,'reviewed integration');mutate({put,git,repo});
 git('add','--',...written);git('commit','-qm','candidate');return {repo,base,head:git('rev-parse','HEAD'),pr:1638};
}
test('only exact package and exact reviewed integration qualify from protected base',()=>assert.equal(qualifyFloor345(fixture()),true));
for(const [label,mutate] of [
 ['extra SQL',({put})=>put('VinPoker/supabase/migrations/999_extra.sql','not approved')],
 ['source drift',({put})=>put(sql,'changed migration')],
 ['workflow drift',({put})=>put(workflow,'skip required runtime')],
 ['self-approved policy',({put})=>put(policyPath,'{}')],
 ['changed checker',({put})=>put(selectorPath,'console.log("floor345")')],
 ['missing integration',({put})=>put(workflow,'retained runtime')],
])test(`rejects ${label}`,()=>assert.throws(()=>qualifyFloor345(fixture(mutate))));
test('different PR cannot reuse the exception',()=>assert.throws(()=>qualifyFloor345({...fixture(),pr:1634})));
test('new protected-base catalog entries cannot be overwritten by the old postimage',()=>assert.throws(()=>qualifyFloor345(fixture(()=>{},'reviewed catalog plus later main entry'))));
test('new protected-base legacy gates cannot be overwritten by an old integration',()=>assert.throws(()=>qualifyFloor345(fixture(()=>{},'reviewed catalog','retained runtime plus later safety gate'))));

 test('proposed routing preserves every existing legacy runtime step',()=>{
 const old=readFileSync(new URL('../../../.github/workflows/dealer-checkin-current-schema.yml',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const next=readFileSync(new URL('./floor345-runtime-integration.yml',import.meta.url),'utf8');
 const oldBody=old.split('jobs:\n  runtime:\n')[1];
 const marker="  legacy-runtime:\n    needs: select-floor345\n    if: needs.select-floor345.outputs.mode != 'floor345'\n";
 assert.ok(oldBody&&next.includes(marker));assert.equal(next.split(marker)[1],oldBody);
 assert.match(next,/if: always\(\)/);assert.match(next,/test "\$FLOOR345_RESULT" = success/);
 });
