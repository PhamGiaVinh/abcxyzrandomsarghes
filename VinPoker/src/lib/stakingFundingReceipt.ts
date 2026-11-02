import {z} from 'zod';
const schema=z.object({success:z.literal(true),purchase_id:z.string().uuid(),purchase_status:z.literal('funded'),
 deal_status:z.enum(['committing','committed','funded']),total_funded_percent:z.number().int().nonnegative().max(100),
 total_committed_percent:z.number().int().nonnegative().max(100)}).passthrough()
 .refine(value=>value.error==null&&value.ok!==false);
export function assertStakingFundingReceipt(value:unknown,purchase:string){
 const parsed=schema.safeParse(value);
 if(!parsed.success||parsed.data.purchase_id!==purchase)throw new Error('staking_funding_receipt_unverified');
 return parsed.data;
}
const emailStatusSchema=z.object({purchase_id:z.string().uuid(),expected:z.literal(2),total:z.number().int().min(0).max(2),
 delivered:z.number().int().min(0).max(2),pending:z.number().int().min(0).max(2),processing:z.number().int().min(0).max(2),
 needs_attention:z.number().int().min(0).max(2),evidence_missing:z.boolean(),state:z.enum(['pending','needs_attention','all_delivered'])})
 .refine(s=>s.total===s.delivered+s.pending+s.processing+s.needs_attention&&s.evidence_missing===(s.total!==2)
  &&s.state===(s.evidence_missing||s.needs_attention>0?'needs_attention':s.pending+s.processing>0?'pending':'all_delivered'));
export function stakingFundingDeliveryMessage(value:unknown,purchase:string):string {
 const parsed=emailStatusSchema.safeParse(value);
 if(!parsed.success||parsed.data.purchase_id!==purchase)return 'Chưa xác minh được trạng thái email. Không xác nhận tiền lại chỉ để gửi email.';
 if(parsed.data.state==='all_delivered')return 'Đã nhận xác nhận gửi email cho backer và người chơi.';
 if(parsed.data.state==='needs_attention')return 'Việc gửi email cần đối chiếu. Không xác nhận tiền lại chỉ để gửi email.';
 return 'Việc gửi email đang chờ xử lý. Không xác nhận tiền lại chỉ để gửi email.';
}
export function stakingFundingEmailDelivered(value:unknown,purchase:string):boolean{
 const parsed=emailStatusSchema.safeParse(value);
 return parsed.success&&parsed.data.purchase_id===purchase&&parsed.data.state==='all_delivered';
}
