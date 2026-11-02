import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { drainStakingReleaseEffects } from '../../supabase/functions/_shared/stakingReleaseEffects.ts';
import { deliverStakingReleaseEffect, parseReleaseDeliveryStatus } from '../../supabase/functions/_shared/stakingReleaseDelivery.ts';

export async function runStakingReleaseHandlerNative(sql) {
  assert.equal(process.env.VINPOKER_NATIVE_PAYOUT, '1');
  const quote = value => `'${String(value).replaceAll("'", "''")}'`;
  const actor = randomUUID(), roleId = randomUUID();
  assert.equal(sql("SELECT string_agg(column_name,',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='auth' AND table_name='users';"), 'id');
  const club = sql('SELECT id FROM public.clubs ORDER BY id LIMIT 1;');
  sql(`BEGIN;INSERT INTO auth.users(id) VALUES('${actor}');INSERT INTO public.user_roles(id,user_id,role) VALUES('${roleId}','${actor}','super_admin');COMMIT;`);
  try {
    for (const {unknownSend,multi} of [{unknownSend:false,multi:false},{unknownSend:true,multi:false},{unknownSend:false,multi:true},{unknownSend:true,multi:true}]) {
      const deal = randomUUID(), request = randomUUID();
      const purchases=(multi?[2,2,3,3]:[10]).map(percent=>({id:randomUUID(),percent}));
      sql(`BEGIN;
        INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,percentage_sold,markup,buy_in_amount_vnd,status,
          filled_percent,result_prize_vnd,backer_payout_vnd,player_payout_vnd,platform_fee_vnd,platform_archive_fee)
        VALUES('${deal}','${actor}','${club}','LOCAL TEST handler sink',now(),10,1,1000000,'cosigned',10,1000000,80100,720900,199000,199000);
        INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
        VALUES ${purchases.map(p=>`('${p.id}','${deal}','${actor}',${p.percent},1,${p.percent*10000},'funded','${p.id}')`).join(',')};
        INSERT INTO public.staking_release_requests(id,deal_id,requested_by_admin_id,cosigned_by_admin_id,status)
        VALUES('${request}','${deal}','${actor}','${actor}','approved');COMMIT;`);
      const preview = JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL ROLE authenticated;
        SELECT public.get_staking_release_preview_v1('${deal}');COMMIT;`));
      assert.equal(preview.rows.length,purchases.length);
      assert.deepEqual(preview.rows.map(row=>row.purchase_id).sort(),purchases.map(p=>p.id).sort());
      let handler, dropCommitResponse = !unknownSend, rejectedSend = false;
      const sends = [];let financialCalls=0;
      const service = query => JSON.parse(sql(`BEGIN;SET LOCAL ROLE service_role;SELECT to_jsonb(${query});COMMIT;`));
      const admin = {
        rpc: async (name, args) => {
          let call;
          if (name === 'commit_staking_release_v2') {
            financialCalls++;
            assert.equal(args.p_actor, actor);assert.equal(args.p_payload.release_request_id, request);
            call = `public.commit_staking_release_v2('${actor}',${quote(JSON.stringify(args.p_payload))}::jsonb)`;
          } else if (name === 'claim_staking_release_effect_v1') {
            assert.equal(args.p_request, request);call = `public.claim_staking_release_effect_v1('${request}')`;
          } else if (name === 'get_staking_release_effect_status_for_actor_v1') {
            assert.equal(args.p_actor, actor);assert.equal(args.p_request, request);
            call = `public.get_staking_release_effect_status_for_actor_v1('${actor}','${request}')`;
          } else {
            assert.ok(['finish_staking_release_effect_v1', 'publish_staking_release_result_v1'].includes(name));
            const id = args.p_id ?? args.p_effect;
            assert.match(id, /^[a-f0-9-]{36}$/);
            assert.equal(sql(`SELECT release_request_id FROM public.staking_release_effects_v1 WHERE id='${id}';`), request);
            call = name === 'publish_staking_release_result_v1'
              ? `public.publish_staking_release_result_v1('${id}',${quote(args.p_token)}::uuid)`
              : `public.finish_staking_release_effect_v1('${id}',${quote(args.p_token)}::uuid,${args.p_provider_id == null ? 'NULL' : quote(args.p_provider_id)},${args.p_error_code == null ? 'NULL' : quote(args.p_error_code)})`;
          }
          const data = service(call);
          if (name === 'commit_staking_release_v2' && dropCommitResponse) {
            dropCommitResponse = false;throw new Error('LOCAL_DROP_AFTER_REAL_COMMIT');
          }
          return { data, error: null };
        },
        auth: { admin: { getUserById: async id => {
          assert.equal(id, actor);return { data: { user: { email: 'local-sink@example.invalid' } }, error: null };
        } } },
        functions: { invoke: async (name, options) => {
          assert.equal(name, 'send-email');assert.equal(options.body.to, 'local-sink@example.invalid');
          assert.ok(options.body.html.includes('LOCAL TEST handler sink'));
          sends.push({ ordinal: sends.length + 1 });
          if (unknownSend && !rejectedSend) { rejectedSend = true;throw new Error('LOCAL_SEND_OUTCOME_UNKNOWN'); }
          return { data: { success: true, id: `LOCAL_SINK_ACK_${sends.length}` }, error: null };
        } },
      };
      const runtime={
        z, Request, Response, drainStakingReleaseEffects, deliverStakingReleaseEffect, parseReleaseDeliveryStatus,
        corsHeaders: {}, json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
        authenticateUser: async () => ({ uid: actor }), createAdminClient: options => {assert.equal(options.retry,false);return admin;},
        requireAdminRoles: async () => ({ isSuper: true, isCashier: false }),
        parseBody: async (req, schema) => {
          const result = schema.safeParse(await req.json());
          return result.success ? { ok: true, data: result.data } : { ok: false, response: new Response('invalid', { status: 400 }) };
        },
      };
      const install=path=>{
        let fn;const source=readFileSync(path,'utf8').replace(/^import .*;\r?$/gm,'');
        runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
          {...runtime,Deno:{serve:value=>{fn=value;}}});return fn;
      };
      handler=install('supabase/functions/staking-execute-release/index.ts');
      const continuation=install('supabase/functions/staking-process-release-effects/index.ts');
      const payload = { release_request_id: request, preview_hash: preview.preview_hash, player_paid: true,
        backer_payouts: preview.rows.map(row=>({purchase_id:row.purchase_id,paid:true,payout_method:'cash'})) };
      const invoke = () => handler(new Request('http://local.invalid/release', { method: 'POST', body: JSON.stringify(payload) }));
      let first = await invoke();
      assert.equal(first.status, unknownSend ? 200 : 500);
      if (!unknownSend) { assert.equal(sends.length, 0);first=await invoke();assert.equal(first.status,200); }
      const firstBody=await first.json();
      if(multi){assert.equal(firstBody.delivery.pending,2);assert.equal(firstBody.delivery.delivered+firstBody.delivery.needs_attention,4);}
      const beforeContinuation=financialCalls;
      const continued=await continuation(new Request('http://local.invalid/continue',{method:'POST',body:JSON.stringify({release_request_id:request})}));
      assert.equal(continued.status,200);
      const continuedBody=await continued.json();assert.equal(continuedBody.delivery.pending,0);
      assert.equal(financialCalls,beforeContinuation,'continuation cannot call financial commit');
      assert.equal(sends.length,purchases.length+1);
      const replay = await invoke();assert.equal(replay.status, 200);assert.equal(sends.length,purchases.length+1, 'replay must not send any email twice');
      const replayBody = await replay.json();
      assert.equal(replayBody.delivery.state, unknownSend ? 'needs_attention' : 'all_delivered');
      const facts = JSON.parse(sql(`SELECT jsonb_build_object('ledger',(SELECT count(*) FROM public.staking_ledger WHERE deal_id='${deal}'),
        'receipts',(SELECT count(*) FROM public.staking_release_receipts_v1 WHERE release_request_id='${request}'),
        'effects',(SELECT count(*) FROM public.staking_release_effects_v1 WHERE release_request_id='${request}'),
        'delivered',(SELECT count(*) FROM public.staking_release_effects_v1 WHERE release_request_id='${request}' AND state='delivered'),
        'held',(SELECT count(*) FROM public.staking_release_effects_v1 WHERE release_request_id='${request}' AND state='needs_attention'),
        'published',(SELECT count(*) FROM public.staking_release_publications_v1 p JOIN public.staking_release_effects_v1 e ON e.id=p.effect_id WHERE e.release_request_id='${request}'));`));
      assert.deepEqual(facts, { ledger:purchases.length+1, receipts:1, effects:purchases.length+2,
        delivered:purchases.length+2-(unknownSend?1:0), held:unknownSend?1:0,published:1 });
      console.log('ACTUAL_RELEASE_HANDLER_NATIVE_DB_LOCAL_SINK_PASS', JSON.stringify({ request, unknownSend,purchases:purchases.length, ...facts }));
    }
  } finally {
    sql(`DELETE FROM public.user_roles WHERE id='${roleId}' AND user_id='${actor}' AND role='super_admin';`);
  }
}
