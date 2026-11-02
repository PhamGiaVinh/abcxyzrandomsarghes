import {expect,it,vi} from 'vitest';
import {drainStakingRefundEmails,parseRefundEmailStatus} from '../../supabase/functions/_shared/stakingRefundEffects';
const actor='e5280000-0000-4000-8000-000000000001',request='e5280000-0000-4000-8000-000000000002';
const job={id:'e5280000-0000-4000-8000-000000000003',purchase_id:'e5280000-0000-4000-8000-000000000004',
 recipient_id:actor,lease_token:'e5280000-0000-4000-8000-000000000005',state:'processing',payload:{label:'<b>TEST</b>',percent:5,amount_vnd:50000,reason:'<img src=x onerror=alert(1)>'}};
function setup(){const rpc=vi.fn().mockResolvedValueOnce({data:job,error:null}).mockResolvedValueOnce({data:true,error:null}).mockResolvedValue({data:null,error:null});
 const invoke=vi.fn().mockResolvedValue({data:{success:true,id:'LOCAL_SINK_ACK'},error:null});
 const getUserById=vi.fn().mockResolvedValue({data:{user:{email:'sink@example.invalid'}},error:null});
 return {rpc,invoke,getUserById,client:{rpc,auth:{admin:{getUserById}},functions:{invoke}}};}
it('requires explicit provider acknowledgement and escapes untrusted email values',async()=>{const h=setup();
 expect(await drainStakingRefundEmails(h.client,actor,request)).toMatchObject({state:'no_pending',delivered:1,needs_attention:0});
 const body=h.invoke.mock.calls[0][1].body;expect(body.html).toContain('&lt;b&gt;TEST&lt;/b&gt;');expect(body.html).not.toContain('<img src=x');
 expect(h.rpc.mock.calls[1][1]).toMatchObject({p_actor:actor,p_request:request,p_provider_id:'LOCAL_SINK_ACK',p_error_code:null});});
it.each(['malformed','rejected','throws'])('holds %s send outcomes without retrying provider',async failure=>{const h=setup();
 if(failure==='throws')h.invoke.mockRejectedValue(new Error('PRIVATE PROVIDER DETAIL'));
 else h.invoke.mockResolvedValue({data:failure==='malformed'?{success:true}:{success:false,id:'bad'},error:null});
 expect(await drainStakingRefundEmails(h.client,actor,request)).toMatchObject({needs_attention:1,delivered:0});
 expect(h.invoke).toHaveBeenCalledTimes(1);expect(h.rpc.mock.calls[1][1]).toMatchObject({p_provider_id:null,p_error_code:'delivery_failed_or_unknown'});});
it('does not send for an invalid claim',async()=>{const h=setup();h.rpc.mockReset().mockResolvedValue({data:{...job,payload:{...job.payload,amount_vnd:-1}},error:null});
 expect(await drainStakingRefundEmails(h.client,actor,request)).toMatchObject({error:'invalid_refund_job'});expect(h.invoke).not.toHaveBeenCalled();});
it('returns unknown acknowledgement without sending again',async()=>{const h=setup();h.rpc.mockReset().mockResolvedValueOnce({data:job,error:null}).mockRejectedValue(new Error('LOCAL ACK LOST'));
 expect(await drainStakingRefundEmails(h.client,actor,request)).toMatchObject({error:'refund_ack_unknown'});expect(h.invoke).toHaveBeenCalledTimes(1);expect(h.rpc).toHaveBeenCalledTimes(2);});
it('records missing recipient without contacting provider',async()=>{const h=setup();h.getUserById.mockResolvedValue({data:{user:null},error:null});
 expect(await drainStakingRefundEmails(h.client,actor,request)).toMatchObject({needs_attention:1});expect(h.invoke).not.toHaveBeenCalled();
 expect(h.rpc.mock.calls[1][1]).toMatchObject({p_error_code:'recipient_unavailable'});});
it('distinguishes durable held delivery from no pending work',()=>{
 const status={request_id:request,deal_id:actor,expected:2,total:2,delivered:1,pending:0,processing:0,needs_attention:1,evidence_missing:false,state:'needs_attention'};
 expect(parseRefundEmailStatus(status,request,actor)).toEqual(status);
 expect(parseRefundEmailStatus({...status,state:'all_delivered'},request,actor)).toBeNull();
 expect(parseRefundEmailStatus({...status,total:0,evidence_missing:true},request,actor)).toBeNull();
 expect(parseRefundEmailStatus(status,actor,actor)).toBeNull();
 expect(parseRefundEmailStatus({...status,delivered:NaN},request,actor)).toBeNull();
});
