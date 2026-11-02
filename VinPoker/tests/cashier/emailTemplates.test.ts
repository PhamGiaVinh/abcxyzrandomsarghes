import {afterEach,describe,expect,it,vi} from 'vitest';
import {emailResultDisputed,emailPayoutExecuted,fundingConfirmedBackerEmail,fundingConfirmedPlayerEmail,sendEmailViaFunction} from '../../supabase/functions/_shared/emailTemplates';
import {deliverStakingReleaseEffect} from '../../supabase/functions/_shared/stakingReleaseDelivery';
const injected='<img src=x onerror=alert(1)> & "TEST"';
const common={dealShortId:injected,clubName:injected,tournamentName:injected,amountVnd:100};
const parse=(html:string)=>new DOMParser().parseFromString(html,'text/html');
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('shared best-effort email transport diagnostics',()=>{
 const payload={to:'local@example.test',subject:'LOCAL TEST',html:'<p>LOCAL ONLY</p>'};
 it('keeps the existing endpoint, auth, payload and one-call best-effort contract',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  const fetcher=vi.fn(async()=>new Response('{"success":true,"id":"local-ack"}'));
  vi.stubGlobal('fetch',fetcher);
  await expect(sendEmailViaFunction('https://local.invalid','LOCAL_TEST_KEY',payload)).resolves.toBeUndefined();
  expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://local.invalid/functions/v1/send-email',{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer LOCAL_TEST_KEY'},body:JSON.stringify(payload)});
  expect(log).not.toHaveBeenCalled();
 });
 it('does not log an internal error response body',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('SYNTHETIC_PRIVATE_RECIPIENT_TOKEN',{status:503})));
  await expect(sendEmailViaFunction('https://local.invalid','LOCAL_TEST_KEY',payload)).resolves.toBeUndefined();
  expect(log.mock.calls).toEqual([['email_function_rejected',503]]);
 });
 it('does not log a thrown transport error containing credentials or recipient data',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('SYNTHETIC_PRIVATE_RECIPIENT_TOKEN');}));
  await expect(sendEmailViaFunction('https://local.invalid','LOCAL_TEST_KEY',payload)).resolves.toBeUndefined();
  expect(log.mock.calls).toEqual([['email_function_unverified']]);
 });
 it('preserves one best-effort call and reports a failure reading its response safely',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  const fetcher=vi.fn(async()=>({ok:true,text:async()=>{throw new Error('SYNTHETIC_RESPONSE_PRIVATE');}}));
  vi.stubGlobal('fetch',fetcher);
  await expect(sendEmailViaFunction('https://local.invalid','LOCAL_TEST_KEY',payload)).resolves.toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(log.mock.calls).toEqual([['email_function_unverified']]);
 });
});

describe('email templates treat dynamic fields as text',()=>{
 it.each(['dispute','payout','backer','player'])('escapes %s labels without removing intended formatting',kind=>{
  const result=kind==='dispute'?emailResultDisputed({label:injected,deal_id:'test',reason:injected})
   :kind==='payout'?emailPayoutExecuted({label:injected,deal_id:'test',amount_vnd:100,role:'player'})
   :kind==='backer'?fundingConfirmedBackerEmail(common)
   :fundingConfirmedPlayerEmail({...common,fundedPercent:10,soldPercent:20,statusLabel:injected});
  const dom=parse(result.html);expect(dom.querySelectorAll('img')).toHaveLength(0);
  expect(dom.body.textContent).toContain(injected);expect(dom.querySelectorAll('b')).toHaveLength(1);
 });
 it.each(['javascript:alert(1)','data:text/html,TEST'])('rejects non-web CTA %s',ctaUrl=>{
  expect(()=>fundingConfirmedBackerEmail({...common,ctaUrl})).toThrow();
 });
 it('does not permit quotes in CTA query values to create another attribute',()=>{
  const dom=parse(fundingConfirmedBackerEmail({...common,ctaUrl:'https://example.test/?q=" onclick="TEST'}).html);
  expect(dom.querySelector('a')?.hasAttribute('onclick')).toBe(false);
 });
 it('escapes once through the existing release-delivery caller',async()=>{
  const invoke=vi.fn(async()=>({data:{success:true,id:'local-provider-id'},error:null}));
  await deliverStakingReleaseEffect({rpc:vi.fn(),auth:{admin:{getUserById:async()=>({data:{user:{email:'test@example.test'}},error:null})}},functions:{invoke}},
   {id:'11111111-1111-4111-8111-111111111111',lease_token:'22222222-2222-4222-8222-222222222222',kind:'email',payload:{
    deal_id:'33333333-3333-4333-8333-333333333333',user_id:'44444444-4444-4444-8444-444444444444',amount_vnd:100,role:'player',label:injected}} as Parameters<typeof deliverStakingReleaseEffect>[1]);
  const sent=invoke.mock.calls[0] as unknown as [string,{body:{html:string}}];
  const dom=parse(sent[1].body.html);expect(dom.querySelectorAll('img')).toHaveLength(0);expect(dom.body.textContent).toContain(injected);
 });
});
