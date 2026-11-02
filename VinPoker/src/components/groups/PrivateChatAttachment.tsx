import {useEffect,useRef,useState} from 'react';
import {useAuth} from '@/hooks/useAuth';
import {sessionReadEpoch} from '@/lib/sessionReadEpoch';
import {supabase} from '@/integrations/supabase/client';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import {CHAT_ATTACHMENT_BUCKET,CHAT_ATTACHMENT_TTL_SECONDS,isPrivateChatAttachment,privateChatAttachmentPath,safeChatAttachmentUrl,type ChatAttachmentScope} from '@/lib/chatAttachment';
import {Button} from '@/components/ui/button';
import {MessageAttachment} from './MessageAttachment';

type Props={reference:string;scope:ChatAttachmentScope;type:string|null;name?:string|null;size?:number|null};
export function PrivateChatAttachment(props:Props){
 const {user,session,loading}=useAuth();
 if(!isPrivateChatAttachment(props.reference)){
  const url=safeChatAttachmentUrl(props.reference);
  return url?<MessageAttachment url={url} type={props.type} name={props.name} size={props.size}/>:<p role="alert">Tệp đính kèm không hợp lệ.</p>;
 }
 const path=privateChatAttachmentPath(props.reference,props.scope);
 if(!path)return <p role="alert">Tệp riêng không thuộc cuộc trò chuyện này.</p>;
 if(loading)return <p role="status">Đang xác minh quyền đọc tệp…</p>;
 if(!user)return <p role="status">Đăng nhập để mở tệp riêng.</p>;
 return <SignedChatAttachment key={JSON.stringify([user.id,sessionReadEpoch(session),path])} {...props} path={path}/>;
}

function SignedChatAttachment({path,type,name,size}:Props&{path:string}){
 const [url,setUrl]=useState<string|null>(null),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
 const inFlight=useRef(false),expiresAt=useRef(0);
 const failed=useRef(false);
 useEffect(()=>{
  let active=true,renew:ReturnType<typeof setTimeout>|undefined,expire:ReturnType<typeof setTimeout>|undefined;
  inFlight.current=true;failed.current=false;setError(false);
  const started=Date.now();
  if(expiresAt.current>started)expire=setTimeout(()=>{if(active)setUrl(null);},expiresAt.current-started);
  else setUrl(null);
  const refresh=()=>{
   if(!active||failed.current||inFlight.current||document.visibilityState!=='visible'||!navigator.onLine||Date.now()<expiresAt.current-5000)return;
   inFlight.current=true;setAttempt(value=>value+1);
  };
  document.addEventListener('visibilitychange',refresh);window.addEventListener('online',refresh);window.addEventListener('focus',refresh);
  void (async()=>{
   try{
    const response=await waitForManualPlayerResponse(supabase.storage.from(CHAT_ATTACHMENT_BUCKET).createSignedUrl(path,CHAT_ATTACHMENT_TTL_SECONDS));
    if(!active)return;
    const signed=safeChatAttachmentUrl(response.data?.signedUrl);
    if(response.error||!signed)throw new Error('PRIVATE_CHAT_SIGNED_READ_UNVERIFIED');
    expiresAt.current=started+CHAT_ATTACHMENT_TTL_SECONDS*1000;
    setUrl(signed);
    const remaining=expiresAt.current-Date.now();
    // Visibility/online guards stop background renewal; expiry still removes a
    // stale bearer URL. No URL is persisted into messages, logs or a journal.
    renew=setTimeout(refresh,Math.max(0,remaining-5000));
    clearTimeout(expire);
    expire=setTimeout(()=>{if(active)setUrl(null);},Math.max(0,remaining));
   }catch{if(active){failed.current=true;setUrl(null);setError(true);}}
   finally{if(active)inFlight.current=false;}
  })();
  return()=>{active=false;clearTimeout(renew);clearTimeout(expire);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('online',refresh);window.removeEventListener('focus',refresh);};
 },[path,attempt]);
 if(url)return <MessageAttachment url={url} type={type} name={name} size={size} onLoadError={()=>{failed.current=true;setUrl(null);setError(true);}}/>;
 return <div className="space-y-1 text-xs text-muted-foreground">
  <p role={error?'alert':'status'}>{error?'Không xác minh được quyền đọc tệp riêng.':'Đang chuẩn bị tệp riêng hoặc liên kết đã hết hạn.'}</p>
  <Button type="button" size="sm" variant="outline" onClick={()=>{if(!inFlight.current){inFlight.current=true;setAttempt(value=>value+1);}}}>Thử mở tệp riêng</Button>
 </div>;
}
