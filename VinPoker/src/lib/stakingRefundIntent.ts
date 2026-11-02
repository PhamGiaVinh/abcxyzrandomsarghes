import {z} from 'zod';
const schema=z.object({actor_id:z.string().uuid(),request_id:z.string().uuid(),deal_id:z.string().uuid(),
 club_id:z.string().min(1).nullable(),reason:z.string().trim().min(1).max(1000)}).strict();
export type StakingRefundIntent=z.infer<typeof schema>;
const prefix=(actor:string)=>`vinpoker:staking-refund:v1:${actor}:`;
const key=(actor:string,deal:string)=>`${prefix(actor)}${deal}`;
export function pendingStakingRefunds(actor:string):StakingRefundIntent[]{
 const items:StakingRefundIntent[]=[];
 for(let i=0;i<localStorage.length;i++){
  const name=localStorage.key(i);if(!name?.startsWith(prefix(actor)))continue;
  const parsed=schema.parse(JSON.parse(localStorage.getItem(name)!));
  if(parsed.actor_id!==actor||key(actor,parsed.deal_id)!==name)throw new Error('Yêu cầu hoàn tiền lưu ở máy không đúng phạm vi. Không gửi yêu cầu mới.');
  items.push(parsed);
 }
 return items;
}
export function persistStakingRefundIntent(actor:string,deal:string,club:string|null,reason:string):StakingRefundIntent{
 const existing=pendingStakingRefunds(actor).find(item=>item.deal_id===deal);
 if(existing){if(existing.reason!==reason.trim()||existing.club_id!==club)throw new Error('Có yêu cầu hoàn tiền chưa xác minh với nội dung khác. Khôi phục yêu cầu cũ trước.');return existing;}
 const intent=schema.parse({actor_id:actor,request_id:crypto.randomUUID(),deal_id:deal,club_id:club,reason:reason.trim()});
 const encoded=JSON.stringify(intent);localStorage.setItem(key(actor,deal),encoded);
 if(localStorage.getItem(key(actor,deal))!==encoded)throw new Error('Không lưu được yêu cầu hoàn tiền an toàn. Chưa gửi.');
 return intent;
}
export function clearStakingRefundIntent(intent:StakingRefundIntent){
 const name=key(intent.actor_id,intent.deal_id);
 if(localStorage.getItem(name)!==JSON.stringify(intent))throw new Error('Yêu cầu hoàn tiền cục bộ đã thay đổi. Không xóa bằng chứng.');
 localStorage.removeItem(name);
}
