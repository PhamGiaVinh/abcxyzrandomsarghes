import {createHash} from 'node:crypto';
import {readFileSync,statSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Exact missing-tour identifiers observed read-only on 2026-11-16; no player IDs.
export const wantedHashes=Object.freeze([
 'b1a08f80b99b1042afd5770a31c3f008d5f5d9e97eb637dcc0cc754df315173f',
 '5c2fd478eddc24d2ebe91454a785bfbc8f6eb1e32466324525aa4f710821e7a6',
 '965c6e7d88b9322b7ae69d251873cfb29c43e704494d8f4d6920437f82de5278',
]);
const hash=value=>createHash('sha256').update(value).digest('hex');
export function inspectTournamentCopy(sql,targets=wantedHashes){
 if(targets.length!==3||new Set(targets).size!==3||targets.some(v=>!(/^[a-f0-9]{64}$/u.test(v))))throw Error('TARGET_SCOPE_INVALID');
 let columns=null,opened=0,closed=0,rows=0;
 const matches=[];
 for(const line of sql.split(/\r?\n/u)){
  if(line.startsWith('COPY ')){
   const m=line.match(/^COPY public\.tournaments \(([^)]+)\) FROM stdin;$/u);
   if(!m||columns||opened++)throw Error('TABLE_SCOPE_INVALID');
   columns=m[1].split(', ').map(v=>v.replace(/^"|"$/gu,''));
   if(new Set(columns).size!==columns.length||!['id','name','status'].every(v=>columns.includes(v)))throw Error('COLUMNS_INVALID');
   continue;
  }
  if(!columns)continue;
  if(line==='\\.'){columns=null;closed++;continue;}
  const cells=line.split('\t');
  if(cells.length!==columns.length)throw Error('COPY_ROW_INVALID');
  const id=cells[columns.indexOf('id')];
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(id))throw Error('IDENTIFIER_INVALID');
  rows++;
  const idHash=hash(id);
  if(!targets.includes(idHash))continue;
  if(matches.some(v=>v.idHash===idHash))throw Error('DUPLICATE_TARGET');
  matches.push({idHash,rowSha256:hash(line),hasName:!['','\\N'].includes(cells[columns.indexOf('name')]),hasStatus:!['','\\N'].includes(cells[columns.indexOf('status')])});
 }
 if(opened!==1||closed!==1||columns)throw Error('COPY_INCOMPLETE');
 return {kind:'MISSING_TOUR_BACKUP_METADATA_ONLY',scannedTable:'public.tournaments',rowsScanned:rows,targets:targets.length,found:matches.length,matches,missingHashes:targets.filter(v=>!matches.some(m=>m.idHash===v)),sqlExecuted:false,productionMutated:false,fullRestoreCertified:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [input,output]=process.argv.slice(2);
  if(!input||!output||statSync(input).size>32*1024*1024)throw Error('INPUT_INVALID');
  writeFileSync(output,JSON.stringify(inspectTournamentCopy(readFileSync(input,'utf8')),null,2),{mode:0o600});
  console.log('MISSING_TOUR_BACKUP_INSPECTION_COMPLETE');
 }catch{console.error('MISSING_TOUR_BACKUP_INSPECTION_FAILED; private source withheld');process.exitCode=1;}
}
