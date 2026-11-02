import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import ts from 'typescript';
assert.equal(process.env.VINPOKER_PARTICIPATION1055_LOCAL,'1');const report='D:/Quy trình/output/reports/participation1055-public-parser-native-local-20261027.json';assert.equal(existsSync(report),false);
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_ranking860_local|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
const hash=()=>sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='floor_private.tournament_participation_v1(uuid)'::regprocedure;");assert.equal(hash(),'b9624adaa8d7bb35713917486c40fe67');
const tours=['782a5196-5ea1-44ed-8a27-1b872d5f88d9','fdf91018-09f3-4cdc-b76a-f688eb216cee','4cd3af4d-7e1d-4042-855f-04fb6777e580'];
const read=tour=>"SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{\"sub\":\"675fe35e-60a8-4452-bb90-e79486d54da6\",\"role\":\"authenticated\"}';SET LOCAL ROLE authenticated;SELECT public.get_tournament_participation_v1('"+tour+"');RESET ROLE;";
const values=sql("BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='15s';"+tours.map(read).join('')+readFileSync('supabase/migrations/20270128000299_participation_bagged_read_classification_v1.sql','utf8')+tours.map(read).join('')+'ROLLBACK;').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const load=path=>{const compiled=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;const mod={exports:{}};new Function('exports','module',compiled)(mod.exports,mod);return mod.exports.parseTournamentParticipation;};
const legacy=load('D:/Quy trình/output/reports/participation1053-before-client-local-20261027.ts'),current=load('src/lib/tournamentParticipation.ts');
assert.equal(values.length,6);const rows=[];
for(let i=0;i<values.length;i++){
 const tour=tours[i%3];let legacyAccepted=true,legacyError=null;
 try{legacy(values[i],tour);}catch(error){legacyAccepted=false;legacyError=error.message;}
 const parsed=current(values[i],tour);const afterCandidate=i>=3;
 assert.equal(legacyAccepted,!afterCandidate||i%3===2);
 rows.push({tour,phase:afterCandidate?'CANDIDATE':'BASELINE',legacyAccepted,legacyError,currentAccepted:true,entryCount:parsed.entries.length,bagged:parsed.entries.filter(e=>e.participation_status==='bagged').length,waiting:parsed.entries.filter(e=>e.participation_status==='waiting').length});
}
const restored=hash();assert.equal(restored,'b9624adaa8d7bb35713917486c40fe67');writeFileSync(report,JSON.stringify({kind:'NATIVE_PUBLIC_DTO_LEGACY_AND_CURRENT_PARSER_COMPATIBILITY_CLONE_ROLLBACK_NOT_DEPLOYMENT',rows,restoredBodyMd5:restored},null,2));console.log('PARTICIPATION1055_COMPATIBILITY_CURRENT_BOTH_LEGACY_REJECTS_NEW_BAGGED_DTO_ROLLBACK_PASS');
