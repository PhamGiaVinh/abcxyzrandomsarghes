// Transport only: release controllers still own approval, recovery and receipts.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const PROJECT='orlesggcjamwuknxwcpk';
export function validateProductionConnection(env=process.env){
 if(env.TRACKER_HUD_TRANSPORT==='management'){
  assert.equal(env.SUPABASE_PROJECT_REF,PROJECT,'Exact management project required');
  assert.ok(env.SUPABASE_ACCESS_TOKEN,'Private management credential required');
  return 'management';
 }
 assert.ok(!env.TRACKER_HUD_TRANSPORT||env.TRACKER_HUD_TRANSPORT==='psql','Unknown production transport');
 assert.equal(env.PGHOST,`db.${PROJECT}.supabase.co`);assert.equal(env.PGPORT,'5432');
 assert.equal(env.PGUSER,'postgres');assert.equal(env.PGDATABASE,'postgres');
 assert.equal(env.PGSSLMODE,'require');assert.ok(env.PGPASSWORD,'Private connection required');
 return 'psql';
}
export function scalarRows(rows){
 assert.ok(Array.isArray(rows),'Management response must be rows');
 return rows.map(row=>{
  assert.ok(row&&typeof row==='object'&&!Array.isArray(row),'Invalid management row');
  const values=Object.values(row);assert.equal(values.length,1,'Release query must return one column');
  const value=values[0];assert.ok(value===null||['string','number','boolean'].includes(typeof value),'Non-scalar release result');
  return value===null?'':String(value);
 }).join('\n').trim();
}
export async function managementQuery(sql,env=process.env,request=fetch){
 assert.equal(validateProductionConnection(env),'management');
 assert.ok(typeof sql==='string'&&sql.trim(),'SQL required');
 // The identity check and caller SQL share one server request. Never redirect
 // credentials, accept an arbitrary endpoint, retry or print server contexts.
 const identity="DO $hud_transport_identity$ BEGIN IF current_user<>'postgres' OR current_database()<>'postgres' THEN RAISE EXCEPTION 'production_transport_identity_differs';END IF;END $hud_transport_identity$;\n";
 const response=await request(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`,{
  method:'POST',redirect:'error',headers:{Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},
  body:JSON.stringify({query:identity+sql}),signal:AbortSignal.timeout(150000)
 });
 assert.ok(response.ok,'Private database command failed; no automatic retry');
 return scalarRows(await response.json());
}
export function productionQuery(sql){
 const mode=validateProductionConnection();
 const p=mode==='management'
  ?spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--management-query'],{input:sql,encoding:'utf8',maxBuffer:1024*1024,timeout:155000})
  :spawnSync(process.env.PSQL_BIN||'psql',['-X','-qAt','-w','-v','ON_ERROR_STOP=1','-f','-'],{input:sql,encoding:'utf8',maxBuffer:1024*1024});
 if(p.error||p.status!==0)throw Error('Private database command failed; inspect privately; no automatic retry');
 return p.stdout.trim();
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{assert.equal(process.argv[2],'--management-query');process.stdout.write(await managementQuery(readFileSync(0,'utf8')));}
 catch{console.error('Private management query failed; no automatic retry');process.exitCode=1;}
}
