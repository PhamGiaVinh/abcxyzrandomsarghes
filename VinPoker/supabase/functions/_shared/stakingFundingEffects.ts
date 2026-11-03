import {fundingConfirmedBackerEmail,fundingConfirmedPlayerEmail} from './emailTemplates.ts';

interface Client {
 rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>;
 auth:{admin:{getUserById(id:string):PromiseLike<{data:{user:{email?:string|null}|null}|null;error:unknown}>}};
 functions:{invoke(name:string,args:{body:Record<string,unknown>}):PromiseLike<{data:unknown;error:unknown}>};
}
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
interface Job {id:string;purchase_id:string;recipient_id:string;recipient_role:'backer'|'player';lease_token:string;state:'processing';
 payload:{deal_id:string;deal_short_id:string;club_name:string|null;tournament_name:string|null;amount_vnd:number;percent:number;funded_percent:number;sold_percent:number;deal_status:'committing'|'committed'|'funded'}}
function valid(value:unknown,purchase:string):value is Job {
 if(!record(value)||value.purchase_id!==purchase||value.state!=='processing'||!['backer','player'].includes(String(value.recipient_role))||!record(value.payload))return false;
 for(const key of ['id','recipient_id','lease_token'])if(typeof value[key]!=='string'||!uuid.test(value[key] as string))return false;
 const p=value.payload;
 if(typeof p.deal_id!=='string'||!uuid.test(p.deal_id)||p.deal_short_id!==p.deal_id.slice(0,6)
  ||typeof p.amount_vnd!=='number'||!Number.isSafeInteger(p.amount_vnd)||p.amount_vnd<0
  ||!['committing','committed','funded'].includes(String(p.deal_status)))return false;
 for(const key of ['club_name','tournament_name'])if(p[key]!==null&&typeof p[key]!=='string')return false;
 for(const key of ['percent','funded_percent','sold_percent'])if(typeof p[key]!=='number'||!Number.isFinite(p[key])||p[key]<0||p[key]>100)return false;
 return Number(p.percent)>0&&Number(p.sold_percent)>0;
}
export interface FundingEmailStatus {purchase_id:string;expected:2;total:number;delivered:number;pending:number;processing:number;needs_attention:number;evidence_missing:boolean;state:'pending'|'needs_attention'|'all_delivered'}
export function parseFundingEmailStatus(value:unknown,purchase:string):FundingEmailStatus|null {
 if(!record(value)||value.purchase_id!==purchase||value.expected!==2)return null;
 for(const key of ['total','delivered','pending','processing','needs_attention'])if(typeof value[key]!=='number'||!Number.isInteger(value[key])||value[key]<0||value[key]>2)return null;
 const s=value as unknown as FundingEmailStatus;
 if(s.total!==s.delivered+s.pending+s.processing+s.needs_attention||s.evidence_missing!==(s.total!==2)
  ||s.state!==(s.evidence_missing||s.needs_attention>0?'needs_attention':s.pending+s.processing>0?'pending':'all_delivered'))return null;
 return s;
}
export async function drainStakingFundingEmails(client:Client,actor:string,purchase:string){
 const result={state:'pending',delivered:0,needs_attention:0,error:null as string|null};
 const fail=(error:string)=>({...result,state:'error',error});
 if(!uuid.test(actor)||!uuid.test(purchase))return fail('invalid_funding_scope');
 const ids=new Set<string>(),roles=new Set<string>();
 for(let i=0;i<3;i++){
  let claim;try{claim=await client.rpc('claim_staking_funding_email_v1',{p_actor:actor,p_purchase:purchase});}catch{return fail('funding_claim_unavailable');}
  if(claim.error)return fail('funding_claim_unavailable');if(claim.data===null)return {...result,state:'no_pending'};
  if(!valid(claim.data,purchase)||ids.has(claim.data.id)||roles.has(claim.data.recipient_role))return fail('invalid_funding_job');
  const job=claim.data,p=job.payload;ids.add(job.id);roles.add(job.recipient_role);
  let provider:string|null=null,error:string|null=null;
  try{
   const recipient=await client.auth.admin.getUserById(job.recipient_id);
   if(recipient.error||!recipient.data?.user?.email)error='recipient_unavailable';
   else{
    const common={dealShortId:p.deal_short_id,clubName:p.club_name,tournamentName:p.tournament_name,amountVnd:p.amount_vnd};
    const template=job.recipient_role==='backer'?fundingConfirmedBackerEmail({...common,percent:p.percent,ctaUrl:'https://vinpoker.vercel.app/staking/portfolio'}):
     fundingConfirmedPlayerEmail({...common,fundedPercent:p.funded_percent,soldPercent:p.sold_percent,
      statusLabel:p.deal_status==='funded'?'Đã xác nhận đầy đủ':p.deal_status==='committed'?'Đã đủ % — đang chờ xác nhận tiền':'Đang nhận hỗ trợ',ctaUrl:'https://vinpoker.vercel.app/staking/my-deals'});
    const sent=await client.functions.invoke('send-email',{body:{to:recipient.data.user.email,...template}});
    if(sent.error||!record(sent.data)||sent.data.success!==true||typeof sent.data.id!=='string'||!sent.data.id.trim()||sent.data.id.length>500)error='delivery_failed_or_unknown';
    else provider=sent.data.id;
   }
  }catch{error='delivery_failed_or_unknown';}
  try{const done=await client.rpc('finish_staking_funding_email_v1',{p_actor:actor,p_purchase:purchase,p_id:job.id,p_token:job.lease_token,p_provider_id:provider,p_error_code:error});
   if(done.error||done.data!==true)return fail('funding_ack_unknown');}catch{return fail('funding_ack_unknown');}
  if(error)result.needs_attention++;else result.delivered++;
 }
 return result;
}
