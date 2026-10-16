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
 const rpcNames=new Set(['count_available_dealers','end_breaks_on_demand','upsert_rotation_plan','lock_rotation_slot','cancel_rotation_slot','worker_clear_legacy_preassignment_v1','worker_adopt_legacy_preassignment_v1']);
 function project(row,spec){if(row===null)return null;const fields=[];let depth=0,start=0;
  for(let i=0;i<spec.length;i++){if(spec[i]==='(')depth++;if(spec[i]===')')depth--;if(spec[i]===','&&depth===0){fields.push(spec.slice(start,i).trim());start=i+1;}}fields.push(spec.slice(start).trim());
  const out={};for(const item of fields){if(item==='*')return row;const open=item.indexOf('('),raw=open<0?item:item.slice(0,open),key=raw.split('!')[0].trim();assert.match(key,/^[a-z_]+$/);assert.ok(Object.hasOwn(row,key),'unknown projected field '+key);
   out[key]=open<0?row[key]:row[key]===null?null:Array.isArray(row[key])?row[key].map(v=>project(v,item.slice(open+1,-1))):project(row[key],item.slice(open+1,-1));
  }return out;}
 const reads=[],rpcCalls=[];
 const admin={async rpc(name,args){assert.ok(rpcNames.has(name),name);rpcCalls.push(name);
  try{const params=Object.entries(args).map(([k,v])=>ident(k)+'=>'+(k==='p_rows'?quote(JSON.stringify(v))+'::jsonb':Array.isArray(v)?quote('{'+v.join(',')+'}')+'::uuid[]':quote(v))).join(',');
   return {data:JSON.parse(await sql(service+`SELECT to_jsonb(public.${name}(${params}));`)),error:null};
  }catch(e){return {data:null,error:{message:String(e.stderr??e),code:String(e.stderr??'').match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]}};}
 },from(table){
  assert.ok(['dealer_assignments','dealer_attendance','dealers','dealer_shift_metrics','dealer_breaks','dealer_meal_breaks','dealer_rotation_schedule','app_settings','dealer_table_profiles','dealer_table_pool','table_sessions','tournament_tables','diagnostic_logs'].includes(table),'unexpected table '+table);
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
   update(v){assert.equal(table,'dealer_assignments');patch=v;return q;},insert(v){assert.equal(table,'diagnostic_logs');patch=v;inserting=true;return q;},
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
 const result=await planner.passRRotationPlanner(admin,{clubId:fixture.club,clubZone:null,chatId:null,botToken:null,cycleExcludedIds:new Set(),preAnnounceMinutes:3,minInterSwingRestMinutes:15,clubBreakDurationMinutes:15,swingDurationMinutes:45,tierAMinBuyin:10000000,tierBMinBuyin:5000000,requiredGameTypes:[]});
 console.log(JSON.stringify({passR_actual_result:result,reads:[...new Set(reads)],rpcCalls,networkCalls}));
 assert.deepEqual(result.errors,[]);assert.equal(result.candidateStatus,undefined);assert.ok(result.planned>=fixture.rows.length);assert.equal(result.locked,fixture.rows.length);assert.equal(result.shortageTables,0);assert.equal(networkCalls,0);
 assert.equal(await sql(`SELECT count(DISTINCT table_id) FROM public.dealer_rotation_schedule WHERE club_id='${fixture.club}' AND slot_index=0 AND status IN ('predicted','announced');`),String(fixture.rows.length));
 assert.equal(await sql(`SELECT count(*) FROM public.dealer_rotation_schedule s JOIN public.dealer_assignments a ON a.id=s.assignment_id JOIN public.table_sessions ts ON ts.id=a.table_session_id JOIN public.dealer_attendance dat ON dat.id=s.in_attendance_id WHERE s.club_id='${fixture.club}' AND s.slot_index=0 AND s.status='announced' AND s.table_id=a.table_id AND a.club_id=s.club_id AND a.released_at IS NULL AND a.pre_assigned_attendance_id=s.in_attendance_id AND ts.game_table_id=a.table_id AND ts.club_id=a.club_id AND ts.closed_at IS NULL AND dat.current_state='pre_assigned' AND dat.pre_assigned_table_id=a.table_id;`),String(fixture.rows.length));
 assert.equal(await sql(`SELECT count(DISTINCT in_attendance_id) FROM public.dealer_rotation_schedule WHERE club_id='${fixture.club}' AND slot_index=0 AND status='announced';`),String(fixture.rows.length));
 console.log('ACTUAL_PASSR_NATIVE_MODULE_PASS '+fixture.rows.length);
}
