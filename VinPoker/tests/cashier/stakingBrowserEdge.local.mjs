import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { drainStakingReleaseEffects } from '../../supabase/functions/_shared/stakingReleaseEffects.ts';
import { deliverStakingReleaseEffect, parseReleaseDeliveryStatus } from '../../supabase/functions/_shared/stakingReleaseDelivery.ts';

export function createStakingBrowserEdge({ sql, query, actor, club, log }) {
  assert.equal(process.env.VINPOKER_NATIVE_BROWSER, '1');
  if(process.env.VINPOKER_STAKING_PURCHASE_PROFILE_NEGATIVE==='1'||process.env.VINPOKER_STAKING_PURCHASE_POSITIVE==='1')return createPurchaseProfileProbe({sql,actor,club,log});
  const existing = process.env.VINPOKER_STAKING_EXISTING_REQUEST;
  const lifecycle = process.env.VINPOKER_STAKING_LIFECYCLE === '1';
  assert.ok(!(lifecycle && existing), 'lifecycle writes and existing read-only mode are exclusive');
  if (existing) assert.match(existing, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  const reused = existing ? JSON.parse(sql(`SELECT jsonb_build_object('deal',d.id,'request',rr.id) FROM public.staking_release_requests rr
    JOIN public.staking_deals d ON d.id=rr.deal_id JOIN public.staking_release_receipts_v1 r ON r.release_request_id=rr.id
    WHERE rr.id='${existing}' AND d.custom_event_name='LOCAL TEST browser staking' AND d.player_id='${actor}' AND d.club_id='${club}' AND d.status='completed';`) || 'null') : null;
  if (existing) assert.ok(reused, 'only exact completed local browser fixture may be reused');
  const deal = reused?.deal ?? randomUUID(), roleId = randomUUID(), cashierRoleId = randomUUID();
  let request = reused?.request ?? (lifecycle ? '' : randomUUID());
  const purchases = [2,2,3,3].map(percent => ({ id: randomUUID(), percent }));
  const quote = value => `'${String(value).replaceAll("'", "''")}'`;
  const sends = [];let drops = 2, handler, continuation, requestHandler, cosignHandler, dropRequest = lifecycle, dropCosign = lifecycle;
  if (!existing) sql(`BEGIN;INSERT INTO public.user_roles(id,user_id,role) VALUES('${roleId}','${actor}','super_admin') ON CONFLICT(user_id,role) DO NOTHING;
    ${lifecycle ? `INSERT INTO public.user_roles(id,user_id,role) VALUES('${cashierRoleId}','${actor}','cashier') ON CONFLICT(user_id,role) DO NOTHING;` : ''}
    INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,percentage_sold,markup,buy_in_amount_vnd,status,
      filled_percent,result_prize_vnd,backer_payout_vnd,player_payout_vnd,platform_fee_vnd,platform_archive_fee)
    VALUES('${deal}','${actor}','${club}','LOCAL TEST browser staking',now(),10,1,1000000,'${lifecycle ? 'result_verified' : 'cosigned'}',10,1000000,80100,720900,199000,199000);
    INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
    VALUES ${purchases.map(p => `('${p.id}','${deal}','${actor}',${p.percent},1,${p.percent * 10000},'funded','${p.id}')`).join(',')};
    ${lifecycle ? '' : `INSERT INTO public.staking_release_requests(id,deal_id,requested_by_admin_id,cosigned_by_admin_id,status)
    VALUES('${request}','${deal}','${actor}','${actor}','approved');`}COMMIT;`);
  const service = call => JSON.parse(sql(`BEGIN;SET LOCAL ROLE service_role;SELECT to_jsonb(${call});COMMIT;`));
  const admin = {
    rpc: async (name, args) => {
      let call;
      if (name === 'request_staking_release_v1') {
        assert.ok(lifecycle);assert.equal(args.p_actor, actor);assert.equal(args.p_deal, deal);
        assert.equal(args.p_backer, 80100);assert.equal(args.p_player, 720900);
        call = `public.request_staking_release_v1('${actor}','${deal}',80100,720900,${args.p_note == null ? 'NULL' : quote(args.p_note)})`;
      } else if (name === 'cosign_staking_release_v1') {
        assert.ok(lifecycle);assert.equal(args.p_actor, actor);assert.equal(args.p_request, request);
        call = `public.cosign_staking_release_v1('${actor}','${request}',${args.p_note == null ? 'NULL' : quote(args.p_note)})`;
      } else if (name === 'commit_staking_release_v2') {
        assert.equal(args.p_actor, actor);assert.equal(args.p_payload.release_request_id, request);
        call = `public.commit_staking_release_v2('${actor}',${quote(JSON.stringify(args.p_payload))}::jsonb)`;
      } else if (name === 'claim_staking_release_effect_v1') {
        assert.equal(args.p_request, request);call = `public.claim_staking_release_effect_v1('${request}')`;
      } else if (name === 'get_staking_release_effect_status_for_actor_v1') {
        assert.equal(args.p_actor, actor);assert.equal(args.p_request, request);
        call = `public.get_staking_release_effect_status_for_actor_v1('${actor}','${request}')`;
      } else {
        assert.ok(['publish_staking_release_result_v1', 'finish_staking_release_effect_v1'].includes(name));
        const id = args.p_effect ?? args.p_id;assert.match(id, /^[a-f0-9-]{36}$/);
        assert.equal(sql(`SELECT release_request_id FROM public.staking_release_effects_v1 WHERE id='${id}';`), request);
        call = name === 'publish_staking_release_result_v1' ? `public.publish_staking_release_result_v1('${id}',${quote(args.p_token)}::uuid)`
          : `public.finish_staking_release_effect_v1('${id}',${quote(args.p_token)}::uuid,${args.p_provider_id == null ? 'NULL' : quote(args.p_provider_id)},${args.p_error_code == null ? 'NULL' : quote(args.p_error_code)})`;
      }
      const data = service(call);log.push({ stakingRpc: name, request });
      if (name === 'request_staking_release_v1') {
        request = data.release_request_id;
        if (dropRequest) { dropRequest = false;log.push({ stakingFault: 'REQUEST_COMMIT_RESPONSE_DROPPED', request });throw new Error('LOCAL_DROP_AFTER_REQUEST'); }
      }
      if (name === 'cosign_staking_release_v1' && dropCosign) { dropCosign = false;log.push({ stakingFault: 'COSIGN_COMMIT_RESPONSE_DROPPED', request });throw new Error('LOCAL_DROP_AFTER_COSIGN'); }
      if (name === 'commit_staking_release_v2' && drops > 0) { drops--;log.push({ stakingFault: 'COMMIT_RESPONSE_DROPPED', request });throw new Error('LOCAL_DROP_AFTER_COMMIT'); }
      return { data, error: null };
    },
    auth: { admin: { getUserById: async id => { assert.equal(id, actor);return { data: { user: { email: 'browser-sink@example.invalid' } }, error: null }; } } },
    functions: { invoke: async (name, options) => {
      assert.equal(name, 'send-email');assert.equal(options.body.to, 'browser-sink@example.invalid');
      assert.ok(options.body.html.includes('LOCAL TEST browser staking'));sends.push({ ordinal: sends.length + 1 });
      if (process.env.VINPOKER_STAKING_UNKNOWN_SEND === '1' && sends.length === 1) throw new Error('LOCAL_UNKNOWN_SEND');
      return { data: { success: true, id: `LOCAL_BROWSER_SINK_${sends.length}` }, error: null };
    } },
  };
  const source = readFileSync('supabase/functions/staking-execute-release/index.ts', 'utf8').replace(/^import .*;\r?$/gm, '');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    z, Request, Response, drainStakingReleaseEffects, deliverStakingReleaseEffect, parseReleaseDeliveryStatus,
    corsHeaders: {}, json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
    authenticateUser: async () => ({ uid: actor }), createAdminClient: () => admin,
    requireAdminRoles: async () => ({ isSuper: true, isCashier: false }),
    parseBody: async (req, schema) => { const parsed = schema.safeParse(await req.json());return parsed.success ? { ok: true, data: parsed.data } : { ok: false, response: new Response('{}', { status: 400 }) }; },
    Deno: { serve: fn => { handler = fn; } },
  });
  if (lifecycle) for (const kind of ['request', 'cosign']) {
    const lifecycleSource = readFileSync(`supabase/functions/staking-${kind}-release/index.ts`, 'utf8').replace(/^import .*;\r?$/gm, '');
    runInNewContext(ts.transpileModule(lifecycleSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
      z, Request, Response, corsHeaders: {}, json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
      authenticateUser: async () => ({ uid: actor }), createAdminClient: () => admin,
      requireAdminRoles: async () => ({ isSuper: true, isCashier: true }),
      parseBody: async (req, schema) => { const parsed = schema.safeParse(await req.json());return parsed.success ? { ok: true, data: parsed.data } : { ok: false, response: new Response('{}', { status: 400 }) }; },
      Deno: { serve: fn => { if (kind === 'request') requestHandler = fn;else cosignHandler = fn; } },
    });
  }
  const continuationSource = readFileSync('supabase/functions/staking-process-release-effects/index.ts', 'utf8').replace(/^import .*;\r?$/gm, '');
  runInNewContext(ts.transpileModule(continuationSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    z, Request, Response, drainStakingReleaseEffects, deliverStakingReleaseEffect, parseReleaseDeliveryStatus,
    corsHeaders: {}, json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
    authenticateUser: async () => ({ uid: actor }), createAdminClient: () => admin,
    requireAdminRoles: async () => ({ isSuper: true, isCashier: false }),
    parseBody: async (req, schema) => { const parsed = schema.safeParse(await req.json());return parsed.success ? { ok: true, data: parsed.data } : { ok: false, response: new Response('{}', { status: 400 }) }; },
    Deno: { serve: fn => { continuation = fn; } },
  });
  return {
    get manifest() { return { deal, request, oneStep: lifecycle, state: sql(`SELECT status FROM public.staking_deals WHERE id='${deal}';`), prize: 1000000, fee: 199000, backer: 80100, player: 720900 }; },
    async route(url, method, body) {
      if (lifecycle && url.pathname === '/rest/v1/staking_release_requests' && method === 'GET') {
        assert.equal(url.searchParams.get('deal_id'), `eq.${deal}`);assert.equal(url.searchParams.get('select'), 'id,status');
        assert.equal(url.searchParams.get('status'), 'in.(pending_cosign,approved)');
        return { status: 200, value: query(`SELECT row_to_json(t) FROM(SELECT id,status FROM public.staking_release_requests WHERE deal_id='${deal}' AND status IN('pending_cosign','approved')) t;`) };
      }
      if (lifecycle && ['/functions/v1/staking-request-release', '/functions/v1/staking-cosign-release'].includes(url.pathname) && method === 'POST') {
        const selected = url.pathname.endsWith('/staking-request-release') ? requestHandler : cosignHandler;
        const response = await selected(new Request('http://local.invalid/staking-lifecycle', { method: 'POST', body: JSON.stringify(body) }));
        return { status: response.status, value: await response.json() };
      }
      const table = url.pathname.match(/^\/rest\/v1\/(staking_purchases|staking_deals|staking_ledger|payout_recipients|deal_ratings|profiles)$/)?.[1];
      if (existing && table && method === 'GET' && (table !== 'profiles' || url.searchParams.get('user_id')?.startsWith('in.'))) {
        const expected = {
          staking_purchases: '*',
          staking_deals: 'id, player_id, tournament_id, custom_event_name, custom_event_date, buy_in_amount_vnd, percentage_sold, filled_percent, markup, status, result_prize_vnd, escrow_locked_at, early_closed, completed_at, player_checked_in, player_checkin_at',
          staking_ledger: 'deal_id, amount_vnd, proof_url, payout_method, metadata',
          payout_recipients: 'id, purchase_id, amount_vnd, platform_fee_vnd, method, status, paid_at, confirmed_at, proof_image_url',
          deal_ratings: 'deal_id', profiles: 'user_id, display_name, avatar_url',
        }[table].replaceAll(' ', '');
        assert.equal(url.searchParams.get('select')?.replaceAll(' ', ''), expected);
        let where;
        if (table === 'staking_purchases') { assert.equal(url.searchParams.get('backer_id'), `eq.${actor}`);where = `backer_id='${actor}' AND deal_id='${deal}'`; }
        else if (table === 'staking_deals') { assert.equal(url.searchParams.get('id'), `in.(${deal})`);where = `id='${deal}'`; }
        else if (table === 'profiles') { assert.equal(url.searchParams.get('user_id'), `in.(${actor})`);where = `user_id='${actor}'`; }
        else {
          assert.equal(url.searchParams.get('deal_id'), `in.(${deal})`);
          assert.equal(url.searchParams.get(table === 'deal_ratings' ? 'rater_id' : 'user_id'), `eq.${actor}`);
          where = `deal_id='${deal}' AND ${table === 'deal_ratings' ? 'rater_id' : 'user_id'}='${actor}'`;
          if (table === 'staking_ledger') { assert.equal(url.searchParams.get('entry_type'), 'eq.escrow_out_backer');where += " AND entry_type='escrow_out_backer'"; }
        }
        const value = query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT ${expected} FROM public.${table} WHERE ${where}) t;`);
        log.push({ stakingRead: table, rows: value.length, role: 'authenticated', fixture: deal });
        return { status: 200, value };
      }
      if (existing && (url.pathname.includes('staking-') || table) && method !== 'GET') return { status: 403, value: { error: 'LOCAL_READ_ONLY_FIXTURE' } };
      if (url.pathname === '/rest/v1/rpc/get_staking_release_preview_v1' && method === 'POST') {
        assert.deepEqual(body, { p_deal: deal });return { status: 200, value: query(`SELECT public.get_staking_release_preview_v1('${deal}');`) };
      }
      if (url.pathname === '/rest/v1/rpc/get_staking_release_effect_status_v1' && method === 'POST') {
        assert.deepEqual(body, { p_request: request });return { status: 200, value: query(`SELECT public.get_staking_release_effect_status_v1('${request}');`) };
      }
      if (url.pathname === '/functions/v1/staking-process-release-effects' && method === 'POST') {
        assert.deepEqual(body, { release_request_id: request });
        const response = await continuation(new Request('http://local.invalid/staking-continuation', { method: 'POST', body: JSON.stringify(body) }));
        return { status: response.status, value: await response.json() };
      }
      if (url.pathname === '/functions/v1/staking-execute-release' && method === 'POST') {
        assert.equal(body.release_request_id, request);
        const response = await handler(new Request('http://local.invalid/staking', { method: 'POST', body: JSON.stringify(body) }));
        return { status: response.status, value: await response.json() };
      }
      return null;
    },
    evidence() {
      if (!request) return { request: null, sinks: sends.length, facts: { ledger: 0, receipts: 0, total: 0, pending: 0, held: 0, delivered: 0, publications: 0 } };
      return { request, sinks: sends.length, facts: JSON.parse(sql(`SELECT jsonb_build_object(
        'ledger',(SELECT count(*) FROM public.staking_ledger WHERE deal_id='${deal}'),
        'receipts',(SELECT count(*) FROM public.staking_release_receipts_v1 WHERE release_request_id='${request}'),
        'total',(SELECT count(*) FROM public.staking_release_effects_v1 WHERE release_request_id='${request}'),
        'pending',(SELECT count(*) FROM public.staking_release_effects_v1 WHERE release_request_id='${request}' AND state='pending'),
        'held',(SELECT count(*) FROM public.staking_release_effects_v1 WHERE release_request_id='${request}' AND state='needs_attention'),
        'delivered',(SELECT count(*) FROM public.staking_release_effects_v1 WHERE release_request_id='${request}' AND state='delivered'),
        'publications',(SELECT count(*) FROM public.staking_release_publications_v1 p JOIN public.staking_release_effects_v1 e ON e.id=p.effect_id WHERE e.release_request_id='${request}'));`)) };
    },
    cleanup() { if (!existing) sql(`DELETE FROM public.user_roles WHERE id IN('${roleId}','${cashierRoleId}') AND user_id='${actor}';`); },
  };
}

// Negative browser path: actual authenticated actor has no bank profile. No profile fabrication.
function createPurchaseProfileProbe({sql,actor,club,log}){
 const positive=process.env.VINPOKER_STAKING_PURCHASE_POSITIVE==='1';
 assert.ok(!(positive&&process.env.VINPOKER_STAKING_PURCHASE_PROFILE_NEGATIVE==='1'));
 assert.equal(sql(`SELECT count(*) FROM public.profiles WHERE user_id='${actor}' AND coalesce(bank_name,'')<>'' AND coalesce(bank_account_number,'')<>'' AND coalesce(bank_account_holder,'')<>'';`),positive?'1':'0');
 const existing=process.env.VINPOKER_STAKING_PURCHASE_EXISTING_DEAL;
 const replayOnly=process.env.VINPOKER_STAKING_PURCHASE_REPLAY_ONLY==='1';
 if(replayOnly)assert.ok(positive&&existing);
 if(existing)assert.match(existing,/^[a-f0-9-]{36}$/i);
 const deal=existing??randomUUID(),player=randomUUID();let handler;
 if(existing)assert.equal(sql(`SELECT count(*) FROM public.staking_deals WHERE id='${deal}' AND club_id='${club}' AND custom_event_name='LOCAL512 profile-negative browser TEST' AND ${replayOnly?`status='committed' AND EXISTS(SELECT 1 FROM public.staking_purchase_receipts_v1 WHERE deal_id='${deal}' AND actor_id='${actor}')`:"status='listing'"} AND player_id<>'${actor}';`),'1');
 else sql(`BEGIN;INSERT INTO auth.users(id) VALUES('${player}');
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status,admin_review_status)
 VALUES('${deal}','${player}','${club}','LOCAL512 profile-negative browser TEST',now(),'LOCAL ONLY',10,1,1000000,'listing','approved');COMMIT;`);
 const bank=positive&&!replayOnly?randomUUID():null;let dropResponse=positive&&!replayOnly;
 if(bank)sql(`INSERT INTO public.platform_bank_accounts(id,bank_name,account_number,account_holder,account_type,club_id)
 VALUES('${bank}','LOCAL516_RECEIPT_BANK','LOCAL_ONLY_516','LOCAL TEST ONLY','escrow','${club}');`);
 const admin={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},rpc:async(name,args)=>{
  assert.equal(name,'commit_staking_purchase_v2');assert.equal(args.p_actor,actor);assert.equal(args.p_deal,deal);
  assert.match(args.p_request,/^[a-f0-9-]{36}$/i);assert.equal(args.p_percent,10);
  if(replayOnly)assert.equal(sql(`SELECT count(*) FROM public.staking_purchase_receipts_v1 WHERE actor_id='${actor}' AND request_id='${args.p_request}' AND deal_id='${deal}';`),'1');
  if(positive){
   const data=JSON.parse(sql(`BEGIN;SET LOCAL ROLE service_role;SELECT public.commit_staking_purchase_v2('${actor}','${args.p_request}','${deal}',10);COMMIT;`));
   log.push({stakingPurchaseRpc:name,deal,request:args.p_request,purchase:data.purchase_id,outcome:'committed'});
   if(dropResponse){dropResponse=false;log.push({stakingFault:'PURCHASE_COMMIT_RESPONSE_DROPPED',request:args.p_request});throw new Error('LOCAL_DROP_AFTER_PURCHASE_COMMIT');}
   return {data,error:null};
  }
  // Catch the actual SQL error in PostgreSQL; do not manufacture a business outcome.
  const result=JSON.parse(sql(`BEGIN;SET LOCAL ROLE service_role;
   DO $$ BEGIN
    BEGIN PERFORM public.commit_staking_purchase_v2('${actor}','${args.p_request}','${deal}',10);
     RAISE EXCEPTION 'LOCAL512_EXPECTED_PROFILE_DENIAL';
    EXCEPTION WHEN OTHERS THEN
     IF SQLERRM<>'staking_purchase_bank_profile_required' THEN RAISE;END IF;
     PERFORM set_config('vinpoker.profile512_error',SQLERRM,true);
    END;
   END $$;SELECT jsonb_build_object('message',current_setting('vinpoker.profile512_error'));ROLLBACK;`));
  log.push({stakingPurchaseRpc:name,deal,outcome:result.message});return {data:null,error:result};
 }};
 const source=readFileSync('supabase/functions/staking-commit-deal/index.ts','utf8').replace(/^import[\s\S]*?;\r?$/gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  Request,Response,z,retryFetch:()=>{},createClient:()=>admin,
  parseBody:async(req,schema)=>{const p=schema.safeParse(await req.json());return p.success?{ok:true,data:p.data}:{ok:false,response:new Response('{}',{status:400})};},
  Deno:{env:{get:()=> 'LOCAL_TEST_ONLY'},serve:fn=>{handler=fn;}},
 });
 return {
  get manifest(){return {deal,request:'',prize:0,fee:0,backer:0,player:0,
   transfer:replayOnly?JSON.parse(sql(`SELECT jsonb_build_object('purchaseId',id,'dealId',deal_id,'amount',amount_vnd,'reference',reference_code,'committedAt',committed_at) FROM public.staking_purchases WHERE deal_id='${deal}' AND backer_id='${actor}';`)):null,
   purchaseIntent:replayOnly?JSON.parse(sql(`SELECT jsonb_build_object('actor_id',actor_id,'deal_id',deal_id,'request_id',request_id,'percent',(payload->>'percent')::integer) FROM public.staking_purchase_receipts_v1 WHERE actor_id='${actor}' AND deal_id='${deal}';`)):null,
   purchaseDeal:JSON.parse(sql(`SELECT row_to_json(d) FROM public.staking_deals d WHERE id='${deal}';`))};},
  async route(url,method,body){
   if(url.pathname==='/rest/v1/rpc/get_staking_purchase_transfer_v1'&&method==='POST'){
    assert.ok(replayOnly);assert.match(body.p_purchase,/^[a-f0-9-]{36}$/i);
    assert.equal(sql(`SELECT count(*) FROM public.staking_purchases WHERE id='${body.p_purchase}' AND deal_id='${deal}' AND backer_id='${actor}';`),'1');
    const value=JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL ROLE authenticated;SELECT public.get_staking_purchase_transfer_v1('${body.p_purchase}');ROLLBACK;`));
    log.push({stakingTransferRead:body.p_purchase,state:value.state,bank:value.bank?.bank_name});
    return {status:200,value};
   }
   if(url.pathname!=='/functions/v1/staking-commit-deal'||method!=='POST')return null;
   const response=await handler(new Request('http://local.invalid/staking-commit-deal',{method:'POST',headers:{Authorization:'Bearer LOCAL_TEST_ONLY'},body:JSON.stringify(body)}));
   return {status:response.status,value:await response.json()};
  },
  evidence(){return {deal,purchases:Number(sql(`SELECT count(*) FROM public.staking_purchases WHERE deal_id='${deal}';`)),receipts:Number(sql(`SELECT count(*) FROM public.staking_purchase_receipts_v1 WHERE deal_id='${deal}';`))};},
  cleanup(){if(bank)sql(`UPDATE public.platform_bank_accounts SET is_active=false WHERE id='${bank}';`);
   else if(!positive)assert.equal(sql(`SELECT count(*) FROM public.staking_purchases WHERE deal_id='${deal}';`),'0');},
 };
}
