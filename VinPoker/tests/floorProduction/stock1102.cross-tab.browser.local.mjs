import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash,createHmac,randomUUID} from 'node:crypto';
assert.equal(process.env.VINPOKER_STOCK1102_LOCAL,'1');
assert.equal(process.cwd().replaceAll('\\','/'),'D:/wt/vinpoker-ops-local-integration/VinPoker');
const report='D:/Quy trình/output/reports/stock1102-native-browser-local-20261027.json';
assert.equal(existsSync(report),false,'Inspect existing outcome; do not mint another stock movement');
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${q}ROLLBACK;`));
const guard=read("SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'others',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));");
assert.equal(guard.db,'vinpoker_ranking860_local');assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);
assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(guard.others,0);assert.equal(guard.external,0);
const actor='a364de8e-06b1-4428-a20d-ac614ec406e5',club='349ecf35-50ba-4c71-a581-15dc45f1cd01',ingredient='7ebcc99b-b544-4764-a943-0fc94985f619',tour='a5af353d-2d97-4891-9078-0bc84b7a8237';
const manifest=JSON.parse(readFileSync('D:/Quy trình/output/reports/stock1095-candidate-manifest-local-20261027.json','utf8'));
const up=readFileSync(manifest.up,'utf8'),down=readFileSync(manifest.down,'utf8');
assert.equal(createHash('sha256').update(up).digest('hex'),manifest.upSha256);
const body=()=>sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fnb_stock_in(uuid,uuid,numeric,numeric,text)'::regprocedure;");
assert.equal(body(),manifest.beforeBody);
const claims=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
const native=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${claims}${q}ROLLBACK;`));
const literal=x=>"'"+String(x).replaceAll("'","''")+"'";
const uuid=x=>assert.match(x,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
const tables=['fnb_categories','fnb_menu_items','fnb_ingredients','fnb_recipe_items','fnb_stock_movements','fnb_stocktakes','fnb_stocktake_lines','fnb_orders','fnb_order_items','tournaments','tournament_entries','tournament_seats','cashier_buyin_movements','tournament_prize_payments','chip_bank_ledger','tournament_hands','table_operation_receipts','tournament_registrations','tournament_eliminations','tournament_close_report'];
let request=null;
const fingerprint=()=>read("SELECT to_jsonb(md5(jsonb_build_array("+tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x${t==='fnb_ingredients'?` WHERE id<>'${ingredient}'`:t==='fnb_stock_movements'&&request?` WHERE NOT(club_id='${club}' AND client_request_id IS NOT DISTINCT FROM ${literal(request)})`:''})`).join(',')+")::text));");
const stock=()=>read(`SELECT to_jsonb(x) FROM public.fnb_ingredients x WHERE id='${ingredient}' AND club_id='${club}';`);
const state={kind:'ACTUAL_STOCK_TWO_BROWSER_TABS_REAL_WEB_LOCK_BARRIER_ONE_COMMIT_TWO_RECEIPT_READS',guard,tables,actor,club,ingredient,before:fingerprint(),stockBefore:stock(),reads:[],writes:[],heldReceiptReads:0,releasedReceiptReads:0,denied:[],errors:[],marks:[],events:[],success:false};
const save=()=>writeFileSync(report,JSON.stringify(state,null,2)+'\n');save();
let holdReceipt=true,applyAttempted=false;
const sessions=new Set(),secret=randomUUID(),user={id:actor,email:'stock1102@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-27T00:00:00Z'};
const server=createServer(async(req,res)=>{
  const send=(status,value)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile');
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  try{
    const u=new URL(req.url,'http://127.0.0.1:54329'),name=u.pathname.split('/').at(-1);let raw='';for await(const part of req){raw+=part;assert.ok(raw.length<8192);}const input=raw?JSON.parse(raw):{};
    if(u.pathname==='/__local/manifest')return send(200,{actor,club,tour,email:user.email,runId:'1102',singleTour:true,model:'TEST modeled Auth; native stock RPC and public reads'});
    if(u.pathname==='/auth/v1/token'){
      assert.equal(input.email,user.email);assert.equal(input.password,'LOCAL_TEST_ONLY');const exp=Math.floor(Date.now()/1000)+3600;
      const base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url');
      const token=base+'.'+createHmac('sha256',secret).update(base).digest('base64url');sessions.add(token);
      return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});
    }
    const token=String(req.headers.authorization??'').replace(/^Bearer /,'');if(!sessions.has(token))return send(401,{message:'LOCAL_MODELED_SESSION_REQUIRED'});
    if(u.pathname==='/auth/v1/user')return send(200,user);
    if(u.pathname==='/auth/v1/logout'){sessions.delete(token);return send(200,{});}
    if(req.method==='POST'&&u.pathname==='/rest/v1/rpc/fnb_stock_in'){
      assert.equal(state.writes.length,0,'Only one explicitly chosen test write');
      assert.deepEqual(Object.keys(input).sort(),['p_club_id','p_ingredient_id','p_qty_purchase','p_unit_cost_purchase','p_client_request_id'].sort());
      assert.equal(input.p_club_id,club);assert.equal(input.p_ingredient_id,ingredient);assert.equal(input.p_qty_purchase,0.5);assert.equal(input.p_unit_cost_purchase,1000);uuid(input.p_client_request_id);
      request=input.p_client_request_id;state.writes.push({args:input,phase:'dispatch'});save();assert.equal(body(),manifest.afterBody);
      const result=JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='10s';${claims}SELECT public.fnb_stock_in('${club}','${ingredient}',0.5,1000,${literal(request)});COMMIT;`));
      state.writes[0].result=result;state.writes[0].phase='committed';assert.equal(result.status,'ok');assert.notEqual(result.idempotent,true);state.events.push('REAL_RPC_COMMITTED_BEFORE_CONTROLLED_HTTP_503');save();
      return send(503,{message:'LOCAL1102_COMMITTED_RESPONSE_LOST'});
    }
    if(req.method==='GET'&&u.pathname.startsWith('/rest/v1/')){
      let value;
      if(['user_roles','dealers','club_chip_masters','club_marketers','club_fnb_staff','club_accountants'].includes(name)){
        assert.equal(u.searchParams.get('user_id'),'eq.'+actor);const columns=name==='user_roles'?'role':name==='dealers'?'id':'club_id';assert.equal(u.searchParams.get('select'),columns);
        value=native(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT ${columns} FROM public.${name} WHERE user_id='${actor}'${name==='dealers'?' AND deleted_at IS NULL':''}${name==='user_roles'?'':' LIMIT 1'})x;`);
      }else if(name==='clubs'){
        assert.equal(u.searchParams.get('select'),'id');assert.equal(u.searchParams.get('owner_id'),'eq.'+actor);
        value=native(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT id FROM public.clubs WHERE owner_id='${actor}' LIMIT 1)x;`);
      }else if(['fnb_categories','fnb_menu_items','fnb_ingredients','fnb_stock_movements'].includes(name)){
        assert.equal(u.searchParams.get('select'),'*');assert.equal(u.searchParams.get('club_id'),'eq.'+club);
        if(name==='fnb_stock_movements'){
          const filter=u.searchParams.get('client_request_id');
          if(filter){assert.ok(filter.startsWith('eq.'));const key=filter.slice(3);uuid(key);assert.equal(u.searchParams.get('limit'),'2');
            value=native(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT * FROM public.fnb_stock_movements WHERE club_id='${club}' AND client_request_id=${literal(key)} LIMIT 2)x;`);
            state.reads.push({name,kind:'exact-request',request:key,nativeRows:value.length});
            if(holdReceipt){state.heldReceiptReads++;save();return send(503,{message:'LOCAL1102_RECEIPT_TEMPORARILY_UNAVAILABLE'});}state.releasedReceiptReads++;
          }else{assert.equal(u.searchParams.get('limit'),'12');value=native(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT * FROM public.fnb_stock_movements WHERE club_id='${club}' ORDER BY created_at DESC LIMIT 12)x;`);}
        }else{
          const order=name==='fnb_categories'?'sort_order,name':name==='fnb_menu_items'?'sort_order':'name';
          value=native(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT * FROM public.${name} WHERE club_id='${club}' ORDER BY ${order})x;`);
          if(name==='fnb_menu_items')assert.ok(value.every(x=>!x.image_url),'No external menu images for this run');
        }
      }else{state.denied.push({method:req.method,name});save();return send(403,{message:'LOCAL1102_READ_NOT_ALLOWED'});}
      state.reads.push({name,kind:'read',nativeRows:Array.isArray(value)?value.length:null});save();return send(200,value);
    }
    state.denied.push({method:req.method,name});save();return send(403,{message:'LOCAL1102_OTHER_WRITES_DENIED'});
  }catch(error){state.errors.push({message:error.message});save();send(500,{message:'LOCAL1102_ADAPTER_ERROR'});}
});
try{
  assert.equal(state.stockBefore.units_per_purchase,1);assert.equal(state.stockBefore.avg_unit_cost,1000);
  applyAttempted=true;sql('BEGIN;'+up+'COMMIT;');assert.equal(body(),manifest.afterBody);state.events.push('CANDIDATE_TEMPORARILY_INSTALLED_IN_OWNED_CLONE');save();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54329,'127.0.0.1',resolve);});console.log('STOCK1102_READY_ONE_WRITER_ONLY');
  await new Promise(resolve=>process.stdin.on('data',chunk=>{const cmd=String(chunk).trim();
    if(cmd==='restore'){holdReceipt=false;state.events.push('RECEIPT_READ_RESPONSE_RESTORED');save();console.log('STOCK1102_RECEIPT_RESTORED');}
    else if(cmd==='mark'){state.marks.push({at:new Date().toISOString(),writers:state.writes.length,reads:state.reads.length,held:state.heldReceiptReads,released:state.releasedReceiptReads});save();console.log('STOCK1102_MARK_SAVED');}
    else if(cmd==='stop'){process.stdin.pause();resolve();}else throw Error('Unknown local observation command');
  }));
  assert.equal(state.writes.length,1);assert.equal(state.writes[0].phase,'committed');assert.ok(state.heldReceiptReads>=1);assert.ok(state.releasedReceiptReads>=2);
  state.stockAfter=stock();assert.equal(state.stockAfter.on_hand,state.stockBefore.on_hand+0.5);assert.equal(state.stockAfter.avg_unit_cost,1000);assert.equal(state.stockAfter.version,state.stockBefore.version+1);
  const rest=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!['on_hand','version','updated_at'].includes(k)));assert.deepEqual(rest(state.stockAfter),rest(state.stockBefore));
  state.movements=native(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT * FROM public.fnb_stock_movements WHERE club_id='${club}' AND client_request_id=${literal(request)} LIMIT 2)x;`);
  assert.equal(state.movements.length,1);assert.equal(state.movements[0].delta,0.5);assert.equal(state.movements[0].balance_after,state.stockAfter.on_hand);
  state.after=fingerprint();assert.equal(state.after,state.before);assert.equal(state.errors.length,0);assert.equal(state.denied.length,0);state.success=true;
}finally{
  if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  if(applyAttempted){const current=body();if(current===manifest.afterBody)sql('BEGIN;'+down+'COMMIT;');else assert.equal(current,manifest.beforeBody,'Do not overwrite drift');state.restoredBody=body();assert.equal(state.restoredBody,manifest.beforeBody);}
  save();
}
console.log(JSON.stringify({success:state.success,request,writers:state.writes.length,held:state.heldReceiptReads,released:state.releasedReceiptReads,protectedUnchanged:state.before===state.after,stockBefore:state.stockBefore.on_hand,stockAfter:state.stockAfter?.on_hand,body:state.restoredBody}));
