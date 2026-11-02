import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';

export async function runStakingRequestCosignNative(sql) {
  assert.equal(process.env.VINPOKER_NATIVE_PAYOUT, '1');
  const actor='f16aa171-4390-4c7c-9ea7-d16e4144092e',deal=randomUUID(),purchase=randomUUID(),superRole=randomUUID(),cashierRole=randomUUID();
  const club=sql(`SELECT club_id FROM public.tournaments WHERE id='d66cce0e-4225-4765-8b8c-9462e69153e1' AND name='Multi-day Final local TEST';`);
  assert.match(club,/^[a-f0-9-]{36}$/);
  const quote=value=>`'${String(value).replaceAll("'","''")}'`;
  sql(`BEGIN;
    INSERT INTO public.user_roles(id,user_id,role) VALUES('${superRole}','${actor}','super_admin'),('${cashierRole}','${actor}','cashier') ON CONFLICT DO NOTHING;
    INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,percentage_sold,markup,buy_in_amount_vnd,status,
      filled_percent,result_prize_vnd,backer_payout_vnd,player_payout_vnd,platform_fee_vnd,platform_archive_fee)
    VALUES('${deal}','${actor}','${club}','LOCAL TEST request cosign handler',now(),10,1,1000000,'result_verified',10,1000000,80100,720900,199000,199000);
    INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
    VALUES('${purchase}','${deal}','${actor}',10,1,100000,'funded','${purchase}');COMMIT;`);
  let dropRequest=true,dropCosign=true,requestId;const calls=[];
  const admin={ from:()=>{throw new Error('direct_write_forbidden');}, rpc:async(name,args)=>{
    assert.equal(args.p_actor,actor);let call;
    if(name==='request_staking_release_v1') {
      assert.equal(args.p_deal,deal);assert.equal(args.p_backer,80100);assert.equal(args.p_player,720900);
      call=`public.request_staking_release_v1('${actor}','${deal}',80100,720900,${args.p_note==null?'NULL':quote(args.p_note)})`;
    }else{
      assert.equal(name,'cosign_staking_release_v1');assert.equal(args.p_request,requestId);
      call=`public.cosign_staking_release_v1('${actor}','${requestId}',${args.p_note==null?'NULL':quote(args.p_note)})`;
    }
    const data=JSON.parse(sql(`BEGIN;SET LOCAL ROLE service_role;SELECT ${call};COMMIT;`));calls.push(name);
    if(name==='request_staking_release_v1'&&dropRequest){dropRequest=false;throw new Error('LOCAL_DROP_AFTER_REQUEST_COMMIT');}
    if(name==='cosign_staking_release_v1'&&dropCosign){dropCosign=false;throw new Error('LOCAL_DROP_AFTER_COSIGN_COMMIT');}
    return {data,error:null};
  }};
  function load(path){
    let handler;
    const source=readFileSync(path,'utf8').replace(/^import .*;\r?$/gm,'');
    runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
      z,Request,Response,corsHeaders:{},json:(body,status=200)=>new Response(JSON.stringify(body),{status}),
      authenticateUser:async()=>({uid:actor}),createAdminClient:options=>{assert.equal(options.retry,false);assert.equal(Object.keys(options).length,1);return admin;},
      requireAdminRoles:async()=>({isSuper:true,isCashier:true}),
      parseBody:async(req,schema)=>{const parsed=schema.safeParse(await req.json());return parsed.success?{ok:true,data:parsed.data}:{ok:false,response:new Response('{}',{status:400})};},
      Deno:{serve:fn=>{handler=fn;}},
    });return handler;
  }
  const post=(handler,body)=>handler(new Request('http://local.invalid',{method:'POST',body:JSON.stringify(body)}));
  try{
    const request=load('supabase/functions/staking-request-release/index.ts');
    const body={deal_id:deal,backer_amount:80100,player_amount:720900,note:'LOCAL REQUEST'};
    assert.equal((await post(request,body)).status,503);
    requestId=sql(`SELECT id FROM public.staking_release_requests WHERE deal_id='${deal}';`);assert.match(requestId,/^[a-f0-9-]{36}$/);
    const recovered=await post(request,body);assert.equal(recovered.status,200);assert.equal((await recovered.json()).release_request_id,requestId);
    const cosign=load('supabase/functions/staking-cosign-release/index.ts');
    const cosignBody={release_request_id:requestId,note:'LOCAL COSIGN'};
    assert.equal((await post(cosign,cosignBody)).status,503);
    const completed=await post(cosign,cosignBody);assert.equal(completed.status,200);assert.equal((await completed.json()).existing,true);
    const facts=JSON.parse(sql(`SELECT jsonb_build_object('requests',(SELECT count(*) FROM public.staking_release_requests WHERE deal_id='${deal}'),
      'requestAudit',(SELECT count(*) FROM public.staking_audit_logs WHERE deal_id='${deal}' AND action='release_requested'),
      'cosignAudit',(SELECT count(*) FROM public.staking_audit_logs WHERE deal_id='${deal}' AND action='release_cosigned'),
      'dealState',(SELECT status FROM public.staking_deals WHERE id='${deal}'),
      'requestState',(SELECT status FROM public.staking_release_requests WHERE id='${requestId}'),
      'note',(SELECT note FROM public.staking_release_requests WHERE id='${requestId}'),
      'ledger',(SELECT count(*) FROM public.staking_ledger WHERE deal_id='${deal}'));`));
    assert.deepEqual(facts,{requests:1,requestAudit:1,cosignAudit:1,dealState:'cosigned',requestState:'approved',note:'LOCAL REQUEST',ledger:0});
    assert.equal(calls.length,4);
    console.log('ACTUAL_REQUEST_COSIGN_HANDLERS_NATIVE_COMMIT_RESPONSE_LOSS_EXACT_REPLAY_PASS',JSON.stringify({deal,request:requestId,facts}));
  }finally{
    sql(`DELETE FROM public.user_roles WHERE id IN('${superRole}','${cashierRole}') AND user_id='${actor}';`);
  }
}
