import {z} from 'zod';
const schema=z.object({actor_id:z.string().uuid(),purchase_id:z.string().uuid(),club_id:z.string().min(1).nullable(),reference:z.string().min(1).max(200)}).strict();
export type StakingFundingIntent=z.infer<typeof schema>;
const prefix=(actor:string)=>`vinpoker:staking-funding:v1:${actor}:`;
const key=(intent:StakingFundingIntent)=>`${prefix(intent.actor_id)}${intent.purchase_id}`;
export function pendingStakingFunding(actor:string):StakingFundingIntent[]{
 const items:StakingFundingIntent[]=[];
 for(let i=0;i<localStorage.length;i++){
  const name=localStorage.key(i);if(!name?.startsWith(prefix(actor)))continue;
  const item=schema.parse(JSON.parse(localStorage.getItem(name)!));
  if(item.actor_id!==actor||key(item)!==name)throw new Error('Yêu cầu FUNDED lưu trên máy không đúng phạm vi. Giữ nguyên để đối chiếu.');
  items.push(item);
 }
 return items;
}
export function persistStakingFundingIntent(value:StakingFundingIntent):StakingFundingIntent{
 const item=schema.parse(value),old=pendingStakingFunding(item.actor_id).find(x=>x.purchase_id===item.purchase_id);
 if(old){if(JSON.stringify(old)!==JSON.stringify(item))throw new Error('Có yêu cầu FUNDED chưa xác minh với phạm vi khác. Đối chiếu yêu cầu cũ trước.');return old;}
 const encoded=JSON.stringify(item);localStorage.setItem(key(item),encoded);
 if(localStorage.getItem(key(item))!==encoded)throw new Error('Không lưu được yêu cầu FUNDED. Chưa gửi xác nhận tiền.');
 return item;
}
export function clearStakingFundingIntent(item:StakingFundingIntent){
 const parsed=schema.parse(item),name=key(parsed);
 if(localStorage.getItem(name)!==JSON.stringify(parsed))throw new Error('Yêu cầu FUNDED đã thay đổi. Không xóa bằng chứng.');
 localStorage.removeItem(name);
 if(localStorage.getItem(name)!==null)throw new Error('Không xóa được yêu cầu FUNDED đã xác minh. Giữ trạng thái để đối chiếu.');
}
