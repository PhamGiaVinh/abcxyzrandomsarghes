import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
assert.equal(process.env.VINPOKER_CREATE1031_LOCAL,'1');
const db='vinpoker_ranking860_local',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const path='D:/Quy trình/output/reports/create1031-concurrent-commit-native-local-20261027.json';assert.equal(existsSync(path),false,'Inspect retained run; do not mint a replacement request');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${q}ROLLBACK;`));
const guard=read("SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'otherConnections',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));");
assert.equal(guard.db,db);assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');assert.equal(guard.otherConnections,0);assert.equal(guard.external,0);
const tables=['tournaments','tournament_entries','tournament_registrations','tournament_levels','tournament_seats','tournament_tables','table_sessions','tournament_close_report','tournament_prizes','tournament_prize_payments','tournament_chip_counts','seat_draw_receipts','seat_assignment_history','table_operation_receipts','cashier_buyin_movements','dealer_attendance','dealer_assignments','tournament_hands','tournament_settlement_outcomes','multi_day_final_participations_v1','tournament_state_transitions','audit_logs','chip_inventory_ledger','chip_bank_ledger'];
const request={p_club_id:club,p_expected_actor_id:actor,p_request_id:randomUUID(),p_config:{name:'Create1031 concurrent TEST',start_time:'2030-01-02T13:00:00Z',buy_in:100000,rake_amount:0,service_fee_amount:0,starting_stack:20000,game_type:'nlh',minutes_per_level:20,late_reg_close_level:6,status:'upcoming',current_level:1},p_levels:[]};
const lit=x=>"'"+String(x).replaceAll("'","''")+"'";
const call=(name,r=request)=>'SELECT public.'+name+'('+[lit(club),lit(JSON.stringify(r.p_config))+'::jsonb',"'[]'::jsonb",lit(r.p_request_id)+'::uuid',lit(actor)].join(',')+');';
const claims=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
const metadata=()=>read("SELECT jsonb_object_agg(proname,jsonb_build_object('body',md5(prosrc),'owner',proowner,'acl',proacl::text)) FROM pg_proc WHERE oid IN('public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure,'public.get_tournament_create_receipt_v1(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure,'public.ops_create_tournament(uuid,text,timestamptz,integer,integer,integer,integer,text)'::regprocedure);");
let created=null;
const fingerprint=protectedOnly=>read(`SELECT to_jsonb(md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x${protectedOnly&&t==='tournaments'&&created?` WHERE id<>${lit(created)}::uuid`:protectedOnly&&t==='table_operation_receipts'?` WHERE NOT(actor_id=${lit(actor)}::uuid AND operation_type='create_tournament_with_levels_v1' AND request_id=${lit(request.p_request_id)}::uuid)`:''})`).join(',')})::text));`);
const counts=()=>read('SELECT jsonb_build_object(\'tournaments\',(SELECT count(*) FROM public.tournaments),\'receipts\',(SELECT count(*) FROM public.table_operation_receipts));');
const source=readFileSync('supabase/migrations/20270128000298_ops_create_lifecycle_compatibility_v1.sql','utf8');
const state={kind:'NATIVE_COMMITTED_TWO_CONNECTION_SAME_REQUEST_NOT_BROWSER_OR_WHOLE_ACCEPTANCE',guard,request,tables,sourceSha256:createHash('sha256').update(source).digest('hex'),beforeMetadata:metadata(),before:fingerprint(false),protectedBefore:fingerprint(true),beforeCounts:counts(),events:[],success:false};
const save=()=>writeFileSync(path,JSON.stringify(state,null,2)+'\n');save();assert.equal(state.beforeMetadata.create_tournament_with_levels_v1.body,'e0138e0be86fc4cfdaf325a216a415b7');
let A=null,B=null,bPromise=null;
function connection(label){
 const p=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let pending=null,buffer='',errors='';
 const closed=new Promise(resolve=>p.on('exit',resolve));p.stderr.setEncoding('utf8');p.stderr.on('data',x=>errors+=x);p.stdout.setEncoding('utf8');
 p.stdout.on('data',x=>{buffer+=x;while(buffer.includes('\n')){const at=buffer.indexOf('\n'),line=buffer.slice(0,at).trim();buffer=buffer.slice(at+1);if(!pending)continue;if(line===pending.marker){const v=pending;pending=null;v.resolve(v.rows);}else if(line)pending.rows.push(line);}});
 p.on('exit',code=>{if(pending){const v=pending;pending=null;v.reject(new Error(label+' exited '+code+': '+errors));}});
 const c={p,closed,inTransaction:false,query:q=>new Promise((resolve,reject)=>{assert.equal(p.exitCode,null);assert.equal(pending,null);const marker='CREATE1031_'+randomUUID().replaceAll('-','');pending={marker,resolve,reject,rows:[]};p.stdin.write(q+'\n\\echo '+marker+'\n');})};return c;
}
try{
 sql(source);state.installedMetadata=metadata();assert.equal(state.installedMetadata.create_tournament_with_levels_v1.body,'3fb4d9a225b94f23c80751da468b9f5e');for(const name of Object.keys(state.beforeMetadata)){assert.equal(state.beforeMetadata[name].owner,state.installedMetadata[name].owner);assert.equal(state.beforeMetadata[name].acl,state.installedMetadata[name].acl);if(name!=='create_tournament_with_levels_v1')assert.deepEqual(state.beforeMetadata[name],state.installedMetadata[name]);}state.events.push('CANDIDATE_INSTALLED_LOCAL_ONLY');save();
 A=connection('A');B=connection('B');
 const begin="BEGIN;SET LOCAL lock_timeout='8s';SET LOCAL statement_timeout='12s';SET LOCAL idle_in_transaction_session_timeout='90s';"+claims+"SELECT jsonb_build_object('pid',pg_backend_pid());";
 const aSetup=await A.query(begin);A.inTransaction=true;state.aPid=JSON.parse(aSetup[0]).pid;
 const bSetup=await B.query(begin);B.inTransaction=true;state.bPid=JSON.parse(bSetup[0]).pid;assert.notEqual(state.aPid,state.bPid);
 state.aResult=JSON.parse((await A.query(call('create_tournament_with_levels_v1')))[0]);assert.equal(state.aResult.ok,true);created=state.aResult.tournament_id;state.createdTour=created;state.events.push('A_CREATED_UNCOMMITTED');save();
 bPromise=B.query(call('create_tournament_with_levels_v1')).then(value=>({value}),error=>({error}));
 const deadline=Date.now()+4000;while(Date.now()<deadline){const status=read(`SELECT coalesce((SELECT jsonb_build_object('pid',pid,'state',state,'waitType',wait_event_type,'waitEvent',wait_event) FROM pg_stat_activity WHERE pid=${state.bPid}),'null'::jsonb);`);if(status?.waitType==='Lock'){state.waitingB=status;break;}await new Promise(resolve=>setTimeout(resolve,75));}
 assert.equal(state.waitingB?.waitType,'Lock');state.events.push('B_OBSERVED_WAITING_REAL_DB_LOCK');save();
 await A.query('COMMIT;');A.inTransaction=false;state.events.push('A_COMMITTED');
 const b=await bPromise;if(b.error)throw b.error;state.bResult=JSON.parse(b.value[0]);assert.deepEqual(state.bResult,state.aResult);await B.query('COMMIT;');B.inTransaction=false;state.events.push('B_COMMITTED_SAME_RECEIPT');
 state.publicReceipt=JSON.parse(sql('BEGIN READ ONLY;'+claims+call('get_tournament_create_receipt_v1')+'ROLLBACK;'));assert.deepEqual(state.publicReceipt,state.aResult);
 const conflict={...request,p_config:{...request.p_config,name:'Conflicting1031 TEST'}};state.conflict=JSON.parse(sql('BEGIN;'+claims+call('create_tournament_with_levels_v1',conflict)+'ROLLBACK;'));assert.equal(state.conflict.error,'IDEMPOTENCY_CONFLICT');
 state.current=read(`SELECT jsonb_build_object('id',id,'name',name,'status',status,'level',current_level,'buyIn',buy_in,'stack',starting_stack,'start',start_time,'levels',(SELECT count(*) FROM public.tournament_levels WHERE tournament_id=t.id),'entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id=t.id),'seats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id=t.id)) FROM public.tournaments t WHERE id=${lit(created)}::uuid;`);assert.equal(state.current.status,'upcoming');assert.equal(state.current.level,1);assert.equal(state.current.buyIn,100000);assert.equal(state.current.stack,20000);assert.equal(state.current.entries,0);assert.equal(state.current.seats,0);assert.equal(state.current.levels,0);
 state.afterCounts=counts();assert.equal(state.afterCounts.tournaments,state.beforeCounts.tournaments+1);assert.equal(state.afterCounts.receipts,state.beforeCounts.receipts+1);state.protectedAfter=fingerprint(true);assert.equal(state.protectedBefore,state.protectedAfter);state.after=fingerprint(false);assert.notEqual(state.before,state.after);state.success=true;
}catch(error){state.error={message:error.message};throw error;}
finally{
 if(A?.inTransaction&&A.p.exitCode===null){try{await A.query('ROLLBACK;');A.inTransaction=false;}catch(error){state.cleanupA=error.message;}}
 if(bPromise)await bPromise;
 if(B?.inTransaction&&B.p.exitCode===null){try{await B.query('ROLLBACK;');B.inTransaction=false;}catch(error){state.cleanupB=error.message;}}
 for(const c of [A,B])if(c){if(c.p.exitCode===null)c.p.stdin.end();await c.closed;}
 state.finalMetadata=metadata();save();
}
console.log(JSON.stringify({success:state.success,tour:created,request:request.p_request_id,wait:state.waitingB,counts:state.afterCounts,protectedUnchanged:state.protectedBefore===state.protectedAfter,body:state.finalMetadata.create_tournament_with_levels_v1.body}));
