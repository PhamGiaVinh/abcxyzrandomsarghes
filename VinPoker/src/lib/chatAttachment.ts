/** Stable object references only. Signed bearer URLs must stay in component memory. */
export const CHAT_ATTACHMENT_BUCKET='chat-private-v1';
export const CHAT_ATTACHMENT_TTL_SECONDS=60;
const PREFIX='private-chat:v1:';
export type ChatAttachmentScope={kind:'dm'|'groups';id:string};
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export function privateChatAttachmentReference(path:string):string{return PREFIX+path;}
export function privateChatAttachmentPath(value:string,scope:ChatAttachmentScope):string|null{
 if(!value.startsWith(PREFIX))return null;
 const path=value.slice(PREFIX.length),parts=path.split('/');
 if(parts.length!==4||!UUID.test(parts[0])||parts[1]!==scope.kind||parts[2]!==scope.id||!UUID.test(parts[2])
  ||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(parts[3]))return null;
 return path;
}
export function isPrivateChatAttachment(value:string):boolean{return value.startsWith('private-chat:');}
export function safeChatAttachmentUrl(value:unknown):string|null{
 if(typeof value!=='string')return null;
 try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
