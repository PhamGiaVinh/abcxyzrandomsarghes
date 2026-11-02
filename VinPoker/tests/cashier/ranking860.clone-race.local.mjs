import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
assert.equal(process.env.VINPOKER_RANKING860_LOCAL,'1');
assert.ok(process.argv.length===3&&['--create','--verify-created','--install','--race'].includes(process.argv[2]));
const mode=process.argv[2],source='vinpoker_ops_cash115_qualified_c',clone='vinpoker_ranking860_local';
const stamp='VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
const packageHash='d786e04b14c42eaeb0832b97ea47f992eacd755ad1e94d9022f6a28920c778bd';
const candidate=readFileSync('supabase/migrations/20270128000296_manual_ranking_review_v1.sql','utf8');
assert.equal(createHash('sha256').update(candidate).digest('hex'),packageHash,'review new source before clone install');
const args=db=>['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=(db,input)=>execFileSync('wsl',args(db),{input,encoding:'utf8',timeout:30000,maxBuffer:2e6,stdio:['pipe','pipe','pipe']}).trim();
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
assert.equal(sql('postgres',"SELECT host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql(source,`SELECT md5(replace(pg_get_functiondef('public.finalize_tournament_results(uuid)'::regprocedure),chr(13),''))||'|'||
 md5(replace(pg_get_functiondef('floor_private.felt_official_results_close_status_v1(uuid)'::regprocedure),chr(13),''))||'|'||
 (to_regclass('floor_private.tournament_ranking_reviews296') IS NULL)::text;`),
 'df45256a89b7a56fe6d7630803ff241a|906391392ced28d9ac94220e3ab42e2a|true','primary baseline drift; never install candidate here');
const tables=['tournaments','tournament_entries','tournament_seats','tournament_hands','hand_players','tournament_eliminations','cashier_buyin_movements','tournament_prize_payments','tournament_close_report','game_tables','table_sessions','tournament_tables'];
const targets="'public.finalize_tournament_results(uuid)'::regprocedure,'floor_private.felt_official_results_close_status_v1(uuid)'::regprocedure";
const metadata=`SELECT jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'definition',pg_get_functiondef(oid),'owner',proowner,'acl',proacl,'config',proconfig,'volatility',provolatile) ORDER BY oid) FROM pg_proc WHERE oid IN(${targets})`;
// Hash each complete row before aggregation: retain every field, multiplicity and id order,
// while avoiding a full-database JSON value in PostgreSQL memory. Algorithm differs
// from historic 3dee... proof; only compare values produced within this version.
function proof(db,allowedTour=null,includeMetadata=true){return sql(db,`BEGIN READ ONLY;SET LOCAL statement_timeout='15s';SELECT md5(jsonb_build_array(
 ${tables.map(t=>`(SELECT jsonb_build_object('table','${t}','count',count(*),'rows',md5(coalesce(string_agg(md5((${t==='tournament_entries'&&allowedTour?`CASE WHEN tournament_id='${allowedTour}' THEN to_jsonb(r)-'finished_place'-'updated_at' ELSE to_jsonb(r) END`:'to_jsonb(r)'})::text),'' ORDER BY id),''))) FROM public.${t} r)`).join(',')},
 ${includeMetadata?`(${metadata})`:'null::jsonb'})::text);ROLLBACK;`);}
const original=proof(source);
console.log('RANK860_PRIMARY_BASELINE',JSON.stringify({algorithm:'ordered-row-md5-v2',proof:original}));
const auth=actor=>`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';`;
async function until(check){const deadline=Date.now()+15000;while(!check()){assert.ok(Date.now()<deadline,'ranking860 live barrier not reached');await new Promise(resolve=>setTimeout(resolve,50));}}
function session(name){
 const child=spawn('wsl',args(clone),{stdio:['pipe','pipe','pipe'],timeout:30000});let output='',errors='',terminal=false;
 child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>errors+=x);
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{terminal=true;resolve({code,output,errors});});});
 return {child,done,name,output:()=>output,terminal:()=>terminal};
}
let phaseError=null;
try{
 if(mode==='--create'){
  assert.equal(sql('postgres',`SELECT count(*) FROM pg_database WHERE datname='${clone}';`),'0','clone already exists; do not replace');
  assert.ok(Number(sql('postgres',`SELECT pg_database_size('${source}');`))<=300*1024*1024,'clone exceeds existing local copy budget');
  assert.equal(sql('postgres',`SELECT count(*) FROM pg_stat_activity WHERE datname='${source}';`),'0','do not disconnect other sessions');
  sql('postgres',`CREATE DATABASE ${clone} TEMPLATE ${source};COMMENT ON DATABASE ${clone} IS ${quote(stamp)};`);
  console.log('RANK860_OWNED_CLONE_CREATED',JSON.stringify({clone,stamp,bytes:Number(sql('postgres',`SELECT pg_database_size('${clone}');`))}));
 }else{
  assert.equal(sql(clone,`SELECT current_database()||'|'||(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database());`),`${clone}|${stamp}`);
  assert.equal(sql(clone,"SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
  if(mode==='--verify-created'){
   assert.equal(sql(clone,"SELECT to_regclass('floor_private.ranking860_install_backup') IS NULL;"),'t');
   assert.equal(proof(clone),original,'retained clone differs from source before candidate installation');
   console.log('RANK860_RETAINED_CLONE_MATCHES_PRIMARY_BEFORE_INSTALL',JSON.stringify({clone,proof:original}));
  }else if(mode==='--install'){
   assert.equal(sql(clone,"SELECT to_regclass('floor_private.ranking860_install_backup') IS NULL;"),'t','installer already consumed');
   const before=proof(clone),businessBefore=proof(clone,null,false);
   const body=candidate.replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');
   sql(clone,`BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='20s';
    CREATE TABLE floor_private.ranking860_install_backup(package_hash text PRIMARY KEY,old_metadata jsonb NOT NULL);
    ALTER TABLE floor_private.ranking860_install_backup ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON floor_private.ranking860_install_backup FROM PUBLIC,anon,authenticated,service_role;
    INSERT INTO floor_private.ranking860_install_backup VALUES('${packageHash}',(${metadata}));
    ${body}
    SAVEPOINT exact_predecessor_rehearsal;
    DO $$ DECLARE r jsonb;BEGIN
     FOR r IN SELECT value FROM floor_private.ranking860_install_backup b,jsonb_array_elements(b.old_metadata) WHERE package_hash='${packageHash}'
     LOOP EXECUTE r->>'definition';END LOOP;
     ASSERT (${metadata})=(SELECT old_metadata FROM floor_private.ranking860_install_backup WHERE package_hash='${packageHash}'),'ranking860 exact predecessor recovery mismatch';
    END $$;
    ROLLBACK TO exact_predecessor_rehearsal;
    COMMIT;`);
   // Only the pinned two definitions may change in the business fingerprint.
   const current=sql(clone,metadata);const old=sql(clone,`SELECT old_metadata FROM floor_private.ranking860_install_backup WHERE package_hash='${packageHash}';`);
   assert.deepEqual(JSON.parse(current).map(({definition,...rest})=>rest),JSON.parse(old).map(({definition,...rest})=>rest));
   const changed=JSON.parse(current).filter((r,i)=>r.definition!==JSON.parse(old)[i].definition).length;assert.equal(changed,2);
   assert.equal(proof(clone,null,false),businessBefore,'ranking860 install changed business rows');
   console.log('RANK860_CANDIDATE_INSTALLED_OWNED_CLONE_ONLY',JSON.stringify({clone,packageHash,predecessorMetadataRehearsal:true,before}));
  }else{
   assert.equal(sql(clone,`SELECT package_hash FROM floor_private.ranking860_install_backup;`),packageHash);
   const base=readFileSync('tests/cashier/ranking857.manual-review.rollback.sql','utf8');
   for(const [index,kind] of ['same-key','competing-order','confirm-before-finalize','finalize-before-confirm'].entries()){
    const prefix=`fa86000${index+1}`,id=n=>`${prefix}-0000-4000-8000-${String(n).padStart(12,'0')}`;
    const tour=id(2),actor=id(10),key=id(101),otherKey=id(102),order=[id(23),id(22),id(21),id(24)],reverse=[id(23),id(21),id(22),id(24)];
    assert.equal(base.split('ROLLBACK;').length,2);
    sql(clone,base.replaceAll('fa857000',prefix).replace(/^ROLLBACK;\r?$/m,'COMMIT;'));
    const before=proof(clone,tour);
    const hash=sql(clone,`BEGIN;${auth(actor)}SELECT public.get_tournament_ranking_review_v1('${tour}')->'source'->>'sourceHash';ROLLBACK;`);
    assert.match(hash,/^[a-f0-9]{32}$/);
    const confirm=(request,ids)=>`public.confirm_tournament_ranking_review_v1('${tour}','${hash}',ARRAY[${ids.map(quote).join(',')}]::uuid[],'${request}','${actor}')`;
    const finalizer=`public.finalize_tournament_results('${tour}')`;
    const a=session(`ranking860_${index}_a`),b=session(`ranking860_${index}_b`);let observed=false;
    try{
     const first=kind==='finalize-before-confirm'?finalizer:confirm(key,order);
     const second=kind==='same-key'?confirm(key,order):kind==='competing-order'?confirm(otherKey,reverse):kind==='confirm-before-finalize'?finalizer:confirm(key,order);
     a.child.stdin.write(`SET application_name='${a.name}';BEGIN;SET LOCAL statement_timeout='20s';SET LOCAL idle_in_transaction_session_timeout='20s';${auth(actor)}${kind==='finalize-before-confirm'?'':'SET LOCAL ROLE authenticated;'}SELECT ${first};SELECT 'RANK860_HOLDER_READY';\n`);
     await until(()=>a.output().includes('RANK860_HOLDER_READY')||a.terminal());assert.ok(!a.terminal(),a.output());
     b.child.stdin.end(`SET application_name='${b.name}';BEGIN;SET LOCAL statement_timeout='20s';${auth(actor)}${kind==='confirm-before-finalize'?'':'SET LOCAL ROLE authenticated;'}SELECT ${second};COMMIT;\n`);
     await until(()=>{
      observed=sql(clone,`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${b.name}' AND wait_event_type='Lock'
       AND (SELECT pid FROM pg_stat_activity WHERE application_name='${a.name}')=ANY(pg_blocking_pids(pid)));`)==='t';
      return observed||b.terminal();
     });assert.ok(observed,'ranking860 waiter did not overlap holder');
     a.child.stdin.end('COMMIT;\n');const [ra,rb]=await Promise.all([a.done,b.done]);assert.equal(ra.code,0,ra.errors);
     const firstReply=JSON.parse(ra.output.split(/\r?\n/).find(x=>x.startsWith('{')));
     if(kind==='competing-order'){assert.notEqual(rb.code,0);assert.match(rb.errors,/ranking_review_already_recorded/);}
     else{
      assert.equal(rb.code,0,rb.errors);const secondReply=JSON.parse(rb.output.split(/\r?\n/).find(x=>x.startsWith('{')));
      if(kind==='same-key')assert.deepEqual(secondReply,firstReply);
      if(kind==='confirm-before-finalize')assert.equal(secondReply.ranking_review,true);
      if(kind==='finalize-before-confirm'){assert.equal(firstReply.error,'manual_ranking_review_required');assert.equal(secondReply.outcome,'recorded');}
     }
    }finally{
     for(const s of [a,b])if(!s.child.stdin.writableEnded)s.child.stdin.end('ROLLBACK;\n');
     await Promise.allSettled([a.done,b.done]);
    }
    assert.equal(sql(clone,`SELECT count(*) FROM floor_private.tournament_ranking_reviews296 WHERE tournament_id='${tour}';`),'1');
    const actual=JSON.parse(sql(clone,`SELECT jsonb_object_agg(right(player_id::text,2),finished_place) FROM public.tournament_entries WHERE tournament_id='${tour}';`));
    assert.deepEqual(actual,kind==='confirm-before-finalize'?{'11':3,'12':2,'13':1,'14':4}:{'11':null,'12':null,'13':null,'14':null});
    assert.equal(proof(clone,tour),before,'ranking860 unexpected business/catalog change');
    console.log('RANK860_TWO_SESSION_CASE_PASS',JSON.stringify({kind,tour,actor,request:key,blocked:observed,receiptCount:1,ranks:actual}));
   }
  }
 }
}catch(error){phaseError=error;throw error;}
finally{
 try{assert.equal(proof(source),original,'ranking860 modified primary source');console.log('RANK860_PRIMARY_ORIGINAL_JOURNEYS_AND_CATALOG_UNCHANGED');}
 catch(postcheckError){
  if(!phaseError)throw postcheckError;
  console.error('RANK860_POSTCHECK_ALSO_UNAVAILABLE',postcheckError instanceof Error?postcheckError.message:String(postcheckError));
 }
}
