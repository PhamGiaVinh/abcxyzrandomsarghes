// Actual Notifications page + SDK + native read flags; held HTTP replies, outer ROLLBACK.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createHmac,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';

assert.equal(process.env.VINPOKER_INBOX953_LOCAL,'1');
const actor='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',club='d4427834-5f5f-48ef-bde5-e2dc388ed00b';
const tour='c367013a-3ed3-48af-ad48-3915acadc50e',ids=[randomUUID(),randomUUID()];
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const tables=['public.notifications','private.notification_push_outbox_v1','net.cash_ui_http_sink','public.tournament_entries','public.tournament_seats','public.cashier_buyin_movements','public.tournament_prize_payments','public.chip_inventory_ledger','public.chip_bank_ledger'];
const fingerprint=`md5(jsonb_build_array(${tables.map(table=>`(SELECT md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) FROM ${table} r)`).join(',')})::text)`;
const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
let stdout='',stderr='',terminal=false,chain=Promise.resolve();
child.stdout.on('data',part=>stdout+=part);child.stderr.on('data',part=>stderr+=part);
const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{terminal=true;resolve(code);});});
function execute(sql){const task=chain.then(async()=>{assert.equal(terminal,false,stderr);const marker='INBOX953_'+randomUUID().replaceAll('-',''),offset=stdout.length;child.stdin.write(sql+'\nSELECT '+q(marker)+';\n');const deadline=Date.now()+20000;while(!stdout.slice(offset).includes(marker)){assert.equal(terminal,false,stderr);assert.ok(Date.now()<deadline,'native observation timeout');await new Promise(resolve=>setTimeout(resolve,25));}const lines=stdout.slice(offset).split(/\r?\n/).filter(line=>line.startsWith('{'));return lines.length?JSON.parse(lines.at(-1)):null;});chain=task.catch(()=>{});return task;}
await execute(`DO $$ BEGIN
 ASSERT current_database()='vinpoker_ranking860_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
 ASSERT (SELECT package_hash FROM floor_private.ranking860_install_backup)='d786e04b14c42eaeb0832b97ea47f992eacd755ad1e94d9022f6a28920c778bd';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
END $$;
CREATE TEMP TABLE inbox953_protected AS SELECT ${fingerprint} fingerprint;
BEGIN;SET LOCAL statement_timeout='8s';SET LOCAL idle_in_transaction_session_timeout='10min';
INSERT INTO public.notifications(id,user_id,type,title,body,data,is_read) VALUES
 (${q(ids[0])},${q(actor)},'system_announcement','LOCAL inbox953 A TEST','Đánh dấu một thông báo; response local được giữ.','{}',false),
 (${q(ids[1])},${q(actor)},'system_announcement','LOCAL inbox953 B TEST','Đánh dấu tất cả; mọi thay đổi sẽ rollback.','{}',false);
SELECT set_config('request.jwt.claim.sub',${q(actor)},true);
SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:actor,role:'authenticated'}))},true);`);
const state={scope:'actual Notifications UI/native PG read flags; Auth/HTTP modeled; synthetic list slice; all writes rollback',ids,trace:[],patches:0,denied:0,providerMappingBlocked:0};
const save=()=>writeFileSync('D:/Quy trình/output/reports/inbox953-mark-read-native-state-local-20261027.json',JSON.stringify(state,null,2)+'\n');
async function native(expression){return execute(`DO $$ DECLARE value jsonb;err jsonb;BEGIN BEGIN PERFORM set_config('role','authenticated',true);SELECT ${expression} INTO value;EXCEPTION WHEN OTHERS THEN err:=jsonb_build_object('code',SQLSTATE,'message',SQLERRM);END;PERFORM set_config('role','none',true);PERFORM set_config('inbox953.response',jsonb_build_object('data',value,'error',err)::text,true);END $$;SELECT current_setting('inbox953.response')::jsonb;`);}
const sessions=new Map(),signing=randomUUID(),user={id:actor,email:'inbox953@example.invalid',role:'authenticated',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-27T00:00:00Z'};
const fixtureIds=ids.map(q).join(','),held=[];
const server=createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');
 res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept-profile,content-profile');res.setHeader('Access-Control-Allow-Methods','GET,HEAD,POST,PATCH,OPTIONS');
 const reply=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};
 if(req.headers.host!=='127.0.0.1:54329'||(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:5188'))return reply(403,{message:'INBOX953_SCOPE'});
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{
  const url=new URL(req.url,'http://127.0.0.1:54329');let raw='';for await(const part of req){raw+=part;assert.ok(raw.length<4096);}const body=raw?JSON.parse(raw):{};
  if(url.pathname==='/__local/manifest')return reply(200,{tour,actor,club,email:user.email,runId:'953',model:state.scope});
  if(url.pathname==='/auth/v1/token'){
   if(body.email!==user.email||body.password!=='LOCAL_TEST_ONLY')return reply(401,{message:'INBOX953_TEST_LOGIN_REQUIRED'});
   const exp=Math.floor(Date.now()/1000)+3600,base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url');
   const token=base+'.'+createHmac('sha256',signing).update(base).digest('base64url');sessions.set(token,true);return reply(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});
  }
  if(!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return reply(401,{message:'INBOX953_LOGIN_REQUIRED'});
  if(url.pathname==='/auth/v1/user')return reply(200,user);
  if(req.method==='PATCH'&&url.pathname==='/rest/v1/profiles'){
   assert.equal(url.searchParams.get('user_id'),'eq.'+actor);assert.deepEqual(body,{onesignal_external_user_id:actor});
   state.providerMappingBlocked++;state.trace.push({kind:'provider_mapping_blocked'});save();return reply(403,{message:'INBOX953_PROVIDER_MAPPING_OUT_OF_SCOPE'});
  }
  if(req.method==='GET'&&url.pathname.startsWith('/rest/v1/')&&url.pathname!=='/rest/v1/notifications'){
   const table=url.pathname.slice('/rest/v1/'.length);
   if(['user_roles','dealers','club_chip_masters','club_marketers','club_fnb_staff','club_accountants'].includes(table))return reply(200,[]);
   if(table==='clubs')return reply(200,[{id:club}]);
  }
  if(url.pathname==='/rest/v1/notifications'){
   assert.equal(url.searchParams.get('user_id'),'eq.'+actor);
   if(req.method==='PATCH'){
    assert.deepEqual(body,{is_read:true});const one=url.searchParams.get('id');
    if(one)assert.ok(ids.includes(one.slice(3))&&one.startsWith('eq.'));else assert.equal(url.searchParams.get('is_read'),'eq.false');
    const value=await execute(`SET LOCAL ROLE authenticated;WITH changed AS (UPDATE public.notifications SET is_read=true WHERE user_id=${q(actor)}${one?' AND id='+q(one.slice(3)):' AND NOT is_read'} RETURNING id) SELECT jsonb_build_object('changed',count(*)) FROM changed;RESET ROLE;`);
    state.patches++;state.trace.push({kind:'native_patch_held',mode:one?'one':'all',changed:value.changed,at:Date.now()});held.push(res);save();return;
   }
   if(req.method==='HEAD'){
    const value=await native(`jsonb_build_object('count',(SELECT count(*) FROM public.notifications WHERE user_id=${q(actor)} AND id IN(${fixtureIds}) AND NOT is_read))`);assert.equal(value.error,null);
    state.trace.push({kind:'count',count:value.data.count});save();res.writeHead(200,{'Content-Range':'0-0/'+value.data.count,'Access-Control-Expose-Headers':'Content-Range'});return res.end();
   }
   if(req.method==='GET'){
    assert.ok(['15','20','100'].includes(url.searchParams.get('limit')));
    const value=await native(`coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.title) FROM public.notifications n WHERE user_id=${q(actor)} AND id IN(${fixtureIds})),'[]'::jsonb)`);assert.equal(value.error,null);
    state.trace.push({kind:'list',read:value.data.map(row=>row.is_read),at:Date.now()});save();return reply(200,value.data);
   }
  }
  state.denied++;state.trace.push({kind:'denied',path:url.pathname});save();return reply(403,{message:'INBOX953_NOT_IN_SCOPE'});
 }catch(error){state.trace.push({kind:'adapter_error',error:String(error)});save();return reply(500,{message:'INBOX953_ADAPTER_ERROR'});}
});
save();server.listen(54329,'127.0.0.1',()=>console.log('INBOX953_READY',JSON.stringify({ids,tour})));
process.stdin.once('data',async()=>{
 process.stdin.pause();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 try{
  assert.equal(state.patches,2);assert.equal(held.length,2);assert.equal(state.denied,0);assert.ok(!state.trace.some(row=>row.kind==='adapter_error'));
  const flags=await native(`jsonb_build_object('read',(SELECT count(*) FROM public.notifications WHERE id IN(${fixtureIds}) AND is_read))`);assert.equal(flags.error,null);assert.equal(flags.data.read,2);
  const result=await execute(`ROLLBACK;DO $$ BEGIN ASSERT (SELECT fingerprint FROM inbox953_protected)=${fingerprint},'protected facts changed';END $$;SELECT jsonb_build_object('protectedUnchanged',true,'tables',${tables.length});`);
  state.final=result;save();child.stdin.end();assert.equal(await done,0);console.log('INBOX953_ROLLBACK_PASS',JSON.stringify(result));
 }catch(error){state.finalError=String(error);save();child.stdin.end('ROLLBACK;\n');await done;console.error(String(error));process.exitCode=1;}
});
