import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import * as policy from '../../supabase/functions/tournament-live-clock/controlPolicy.ts';

export async function runClockBrowserEdge({body,fixture,user,query,log}) {
 assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');
 assert.equal(body.tournament_id,fixture.tour);
 const quote=v=>v===null?'NULL':`'${String(v).replaceAll("'","''")}'`;
 const client={auth:{getUser:async()=>({data:{user},error:null})},rpc:async(name,args)=>{
  let statement;
  if(name==='get_my_floor_operator_scope') {
   assert.equal(args,undefined);
   statement="SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM public.get_my_floor_operator_scope() t;";
  } else {
   assert.equal(args.p_tournament_id,fixture.tour);
   if(['floor_start_tournament_clock','get_tournament_clock'].includes(name)) {
    assert.deepEqual(Object.keys(args),['p_tournament_id']);
    statement=`SELECT public.${name}('${fixture.tour}');`;
   } else {
    assert.equal(name,'floor_control_tournament_clock');
    assert.ok(policy.isPostStartClockAction(args.p_action));
    assert.ok(args.p_delta_seconds===null||Number.isSafeInteger(args.p_delta_seconds));
    assert.equal(typeof args.p_expected_control_revision,'string');
    assert.ok(args.p_expected_control_revision.length<256);
    statement=`SELECT public.floor_control_tournament_clock('${fixture.tour}',${quote(args.p_action)},
     ${args.p_delta_seconds??'NULL'},${quote(args.p_expected_control_revision)});`;
   }
  }
  const data=query(statement);log.push({clockRpc:name,action:args?.p_action??null,result:data});
  return {data,error:null};
 },from:table=>{
  assert.equal(table,'tournaments');const b={select:columns=>{
   assert.equal(columns,'id,club_id,status');return b;
  },eq:(key,value)=>{assert.equal(key,'id');assert.equal(value,fixture.tour);return b;},
  maybeSingle:async()=>({data:query(`SELECT to_jsonb(t) FROM(SELECT id,club_id,status FROM public.tournaments WHERE id='${fixture.tour}')t;`),error:null})};return b;
 }};
 let handler;
 const source=stripTypeScriptTypes(readFileSync('supabase/functions/tournament-live-clock/index.ts','utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm,''));
 runInNewContext(source,{...policy,Request,Response,console,createClient:()=>client,
  Deno:{env:{get:key=>({SUPABASE_URL:'http://127.0.0.1:54329',SUPABASE_ANON_KEY:'LOCAL_TEST_ANON'})[key]},serve:fn=>{handler=fn;}}});
 assert.equal(typeof handler,'function');
 return handler(new Request('http://127.0.0.1:54329/functions/v1/tournament-live-clock',{
  method:'POST',headers:{authorization:'Bearer LOCAL_VERIFIED_TEST','content-type':'application/json'},body:JSON.stringify(body)}));
}
