import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Send, ArrowLeft, MessageCircle, ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import {directTextHash,readDirectTextIntent,retainDirectTextIntent,settleDirectTextIntent,matchDirectTextReceipt,type DirectTextIntent} from '@/lib/directTextIntent';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import {CHAT_ATTACHMENT_BUCKET,privateChatAttachmentReference} from '@/lib/chatAttachment';
import {PrivateChatAttachment} from '@/components/groups/PrivateChatAttachment';

interface Message {
  id: string;
  sender_id: string;
  content: string;
  kind: string;
  created_at: string;
}

const DirectChat = () => {
  const {user,session,loading}=useAuth();
  const {userId}=useParams<{userId:string}>();
  return <DirectChatScope key={JSON.stringify([user?.id??'anonymous',sessionReadEpoch(session),userId??'',loading])} />;
};

const DirectChatScope = () => {
  const { t, i18n } = useTranslation();
  const { userId: otherId } = useParams<{ userId: string }>();
  const { user, loading: authLoading } = useAuth();
  const nav = useNavigate();
  const [chatId, setChatId] = useState<string | null>(null);
  const [other, setOther] = useState<{ display_name: string; avatar_url?: string | null } | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadError,setLoadError]=useState<string|null>(null);
  const [readAttempt,setReadAttempt]=useState(0);
  const [pendingSend,setPendingSend]=useState<DirectTextIntent|null>(null);
  const [pendingState,setPendingState]=useState<'unknown'|'missing'>('unknown');
  const [sendError,setSendError]=useState<string|null>(null);
  const sendFlight=useRef(false);
  const uploadFlight=useRef(false);
  const draftRef=useRef(text);draftRef.current=text;
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const current=useRef(true);
  useEffect(()=>{current.current=true;return()=>{current.current=false;};},[]);
  const userId=user?.id;
  useEffect(()=>{
    if(!chatId||!userId)return;
    try{setPendingSend(readDirectTextIntent(sessionStorage,userId,chatId));setPendingState('unknown');}
    catch{setSendError('Không đọc được mã tin nhắn đang chờ. Chưa thể gửi tin nhắn mới.');}
  },[chatId,userId]);

  useEffect(() => {
    if (authLoading) return;
    if (!userId || !otherId || userId === otherId) { setBusy(false); return; }
    let active=true;
    const initialAbort=new AbortController();
    setBusy(true);setLoadError(null);
    void (async () => {
      try {
      const initial = await waitForManualPlayerResponse((async () => {
      const { data: prof,error:profileError } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("user_id", otherId)
        .abortSignal(initialAbort.signal)
        .maybeSingle();
      if(!active)return;
      if(profileError)throw profileError;
      if (!prof) { toast.error(t("directChat.userNotFound")); nav("/inbox"); return; }
      setOther(prof);

      const [a, b] = [userId, otherId].sort();
      const existingRead = await supabase
        .from("direct_chats")
        .select("id")
        .eq("user_a", a)
        .eq("user_b", b)
        .abortSignal(initialAbort.signal)
        .maybeSingle();
      if(!active)return;
      if(existingRead.error)throw existingRead.error;
      let existing=existingRead.data;
      if (!existing) {
        const { data: created, error } = await supabase
          .from("direct_chats")
          .insert({ user_a: a, user_b: b })
          .select("id")
          .abortSignal(initialAbort.signal)
          .single();
        if(!active)return;
        if(error?.code==='23505'){
          // Another tab won the unique pair insert. Resolve that exact pair;
          // do not turn a transport failure into another create attempt.
          const resolved=await supabase.from('direct_chats').select('id').eq('user_a',a).eq('user_b',b).abortSignal(initialAbort.signal).maybeSingle();
          if(!active)return;
          if(resolved.error)throw resolved.error;
          existing=resolved.data;
        }else {
          if(error)throw error;
          existing = created;
        }
      }
      if(!existing?.id)throw new Error('chat_missing');

      const { data: m,error:messageError } = await supabase
        .from("direct_messages")
        .select("*")
        .eq("chat_id", existing!.id)
        .order("created_at", { ascending: true })
        .abortSignal(initialAbort.signal)
        .limit(500);
      if(!active)return;
      if(messageError||!Array.isArray(m))throw messageError??new Error('messages_missing');
      setChatId(existing.id);
      setMsgs(m as Message[]);
      setBusy(false);
      return { chatId: existing.id, isA: userId === a };
      })());
      if (!active || !initial) return;
      // Only verified visible history may advance its read marker. A timed-out
      // open/get-or-create must first be resolved by the next explicit read.
      await supabase.from("direct_chats")
        .update(initial.isA ? { user_a_last_read_at: new Date().toISOString() } : { user_b_last_read_at: new Date().toISOString() })
        .eq("id", initial.chatId);
      }catch {
        if(active){
          setLoadError('Không tải được cuộc trò chuyện. Hãy thử tải lại; chưa thể xác minh nội dung.');
          setBusy(false);
            active=false;
            initialAbort.abort();
        }
      }finally{
        if(active)setBusy(false);
      }
    })();
    return()=>{active=false;initialAbort.abort();};
  }, [userId, authLoading, otherId, nav, t,readAttempt]);

  useEffect(() => {
    if (!chatId) return;
    const ch = supabase
      .channel(`dm:${chatId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages", filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const incoming=payload.new as Message;
          setMsgs((prev) => prev.some(message=>message.id===incoming.id)?prev:[...prev,incoming]);
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [chatId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length]);

  const acceptMessage = async(intent:DirectTextIntent,value:unknown)=>{
    const receipt=await matchDirectTextReceipt(intent,value);
    if(!current.current)return false;
    if(!receipt)throw new Error('DM_RECEIPT_MISMATCH');
    settleDirectTextIntent(sessionStorage,intent);
    setPendingSend(null);setPendingState('unknown');setSendError(null);
    setMsgs(previous=>previous.some(message=>message.id===receipt.id)?previous:[...previous,receipt]);
    const draft=draftRef.current.trim();
    if(intent.kind!=='image'&&await directTextHash(draft)===intent.contentHash&&current.current)setText('');
    return true;
  };
  const readPendingMessage = async(intent:DirectTextIntent)=>{
    const {data,error}=await waitForManualPlayerResponse(Promise.resolve(supabase.from('direct_messages')
      .select('id, chat_id, sender_id, kind, content, created_at').eq('id',intent.messageId)
      .eq('chat_id',intent.chatId).eq('sender_id',intent.actorId).maybeSingle()));
    if(!current.current)return;
    if(error)throw error;
    if(data===null){setPendingState('missing');return;}
    await acceptMessage(intent,data);
  };
  const checkPending = async()=>{
    if(sendFlight.current||!pendingSend)return;
    sendFlight.current=true;setSending(true);setSendError(null);
    try{await readPendingMessage(pendingSend);}
    catch{if(current.current){setPendingState('unknown');setSendError('Chưa xác minh được tin nhắn đang chờ. Không gửi lại bằng mã mới.');}}
    finally{sendFlight.current=false;if(current.current)setSending(false);}
  };
  const retryPendingImage = async()=>{
    if(sendFlight.current||uploadFlight.current||pendingState!=='missing'||pendingSend?.kind!=='image')return;
    const intent=pendingSend;
    sendFlight.current=true;setSending(true);setSendError(null);
    try{
      // A retained image reference is reused; never upload another object to
      // recover an uncertain message INSERT.
      const saved=readDirectTextIntent(sessionStorage,intent.actorId,intent.chatId);
      if(JSON.stringify(saved)!==JSON.stringify(intent))throw new Error('DM_PENDING_INTENT_CHANGED');
      if(await directTextHash(intent.attachment!)!==intent.contentHash)throw new Error('DM_PENDING_INTENT_CHANGED');
      if(!current.current)return;
      setPendingState('unknown');
      const {data,error}=await waitForManualPlayerResponse(Promise.resolve(supabase.from('direct_messages')
        .insert({id:intent.messageId,chat_id:intent.chatId,sender_id:intent.actorId,kind:'image',content:intent.attachment!})
        .select('id, chat_id, sender_id, kind, content, created_at').single()));
      if(!current.current)return;
      if(error){if(error.code==='23505'){await readPendingMessage(intent);return;}throw error;}
      await acceptMessage(intent,data);
    }catch{if(current.current){setPendingState('unknown');setSendError('Chưa xác nhận được ảnh đã gửi. Kiểm tra mã đang chờ trước khi gửi lại.');}}
    finally{sendFlight.current=false;if(current.current)setSending(false);}
  };
  const send = async () => {
    const content = text.trim();
    if (!content || !chatId || !user||sendFlight.current||uploadFlight.current||uploading||sendError||pendingSend?.kind==='image') return;
    if (content.length > 2000) return toast.error(t("directChat.msgMax"));
    sendFlight.current=true;setSending(true);
    let dispatched=false;
    try {
      const saved=readDirectTextIntent(sessionStorage,user.id,chatId);
      if(saved&&pendingState!=='missing'){setPendingSend(saved);return;}
      const contentHash=await directTextHash(content);if(!current.current)return;
      if(saved&&saved.contentHash!==contentHash){setSendError('Hãy nhập lại đúng nội dung tin nhắn đang chờ để gửi cùng mã.');return;}
      const intent=saved??{version:1 as const,actorId:user.id,chatId,messageId:crypto.randomUUID(),contentHash};
      retainDirectTextIntent(sessionStorage,intent);setPendingSend(intent);setPendingState('unknown');
      dispatched=true;
      const {data,error}=await waitForManualPlayerResponse(Promise.resolve(supabase.from('direct_messages')
        .insert({id:intent.messageId,chat_id:chatId,sender_id:user.id,kind:'text',content})
        .select('id, chat_id, sender_id, kind, content, created_at').single()));
      if(!current.current)return;
      if(error){if(error.code==='23505'){await readPendingMessage(intent);return;}throw error;}
      await acceptMessage(intent,data);
    }catch {
      if(current.current){setPendingState('unknown');setSendError(dispatched
        ?'Chưa xác nhận được tin nhắn đã gửi. Kiểm tra mã đang chờ trước khi gửi lại.'
        :'Chưa gửi tin nhắn vì không chuẩn bị được mã thao tác. Hãy tải lại cuộc trò chuyện rồi thử lại.');}
    }finally{
      sendFlight.current=false;if(current.current)setSending(false);
    }
  };

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !chatId || !user || uploadFlight.current || sendFlight.current
      || pendingSend || sendError || busy || loadError || !current.current) return;
    if (!file.type.startsWith("image/")) return toast.error(t("directChat.imgOnly"));
    if (file.size > 8 * 1024 * 1024) return toast.error(t("directChat.max8"));
    uploadFlight.current=true;setUploading(true);
    let messageDispatched=false;
    try {
      const saved=readDirectTextIntent(sessionStorage,user.id,chatId);
      if(saved){setPendingSend(saved);setPendingState('unknown');return;}
      const suffix=file.name.split('.').pop()?.toLowerCase()??'';
      const ext=/^[a-z0-9]{1,12}$/.test(suffix)?suffix:'jpg';
      const path = `${user.id}/dm/${chatId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(CHAT_ATTACHMENT_BUCKET).upload(path, file, {
        cacheControl: "3600", upsert: false, contentType: file.type,
      });
      if(!current.current)return;
      if (upErr) throw upErr;
      const content=privateChatAttachmentReference(path);
      const intent:DirectTextIntent={version:1,actorId:user.id,chatId,messageId:crypto.randomUUID(),contentHash:await directTextHash(content),kind:'image',attachment:content};
      if(!current.current)return;
      retainDirectTextIntent(sessionStorage,intent);setPendingSend(intent);setPendingState('unknown');
      messageDispatched=true;
      const {data,error} = await waitForManualPlayerResponse(Promise.resolve(supabase
        .from("direct_messages")
        .insert({id:intent.messageId,chat_id:chatId,sender_id:user.id,kind:'image',content})
        .select('id, chat_id, sender_id, kind, content, created_at').single()));
      if(!current.current)return;
      if(error){if(error.code==='23505'){await readPendingMessage(intent);return;}throw error;}
      await acceptMessage(intent,data);
    } catch (err: unknown) {
      if(current.current){
        if(messageDispatched){setPendingState('unknown');setSendError('Chưa xác nhận được ảnh đã gửi. Kiểm tra mã đang chờ trước khi gửi lại.');}
        else toast.error(err instanceof Error?err.message:t("directChat.uploadFail"));
      }
    } finally {
      uploadFlight.current=false;
      if(current.current)setUploading(false);
    }
  };

  if (authLoading || busy) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!otherId || user.id === otherId) return <Navigate to="/inbox" replace />;
  if(loadError)return <div role="alert" className="mx-auto max-w-2xl space-y-3 p-4">
    <p>{loadError}</p><Button onClick={()=>setReadAttempt(attempt=>attempt+1)}>Thử tải lại cuộc trò chuyện</Button>
  </div>;

  const timeLocale = i18n.language?.startsWith("zh") ? "zh-CN" : i18n.language?.startsWith("en") ? "en-US" : "vi-VN";

  return (
    <div className="max-w-2xl mx-auto flex flex-col h-[calc(100vh-12rem)]">
      <div className="flex items-center gap-3 pb-3 border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => nav("/inbox")}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        {other?.avatar_url ? (
          <img src={other.avatar_url} alt={other.display_name} className="w-10 h-10 rounded-full object-cover" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-muted-foreground" />
          </div>
        )}
        <div>
          <div className="font-semibold">{other?.display_name ?? t("directChat.defaultUser")}</div>
          <div className="text-[11px] text-muted-foreground">{t("directChat.directLabel")}</div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-2">
        {msgs.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-10">{t("directChat.noMessages")}</div>
        ) : msgs.map((m) => {
          const mine = m.sender_id === user.id;
          const isImage = m.kind === "image";
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl ${isImage ? "p-1" : "px-3.5 py-2"} text-sm ${mine ? "bg-primary text-primary-foreground" : "bg-card border border-border"}`}>
                {isImage ? (
                  <PrivateChatAttachment reference={m.content} scope={{kind:'dm',id:chatId??''}} type="image" name={t('directChat.noMsgImg')}/>
                ) : (
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                )}
                <div className={`text-[10px] mt-1 ${isImage ? "px-2 pb-1" : ""} ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                  {new Date(m.created_at).toLocaleTimeString(timeLocale, { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {(pendingSend||sendError)&&<div role="alert" className="space-y-2 border-t border-border py-2 text-sm">
        <p>{sendError??(pendingState==='missing'?'Chưa tìm thấy tin nhắn đang chờ. Nhập lại đúng nội dung để gửi lại cùng mã.':'Tin nhắn chưa được xác minh. Không gửi lại bằng mã mới.')}</p>
        {pendingSend&&<Button variant="outline" disabled={sending} onClick={()=>void checkPending()}>Kiểm tra tin nhắn đang chờ</Button>}
        {pendingSend?.kind==='image'&&pendingState==='missing'&&<Button variant="outline" disabled={sending} onClick={()=>void retryPendingImage()}>Gửi lại ảnh đang chờ</Button>}
      </div>}
      <div className="flex gap-2 pt-3 border-t border-border">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
        <Button
          variant="outline"
          size="icon"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || sending||!!pendingSend||!!sendError}
          title={t("directChat.sendImg")}
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
        </Button>
        <Input
          value={text}
          onChange={(e) => {setText(e.target.value);if(!pendingSend||pendingState==='missing')setSendError(null);}}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={t("directChat.typeMsg")}
          maxLength={2000}
          disabled={sending || uploading||pendingSend?.kind==='image'||(!!pendingSend&&pendingState!=='missing')}
        />
        <Button aria-label="Gửi tin nhắn" onClick={send} disabled={!text.trim() || sending||!!sendError||pendingSend?.kind==='image'||(!!pendingSend&&pendingState!=='missing')} className="gradient-neon text-primary-foreground border-0">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};

export default DirectChat;
