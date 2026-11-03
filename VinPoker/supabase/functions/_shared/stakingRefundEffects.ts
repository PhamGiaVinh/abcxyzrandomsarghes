import { emailStakingRefund } from './emailTemplates.ts';

interface Client {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  auth: { admin: { getUserById(id: string): PromiseLike<{ data: { user: { email?: string | null } | null } | null; error: unknown }> } };
  functions: { invoke(name: string, args: { body: Record<string, unknown> }): PromiseLike<{ data: unknown; error: unknown }> };
}
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export interface RefundEmailStatus {
  request_id:string;deal_id:string;expected:number;total:number;delivered:number;pending:number;
  processing:number;needs_attention:number;evidence_missing:boolean;state:'pending'|'needs_attention'|'all_delivered';
}
export function parseRefundEmailStatus(value:unknown,request:string,deal:string):RefundEmailStatus|null {
  if(!record(value)||value.request_id!==request||value.deal_id!==deal)return null;
  for(const key of ['expected','total','delivered','pending','processing','needs_attention'])
    if(typeof value[key]!=='number'||!Number.isSafeInteger(value[key])||value[key]<0)return null;
  const s=value as unknown as RefundEmailStatus;
  if(s.total!==s.delivered+s.pending+s.processing+s.needs_attention||s.evidence_missing!==(s.total!==s.expected)
    ||s.state!==(s.evidence_missing||s.needs_attention>0?'needs_attention':s.pending+s.processing>0?'pending':'all_delivered'))return null;
  return s;
}
interface Job { id:string;purchase_id:string;recipient_id:string;lease_token:string;state:'processing';
 payload:{label:string;percent:number;amount_vnd:number;reason:string} }
function jobValid(value:unknown):value is Job {
  if(!record(value)||value.state!=='processing'||!record(value.payload))return false;
  for(const key of ['id','purchase_id','recipient_id','lease_token'])if(typeof value[key]!=='string'||!uuid.test(value[key] as string))return false;
  const p=value.payload;
  return typeof p.label==='string'&&p.label.length>0&&typeof p.reason==='string'&&p.reason.length>0&&p.reason.length<=1000
    &&typeof p.percent==='number'&&Number.isFinite(p.percent)&&p.percent>0&&p.percent<=100
    &&typeof p.amount_vnd==='number'&&Number.isSafeInteger(p.amount_vnd)&&p.amount_vnd>=0;
}
// No transport retry. Unknown send/ack is a durable hold, never blind resend.
export async function drainStakingRefundEmails(client:Client,actor:string,request:string) {
  const result={state:'pending',delivered:0,needs_attention:0,error:null as string|null};
  const fail=(error:string)=>({...result,state:'error',error});
  if(!uuid.test(actor)||!uuid.test(request))return fail('invalid_refund_scope');
  const seen=new Set<string>();
  for(let i=0;i<4;i++){
    let claimed;
    try { claimed=await client.rpc('claim_staking_refund_email_v1',{p_actor:actor,p_request:request}); }
    catch { return fail('refund_claim_unavailable'); }
    if(claimed.error)return fail('refund_claim_unavailable');
    // No pending job is not proof that earlier jobs were delivered; caller reads durable status.
    if(claimed.data===null)return {...result,state:'no_pending'};
    if(!jobValid(claimed.data)||seen.has(claimed.data.id))return fail('invalid_refund_job');
    const job=claimed.data;seen.add(job.id);
    let provider:string|null=null,error:string|null=null;
    try {
      const recipient=await client.auth.admin.getUserById(job.recipient_id);
      if(recipient.error||!recipient.data?.user?.email)error='recipient_unavailable';
      else {
        const sent=await client.functions.invoke('send-email',{body:{to:recipient.data.user.email,...emailStakingRefund(job.payload)}});
        if(sent.error||!record(sent.data)||sent.data.success!==true||typeof sent.data.id!=='string'
          ||!sent.data.id.trim()||sent.data.id.length>500)error='delivery_failed_or_unknown';
        else provider=sent.data.id;
      }
    } catch { error='delivery_failed_or_unknown'; }
    try {
      const finished=await client.rpc('finish_staking_refund_email_v1',{p_actor:actor,p_request:request,
        p_id:job.id,p_token:job.lease_token,p_provider_id:provider,p_error_code:error});
      if(finished.error||finished.data!==true)return fail('refund_ack_unknown');
    } catch { return fail('refund_ack_unknown'); }
    if(error)result.needs_attention++;else result.delivered++;
  }
  return result;
}
