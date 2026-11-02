import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Send, X, ImagePlus, ArchiveRestore } from "lucide-react";
import { playNotifySound } from "@/lib/notifySound";
import { compressImage } from "@/lib/compressImage";
import { sessionReadEpoch } from '@/lib/sessionReadEpoch';
import { bookingCashierUrl } from '@/lib/bookingCashierTarget';
import type {Tables} from '@/integrations/supabase/types';

type Registration = {id:string;player_id:string;tournament_id:string;club_id:string|null;reference_code:string;status:string;committed_at:string};
type Chat=Tables<'booking_chats'>;
type Message=Tables<'chat_messages'>;
type Club=Pick<Tables<'clubs'>,'id'|'name'|'owner_id'|'address'|'bot_enabled'|'bot_qr_url'|'bot_welcome_message'>;
type Tour={id:string;club_id:string;name:string;club:Club|null};
type Profile={user_id:string;display_name:string|null;phone?:string|null};

const BookingChat = () => {
  const {user,session,loading,isAdmin}=useAuth();
  const {tournamentId}=useParams();
  const [params]=useSearchParams();
  if(loading)return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if(!user)return <Navigate to="/auth" replace/>;
  return <ScopedBookingChat key={JSON.stringify([user.id,sessionReadEpoch(session),isAdmin,tournamentId,params.getAll('asReceptionist')])}/>;
};

const ScopedBookingChat = () => {
  const { t } = useTranslation();
  const { tournamentId } = useParams();
  const [params] = useSearchParams();
  const asReceptionistChatId = params.get("asReceptionist");
  const nav = useNavigate();
  const { user, loading: authLoading, isAdmin } = useAuth();
  const [chat, setChat] = useState<Chat|null>(null);
  const [tournament, setTournament] = useState<Tour|null>(null);
  const [club, setClub] = useState<Club|null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<Record<string,Profile>>({});
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [setupError,setSetupError]=useState<string|null>(null);
  const [revision,setRevision]=useState(0);
  const [registrations,setRegistrations]=useState<Registration[]|null>(null);
  const [registrationError,setRegistrationError]=useState(false);
  const mounted=useRef(false);
  const writeBusy=useRef(false);
  const [chatActionError,setChatActionError]=useState<string|null>(null);
  const [chatActionPending,setChatActionPending]=useState(false);
  const messageFlight=useRef(false);
  const [messageError,setMessageError]=useState<string|null>(null);
  const draftRef=useRef(text);draftRef.current=text;
  const chatRef=useRef(chat);chatRef.current=chat;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isReceptionist = !!club && !!user && (club.owner_id === user.id || isAdmin) && chat?.player_id !== user.id;

  const setup = async (signal:AbortSignal) => {
    if (!tournamentId || !user || params.getAll('asReceptionist').length>1) throw new Error('invalid_chat_route');
    setLoading(true);
    const { data: tour,error:tourError } = await supabase.from("tournaments")
      .select("*, club:clubs(id,name,owner_id,address,bot_enabled,bot_qr_url,bot_welcome_message)").eq("id", tournamentId).abortSignal(signal).maybeSingle();
    if(signal.aborted)return;
    if (tourError||!tour||tour.id!==tournamentId||!tour.club||tour.club.id!==tour.club_id) throw new Error('invalid_chat_tournament');
    setTournament(tour);
    setClub(tour.club);

    let existing:Chat|null = null;

    if (asReceptionistChatId) {
      // Receptionist opening a specific player's chat
      if(tour.club.owner_id!==user.id&&!isAdmin)throw new Error('chat_actor_not_allowed');
      const { data,error } = await supabase.from("booking_chats").select("*")
        .eq("id", asReceptionistChatId).eq('tournament_id',tournamentId).eq('club_id',tour.club.id).abortSignal(signal).maybeSingle();
      if(signal.aborted)return;
      if(error)throw error;
      existing = data;
    } else {
      const { data,error:readError } = await supabase.from("booking_chats").select("*")
        .eq("tournament_id", tournamentId).eq("player_id", user.id).eq('club_id',tour.club.id).abortSignal(signal).maybeSingle();
      if(signal.aborted)return;
      if(readError)throw readError;
      existing = data;

      if (!existing && tour.club?.owner_id !== user.id && !isAdmin) {
        const { data, error } = await supabase.rpc('ensure_booking_chat_v1',{p_tournament_id:tournamentId}).abortSignal(signal);
        if(signal.aborted)return;
        const result=data as {ok?:boolean;chat?:Chat}|null;
        if(error||result?.ok!==true||!result.chat)throw new Error('chat_create_unverified');
        existing=result.chat;
      }
    }

    if(signal.aborted)return;
    if (!existing||existing.tournament_id!==tournamentId||existing.club_id!==tour.club.id
      ||(asReceptionistChatId?existing.id!==asReceptionistChatId:existing.player_id!==user.id))throw new Error('chat_scope_mismatch');
    setChat(existing);
    writeBusy.current=false;setChatActionPending(false);setChatActionError(null);
    await loadMessages(existing.id);
    if(signal.aborted)return;
    // Mark as read on open
    await markRead(existing);
    if(signal.aborted)return;
    // Load player profile for receptionist view
    if (existing.player_id) {
      const { data: prof } = await supabase.from("profiles").select("user_id, display_name, phone").eq("user_id", existing.player_id).maybeSingle();
      if (!signal.aborted&&prof) setProfiles(prev => ({ ...prev, [prof.user_id]: prof }));
    }
  };

  const loadMessages = async (chatId: string) => {
    const { data: msgs,error } = await supabase.from("chat_messages").select("*")
      .eq("chat_id", chatId).order("created_at", { ascending: true });
    if(!mounted.current)return;
    if(error||!Array.isArray(msgs))throw new Error('chat_messages_unavailable');
    setMessages(msgs ?? []);
    const ids = Array.from(new Set(msgs.map(m => m.sender_id).filter(Boolean)));
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("user_id, display_name").in("user_id", ids as string[]);
      if(mounted.current)setProfiles(prev => ({ ...prev, ...Object.fromEntries((profs ?? []).map(p => [p.user_id, p])) }));
    }
  };

  useEffect(() => {
    const controller=new AbortController();
    const deadline=window.setTimeout(()=>{controller.abort();setSetupError('Không xác minh được cuộc trò chuyện. Tải lại để kiểm tra; không xác nhận thanh toán từ chat.');setLoading(false);},15000);
    setSetupError(null);
    void setup(controller.signal).then(()=>{
      if(!controller.signal.aborted)setLoading(false);
    }).catch(()=>{
      if(!controller.signal.aborted){setSetupError('Không xác minh được cuộc trò chuyện. Tải lại để kiểm tra; không xác nhận thanh toán từ chat.');setLoading(false);}
    }).finally(()=>window.clearTimeout(deadline));
    return()=>{controller.abort();window.clearTimeout(deadline);};
    // Keyed outer component owns actor/session/route lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  useEffect(()=>{
    if(!chat||!tournament||!club||setupError)return;
    let active=true;const controller=new AbortController();
    const deadline=window.setTimeout(()=>{controller.abort();if(active){setRegistrations(null);setRegistrationError(true);}},10000);
    setRegistrationError(false);setRegistrations(null);
    void Promise.resolve(supabase.from('tournament_registrations')
      .select('id,player_id,tournament_id,club_id,reference_code,status,committed_at')
      .eq('player_id',chat.player_id).eq('tournament_id',tournament.id).eq('club_id',club.id)
      .order('committed_at',{ascending:false}).abortSignal(controller.signal)).then(({data,error})=>{
      if(!active||controller.signal.aborted)return;
      if(error||!Array.isArray(data)||data.some(row=>row.player_id!==chat.player_id||row.tournament_id!==tournament.id||row.club_id!==club.id
        ||typeof row.reference_code!=='string'||!row.reference_code||!row.id||!row.status)
        ||new Set(data.map(row=>row.id)).size!==data.length)throw new Error('invalid_chat_registrations');
      // Validate routing IDs without treating a chat marker or screenshot as money.
      data.forEach(row=>bookingCashierUrl(club.id,tournament.id,row.id));
      setRegistrations(data);
    }).catch(()=>{if(active&&!controller.signal.aborted){setRegistrations(null);setRegistrationError(true);}})
      .finally(()=>window.clearTimeout(deadline));
    return()=>{active=false;controller.abort();window.clearTimeout(deadline);};
  // Only identity, not read markers or unrelated messages, invalidates this read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[chat?.id,tournament?.id,club?.id,revision,setupError]);

  const markRead = async (c:Chat) => {
    if (!c || !user||!mounted.current) return;
    const isPlayer = c.player_id === user.id;
    const payload = isPlayer
      ? { player_last_read_at: new Date().toISOString() }
      : { club_last_read_at: new Date().toISOString() };
    await supabase.from("booking_chats").update(payload).eq("id", c.id);
    if(mounted.current)setChat(prev => prev ? { ...prev, ...payload } : prev);
  };

  useEffect(() => {
    if (!chat?.id) return;
    const ch = supabase.channel(`chat-${chat.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `chat_id=eq.${chat.id}` },
        (payload) => {
          if(!mounted.current||payload.new.chat_id!==chat.id)return;
          const message=payload.new as Message;
          setMessages(prev => prev.some(row=>row.id===message.id)?prev:[...prev,message]);
          // Play sound + mark read for messages from the other party
          if (payload.new.sender_id !== user?.id) {
            playNotifySound();
            if (document.visibilityState === "visible") markRead(chat);
          }
        })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "booking_chats", filter: `id=eq.${chat.id}` },
        (payload) => {
          if(mounted.current&&payload.new.id===chat.id&&payload.new.tournament_id===chat.tournament_id
            &&payload.new.club_id===chat.club_id&&payload.new.player_id===chat.player_id)
            setChat(prev=>prev?{...prev,...payload.new}:prev);
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.id]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const send = async () => {
    if (!text.trim() || !chat ||chat.status==='closed'||!mounted.current||messageFlight.current) return;
    const submitted=text;messageFlight.current=true;setSending(true);setMessageError(null);
    try{
      const { error } = await supabase.from("chat_messages").insert({
        chat_id: chat.id, sender_id: user!.id, content: submitted.trim(), kind: "text",
      });
      if(!mounted.current)return;
      if(error)throw error;
      if(draftRef.current===submitted)setText('');
    }catch{
      if(mounted.current)setMessageError('Chưa xác minh được tin nhắn đã gửi. Giữ nội dung và kiểm tra lịch sử chat trước khi thử lại.');
    }finally{
      messageFlight.current=false;if(mounted.current)setSending(false);
    }
  };

  const handleImageUpload = async (raw: File) => {
    if (!chat || !user||chat.status==='closed'||!mounted.current||messageFlight.current) return;
    if (!raw.type.startsWith("image/")) { toast.error(t("bookingChat.imagesOnly")); return; }
    if (raw.size > 10 * 1024 * 1024) { toast.error(t("bookingChat.max10")); return; }
    messageFlight.current=true;setUploading(true);setMessageError(null);
    try{
      const file = await compressImage(raw, { maxEdge: 1600, quality: 0.8 });
      if(!mounted.current||chatRef.current?.status==='closed')return;
      const ext = file.type === "image/png" ? "png" : "jpg";
      const path = `${user.id}/${chat.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("chat-uploads").upload(path, file, { upsert: false, contentType: file.type });
      if(!mounted.current||chatRef.current?.status==='closed')return;
      if(upErr)throw upErr;
      const { data: pub } = supabase.storage.from("chat-uploads").getPublicUrl(path);
      const { error: msgErr } = await supabase.from("chat_messages").insert({
        chat_id: chat.id, sender_id: user.id, content: pub.publicUrl, kind: "image",
      });
      if(!mounted.current)return;
      if(msgErr)throw msgErr;
      if(fileRef.current)fileRef.current.value='';
    }catch{
      if(mounted.current)setMessageError('Chưa xác minh được ảnh đã gửi. Kiểm tra lịch sử chat trước khi tải lại; ảnh có thể đã được lưu.');
    }finally{
      messageFlight.current=false;if(mounted.current)setUploading(false);
    }
  };

  const unarchiveConversation=async()=>{
    if(!(isReceptionist||isAdmin)||!chat?.archived_at||!tournament||!club||!mounted.current||writeBusy.current)return;
    writeBusy.current=true;setChatActionPending(true);setChatActionError(null);
    const controller=new AbortController();let deadline:number|undefined;
    try{
      const result=await Promise.race([
        supabase.from('booking_chats').update({archived_at:null}).eq('id',chat.id)
          .eq('tournament_id',tournament.id).eq('club_id',club.id).eq('archived_at',chat.archived_at)
          .select('id,archived_at').abortSignal(controller.signal).maybeSingle(),
        new Promise<never>((_,reject)=>{deadline=window.setTimeout(()=>{controller.abort();reject(new Error('unarchive_unknown'));},15000);}),
      ]);
      if(!mounted.current)return;
      if(result.error||result.data?.id!==chat.id||result.data.archived_at!==null)throw new Error('unarchive_unverified');
      setChat(current=>current?{...current,archived_at:null}:current);
      writeBusy.current=false;setChatActionPending(false);
    }catch{
      if(mounted.current){setChatActionPending(false);setChatActionError('Chưa xác minh được việc khôi phục chat. Kiểm tra trạng thái chat trước khi thử lại.');}
    }finally{window.clearTimeout(deadline);controller.abort();}
  };

  const closeConversation = async () => {
    if(!isReceptionist||!chat||!tournament||!club||chat.status==='closed'||writeBusy.current||!mounted.current)return;
    writeBusy.current=true;setChatActionPending(true);setChatActionError(null);
    let deadline:number|undefined;
    try{
      const {data,error}=await Promise.race([
        supabase.from('booking_chats').update({status:'closed',closed_by:user!.id,closed_at:new Date().toISOString()})
          .eq('id',chat.id).eq('tournament_id',tournament.id).eq('club_id',club.id).eq('status',chat.status).select('id,status').maybeSingle(),
        new Promise<never>((_,reject)=>{deadline=window.setTimeout(()=>reject(new Error('unknown_chat_close')),15000);}),
      ]);
      if(!mounted.current)return;
      if(error||data?.id!==chat.id||data.status!=='closed')throw new Error('chat_close_unverified');
      setChat(current=>current?{...current,status:'closed'}:current);
      setChatActionPending(false);writeBusy.current=false;
    }catch{
      if(mounted.current){setChatActionPending(false);setChatActionError('Chưa xác minh được việc đóng chat. Tải lại để kiểm tra trước khi thử tiếp; đăng ký và thanh toán không bị thay đổi.');}
      // Unknown outcome: no automatic second write from this mounted screen.
    }finally{window.clearTimeout(deadline);}
  };

  if (authLoading || loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!user) { nav("/auth"); return null; }
  if(setupError)return <div role="alert" className="p-4 space-y-2"><p>{setupError}</p><Button onClick={()=>{writeBusy.current=false;setChatActionError(null);setRevision(n=>n+1);}}>Tải lại</Button></div>;
  if(!chat||!tournament||!club)return <p role="alert">Không xác minh được cuộc trò chuyện.</p>;

  const playerName = profiles[chat?.player_id]?.display_name ?? t("bookingChat.defaultPlayer");
  const playerPhone = profiles[chat?.player_id]?.phone;

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)]">
      <button onClick={() => nav(-1)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2">
        <ArrowLeft className="w-4 h-4" /> {t("bookingChat.back")}
      </button>

      <Card className="p-3 gradient-card border-primary/30 mb-2">
        <div className="text-xs text-muted-foreground">
          {isReceptionist ? t("bookingChat.receptionist", { club: club?.name }) : t("bookingChat.stackBooking", { club: club?.name })}
        </div>
        <div className="font-display text-lg">{tournament?.name}</div>
        {isReceptionist && (
          <div className="text-xs text-muted-foreground mt-0.5">{t("bookingChat.playerLabel")} <span className="text-foreground font-medium">{playerName}</span>{playerPhone && ` · ${playerPhone}`}</div>
        )}
        <div className="text-xs text-muted-foreground mt-0.5">
          {t("bookingChat.status")} <span className={chat?.status === "closed" ? "text-muted-foreground" : "text-primary"}>{chat?.status === "closed" ? t("bookingChat.closed") : t("bookingChat.active")}</span>
        </div>
        <div className="mt-2 space-y-2 text-xs">
          <p>Chat không xác nhận tiền hoặc ghế. Đăng ký, khoản thu và phiếu được kiểm tra tại Cashier.</p>
          {chat?.payment_confirmed&&<p className="text-muted-foreground">Chat có dấu xác nhận cũ; dấu này không phải bằng chứng thanh toán.</p>}
          {registrationError?<p role="alert">Không tải được đăng ký. Chưa thể đối chiếu thanh toán; tải lại để kiểm tra.</p>
            :registrations===null?<p role="status">Đang tải đăng ký…</p>
            :registrations.length===0?<p>Không có đăng ký hiện hành đọc được trong tour này. Kiểm tra lịch sử trước khi tạo đăng ký mới.</p>
            :<ul className="space-y-2">{registrations.map(reg=><li key={reg.id} className="flex flex-wrap items-center gap-2">
              <span className="break-all">{reg.reference_code} · {reg.status}</span>
              {isReceptionist&&['pending','confirmed'].includes(reg.status)&&<Link className="text-primary underline" to={bookingCashierUrl(club.id,tournament.id,reg.id)}>Mở Cashier · {reg.reference_code}</Link>}
            </li>)}</ul>}
          {registrationError&&<Button size="sm" variant="outline" onClick={()=>setRevision(n=>n+1)}>Tải lại đăng ký</Button>}
          {!isReceptionist&&<Link className="inline-block text-primary underline" to={`/tournament/${tournament.id}`}>Mở tour và đăng ký chuẩn</Link>}
        </div>
        {chatActionError&&<div role="alert" className="text-sm space-y-2"><p>{chatActionError}</p><Button variant="outline" size="sm" onClick={()=>setRevision(n=>n+1)}>Kiểm tra trạng thái chat</Button></div>}
        {chat?.archived_at && (
          <div className="mt-2 flex items-center justify-between gap-2 text-xs bg-muted/40 border border-dashed rounded-md px-2 py-1.5">
            <span className="text-muted-foreground">{t("bookingChat.archivedNote")}</span>
            {(isReceptionist || isAdmin) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={unarchiveConversation} disabled={chatActionPending||!!chatActionError}
              >
                <ArchiveRestore className="w-3 h-3 mr-1" /> {t("bookingChat.unarchive")}
              </Button>
            )}
          </div>
        )}
      </Card>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-2 px-1">
        {messages.map(m => {
          if (m.kind === "system") {
            return (
              <div key={m.id} className="text-center text-xs text-muted-foreground italic py-1">
                {m.content}
              </div>
            );
          }
          const isBot = !m.sender_id;
          const mine = !isBot && m.sender_id === user.id;
          const name = isBot ? t("bookingChat.botName") : (profiles[m.sender_id]?.display_name ?? t("bookingChat.defaultUser"));
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-primary text-primary-foreground" : isBot ? "bg-muted/60 border border-primary/20 text-foreground" : "bg-muted text-foreground"}`}>
                {!mine && <div className={`text-[10px] mb-0.5 ${isBot ? "text-primary font-medium" : "opacity-70"}`}>{name}</div>}
                {m.kind === "image" ? (
                  <a href={m.content} target="_blank" rel="noopener noreferrer">
                    <img src={m.content} alt="Chat attachment" className="rounded-lg max-h-64 object-cover" loading="lazy" />
                  </a>
                ) : (
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {isReceptionist && chat?.status !== "closed" && (
        <div className="mt-2 space-y-2">
          <Button
            size="sm"
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
            onClick={closeConversation} disabled={chatActionPending||!!chatActionError}
          >
            <X className="w-4 h-4 mr-1" />Đóng chat (không hủy đăng ký)
          </Button>
        </div>
      )}

      {messageError&&<p role="alert" className="text-sm mt-2">{messageError}</p>}
      <div className="flex gap-2 mt-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
        />
        <Button
          variant="outline"
          size="icon"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || sending || chat?.status === "closed"}
          title={t("bookingChat.photoTip")}
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
        </Button>
        <Input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && send()}
          placeholder={chat?.status === "closed" ? t("bookingChat.conversationClosed") : t("bookingChat.typeMsg")}
          disabled={chat?.status === "closed" || sending ||uploading} />
        <Button aria-label="Gửi tin nhắn" onClick={send} disabled={sending ||uploading|| !text.trim() || chat?.status === "closed"}>
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};

export default BookingChat;
