import {expect,it,vi} from 'vitest';
import {drainStakingFundingEmails,parseFundingEmailStatus} from '../../supabase/functions/_shared/stakingFundingEffects';
const actor='e5450000-0000-4000-8000-000000000001',purchase='e5450000-0000-4000-8000-000000000002';
const base={id:'e5450000-0000-4000-8000-000000000003',purchase_id:purchase,recipient_id:actor,recipient_role:'backer',lease_token:'e5450000-0000-4000-8000-000000000004',state:'processing',
 payload:{deal_id:actor,deal_short_id:actor.slice(0,6),club_name:'<b>TEST CLUB</b>',tournament_name:'<img src=x onerror=1>',amount_vnd:100000,percent:10,funded_percent:10,sold_percent:10,deal_status:'funded'}};
function setup(){const rpc=vi.fn().mockResolvedValueOnce({data:base,error:null}).mockResolvedValueOnce({data:true,error:null}).mockResolvedValue({data:null,error:null});
 const invoke=vi.fn().mockResolvedValue({data:{success:true,id:'LOCAL_ACK'},error:null});
 const getUserById=vi.fn().mockResolvedValue({data:{user:{email:'sink@example.invalid'}},error:null});
 return {rpc,invoke,getUserById,client:{rpc,auth:{admin:{getUserById}},functions:{invoke}}};}
it.each(['backer','player'])('sends validated %s template with escaped fields/correct route',async role=>{
 const h=setup();h.rpc.mockReset().mockResolvedValueOnce({data:{...base,recipient_role:role},error:null}).mockResolvedValueOnce({data:true,error:null}).mockResolvedValue({data:null,error:null});
 expect(await drainStakingFundingEmails(h.client,actor,purchase)).toMatchObject({delivered:1,needs_attention:0});
 const html=h.invoke.mock.calls[0][1].body.html;expect(html).toContain('&lt;b&gt;TEST CLUB&lt;/b&gt;');expect(html).not.toContain('<img src=x');
 expect(html).toContain(`https://vinpoker.vercel.app/staking/${role==='backer'?'portfolio':'my-deals'}`);
 expect(h.rpc.mock.calls[1][1]).toMatchObject({p_purchase:purchase,p_provider_id:'LOCAL_ACK',p_error_code:null});
});
it.each(['malformed','throws'])('holds %s provider outcome with no send retry',async fault=>{const h=setup();
 if(fault==='throws')h.invoke.mockRejectedValue(new Error('PRIVATE PROVIDER DETAIL'));else h.invoke.mockResolvedValue({data:{success:true},error:null});
 expect(await drainStakingFundingEmails(h.client,actor,purchase)).toMatchObject({needs_attention:1});expect(h.invoke).toHaveBeenCalledTimes(1);
 expect(h.rpc.mock.calls[1][1]).toMatchObject({p_error_code:'delivery_failed_or_unknown',p_provider_id:null});});
it.each(['wrong_purchase','negative','short_id','unknown_role'])('does not deliver a %s claim',async fault=>{const h=setup();h.rpc.mockReset().mockResolvedValue({data:{...base,
 purchase_id:fault==='wrong_purchase'?actor:purchase,recipient_role:fault==='unknown_role'?'other':'backer',
 payload:{...base.payload,amount_vnd:fault==='negative'?-1:100000,deal_short_id:fault==='short_id'?'wrong':base.payload.deal_short_id}},error:null});
 expect(await drainStakingFundingEmails(h.client,actor,purchase)).toMatchObject({error:'invalid_funding_job'});expect(h.invoke).not.toHaveBeenCalled();});
it('stops on unknown finish without sending again',async()=>{const h=setup();h.rpc.mockReset().mockResolvedValueOnce({data:base,error:null}).mockRejectedValue(new Error('LOCAL ACK LOST'));
 expect(await drainStakingFundingEmails(h.client,actor,purchase)).toMatchObject({error:'funding_ack_unknown'});expect(h.invoke).toHaveBeenCalledTimes(1);});
it('does not confuse no pending claim with durable all-delivered status',()=>{
 const s={purchase_id:purchase,expected:2,total:2,delivered:1,pending:0,processing:0,needs_attention:1,evidence_missing:false,state:'needs_attention'};
 expect(parseFundingEmailStatus(s,purchase)).toEqual(s);expect(parseFundingEmailStatus({...s,state:'all_delivered'},purchase)).toBeNull();
 expect(parseFundingEmailStatus(s,actor)).toBeNull();expect(parseFundingEmailStatus({...s,expected:0},purchase)).toBeNull();
});
it('holds a missing recipient without contacting provider',async()=>{const h=setup();h.getUserById.mockResolvedValue({data:{user:null},error:null});
 expect(await drainStakingFundingEmails(h.client,actor,purchase)).toMatchObject({needs_attention:1});expect(h.invoke).not.toHaveBeenCalled();
 expect(h.rpc.mock.calls[1][1]).toMatchObject({p_error_code:'recipient_unavailable'});});
it('does not send the same role twice within one drain',async()=>{const h=setup();h.rpc.mockReset().mockResolvedValueOnce({data:base,error:null}).mockResolvedValueOnce({data:true,error:null})
 .mockResolvedValue({data:{...base,id:purchase},error:null});
 expect(await drainStakingFundingEmails(h.client,actor,purchase)).toMatchObject({error:'invalid_funding_job'});expect(h.invoke).toHaveBeenCalledTimes(1);});
