import {z} from 'zod';
const schema=z.object({actor_id:z.string().uuid(),deal_id:z.string().uuid(),expected_review:z.enum(['approved','rejected'])}).strict();
export type StakingListingArchiveIntent=z.infer<typeof schema>;
const prefix=(actor:string)=>`vinpoker:staking-listing-archive:v1:${actor}:`;
const key=(item:StakingListingArchiveIntent)=>`${prefix(item.actor_id)}${item.deal_id}`;
export function pendingListingArchives(actor:string):StakingListingArchiveIntent[]{
 const result:StakingListingArchiveIntent[]=[];
 for(let i=0;i<localStorage.length;i++){
  const name=localStorage.key(i);if(!name?.startsWith(prefix(actor)))continue;
  const item=schema.parse(JSON.parse(localStorage.getItem(name)!));
  if(item.actor_id!==actor||key(item)!==name)throw new Error('Yêu cầu lưu trữ không đúng phạm vi. Giữ nguyên để đối chiếu.');
  result.push(item);
 }
 return result;
}
export function persistListingArchive(value:StakingListingArchiveIntent){
 const item=schema.parse(value),existing=pendingListingArchives(item.actor_id).find(x=>x.deal_id===item.deal_id);
 if(existing){if(JSON.stringify(existing)!==JSON.stringify(item))throw new Error('Yêu cầu lưu trữ cũ chưa được xác minh.');return existing;}
 const encoded=JSON.stringify(item);localStorage.setItem(key(item),encoded);
 if(localStorage.getItem(key(item))!==encoded)throw new Error('Không lưu được yêu cầu an toàn. Chưa gửi lưu trữ.');return item;
}
export function clearListingArchive(value:StakingListingArchiveIntent){
 const item=schema.parse(value),name=key(item);
 if(localStorage.getItem(name)!==JSON.stringify(item))throw new Error('Yêu cầu đã thay đổi. Không xóa bằng chứng.');
 localStorage.removeItem(name);if(localStorage.getItem(name)!==null)throw new Error('Không xóa được yêu cầu đã xác minh.');
}
export function assertListingArchiveReceipt(value:unknown,deal:string){
 const result=z.object({success:z.literal(true),deal_id:z.string().uuid(),status:z.literal('cancelled'),archived:z.literal(true)}).strict().safeParse(value);
 if(!result.success||result.data.deal_id!==deal)throw new Error('Receipt lưu trữ chưa được xác minh.');return result.data;
}
