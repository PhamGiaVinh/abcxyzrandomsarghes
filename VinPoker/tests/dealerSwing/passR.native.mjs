// Actual whole-module PassR qualification entry. Run with Deno, cached modules
// only and runtime network denied. No production client or function is created.
import assert from 'node:assert/strict';

const planner=await import('../../supabase/functions/process-swing/passes/passR-rotation-planner.ts');
assert.equal(typeof planner.passRRotationPlanner,'function');
assert.equal(typeof planner.replanSingleTable,'function');
if(Deno.args.includes('--import-only'))console.log('ACTUAL_PASSR_DENO_WHOLE_MODULE_IMPORT_PASS');
else{
 assert.ok(Deno.args.includes('--native'));
 for(const [key,value] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_ops_ready_capacity_ci'}))assert.equal(Deno.env.get(key),value);
 const fixture=await new Response(Deno.stdin.readable).json();
 assert.match(fixture.role,/^ready_capacity_[a-f0-9]{32}$/);assert.match(fixture.club,/^[a-f0-9-]{36}$/);
 assert.ok([2,10,40].includes(fixture.rows.length));
 const sqlEnv=Object.fromEntries(Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_ops_ready_capacity_ci',PATH:Deno.env.get('PATH'),SystemRoot:Deno.env.get('SystemRoot')}).filter(([,v])=>v!==undefined));
 async function sql(input){const flags=['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
  const windows=Deno.build.os==='windows',args=windows?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_ready_capacity_ci','psql',...flags]:flags;
  const child=new Deno.Command(windows?'wsl':'psql',{args,clearEnv:true,env:sqlEnv,stdin:'piped',stdout:'piped',stderr:'piped'}).spawn();
  const writer=child.stdin.getWriter();await writer.write(new TextEncoder().encode(input));await writer.close();
  const result=await child.output();if(!result.success){const error=new Error('native SQL failure');error.stderr=new TextDecoder().decode(result.stderr);throw error;}
  return new TextDecoder().decode(result.stdout).trim();}
 assert.equal(await sql("SELECT current_database()||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000"),'vinpoker_ops_ready_capacity_ci|55441|17');
 assert.equal(await sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net')"),'f');
 assert.equal(await sql(`SELECT rolcanlogin||'|'||rolsuper||'|'||rolbypassrls FROM pg_roles WHERE rolname='${fixture.role}';`),'false|false|true');
 const dir=await sql('SHOW data_directory');assert.ok(dir==='/tmp/vinpoker-sol-local-20261016-0e79a729/data'||dir==='/var/lib/postgresql/data');
 const service=`SET request.jwt.claim.role='service_role';SET request.jwt.claims='{"role":"service_role"}';SET ROLE ${fixture.role};`;
 const quote=v=>v===null?'NULL':typeof v==='boolean'?(v?'true':'false'):typeof v==='number'?(assert.ok(Number.isFinite(v)),String(v)):`'${String(v).replaceAll("'","''")}'`;
 const ident=v=>(assert.match(v,/^[a-z_]+$/),v);
 const rpcNames=new Set(['count_available_dealers','end_breaks_on_demand','upsert_rotation_plan','lock_rotation_slot','cancel_rotation_slot','worker_clear_legacy_preassignment_v1','worker_adopt_legacy_preassignment_v1','get_dealer_operational_tables_v1','try_acquire_club_lock_fenced','release_club_lock_if_owner','refresh_dealer_pool_summary','get_dealer_pool_snapshot']);
 function project(row,spec){if(row===null)return null;const fields=[];let depth=0,start=0;
  for(let i=0;i<spec.length;i++){if(spec[i]==='(')depth++;if(spec[i]===')')depth--;if(spec[i]===','&&depth===0){fields.push(spec.slice(start,i).trim());start=i+1;}}fields.push(spec.slice(start).trim());
  const out={};for(const item of fields){if(item==='*')return row;const open=item.indexOf('('),raw=open<0?item:item.slice(0,open),key=raw.split('!')[0].trim();assert.match(key,/^[a-z_]+$/);assert.ok(Object.hasOwn(row,key),'unknown projected field '+key);
   out[key]=open<0?row[key]:row[key]===null?null:Array.isArray(row[key])?row[key].map(v=>project(v,item.slice(open+1,-1))):project(row[key],item.slice(open+1,-1));
  }return out;}
 const reads=[],rpcCalls=[],persistReceipts=[],adapterGaps=[];
 const admin={async rpc(name,args){if(!rpcNames.has(name))adapterGaps.push('rpc:'+name);assert.ok(rpcNames.has(name),name);rpcCalls.push(name);
  if(fixture.fault==='persist'&&name==='upsert_rotation_plan')return {data:null,error:{code:'PGRST002',message:'synthetic persist transport failure'}};
  if(fixture.fault==='lock'&&name==='lock_rotation_slot'){
   const target=await sql(service+`SELECT table_id FROM public.dealer_rotation_schedule WHERE id=${quote(args.p_schedule_id)} AND club_id='${fixture.club}';`);
   if(target===fixture.rows[0].table)return {data:null,error:{code:'PGRST002',message:'synthetic one-table lock transport failure'}};
  }
  try{const params=Object.entries(args??{}).map(([k,v])=>ident(k)+'=>'+(k==='p_rows'?quote(JSON.stringify(v))+'::jsonb':Array.isArray(v)?quote('{'+v.join(',')+'}')+'::uuid[]':quote(v))).join(',');
   const query=['end_breaks_on_demand','get_dealer_operational_tables_v1'].includes(name)?`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.${name}(${params}) r;`:`SELECT to_jsonb(public.${name}(${params}));`;
   const data=JSON.parse(await sql(service+query));
   if(name==='upsert_rotation_plan')persistReceipts.push({rows:structuredClone(args.p_rows),response:data});
   return {data,error:null};
  }catch(e){return {data:null,error:{message:String(e.stderr??e),code:String(e.stderr??'').match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]}};}
 },from(table){
  const allowedTables=['dealer_assignments','dealer_attendance','dealers','dealer_shift_metrics','dealer_breaks','dealer_meal_breaks','dealer_rotation_schedule','app_settings','dealer_table_profiles','dealer_table_pool','table_sessions','tournament_tables','diagnostic_logs','swing_config','club_settings','clubs','swing_run_metrics'];
  if(!allowedTables.includes(table))adapterGaps.push('table:'+table);assert.ok(allowedTables.includes(table),'unexpected table '+table);
  let filters=[],orders=[],limit='',patch=null,inserting=false,single=false,head=false,selection='*';
  let joins='',value='to_jsonb(b)';
  if(table==='dealer_assignments'){joins=' LEFT JOIN public.game_tables g ON g.id=b.table_id LEFT JOIN public.dealer_attendance da ON da.id=b.attendance_id LEFT JOIN public.dealers d ON d.id=da.dealer_id';value="to_jsonb(b)||jsonb_build_object('game_tables',to_jsonb(g),'dealer_attendance',to_jsonb(da)||jsonb_build_object('dealers',to_jsonb(d)))";}
  if(table==='dealer_attendance'){joins=' LEFT JOIN public.dealers d ON d.id=b.dealer_id';value="to_jsonb(b)||jsonb_build_object('dealers',to_jsonb(d))";}
  if(table==='dealer_breaks'){joins=' LEFT JOIN public.dealer_assignments da ON da.id=b.assignment_id';value="to_jsonb(b)||jsonb_build_object('dealer_assignments',to_jsonb(da))";}
  if(table==='tournament_tables'){joins=' LEFT JOIN public.tournaments t ON t.id=b.tournament_id';value="to_jsonb(b)||jsonb_build_object('tournaments',to_jsonb(t))";}
  const field=k=>{const parts=k.split('.');if(parts.length===1)return 'b.'+ident(k);assert.equal(parts.length,2);const alias={dealers:'d',dealer_assignments:'da',tournaments:'t',game_tables:'g'}[parts[0]];assert.ok(alias,k);return alias+'.'+ident(parts[1]);};
  const q={select(columns='*',options={}){selection=columns;head=options.head===true;return q;},eq(k,v){filters.push(field(k)+'='+quote(v));return q;},
   in(k,values){assert.ok(values.length<=1000);filters.push(values.length?field(k)+' IN ('+values.map(quote).join(',')+')':'false');return q;},
   is(k,v){assert.equal(v,null);filters.push(field(k)+' IS NULL');return q;},not(k,operator,v){assert.equal(operator,'is');assert.equal(v,null);filters.push(field(k)+' IS NOT NULL');return q;},
   gt(k,v){filters.push(field(k)+'>'+quote(v));return q;},gte(k,v){filters.push(field(k)+'>='+quote(v));return q;},lt(k,v){filters.push(field(k)+'<'+quote(v));return q;},lte(k,v){filters.push(field(k)+'<='+quote(v));return q;},
   or(condition){assert.equal(condition,'current_state.eq.available,current_state.eq.on_break');filters.push("b.current_state IN ('available','on_break')");return q;},
   order(k,options={}){orders.push(field(k)+(options.ascending===false?' DESC':' ASC'));return q;},limit(n){assert.ok(Number.isInteger(n)&&n<=2000);limit=' LIMIT '+n;return q;},
   update(v){assert.equal(table,'dealer_assignments');patch=v;return q;},insert(v){assert.ok(['diagnostic_logs','swing_run_metrics'].includes(table));patch=v;inserting=true;return q;},
   maybeSingle(){single=true;return execute();},single(){single=true;return execute();},then(resolve,reject){return execute().then(resolve,reject);},
  };
  async function execute(){try{
   const where=filters.length?' WHERE '+filters.join(' AND '):'';
   if(patch){const keys=Object.keys(patch).map(ident);
    if(inserting)await sql(service+`INSERT INTO public.${table}(${keys.join(',')}) SELECT ${keys.map(k=>'r.'+k).join(',')} FROM jsonb_populate_record(NULL::public.${table},${quote(JSON.stringify(patch))}::jsonb) r;`);
    else{assert.ok(filters.length);await sql(service+`UPDATE public.${table} b SET ${keys.map(k=>k+'='+quote(patch[k])).join(',')}${where};`);}
    return {data:null,error:null};
   }
   reads.push(table);
   if(fixture.fault==='dealer-inventory'&&table==='dealers')return {data:null,error:{code:'PGRST002',message:'synthetic inventory transport failure'},status:503};
   for(const [relation,alias] of [['game_tables','g'],['dealers','d'],['dealer_assignments','da'],['tournaments','t']]){
    if(selection.includes(relation+'!inner('))joins=joins.replace('LEFT JOIN public.'+relation+' '+alias,'INNER JOIN public.'+relation+' '+alias);
   }
   if(head)return {data:null,error:null,count:Number(await sql(service+`SELECT count(*) FROM public.${table} b${joins}${where};`))};
   const rows=JSON.parse(await sql(service+`SELECT coalesce(jsonb_agg(r.value),'[]') FROM (SELECT ${value} AS value FROM public.${table} b${joins}${where}${orders.length?' ORDER BY '+orders.join(','):''}${limit}) r;`));
   if(single&&rows.length>1)return {data:null,error:{message:'multiple rows'}};
   const projected=rows.map(row=>project(row,selection));return {data:single?projected[0]??null:projected,error:null};
  }catch(e){return {data:null,error:{message:String(e.stderr??e),code:String(e.stderr??'').match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]}};}}
  return q;
 }};
 let networkCalls=0;globalThis.fetch=()=>{networkCalls++;throw new Error('unexpected runtime network');};
 if(fixture.mainWorker){
  assert.equal(fixture.rows.length,2,'qualify two tables before scaling main handler');
  const names=[],values=[];for(const dependency of fixture.mainWorker.imports){assert.ok(dependency.module.startsWith(new URL('../../supabase/functions/',import.meta.url).href));const module=await import(dependency.module);
   for(const binding of dependency.names){assert.ok(Object.hasOwn(module,binding.exported),binding.exported);names.push(binding.local);values.push(module[binding.exported]);}}
  let handler;
  const runtime={env:{get:key=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-main-worker',PROCESS_SWING_INTERNAL_SECRET:'synthetic-main-internal'})[key]},serve:fn=>{assert.equal(handler,undefined);handler=fn;}};
  const createClient=(url,key)=>{assert.equal(url,'https://synthetic.invalid');assert.equal(key,'synthetic-main-worker');return admin;};
  new Function(...names,'Deno','createClient','"use strict";\n'+fixture.mainWorker.source)(...values,runtime,createClient);
  assert.equal(typeof handler,'function');
  const stateProof=()=>sql(`SELECT md5(jsonb_build_object('assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_assignments a WHERE club_id='${fixture.club}'),'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${fixture.club}'),'schedule',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.dealer_rotation_schedule s WHERE club_id='${fixture.club}'))::text);`);
  const before=await stateProof();
  const response=await handler(new Request('https://synthetic.invalid/functions/v1/process-swing',{method:'POST',headers:{Authorization:'Bearer synthetic-main-worker','Content-Type':'application/json'},body:JSON.stringify({club_id:fixture.club})}));
  const body=await response.json();console.log(JSON.stringify({passR_actual_result:{phase:'main-handler',status:response.status,body,reads:[...new Set(reads)],rpcCalls,adapterGaps,networkCalls}}));
  assert.equal(response.status,200);assert.equal(networkCalls,0);assert.deepEqual(adapterGaps,[]);
  if(fixture.mainOff){
   assert.equal(body.status,'completed');assert.equal(body.error_code,null);assert.deepEqual(body.metrics,{});assert.deepEqual(body.diagnostics,[]);
   assert.equal(await stateProof(),before);assert.ok(!rpcCalls.includes('upsert_rotation_plan'));assert.ok(!rpcCalls.includes('get_dealer_pool_snapshot'));
   console.log('ACTUAL_PASSR_MAIN_HANDLER_AUTO_OFF_PASS');
  }else if(fixture.fault==='dealer-inventory'){
   assert.ok(Object.hasOwn(body.metrics,fixture.club));
   assert.equal(await stateProof(),before);assert.ok(!rpcCalls.includes('upsert_rotation_plan'));assert.equal(body.status,'partial');assert.equal(body.error_code,'dealer_inventory_query_failed');
   assert.ok(body.diagnostics.some(d=>d.stage==='dealer_inventory'&&d.code==='PGRST002'));
   console.log('ACTUAL_PASSR_MAIN_HANDLER_INVENTORY_FAILURE_PASS');
  }else{
  assert.equal(body.status,'completed');assert.ok(rpcCalls.includes('upsert_rotation_plan'));
  assert.equal(await sql(`SELECT count(*) FROM public.dealer_rotation_schedule WHERE club_id='${fixture.club}' AND slot_index=0 AND status='announced';`),'2');
  console.log('ACTUAL_PASSR_MAIN_HANDLER_NATIVE_PASS');
  }
 }else{
 const immutableSnapshot=()=>sql(service+`SELECT md5(jsonb_build_object('assignments',(SELECT jsonb_agg(to_jsonb(a)-ARRAY['overtime_started_at','updated_at','version'] ORDER BY a.id) FROM public.dealer_assignments a WHERE club_id='${fixture.club}'),'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${fixture.club}'))::text);`);
 const beforeFault=fixture.fault?await immutableSnapshot():null;
 const context={clubId:fixture.club,clubZone:null,chatId:null,botToken:null,cycleExcludedIds:new Set(),preAnnounceMinutes:3,minInterSwingRestMinutes:15,clubBreakDurationMinutes:15,swingDurationMinutes:45,tierAMinBuyin:10000000,tierBMinBuyin:5000000,requiredGameTypes:[]};
 const result=await planner.passRRotationPlanner(admin,context);
 console.log(JSON.stringify({passR_actual_result:result,reads:[...new Set(reads)],rpcCalls,networkCalls}));
 if(fixture.fault){
  assert.ok(result.errors.length>0);assert.equal(result.shortageTables,0);assert.equal(networkCalls,0);
  if(fixture.fault==='dealer-inventory'){assert.equal(result.candidateStatus,'query_failed');assert.equal(result.candidateErrorCode,'candidate_club_dealers_query_failed');}
  if(fixture.fault==='lock'){
   assert.equal(result.locked,fixture.rows.length-1);
   assert.equal(await sql(`SELECT count(*) FROM public.dealer_rotation_schedule s JOIN public.dealer_attendance d ON d.id=s.in_attendance_id WHERE s.club_id='${fixture.club}' AND s.table_id='${fixture.rows[0].table}' AND s.slot_index=0 AND s.status='predicted' AND d.current_state='available' AND d.pre_assigned_table_id IS NULL;`),'1');
   assert.equal(await sql(`SELECT count(*) FROM public.dealer_rotation_schedule WHERE club_id='${fixture.club}' AND slot_index=0 AND status='announced';`),String(fixture.rows.length-1));
  }else{
   assert.equal(result.locked,0);assert.equal(await immutableSnapshot(),beforeFault,'failed supply/persist must not reserve or release any dealer; independent OT marker excluded');
   assert.equal(await sql(`SELECT count(*) FROM public.dealer_rotation_schedule WHERE club_id='${fixture.club}';`),'0');
  }
  const fault=fixture.fault;fixture.fault=undefined;
  const recovered=await planner.passRRotationPlanner(admin,{...context,cycleExcludedIds:new Set()});
  assert.deepEqual(recovered.errors,[]);assert.equal(recovered.shortageTables,0);assert.equal(recovered.locked,fixture.rows.length-result.locked);
  assert.equal(await sql(`SELECT count(*) FROM public.dealer_rotation_schedule WHERE club_id='${fixture.club}' AND slot_index=0 AND status='announced';`),String(fixture.rows.length));
  const lockedProof=()=>sql(`SELECT jsonb_agg(jsonb_build_object('id',id,'table_id',table_id,'incoming',in_attendance_id,'relief',planned_relief_at) ORDER BY table_id) FROM public.dealer_rotation_schedule WHERE club_id='${fixture.club}' AND slot_index=0 AND status='announced';`);
  const committed=await lockedProof();
  const repeated=await planner.passRRotationPlanner(admin,{...context,cycleExcludedIds:new Set()});
  console.log(JSON.stringify({passR_actual_result:{phase:'repeat-recovery-diagnostic',fault,recovered,repeated,persistResponse:persistReceipts.at(-1)?.response,liveSessions:Number(await sql(`SELECT count(*) FROM public.table_sessions WHERE club_id='${fixture.club}' AND closed_at IS NULL;`)),announced:Number(await sql(`SELECT count(*) FROM public.dealer_rotation_schedule WHERE club_id='${fixture.club}' AND slot_index=0 AND status='announced';`))}}));
  assert.equal(await lockedProof(),committed,'healthy subsequent tick preserves committed lock IDs and relief times');
  assert.equal(networkCalls,0);assert.deepEqual(repeated.errors,[]);assert.equal(repeated.locked,0);
  const validRows=structuredClone(persistReceipts.at(-1).rows);
  const target=fixture.rows[0].table;
  assert.equal(validRows.filter(r=>r.locked_anchor===true).length,fixture.rows.length);
  const otherAnchor=validRows.find(r=>r.table_id!==target&&r.locked_anchor===true);assert.ok(otherAnchor);
  const allProof=()=>sql(`SELECT md5(jsonb_build_object('schedule',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.dealer_rotation_schedule s WHERE club_id='${fixture.club}'),'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_assignments a WHERE club_id='${fixture.club}'),'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.table_sessions s WHERE club_id='${fixture.club}'),'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${fixture.club}'))::text);`);
  const proof=await allProof();
  for(const [field,wrong] of Object.entries({
   table_session_id:fixture.rows[1].session,
   assignment_id:otherAnchor.assignment_id,
   out_attendance_id:otherAnchor.out_attendance_id,
   in_attendance_id:otherAnchor.in_attendance_id,
   locked_schedule_id:crypto.randomUUID(),
   locked_schedule_version:999999,
   locked_anchor:false,
   planned_relief_at:new Date(Date.now()+86400000).toISOString(),
  })){
   const rows=structuredClone(validRows),anchor=rows.find(r=>r.table_id===target&&r.locked_anchor===true);assert.ok(anchor);
   anchor[field]=wrong;
   const invalid=await admin.rpc('upsert_rotation_plan',{p_club_id:fixture.club,p_plan_run_id:crypto.randomUUID(),p_rows:rows,p_table_ids:fixture.rows.map(r=>r.table)});
   assert.equal(invalid.error,null);assert.equal(invalid.data.outcome,'ok');assert.deepEqual(invalid.data.rejected_table_ids,[target],field+' quarantines only stale table');
   assert.equal(await allProof(),proof,field+' must not supersede forecast or change lock/assignment');
  }
  console.log('ACTUAL_PASSR_LOCKED_ANCHOR_NEGATIVE_PASS');
  const originalAnchor=validRows.find(r=>r.table_id===target&&r.locked_anchor===true);
  const cancelled=await admin.rpc('cancel_rotation_slot',{p_schedule_id:originalAnchor.locked_schedule_id,p_reason:'reconcile_lock_lost'});
  assert.equal(cancelled.error,null);assert.equal(cancelled.data.outcome,'cancelled');
  async function rejectStale(label){const before=await allProof();
   const stale=await admin.rpc('upsert_rotation_plan',{p_club_id:fixture.club,p_plan_run_id:crypto.randomUUID(),p_rows:validRows,p_table_ids:fixture.rows.map(r=>r.table)});
   assert.equal(stale.error,null);assert.equal(stale.data.outcome,'ok');assert.deepEqual(stale.data.rejected_table_ids,[target],label);assert.equal(await allProof(),before,label+' zero operational delta');
  }
  await rejectStale('cancelled exact lock cannot anchor forecasts');
  const operator=`SET request.jwt.claim.role='authenticated';SET request.jwt.claim.sub='${fixture.owner}';SET request.jwt.claims='{"role":"authenticated","sub":"${fixture.owner}"}';SET ROLE authenticated;`;
  const revision=Number(await sql(`SELECT revision FROM public.table_sessions WHERE id='${fixture.rows[0].session}';`));
  const closed=JSON.parse(await sql(operator+`SELECT public.operator_close_club_table_v2('${fixture.rows[0].session}',${revision},'${crypto.randomUUID()}');`));assert.equal(closed.ok,true);
  const opened=JSON.parse(await sql(operator+`SELECT public.operator_open_club_tables_v2(ARRAY['${target}'::uuid],'cash','${crypto.randomUUID()}');`));assert.equal(opened.ok,true);
  const newSession=await sql(`SELECT id FROM public.table_sessions WHERE game_table_id='${target}' AND closed_at IS NULL;`);assert.notEqual(newSession,fixture.rows[0].session);
  const assigned=JSON.parse(await sql(service+`SELECT public.worker_assign_dealer_to_session_v1('${fixture.club}','${target}','${newSession}','${originalAnchor.in_attendance_id}',now()+interval '45 minutes','anchor107_${crypto.randomUUID()}');`));assert.equal(assigned.outcome,'ok');
  await rejectStale('reopened physical table with new assignment rejects prior anchor');
  console.log('ACTUAL_PASSR_LOCKED_ANCHOR_CANCEL_REOPEN_PASS');
  console.log(JSON.stringify({passR_actual_result:{fault,recovered,repeated,lockedProofStable:true}}));
  console.log('ACTUAL_PASSR_NATIVE_MODULE_FAULT_PASS '+fault);
 }else{
 assert.deepEqual(result.errors,[]);assert.equal(result.candidateStatus,undefined);assert.ok(result.planned>=fixture.rows.length);assert.equal(result.locked,fixture.shortage||fixture.adopt?0:fixture.rows.length);assert.equal(result.adopted,fixture.adopt?fixture.rows.length:0);assert.equal(result.shortageTables,fixture.shortage?fixture.rows.length:0);assert.equal(networkCalls,0);
 assert.equal(await sql(`SELECT count(DISTINCT table_id) FROM public.dealer_rotation_schedule WHERE club_id='${fixture.club}' AND slot_index=0 AND status IN ('predicted','announced');`),String(fixture.rows.length));
 if(fixture.shortage){
  assert.equal(await sql(`SELECT count(*) FROM public.dealer_rotation_schedule WHERE club_id='${fixture.club}' AND slot_index=0 AND status='predicted' AND is_shortage AND in_attendance_id IS NULL;`),String(fixture.rows.length));
  assert.equal(await sql(`SELECT count(*) FROM public.dealer_assignments a JOIN public.dealer_attendance d ON d.id=a.attendance_id WHERE a.club_id='${fixture.club}' AND a.status='assigned' AND a.released_at IS NULL AND a.pre_assigned_attendance_id IS NULL AND a.overtime_started_at IS NOT NULL AND d.current_state='assigned';`),String(fixture.rows.length));
  assert.equal(await sql(`SELECT count(*) FROM public.dealer_assignments WHERE club_id='${fixture.club}' AND released_at IS NOT NULL;`),'0');
 }else{
  assert.equal(await sql(`SELECT count(*) FROM public.dealer_rotation_schedule s JOIN public.dealer_assignments a ON a.id=s.assignment_id JOIN public.table_sessions ts ON ts.id=a.table_session_id JOIN public.dealer_attendance dat ON dat.id=s.in_attendance_id WHERE s.club_id='${fixture.club}' AND s.slot_index=0 AND s.status='announced' AND s.table_id=a.table_id AND a.club_id=s.club_id AND a.released_at IS NULL AND a.pre_assigned_attendance_id=s.in_attendance_id AND ts.game_table_id=a.table_id AND ts.club_id=a.club_id AND ts.closed_at IS NULL AND dat.current_state='pre_assigned' AND dat.pre_assigned_table_id=a.table_id;`),String(fixture.rows.length));
  assert.equal(await sql(`SELECT count(DISTINCT in_attendance_id) FROM public.dealer_rotation_schedule WHERE club_id='${fixture.club}' AND slot_index=0 AND status='announced';`),String(fixture.rows.length));
 }
 if(fixture.adopt){
  const adoptionProof=()=>sql(`SELECT jsonb_agg(jsonb_build_object('id',id,'assignment',assignment_id,'incoming',in_attendance_id,'relief',planned_relief_at,'version',version) ORDER BY table_id) FROM public.dealer_rotation_schedule WHERE club_id='${fixture.club}' AND slot_index=0 AND status='announced';`);
  const adopted=await adoptionProof(),repeat=await planner.passRRotationPlanner(admin,{...context,cycleExcludedIds:new Set()});
  assert.deepEqual(repeat.errors,[]);assert.equal(repeat.adopted,0);assert.equal(repeat.locked,0);assert.equal(await adoptionProof(),adopted);assert.equal(networkCalls,0);
  console.log(JSON.stringify({passR_actual_result:{phase:'post-adoption-repeat',repeat,adoptionProofStable:true}}));
 }
 console.log('ACTUAL_PASSR_NATIVE_MODULE_PASS '+fixture.rows.length+(fixture.shortage?' shortage':fixture.adopt?' adoption':''));
 }
}
}
