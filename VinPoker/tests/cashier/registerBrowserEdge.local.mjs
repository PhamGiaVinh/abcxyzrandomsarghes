import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {z} from 'zod';

// Only transport/Auth are modeled. Run the product Edge handler and shared
// validation unchanged; its canonical registration RPC commits in native PG.
export async function runRegisterBrowserEdge({body,fixture,user,sql,log,reentry=false}) {
 assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');
 assert.equal(body.tournament_id,fixture.tour);
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
 const quote=v=>v===null?'NULL':`'${String(v).replaceAll("'","''")}'`;
 const validationSource=stripTypeScriptTypes(readFileSync('supabase/functions/_shared/validate.ts','utf8')
  .replace(/^import[^\n]+\n/gm,'').replace('export { z };','').replace('export async function','async function'));
 const parseBody=runInNewContext(`${validationSource}\nparseBody;`,{z,Response});
 const specs={
  tournaments:['id, name, buy_in, start_time, status, club_id, rake_amount, free_rake_enabled, free_rake_slots, free_rake_used','id,name,club_id'],
  cashier_tour_settings:['enabled'],club_payment_config:['master_account_number'],
  platform_bank_accounts:['id, club_id, bank_name, account_number, account_holder, qr_code_url','id,bank_name,account_number,account_holder,qr_code_url','bank_bin'],
 };
 const admin={rpc:async(name,args)=>{
  assert.equal(name,reentry?'cashier_create_app_reentry_v1':'cashier_create_app_registration_v1');
  assert.equal(args.p_tournament_id,fixture.tour);assert.equal(args.p_player_id,user.id);
  const result=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';
   SET LOCAL ROLE service_role;SELECT public.${name}('${fixture.tour}','${user.id}');COMMIT;`));
  log.push({edgeRpc:name,tour:fixture.tour,registration:result.registration_id??null,alreadyRegistered:result.already_registered??null,ok:result.ok});
  return {data:result,error:null};
 },from:table=>{
  let columns,inserted=null,accountLookup=false;const filters=[];
  const execute=(single=true)=>{
   log.push({edgeRead:table,columns,reentry});
   if(inserted){
    assert.equal(table,'notifications');assert.equal(inserted.user_id,user.id);assert.equal(inserted.type,'registration_confirmed');
    assert.equal(inserted.data.tournament_id,fixture.tour);assert.equal(inserted.data.club_id,fixture.club);
    sql(`INSERT INTO public.notifications(user_id,type,title,body,data) VALUES('${user.id}',${quote(inserted.type)},${quote(inserted.title)},${quote(inserted.body)},${quote(JSON.stringify(inserted.data))}::jsonb);`);
    log.push({edgeNotification:'registration_confirmed',tour:fixture.tour});return {data:null,error:null};
   }
   assert.ok(specs[table]?.includes(columns),`unsupported register read ${table}:${columns}`);
    // Product checks account exclusivity globally, before accepting club_id.
    // Pre-filtering by fixture club would hide an account duplicated elsewhere.
    const where=accountLookup?'true':table==='tournaments'?`id='${fixture.tour}'`: `club_id='${fixture.club}'`;
   const data=JSON.parse(sql(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT ${columns} FROM public.${table} WHERE ${where}${filters.length?' AND '+filters.join(' AND '):''} LIMIT 2) t;`));
   if(single)assert.ok(data.length<=1,'ambiguous registration configuration');
   return {data:single?(data[0]??null):data,error:null};
  };
  const b={select:v=>{columns=v;return b;},eq:(key,value)=>{
   if(key==='id') {
    if(table==='tournaments')assert.equal(value,fixture.tour);
    else {assert.equal(table,'platform_bank_accounts');assert.match(value,/^[a-f0-9-]{36}$/i);filters.push(`id=${quote(value)}::uuid`);}
   }
   else if(key==='account_number'){
    assert.equal(table,'platform_bank_accounts');assert.ok(typeof value==='string'&&value.length>0&&value.length<=128);
    accountLookup=true;filters.push(`account_number=${quote(value)}`);
   }
   else if(key==='club_id')assert.equal(value,fixture.club);
   else {assert.equal(key,'is_active');assert.equal(value,true);filters.push('is_active=true');}
   return b;
  },not:(key,op,value)=>{assert.equal(key,'api_token_vault_key');assert.equal(op,'is');assert.equal(value,null);filters.push('api_token_vault_key IS NOT NULL');return b;},
  order:(key,options)=>{assert.equal(key,'created_at');assert.equal(options.ascending,false);assert.equal(Object.keys(options).length,1);return b;},
  limit:value=>{assert.equal(value,1);return b;},
  is:(key,value)=>{assert.equal(key,'club_id');assert.equal(value,null);throw Error('Local fixture requires its own TEST bank; platform fallback is not modeled');},
  insert:value=>{inserted=value;return b;},maybeSingle:async()=>execute(),then:(resolve,reject)=>Promise.resolve().then(()=>execute(!accountLookup)).then(resolve,reject)};
  return b;
 }};
 let handler;
 const endpoint=reentry?'tournament-reentry':'tournament-register';
 const source=stripTypeScriptTypes(readFileSync(`supabase/functions/${endpoint}/index.ts`,'utf8').replace(/^import[^\n]+\n/gm,''));
 runInNewContext(source,{parseBody,z,Request,Response,console,
  retryFetch:()=>{throw Error('Unexpected external fetch in native registration');},
  Deno:{env:{get:key=>({SUPABASE_URL:'http://127.0.0.1:54329',SUPABASE_ANON_KEY:'LOCAL_TEST_ANON',SUPABASE_SERVICE_ROLE_KEY:'LOCAL_TEST_SERVICE'})[key]},serve:fn=>{handler=fn;}},
  createClient:(_url,key)=>key==='LOCAL_TEST_SERVICE'?admin:{auth:{getUser:async()=>({data:{user},error:null})}},
 });
 assert.equal(typeof handler,'function');
 return handler(new Request(`http://127.0.0.1:54329/functions/v1/${endpoint}`,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer LOCAL_TEST_ALREADY_VERIFIED'},body:JSON.stringify(body)}));
}
