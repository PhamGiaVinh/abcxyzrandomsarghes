import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Send, ArrowLeft, Users, Trash2, Lock, Globe, MessageCircle, Paperclip, Link2, X } from "lucide-react";
import { toast } from "sonner";
import { GroupMembersDialog } from "@/components/groups/GroupMembersDialog";
import { InviteLinkDialog } from "@/components/groups/InviteLinkDialog";
import { PrivateChatAttachment } from "@/components/groups/PrivateChatAttachment";
import {CHAT_ATTACHMENT_BUCKET,privateChatAttachmentReference} from '@/lib/chatAttachment';
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";

interface Group {
  id: string;
  name: string;
  avatar_url: string | null;
  is_public: boolean;
  created_by: string;
  deleted_at: string | null;
}

interface Msg {
  id: string;
  group_id: string;
  sender_id: string;
  content: string | null;
  created_at: string;
  deleted_at?: string | null;
  attachment_url?: string | null;
  attachment_type?: string | null;
  attachment_name?: string | null;
  attachment_size?: number | null;
  _optimistic?: boolean;
}

const MAX_LEN = 2000;
const PAGE = 50;
const MAX_FILE_MB = 10;
const ALLOWED_TYPES = /^(image\/.*|application\/pdf|application\/zip|application\/x-zip-compressed|application\/msword|application\/vnd\.openxmlformats-officedocument\..*|application\/vnd\.ms-excel|text\/plain)$/;

const GroupChat = () => {
  const {user,session,loading}=useAuth();
  const {groupId}=useParams<{groupId:string}>();
  return <GroupChatScope key={JSON.stringify([user?.id,sessionReadEpoch(session),groupId,loading])}/>;
};

const GroupChatScope = () => {
  const { t, i18n } = useTranslation();
  const { groupId } = useParams<{ groupId: string }>();
  const { user, loading: authLoading } = useAuth();
  const nav = useNavigate();
  const [group, setGroup] = useState<Group | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [profiles, setProfiles] = useState<Record<string, { display_name: string; avatar_url?: string | null }>>({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(true);
  const [sending, setSending] = useState(false);
  const sendingRef=useRef(false);
  const deletingRef=useRef(false);
  const [hasMore, setHasMore] = useState(true);
  const olderFlight=useRef(false);
  const [olderLoading,setOlderLoading]=useState(false);
  const [olderError,setOlderError]=useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loadError,setLoadError]=useState(false);
  const [readAttempt,setReadAttempt]=useState(0);
  const current=useRef(true);
  useEffect(()=>{current.current=true;return()=>{current.current=false;};},[]);
  const [openMembers, setOpenMembers] = useState(false);
  const [openInvite, setOpenInvite] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<string, { name: string; ts: number }>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSent = useRef(0);

  const scrollToBottom = (smooth = true) => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    });
  };

  const isNearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const loadProfiles = async (ids: string[], accepts = () => current.current) => {
    const missing = ids.filter((id) => !profiles[id]);
    if (missing.length === 0) return;
    const { data } = await supabase.from("profiles").select("user_id, display_name, avatar_url").in("user_id", missing);
    if(!accepts())return;
    setProfiles((prev) => {
      const next = { ...prev };
      (data ?? []).forEach((p) => { next[p.user_id] = p; });
      return next;
    });
  };

  useEffect(() => {
    if (authLoading || !user || !groupId) return;
    let cancelled = false;
    (async () => {
      setBusy(true);setLoadError(false);setForbidden(false);
      try {
      await waitForManualPlayerResponse((async () => {
      const { data: g, error: gErr } = await supabase
        .from("chat_groups")
        .select("id, name, avatar_url, is_public, created_by, deleted_at")
        .eq("id", groupId)
        .maybeSingle();
      if (cancelled) return;
      if(gErr)throw gErr;
      if (!g) { setForbidden(true); return; }
      if (g.deleted_at) { toast.error(t("groupChat.chat.deleted")); nav("/inbox"); return; }

      const { data: mems, error: mErr } = await supabase
        .from("chat_group_members")
        .select("user_id")
        .eq("group_id", groupId);
      if(cancelled)return;
      if (mErr) throw mErr;
      const memList = mems ?? [];
      setMemberCount(memList.length);
      if (!memList.find((m) => m.user_id === user.id)) {
        setForbidden(true);
        setBusy(false);
        return;
      }
      setGroup(g as Group);
      const { data: m,error:messageError } = await supabase
        .from("chat_group_messages")
        .select("*")
        .eq("group_id", groupId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE);
      if(cancelled)return;
      if(messageError||!Array.isArray(m))throw messageError??new Error('group_messages_unavailable');
      const list = ((m ?? []) as Msg[]).reverse();
      setMsgs(list);
      setHasMore((m ?? []).length === PAGE);
      await loadProfiles(Array.from(new Set(list.map((x) => x.sender_id))), () => !cancelled && current.current);
      if(cancelled)return;
      // Do not mark unseen history as read while its initial fetch is hung.
      await supabase
        .from("chat_group_members")
        .update({ last_read_at: new Date().toISOString() })
        .eq("group_id", groupId)
        .eq("user_id", user.id);
      if(cancelled)return;
      setBusy(false);
      scrollToBottom(false);
      })());
      }catch{
        if(!cancelled){setLoadError(true);setMsgs([]);setGroup(null);setBusy(false);cancelled=true;}
      }finally{if(!cancelled)setBusy(false);}
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [user?.id, authLoading, groupId, nav, readAttempt]);

  // Realtime: messages + members + group + typing broadcast
  useEffect(() => {
    if (!groupId || !user || busy || forbidden || loadError || !group) return;
    let active=true;
    const ch = supabase.channel(`group:${groupId}`, { config: { broadcast: { self: false } } })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_group_messages", filter: `group_id=eq.${groupId}` }, async (payload) => {
        if(!active)return;
        const m = payload.new as Msg;
        setMsgs((prev) => {
          const idx = prev.findIndex((x) => x._optimistic && x.sender_id === m.sender_id && (x.content ?? "") === (m.content ?? "") && (x.attachment_url ?? "") === (m.attachment_url ?? ""));
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = m;
            return next;
          }
          if (prev.find((x) => x.id === m.id)) return prev;
          return [...prev, m];
        });
        await loadProfiles([m.sender_id]);
        if(!active)return;
        if (isNearBottom()) scrollToBottom();
        if (document.visibilityState === "visible") {
          await supabase.from("chat_group_members").update({ last_read_at: new Date().toISOString() })
            .eq("group_id", groupId).eq("user_id", user.id);
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_group_messages", filter: `group_id=eq.${groupId}` }, (payload) => {
        if(!active)return;
        const m = payload.new as Msg;
        if (m.deleted_at) {
          setMsgs((prev) => prev.filter((x) => x.id !== m.id));
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_group_members", filter: `group_id=eq.${groupId}` }, async () => {
        const { data: mems } = await supabase.from("chat_group_members").select("user_id").eq("group_id", groupId);
        if(!active)return;
        setMemberCount((mems ?? []).length);
        if (mems && !mems.find((m) => m.user_id === user.id)) {
          toast.error(t("groupChat.chat.kicked"));
          nav("/inbox");
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_groups", filter: `id=eq.${groupId}` }, (payload) => {
        if(!active)return;
        const g = payload.new as Group;
        if (g.deleted_at) {
          toast.error(t("groupChat.chat.deleted"));
          nav("/inbox");
        } else {
          setGroup((prev) => prev ? { ...prev, name: g.name, avatar_url: g.avatar_url, is_public: g.is_public } : prev);
        }
      })
      .on("broadcast", { event: "typing" }, (payload) => {
        if(!active)return;
        const p = payload.payload as { user_id: string; name: string };
        if (!p?.user_id || p.user_id === user.id) return;
        setTypingUsers((prev) => ({ ...prev, [p.user_id]: { name: p.name, ts: Date.now() } }));
      })
      .subscribe();
    channelRef.current = ch;
    return () => { active=false;supabase.removeChannel(ch); channelRef.current = null; };
    // eslint-disable-next-line
  }, [groupId, user?.id, nav, busy, forbidden, loadError, group?.id]);

  // Typing cleanup tick
  useEffect(() => {
    const id = setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now();
        const next: typeof prev = {};
        let changed = false;
        for (const k in prev) {
          if (now - prev[k].ts < 4000) next[k] = prev[k];
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1500);
    return () => clearInterval(id);
  }, []);

  const sendTyping = () => {
    if (!channelRef.current || !user) return;
    const now = Date.now();
    if (now - lastTypingSent.current < 3000) return;
    lastTypingSent.current = now;
    const myName = profiles[user.id]?.display_name ?? t("groupChat.chat.unknown");
    channelRef.current.send({ type: "broadcast", event: "typing", payload: { user_id: user.id, name: myName } });
  };

  const handleFilePick = (file: File | null) => {
    if (!file) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) { toast.error(t("groupChat.chat.fileTooLarge", { n: MAX_FILE_MB })); return; }
    if (!ALLOWED_TYPES.test(file.type)) { toast.error(t("groupChat.chat.fileBadType")); return; }
    setPendingFile(file);
    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setPendingPreview(url);
    } else {
      setPendingPreview(null);
    }
  };

  const clearPending = () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(null);
    setPendingPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const send = async () => {
    if (!user || !groupId || busy || forbidden || loadError || !group || sendingRef.current || !current.current) return;
    const trimmed = text.trim();
    if (!trimmed && !pendingFile) return;
    if (trimmed.length > MAX_LEN) { toast.error(t("groupChat.chat.textTooLong", { n: MAX_LEN })); return; }

    let attachment_url: string | null = null;
    let attachment_type: string | null = null;
    let attachment_name: string | null = null;
    let attachment_size: number | null = null;

    sendingRef.current=true;
    setSending(true);
    let tempId:string|null=null;
    try {

    if (pendingFile) {
      const isImg = pendingFile.type.startsWith("image/");
      const ext = pendingFile.name.split(".").pop() ?? "bin";
      const path = `${user.id}/groups/${groupId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(CHAT_ATTACHMENT_BUCKET).upload(path, pendingFile, {
        cacheControl: "3600",
        contentType: pendingFile.type,
        upsert: false,
      });
      if(!current.current)return;
      if (upErr) {
        setSending(false);
        toast.error(t("groupChat.chat.uploadFail", { msg: upErr.message }));
        return;
      }
      attachment_url = privateChatAttachmentReference(path);
      attachment_type = isImg ? "image" : "file";
      attachment_name = pendingFile.name;
      attachment_size = pendingFile.size;
    }

    tempId = `tmp-${crypto.randomUUID()}`;
    const optimistic: Msg = {
      id: tempId,
      group_id: groupId,
      sender_id: user.id,
      content: trimmed || null,
      created_at: new Date().toISOString(),
      attachment_url, attachment_type, attachment_name, attachment_size,
      _optimistic: true,
    };
    setMsgs((prev) => [...prev, optimistic]);
    scrollToBottom();

    const { error } = await supabase.from("chat_group_messages").insert({
      group_id: groupId,
      sender_id: user.id,
      content: trimmed || null,
      attachment_url, attachment_type, attachment_name, attachment_size,
    });
    if(!current.current)return;
    if (error) {
      setMsgs((prev) => prev.filter((m) => m.id !== tempId));
      setText(trimmed);
      toast.error(error.message);
    }else {setText('');clearPending();}
    }catch{
      if(current.current){
        if(tempId)setMsgs(prev=>prev.filter(m=>m.id!==tempId));
        toast.error('Chưa xác minh được tin nhắn đã gửi. Giữ nội dung; kiểm tra nhóm trước khi gửi lại.');
      }
    }finally{sendingRef.current=false;if(current.current)setSending(false);}
  };

  const loadOlder = async () => {
    if (!groupId || msgs.length === 0 || !hasMore || busy || forbidden || loadError || olderFlight.current || !current.current) return;
    olderFlight.current=true;setOlderLoading(true);setOlderError(false);
    const oldest = msgs[0];
    const el = scrollRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;
    try {
    // Raw PostgREST filters must contain only validated server cursor values.
    // Preserve PostgreSQL microseconds; Date.toISOString would truncate them.
    if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(oldest.id)
      ||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(oldest.created_at)
      ||!Number.isFinite(Date.parse(oldest.created_at)))throw new Error('invalid_group_page_cursor');
    const { data,error } = await waitForManualPlayerResponse(Promise.resolve(supabase
      .from("chat_group_messages")
      .select("*")
      .eq("group_id", groupId)
      .is("deleted_at", null)
      .or(`created_at.lt.${oldest.created_at},and(created_at.eq.${oldest.created_at},id.lt.${oldest.id})`)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE)));
    if(!current.current)return;
    if(error||!Array.isArray(data)||data.some(m=>m.group_id!==groupId||typeof m.id!=='string'
      ||typeof m.created_at!=='string'||!Number.isFinite(Date.parse(m.created_at))))throw error??new Error('older_messages_unavailable');
    const older = (data as Msg[]).slice().reverse();
    if (older.length === 0) { setHasMore(false); return; }
    setMsgs((prev) => [...older.filter(m=>!prev.some(existing=>existing.id===m.id)), ...prev]);
    await loadProfiles(Array.from(new Set(older.map((x) => x.sender_id))));
    if(!current.current)return;
    requestAnimationFrame(() => {
      if(!current.current)return;
      if (el) el.scrollTop = el.scrollHeight - prevScrollHeight;
    });
    if (older.length < PAGE) setHasMore(false);
    }catch{if(current.current)setOlderError(true);}
    finally{olderFlight.current=false;if(current.current)setOlderLoading(false);}
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop < 80 && hasMore && !busy && !olderError) void loadOlder();
  };

  const deleteGroup = async () => {
    if (!group || !user || group.created_by!==user.id || deletingRef.current || !current.current) return;
    if (!confirm(t("groupChat.chat.deleteConfirm", { name: group.name }))) return;
    deletingRef.current=true;
    try {
      const rpc=supabase.rpc as unknown as (name:string,args:{p_group_id:string})=>Promise<{data:unknown;error:{message:string}|null}>;
      const {data,error}=await rpc.call(supabase,'soft_delete_chat_group_v1',{p_group_id:group.id});
      if(!current.current)return;
      const receipt=data&&typeof data==='object'?data as Record<string,unknown>:null;
      if(error||receipt?.ok!==true||receipt.groupId!==group.id
        ||!['deleted','already_deleted'].includes(String(receipt.outcome))
        ||typeof receipt.deletedAt!=='string'||!Number.isFinite(Date.parse(receipt.deletedAt))) {
        toast.error(error?.message??'Chưa xác minh được kết quả xóa nhóm. Hãy tải lại trước khi thử tiếp.');return;
      }
      toast.success(t("groupChat.chat.deletedToast"));nav('/inbox');
    }catch{
      if(current.current)toast.error('Chưa xác minh được kết quả xóa nhóm. Hãy tải lại trước khi thử tiếp.');
    }finally{deletingRef.current=false;}
  };

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return d.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleString(i18n.language, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  if (authLoading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>;
  if (!user) return <Navigate to="/auth" replace />;

  if(loadError)return <Card role="alert" className="max-w-md mx-auto p-6 mt-8 space-y-3">
    <p>Không tải được nhóm. Chưa xác minh quyền và nội dung; đây không phải xác nhận bạn bị mất quyền.</p>
    <Button onClick={()=>setReadAttempt(value=>value+1)}>Thử tải lại nhóm</Button>
  </Card>;

  if (forbidden) {
    return (
      <Card className="max-w-md mx-auto p-8 text-center border-destructive/40 mt-8">
        <Lock className="w-10 h-10 mx-auto text-destructive mb-2" />
        <p className="text-sm font-semibold">{t("groupChat.chat.forbidden")}</p>
        <p className="text-xs text-muted-foreground mt-1">{t("groupChat.chat.forbiddenHint")}</p>
        <Button onClick={() => nav("/inbox")} className="mt-4" size="sm">{t("groupChat.chat.back")}</Button>
      </Card>
    );
  }

  const typingList = Object.values(typingUsers);
  const typingLabel = typingList.length === 0
    ? null
    : typingList.length === 1
      ? t("groupChat.chat.typingOne", { name: typingList[0].name })
      : t("groupChat.chat.typingMany", { n: typingList.length });

  return (
    <div className="max-w-3xl mx-auto flex flex-col overflow-hidden h-[calc(100dvh-4rem)] sm:h-[calc(100dvh-6rem)] lg:h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 p-3 border-b border-border/40 bg-card/40 rounded-t-xl">
        <Button asChild variant="ghost" size="icon" className="h-8 w-8 lg:hidden">
          <Link to="/inbox"><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <Avatar className="h-10 w-10">
          <AvatarImage src={group?.avatar_url ?? undefined} />
          <AvatarFallback className="bg-primary/20 text-primary"><Users className="w-4 h-4" /></AvatarFallback>
        </Avatar>
        <button className="flex-1 min-w-0 text-left" onClick={() => setOpenMembers(true)}>
          <div className="font-semibold text-sm truncate flex items-center gap-1.5">
            {group?.name ?? "..."}
            {group && (group.is_public ? <Globe className="w-3 h-3 text-muted-foreground" /> : <Lock className="w-3 h-3 text-muted-foreground" />)}
          </div>
          <div className="text-xs text-muted-foreground">{t("groupChat.chat.membersN", { n: memberCount })}</div>
        </button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpenInvite(true)} title={t("groupChat.chat.inviteTitle")}>
          <Link2 className="w-4 h-4" />
        </Button>
        {group?.created_by === user.id && (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={deleteGroup} title={t("groupChat.chat.deleteTitle")}>
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 bg-background">
        {olderLoading&&<p role="status" className="text-xs text-muted-foreground">Đang tải tin nhắn cũ…</p>}
        {olderError&&<div role="alert" className="text-sm space-y-1">
          <p>Chưa tải được tin nhắn cũ. Nội dung hiện tại vẫn được giữ.</p>
          <Button variant="outline" size="sm" onClick={()=>void loadOlder()} disabled={olderLoading}>Thử tải tin nhắn cũ</Button>
        </div>}
        {busy ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`flex gap-2 ${i % 2 ? "justify-end" : ""}`}>
                <Skeleton className="h-12 w-2/3" />
              </div>
            ))}
          </div>
        ) : msgs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageCircle className="w-12 h-12 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">{t("groupChat.chat.emptyTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("groupChat.chat.emptyHint")}</p>
          </div>
        ) : (
          msgs.map((m, i) => {
            const isMe = m.sender_id === user.id;
            const prev = msgs[i - 1];
            const showAvatar = !prev || prev.sender_id !== m.sender_id;
            const prof = profiles[m.sender_id];
            const hasText = !!(m.content && m.content.trim());
            return (
              <div key={m.id} className={`flex gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
                {showAvatar ? (
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarImage src={prof?.avatar_url ?? undefined} />
                    <AvatarFallback className="bg-muted text-[10px]">{(prof?.display_name ?? "?").slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                ) : <div className="w-7 shrink-0" />}
                <div className={`max-w-[75%] ${isMe ? "items-end" : "items-start"} flex flex-col`}>
                  {showAvatar && !isMe && (
                    <span className="text-[10px] text-muted-foreground mb-0.5 px-1">{prof?.display_name ?? t("groupChat.chat.unknown")}</span>
                  )}
                  {m.attachment_url && (
                    <div className={`${m._optimistic ? "opacity-60" : ""} mb-1`}>
                      <PrivateChatAttachment reference={m.attachment_url} scope={{kind:'groups',id:groupId??''}} type={m.attachment_type ?? null} name={m.attachment_name} size={m.attachment_size} />
                    </div>
                  )}
                  {hasText && (
                    <div className={`px-3 py-2 rounded-2xl text-sm break-words whitespace-pre-wrap ${
                      isMe ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-card border border-border/40 rounded-bl-sm"
                    } ${m._optimistic ? "opacity-60" : ""}`}>
                      {m.content}
                    </div>
                  )}
                  <span className="text-[10px] text-muted-foreground mt-0.5 px-1">{fmtTime(m.created_at)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Typing indicator */}
      {typingLabel && (
        <div className="px-4 py-1 text-[11px] text-muted-foreground italic flex items-center gap-1.5 bg-card/30">
          <span className="inline-flex gap-0.5">
            <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
          </span>
          {typingLabel}
        </div>
      )}

      {/* Pending attachment preview */}
      {pendingFile && (
        <div className="px-3 pt-2 bg-card/40">
          <div className="flex items-center gap-2 p-2 rounded-lg border border-border/40 bg-background">
            {pendingPreview ? (
              <img src={pendingPreview} alt="preview" className="w-12 h-12 object-cover rounded" />
            ) : (
              <div className="w-12 h-12 rounded bg-muted flex items-center justify-center"><Paperclip className="w-5 h-5 text-muted-foreground" /></div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate">{pendingFile.name}</div>
              <div className="text-[10px] text-muted-foreground">{(pendingFile.size / 1024).toFixed(1)} KB</div>
            </div>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={clearPending}><X className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-border/40 bg-card/40 rounded-b-xl">
        <div className="flex gap-2 items-end">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,application/pdf,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain"
            onChange={(e) => handleFilePick(e.target.files?.[0] ?? null)}
          />
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => fileInputRef.current?.click()} title={t("groupChat.chat.attachTitle")} disabled={sending || busy || !group}>
            <Paperclip className="w-4 h-4" />
          </Button>
          <textarea
            ref={inputRef}
            value={text}
            disabled={sending || busy || !group}
            onChange={(e) => { setText(e.target.value.slice(0, MAX_LEN)); if (e.target.value.trim()) sendTyping(); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={t("groupChat.chat.placeholder")}
            rows={1}
            className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary max-h-32"
          />
          <Button onClick={send} disabled={sending || busy || !group || (!text.trim() && !pendingFile)} size="icon" aria-label="Gửi tin nhắn">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <div className="text-[10px] text-muted-foreground text-right mt-1">{text.length}/{MAX_LEN}</div>
      </div>

      {group && (
        <>
          <GroupMembersDialog
            open={openMembers}
            onOpenChange={setOpenMembers}
            groupId={group.id}
            createdBy={group.created_by}
            onLeft={() => nav("/inbox")}
          />
          <InviteLinkDialog
            open={openInvite}
            onOpenChange={setOpenInvite}
            groupId={group.id}
            groupName={group.name}
          />
        </>
      )}
    </div>
  );
};

export default GroupChat;
