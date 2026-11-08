// Bounded administrative certification only; never a public HUD request.
import assert from 'node:assert/strict';
import {shadowSql,createShadow,loadClassifier} from './tracker-hud-shadow.mjs';
import {productionQuery,validateProductionConnection,managementWireSql} from './tracker-hud-production-query.mjs';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

export function managementShadowSql(){
 const start=shadowSql.indexOf('\nSELECT ');assert.ok(start>0);
 assert.ok(shadowSql.endsWith(';ROLLBACK;'));
 const queries=shadowSql.slice(start+1,-'ROLLBACK;'.length).split(/;\r?\n(?=SELECT )/).map(q=>q.trim().replace(/;$/,''));
 assert.equal(queries.length,6,'Canonical shadow stream changed');
 const prefix=shadowSql.slice(0,start).replace("statement_timeout='60min'","statement_timeout='120s'");
 // This transport must cover the entire source, or refuse before reading it.
 // Larger administrative audits retain the existing streaming psql CLI.
 const bound=`DO $hud_shadow_api_bound$ BEGIN
 IF EXISTS(SELECT 1 FROM public.tournament_hands OFFSET 1000 LIMIT 1)
 OR EXISTS(SELECT 1 FROM public.player_results OFFSET 1000 LIMIT 1)
 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.hand_contributions OFFSET 10000 LIMIT 1)
 THEN RAISE EXCEPTION 'full_shadow_requires_direct_streaming_transport';END IF;
 END $hud_shadow_api_bound$;\n`;
 const ctes=queries.map((q,i)=>`shadow_phase_${i}(value) AS (${q})`).join(',\n');
 const rows=queries.map((_,i)=>`SELECT ${i} AS phase,value FROM shadow_phase_${i}`).join('\nUNION ALL\n');
 return prefix+'\n'+bound+'WITH '+ctes+'\nSELECT value::text AS line FROM (\n'+rows+'\n) full_scope ORDER BY phase;\nROLLBACK;';
}
export async function certifyManagementShadow(){
 assert.equal(validateProductionConnection(),'management');
 const root=fileURLToPath(new URL('../..',import.meta.url));
 const sourceSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 assert.match(process.env.TRACKER_HUD_APPROVED_SHA??'',/^[a-f0-9]{40}$/);
 assert.equal(sourceSha,process.env.TRACKER_HUD_APPROVED_SHA);
 assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),'');
 const sql=managementShadowSql(),shadow=createShadow(await loadClassifier());
 const output=productionQuery(sql);
 for(const line of output.split('\n')){
  const row=JSON.parse(line);
  if(row.kind==='header'){
   assert.equal(row.database,'postgres');assert.equal(row.currentUser,'postgres');
   assert.ok(row.serverVersion>=170000&&row.serverVersion<180000);
   shadow.report.target='exact-production-management-api-read-only';
  }
  shadow.accept(row);
 }
 const report=shadow.finish();
 report.sourceSha=sourceSha;
 report.transportSqlSha256=createHash('sha256').update(managementWireSql(sql)).digest('hex');
 report.canonicalManagementSqlSha256=createHash('sha256').update(sql).digest('hex');
 report.transport='bounded-full-scope-management-api';return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  assert.equal(process.argv[2],'--production-read-only');assert.ok(isAbsolute(process.env.TRACKER_HUD_SHADOW_REPORT??''));
  const report=await certifyManagementShadow();
  writeFileSync(process.env.TRACKER_HUD_SHADOW_REPORT,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report));if(!report.complete||!report.passed)process.exitCode=1;
 }catch{console.error('Management shadow certification failed; no activation performed');process.exitCode=1;}
}
