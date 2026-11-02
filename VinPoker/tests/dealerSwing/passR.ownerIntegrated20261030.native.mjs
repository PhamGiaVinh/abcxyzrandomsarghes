// Actual whole-module PassR qualification entry. Run with Deno, cached modules
// only and runtime network denied. No production client or function is created.
import assert from 'node:assert/strict';

const planner=await import('../../supabase/functions/process-swing/passes/passR-rotation-planner.ts');
assert.equal(typeof planner.passRRotationPlanner,'function');
assert.equal(typeof planner.replanSingleTable,'function');
if(Deno.args.includes('--import-only'))console.log('ACTUAL_PASSR_DENO_WHOLE_MODULE_IMPORT_PASS');
else{
 assert.ok(Deno.args.includes('--native'));
 for(const [key,value] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_worker_integrated_20261030'}))assert.equal(Deno.env.get(key),value);
 const fixture=await new Response(Deno.stdin.readable).json();
 assert.match(fixture.role,/^ready_capacity_[a-f0-9]{32}$/);assert.match(fixture.club,/^[a-f0-9-]{36}$/);
 assert.ok([2,10,40].includes(fixture.rows.length));
 const sqlEnv=Object.fromEntries(Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_worker_integrated_20261030',PATH:Deno.env.get('PATH'),SystemRoot:Deno.env.get('SystemRoot')}).filter(([,v])=>v!==undefined));
 async function sql(input){const flags=['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
  const windows=Deno.build.os==='windows',args=windows?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_worker_integrated_20261030','psql',...flags]:flags;
  const child=new Deno.Command(windows?'wsl':'psql',{args,clearEnv:true,env:sqlEnv,stdin:'piped',stdout:'piped',stderr:'piped'}).spawn();
  const writer=child.stdin.getWriter();await writer.write(new TextEncoder().encode(input));await writer.close();
  const result=await child.output();if(!result.success){const stderr=new TextDecoder().decode(result.stderr);const error=new Error('native SQL failure: '+stderr.slice(0,400));error.stderr=stderr;throw error;}
  return new TextDecoder().decode(result.stdout).trim();}
 assert.equal(await sql("SELECT current_database()||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000"),'vinpoker_worker_integrated_20261030|55441|17');
 assert.equal(await sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net')"),'f');
 assert.equal(await sql(`SELECT rolcanlogin||'|'||rolsuper||'|'||rolbypassrls FROM pg_roles WHERE rolname='${fixture.role}';`),'false|false|true');
 const dir=await sql('SHOW data_directory');assert.ok(dir==='/tmp/vinpoker-sol-local-20261016-0e79a729/data'||dir==='/var/lib/postgresql/data');
 const service=`SET request.jwt.claim.role='service_role';SET request.jwt.claims='{"role":"service_role"}';SET ROLE ${fixture.role};`;
 const quote=v=>v===null?'NULL':typeof v==='boolean'?(v?'true':'false'):typeof v==='number'?(assert.ok(Number.isFinite(v)),String(v)):`'${String(v).replaceAll("'","''")}'`;
 const ident=v=>(assert.match(v,/^[a-z_]+$/),v);
 const rpcNames=new Set(['count_available_dealers','end_breaks_on_demand','upsert_rotation_plan','lock_rotation_slot','cancel_rotation_slot','worker_clear_legacy_preassignment_v1','worker_adopt_legacy_preassignment_v1','get_dealer_operational_tables_v1','try_acquire_club_lock_fenced','release_club_lock_if_owner','refresh_dealer_pool_summary','get_dealer_pool_snapshot','detect_stuck_breaks','end_expired_breaks','get_escalation_config','reconcile_dealer_states','extend_club_lock_lease','club_local_date','advance_dealer_shortage_alert_incident','complete_dealer_shortage_alert_notification','calculate_dynamic_swing_duration','worker_execute_pre_assigned_swing','worker_execute_rotation_slot_v1','complete_rotation_slot']);
 rpcNames.add('get_dealer_pool_eligible_attendance_v1');rpcNames.add('claim_process_swing_dispatch');rpcNames.add('finish_process_swing_dispatch');rpcNames.add('release_club_lock');
 function project(row,spec){if(row===null)return null;const fields=[];let depth=0,start=0;
  for(let i=0;i<spec.length;i++){if(spec[i]==='(')depth++;if(spec[i]===')')depth--;if(spec[i]===','&&depth===0){fields.push(spec.slice(start,i).trim());start=i+1;}}fields.push(spec.slice(start).trim());
  const out={};for(const item of fields){if(item==='*')return row;const open=item.indexOf('('),raw=open<0?item:item.slice(0,open),key=raw.split('!')[0].trim();assert.match(key,/^[a-z_]+$/);assert.ok(Object.hasOwn(row,key),'unknown projected field '+key);
   out[key]=open<0?row[key]:row[key]===null?null:Array.isArray(row[key])?row[key].map(v=>project(v,item.slice(open+1,-1))):project(row[key],item.slice(open+1,-1));
  }return out;}
 const reads=[],rpcCalls=[],rpcResponses=[],persistReceipts=[],adapterGaps=[],bridgeErrors=[];
 const lostExecutionResponses=[];let dropExecutionResponse=false;
 const dispatchFinalizations=[];
 let successorLease=null;
 const admin={rpc(name,args){const task=(async()=>{if(!rpcNames.has(name))adapterGaps.push('rpc:'+name);assert.ok(rpcNames.has(name),name);rpcCalls.push(name);
  if(name==='finish_process_swing_dispatch')dispatchFinalizations.push(structuredClone(args));
  if(fixture.fault==='persist'&&name==='upsert_rotation_plan')return {data:null,error:{code:'PGRST002',message:'synthetic persist transport failure'}};
  if(fixture.fault==='lock'&&name==='lock_rotation_slot'){
   const target=await sql(service+`SELECT table_id FROM public.dealer_rotation_schedule WHERE id=${quote(args.p_schedule_id)} AND club_id='${fixture.club}';`);
   if(target===fixture.rows[0].table)return {data:null,error:{code:'PGRST002',message:'synthetic one-table lock transport failure'}};
  }
  if(!successorLease&&(name==='try_acquire_club_lock_fenced'&&fixture.lockFault==='held'||name==='extend_club_lock_lease'&&fixture.lockFault==='reclaimed')){
   assert.equal(args.p_club_id,fixture.club);
   if(fixture.lockFault==='reclaimed'){
    // Explicit control-plane expiry injection, NOT a dealer rest/time proof.
    assert.equal(await sql(`UPDATE public.club_processing_locks SET expires_at=clock_timestamp()-interval '1 second' WHERE club_id='${fixture.club}' AND lock_token=${quote(args.p_lock_token)} RETURNING club_id;`),fixture.club);
   }
   successorLease=JSON.parse(await sql(service+`SELECT public.try_acquire_club_lock_fenced('${fixture.club}',120,'native-successor');`));assert.equal(successorLease.acquired,true);assert.notEqual(successorLease.lock_token,args.p_lock_token);
  }
  try{const params=Object.entries(args??{}).map(([k,v])=>ident(k)+'=>'+(k==='p_rows'||v!==null&&typeof v==='object'&&!Array.isArray(v)?quote(JSON.stringify(v))+'::jsonb':Array.isArray(v)?quote('{'+v.join(',')+'}')+'::uuid[]':quote(v)+(k==='p_severity'?'::smallint':''))).join(',');
   const query=name==='get_dealer_pool_eligible_attendance_v1'?`SELECT coalesce(jsonb_agg(jsonb_build_object('attendance_id',r.attendance_id)),'[]') FROM public.${name}(${params}) r;`:['end_breaks_on_demand','get_dealer_operational_tables_v1','detect_stuck_breaks','end_expired_breaks','get_escalation_config'].includes(name)?`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.${name}(${params}) r;`:`SELECT coalesce(to_jsonb(public.${name}(${params})),'null'::jsonb);`;
   const data=JSON.parse(await sql(service+query));
   rpcResponses.push({name,data});
   if(name==='try_acquire_club_lock_fenced'&&fixture.lockFault==='missing-token')return {data:{...data,lock_token:null},error:null};
   if(name==='try_acquire_club_lock_fenced'&&fixture.lockFault==='malformed-token')return {data:{...data,lock_token:'not-a-uuid'},error:null};
   if(name==='try_acquire_club_lock_fenced'&&fixture.lockFault==='wrong-acquired')return {data:{...data,acquired:'true'},error:null};
   if(dropExecutionResponse&&name==='worker_execute_rotation_slot_v1'){
    assert.equal(data.status,'success');
    lostExecutionResponses.push({args:structuredClone(args),result:data});
    return {data:null,error:{code:'FETCH_ERROR',message:'synthetic response lost after SQL commit'}};
   }
   if(name==='upsert_rotation_plan')persistReceipts.push({rows:structuredClone(args.p_rows),response:data});
   return {data,error:null};
  }catch(e){bridgeErrors.push({scope:'rpc:'+name,error:String(e.stderr??e).slice(0,300)});return {data:null,error:{message:String(e.stderr??e),code:String(e.stderr??'').match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]}};}
 })();task.single=async()=>{const r=await task;if(r.error)return r;if(!Array.isArray(r.data)||r.data.length!==1)return {data:null,error:{message:'single RPC row expected'}};return {...r,data:r.data[0]};};return task;
 },from(table){
  const allowedTables=['dealer_assignments','dealer_attendance','dealers','dealer_shift_metrics','dealer_breaks','dealer_meal_breaks','dealer_rotation_schedule','app_settings','dealer_table_profiles','dealer_table_pool','table_sessions','tournament_tables','diagnostic_logs','swing_config','swing_configs','club_settings','clubs','swing_run_metrics','swing_metrics','game_tables','dealer_shifts','tournaments','dealer_open_operations','dealer_open_operation_targets'];
  if(!allowedTables.includes(table))adapterGaps.push('table:'+table);assert.ok(allowedTables.includes(table),'unexpected table '+table);
  let filters=[],orders=[],limit='',patch=null,inserting=false,upserting=false,single=false,head=false,returning=false,selection='*';
  let joins='',value='to_jsonb(b)';
  if(table==='dealer_assignments'){joins=' LEFT JOIN public.game_tables g ON g.id=b.table_id LEFT JOIN public.dealer_attendance da ON da.id=b.attendance_id LEFT JOIN public.dealers d ON d.id=da.dealer_id';value="to_jsonb(b)||jsonb_build_object('game_tables',to_jsonb(g),'dealer_attendance',to_jsonb(da)||jsonb_build_object('dealers',to_jsonb(d)))";}
  if(table==='dealer_attendance'){joins=' LEFT JOIN public.dealers d ON d.id=b.dealer_id';value="to_jsonb(b)||jsonb_build_object('dealers',to_jsonb(d))";}
  if(table==='dealer_breaks'){joins=' LEFT JOIN public.dealer_assignments da ON da.id=b.assignment_id';value="to_jsonb(b)||jsonb_build_object('dealer_assignments',to_jsonb(da))";}
  if(table==='tournament_tables'){joins=' LEFT JOIN public.tournaments t ON t.id=b.tournament_id';value="to_jsonb(b)||jsonb_build_object('tournaments',to_jsonb(t))";}
  if(table==='tournaments'){joins=' LEFT JOIN LATERAL (SELECT jsonb_agg(to_jsonb(tt)) AS rows FROM public.tournament_tables tt WHERE tt.tournament_id=b.id) tt ON true';value="to_jsonb(b)||jsonb_build_object('tournament_tables',coalesce(tt.rows,'[]'::jsonb))";}
  const field=k=>{const parts=k.split('.');if(parts.length===1)return 'b.'+ident(k);assert.equal(parts.length,2);const alias={dealers:'d',dealer_assignments:'da',tournaments:'t',game_tables:'g'}[parts[0]];assert.ok(alias,k);return alias+'.'+ident(parts[1]);};
  const q={select(columns='*',options={}){selection=columns;head=options.head===true;returning=patch!==null;return q;},eq(k,v){filters.push(field(k)+'='+quote(v));return q;},
   in(k,values){assert.ok(values.length<=1000);filters.push(values.length?field(k)+' IN ('+values.map(quote).join(',')+')':'false');return q;},
   is(k,v){assert.equal(v,null);filters.push(field(k)+' IS NULL');return q;},not(k,operator,v){assert.equal(operator,'is');assert.equal(v,null);filters.push(field(k)+' IS NOT NULL');return q;},
   gt(k,v){filters.push(field(k)+'>'+quote(v));return q;},gte(k,v){filters.push(field(k)+'>='+quote(v));return q;},lt(k,v){filters.push(field(k)+'<'+quote(v));return q;},lte(k,v){filters.push(field(k)+'<='+quote(v));return q;},
   or(condition){
    if(condition==='current_state.eq.available,current_state.eq.on_break')filters.push("b.current_state IN ('available','on_break')");
    else if(condition==='pre_assigned_table_id.is.null,pre_assigned_at.is.null')filters.push('(b.pre_assigned_table_id IS NULL OR b.pre_assigned_at IS NULL)');
    else if(condition.startsWith('last_critical_alert_at.is.null,last_critical_alert_at.lt.'))filters.push('(b.last_critical_alert_at IS NULL OR b.last_critical_alert_at<'+quote(condition.slice('last_critical_alert_at.is.null,last_critical_alert_at.lt.'.length))+')');
    else{adapterGaps.push('or:'+condition);assert.fail('unsupported OR grammar');}return q;
   },
   order(k,options={}){orders.push(field(k)+(options.ascending===false?' DESC':' ASC'));return q;},limit(n){assert.ok(Number.isInteger(n)&&n<=2000);limit=' LIMIT '+n;return q;},
   update(v){assert.equal(table,'dealer_assignments');patch=v;return q;},insert(v){assert.ok(['diagnostic_logs','swing_run_metrics'].includes(table));patch=v;inserting=true;return q;},
   upsert(v,options){assert.equal(table,'swing_metrics');assert.deepEqual(options,{onConflict:'club_id,date',ignoreDuplicates:false});patch=v;inserting=true;upserting=true;return q;},
   maybeSingle(){single=true;return execute();},single(){single=true;return execute();},then(resolve,reject){return execute().then(resolve,reject);},
  };
  async function execute(){try{
   const where=filters.length?' WHERE '+filters.join(' AND '):'';
   if(patch){const keys=Object.keys(patch).map(ident);
    if(inserting)await sql(service+`INSERT INTO public.${table}(${keys.join(',')}) SELECT ${keys.map(k=>'r.'+k).join(',')} FROM jsonb_populate_record(NULL::public.${table},${quote(JSON.stringify(patch))}::jsonb) r${upserting?' ON CONFLICT(club_id,date) DO UPDATE SET '+keys.filter(k=>!['club_id','date'].includes(k)).map(k=>k+'=EXCLUDED.'+k).join(','):''};`);
    else{assert.ok(filters.length);const update=`UPDATE public.${table} b SET ${keys.map(k=>k+'='+quote(patch[k])).join(',')}${where}`;
     if(returning){assert.ok(!selection.includes('('),'only scalar UPDATE RETURNING projections are supported');
      const rows=JSON.parse(await sql(service+`WITH updated AS (${update} RETURNING to_jsonb(b) AS value) SELECT coalesce(jsonb_agg(value),'[]') FROM updated;`));
      if(single&&rows.length>1)return {data:null,error:{code:'PGRST116',message:'multiple update rows'}};
      const projected=rows.map(row=>project(row,selection));return {data:single?projected[0]??null:projected,error:null};
     }await sql(service+update+';');}
    return {data:null,error:null};
   }
   reads.push(table);
   if(fixture.fault==='dealer-inventory'&&table==='dealers')return {data:null,error:{code:'PGRST002',message:'synthetic inventory transport failure'},status:503};
   const innerArray=table==='tournaments'&&selection.includes('tournament_tables!inner(')?(where?' AND ':' WHERE ')+'tt.rows IS NOT NULL':'';
   for(const [relation,alias] of [['game_tables','g'],['dealers','d'],['dealer_assignments','da'],['tournaments','t']]){
    if(selection.includes(relation+'!inner('))joins=joins.replace('LEFT JOIN public.'+relation+' '+alias,'INNER JOIN public.'+relation+' '+alias);
   }
   if(head)return {data:null,error:null,count:Number(await sql(service+`SELECT count(*) FROM public.${table} b${joins}${where}${innerArray};`))};
   const rows=JSON.parse(await sql(service+`SELECT coalesce(jsonb_agg(r.value),'[]') FROM (SELECT ${value} AS value FROM public.${table} b${joins}${where}${innerArray}${orders.length?' ORDER BY '+orders.join(','):''}${limit}) r;`));
   if(single&&rows.length>1)return {data:null,error:{message:'multiple rows'}};
   const projected=rows.map(row=>project(row,selection));return {data:single?projected[0]??null:projected,error:null};
  }catch(e){bridgeErrors.push({scope:'query:'+table,error:String(e.stderr??e).slice(0,300)});return {data:null,error:{message:String(e.stderr??e),code:String(e.stderr??'').match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]}};}}
  return q;
 }};
 let networkCalls=0;globalThis.fetch=()=>{networkCalls++;throw new Error('unexpected runtime network');};
 if(fixture.mainWorker){
  const tableCount=fixture.rows.length;assert.ok([2,10,40].includes(tableCount));
  if(fixture.shortageScope)assert.equal(tableCount,2,'scope transition fixture uses exactly two tables');
  const names=[],values=[];for(const dependency of fixture.mainWorker.imports){assert.ok(dependency.module.startsWith(new URL('../../supabase/functions/',import.meta.url).href));const module=await import(dependency.module);
   for(const binding of dependency.names){assert.ok(Object.hasOwn(module,binding.exported),binding.exported);names.push(binding.local);values.push(module[binding.exported]);}}
  let handler;
  const runtime={env:{get:key=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-main-worker',PROCESS_SWING_INTERNAL_SECRET:'synthetic-main-internal'})[key]},serve:fn=>{assert.equal(handler,undefined);handler=fn;}};
  const createClient=(url,key)=>{assert.equal(url,'https://synthetic.invalid');assert.equal(key,'synthetic-main-worker');return admin;};
  new Function(...names,'Deno','createClient','"use strict";\n'+fixture.mainWorker.source)(...values,runtime,createClient);
  assert.equal(typeof handler,'function');
  const stateProof=()=>sql(`SELECT md5(jsonb_build_object('assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_assignments a WHERE club_id='${fixture.club}'),'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${fixture.club}'),'schedule',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.dealer_rotation_schedule s WHERE club_id='${fixture.club}'))::text);`);
  async function qualifyDispatch(){
   async function envelope(expired=false){
    const run=crypto.randomUUID(),request=crypto.randomUUID(),tick=new Date().toISOString();
    // Explicit test ledger fixture; no pg_net transport/cron is invoked.
    await sql(`INSERT INTO public.process_swing_dispatch_runs(run_id,request_id,club_id,tick_at,request_fingerprint,lease_token,lease_expires_at,enqueue_state,enqueued_at) VALUES('${run}','${request}','${fixture.club}','${tick}','native-dispatch:${run}','${crypto.randomUUID()}',now()+interval '${expired?'-1 second':'115 seconds'}','enqueued',now());`);
    return {run_id:run,request_id:request,club_id:fixture.club,tick_at:tick};
   }
   const dispatch=async body=>{const response=await handler(new Request('https://synthetic.invalid/functions/v1/process-swing',{method:'POST',headers:{Authorization:'Bearer synthetic-main-worker','Content-Type':'application/json'},body:JSON.stringify(body)}));return {status:response.status,body:await response.json()};};
   const active=await envelope(),before=await stateProof();
   const mismatch=await dispatch({...active,request_id:crypto.randomUUID()});assert.equal(mismatch.status,409);assert.equal(mismatch.body.error_code,'dispatch_scope_mismatch');assert.equal(await stateProof(),before);
   const missing=await dispatch({...active,run_id:crypto.randomUUID()});assert.equal(missing.status,409);assert.equal(missing.body.error_code,'dispatch_unknown_request');assert.equal(await stateProof(),before);
   const first=await dispatch(active);assert.equal(first.status,200);assert.equal(first.body.status,'completed');assert.equal(first.body.run_id,active.run_id);assert.equal(first.body.request_id,active.request_id);assert.equal(first.body.error_code,null);
   assert.equal(await sql(`SELECT business_state||'|'||(business_error_code IS NULL)::text FROM public.process_swing_dispatch_runs WHERE run_id='${active.run_id}';`),'completed|true');
   assert.deepEqual(JSON.parse(await sql(`SELECT jsonb_agg(state ORDER BY state) FROM public.process_swing_dispatch_events WHERE run_id='${active.run_id}';`)),['completed','received','started']);
   const committed=await stateProof(),calls=rpcCalls.length;
   const duplicate=await dispatch(active);assert.equal(duplicate.status,200);assert.equal(duplicate.body.status,'duplicate');assert.equal(duplicate.body.business_state,'completed');assert.deepEqual(rpcCalls.slice(calls),['claim_process_swing_dispatch']);assert.equal(await stateProof(),committed);
   const runProof=await sql(`SELECT to_jsonb(r) FROM public.process_swing_dispatch_runs r WHERE run_id='${active.run_id}';`);
   const finish={p_run_id:active.run_id,p_request_id:active.request_id,p_club_id:fixture.club,p_business_state:'completed',p_error_code:null,p_diagnostics:{native_replay:true}};
   const replay=await admin.rpc('finish_process_swing_dispatch',finish);assert.equal(replay.error,null);assert.equal(replay.data.outcome,'idempotent_replay');
   const conflict=await admin.rpc('finish_process_swing_dispatch',{...finish,p_business_state:'partial'});assert.equal(conflict.error,null);assert.equal(conflict.data.outcome,'idempotency_conflict');assert.equal(await stateProof(),committed);
   assert.equal(await sql(`SELECT to_jsonb(r) FROM public.process_swing_dispatch_runs r WHERE run_id='${active.run_id}';`),runProof,'finish replay/conflict cannot rewrite recorded diagnostics');
   for(const role of ['anon','authenticated'])for(const [name,call] of [
    ['claim_process_swing_dispatch',`public.claim_process_swing_dispatch('${active.run_id}','${active.request_id}','${fixture.club}')`],
    ['finish_process_swing_dispatch',`public.finish_process_swing_dispatch('${active.run_id}','${active.request_id}','${fixture.club}','completed',NULL,NULL)`],
   ]){
    let denied=false;try{await sql(`BEGIN;SET request.jwt.claim.role='${role}';SET request.jwt.claims='{"role":"${role}","sub":"${fixture.owner}"}';SET ROLE ${role};SELECT ${call};ROLLBACK;`);}catch(e){assert.ok(String(e.stderr??e).includes('permission denied for function '+name));denied=true;}assert.ok(denied,'dispatch control plane must not be browser callable');
   }
   const expired=await envelope(true),expiredBefore=await stateProof();
   const rejected=await dispatch(expired);assert.equal(rejected.status,409);assert.equal(rejected.body.error_code,'dispatch_lease_expired');assert.equal(await stateProof(),expiredBefore);
   assert.equal(await sql(`SELECT business_state||'|'||business_error_code FROM public.process_swing_dispatch_runs WHERE run_id='${expired.run_id}';`),'business_failed|dispatch_lease_expired');
   const expiredReplay=await dispatch(expired);assert.equal(expiredReplay.body.status,'duplicate');assert.equal(expiredReplay.body.business_state,'business_failed');assert.equal(await stateProof(),expiredBefore);
   for(const stage of ['claim','finish']){
    const target=await envelope(),name='native_dispatch_'+target.run_id.replaceAll('-','');
    const condition=stage==='claim'?"NEW.business_state='started'":"NEW.business_state IN ('completed','partial','locked','dependency_unavailable','business_failed')";
    const beforeFault=await stateProof();
    await sql(`CREATE FUNCTION floor_private.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.run_id='${target.run_id}'::uuid AND (${condition}) THEN RAISE EXCEPTION 'NATIVE_DISPATCH_${stage.toUpperCase()}_FAULT';END IF;RETURN NEW;END $$;CREATE TRIGGER ${name} BEFORE UPDATE ON public.process_swing_dispatch_runs FOR EACH ROW EXECUTE FUNCTION floor_private.${name}();`);
    let failed;try{failed=await dispatch(target);}finally{await sql(`DROP TRIGGER ${name} ON public.process_swing_dispatch_runs;DROP FUNCTION floor_private.${name}();`);}
    assert.equal(failed.status,503);assert.equal(failed.body.status,'dependency_unavailable');assert.equal(failed.body.error_code,stage==='claim'?'dispatch_claim_unavailable':'dispatch_finalize_unavailable');
    assert.equal(bridgeErrors.length,1);assert.equal(bridgeErrors[0].scope,'rpc:'+(stage==='claim'?'claim_process_swing_dispatch':'finish_process_swing_dispatch'));assert.ok(bridgeErrors[0].error.includes('NATIVE_DISPATCH_'+stage.toUpperCase()+'_FAULT'));bridgeErrors.length=0;
    assert.equal(await stateProof(),beforeFault,'stable operational locks cannot be replayed on dispatch faults');
    if(stage==='claim'){
     assert.equal(await sql(`SELECT business_state IS NULL FROM public.process_swing_dispatch_runs WHERE run_id='${target.run_id}';`),'t');
     assert.equal(await sql(`SELECT count(*) FROM public.process_swing_dispatch_events WHERE run_id='${target.run_id}';`),'0');
     const recovered=await dispatch(target);assert.equal(recovered.body.status,'completed');
    }else{
     assert.equal(await sql(`SELECT business_state FROM public.process_swing_dispatch_runs WHERE run_id='${target.run_id}';`),'started');
     const replayed=await dispatch(target);assert.equal(replayed.body.status,'duplicate');assert.equal(replayed.body.business_state,'started','unknown finalization must not be presented as completed');
     const original=dispatchFinalizations.find(a=>a.p_run_id===target.run_id);assert.ok(original);assert.equal(original.p_business_state,'completed');
     const recorded=await admin.rpc('finish_process_swing_dispatch',original);assert.equal(recorded.error,null);assert.equal(recorded.data.outcome,'recorded');
     const confirmed=await dispatch(target);assert.equal(confirmed.body.status,'duplicate');assert.equal(confirmed.body.business_state,'completed');
    }
    console.log(JSON.stringify({passR_actual_result:{phase:'dispatch-'+stage+'-sql-fault',club:fixture.club,run:target.run_id,response:failed,operationalStateStable:true}}));
   }
   assert.deepEqual(adapterGaps,[]);assert.deepEqual(bridgeErrors,[]);assert.equal(networkCalls,0);
   console.log(JSON.stringify({passR_actual_result:{phase:'main-dispatch-context',club:fixture.club,run:active.run_id,request:active.request_id,first,duplicate,expired:rejected,finishReplay:replay.data,finishConflict:conflict.data,networkCalls}}));
   console.log('ACTUAL_PASSR_MAIN_DISPATCH_CLAIM_FINALIZE_DUPLICATE_SCOPE_EXPIRED_PASS');
  }
  async function executeScheduled(originals){
   assert.equal(originals.length,tableCount);assert.equal(new Set(originals.map(r=>r.schedule)).size,tableCount);
   const ids=originals.map(r=>quote(r.schedule)).join(',');
   const executedCount=async()=>Number(await sql(`SELECT count(*) FROM public.dealer_rotation_schedule WHERE club_id='${fixture.club}' AND id IN (${ids}) AND status='executed';`));
   const initialExecuted=await executedCount(),expectedNew=tableCount-initialExecuted;
   const relief=Math.max(...originals.map(r=>Date.parse(r.relief)));assert.ok(Number.isFinite(relief));
   console.log(JSON.stringify({passR_actual_result:{phase:'main-execute-wait-real-lead',club:fixture.club,originals,initialExecuted,waitMs:Math.max(0,relief+1500-Date.now())}}));
   while(Date.now()<relief+1500)await new Promise(resolve=>setTimeout(resolve,Math.min(30000,relief+1500-Date.now())));
   let completed=initialExecuted,batches=0;
   if(fixture.completionFault)for(const failureStage of ['completion','receipt']){
    // Real SQL failure within completion. Before110 the executor committed
    // separately; the fixed atomic boundary must roll back the swap too.
    const suffix=fixture.club.replaceAll('-',''),name='native_'+failureStage+'_'+suffix;
    const condition=failureStage==='completion'?"NEW.status='executed'":"NEW.reason ? 'execution_receipt_v1'";
    await sql(`CREATE FUNCTION floor_private.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.club_id='${fixture.club}'::uuid AND (${condition}) THEN RAISE EXCEPTION 'NATIVE_${failureStage.toUpperCase()}_WRITE_FAULT';END IF;RETURN NEW;END $$;CREATE TRIGGER ${name} BEFORE UPDATE ON public.dealer_rotation_schedule FOR EACH ROW EXECUTE FUNCTION floor_private.${name}();`);
    let response,body;
    try{
     response=await handler(new Request('https://synthetic.invalid/functions/v1/process-swing',{method:'POST',headers:{Authorization:'Bearer synthetic-main-worker','Content-Type':'application/json'},body:JSON.stringify({club_id:fixture.club})}));body=await response.json();
    }finally{await sql(`DROP TRIGGER ${name} ON public.dealer_rotation_schedule;DROP FUNCTION floor_private.${name}();`);}
    const actualSwaps=Number(await sql(`SELECT count(*) FROM public.dealer_assignments WHERE club_id='${fixture.club}' AND attendance_id IN (${originals.map(r=>quote(r.incoming)).join(',')}) AND released_at IS NULL AND status='assigned';`));
    const actualCompleted=await executedCount();
    console.log(JSON.stringify({passR_actual_result:{phase:'main-'+failureStage+'-write-failure',club:fixture.club,status:response.status,body,actualSwaps,actualCompleted,completions:rpcResponses.filter(r=>r.name==='complete_rotation_slot'),adapterGaps,bridgeErrors,networkCalls}}));
    assert.equal(actualSwaps,0,'completion failure must roll back dealer swaps too');assert.equal(actualCompleted,0,'injected completion writes rolled back');assert.deepEqual(adapterGaps,[]);assert.equal(networkCalls,0);
    const expectedError=failureStage==='completion'?'ROTATION_EXECUTION_COMPLETION_FAILED':'NATIVE_RECEIPT_WRITE_FAULT';
    assert.equal(bridgeErrors.length,tableCount);assert.ok(bridgeErrors.every(e=>e.scope==='rpc:worker_execute_rotation_slot_v1'&&e.error.includes(expectedError)));
    bridgeErrors.length=0; // Only these explicitly injected failures were expected.
    assert.equal(body.status,'partial','failed atomic execution must not report completed');
    assert.equal(body.metrics[fixture.club].failed,tableCount);assert.equal(body.metrics[fixture.club].success,0);
    console.log('ACTUAL_PASSR_MAIN_'+failureStage.toUpperCase()+'_WRITE_FAILURE_ATOMIC_ROLLBACK_PASS');
   }
   while(completed<tableCount){
    assert.ok(++batches<=tableCount,'bounded drain must progress, never loop indefinitely');
    const dropping=fixture.executionResponseLoss&&lostExecutionResponses.length===0;
    let response;try{dropExecutionResponse=dropping;response=await handler(new Request('https://synthetic.invalid/functions/v1/process-swing',{method:'POST',headers:{Authorization:'Bearer synthetic-main-worker','Content-Type':'application/json'},body:JSON.stringify({club_id:fixture.club})}));}finally{dropExecutionResponse=false;}
    const body=await response.json(),next=await executedCount();
    console.log(JSON.stringify({passR_actual_result:{phase:'main-executed-batch',club:fixture.club,batch:batches,status:response.status,body,priorCompleted:completed,completed:next,adapterGaps,bridgeErrors,networkCalls,executions:rpcResponses.filter(r=>r.name==='worker_execute_rotation_slot_v1'),completions:rpcResponses.filter(r=>r.name==='complete_rotation_slot')}}));
    assert.equal(response.status,200);assert.equal(body.status,dropping?'partial':'completed');
    if(dropping){assert.equal(lostExecutionResponses.length,tableCount);assert.equal(body.metrics[fixture.club].failed,tableCount);assert.equal(body.metrics[fixture.club].success,0);}else assert.equal(body.error_code,null);
    assert.deepEqual(adapterGaps,[]);assert.deepEqual(bridgeErrors,[]);assert.equal(networkCalls,0);
    assert.ok(next>completed,'scheduled backlog stalled; preserve fixture for diagnosis');completed=next;
   }
   const executions=rpcResponses.filter(r=>r.name==='worker_execute_rotation_slot_v1');assert.equal(executions.length,expectedNew);assert.ok(executions.every(r=>r.data.status==='success'&&r.data.rotation_completion==='executed'));
   assert.equal(rpcResponses.filter(r=>r.name==='complete_rotation_slot').length,0,'no split bookkeeping RPC');
   if(fixture.executionResponseLoss){
    assert.equal(lostExecutionResponses.length,tableCount,'drop only real committed successes');
    const activeIds=await sql(`SELECT string_agg(id::text,',' ORDER BY id) FROM public.dealer_assignments WHERE club_id='${fixture.club}' AND released_at IS NULL AND status='assigned';`);
    for(const lost of lostExecutionResponses){
     const replay=JSON.parse(await sql(service+`SELECT public.worker_execute_rotation_slot_v1(${Object.entries(lost.args).map(([k,v])=>ident(k)+'=>'+quote(v)).join(',')});`));
     assert.deepEqual(replay,lost.result,'retry original lost request returns its committed receipt');
    }
    const beforeCalls=rpcCalls.filter(n=>n==='worker_execute_rotation_slot_v1').length;
    const response=await handler(new Request('https://synthetic.invalid/functions/v1/process-swing',{method:'POST',headers:{Authorization:'Bearer synthetic-main-worker','Content-Type':'application/json'},body:JSON.stringify({club_id:fixture.club})}));
    assert.equal((await response.json()).status,'completed');assert.equal(rpcCalls.filter(n=>n==='worker_execute_rotation_slot_v1').length,beforeCalls,'next worker tick cannot execute the old requests again');
    assert.equal(await sql(`SELECT string_agg(id::text,',' ORDER BY id) FROM public.dealer_assignments WHERE club_id='${fixture.club}' AND released_at IS NULL AND status='assigned';`),activeIds);
    console.log('ACTUAL_PASSR_MAIN_RESPONSE_LOSS_COMMITTED_RECEIPT_NO_SECOND_SWAP_PASS');
   }
   for(const old of originals){
    assert.equal(await sql(`SELECT status='executed' AND (reason->>'new_assignment_id') IS NOT NULL FROM public.dealer_rotation_schedule WHERE id='${old.schedule}';`),'t');
    assert.equal(await sql(`SELECT released_at>=${quote(old.relief)}::timestamptz AND swing_processed_at IS NOT NULL FROM public.dealer_assignments WHERE id='${old.assignment}';`),'t');
    assert.equal(await sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_id='${old.table}' AND table_session_id='${old.session}' AND attendance_id='${old.incoming}' AND status='assigned' AND released_at IS NULL;`),'1');
   }
   if(expectedNew>0||fixture.resumeOriginals){
    const first=originals.find(r=>executions.some(e=>e.data.rotation_schedule_id===r.schedule))??originals[0];assert.ok(first);
    const durable=JSON.parse(await sql(`SELECT reason->'execution_receipt_v1' FROM public.dealer_rotation_schedule WHERE id='${first.schedule}';`));assert.ok(durable?.payload&&durable?.result);
    const p=durable.payload,args={p_schedule_id:p.schedule_id,p_expected_schedule_version:p.schedule_version,p_table_session_id:p.session_id,p_old_assignment_id:p.assignment_id,p_expected_assignment_version:p.assignment_version,p_next_attendance_id:p.incoming,p_swing_due_at:p.swing_due_at,p_duration_minutes:p.duration,p_send_to_break:p.send_to_break,p_break_duration_minutes:p.break_duration};
    const call=values=>`SELECT public.worker_execute_rotation_slot_v1(${Object.entries(values).map(([k,v])=>ident(k)+'=>'+quote(v)).join(',')});`;
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_assignments a WHERE club_id='${fixture.club}'),'schedule',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.dealer_rotation_schedule s WHERE club_id='${fixture.club}'),'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${fixture.club}'))::text);`);
    const before=await fingerprint();
    for(const role of ['anon','authenticated']){
     let denied=false;try{await sql(`SET request.jwt.claim.role='${role}';SET request.jwt.claims='{"role":"${role}","sub":"${fixture.owner}"}';SET ROLE ${role};`+call(args));}catch(e){assert.match(String(e.stderr??e),/permission denied for function worker_execute_rotation_slot_v1/);denied=true;}assert.ok(denied,'browser roles cannot invoke execution or its receipt path');
    }
    assert.deepEqual(JSON.parse(await sql(service+call(args))),durable.result,'same intent returns original durable result');
    assert.deepEqual(JSON.parse(await sql("SET TIME ZONE 'UTC';"+service+call(args))),durable.result,'same timestamp and intent must replay across connection time zones');
    const off=await sql(`BEGIN;UPDATE public.club_settings SET auto_swing_enabled=false WHERE club_id='${fixture.club}';${service}${call(args)}ROLLBACK;`);assert.deepEqual(JSON.parse(off),durable.result,'receipt recovery remains read-only while AutoOFF');
    let conflict=false;try{await sql(service+call({...args,p_duration_minutes:p.duration+1}));}catch(e){assert.match(String(e.stderr??e),/ROTATION_EXECUTION_IDEMPOTENCY_CONFLICT/);conflict=true;}assert.ok(conflict);
    let timeConflict=false;try{await sql(service+call({...args,p_swing_due_at:new Date(Date.parse(p.swing_due_at)+1000).toISOString()}));}catch(e){assert.match(String(e.stderr??e),/ROTATION_EXECUTION_IDEMPOTENCY_CONFLICT/);timeConflict=true;}assert.ok(timeConflict);
    assert.equal(await fingerprint(),before,'replay and conflict cannot create a second swap or mutate audit');
    console.log('ACTUAL_PASSR_MAIN_ATOMIC_EXECUTION_RECEIPT_REPLAY_TZ_OFF_CONFLICT_PASS');
   }
   assert.equal(await sql(`SELECT count(*)||'|'||count(DISTINCT attendance_id)||'|'||count(DISTINCT table_session_id) FROM public.dealer_assignments WHERE club_id='${fixture.club}' AND status='assigned' AND released_at IS NULL;`),`${tableCount}|${tableCount}|${tableCount}`);
   assert.equal(await sql(`SELECT count(*) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${fixture.club}' AND a.current_state='in_transition';`),'0');
   console.log(JSON.stringify({passR_actual_result:{phase:'main-drain-postcheck',tableCount,initialExecuted,newExecutions:executions.length,batches,completed,networkCalls}}));
   console.log('ACTUAL_PASSR_MAIN_SCHEDULED_EXECUTION_REAL_LEAD_PASS '+tableCount);
  }
  if(fixture.dispatch){await qualifyDispatch();}else if(fixture.resumeOriginals){await executeScheduled(fixture.resumeOriginals);}else{
  const before=await stateProof();
  const response=await handler(new Request('https://synthetic.invalid/functions/v1/process-swing',{method:'POST',headers:{Authorization:'Bearer synthetic-main-worker','Content-Type':'application/json'},body:JSON.stringify({club_id:fixture.club})}));
  const body=await response.json();console.log(JSON.stringify({passR_actual_result:{phase:'main-handler',status:response.status,body,reads:[...new Set(reads)],rpcCalls,adapterGaps,bridgeErrors,networkCalls}}));
  assert.equal(response.status,200);assert.equal(networkCalls,0);assert.deepEqual(adapterGaps,[]);assert.deepEqual(bridgeErrors,[]);
  if(fixture.lockFault){
   const operationalStateChanged=(await stateProof())!==before;
   console.log(JSON.stringify({passR_actual_result:{phase:'main-lock-fault',mode:fixture.lockFault,body,operationalStateChanged,rpcCalls,networkCalls}}));
   const lost=fixture.lockFault==='reclaimed',held=fixture.lockFault==='held';
   assert.equal(body.status,lost||held?'locked':'business_failed');assert.equal(body.error_code,lost?'club_lock_ownership_lost':held?'club_lock_held':'club_lock_invalid_response');assert.equal(operationalStateChanged,false);
   assert.ok(!rpcCalls.includes('upsert_rotation_plan'));assert.ok(!rpcCalls.includes('release_club_lock'));
   const acquired=rpcResponses.find(r=>r.name==='try_acquire_club_lock_fenced');assert.equal(acquired.data.acquired,!held);
   const token=successorLease?.lock_token??acquired.data.lock_token;
   assert.equal(await sql(`SELECT lock_token=${quote(token)}::uuid FROM public.club_processing_locks WHERE club_id='${fixture.club}';`),'t','old worker must not remove a valid or successor lease');
   if(lost){assert.ok(rpcResponses.some(r=>r.name==='extend_club_lock_lease'&&r.data===false));assert.equal(rpcResponses.filter(r=>r.name==='release_club_lock_if_owner').at(-1)?.data,false);}
   const cleanup=await admin.rpc('release_club_lock_if_owner',{p_club_id:fixture.club,p_lock_token:token});assert.equal(cleanup.error,null);assert.equal(cleanup.data,true,'test knows the real SQL lease token for fixture cleanup');
   console.log('ACTUAL_PASSR_MAIN_FENCED_LEASE_FAILURE_NO_BUSINESS_WRITE_PASS '+fixture.lockFault);
  }else if(fixture.mainOff){
   assert.equal(body.status,'completed');assert.equal(body.error_code,null);assert.deepEqual(body.metrics,{});assert.deepEqual(body.diagnostics,[]);
   assert.equal(await stateProof(),before);assert.ok(!rpcCalls.includes('upsert_rotation_plan'));assert.ok(!rpcCalls.includes('get_dealer_pool_snapshot'));
   console.log('ACTUAL_PASSR_MAIN_HANDLER_AUTO_OFF_PASS');
  }else if(fixture.fault==='dealer-inventory'){
   assert.ok(Object.hasOwn(body.metrics,fixture.club));
   assert.equal(await stateProof(),before);assert.ok(!rpcCalls.includes('upsert_rotation_plan'));assert.equal(body.status,'partial');assert.equal(body.error_code,'dealer_inventory_query_failed');
   assert.ok(body.diagnostics.some(d=>d.stage==='dealer_inventory'&&d.code==='PGRST002'));
   console.log('ACTUAL_PASSR_MAIN_HANDLER_INVENTORY_FAILURE_PASS');
  }else if(fixture.shortage){
   const {buildCanonicalShortageSnapshot,classifyShortage}=await import('../../supabase/functions/process-swing/shortageAlert.ts');
   assert.equal(body.status,'completed');assert.equal(body.error_code,null);
   assert.equal(await sql(`SELECT count(*) FROM public.dealer_assignments WHERE club_id='${fixture.club}' AND released_at IS NULL AND status='assigned' AND overtime_started_at IS NOT NULL;`),String(tableCount));
   assert.equal(await sql(`SELECT count(*) FROM public.dealer_assignments WHERE club_id='${fixture.club}' AND released_at IS NOT NULL;`),'0','shortage never authorizes force-release');
   assert.equal(await sql(`SELECT count(*) FROM public.dealer_rotation_schedule WHERE club_id='${fixture.club}' AND status IN ('announced','executing','executed');`),'0');
   assert.equal(await sql(`SELECT count(*) FROM public.dealer_rotation_schedule WHERE club_id='${fixture.club}' AND slot_index=0 AND status='predicted' AND in_attendance_id IS NULL;`),String(tableCount));
   const snapshot=await buildCanonicalShortageSnapshot(admin,fixture.club,{minInterSwingRestMinutes:15,clubBreakDurationMinutes:15,preAnnounceMinutes:3});
   assert.equal(snapshot.status,'ok');assert.equal(snapshot.active_staffed_tables,tableCount);assert.equal(snapshot.active_empty_tables,0);assert.equal(snapshot.genuinely_available_dealers,0);assert.equal(snapshot.tables_without_replacement_total,tableCount);
   assert.ok(['true_shortage','critical_shortage'].includes(classifyShortage(snapshot)),'healthy transport cannot hide real shortage');
   const originalActive=await sql(`SELECT string_agg(id::text,',' ORDER BY id) FROM public.dealer_assignments WHERE club_id='${fixture.club}' AND released_at IS NULL;`);
   const repeatedResponse=await handler(new Request('https://synthetic.invalid/functions/v1/process-swing',{method:'POST',headers:{Authorization:'Bearer synthetic-main-worker','Content-Type':'application/json'},body:JSON.stringify({club_id:fixture.club})}));
   assert.equal((await repeatedResponse.json()).status,'completed');
   assert.equal(await sql(`SELECT string_agg(id::text,',' ORDER BY id) FROM public.dealer_assignments WHERE club_id='${fixture.club}' AND released_at IS NULL;`),originalActive);
   assert.ok(!rpcCalls.includes('worker_execute_rotation_slot_v1'));assert.ok(!rpcCalls.includes('worker_perform_swing'));assert.deepEqual(adapterGaps,[]);assert.deepEqual(bridgeErrors,[]);assert.equal(networkCalls,0);
   console.log(JSON.stringify({passR_actual_result:{phase:'main-real-shortage',club:fixture.club,tableCount,snapshot,classification:classifyShortage(snapshot),noSwaps:true,noForceRelease:true,networkCalls}}));
   console.log('ACTUAL_PASSR_MAIN_SHORTAGE_OT_NO_FORCE_RELEASE_PASS '+tableCount);
  }else{
  assert.equal(body.status,'completed');assert.ok(rpcCalls.includes('upsert_rotation_plan'));
  assert.equal(await sql(`SELECT count(*) FROM public.dealer_rotation_schedule WHERE club_id='${fixture.club}' AND slot_index=0 AND status='announced';`),String(tableCount));
  assert.ok(rpcResponses.some(r=>r.name==='extend_club_lock_lease'));assert.ok(rpcResponses.filter(r=>r.name==='extend_club_lock_lease').every(r=>r.data===true));
  assert.equal(rpcResponses.filter(r=>r.name==='release_club_lock_if_owner').at(-1)?.data,true);
  assert.equal(await sql(`SELECT count(*) FROM public.swing_run_metrics WHERE club_id='${fixture.club}';`),'1');
  assert.equal(await sql(`SELECT total_swings||'|'||successful_swings FROM public.swing_metrics WHERE club_id='${fixture.club}';`),`${tableCount}|${tableCount}`,'current worker metrics count announcements, not executed rotations');
  assert.equal(await sql(`SELECT count(*) FROM public.dealer_rotation_schedule s JOIN public.dealer_assignments a ON a.id=s.assignment_id JOIN public.table_sessions ts ON ts.id=a.table_session_id JOIN public.dealer_attendance d ON d.id=s.in_attendance_id WHERE s.club_id='${fixture.club}' AND s.status='announced' AND s.slot_index=0 AND s.in_attendance_id=a.pre_assigned_attendance_id AND s.out_attendance_id=a.attendance_id AND s.planned_relief_at=a.planned_relief_at AND a.released_at IS NULL AND ts.closed_at IS NULL AND ts.game_table_id=s.table_id AND ts.club_id=s.club_id AND d.current_state='pre_assigned' AND d.pre_assigned_table_id=s.table_id;`),String(tableCount));
  if(fixture.shortageScope){
   const {buildCanonicalShortageSnapshot}=await import('../../supabase/functions/process-swing/shortageAlert.ts');
   const snapshot=await buildCanonicalShortageSnapshot(admin,fixture.club,{minInterSwingRestMinutes:15,clubBreakDurationMinutes:15,preAnnounceMinutes:3});
   const inventory=await admin.rpc('get_dealer_operational_tables_v1',{p_club_id:fixture.club});assert.equal(inventory.error,null);assert.equal(inventory.data.length,2);
   console.log(JSON.stringify({passR_actual_result:{phase:'shortage-canonical-scope',operationalTables:inventory.data.length,snapshot,adapterGaps,bridgeErrors}}));
   assert.deepEqual(adapterGaps,[]);assert.deepEqual(bridgeErrors,[]);assert.equal(snapshot.status,'ok');
   assert.equal(snapshot.active_staffed_tables,2,'shortage health must count the same exact operational sessions as planner');assert.equal(snapshot.active_empty_tables,0);
  }
  const lockProof=()=>sql(`SELECT jsonb_agg(jsonb_build_object('id',id,'assignment',assignment_id,'incoming',in_attendance_id,'relief',planned_relief_at,'version',version) ORDER BY table_id) FROM public.dealer_rotation_schedule WHERE club_id='${fixture.club}' AND slot_index=0 AND status='announced';`);
  const locks=await lockProof();
  const repeatedResponse=await handler(new Request('https://synthetic.invalid/functions/v1/process-swing',{method:'POST',headers:{Authorization:'Bearer synthetic-main-worker','Content-Type':'application/json'},body:JSON.stringify({club_id:fixture.club})}));
  const repeated=await repeatedResponse.json();console.log(JSON.stringify({passR_actual_result:{phase:'main-handler-repeat',status:repeatedResponse.status,body:repeated,adapterGaps,bridgeErrors,networkCalls}}));
  assert.equal(repeatedResponse.status,200);assert.equal(repeated.status,'completed');assert.equal(repeated.error_code,null);assert.deepEqual(adapterGaps,[]);assert.deepEqual(bridgeErrors,[]);assert.equal(networkCalls,0);
  assert.equal(await lockProof(),locks);assert.equal(rpcResponses.filter(r=>r.name==='release_club_lock_if_owner').at(-1)?.data,true);
  assert.equal(await sql(`SELECT count(*) FROM public.dealer_assignments WHERE club_id='${fixture.club}' AND released_at IS NOT NULL;`),'0','announce lead has not elapsed; outgoing dealers must remain seated');
  if(fixture.executeMain){
   const originals=JSON.parse(await sql(`SELECT jsonb_agg(jsonb_build_object('schedule',s.id,'assignment',a.id,'table',s.table_id,'session',a.table_session_id,'incoming',s.in_attendance_id,'outgoing',a.attendance_id,'relief',s.planned_relief_at,'announce',s.announce_at) ORDER BY s.table_id) FROM public.dealer_rotation_schedule s JOIN public.dealer_assignments a ON a.id=s.assignment_id WHERE s.club_id='${fixture.club}' AND s.slot_index=0 AND s.status='announced';`));assert.equal(originals.length,tableCount);
   await executeScheduled(originals);
  }
  if(fixture.shortageScope){
   const {buildCanonicalShortageSnapshot,classifyShortage}=await import('../../supabase/functions/process-swing/shortageAlert.ts');
   const opts={minInterSwingRestMinutes:15,clubBreakDurationMinutes:15,preAnnounceMinutes:3};
   const operator=`SET request.jwt.claim.role='authenticated';SET request.jwt.claim.sub='${fixture.owner}';SET request.jwt.claims='{"role":"authenticated","sub":"${fixture.owner}"}';SET ROLE authenticated;`;
   async function closeSession(id){const revision=Number(await sql(`SELECT revision FROM public.table_sessions WHERE id='${id}';`));const result=JSON.parse(await sql(operator+`SELECT public.operator_close_club_table_v2('${id}',${revision},'${crypto.randomUUID()}');`));assert.equal(result.ok,true);}
   // Real close between initial and final canonical reads, not a fabricated
   // inventory response. Preserve the failed snapshot and inspect new scope.
   let canonicalReads=0;
   const changingAdmin={from:admin.from,rpc:async(name,args)=>{if(name==='get_dealer_operational_tables_v1'&&++canonicalReads===2)await closeSession(fixture.rows[0].session);return admin.rpc(name,args);}};
   const changed=await buildCanonicalShortageSnapshot(changingAdmin,fixture.club,opts);
   assert.equal(changed.status,'query_failed');assert.equal(changed.error_code,'shortage_snapshot_operational_scope_changed_query_failed');assert.equal(classifyShortage(changed),'snapshot_invalid');
   const phantom=crypto.randomUUID();await sql(`INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES('${phantom}','${fixture.club}','Closed legacy TEST',3,'cash','active','available');`);
   const reopened=JSON.parse(await sql(operator+`SELECT public.operator_open_club_tables_v2(ARRAY['${fixture.rows[0].table}'::uuid],'cash','${crypto.randomUUID()}');`));assert.equal(reopened.ok,true);
   const freshSession=await sql(`SELECT id FROM public.table_sessions WHERE game_table_id='${fixture.rows[0].table}' AND closed_at IS NULL;`);assert.notEqual(freshSession,fixture.rows[0].session);
   const fresh=await buildCanonicalShortageSnapshot(admin,fixture.club,opts);
   assert.equal(fresh.status,'ok');assert.equal(fresh.active_staffed_tables,1);assert.equal(fresh.active_empty_tables,1);assert.ok(fresh.tables_without_replacement_total>=1,'empty live table must remain visible without legacy shift/open markers');
   await closeSession(freshSession);await closeSession(fixture.rows[1].session);
   const empty=await buildCanonicalShortageSnapshot(admin,fixture.club,opts);
   assert.equal(empty.status,'ok');assert.equal(empty.active_staffed_tables,0);assert.equal(empty.active_empty_tables,0);assert.equal(classifyShortage(empty),'healthy');
   assert.deepEqual(adapterGaps,[]);assert.deepEqual(bridgeErrors,[]);assert.equal(networkCalls,0);
   console.log(JSON.stringify({passR_actual_result:{phase:'shortage-close-reopen',changedStatus:changed.status,freshStaffed:fresh.active_staffed_tables,freshEmpty:fresh.active_empty_tables,closedScopeTables:empty.active_staffed_tables+empty.active_empty_tables,legacyActivePhantomExcluded:true}}));
   console.log('ACTUAL_PASSR_SHORTAGE_CANONICAL_CLOSE_REOPEN_PASS');
  }
  console.log('ACTUAL_PASSR_MAIN_HANDLER_NATIVE_PASS');
  }
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
