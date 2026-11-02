import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

// Canonical target hand/worker/correction are supplied by the actual paid worker
// fixture. Two explicitly synthetic legacy history rows force pagination only;
// they have no copied actions/players/proofs and do NOT represent played hands.
export async function beginHistoryPagination156({sql,fixture,hand,logical}){
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 const ids=[randomUUID(),randomUUID()];
 assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${fixture.tour}';`),'1','fresh dedicated fixture only');
 assert.equal(sql(`SELECT attnotnull FROM pg_attribute WHERE attrelid='public.tournament_hands'::regclass AND attname='hand_number';`),'t');
 sql(`BEGIN;${ids.map((id,i)=>`INSERT INTO public.tournament_hands SELECT (jsonb_populate_record(NULL::public.tournament_hands,to_jsonb(h)||jsonb_build_object('id','${id}','hand_number',${1001+i},'created_at',h.created_at-interval '${i+1} minute','updated_at',h.created_at-interval '${i+1} minute'))).* FROM public.tournament_hands h WHERE h.id='${hand}';`).join('\n')}COMMIT;`);
 assert.equal(sql(`SELECT count(*) FROM public.hand_players WHERE hand_id IN ('${ids[0]}','${ids[1]}');`),'0');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id IN ('${ids[0]}','${ids[1]}');`),'0');
 const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1']);
 let output='',error='';child.stdin.on('error',()=>{});child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>error+=v);
 const done=new Promise(resolve=>{child.once('error',e=>resolve({code:-1,error:String(e)}));child.once('close',code=>resolve({code,error}))});
 const write=q=>{assert.ok(!child.stdin.destroyed);child.stdin.write(q+'\n')};
 const literal=v=>v===null?'NULL':`'${String(v).replaceAll("'","''")}'`;
 const query=(tag,cursor=null)=>`SELECT jsonb_build_object('tag','${tag}','page',public.get_public_tournament_table_history_v2('${fixture.tour}','${logical}',1,${literal(cursor?.createdAt??null)}::timestamptz,${literal(cursor?.id??null)}::uuid));`;
 async function page(tag,cursor=null){
  write(query(tag,cursor));const deadline=Date.now()+10000;
  for(;;){
   const value=output.split(/\r?\n/).filter(v=>v.startsWith('{')).map(v=>JSON.parse(v)).find(v=>v.tag===tag);
   if(value){assert.equal(value.page.access,'public');return value.page;}
   assert.ok(Date.now()<deadline,`history156 ${tag} timeout: ${error}`);await new Promise(r=>setTimeout(r,25));
  }
 }
 write("SET application_name='history156_anon_observer';BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY;SET LOCAL statement_timeout='5s';SET LOCAL idle_in_transaction_session_timeout='45s';SET LOCAL ROLE anon;");
 let first;
 try{first=await page('before');assert.equal(first.items.length,1);assert.equal(first.items[0].handId,hand);assert.equal(first.items[0].result.status,'verified');assert.ok(first.nextCursor);}
 catch(e){child.stdin.end('ROLLBACK;\n');await done;throw e;}
 return {
  async afterCorrection(){
   assert.equal(sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='history156_anon_observer' AND state='idle in transaction' AND xact_start IS NOT NULL;"),'1','observer transaction must overlap canonical correction commit');
   const seen=[hand];let cursor=first.nextCursor;
   for(let i=0;i<2;i++){
    const next=await page(`older${i}`,cursor);assert.equal(next.items.length,1);assert.equal(next.items[0].handId,ids[i]);
    assert.equal(next.items[0].result.status,'pending','synthetic history rows must not acquire invented proof');
    seen.push(next.items[0].handId);cursor=next.nextCursor;
   }
   assert.equal(cursor,null);assert.equal(new Set(seen).size,3);
   const refreshed=await page('after');assert.equal(refreshed.items[0].handId,hand);
   assert.deepEqual(refreshed.items[0].board,['2c','3d','4h']);assert.equal(refreshed.items[0].result.status,'verified');
   assert.notDeepEqual(first.items[0].board,refreshed.items[0].board);
   const proof=JSON.parse(sql(`SELECT jsonb_build_object('revision',o.source_revision,'currentRevision',h.source_revision,'hash',o.source_chain_hash,'currentHash',s.source_chain_hash,'outcome',o.public_outcome) FROM public.tournament_settlement_outcomes o JOIN public.tournament_hands h ON h.id=o.hand_id CROSS JOIN LATERAL public.get_tournament_settlement_source_hash(h.id) s WHERE h.id='${hand}' AND o.source_revision=h.source_revision AND o.verification_scope='chain' AND o.status='verified';`));
   assert.equal(proof.revision,proof.currentRevision);assert.equal(proof.hash,proof.currentHash);
   const recipients=proof.outcome.players.filter(p=>p.potAward>0).map(p=>({playerId:p.playerId,potAward:p.potAward,netDelta:p.netDelta})).sort((a,b)=>a.playerId.localeCompare(b.playerId));
   assert.deepEqual(refreshed.items[0].result.recipients.map(({playerId,potAward,netDelta})=>({playerId,potAward,netDelta})).sort((a,b)=>a.playerId.localeCompare(b.playerId)),recipients);
   console.log('HISTORY156_CONCURRENT_ANON_TRANSACTION_CANONICAL_CORRECTION_KEYSET_REFRESH_PASS',JSON.stringify({tour:fixture.tour,hand,syntheticRows:ids,pages:3,currentRevision:proof.revision}));
  },
  async close(){if(!child.stdin.writableEnded&&!child.stdin.destroyed)child.stdin.end('COMMIT;\n');const result=await done;assert.equal(result.code,0,result.error);},
 };
}
