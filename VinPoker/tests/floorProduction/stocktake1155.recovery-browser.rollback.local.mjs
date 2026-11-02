// Reuse1115 canonical fixture and958 persistent psql transport; no schema/permission edits.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {randomUUID,createHmac} from 'node:crypto';
import {existsSync,writeFileSync,readFileSync} from 'node:fs';
const rejectChanged=process.env.VINPOKER_STOCKTAKE1186_LOCAL==='1';
const confirmedDialog=rejectChanged||process.env.VINPOKER_STOCKTAKE1184_LOCAL==='1';
const visualOnly=confirmedDialog&&process.env.VINPOKER_STOCKTAKE1184_VISUAL_ONLY==='1';
assert.equal(process.env[rejectChanged?'VINPOKER_STOCKTAKE1186_LOCAL':confirmedDialog?'VINPOKER_STOCKTAKE1184_LOCAL':'VINPOKER_STOCKTAKE1155_LOCAL'],'1');
assert.equal(process.cwd().replaceAll('\\','/'),'D:/wt/vinpoker-ops-local-integration/VinPoker');
const report=confirmedDialog?`D:/Quy trình/output/reports/stocktake${rejectChanged?'1186':'1184'}-${visualOnly?'visual-only-':''}native-browser-rollback-local-20261028.json`:process.env.VINPOKER_STOCKTAKE1155_ATTEMPT2==='1'
 ?'D:/Quy trình/output/reports/stocktake1155-attempt2-native-browser-rollback-local-20261027.json'
 :'D:/Quy trình/output/reports/stocktake1155-native-browser-rollback-local-20261027.json';assert.equal(existsSync(report),false);
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql("BEGIN READ ONLY;SET LOCAL statement_timeout='10s';"+q+'ROLLBACK;'));
const guard=read("SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));");
assert.equal(guard.db,'vinpoker_ranking860_local');assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.external,0);assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
const actor='a364de8e-06b1-4428-a20d-ac614ec406e5',club='349ecf35-50ba-4c71-a581-15dc45f1cd01',tour='a5af353d-2d97-4891-9078-0bc84b7a8237';
assert.equal(read(`SELECT to_jsonb(count(*)) FROM public.fnb_stocktakes WHERE club_id='${club}' AND status='open';`),0);
const tables=['fnb_categories','fnb_menu_items','fnb_ingredients','fnb_recipe_items','fnb_stock_movements','fnb_stocktakes','fnb_stocktake_lines','fnb_orders','fnb_order_items','tournaments','tournament_entries','tournament_seats','cashier_buyin_movements','tournament_prize_payments','chip_bank_ledger','tournament_hands','table_operation_receipts'];
const fingerprint=()=>read("SELECT to_jsonb(md5(jsonb_build_array("+tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')+")::text));");
const bodies=()=>read("SELECT jsonb_object_agg(proname,md5(prosrc)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN('fnb_open_stocktake','fnb_set_stocktake_line','fnb_commit_stocktake','fnb_stock_in');");
const state={kind:'ACTUAL_STOCKTAKE_COMPONENT_NATIVE_CANONICAL_RPC_OUTER_ROLLBACK_MODELED_AUTH_HTTP_ACK_LOSS_NOT_FULL_ACCEPTANCE',guard,actor,club,before:fingerprint(),bodiesBefore:bodies(),reads:[],writes:[],faults:[],errors:[],denied:[],success:false};
if(visualOnly)state.kind='STOCKTAKE_CONFIRMATION_VISUAL_AND_CANCEL_ONLY_NOT_COMMIT_ACCEPTANCE';
const progress=()=>{if(confirmedDialog)writeFileSync(report.replace('.json','.progress.json'),JSON.stringify(state,null,2));};
assert.equal(state.bodiesBefore.fnb_commit_stocktake,'40f139b94c96dbc0baff179f5c401faa');
const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let pending=null,buffer='',stderr='',closed=false,queue=Promise.resolve();
child.stderr.setEncoding('utf8');child.stderr.on('data',part=>{stderr+=part;});child.stdout.setEncoding('utf8');
child.stdout.on('data',part=>{buffer+=part;while(buffer.includes('\n')){const at=buffer.indexOf('\n'),line=buffer.slice(0,at).trim();buffer=buffer.slice(at+1);if(!pending)continue;if(line===pending.marker){const done=pending;pending=null;clearTimeout(done.timer);done.resolve(done.lines);}else if(line)pending.lines.push(line);}});
child.on('exit',code=>{closed=true;if(pending){const done=pending;pending=null;clearTimeout(done.timer);done.reject(Error('psql exited '+code+':'+stderr));}});
const send=q=>{const work=queue.then(()=>new Promise((resolve,reject)=>{assert.equal(pending,null);const marker='S1155_'+randomUUID().replaceAll('-','');const timer=setTimeout(()=>reject(Error('psql observation timeout')),30000);pending={marker,lines:[],resolve,reject,timer};child.stdin.write(q+'\n\\echo '+marker+'\n');}));queue=work.catch(()=>{});return work;};
const json=async q=>JSON.parse((await send(q)).filter(line=>line.startsWith('{')||line.startsWith('[')||line.startsWith('"')||line==='null').at(-1));
const literal=x=>x===null?'NULL':"'"+String(x).replaceAll("'","''")+"'";
const uuid=x=>assert.match(x,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
const claims=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
const sessions=new Set(),secret=randomUUID(),user={id:actor,email:rejectChanged?'stocktake1186@example.invalid':confirmedDialog?'stocktake1184@example.invalid':'stocktake1155@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-27T00:00:00Z'};
let ingredient,stocktake,server;
try{
 await send("BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='3s';"+(confirmedDialog?readFileSync('supabase/pending-migrations/20261027151355_fnb_confirmed_stocktake_snapshot_v1.sql','utf8'):'')+claims);
 const created=await json(`SELECT public.fnb_upsert_ingredient('${club}',NULL,'LOCAL1155 stocktake TEST','unit','unit',1,0,true);`);assert.equal(created.status,'ok');ingredient=created.id;uuid(ingredient);state.ingredient=ingredient;
 assert.equal((await json(`SELECT public.fnb_stock_in('${club}','${ingredient}',2,1000,'${randomUUID()}');`)).status,'ok');
 state.otherIngredientsBefore=await json(`SELECT to_jsonb(md5(coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id)::text,'[]'))) FROM public.fnb_ingredients i WHERE id<>'${ingredient}';`);
 server=createServer(async(req,res)=>{
  const respond=(status,value)=>{progress();if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  res.setHeader('Access-Control-Allow-Origin',rejectChanged?'http://127.0.0.1:52986':confirmedDialog?'http://127.0.0.1:52984':'http://127.0.0.1:5205');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile,x-retry-count,prefer');res.setHeader('Access-Control-Expose-Headers','Content-Range');
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  try{
   const u=new URL(req.url,'http://127.0.0.1:54329'),name=u.pathname.split('/').at(-1);let raw='';for await(const part of req){raw+=part;assert.ok(raw.length<8192);}const body=raw?JSON.parse(raw):{};
   if(u.pathname==='/__local/manifest')return respond(200,{actor,club,tour,email:user.email,runId:rejectChanged?'1186':confirmedDialog?'1184':'1155',singleTour:true,model:'TEST modeled Auth / actual canonical stocktake / outer rollback'});
   if(u.pathname==='/auth/v1/token'){
    assert.equal(body.email,user.email);assert.equal(body.password,'LOCAL_TEST_ONLY');const exp=Math.floor(Date.now()/1000)+3600,base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url'),token=base+'.'+createHmac('sha256',secret).update(base).digest('base64url');sessions.add(token);return respond(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});
   }
   if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return respond(401,{message:'LOCAL1155_MODELED_SESSION_REQUIRED'});
   if(u.pathname==='/auth/v1/user')return respond(200,user);
   if(req.method==='POST'&&u.pathname.startsWith('/rest/v1/rpc/')){
    let result;
    if(name==='fnb_open_stocktake'){
     assert.equal(state.writes.length,0);assert.deepEqual(Object.keys(body).sort(),['p_client_request_id','p_club_id','p_note']);assert.equal(body.p_club_id,club);assert.equal(body.p_note,null);uuid(body.p_client_request_id);
     result=await json(`SELECT public.fnb_open_stocktake('${club}',NULL,${literal(body.p_client_request_id)});`);assert.equal(result.status,'ok');stocktake=result.stocktake_id;state.stocktake=stocktake;
    }else if(name==='fnb_set_stocktake_line'){
     assert.equal(state.writes.length,1);assert.deepEqual(body,{p_stocktake_id:stocktake,p_ingredient_id:ingredient,p_counted_qty:1.25});result=await json(`SELECT public.fnb_set_stocktake_line('${stocktake}','${ingredient}',1.25);`);assert.equal(result.status,'ok');
    }else if(confirmedDialog&&!visualOnly&&name==='fnb_commit_stocktake_confirmed_v1'){
     const staleAttempt=rejectChanged&&state.writes.length===2;
     assert.equal(state.writes.length,rejectChanged&&!staleAttempt?3:2);assert.deepEqual(body,{p_stocktake_id:stocktake,p_expected_counts:{[ingredient]:rejectChanged&&!staleAttempt?'4':'1.25'}});
     if(staleAttempt){
      const changed=await json(`SELECT public.fnb_set_stocktake_line('${stocktake}','${ingredient}',4);`);assert.equal(changed.status,'ok');
      state.faults.push({kind:'CANONICAL_COUNT_CHANGED_AFTER_REVIEW',from:1.25,to:4,result:changed});
     }
     result=await json(`SELECT public.fnb_commit_stocktake_confirmed_v1('${stocktake}',${literal(JSON.stringify(body.p_expected_counts))}::jsonb);`);
     if(staleAttempt){
      assert.deepEqual(result,{error:'STOCKTAKE_COUNTS_CHANGED'});state.writes.push({name,body,result});
      state.rejectedSnapshot=await json(`SELECT jsonb_build_object('status',(SELECT status FROM public.fnb_stocktakes WHERE id='${stocktake}'),'stock',(SELECT on_hand FROM public.fnb_ingredients WHERE id='${ingredient}'),'counted',(SELECT counted_qty FROM public.fnb_stocktake_lines WHERE stocktake_id='${stocktake}' AND ingredient_id='${ingredient}'),'adjustments',(SELECT count(*) FROM public.fnb_stock_movements WHERE ingredient_id='${ingredient}' AND reason='stocktake_adjust'));`);
      assert.deepEqual(state.rejectedSnapshot,{status:'open',stock:2,counted:4,adjustments:0});return respond(200,result);
     }
     assert.equal(result.status,'ok');assert.equal(result.adjusted_lines,1);assert.equal(result.counts_confirmed,true);assert.equal(result.stocktake_id,stocktake);
    }else if(!confirmedDialog&&name==='fnb_commit_stocktake'){
     assert.equal(state.writes.length,2);assert.deepEqual(body,{p_stocktake_id:stocktake});result=await json(`SELECT public.fnb_commit_stocktake('${stocktake}');`);assert.equal(result.status,'ok');assert.equal(result.adjusted_lines,1);
    }else{state.denied.push({method:req.method,name});return respond(403,{message:'LOCAL1155_OTHER_WRITER_DENIED'});}
    state.writes.push({name,body,result});
    if(name!=='fnb_set_stocktake_line'){state.faults.push({kind:'ACK_NULL_AFTER_NATIVE_WRITE',name});return respond(200,null);}
    return respond(200,result);
   }
   if(req.method==='GET'&&u.pathname.startsWith('/rest/v1/')){
    let value;const select=u.searchParams.get('select')?.replaceAll(/\s/g,'');
    if(['user_roles','dealers','club_chip_masters','club_marketers','club_fnb_staff','club_accountants'].includes(name)){
     assert.equal(u.searchParams.get('user_id'),'eq.'+actor);const cols=name==='user_roles'?'role':name==='dealers'?'id':'club_id';assert.equal(select,cols);value=await json(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT ${cols} FROM public.${name} WHERE user_id='${actor}'${name==='dealers'?' AND deleted_at IS NULL':''}${name==='user_roles'?'':' LIMIT 1'})x;`);
    }else if(name==='clubs'){
     assert.equal(select,'id');assert.equal(u.searchParams.get('owner_id'),'eq.'+actor);value=await json(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT id FROM public.clubs WHERE owner_id='${actor}' LIMIT 1)x;`);
    }else if(['fnb_categories','fnb_menu_items','fnb_ingredients'].includes(name)){
     assert.equal(select,'*');assert.equal(u.searchParams.get('club_id'),'eq.'+club);const order=name==='fnb_categories'?'sort_order,name':name==='fnb_menu_items'?'sort_order':'name';value=await json(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT * FROM public.${name} WHERE club_id='${club}' ORDER BY ${order})x;`);if(name==='fnb_menu_items')assert.ok(value.every(row=>!row.image_url));
    }else if(name==='fnb_stocktakes'){
     assert.equal(u.searchParams.get('club_id'),'eq.'+club);
     if(select==='id'){assert.equal(u.searchParams.get('status'),'eq.open');assert.equal(u.searchParams.get('limit'),'1');value=await json(`SELECT coalesce((SELECT jsonb_build_object('id',id) FROM public.fnb_stocktakes WHERE club_id='${club}' AND status='open' LIMIT 1),'null'::jsonb);`);}
     else{assert.equal(select,'id,club_id,client_request_id,note,status,created_by,created_at,committed_by,committed_at');let where;
      if(u.searchParams.has('client_request_id')){const id=u.searchParams.get('client_request_id').slice(3);uuid(id);assert.equal(id,state.writes[0].body.p_client_request_id);where='client_request_id='+literal(id);}
      else{assert.equal(u.searchParams.get('id'),'eq.'+stocktake);where='id='+literal(stocktake);}
      value=await json(`SELECT coalesce((SELECT jsonb_build_object('id',id,'club_id',club_id,'client_request_id',client_request_id,'note',note,'status',status,'created_by',created_by,'created_at',created_at,'committed_by',committed_by,'committed_at',committed_at) FROM public.fnb_stocktakes WHERE club_id='${club}' AND ${where}),'null'::jsonb);`);
     }
    }else if(name==='fnb_stocktake_lines'){
     assert.equal(u.searchParams.get('stocktake_id'),'eq.'+stocktake);
     if(select==='ingredient_id,counted_qty')value=await json(`SELECT coalesce(jsonb_agg(jsonb_build_object('ingredient_id',ingredient_id,'counted_qty',counted_qty)),'[]') FROM public.fnb_stocktake_lines WHERE stocktake_id='${stocktake}';`);
     else{assert.equal(select,'stocktake_id,club_id,ingredient_id,counted_qty::text,expected_qty::text,delta_applied::text');assert.equal(u.searchParams.get('club_id'),'eq.'+club);assert.equal(u.searchParams.get('limit'),'2');value=await json(`SELECT coalesce(jsonb_agg(jsonb_build_object('stocktake_id',stocktake_id,'club_id',club_id,'ingredient_id',ingredient_id,'counted_qty',counted_qty::text,'expected_qty',expected_qty::text,'delta_applied',delta_applied::text)),'[]') FROM public.fnb_stocktake_lines WHERE club_id='${club}' AND stocktake_id='${stocktake}';`);res.setHeader('Content-Range',value.length?`0-${value.length-1}/${value.length}`:'*/0');}
    }else{state.denied.push({method:req.method,name});return respond(403,{message:'LOCAL1155_READ_NOT_ALLOWED'});}
    state.reads.push({name,select,rows:Array.isArray(value)?value.length:null,canonical: name==='fnb_stocktake_lines'?value:undefined});return respond(200,value);
   }
   state.denied.push({method:req.method,name});respond(403,{message:'LOCAL1155_NOT_ALLOWED'});
  }catch(error){state.errors.push(error.message);respond(500,{message:'LOCAL1155_ADAPTER_ERROR'});}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54329,'127.0.0.1',resolve);});progress();console.log(confirmedDialog?'STOCKTAKE1184_OUTER_TRANSACTION_READY':'STOCKTAKE1155_OUTER_TRANSACTION_READY');
 await new Promise(resolve=>process.stdin.on('data',chunk=>{assert.equal(String(chunk).trim(),'stop');process.stdin.pause();resolve();}));
 assert.deepEqual(state.writes.map(row=>row.name),['fnb_open_stocktake','fnb_set_stocktake_line',...(rejectChanged?['fnb_commit_stocktake_confirmed_v1']:[]),...(visualOnly?[]:[confirmedDialog?'fnb_commit_stocktake_confirmed_v1':'fnb_commit_stocktake'])]);assert.equal(state.faults.length,rejectChanged?3:visualOnly?1:2);
 state.final=await json(`SELECT jsonb_build_object('status',(SELECT status FROM public.fnb_stocktakes WHERE id='${stocktake}'),'stock',(SELECT on_hand FROM public.fnb_ingredients WHERE id='${ingredient}'),'avg',(SELECT avg_unit_cost FROM public.fnb_ingredients WHERE id='${ingredient}'),'adjustments',(SELECT count(*) FROM public.fnb_stock_movements WHERE ingredient_id='${ingredient}' AND reason='stocktake_adjust'),'net',(SELECT sum(delta) FROM public.fnb_stock_movements WHERE ingredient_id='${ingredient}'),'otherHash',md5((SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id)::text,'[]') FROM public.fnb_ingredients i WHERE id<>'${ingredient}')));`);
 assert.equal(state.final.status,visualOnly?'open':'committed');assert.equal(state.final.stock,rejectChanged?4:visualOnly?2:1.25);assert.equal(state.final.net,rejectChanged?4:visualOnly?2:1.25);assert.equal(state.final.avg,1000);assert.equal(state.final.adjustments,visualOnly?0:1);assert.equal(state.final.otherHash,state.otherIngredientsBefore);
 assert.equal(state.errors.length,0);assert.equal(state.denied.length,0);if(!visualOnly)assert.ok(state.reads.some(row=>row.name==='fnb_stocktake_lines'&&row.select.includes('::text')));state.success=true;
}finally{
 if(server?.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 if(!closed){await send('ROLLBACK;');child.stdin.end('\\q\n');await new Promise(resolve=>{if(closed)resolve();else child.once('exit',resolve);});}
 state.after=fingerprint();state.bodiesAfter=bodies();state.unchanged=state.before===state.after;state.retainedWrites=0;
 if(confirmedDialog)assert.equal(read("SELECT to_jsonb(to_regprocedure('public.fnb_commit_stocktake_confirmed_v1(uuid,jsonb)') IS NULL);"),true);
 state.absent=ingredient?read(`SELECT jsonb_build_object('ingredient',(SELECT count(*) FROM public.fnb_ingredients WHERE id='${ingredient}'),'movements',(SELECT count(*) FROM public.fnb_stock_movements WHERE ingredient_id='${ingredient}'),'stocktakes',(SELECT count(*) FROM public.fnb_stocktakes WHERE id=${literal(stocktake??null)}::uuid));`):null;
 writeFileSync(report,JSON.stringify(state,null,2)+'\n');assert.equal(state.unchanged,true);assert.deepEqual(state.bodiesAfter,state.bodiesBefore);if(state.absent)assert.deepEqual(state.absent,{ingredient:0,movements:0,stocktakes:0});
}
console.log('STOCKTAKE1155_CANONICAL_RECOVERY_ROLLBACK_UNCHANGED');
