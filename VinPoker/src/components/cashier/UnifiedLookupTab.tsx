import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Loader2, Search, Users as UsersIcon, IdCard, Phone, ExternalLink, Coins, ChevronDown, ChevronRight, History } from "lucide-react";
import { formatVND } from "@/lib/format";

type ClubRow = { id: string; name: string };

type MemberHit = {
  source: "club_member" | "profile";
  member_card_id?: string;
  full_name?: string;
  phone?: string;
  cccd?: string;
  club_id?: string;
  player_user_id?: string | null;
  display_name?: string;
  avatar_url?: string | null;
  verification_status?: string | null;
  user_id?: string;
};

export default function UnifiedLookupTab({ clubIds, clubs }: { clubIds: string[]; clubs: ClubRow[] }) {
  const { t } = useTranslation();
  const { user, session, loading: authLoading } = useAuth();
  const clubScope = JSON.stringify([...clubIds].sort());
  const context = useMemo(() => ({ clubScope, actorId: user?.id, hasSession: !!session?.access_token, authLoading }),
    [clubScope, user?.id, session?.access_token, authLoading]);
  const activeContext = useRef<object | null>(context);
  activeContext.current = context;
  const sequence = useRef(0);
  const [resultContext, setResultContext] = useState<object | null>(null);
  const [searchError, setSearchError] = useState(false);
  const [detailErrors, setDetailErrors] = useState<Record<string, boolean>>({});
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<MemberHit[] | null>(null);
  const [dealsByUser, setDealsByUser] = useState<Record<string, any[]>>({});
  const [profileLogsByUser, setProfileLogsByUser] = useState<Record<string, any[]>>({});
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  useEffect(() => {
    activeContext.current = context;
    return () => { if (activeContext.current === context) activeContext.current = null; };
  }, [context]);
  const visibleResults = resultContext === context ? results : null;
  const visibleBusy = resultContext === context && busy;
  const visibleError = resultContext === context && searchError;

  const clubName = (id?: string) => clubs.find((c) => c.id === id)?.name ?? "—";

  const search = async () => {
    const s = term.trim();
    if (s.length < 2) { toast.error("Nhập ít nhất 2 ký tự"); return; }
    if (authLoading || !user?.id || !session?.access_token || activeContext.current !== context) return;
    const request = ++sequence.current;
    const current = () => activeContext.current === context && sequence.current === request;
    setResultContext(context);
    setBusy(true); setResults(null); setDealsByUser({}); setProfileLogsByUser({});
    setSearchError(false); setDetailErrors({}); setExpandedLogs(new Set());
    const like = `%${s}%`;
    try {
    // 1) club_members scoped to cashier's clubs
    let cmHits: any[] = [];
    if (clubIds.length) {
      const { data, error } = await supabase
        .from("club_members")
        .select("id, club_id, member_card_id, full_name, phone, cccd, player_user_id")
        .in("club_id", clubIds)
        .or(`member_card_id.ilike.${like},full_name.ilike.${like},phone.ilike.${like},cccd.ilike.${like}`)
        .limit(30);
      if (error || !Array.isArray(data)) throw new Error("Member search unavailable");
      cmHits = data ?? [];
    }
    if (!current()) return;

    // 2) profiles fallback
    const { data: profs, error: profileError } = await supabase
      .from("profiles")
      .select("user_id, display_name, phone, avatar_url, verification_status")
      .or(`display_name.ilike.${like},phone.ilike.${like}`)
      .limit(20);
    if (profileError || !Array.isArray(profs)) throw new Error("Profile search unavailable");
    if (!current()) return;

    const merged: MemberHit[] = [
      ...cmHits.map((m) => ({ source: "club_member" as const, ...m })),
      ...(profs ?? []).map((p) => ({ source: "profile" as const, ...p })),
    ];
    // Dedup profile rows that already linked from club_member
    const linkedUserIds = new Set(cmHits.map((m) => m.player_user_id).filter(Boolean));
    const dedup = merged.filter((h) => h.source === "club_member" || !linkedUserIds.has(h.user_id));
    setResults(dedup);

    // Fetch active deals for each linked player
    const userIds = Array.from(new Set([
      ...cmHits.map((m) => m.player_user_id).filter(Boolean),
      ...(profs ?? []).map((p) => p.user_id),
    ]));
    const dealMap: Record<string, any[]> = {};
    const logMap: Record<string, any[]> = {};
    const errors: Record<string, boolean> = {};
      await Promise.all(userIds.map(async (uid) => {
        if (!current()) return;
        try {
        const [dealRes, logRes] = await Promise.all([
          supabase.functions.invoke("cashier-lookup-player", { body: { user_id: uid } }),
          (supabase as any).from("profile_update_log").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(5),
        ]);
      if (dealRes.error || dealRes.data?.error || !Array.isArray(dealRes.data?.deals)) errors[uid] = true;
      else dealMap[uid] = dealRes.data.deals;
      if (logRes.error || !Array.isArray(logRes.data)) errors[uid] = true;
      else logMap[uid] = logRes.data;
        } catch { errors[uid] = true; }
    }));
    if (!current()) return;
    setDealsByUser(dealMap);
    setProfileLogsByUser(logMap);
    setDetailErrors(errors);
    } catch {
      if (current()) { setSearchError(true); setResults(null); }
    } finally {
      if (current()) setBusy(false);
    }
  };

  const nav = useNavigate();
  const goStaking = (sub: "checkin" | "result", deal?: any) => {
    nav(`/cashier?tab=staking`);
    if (deal) toast.info(`Mở tab "${sub === "checkin" ? "Check-in" : "Kết quả & Giải ngân"}" — chọn deal #${String(deal.deal_id).slice(0, 6)}`);
  };

  return (
    <Card className="p-3 space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="Tên / SĐT / Mã thẻ / CCCD"
          value={term} onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <Button onClick={search} disabled={visibleBusy || authLoading} aria-label={t("common.search")}>
          {visibleBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        </Button>
      </div>

      {visibleBusy && <Skeleton className="h-32 rounded-lg" />}
      {visibleError && <p role="alert" className="text-sm text-destructive">{t("cashierLookup.searchUnavailable")}</p>}

      {!visibleBusy && !visibleError && visibleResults === null && <p className="text-xs text-muted-foreground">Tìm để hiển thị kết quả.</p>}
      {!visibleBusy && visibleResults !== null && visibleResults.length === 0 && (
        <p className="text-sm text-center text-muted-foreground py-6">Không tìm thấy thành viên</p>
      )}

      {!visibleBusy && visibleResults && visibleResults.length > 0 && (
        <div className="space-y-2">
          {visibleResults.map((h, i) => {
            const userId = h.player_user_id ?? h.user_id;
            const deals = userId ? dealsByUser[userId] ?? [] : [];
            const verified = h.verification_status === "verified";
            return (
              <div key={(h.member_card_id ?? h.user_id ?? "") + i} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-muted overflow-hidden flex items-center justify-center shrink-0">
                    {h.avatar_url
                      ? <img src={h.avatar_url} alt="" className="w-full h-full object-cover" />
                      : <UsersIcon className="w-4 h-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
                      {h.full_name ?? h.display_name ?? "—"}
                      {verified && <Badge className="bg-success/15 text-success border-success/40 text-[10px]">✓ Đã xác minh</Badge>}
                      {h.source === "club_member" && (
                        <Badge variant="outline" className="text-[10px]">CLB: {clubName(h.club_id)}</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
                      {h.member_card_id && <span className="inline-flex items-center gap-1"><IdCard className="w-3 h-3" />{h.member_card_id}</span>}
                      {h.phone && <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{h.phone}</span>}
                      {!h.player_user_id && h.source === "club_member" && (
                        <span className="text-warning">Chưa liên kết tài khoản Vin Poker</span>
                      )}
                    </div>
                  </div>
                  {userId && (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={`/player/${userId}`} target="_blank" rel="noreferrer">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </Button>
                  )}
                </div>

                {userId && detailErrors[userId] && <p role="alert" className="text-xs text-destructive">{t("cashierLookup.detailsUnavailable")}</p>}
                {deals.length > 0 && (
                  <div className="border-t pt-2 space-y-1.5">
                    <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                      <Coins className="w-3 h-3" /> Deal đang hoạt động ({deals.length})
                    </div>
                    {deals.map((d) => (
                      <div key={d.deal_id} className="flex items-center gap-2 text-xs bg-muted/40 rounded p-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{d.title}</div>
                          <div className="text-muted-foreground">
                            Buy-in: {formatVND(d.buy_in_vnd)} · Đã bán {d.filled_percent}/{d.sold_percent}% · {d.status}
                          </div>
                        </div>
                        {d.status === "funded" && !d.player_checked_in && (
                          <Button size="sm" variant="outline" onClick={() => goStaking("checkin", d)}>Check-in</Button>
                        )}
                        {(d.status === "funded" || d.player_checked_in) && (
                          <Button size="sm" onClick={() => goStaking("result", d)}>Nhập kết quả</Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {userId && (profileLogsByUser[userId]?.length ?? 0) > 0 && (
                  <div className="border-t pt-2">
                    <button
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
                      onClick={() => {
                        const key = userId;
                        setExpandedLogs((prev) => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key); else next.add(key);
                          return next;
                        });
                      }}
                    >
                      {expandedLogs.has(userId) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      <History className="w-3 h-3" /> Lịch sử cập nhật hồ sơ ({profileLogsByUser[userId].length})
                    </button>
                    {expandedLogs.has(userId) && (
                      <div className="mt-1.5 space-y-1">
                        {profileLogsByUser[userId].map((log: any) => (
                          <div key={log.id} className="text-[11px] bg-muted/30 rounded p-1.5">
                            <span className="text-muted-foreground">{new Date(log.created_at).toLocaleDateString("vi-VN")}</span>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {(log.changed_fields as string[]).map((f: string) => (
                                <span key={f} className="text-[10px] px-1 rounded bg-primary/10 text-primary">{f}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
