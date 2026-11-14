import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {validateContext} from './floor-37-47-protected-apply.mjs';
import {MANIFEST_SHA256} from './spectator342344-release-plan.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
export function ledgerIdentity(rows){
 assert.ok(Array.isArray(rows)&&rows.length>0);
 const seen=new Set();
 for(const row of rows){
  assert.match(row.version,/^\d{14}$/);
  assert.ok(row.name===null||typeof row.name==='string');
  assert.ok(!seen.has(row.version),'Duplicate ledger version');seen.add(row.version);
 }
 return sha(JSON.stringify([...rows].sort((a,b)=>a.version.localeCompare(b.version)).map(r=>[r.version,r.name])));
}
export function validateLedger(rows,manifest,sourceRoot){
 assert.equal(rows.length,manifest.ledger.rows,'Live ledger row count drift');
 assert.equal(ledgerIdentity(rows),manifest.ledger.identitySha256,'Live ledger identity drift');
 const catalog=JSON.parse(readFileSync(resolve(sourceRoot,'supabase/migration-archive/floor-v3-catalog-reconciliation.manifest.json')));
 const key=(version,name)=>JSON.stringify([version,name]);
 const known=new Set(catalog.remoteLedgerVersions.map(x=>key(x.version,x.name)));
 function walk(dir){
  for(const item of readdirSync(dir,{withFileTypes:true})){
   assert.ok(!item.isSymbolicLink(),'Source catalog symlink rejected');
   if(item.isDirectory())walk(resolve(dir,item.name));
   else{
    const match=item.name.match(/^(\d{14})_(.+)\.sql$/);
    if(match)known.add(key(match[1],match[2]));
   }
  }
 }
 walk(resolve(sourceRoot,'supabase'));
 for(const row of rows)assert.ok(known.has(key(row.version,row.name)),'Unmapped live version/name');
 // Catalog-known historical aliases are identity evidence, not recovered
 // original schema or proof that every old statement equals today's source.
 return {rows:rows.length,identitySha256:manifest.ledger.identitySha256};
}
export function validateApproval(mode,env,recovery,observed,manifest,now=Date.now()){
 assert.ok(['plan','apply'].includes(mode));
 validateContext(env,recovery,now);
 assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');
 assert.equal(env.GITHUB_REPOSITORY,'PhamGiaVinh/abcxyzrandomsarghes');
 assert.equal(env.REPOSITORY_OWNER,'PhamGiaVinh');
 assert.equal(env.MANIFEST_SHA256,MANIFEST_SHA256);
 assert.equal(env.RELEASE_SHA,manifest.referenceProductSha,'Only exact qualified source allowed');
 assert.equal(env.SOURCE_PR,'1646');
 assert.equal(env.SOURCE_PR_BASE_SHA,env.GITHUB_SHA);
 assert.equal(observed.controllerSha,env.GITHUB_SHA);
 assert.equal(observed.sourceSha,env.RELEASE_SHA);
 assert.equal(recovery.databaseOwnerAndEffectiveAclMatch,true);
 if(mode==='apply')assert.equal(env.CONFIRM_SPECTATOR_PACKAGE,`APPLY_SPECTATOR_342_344_${env.RELEASE_SHA}`);
}
