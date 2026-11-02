/** Retry identity only: text is hashed; images retain only their private object reference, never a signed URL. */
export type DirectTextIntent={version:1;actorId:string;chatId:string;messageId:string;contentHash:string;kind?:'image';attachment?:string};
export type DirectTextReceipt={id:string;chat_id:string;sender_id:string;kind:'text'|'image';content:string;created_at:string};
type JournalStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const key=(actorId:string,chatId:string)=>`vinpoker:dm-text:v1:${actorId}:${chatId}`;
export async function directTextHash(content:string):Promise<string>{
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content));
  return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export function readDirectTextIntent(storage:JournalStorage,actorId:string,chatId:string):DirectTextIntent|null{
  const raw=storage.getItem(key(actorId,chatId));if(raw===null)return null;
  const value:unknown=JSON.parse(raw);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('DM_JOURNAL_INVALID');
  const i=value as Record<string,unknown>;
  const image=i.kind==='image';
  if(Object.keys(i).sort().join(',')!==(image?'actorId,attachment,chatId,contentHash,kind,messageId,version':'actorId,chatId,contentHash,messageId,version')
    ||i.version!==1||i.actorId!==actorId||i.chatId!==chatId
    ||typeof i.messageId!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(i.messageId)
    ||typeof i.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(i.contentHash)
    ||(image&&(typeof i.attachment!=='string'||!i.attachment.startsWith(`private-chat:v1:${actorId}/dm/${chatId}/`)
      ||i.attachment.split('/').length!==4||!/^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(i.attachment.split('/').at(-1)!))))throw new Error('DM_JOURNAL_INVALID');
  return value as DirectTextIntent;
}
export function retainDirectTextIntent(storage:JournalStorage,intent:DirectTextIntent){
  const k=key(intent.actorId,intent.chatId),encoded=JSON.stringify(intent),prior=storage.getItem(k);
  if(prior!==null&&prior!==encoded)throw new Error('DM_PENDING_INTENT_CHANGED');
  storage.setItem(k,encoded);if(storage.getItem(k)!==encoded)throw new Error('DM_JOURNAL_UNAVAILABLE');
}
export function settleDirectTextIntent(storage:JournalStorage,intent:DirectTextIntent){
  const k=key(intent.actorId,intent.chatId);
  if(storage.getItem(k)!==JSON.stringify(intent))throw new Error('DM_PENDING_INTENT_CHANGED');
  storage.removeItem(k);if(storage.getItem(k)!==null)throw new Error('DM_JOURNAL_UNAVAILABLE');
}
export async function matchDirectTextReceipt(intent:DirectTextIntent,value:unknown):Promise<DirectTextReceipt|null>{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const r=value as Record<string,unknown>;
  if(r.id!==intent.messageId||r.chat_id!==intent.chatId||r.sender_id!==intent.actorId||r.kind!==(intent.kind??'text')
    ||typeof r.content!=='string'||!r.content||r.content.length>2000
    ||typeof r.created_at!=='string'||!Number.isFinite(Date.parse(r.created_at)))return null;
  if(await directTextHash(r.content)!==intent.contentHash)return null;
  if(intent.kind==='image'&&r.content!==intent.attachment)return null;
  return value as DirectTextReceipt;
}
