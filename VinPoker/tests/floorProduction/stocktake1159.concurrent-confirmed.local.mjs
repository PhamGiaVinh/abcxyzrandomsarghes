import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
assert.equal(process.env.VINPOKER_STOCKTAKE1159_LOCAL,'1');
const legacyCompat=process.argv.includes('--legacy-compat1192');
const report=legacyCompat?'D:/Quy trình/output/reports/stocktake1192-concurrent-legacy-native-local-20261028.json':'D:/Quy trình/output/reports/stocktake1159-concurrent-confirmed-native-local-20261027.json';
assert.equal(existsSync(report),false,'Inspect existing run before restarting');
const source='vinpoker_ranking860_local',target='vinpoker_stocktake1159_local';
const args=db=>['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE='+db,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=(db,q)=>execFileSync('wsl',args(db),{input:q,encoding:'utf8',timeout:30000,maxBuffer:4e6}).trim();
const read=(db,q)=>JSON.parse(sql(db,"BEGIN READ ONLY;SET LOCAL statement_timeout='10s';"+q+'ROLLBACK;'));
const guard=read(source,"SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')),'otherSessions',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()),'targetExists',EXISTS(SELECT 1 FROM pg_database WHERE datname='"+target+"'));" );
assert.equal(guard.db,source);assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);
assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(guard.external,0);assert.equal(guard.otherSessions,0);assert.equal(guard.targetExists,legacyCompat);
const tables=['fnb_categories','fnb_menu_items','fnb_ingredients','fnb_recipe_items','fnb_stock_movements','fnb_stocktakes','fnb_stocktake_lines','fnb_orders','fnb_order_items','tournaments','tournament_entries','tournament_seats','cashier_buyin_movements','tournament_prize_payments','chip_bank_ledger','tournament_hands','table_operation_receipts'];
const fingerprint=db=>read(db,'SELECT to_jsonb(md5(jsonb_build_array('+tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')+')::text));');
const state={kind:'NATIVE_TWO_CONNECTION_CONFIRMED_COUNTS_ISOLATED_CLONE_NOT_BROWSER',guard,target,sourceBefore:fingerprint(source),events:[],success:false};
const save=()=>writeFileSync(report,JSON.stringify(state,null,2)+'\n');save();
const actor='a364de8e-06b1-4428-a20d-ac614ec406e5',club='349ecf35-50ba-4c71-a581-15dc45f1cd01';
const claims=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
const up=readFileSync('supabase/migrations/20261027151355_fnb_confirmed_stocktake_snapshot_v1.sql','utf8');
const down=readFileSync('tests/floorProduction/stocktake1158.confirmed-counts.down.sql','utf8');
const fixtureIds=[];
const catalog=()=>read(target,"SELECT jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'body',md5(p.prosrc),'acl',p.proacl::text,'config',p.proconfig,'definer',p.prosecdef) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('fnb_commit_stocktake','fnb_commit_stocktake_confirmed_v1','fnb_set_stocktake_line','fnb_stock_in');");
const otherRows=()=>read(target,'SELECT to_jsonb(md5(jsonb_build_array('+tables.map(t=>{
 const ids=fixtureIds.map(f=>"'"+(t==='fnb_stocktakes'||t==='fnb_stocktake_lines'?f.session:f.ingredient)+"'").join(',');
 const column={fnb_ingredients:'id',fnb_stock_movements:'ingredient_id',fnb_stocktakes:'id',fnb_stocktake_lines:'stocktake_id'}[t];
 return `(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x${ids&&column?` WHERE ${column} NOT IN(${ids})`:''})`;
}).join(',')+')::text));');
if(legacyCompat){
 const targetGuard=read(target,"SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')),'otherSessions',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()),'body',(SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fnb_commit_stocktake_confirmed_v1(uuid,jsonb)'::regprocedure));");
 assert.equal(targetGuard.db,target);assert.equal(targetGuard.host,'127.0.0.1');assert.equal(targetGuard.port,55441);assert.equal(targetGuard.dir,guard.dir);
 assert.equal(targetGuard.comment,'VINPOKER_STOCKTAKE1159_OWNED_LOCAL_TEST_CLONE');assert.equal(targetGuard.external,0);assert.equal(targetGuard.otherSessions,0);
 assert.equal(targetGuard.body,createHash('md5').update(up.match(/AS \$body\$([\s\S]*?)\$body\$;/)[1]).digest('hex'));
 state.targetGuard=targetGuard;state.catalogBefore=catalog();state.otherRowsBefore=otherRows();save();
}
function connection(label){
 const p=spawn('wsl',args(target),{stdio:['pipe','pipe','pipe']});let pending=null,buf='',err='';const closed=new Promise(r=>p.on('exit',r));
 p.stderr.setEncoding('utf8');p.stderr.on('data',x=>err+=x);p.stdout.setEncoding('utf8');p.stdout.on('data',x=>{buf+=x;while(buf.includes('\n')){const n=buf.indexOf('\n'),line=buf.slice(0,n).trim();buf=buf.slice(n+1);if(!pending)continue;if(line===pending.marker){const q=pending;pending=null;q.resolve(q.rows);}else if(line)pending.rows.push(line);}});
 p.on('exit',code=>{if(pending){pending.reject(Error(label+' exit '+code+': '+err));pending=null;}});
 return {p,closed,query:q=>new Promise((resolve,reject)=>{assert.equal(p.exitCode,null);assert.equal(pending,null);const marker='ST1159_'+randomUUID().replaceAll('-','');pending={marker,resolve,reject,rows:[]};p.stdin.write(q+'\n\\echo '+marker+'\n');})};
}
let A,B,pending;
try{
 // Clone an explicitly guarded, idle LOCAL database; never modify the source.
 if(!legacyCompat){
 sql('postgres',`CREATE DATABASE ${target} TEMPLATE ${source};`);
 sql(target,`COMMENT ON DATABASE ${target} IS 'VINPOKER_STOCKTAKE1159_OWNED_LOCAL_TEST_CLONE';`);
 state.events.push('ISOLATED_DATABASE_CREATED');save();
 sql(target,'BEGIN;'+up+'COMMIT;');
 }
 const prepare=()=>JSON.parse(sql(target,'BEGIN;'+claims+`DO $$ DECLARE r jsonb;BEGIN r:=public.fnb_upsert_ingredient('${club}',NULL,'LOCAL${legacyCompat?'1192':'1159'} concurrency ${randomUUID()} TEST','unit','unit',1,0,true);IF r->>'status'<>'ok' THEN RAISE EXCEPTION 'fixture ingredient';END IF;PERFORM set_config('test.s1159.ingredient',r->>'id',true);r:=public.fnb_stock_in('${club}',(r->>'id')::uuid,2,1000,'${randomUUID()}');IF r->>'status'<>'ok' THEN RAISE EXCEPTION 'fixture stock';END IF;r:=public.fnb_open_stocktake('${club}',NULL,'${randomUUID()}');IF r->>'status'<>'ok' THEN RAISE EXCEPTION 'fixture session';END IF;PERFORM set_config('test.s1159.session',r->>'stocktake_id',true);r:=public.fnb_set_stocktake_line((r->>'stocktake_id')::uuid,current_setting('test.s1159.ingredient')::uuid,1.25);IF r->>'status'<>'ok' THEN RAISE EXCEPTION 'fixture count';END IF;END $$;SELECT jsonb_build_object('ingredient',current_setting('test.s1159.ingredient'),'session',current_setting('test.s1159.session'));COMMIT;`));
 let fixture=prepare();fixtureIds.push(fixture);
 state.fixture={actor,club,...fixture};save();
 const line=qty=>`SELECT public.fnb_set_stocktake_line('${fixture.session}','${fixture.ingredient}',${qty});`;
 const commit=qty=>`SELECT public.fnb_commit_stocktake_confirmed_v1('${fixture.session}',jsonb_build_object('${fixture.ingredient}','${qty}'));`;
 const snapshot=()=>read(target,`SELECT jsonb_build_object('stock',(SELECT on_hand FROM public.fnb_ingredients WHERE id='${fixture.ingredient}'),'avg',(SELECT avg_unit_cost FROM public.fnb_ingredients WHERE id='${fixture.ingredient}'),'status',(SELECT status FROM public.fnb_stocktakes WHERE id='${fixture.session}'),'counted',(SELECT counted_qty FROM public.fnb_stocktake_lines WHERE stocktake_id='${fixture.session}' AND ingredient_id='${fixture.ingredient}'),'adjustments',(SELECT count(*) FROM public.fnb_stock_movements WHERE ingredient_id='${fixture.ingredient}' AND reason='stocktake_adjust'),'net',(SELECT sum(delta) FROM public.fnb_stock_movements WHERE ingredient_id='${fixture.ingredient}'));`);
 A=connection('A');B=connection('B');
 const begin="BEGIN;SET LOCAL lock_timeout='12s';SET LOCAL statement_timeout='18s';SET LOCAL idle_in_transaction_session_timeout='30s';"+claims+'SELECT pg_backend_pid();';
 const wait=async pid=>{const deadline=Date.now()+6000;while(Date.now()<deadline){const row=read(target,`SELECT jsonb_build_object('pid',pid,'type',wait_event_type,'event',wait_event) FROM pg_stat_activity WHERE pid=${pid};`);if(row.type==='Lock')return row;await new Promise(r=>setTimeout(r,75));}throw Error('Expected real lock wait not observed');};
 state.aPid=Number((await A.query(begin))[0]);state.bPid=Number((await B.query(begin))[0]);
 if(legacyCompat){
  state.kind='NATIVE_TWO_CONNECTION_EXISTING_CLONE_LEGACY_CONFIRMED_COMMIT_NO_SCHEMA_CHANGE';
  state.compatibility=[];
  for(const order of ['legacy-first','confirmed-first']){
   if(order==='confirmed-first'){
    fixture=prepare();fixtureIds.push(fixture);
    await A.query(begin);await B.query(begin);
   }
   const legacy=`SELECT public.fnb_commit_stocktake('${fixture.session}');`;
   const first=JSON.parse((await A.query(order==='legacy-first'?legacy:commit('1.2500')))[0]);
   assert.equal(first.status,'ok');assert.equal(first.adjusted_lines,1);
   pending=B.query(order==='legacy-first'?commit('1.25'):legacy).then(value=>({value}),error=>({error}));
   const lockWait=await wait(state.bPid);await A.query('COMMIT;');
   const second=await pending;pending=null;if(second.error)throw second.error;
   const replay=JSON.parse(second.value[0]);assert.equal(replay.status,'ok');assert.equal(replay.idempotent,true);
   await B.query('COMMIT;');
   const after=snapshot();assert.deepEqual(after,{stock:1.25,avg:1000,status:'committed',counted:1.25,adjustments:1,net:1.25});
   const stale=JSON.parse(sql(target,'BEGIN;'+claims+commit('1.75')+'COMMIT;'));
   assert.equal(stale.error,'STOCKTAKE_COUNTS_CHANGED');assert.deepEqual(snapshot(),after);
   const exact=JSON.parse(sql(target,'BEGIN;'+claims+commit('1.2500')+'COMMIT;'));
   assert.equal(exact.idempotent,true);assert.equal(exact.counts_confirmed,true);assert.deepEqual(snapshot(),after);
   state.compatibility.push({order,fixture:{...fixture},first,lockWait,replay,after,stale,exact});save();
  }
  state.fixtures=fixtureIds;state.catalogAfter=catalog();assert.deepEqual(state.catalogAfter,state.catalogBefore);
  state.otherRowsAfter=otherRows();assert.equal(state.otherRowsAfter,state.otherRowsBefore);
 }else{
 state.lineFirst=JSON.parse((await A.query(line('1.75')))[0]);assert.equal(state.lineFirst.status,'ok');
 pending=B.query(commit('1.25')).then(value=>({value}),error=>({error}));
 state.commitWait=await wait(state.bPid);await A.query('COMMIT;');
 const stale=await pending;pending=null;if(stale.error)throw stale.error;
 state.staleCommit=JSON.parse(stale.value[0]);assert.equal(state.staleCommit.error,'STOCKTAKE_COUNTS_CHANGED');await B.query('COMMIT;');
 state.afterStale=snapshot();assert.deepEqual(state.afterStale,{stock:2,avg:1000,status:'open',counted:1.75,adjustments:0,net:2});state.events.push('LINE_FIRST_COMMIT_WAITED_AND_REJECTED_STALE');save();
 await A.query(begin);await B.query(begin);
 state.commitFirst=JSON.parse((await A.query(commit('1.7500')))[0]);assert.equal(state.commitFirst.counts_confirmed,true);assert.equal(state.commitFirst.adjusted_lines,1);
 pending=B.query(line('9')).then(value=>({value}),error=>({error}));
 state.lineWait=await wait(state.bPid);await A.query('COMMIT;');
 const late=await pending;pending=null;if(late.error)throw late.error;
 state.closedLine=JSON.parse(late.value[0]);assert.equal(state.closedLine.error,'BAD_STATE');await B.query('COMMIT;');
 state.afterCommit=snapshot();assert.deepEqual(state.afterCommit,{stock:1.75,avg:1000,status:'committed',counted:1.75,adjustments:1,net:1.75});state.events.push('COMMIT_FIRST_LINE_WAITED_AND_REJECTED_CLOSED');
 state.replay=JSON.parse(sql(target,'BEGIN;'+claims+commit('1.75')+'COMMIT;'));assert.equal(state.replay.idempotent,true);assert.deepEqual(snapshot(),state.afterCommit);
 const beforeDown=fingerprint(target);sql(target,'BEGIN;'+down+'COMMIT;');
 state.down={absent:read(target,"SELECT to_jsonb(to_regprocedure('public.fnb_commit_stocktake_confirmed_v1(uuid,jsonb)') IS NULL);"),dataUnchanged:beforeDown===fingerprint(target)};assert.deepEqual(state.down,{absent:true,dataUnchanged:true});
 // Rehearse re-apply after guarded code rollback, without replaying any data.
 sql(target,'BEGIN;'+up+'COMMIT;');state.reapply=JSON.parse(sql(target,'BEGIN;'+claims+commit('1.75')+'COMMIT;'));assert.equal(state.reapply.idempotent,true);assert.equal(beforeDown,fingerprint(target));
 }
 state.success=true;
}catch(error){state.error=error.message;throw error;}
finally{
 // End only owned connections. Preserve isolated TEST history, including failures.
 if(A?.p.exitCode===null){try{await A.query('ROLLBACK;');}finally{A.p.stdin.end();}}if(A)await A.closed;
 if(pending)await pending;
 if(B?.p.exitCode===null){try{await B.query('ROLLBACK;');}finally{B.p.stdin.end();}}if(B)await B.closed;
 state.sourceAfter=fingerprint(source);state.sourceUnchanged=state.sourceBefore===state.sourceAfter;save();assert.equal(state.sourceUnchanged,true);
}
console.log(JSON.stringify({success:state.success,isolatedDatabase:target,commitWait:state.commitWait,lineWait:state.lineWait,sourceUnchanged:state.sourceUnchanged,down:state.down,final:state.afterCommit}));
