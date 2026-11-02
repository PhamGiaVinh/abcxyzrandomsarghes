// Read-only exact installed Vite hash functions; no server, optimizer, dependency or cache mutation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
assert.equal(process.env.VINPOKER_BOOT1231_LOCAL,'1');
assert.equal(process.cwd().replaceAll('\\','/'),'D:/wt/vinpoker-ops-local-integration/VinPoker');
const output='D:/Quy trình/output/reports/boot1231-cache-key-local-20261028.json';assert.equal(fs.existsSync(output),false);
const sourcePath='node_modules/vite/dist/node/chunks/dep-C6uTJdX2.js',source=fs.readFileSync(sourcePath,'utf8');
assert.equal(JSON.parse(fs.readFileSync('node_modules/vite/package.json','utf8')).version,'5.4.19');
const hash=text=>createHash('sha256').update(text).digest('hex');
const metadataPath='node_modules/.vite/deps/_metadata.json',metadataBefore=fs.readFileSync(metadataPath),metadata=JSON.parse(metadataBefore);
const files=['package-lock.json','bun.lockb','vite.config.ts'];const before=Object.fromEntries(files.map(p=>[p,hash(fs.readFileSync(p))]));
const section=(start,end)=>{const from=source.indexOf(start),to=source.indexOf(end,from);assert.ok(from>=0&&to>from);return source.slice(from,to);};
const code=section('const lockfileFormats = [','function getConfigHash(')+section('function getConfigHash(','function getLockfileHash(')+section('function getLockfileHash(','function getDepHash(');
const observations=[];
for(const manager of [null,'npm']){
 const context={process:{env:manager?{npm_config_user_agent:'npm/DIAGNOSTIC_MODEL'}:{}},fs__default:fs,path$n:path,tryStatSync:p=>{try{return fs.statSync(p);}catch{return undefined;}},getHash:text=>hash(text).slice(0,8),lookupFile:(dir,names)=>{while(dir){for(const name of names){const p=path.join(dir,name);if(fs.existsSync(p)&&fs.statSync(p).isFile())return p;}const parent=path.dirname(dir);if(parent===dir)return;dir=parent;}},getDepOptimizationConfig:config=>config.optimizeDeps,unique:array=>[...new Set(array)],root:process.cwd()};
 const result=runInNewContext(code+`;({lockfileHash:getLockfileHash({root}),order:lockfileNames,configA:getConfigHash({mode:'development',root,resolve:{},plugins:[],optimizeDeps:{},define:{__APP_VERSION__:'1'}}),configB:getConfigHash({mode:'development',root,resolve:{},plugins:[],optimizeDeps:{},define:{__APP_VERSION__:'2'}})})`,context);
 const selected=result.order.find(name=>fs.existsSync(name));assert.equal(result.configA,result.configB);
 observations.push({launchClass:manager?'npm/npx-like':'plain-node',selected,lockfileHash:result.lockfileHash,matchesCurrentCache:result.lockfileHash===metadata.lockfileHash,changingDefineOnlyChangesConfigHash:false,algorithm:'exact installed Vite function bodies; environment/config inputs modeled'});
}
assert.equal(observations[0].selected,'bun.lockb');assert.equal(observations[1].selected,'package-lock.json');assert.notEqual(observations[0].lockfileHash,observations[1].lockfileHash);assert.equal(observations[1].matchesCurrentCache,true);
for(const p of files)assert.equal(hash(fs.readFileSync(p)),before[p]);assert.equal(hash(fs.readFileSync(metadataPath)),hash(metadataBefore));
const result={kind:'DETERMINISTIC_INSTALLED_VITE_CACHE_HASH_DIAGNOSIS_NOT_APP_RUNTIME_FIX',viteVersion:'5.4.19',sourcePath,sourceSha256:hash(source),currentMetadata:{lockfileHash:metadata.lockfileHash,configHash:metadata.configHash},observations,unchangedSourceHashes:before,metadataUnchanged:true,moduleFetchRootCauseProven:false,wholeJourneyAccepted:false};
fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify({observations,metadataUnchanged:true}));
