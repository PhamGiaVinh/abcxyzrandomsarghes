// Component-level native proof only; not canonical Cashier acceptance.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateContainerIdentity} from './operations-lock-diagnostics.mjs';

const [container,file]=process.argv.slice(2);
assert.match(container??'',/^[a-f0-9]{12,64}$/);
const inspected=spawnSync('docker',['inspect',container,'--format','{{.Name}}'],{encoding:'utf8'});
assert.equal(inspected.status,0);validateContainerIdentity(container,inspected.stdout.trim());
assert.ok(file?.endsWith('-http.json'));
const args=['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-U','postgres'];
const sql=(query,database='spectator_contention_contract')=>{
 const r=spawnSync('docker',[...args,'-d',database],{input:query,encoding:'utf8',timeout:10000});
 const state=r.stderr?.match(/ERROR:\s+([0-9A-Z]{5})/)?.[1]??'unclassified';
 assert.equal(r.status,0,'Owned native component SQL failed: '+state);return r.stdout.trim();
};
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='postgres'",'postgres'),'vinpoker-operational-schema-fence-disposable');
assert.equal(sql("SELECT count(*) FROM pg_database WHERE datname='spectator_contention_contract'",'postgres'),'0');
sql('CREATE DATABASE spectator_contention_contract','postgres');
const source=name=>readFileSync(new URL('../../supabase/'+name,import.meta.url),'utf8').replace(/\r/g,'');
const base=source('pending-migrations/20270115000000_public_spectator_realtime_v2.sql');
const compact=source('migrations/20261104001900_public_spectator_compact_generations.sql');
const live=source('pending-migrations/20270115000001_public_spectator_live_display.sql');
const extract=(text,header)=>{
 const start=text.indexOf(header);assert.ok(start>=0,header);
 const tail=text.slice(start),end=tail.match(/\nEND;?\s*\$\$;/);assert.ok(end,header);
 return tail.slice(0,end.index+end[0].length);
};
const mark=extract(compact,'CREATE OR REPLACE FUNCTION spectator_projection_v2.mark_dirty(');
const claim=extract(live,'CREATE OR REPLACE FUNCTION public.claim_public_spectator_projection_v2(');
const schema=base.slice(base.indexOf('CREATE SCHEMA'),base.indexOf('CREATE OR REPLACE FUNCTION spectator_projection_v2.mark_dirty('));
sql(`DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role;END IF;END $$;
 CREATE TABLE public.tournaments(id uuid PRIMARY KEY);
 CREATE SCHEMA auth;CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT current_setting(''request.jwt.claim.role'',true)';
 ${schema}
 ALTER TABLE spectator_projection_v2.entity_markers ADD COLUMN source_txid xid8;
 CREATE TABLE spectator_projection_v2.deferred_generations_v1(tournament_id uuid,component text,source_txid xid8 DEFAULT pg_current_xact_id(),changed_at timestamptz DEFAULT clock_timestamp(),PRIMARY KEY(tournament_id,component,source_txid));
 ${mark}\n${claim}
 REVOKE ALL ON FUNCTION spectator_projection_v2.mark_dirty(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION spectator_projection_v2.mark_dirty(uuid,text,text,text) TO service_role;
 INSERT INTO public.tournaments VALUES('a3000000-0000-4000-8000-000000000004');
 SELECT spectator_projection_v2.mark_dirty('a3000000-0000-4000-8000-000000000004','tables','generation','component');`);
const report={kind:'ACTUAL_SOURCE_MARK_DIRTY_AND_CLAIM_NATIVE_CONTENTION_COMPONENT_ONLY',phase:'running',sourceSha256:{mark:createHash('sha256').update(mark).digest('hex'),claim:createHash('sha256').update(claim).digest('hex')},cases:[],qualification:false,productionChanged:false,limits:'Exact source mark_dirty and claim functions on PostgreSQL with minimal canonical projection tables and synthetic auth context. Not full captured schema, actual publisher, original caught SQLSTATE, money conservation or production proof.'};
// Preserve PostgreSQL regex escapes when sending the exception-frame query.
const probe=String.raw`BEGIN;SET LOCAL lock_timeout='250ms';SET LOCAL statement_timeout='2s';
 DO $probe$ DECLARE code text:='00000';ctx text;frames jsonb:='[]';BEGIN
 BEGIN PERFORM spectator_projection_v2.mark_dirty('a3000000-0000-4000-8000-000000000004','tables','generation','component');
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE,ctx=PG_EXCEPTION_CONTEXT;
 SELECT coalesce(jsonb_agg(jsonb_build_object('function',m[1],'line',m[2]::integer)),'[]') INTO frames FROM regexp_matches(ctx,'PL/pgSQL function ([a-zA-Z0-9_.]+)\([^)]*\) line ([0-9]+)','g')m;
 END;PERFORM set_config('test.contention_result',jsonb_build_object('sqlstate',code,'frames',frames,
 'deferred',(SELECT count(*) FROM spectator_projection_v2.deferred_generations_v1 WHERE source_txid=pg_current_xact_id()))::text,true);END $probe$;
 SELECT current_setting('test.contention_result');ROLLBACK;`;
try{
 for(const version of ['baseline','candidate']){
 if(version==='candidate')sql(source('migrations/20270128000342_nonblocking_spectator_source_generation.sql'));
 for(const mode of ['uncontended','claim','marker']){
  let child,exit,lines;
  try{
   if(mode!=='uncontended'){
    child=spawn('docker',[...args,'-d','spectator_contention_contract'],{stdio:['pipe','pipe','pipe']});
    child.stderr.resume();exit=new Promise(resolve=>child.once('exit',code=>resolve(code)));
    lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
    const lock=mode==='claim'?"SELECT jsonb_array_length(public.claim_public_spectator_projection_v2(50));":"SELECT 1 FROM spectator_projection_v2.entity_markers FOR UPDATE;";
    child.stdin.write("BEGIN;SET LOCAL idle_in_transaction_session_timeout='5s';SET LOCAL request.jwt.claim.role='service_role';"+lock+'\n');
    let timer;try{const ready=await Promise.race([lines.next(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Native blocker readiness expired')),3000);})]);assert.equal(ready.done,false);assert.equal(ready.value,'1');}finally{clearTimeout(timer);}
   }
   const start=performance.now(),value=JSON.parse(sql(probe));
   report.cases.push({version,mode,...value,elapsedMs:performance.now()-start});
   assert.equal(value.sqlstate,version==='candidate'||mode==='uncontended'?'00000':'55P03');
   assert.equal(value.deferred,version==='candidate'&&mode!=='uncontended'?1:0);
   if(version==='baseline'&&mode!=='uncontended')assert.ok(value.frames.some(f=>f.function.includes('mark_dirty')));
  }finally{
   if(child){child.stdin.end('ROLLBACK;\n');let timer;try{const code=await Promise.race([exit,new Promise(resolve=>{timer=setTimeout(()=>resolve(-1),3000);})]);if(code===-1)child.kill();assert.equal(code,0,'Native blocker rollback failed');}finally{clearTimeout(timer);}}
  }
 }
 }
 assert.equal(sql("SELECT source_revision FROM spectator_projection_v2.entity_markers"),'1');
 assert.equal(sql('SELECT attempts FROM spectator_projection_v2.work_groups'),'0');
 assert.equal(sql('SELECT count(*) FROM spectator_projection_v2.deferred_generations_v1'),'0');
 assert.equal(sql("SELECT original_body_md5 FROM spectator_projection_v2.source_nonblocking_original_v1"),'76e70967db6247ba01fc6d1e9f8355e9');
 const candidateDefinition=sql("SELECT pg_get_functiondef('spectator_projection_v2.mark_dirty(uuid,text,text,text)'::regprocedure)");
 sql("DO $$ BEGIN EXECUTE (SELECT definition FROM spectator_projection_v2.source_nonblocking_original_v1);END $$;");
 assert.equal(sql("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='spectator_projection_v2.mark_dirty(uuid,text,text,text)'::regprocedure"),'76e70967db6247ba01fc6d1e9f8355e9');
 sql(candidateDefinition);
 assert.equal(sql("SELECT md5(replace(prosrc,chr(13),''))=(SELECT candidate_body_md5 FROM spectator_projection_v2.source_nonblocking_original_v1) FROM pg_proc WHERE oid='spectator_projection_v2.mark_dirty(uuid,text,text,text)'::regprocedure"),'t');
 report.nativeForwardRestoreVerified=true;
 report.phase='passed';report.allProbeWritesRolledBack=true;
}catch(error){report.phase='failed';throw error;}
finally{writeFileSync(file,JSON.stringify(report,null,2));}
