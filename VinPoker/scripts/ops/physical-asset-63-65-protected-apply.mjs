import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContext,psqlEnvironment } from './floor-37-47-protected-apply.mjs';
import { preflightSql,classifyPreflight,executePackage } from './physical-asset-63-65-release-plan.mjs';
export function validateRelease(env,recovery,checkoutSha,mode) {
  if (!['plan','apply'].includes(mode)) throw Error('Protected plan|apply only');
  validateContext(env,recovery);
  if (checkoutSha!==env.RELEASE_SHA) throw Error('Checkout SHA differs');
  if (mode==='apply' && env.CONFIRM_FLOOR_PACKAGE!==`APPLY_PHYSICAL_ASSET_63_65_${env.RELEASE_SHA}`)
    throw Error('Exact63+65 confirmation missing');
}
export function runProtected(mode,transport,report=()=>{}) {
  classifyPreflight(transport.json(preflightSql()));
  if (mode==='plan') {report('EXACT_PHYSICAL_ASSET_63_65_PENDING');return;}
  if (mode!=='apply') throw Error('Protected plan|apply only');
  executePackage(transport,report);
}
function main() {
  if (process.argv.length!==3) throw Error('One mode required');
  const mode=process.argv[2];
  const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
  if(head.status!==0) throw Error('Checkout SHA unavailable');
  const recovery=JSON.parse(readFileSync(process.env.RECOVERY_RECEIPT_PATH,'utf8'));
  validateRelease(process.env,recovery,head.stdout.trim(),mode);
  const query=input=>{
    const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',
      env:psqlEnvironment(process.env),maxBuffer:2*1024*1024,timeout:130000});
    if(r.status!==0) throw Error('psql failed; raw output withheld');
    return r.stdout.trim();
  };
  runProtected(mode,{execute:query,json:input=>JSON.parse(query(input).split('\n').find(line=>line.startsWith('{')))},line=>console.log(line));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { main(); } catch {
    console.error('Protected asset63+65 failed; inspect exact receipts, do not retry blindly');
    process.exitCode=1;
  }
}
