// Boundary contract for the pending source-only batch experiment. No RPC or
// publication is performed here; all receipts must validate before use.
export interface SourceBatchJob {tournament_id:string;component:string;fencing_token:string}
type RecordValue=Record<string,unknown>;
export type BatchSource={fenced:true}|{tournamentId:string;component:string;sourceVector:Record<string,string>;payload:RecordValue};
export type SourceBatchReceipt={source:BatchSource}|{requiresIndividual:true}|{error:'source_failed';sqlstate:string};
const record=(value:unknown):value is RecordValue=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const exact=(value:RecordValue,keys:string[])=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identity=(job:SourceBatchJob)=>`${job.tournament_id}:${job.component}`;
export function decodeSourceBatch(jobs:SourceBatchJob[],raw:unknown):SourceBatchReceipt[]{
 const invalid=()=>{throw Error('invalid_source_batch_receipt');};
 if(jobs.length<1||jobs.length>6||!Array.isArray(raw)||raw.length!==jobs.length)invalid();
 const expected=new Map<string,SourceBatchJob>();
 for(const job of jobs){
  if(!uuid.test(job.tournament_id)||!uuid.test(job.fencing_token)||!['tables','ranking','payout','visibility'].includes(job.component)||expected.has(identity(job)))invalid();
  expected.set(identity(job),job);
 }
 if(new TextEncoder().encode(JSON.stringify(raw)).byteLength>1048576)invalid();
 const receipts=new Map<string,SourceBatchReceipt>();
 const base=['tournament_id','component','fencing_token'];
 for(const item of raw as unknown[]){
  if(!record(item))invalid();
  const row=item as RecordValue,key=`${row.tournament_id}:${row.component}`,job=expected.get(key);
  if(!job||row.fencing_token!==job.fencing_token||receipts.has(key))return invalid();
  if(exact(row,[...base,'requiresIndividual'])&&row.requiresIndividual===true){receipts.set(key,{requiresIndividual:true});continue;}
  if(exact(row,[...base,'error','sqlstate'])&&row.error==='source_failed'&&typeof row.sqlstate==='string'&&/^[0-9A-Z]{5}$/.test(row.sqlstate)){
   receipts.set(key,{error:'source_failed',sqlstate:row.sqlstate});continue;
  }
  if(!exact(row,[...base,'source'])||!record(row.source))invalid();
  const source=row.source as RecordValue;
  if(exact(source,['fenced'])&&source.fenced===true){receipts.set(key,{source:{fenced:true}});continue;}
  if(!exact(source,['tournamentId','component','sourceVector','payload'])||source.tournamentId!==job.tournament_id||source.component!==job.component||!record(source.sourceVector)||!record(source.payload))invalid();
  for(const value of Object.values(source.sourceVector as RecordValue)){
   if(typeof value!=='string'||!/^\d{1,19}$/.test(value)||BigInt(value)>9223372036854775807n)invalid();
  }
  receipts.set(key,{source:source as {tournamentId:string;component:string;sourceVector:Record<string,string>;payload:RecordValue}});
 }
 return jobs.map(job=>receipts.get(identity(job))??invalid());
}
