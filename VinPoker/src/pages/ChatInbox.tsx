import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUnreadChats } from "@/hooks/useUnreadChats";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, MessageCircle, Inbox, Search, ArchiveRestore, UserSearch, Send, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { GroupList } from "@/components/groups/GroupList";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { useInboxReadLane } from "@/hooks/useInboxReadLane";

type ChatRow = {
  id: string;
  tournament_id: string;
  club_id: string;
  player_id: string;
  status: string;
  payment_confirmed: boolean;
  updated_at: string;
  archived_at: string | null;
};

const ChatInbox = () => {
  const {user,session,loading}=useAuth();
  if(loading)return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if(!user)return <Navigate to="/auth" replace />;
  return <ScopedChatInbox key={JSON.stringify([user.id,sessionReadEpoch(session)])}/>;
};

const ScopedChatInbox = () => {
  const { t } = useTranslation();
  const { user, loading, isClubAdmin, isAdmin } = useAuth();
  const { perChat, error: unreadError, refresh: refreshUnread } = useUnreadChats();
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [tournaments, setTournaments] = useState<Record<string, any>>({});
  const [clubs, setClubs] = useState<Record<string, any>>({});
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [lastMsg, setLastMsg] = useState<Record<string, any>>({});
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const unarchiveFlight = useRef({ busy: false, generation: 0, mounted: true });
  const [unarchivePending, setUnarchivePending] = useState<string | null>(null);
  const [unarchiveBlocked, setUnarchiveBlocked] = useState(false);
  const [unarchiveError, setUnarchiveError] = useState<string | null>(null);
  useEffect(() => {
    const flight = unarchiveFlight.current;
    flight.mounted = true;
    return () => { flight.mounted = false; };
  }, []);

  const {busy,refresh:load} = useInboxReadLane(user?.id ?? null, async signal => {
      const unarchiveRead = { generation: unarchiveFlight.current.generation, safe: !unarchiveFlight.current.busy };
      const { data: cs, error: chatErr } = await supabase
        .from("booking_chats")
        .select("id,tournament_id,club_id,player_id,status,payment_confirmed,updated_at,archived_at")
        .order("updated_at", { ascending: false }).abortSignal(signal);
      if (chatErr || !Array.isArray(cs)) throw new Error("booking_read_failed");
      const list = cs as ChatRow[];

      if (list.length === 0) {
        return {list,tours:[],clubs:[],profiles:[],messages:[],unarchiveRead};
      }

      const tIds = Array.from(new Set(list.map((c) => c.tournament_id)));
      const cIds = Array.from(new Set(list.map((c) => c.club_id)));
      const pIds = Array.from(new Set(list.map((c) => c.player_id)));
      const chatIds = list.map((c) => c.id);

      const [tRes, cRes, pRes, mRes] = await Promise.all([
        supabase.from("tournaments").select("id,name,start_time").in("id", tIds).abortSignal(signal),
        supabase.from("clubs").select("id,name,owner_id").in("id", cIds).abortSignal(signal),
        supabase.from("profiles").select("user_id,display_name,phone").in("user_id", pIds).abortSignal(signal),
        supabase
          .from("chat_messages")
          .select("chat_id,content,kind,created_at,sender_id")
          .in("chat_id", chatIds)
          .order("created_at", { ascending: false })
          .limit(500).abortSignal(signal),
      ]);
      if ([tRes,cRes,pRes,mRes].some(result=>result.error||!Array.isArray(result.data))) throw new Error("booking_details_failed");
      return {list,tours:tRes.data,clubs:cRes.data,profiles:pRes.data,messages:mRes.data,unarchiveRead};
    }, value => {
      setChats(value.list);
      setTournaments(Object.fromEntries(value.tours.map(t => [t.id,t])));
      setClubs(Object.fromEntries(value.clubs.map(c => [c.id,c])));
      setProfiles(Object.fromEntries(value.profiles.map(p => [p.user_id,p])));
      // Pick latest message per chat
      const latest: Record<string, any> = {};
      for (const m of value.messages) {
        if (!latest[m.chat_id]) latest[m.chat_id] = m;
      }
      setLastMsg(latest);
      setError(null);
      if (value.unarchiveRead.safe && value.unarchiveRead.generation === unarchiveFlight.current.generation
        && !unarchiveFlight.current.busy) {
        setUnarchiveBlocked(false);
        setUnarchiveError(null);
      }
    }, () => setError(t("chatInbox.loadFail")));

  useEffect(() => {
    if (loading) return;
    if (!user) return;
    // Polling instead of Realtime to avoid holding a WebSocket per inbox tab.
    // The actual chat page (BookingChat) keeps its per-chat realtime subscription.
    const onVis = () => { if (document.visibilityState === "visible" && navigator.onLine) void load(); };
    const interval = window.setInterval(onVis, 15_000);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onVis);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user?.id]);

  const filtered = useMemo(() => {
    if (!q.trim()) return chats;
    const s = q.toLowerCase();
    return chats.filter((c) => {
      const t = tournaments[c.tournament_id]?.name?.toLowerCase() ?? "";
      const cl = clubs[c.club_id]?.name?.toLowerCase() ?? "";
      const p = profiles[c.player_id]?.display_name?.toLowerCase() ?? "";
      return t.includes(s) || cl.includes(s) || p.includes(s);
    });
  }, [chats, q, tournaments, clubs, profiles]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!user) return <Navigate to="/auth" replace />;

  const active = filtered.filter((c) => !c.archived_at);
  const archived = filtered.filter((c) => !!c.archived_at);
  const open = active.filter((c) => c.status !== "closed");
  const closed = active.filter((c) => c.status === "closed");
  const title = (isClubAdmin || isAdmin) ? t("chatInbox.titleAdmin") : t("chatInbox.titleUser");
  const canUnarchive = isClubAdmin || isAdmin;

  const unarchive = async (chatId: string) => {
    const chat = chats.find(row => row.id === chatId);
    const flight = unarchiveFlight.current;
    if (!canUnarchive || !chat?.archived_at || flight.busy || unarchiveBlocked) return;
    flight.busy = true; flight.generation += 1;
    setUnarchivePending(chatId); setUnarchiveBlocked(true); setUnarchiveError(null);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let confirmed = false;
    try {
      const result = await Promise.race([
        Promise.resolve(supabase.from("booking_chats").update({ archived_at: null })
          .eq("id", chatId).eq("archived_at", chat.archived_at)
          .select("id,archived_at").abortSignal(controller.signal).maybeSingle()),
        new Promise<never>((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new Error("unarchive_response_unknown"));
        }, 15000); }),
      ]);
      if (!flight.mounted) return;
      if (result.error || result.data?.id !== chatId || result.data.archived_at !== null) throw new Error("unarchive_not_confirmed");
      confirmed = true;
    } catch {
      if (flight.mounted) setUnarchiveError(t("chatInbox.unarchiveUnknown"));
    } finally {
      clearTimeout(timer); controller.abort(); flight.busy = false;
      if (flight.mounted) setUnarchivePending(null);
    }
    // Never retry the write. Only a read started after this attempt may unlock it.
    if (confirmed && flight.mounted) void load();
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Inbox className="w-6 h-6 text-primary" />
          <h1 className="font-display text-2xl text-primary">{title}</h1>
        </div>
        <div className="text-xs text-muted-foreground">{t("chatInbox.bookingsCount", { n: chats.length })}</div>
      </div>

      {unreadError && (
        <div role="status" className="rounded-lg border border-destructive/40 bg-card p-3 text-sm space-y-2">
          <p>{unreadError}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => { void refreshUnread({ silent: true }); }}>
            {t("chatInbox.retry")}
          </Button>
        </div>
      )}

      <Tabs defaultValue="dm" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="dm"><MessageCircle className="w-3.5 h-3.5 mr-1.5" />{t("chatInbox.tabDM")}</TabsTrigger>
          <TabsTrigger value="groups"><Users className="w-3.5 h-3.5 mr-1.5" />Nhóm</TabsTrigger>
          <TabsTrigger value="bookings"><Inbox className="w-3.5 h-3.5 mr-1.5" />{t("chatInbox.tabBookings")}</TabsTrigger>
        </TabsList>

        <TabsContent value="dm" className="mt-3">
          <DirectMessagesTab userId={user.id} />
        </TabsContent>

        <TabsContent value="groups" className="mt-3">
          <GroupList />
        </TabsContent>

        <TabsContent value="bookings" className="mt-3 space-y-4">
          {unarchiveError && <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm space-y-2">
            <p>{unarchiveError}</p><Button type="button" variant="outline" size="sm" disabled={busy} onClick={()=>{void load();}}>{t("chatInbox.retry")}</Button>
          </div>}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("chatInbox.searchBookings")}
              className="pl-9 bg-card border-border"
            />
          </div>

          {error && chats.length > 0 && <div role="status" className="rounded-lg border border-destructive/40 bg-card p-3 space-y-2">
            <p className="text-sm">{error}</p><Button type="button" variant="outline" size="sm" onClick={()=>{void load();}}>{t("chatInbox.retry")}</Button>
          </div>}
          {busy && chats.length === 0 ? (
            <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : error && chats.length === 0 ? (
            <Card className="p-6 text-center border-destructive/40">
              <p className="text-sm text-destructive">{error}</p>
              <button onClick={() => { void load(); }} className="mt-3 text-xs underline text-primary">{t("chatInbox.retry")}</button>
            </Card>
          ) : chats.length === 0 ? (
            <Card className="p-10 text-center gradient-card">
              <MessageCircle className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">{t("chatInbox.noBookings")}</p>
            </Card>
          ) : (
            <Tabs defaultValue="active" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="active">{t("chatInbox.tabActive", { n: active.length })}</TabsTrigger>
                <TabsTrigger value="archived">
                  {t("chatInbox.tabArchived")} {archived.length > 0 && <span className="ml-1 text-muted-foreground">({archived.length})</span>}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="active" className="space-y-4 mt-3">
                <Section t={t} title={t("chatInbox.sectionActive")} items={open} tournaments={tournaments} clubs={clubs} profiles={profiles} unread={perChat} userId={user.id} lastMsg={lastMsg} highlight />
                {closed.length > 0 && (
                  <Section t={t} title={t("chatInbox.sectionClosed")} items={closed} tournaments={tournaments} clubs={clubs} profiles={profiles} unread={perChat} userId={user.id} lastMsg={lastMsg} />
                )}
              </TabsContent>
              <TabsContent value="archived" className="space-y-2 mt-3">
                {archived.length === 0 ? (
                  <Card className="p-8 text-center">
                    <p className="text-sm text-muted-foreground">{t("chatInbox.noArchived")}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t("chatInbox.autoArchiveHint")}</p>
                  </Card>
                ) : (
                  <Section t={t} title={t("chatInbox.sectionArchived")} items={archived} tournaments={tournaments} clubs={clubs} profiles={profiles} unread={perChat} userId={user.id} lastMsg={lastMsg} archived canUnarchive={canUnarchive} onUnarchive={unarchive} unarchiveBlocked={unarchiveBlocked} unarchivePending={unarchivePending} />
                )}
              </TabsContent>
            </Tabs>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

// ============= Direct Messages Tab =============

const DirectMessagesTab = ({ userId }: { userId: string }) => {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [searchQ, setSearchQ] = useState("");
  const [searchRetry, setSearchRetry] = useState(0);
  const [search, setSearch] = useState<{query:string;loading:boolean;error:boolean;results:{user_id:string;display_name:string;avatar_url?:string|null}[]}>({query:"",loading:false,error:false,results:[]});
  const currentSearch = search.query === searchQ.trim();
  const searchResults = currentSearch ? search.results : [];
  const searching = searchQ.trim().length >= 2 && (!currentSearch || search.loading);
  const searchError = currentSearch && search.error;
  const [chats, setChats] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [lastMsgs, setLastMsgs] = useState<Record<string, any>>({});
  const [readError, setReadError] = useState<string | null>(null);

  const {busy,refresh:loadChats} = useInboxReadLane(userId, async signal => {
      const { data: cs, error: chatError } = await supabase
        .from("direct_chats")
        .select("id,user_a,user_b,last_message_at,user_a_last_read_at,user_b_last_read_at")
        .or(`user_a.eq.${userId},user_b.eq.${userId}`)
        .order("last_message_at", { ascending: false }).abortSignal(signal);
      if (chatError || !Array.isArray(cs)) throw new Error("direct_chat_read_failed");
      const list = cs;
      if (list.length === 0) return {list,profiles:[],messages:[]};
      const otherIds = list.map((c: any) => c.user_a === userId ? c.user_b : c.user_a);
      const chatIds = list.map((c: any) => c.id);
      const [{ data: profs, error: profileError }, { data: msgs, error: messageError }] = await Promise.all([
        supabase.from("profiles").select("user_id,display_name,avatar_url").in("user_id", otherIds).abortSignal(signal),
        supabase.from("direct_messages").select("chat_id,content,kind,created_at,sender_id")
          .in("chat_id", chatIds).order("created_at", { ascending: false }).limit(500).abortSignal(signal),
      ]);
      if (profileError || messageError || !Array.isArray(profs) || !Array.isArray(msgs)) throw new Error("direct_chat_details_failed");
      return {list,profiles:profs,messages:msgs};
    }, value => {
      const latest: Record<string, any> = {};
      for (const m of value.messages) if (!latest[m.chat_id]) latest[m.chat_id] = m;
      setChats(value.list);
      setProfiles(Object.fromEntries(value.profiles.map(p => [p.user_id,p])));
      setLastMsgs(latest);
      setReadError(null);
    }, () => setReadError(t("chatInbox.loadFail")));

  useEffect(() => {
    const ch = supabase.channel("dm-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "direct_chats" }, () => loadChats())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "direct_messages" }, () => loadChats())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [userId]);

  // Debounced user search
  useEffect(() => {
    const q = searchQ.trim();
    if (q.length < 2) { setSearch({query:q,loading:false,error:false,results:[]}); return; }
    let active = true;
    const controller = new AbortController();
    setSearch({query:q,loading:true,error:false,results:[]});
    const debounce = setTimeout(async () => {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const interrupted = new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("search_cancelled")), {once:true});
        deadline = setTimeout(() => controller.abort(), 15_000);
      });
      try {
        const result = await Promise.race([supabase.from("profiles")
          .select("user_id,display_name,avatar_url").ilike("display_name", `%${q}%`).neq("user_id", userId)
          .limit(20).abortSignal(controller.signal), interrupted]);
        if (!active || controller.signal.aborted) return;
        if (result.error || !Array.isArray(result.data)) throw new Error("profile_search_failed");
        setSearch({query:q,loading:false,error:false,results:result.data.filter(p => p.display_name)});
      } catch {
        if (active) setSearch({query:q,loading:false,error:true,results:[]});
      } finally {
        clearTimeout(deadline);
      }
    }, 300);
    return () => {active=false;clearTimeout(debounce);controller.abort();};
  }, [searchQ, userId, searchRetry]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <UserSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder={t("chatInbox.searchUsers")}
          className="pl-9 bg-card border-border"
        />
      </div>

      {searchQ.trim().length >= 2 && (
        <Card className="p-2 max-h-72 overflow-y-auto">
          {searching ? (
            <div className="text-center py-3 text-xs text-muted-foreground">{t("chatInbox.searching")}</div>
          ) : searchError ? (
            <div role="status" className="p-3 space-y-2">
              <p className="text-sm text-destructive">{t("chatInbox.searchFail")}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setSearchRetry(n => n + 1)}>{t("chatInbox.retry")}</Button>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="text-center py-3 text-xs text-muted-foreground">{t("chatInbox.noResultsFor", { q: searchQ })}</div>
          ) : (
            <div className="divide-y divide-border/50">
              {searchResults.map((p) => (
                <button
                  key={p.user_id}
                  onClick={() => nav(`/dm/${p.user_id}`)}
                  className="w-full flex items-center gap-3 p-2 hover:bg-muted/50 rounded-lg transition text-left"
                >
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt={p.display_name} className="w-9 h-9 rounded-full object-cover" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                      {p.display_name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 truncate">
                    <div className="font-medium text-sm truncate">{p.display_name}</div>
                  </div>
                  <Send className="w-4 h-4 text-primary" />
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {readError && <div role="status" className="rounded-lg border border-destructive/40 bg-card p-3 space-y-2">
        <p className="text-sm">{readError}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => { void loadChats(); }}>{t("chatInbox.retry")}</Button>
      </div>}
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{readError && chats.length === 0 ? t("chatInbox.tabDM") : t("chatInbox.inboxLabel", { n: chats.length })}</div>
      {busy && chats.length === 0 ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : chats.length === 0 ? (
        !readError && <Card className="p-8 text-center">
          <MessageCircle className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">{t("chatInbox.noDM")}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {chats.map((c: any) => {
            const otherId = c.user_a === userId ? c.user_b : c.user_a;
            const p = profiles[otherId];
            const lm = lastMsgs[c.id];
            const myLastRead = c.user_a === userId ? c.user_a_last_read_at : c.user_b_last_read_at;
            const isUnread = lm && lm.sender_id !== userId && new Date(lm.created_at) > new Date(myLastRead);
            return (
              <Link key={c.id} to={`/dm/${otherId}`} className="block">
                <Card className={`p-3 flex items-center gap-3 hover:border-primary/50 transition ${isUnread ? "border-primary/60 bg-primary/5" : ""}`}>
                  {p?.avatar_url ? (
                    <img src={p.avatar_url} alt={p.display_name} className="w-11 h-11 rounded-full object-cover" />
                  ) : (
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center ${isUnread ? "gradient-neon" : "bg-muted"}`}>
                      <MessageCircle className={`w-5 h-5 ${isUnread ? "text-primary-foreground" : "text-muted-foreground"}`} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className={`truncate ${isUnread ? "font-bold" : "font-medium"}`}>
                        {p?.display_name ?? t("chatInbox.noDMUser")}
                      </div>
                      <div className="text-[10px] text-muted-foreground shrink-0">
                        {formatRelTime(lm?.created_at ?? c.last_message_at)}
                      </div>
                    </div>
                    <div className={`text-xs truncate mt-0.5 ${isUnread ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                      {lm ? (lm.sender_id === userId ? t("chatInbox.youPrefix") : "") + (lm.kind === "image" ? t("chatInbox.photo") : lm.content) : t("chatInbox.noMessages")}
                    </div>
                  </div>
                  {isUnread && <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" />}
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};

const formatRelTime = (iso?: string) => {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
};

const Section = ({ t, title, items, tournaments, clubs, profiles, unread, userId, lastMsg, highlight, archived, canUnarchive, onUnarchive, unarchiveBlocked, unarchivePending }: any) => (
  <div className="space-y-2">
    {!archived && <div className="text-xs uppercase tracking-wider text-muted-foreground">{title} · {items.length}</div>}
    {items.length === 0 && !archived && <div className="text-sm text-muted-foreground py-2">{t("chatInbox.noConversations")}</div>}
    {items.map((c: any) => {
      const t2 = tournaments[c.tournament_id];
      const cl = clubs[c.club_id];
      const p = profiles[c.player_id];
      const isPlayer = c.player_id === userId;
      const to = isPlayer
        ? `/chat/${c.tournament_id}`
        : `/chat/${c.tournament_id}?asReceptionist=${c.id}`;
      const u = unread[c.id] ?? 0;
      const unreadHi = u > 0 && c.status !== "closed" && !archived;
      const lm = lastMsg[c.id];
      const preview = lm
        ? (lm.kind === "image" ? t("chatInbox.photo") : lm.kind === "system" ? lm.content : lm.content)
        : t("chatInbox.noMessages");
      const otherName = isPlayer ? (cl?.name ?? t("chatInbox.defaultClub")) : `${p?.display_name ?? t("chatInbox.defaultPlayer")}${p?.phone ? ` · ${p.phone}` : ""}`;
      const sub = t2?.name ?? t("chatInbox.defaultTournament");
      return (
        <div key={c.id} className="relative">
          <Link to={to} className="block">
            <Card className={`p-3 flex items-center gap-3 hover:border-primary/50 transition ${unreadHi ? "border-primary/60 bg-primary/5" : archived ? "opacity-70 border-dashed" : highlight ? "border-primary/20" : ""}`}>
              <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${unreadHi ? "gradient-neon shadow-neon" : "bg-muted"}`}>
                <MessageCircle className={`w-5 h-5 ${unreadHi ? "text-primary-foreground" : "text-muted-foreground"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className={`truncate ${unreadHi ? "font-bold" : "font-medium"}`}>{otherName}</div>
                  <div className="text-[10px] text-muted-foreground shrink-0">{formatRelTime(lm?.created_at ?? c.updated_at)}</div>
                </div>
                <div className="text-xs text-muted-foreground truncate">{sub}</div>
                <div className={`text-xs truncate mt-0.5 ${unreadHi ? "text-foreground font-medium" : "text-muted-foreground"}`}>{preview}</div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {c.payment_confirmed && <Badge variant="outline" className="border-success/40 text-success text-[10px]">{t("chatInbox.paid")}</Badge>}
                {unreadHi && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary text-primary-foreground font-semibold">{u > 99 ? "99+" : u}</span>
                )}
                {archived && <Badge variant="outline" className="text-[10px] text-muted-foreground">{t("chatInbox.archived")}</Badge>}
              </div>
            </Card>
          </Link>
          {archived && canUnarchive && (
            <Button
              size="sm"
              variant="ghost"
              className="absolute top-1 right-1 h-7 px-2 text-[10px]"
              disabled={unarchiveBlocked}
              aria-busy={unarchivePending === c.id}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onUnarchive(c.id); }}
            >
              <ArchiveRestore className="w-3 h-3 mr-1" /> {t(unarchivePending === c.id ? "chatInbox.unarchiving" : "chatInbox.unarchive")}
            </Button>
          )}
        </div>
      );
    })}
  </div>
);

export default ChatInbox;
