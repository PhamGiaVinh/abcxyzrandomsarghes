import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55441');assert.equal(process.env.PGUSER,'postgres');
assert.ok(['vinpoker_ops_swing101_ci','vinpoker_ops_swing101_qualified','vinpoker_ops_swing101_final'].includes(process.env.PGDATABASE));
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
function sql(query,ok=true){const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});if(ok)assert.equal(r.status,0,r.stderr);else assert.notEqual(r.status,0);return r.stdout.trim();}
const dir=sql('SHOW data_directory');assert.ok(dir==='/tmp/vinpoker-sol-local-20261016-0e79a729/data'||process.env.GITHUB_ACTIONS==='true'&&dir==='/var/lib/postgresql/data');
const migration=readFileSync('supabase/migrations/20270128000101_dealer_manual_swing_cancel_actor_v1.sql','utf8');
const signature='public.cancel_dealer_manual_swing_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid)';
const old=`SELECT pg_get_functiondef('public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)'::regprocedure)||pg_get_functiondef('public.get_dealer_manual_swing_receipt_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid)'::regprocedure)`;
const before=sql(old);assert.equal(sql(`SELECT to_regprocedure('${signature}') IS NULL`),'t');
sql(migration.replace(/COMMIT;\s*$/,"DO $$ BEGIN RAISE EXCEPTION 'injected_swing101_ddl_failure'; END $$; COMMIT;"),false);
assert.equal(sql(`SELECT to_regprocedure('${signature}') IS NULL`),'t');assert.equal(sql(old),before);
sql(migration);assert.equal(sql(old),before);
const id=n=>`e1800000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const auth=`SET request.jwt.claim.sub='${id(1)}';SET request.jwt.claim.role='authenticated';SET request.jwt.claims='{"sub":"${id(1)}","role":"authenticated"}';SET ROLE authenticated;`;
const seed=readFileSync('tests/dealerSwing/massOpenSessions.pg17.sql','utf8').split('-- Isolated 40-table capacity seam.')[0]
 .replace('BEGIN;',`BEGIN; SET LOCAL request.jwt.claim.sub='${id(1)}';SET LOCAL request.jwt.claim.role='authenticated';SELECT set_config('request.headers','{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${id(1)}"}',true);`);
sql(seed+'COMMIT;');
const context=()=>JSON.parse(sql(`SELECT jsonb_build_object('assignment',id,'table',table_id,'session',table_session_id,'version',version) FROM public.dealer_assignments WHERE table_id='${id(11)}' AND released_at IS NULL`));
const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_assignments a),'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a))::text)`);
const args=(c,key,actor=id(1),club=id(2))=>`'${actor}','${club}','${c.table}','${c.session}','${c.assignment}',${c.version},'${key}'`;
const cancel=(c,key)=>`SELECT public.cancel_dealer_manual_swing_v1(${args(c,key)});`;
const write=(c,key)=>`SELECT public.operator_perform_swing_v2(${args(c,key)});`;
const read=(c,key)=>JSON.parse(sql(auth+`SELECT public.get_dealer_manual_swing_receipt_v1(${args(c,key)});`));
function tx(name,query,hold=false){const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';
 const result=new Promise(resolve=>{child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>error+=v);child.on('error',e=>resolve({code:-1,out,error:String(e)}));child.on('close',code=>resolve({code,out,error}));});
 const end=command=>{if(!child.stdin.writableEnded)child.stdin.end(command+';\n');};
 child.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL idle_in_transaction_session_timeout='10s';${auth}${query}\n`);
 if(!hold)end('COMMIT');return {result,end};
}
async function barrier(name,condition){for(let i=0;i<100;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition})`)==='t')return;await new Promise(r=>setTimeout(r,20));}assert.fail('missing overlap '+name);}
for(const order of ['cancel-first','writer-first']){
 const c=context(),key=sql('SELECT gen_random_uuid()'),start=fingerprint();let holder,waiter;
 try{
  holder=tx('swing101_holder',order==='cancel-first'?cancel(c,key):write(c,key),true);
  await barrier('swing101_holder',"wait_event='ClientRead' AND xact_start IS NOT NULL");
  waiter=tx('swing101_waiter',order==='cancel-first'?write(c,key):cancel(c,key));
  await barrier('swing101_waiter',"wait_event_type='Lock'");
  assert.equal(read(c,key).status,'receipt_not_found'); // uncommitted is unknown
  holder.end('COMMIT');const a=await holder.result,b=await waiter.result;
  assert.equal(a.code,0,a.error);assert.equal(b.code,0,b.error);
  const first=JSON.parse(a.out),last=JSON.parse(b.out),receipt=read(c,key);
  assert.equal(receipt.status,'receipt_found');
  if(order==='cancel-first'){
   assert.equal(first.response.outcome,'cancelled');assert.equal(last.outcome,'cancelled');
   assert.equal(fingerprint(),start);assert.equal(JSON.parse(sql(auth+write(c,key))).outcome,'cancelled');
   assert.equal(JSON.parse(sql(auth+`SELECT public.operator_perform_swing('${c.table}','${c.session}','${c.assignment}',${c.version},'${key}');`)).outcome,'cancelled');
  }else{
   assert.notEqual(first.outcome,'cancelled');assert.deepEqual(last.response,first);assert.deepEqual(receipt.response,first);
  }
  assert.equal(sql(`SELECT count(*) FROM public.dealer_swing_operator_requests WHERE club_id='${id(2)}' AND request_id='${key}'`),'1');
 }finally{holder?.end('ROLLBACK');waiter?.end('ROLLBACK');await Promise.all([holder?.result,waiter?.result]);}
}
// Actor binding and negative cases execute under actual authenticated role.
const c=context(),key=sql('SELECT gen_random_uuid()'),state=fingerprint();
for(const fn of ['operator_perform_swing_v2','cancel_dealer_manual_swing_v1']){
 const invoke=(arglist,error)=>sql(auth+`DO $$ BEGIN BEGIN PERFORM public.${fn}(${arglist});RAISE EXCEPTION 'negative unexpectedly accepted';EXCEPTION WHEN OTHERS THEN IF SQLERRM<> '${error}' THEN RAISE; END IF;END;END $$;`);
 invoke(args(c,key,id(99)),'SWING_OPERATOR_FORBIDDEN');
 invoke(args(c,key,id(1),id(99)),'SWING_OPERATOR_FORBIDDEN');
 assert.equal(sql(`SELECT has_function_privilege('anon','public.${fn}(uuid,uuid,uuid,uuid,uuid,integer,uuid)','EXECUTE') OR has_function_privilege('service_role','public.${fn}(uuid,uuid,uuid,uuid,uuid,integer,uuid)','EXECUTE')`),'f');
}
// Receipt-insert fault rolls back cancellation, with no operational changes.
const faultKey=sql('SELECT gen_random_uuid()');
sql(`BEGIN;CREATE FUNCTION pg_temp.reject_swing101() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${faultKey}' THEN RAISE EXCEPTION 'injected_swing101_receipt_failure';END IF;RETURN NEW;END $$;
CREATE TRIGGER test_swing101_receipt BEFORE INSERT ON public.dealer_swing_operator_requests FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_swing101();
${auth} DO $$ BEGIN BEGIN PERFORM public.cancel_dealer_manual_swing_v1(${args(c,faultKey)});RAISE EXCEPTION 'fault not raised';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected_swing101_receipt_failure' THEN RAISE;END IF;END;END $$;
RESET ROLE;DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.dealer_swing_operator_requests WHERE request_id='${faultKey}') THEN RAISE EXCEPTION 'partial tombstone';END IF;END $$;ROLLBACK;`);
assert.equal(fingerprint(),state);
sql(auth+cancel(c,key));const stored=read(c,key);
sql(auth+`DO $$ BEGIN BEGIN PERFORM public.cancel_dealer_manual_swing_v1(${args({...c,version:c.version+1},key)});RAISE EXCEPTION 'conflict accepted';EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM<>'SWING_IDEMPOTENCY_CONFLICT' THEN RAISE;END IF;END;END $$;`);
assert.deepEqual(read(c,key),stored);assert.equal(fingerprint(),state);
assert.equal(sql(old),before);
console.log('MANUAL_SWING101_DDL_ROLLBACK_ACTOR_CANCEL_WRITER_BOTH_ORDER_OVERLAP_PASS');
