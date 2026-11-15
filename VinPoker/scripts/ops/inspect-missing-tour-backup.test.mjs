import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inspectTournamentCopy} from './inspect-missing-tour-backup.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SOURCE,VERSION,preload} from '../deploy/preload-postgres-dump-image.mjs';
const ids=['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003'];
const targets=ids.map(v=>createHash('sha256').update(v).digest('hex'));
const copy=rows=>'-- pg_restore data only\nCOPY public.tournaments (id, name, status) FROM stdin;\n'+rows.join('\n')+'\n\\.\n';
test('finds only exact targets and emits hashes/booleans, never private values',()=>{
 const sql=copy([ids[0]+'\tPRIVATE NAME\\tESCAPED\tfinished','00000000-0000-0000-0000-000000000099\tOTHER\tactive',ids[2]+'\t\\N\t\\N']);
 const r=inspectTournamentCopy(sql,targets);assert.equal(r.found,2);assert.equal(r.rowsScanned,3);assert.equal(r.matches[1].hasName,false);assert.equal(r.sqlExecuted,false);
 for(const value of [ids[0],'PRIVATE NAME','OTHER','finished'])assert.ok(!JSON.stringify(r).includes(value));
 assert.equal(r.missingHashes[0],targets[1]);
});
test('empty real table proves no match without inventing metadata',()=>{assert.equal(inspectTournamentCopy(copy([]).replace('\n\n\\.','\n\\.'),targets).found,0);});
test('rejects wrong table, duplicate targets, malformed/incomplete COPY and scope drift',()=>{
 for(const sql of [copy([ids[0]+'\tA\tactive',ids[0]+'\tB\tactive']),copy(['invalid\tA\tactive']),copy([ids[0]+'\tA']),copy([]).replace('public.tournaments','public.profiles'),copy([ids[0]+'\tA\tactive']).replace('\\.',''),copy([ids[0]+'\tA\tactive'])+copy([])])assert.throws(()=>inspectTournamentCopy(sql,targets));
 assert.throws(()=>inspectTournamentCopy(copy([]),targets.slice(1)));
});
test('decodes an actual PostgreSQL custom archive offline without executing its SQL',{skip:!process.env.MISSING_TOUR_PG_CONTAINER},()=>{
 const container=process.env.MISSING_TOUR_PG_CONTAINER;
 assert.match(container,/^[a-f0-9]{12,64}$/u);
 const work=mkdtempSync(join(tmpdir(),'missing-tour-copy-'));
 try{
  execFileSync('docker',['exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:`CREATE TABLE public.tournaments(id uuid PRIMARY KEY,name text,status text); INSERT INTO public.tournaments VALUES ('${ids[0]}',E'PRIVATE\\tNAME','finished'),('${ids[1]}','Tiếng Việt','active');`,stdio:['pipe','pipe','pipe']});
  const dump=execFileSync('docker',['exec',container,'pg_dump','-U','postgres','-d','postgres','--format=custom','--table=public.tournaments']);
  writeFileSync(join(work,'database.dump'),dump,{mode:0o600});
  preload(VERSION);
  const sql=execFileSync('docker',['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user',`${process.getuid()}:${process.getgid()}`,'--entrypoint','pg_restore','--mount',`type=bind,src=${work},dst=/recovery,readonly`,SOURCE,'--data-only','--schema=public','--table=tournaments','--file=-','/recovery/database.dump'],{encoding:'utf8'});
  const result=inspectTournamentCopy(sql,targets);assert.equal(result.found,2);assert.equal(result.rowsScanned,2);assert.equal(result.sqlExecuted,false);
 }finally{rmSync(work,{recursive:true,force:true});}
});
