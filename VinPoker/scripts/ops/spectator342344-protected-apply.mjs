import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadPackage} from './spectator342344-release-plan.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';

const hash=(text,algorithm='sha256')=>createHash(algorithm).update(text).digest('hex');
const marker='spectator_projection_v2.mark_dirty(uuid,text,text,text)';
const source='public.get_public_spectator_projection_source_v2(uuid,text,uuid)';
const batch='public.get_public_spectator_projection_sources_v2(jsonb)';
const metadata=sig=>`COALESCE((SELECT proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[] AND proacl::text='{postgres=X/postgres,service_role=X/postgres}' FROM pg_proc WHERE oid=to_regprocedure('${sig}')),false)`;

export function postcheckSql(pkg,phase){
 assert.ok([342,343,344].includes(phase));
 const body=pkg.entries[2].source.split('$source_batch$')[1];
 assert.ok(body,'Reviewed batch body delimiter required');
 const recoveries=['source_nonblocking_original_v1',...(phase>=343?['source_pending_original_v1']:[])];
 return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object(
 'marker',${metadata(marker)} AND EXISTS(SELECT 1 FROM spectator_projection_v2.source_nonblocking_original_v1 WHERE original_body_md5='76e70967db6247ba01fc6d1e9f8355e9' AND candidate_body_md5=(SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('${marker}'))),
 'source',${metadata(source)} AND md5(replace(pg_get_functiondef(to_regprocedure('${source}')),chr(13),''))='${phase>=343?'6269d9fc1b2737f30b56a4bcdb42fb79':'0557076e4866159dc1095c5257ceb7c6'}',
 'batch',${phase>=344?`${metadata(batch)} AND COALESCE((SELECT md5(prosrc)='${hash(body,'md5')}' AND provolatile='s' AND prorettype='jsonb'::regtype AND NOT proretset FROM pg_proc WHERE oid=to_regprocedure('${batch}')),false)`:`to_regprocedure('${batch}') IS NULL`},
 'recovery',COALESCE((SELECT count(*)=${recoveries.length} AND bool_and(c.relowner='postgres'::regrole AND c.relrowsecurity AND NOT has_table_privilege('anon',c.oid,'SELECT') AND NOT has_table_privilege('authenticated',c.oid,'SELECT') AND NOT has_table_privilege('service_role',c.oid,'SELECT')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='spectator_projection_v2' AND c.relname IN (${recoveries.map(n=>`'${n}'`).join(',')})),false))::text;COMMIT;`;
}
export function classifyPostcheck(row){
 assert.ok(row?.marker===true&&row.source===true&&row.batch===true&&row.recovery===true,'Affected object/ACL postcheck failed');
}
export function pausedSql(){
 return `BEGIN READ ONLY;SELECT json_build_object('paused',
 (SELECT count(*)=1 AND bool_and(jobid=52 AND NOT active AND schedule='1 second' AND database='postgres' AND username='postgres' AND md5(command)='6a58054106472023a5314bd491f485da') FROM cron.job WHERE jobname='public-spectator-v2-dispatch'),
 'hudPreserved',(SELECT count(*)=1 AND bool_and(jobid=55 AND active AND schedule='1 second' AND database='postgres' AND username='postgres' AND md5(command)='91fa9918a394fedb11200da51cd02dc9') FROM cron.job WHERE jobname='public-hud-projection-v1-dispatch'),
 'leasesDrained',NOT EXISTS(SELECT 1 FROM spectator_projection_v2.work_groups WHERE claimed_until>clock_timestamp()))::text;COMMIT;`;
}
export function classifyPaused(row){
 assert.ok(row?.paused===true&&row.hudPreserved===true&&row.leasesDrained===true,'Dispatcher/lease precondition failed');
}

// The protected workflow must validate recovery, source identity, catalog and
// connection, pause the dispatcher, and drain in-flight requests before calling.
// No pause, resume, retry, rollback or downstream deployment occurs here.
export function executePackage(sourceRoot,transport,report=()=>{}){
 const pkg=loadPackage(sourceRoot);
 for(const entry of pkg.entries){
  const item={...entry,hash:entry.sha256};
  assert.equal(hash(entry.atomic),entry.atomicSha256);
  try{
   classifyPaused(transport.json(pausedSql()));
   transport.execute(entry.atomic);
   const receipt=transport.json(receiptSql(item));
   assert.ok(receipt.count===1&&receipt.exact===true,'Receipt drift');
   classifyPostcheck(transport.json(postcheckSql(pkg,Number(entry.version.slice(-3)))));
  }catch{
   const observed=[];
   for(const candidate of pkg.entries){
    let receipt='unavailable';
    try{
     const row=transport.json(receiptSql({...candidate,hash:candidate.sha256}));
     receipt=row.count===1&&row.exact===true?'committed-exact':row.count===0?'not-recorded':'drift';
    }catch{}
    observed.push({version:candidate.version,receipt});
   }
   const committed=observed.filter(x=>x.receipt==='committed-exact');
   const phase=committed.length?Number(committed.at(-1).version.slice(-3)):null;
   let objects='not-inspected';
   if(phase!==null){
    try{classifyPostcheck(transport.json(postcheckSql(pkg,phase)));objects='verified';}catch{objects='not-verified';}
   }
   report({kind:'STOP_NO_RETRY_NO_RESUME',failedAt:entry.version,observed,currentObjectPhase:phase,objects});
   throw Error('Spectator release requires partial-outcome review');
  }
  report({kind:'COMMITTED_EXACT_OBJECTS_VERIFIED',version:entry.version,sha256:entry.sha256});
 }
 return {kind:'SPECTATOR342344_DATABASE_VERIFIED',dispatcherStillPaused:true};
}
