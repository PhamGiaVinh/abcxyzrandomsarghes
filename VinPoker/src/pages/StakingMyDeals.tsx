import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatVND, formatDateTime } from "@/lib/format";
import { Sparkles, Clock, AlertCircle, CheckCircle2, XCircle, Trash2, Plus, Loader2, Star } from "lucide-react";
import { RatingDialog } from "@/components/RatingDialog";
import { PlayerCheckInQR } from "@/components/PlayerCheckInQR";
import { ResultQRDialog } from "@/components/ResultQRDialog";

type DealStatus =
  | "listing" | "committed" | "funded"
  | "result_entered" | "result_verified" | "result_disputed"
  | "release_requested" | "cosigned" | "completed"
  | "locked" | "released" | "disputed" | "cancelled";

interface Deal {
  id: string;
  player_id: string;
  backer_id: string | null;
  tournament_id: string | null;
  custom_event_name: string | null;
  custom_event_date: string | null;
  buy_in_amount_vnd: number;
  percentage_sold: number;
  markup: number;
  asking_price_vnd: number;
  escrow_amount_vnd: number;
  escrow_bank_reference: string;
  status: DealStatus;
  admin_review_status: "pending" | "approved" | "rejected";
  admin_review_note: string | null;
  result_prize_vnd: number | null;
  placement: string | null;
  result_proof_url: string | null;
  player_payout_vnd: number | null;
  backer_payout_vnd: number | null;
  platform_fee_vnd: number | null;
  player_confirmed_release: boolean;
  backer_confirmed_release: boolean;
  description: string | null;
  created_at: string;
  completed_at?: string | null;
  tournament?: { name: string; start_time: string } | null;
  backer?: { display_name: string | null; avatar_url: string | null } | null;
}

// A: listing | B: committed | C: funded (đang thi đấu, nhập kết quả)
// D: result_entered/verified/disputed/release_requested/cosigned/locked/disputed (chờ giải ngân)
// E: completed/released/cancelled
type TabKey = "A" | "B" | "C" | "D" | "E";

const useStatusLabel = () => {
  const { t } = useTranslation();
  const map: Record<DealStatus, { label: string; tone: string }> = {
    listing: { label: t("myDeals.status.listing", { defaultValue: "Chờ duyệt / Đang mở hợp tác" }), tone: "text-primary" },
    committed: { label: t("myDeals.status.committed", { defaultValue: "Đã có người hỗ trợ" }), tone: "text-warning" },
    funded: { label: t("myDeals.status.funded", { defaultValue: "Đang tham gia tập huấn" }), tone: "text-success" },
    result_entered: { label: t("myDeals.status.result_entered", { defaultValue: "Đã báo cáo thành tích — chờ admin" }), tone: "text-warning" },
    result_verified: { label: t("myDeals.status.result_verified", { defaultValue: "Đã xác nhận — chờ thanh toán hợp tác" }), tone: "text-primary" },
    result_disputed: { label: t("myDeals.status.result_disputed", { defaultValue: "Yêu cầu kiểm tra thành tích" }), tone: "text-destructive" },
    release_requested: { label: t("myDeals.status.release_requested", { defaultValue: "Chờ admin đồng ký" }), tone: "text-warning" },
    cosigned: { label: t("myDeals.status.cosigned", { defaultValue: "Đã đồng ký — chờ thanh toán" }), tone: "text-primary" },
    completed: { label: t("myDeals.status.completed", { defaultValue: "Đã thanh toán hợp tác" }), tone: "text-success" },
    locked: { label: t("myDeals.status.locked", { defaultValue: "Đang chờ thành tích" }), tone: "text-warning" },
    released: { label: t("myDeals.status.released", { defaultValue: "Đã thanh toán hợp tác" }), tone: "text-success" },
    disputed: { label: t("myDeals.status.disputed", { defaultValue: "Yêu cầu kiểm tra" }), tone: "text-destructive" },
    cancelled: { label: t("myDeals.status.cancelled", { defaultValue: "Đã huỷ" }), tone: "text-muted-foreground" },
  };
  return map;
};

const MyDeals = () => {
  const { user, loading } = useAuth();
  return <MyDealsScope key={`${loading ? 'loading' : 'ready'}:${user?.id ?? 'signed-out'}`} />;
};

const MyDealsScope = () => {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const nav = useNavigate();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [ratedDealIds, setRatedDealIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<TabKey>("A");
  const active = useRef(true);
  const loadGeneration = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; loadGeneration.current += 1; };
  }, []);

  useEffect(() => {
    if (!authLoading && !user) nav("/auth");
  }, [authLoading, user, nav]);

  const load = useCallback(async () => {
    if (!user || authLoading || !active.current) return;
    const generation = ++loadGeneration.current;
    const current = () => active.current && generation === loadGeneration.current;
    setLoading(true);
    setLoadError(false);
    try {
    const { data, error } = await supabase
      .from("staking_deals")
      .select("*")
      .eq("player_id", user.id)
      .order("created_at", { ascending: false });
    if (!current()) return;
    if (error) throw error;
    const rows = (data ?? []) as Deal[];
    const tIds = Array.from(new Set(rows.map((d) => d.tournament_id).filter(Boolean) as string[]));
    const bIds = Array.from(new Set(rows.map((d) => d.backer_id).filter(Boolean) as string[]));
    const [tRes, bRes] = await Promise.all([
      tIds.length
        ? supabase.from("tournaments").select("id, name, start_time").in("id", tIds)
        : Promise.resolve({ data: [] } as any),
      bIds.length
        ? supabase.from("profiles").select("user_id, display_name, avatar_url").in("user_id", bIds)
        : Promise.resolve({ data: [] } as any),
    ]);
    if (!current()) return;
    if (tRes.error) throw tRes.error;
    if (bRes.error) throw bRes.error;
    const tMap = new Map<string, any>((tRes.data ?? []).map((t: any) => [t.id, t]));
    const bMap = new Map<string, any>((bRes.data ?? []).map((p: any) => [p.user_id, p]));
    setDeals(rows.map((d) => ({
      ...d,
      tournament: d.tournament_id ? tMap.get(d.tournament_id) ?? null : null,
      backer: d.backer_id ? bMap.get(d.backer_id) ?? null : null,
    })));
    // Load my ratings for these deals
    const dealIds = rows.map((d) => d.id);
    if (dealIds.length) {
      const { data: rated, error: ratingError } = await supabase.from("deal_ratings")
        .select("deal_id").eq("rater_id", user.id).in("deal_id", dealIds);
      if (!current()) return;
      if (ratingError) throw ratingError;
      setRatedDealIds(new Set((rated ?? []).map((r: any) => r.deal_id)));
    } else {
      setRatedDealIds(new Set());
    }
    } catch {
      if (current()) setLoadError(true);
    } finally {
      if (current()) setLoading(false);
    }
  }, [user, authLoading]);

  useEffect(() => { load(); }, [load]);

  // Realtime: refresh on any change to my deals
  useEffect(() => {
    if (!user || authLoading) return;
    const ch = supabase
      .channel(`my-deals-${user.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "staking_deals", filter: `player_id=eq.${user.id}` },
        () => load()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, authLoading, load]);

  const grouped = useMemo(() => {
    const g: Record<TabKey, Deal[]> = { A: [], B: [], C: [], D: [], E: [] };
    const nowMs = Date.now();
    deals.forEach((d) => {
      if (d.status === "listing") {
        // Auto-hide from "Đang bán" if registration deadline đã qua mà filled = 0%
        const filled = Number((d as any).filled_percent ?? 0);
        const deadlineRaw = (d as any).registration_deadline;
        const deadlineMs = deadlineRaw ? new Date(deadlineRaw).getTime() : null;
        const closedWithNoSale =
          filled <= 0 && deadlineMs !== null && !isNaN(deadlineMs) && deadlineMs <= nowMs;
        if (!closedWithNoSale) g.A.push(d);
      }
      else if (d.status === "committed") g.B.push(d);
      // Tab C: Đang thi đấu — funded (player nhập kết quả tại đây)
      else if (d.status === "funded") g.C.push(d);
      // Tab D: Chờ giải ngân — từ result_entered tới cosigned
      else if (
        d.status === "result_entered" ||
        d.status === "result_verified" ||
        d.status === "result_disputed" ||
        d.status === "release_requested" ||
        d.status === "cosigned" ||
        d.status === "locked" ||
        d.status === "disputed"
      ) g.D.push(d);
      else if (d.status === "completed" || d.status === "released" || d.status === "cancelled") g.E.push(d);
    });
    return g;
  }, [deals]);

  // Reading this page must not delete expired listings or their history.
  // Explicit cancellation remains a separate user action below.

  const handleCancel = async (deal: Deal) => {
    if (deal.status !== "listing" || deal.backer_id) {
      toast.error(t("myDeals.cantCancelOnlyListing"));
      return;
    }
    if (!confirm(t("myDeals.confirmCancel"))) return;
    const { error } = await supabase
      .from("staking_deals")
      .delete()
      .eq("id", deal.id)
      .eq("player_id", user!.id)
      .eq("status", "listing")
      .is("backer_id", null);
    if (error) { toast.error(error.message); return; }
    toast.success(t("myDeals.cancelledToast"));
    load();
  };

  if (authLoading) return <div className="staking-scope text-muted-foreground">{t("myDeals.loading")}</div>;
  if (loadError) return (
    <Alert role="alert" className="staking-scope">
      <AlertDescription>Không tải được danh sách deal. Chưa thể xác minh dữ liệu và thao tác.</AlertDescription>
      <Button variant="outline" onClick={() => void load()}>Thử tải lại deal</Button>
    </Alert>
  );

  return (
    <div className="staking-scope space-y-6">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h1 className="text-2xl md:text-3xl font-display font-bold">{t("myDeals.title")}</h1>
        </div>
        <div className="flex items-center gap-2">
          {user?.id && <PlayerCheckInQR userId={user.id} variant="button" />}
          <Link to="/staking/new">
            <Button className="gradient-neon text-primary-foreground font-bold tracking-wide shadow-neon">
              <Plus className="w-4 h-4 mr-1" /> {t("myDeals.newDeal")}
            </Button>
          </Link>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="grid w-full grid-cols-3 md:grid-cols-5 h-auto gap-1 p-1">
          <TabsTrigger value="A" className="h-auto py-2 px-2 text-[11px] md:text-sm leading-tight whitespace-normal flex flex-col items-center gap-0.5">
            <span>{t("myDeals.tabA")}</span>
            <CountBadge n={grouped.A.length} />
          </TabsTrigger>
          <TabsTrigger value="B" className="h-auto py-2 px-2 text-[11px] md:text-sm leading-tight whitespace-normal flex flex-col items-center gap-0.5">
            <span>{t("myDeals.tabB")}</span>
            <CountBadge n={grouped.B.length} />
          </TabsTrigger>
          <TabsTrigger value="C" className="h-auto py-2 px-2 text-[11px] md:text-sm leading-tight whitespace-normal flex flex-col items-center gap-0.5">
            <span>{t("myDeals.tabC")}</span>
            <CountBadge n={grouped.C.length} />
          </TabsTrigger>
          <TabsTrigger value="D" className="h-auto py-2 px-2 text-[11px] md:text-sm leading-tight whitespace-normal flex flex-col items-center gap-0.5">
            <span className="md:hidden">{t("myDeals.tabDShort", "Chờ thanh toán")}</span>
            <span className="hidden md:inline">{t("myDeals.tabD")}</span>
            <CountBadge n={grouped.D.length} />
          </TabsTrigger>
          <TabsTrigger value="E" className="col-span-2 md:col-span-1 h-auto py-2 px-2 text-[11px] md:text-sm leading-tight whitespace-normal flex flex-col items-center gap-0.5">
            <span>{t("myDeals.tabE")}</span>
            <CountBadge n={grouped.E.length} />
          </TabsTrigger>
        </TabsList>

        {(["A","B","C","D","E"] as TabKey[]).map((k) => (
          <TabsContent key={k} value={k} className="mt-4 space-y-3">
            {loading ? (
              <Skeleton className="h-32 rounded-xl" />
            ) : grouped[k].length === 0 ? (
              <Empty tab={k} />
            ) : (
              grouped[k].map((d) => (
                <DealRow
                  key={d.id}
                  deal={d}
                  tab={k}
                  onCancel={() => handleCancel(d)}
                  hasRated={ratedDealIds.has(d.id)}
                  onRated={load}
                />
              ))
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

const CountBadge = ({ n }: { n: number }) => (
  <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">{n}</span>
);

const Empty = ({ tab }: { tab: TabKey }) => {
  const { t } = useTranslation();
  const msg: Record<TabKey, string> = {
    A: t("myDeals.emptyA"),
    B: t("myDeals.emptyB"),
    C: t("myDeals.emptyC"),
    D: t("myDeals.emptyD"),
    E: t("myDeals.emptyE"),
  };
  return (
    <div className="text-center py-12 rounded-xl border border-dashed border-border bg-card/30 text-sm text-muted-foreground">
      {msg[tab]}
    </div>
  );
};

const DealRow = ({
  deal, tab, onCancel, hasRated, onRated,
}: {
  deal: Deal;
  tab: TabKey;
  onCancel: () => void;
  hasRated?: boolean;
  onRated?: () => void;
}) => {
  const { t } = useTranslation();
  const STATUS_LABEL = useStatusLabel();
  const tournamentName = deal.tournament?.name ?? deal.custom_event_name ?? t("myDeals.customEvent");
  const dateIso = deal.tournament?.start_time ?? deal.custom_event_date;
  const status = STATUS_LABEL[deal.status];
  const reviewBadge = deal.admin_review_status === "pending"
    ? { label: t("myDeals.reviewPending"), tone: "border-warning/50 text-warning" }
    : deal.admin_review_status === "rejected"
    ? { label: t("myDeals.reviewRejected"), tone: "border-destructive/50 text-destructive" }
    : { label: t("myDeals.reviewApproved"), tone: "border-success/50 text-success" };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold truncate">{tournamentName}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {dateIso ? formatDateTime(dateIso) : "—"}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className={reviewBadge.tone}>{reviewBadge.label}</Badge>
          <Badge variant="outline" className={`border-current ${status.tone}`}>{status.label}</Badge>
        </div>
      </div>

      {/* Deal numbers */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <Stat k="Lệ phí tập huấn" v={formatVND(deal.buy_in_amount_vnd)} />
        <Stat k="% mời hỗ trợ" v={`${deal.percentage_sold}%`} />
        <Stat k="Hệ số hỗ trợ" v={`${Number(deal.markup).toFixed(2)}x`} />
        <Stat k="Người hỗ trợ trả" v={formatVND(deal.asking_price_vnd)} primary />
      </div>

      {/* Backer info if any */}
      {deal.backer && (
        <div className="flex items-center gap-2 text-xs p-2 rounded-lg bg-background/40 border border-border">
          <Avatar className="w-7 h-7">
            <AvatarImage src={deal.backer.avatar_url ?? undefined} />
            <AvatarFallback>{(deal.backer.display_name ?? "B").slice(0,2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="text-muted-foreground">Backer:</span>
          <span className="font-semibold">{deal.backer.display_name ?? "—"}</span>
        </div>
      )}

      {/* Tab-specific content */}
      {tab === "A" && (
        <TabAContent deal={deal} onCancel={onCancel} />
      )}
      {tab === "B" && <TabBContent deal={deal} />}
      {tab === "C" && <TabCContent deal={deal} />}
      {tab === "D" && <TabDContent deal={deal} />}
      {tab === "E" && <TabEContent deal={deal} hasRated={!!hasRated} onRated={onRated} />}
    </div>
  );
};

const Stat = ({ k, v, primary }: { k: string; v: string; primary?: boolean }) => (
  <div className="space-y-0.5">
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
    <div className={`font-semibold text-sm ${primary ? "text-primary" : ""}`}>{v}</div>
  </div>
);

const TabAContent = ({ deal, onCancel }: { deal: Deal; onCancel: () => void }) => {
  const filled = (deal as any).filled_percent ?? 0;
  const sold = deal.percentage_sold;
  const earlyClosed = !!(deal as any).early_closed;
  const [closing, setClosing] = useState(false);

  const handleCloseEarly = async () => {
    if (filled <= 0) {
      toast.error("Chưa có Backer nào — bạn nên huỷ deal thay vì đóng sớm.");
      return;
    }
    if (!confirm(`Đóng deal sớm với ${filled}/${sold}% đã bán? Sẽ không nhận thêm Backer mới.`)) return;
    setClosing(true);
    const { data, error } = await supabase.functions.invoke("staking-close-early", { body: { deal_id: deal.id } });
    setClosing(false);
    if (error) { toast.error(error.message); return; }
    if ((data as any)?.error) { toast.error((data as any).error); return; }
    toast.success("Đã đóng deal sớm");
  };

  return (
    <div className="space-y-2">
      {deal.admin_review_status === "rejected" && deal.admin_review_note && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Lý do từ chối: {deal.admin_review_note}
          </AlertDescription>
        </Alert>
      )}
      {deal.admin_review_status === "pending" && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" /> Đang chờ Super Admin duyệt — chưa hiển thị trên Sàn.
        </p>
      )}
      {deal.admin_review_status === "approved" && (
        <div className="space-y-2">
          <p className="text-xs text-success flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> Đang hiển thị trên Sàn — đã bán {filled}/{sold}%.
          </p>
          <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
            <div className="h-full gradient-neon" style={{ width: `${Math.round((filled / Math.max(1, sold)) * 100)}%` }} />
          </div>
          {(deal as any).registration_deadline && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" /> Đóng đăng ký: <span className="font-semibold text-foreground">{formatDateTime((deal as any).registration_deadline)}</span>
            </p>
          )}
          {earlyClosed && (
            <p className="text-[11px] text-warning">Đã đóng sớm — chỉ chờ các Backer hiện tại hoàn tất chuyển khoản.</p>
          )}
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {deal.admin_review_status === "approved" && !earlyClosed && filled > 0 && filled < sold && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleCloseEarly}
            disabled={closing}
            className="text-warning border-warning/40 hover:bg-warning/10"
          >
            {closing ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
            Đóng deal sớm ({filled}%)
          </Button>
        )}
        {filled === 0 && (
          <Button variant="outline" size="sm" onClick={onCancel} className="text-destructive border-destructive/40 hover:bg-destructive/10">
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Huỷ deal
          </Button>
        )}
      </div>
    </div>
  );
};

const TabBContent = ({ deal }: { deal: Deal }) => {
  const startedAt = (deal as any).committed_at ? new Date((deal as any).committed_at).getTime() : new Date(deal.created_at).getTime();
  const deadline = startedAt + 30 * 60 * 1000;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const remaining = Math.max(0, deadline - now);
  const expired = remaining <= 0;
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const proofSubmitted = (deal as any).transfer_proof_submitted === true;

  return (
    <Alert className={expired ? "border-destructive/40 bg-destructive/5" : "border-warning/40 bg-warning/5"}>
      <Clock className={`h-4 w-4 ${expired ? "text-destructive" : "text-warning"}`} />
      <AlertDescription className="text-xs space-y-1">
        <div>
          Backer đã giữ chỗ và đang chuyển khoản <b>{formatVND(deal.escrow_amount_vnd)}</b> vào escrow
          (mã <code className="text-primary font-mono">VINPoker {deal.escrow_bank_reference}</code>).
          Tiền sẽ tự động khóa khi Admin xác nhận.
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Badge variant="outline" className={expired ? "border-destructive/50 text-destructive" : "border-warning/50 text-warning"}>
            {expired ? "Hết hạn CK" : `Còn ${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`}
          </Badge>
          <Badge variant="outline" className={proofSubmitted ? "border-success/50 text-success" : "border-muted text-muted-foreground"}>
            Biên lai: {proofSubmitted ? "đã gửi" : "chưa"}
          </Badge>
        </div>
        {expired && !proofSubmitted && (
          <p className="text-destructive">
            ⚠️ Backer chưa hoàn tất chuyển khoản đúng hạn. Deal có thể bị tự động huỷ — vui lòng đợi Admin xử lý.
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
};

const TabCContent = ({ deal }: { deal: Deal }) => {
  const [open, setOpen] = useState(false);
  const checkedIn = !!(deal as any).player_checked_in;
  const checkinAt = (deal as any).player_checkin_at as string | null | undefined;
  return (
    <div className="space-y-2">
      {checkedIn ? (
        <Alert className="border-success/40 bg-success/5">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <AlertDescription className="text-xs">
            ✅ Đã check-in tại CLB{checkinAt ? ` (${formatDateTime(checkinAt)})` : ""} — Đang thi đấu. Sau khi giải kết thúc, nhập kết quả tại đây.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="border-warning/40 bg-warning/5">
          <Clock className="h-4 w-4 text-warning" />
          <AlertDescription className="text-xs">
            ⏳ Chờ check-in tại CLB — Bạn cần đến quầy thanh toán phần còn thiếu (nếu có) để Cashier check-in vào giải.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex justify-end gap-2">
        <PlayerCheckInQR userId={deal.player_id} variant="button" />
        <Button
          size="sm"
          onClick={() => setOpen(true)}
          disabled={!checkedIn}
          title={!checkedIn ? "Cần check-in tại CLB trước khi nhập kết quả" : undefined}
          className="gradient-neon text-primary-foreground font-bold disabled:opacity-50"
        >
          Nhập kết quả
        </Button>
      </div>
      {checkedIn && <ResultEntryModal deal={deal} open={open} onOpenChange={setOpen} />}
    </div>
  );
};

const TabDContent = ({ deal }: { deal: Deal }) => {
  const hasResult = deal.result_prize_vnd != null;
  const isDisputed = deal.status === "result_disputed" || deal.status === "disputed";
  const [showQR, setShowQR] = useState(false);

  return (
    <div className="space-y-2">
      {!hasResult && (
        <Alert className="border-warning/40 bg-warning/5">
          <Clock className="h-4 w-4 text-warning" />
          <AlertDescription className="text-xs">
            Chờ admin xử lý...
          </AlertDescription>
        </Alert>
      )}
      {hasResult && (
        <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-xs space-y-1.5">
          <div className="font-semibold text-success flex flex-wrap items-center gap-2">
            Kết quả: {deal.placement ?? "—"}
            {deal.status === "result_entered" && <Badge variant="outline" className="border-warning/50 text-warning">Chờ Lễ tân xác nhận</Badge>}
            {deal.status === "result_verified" && <Badge variant="outline" className="border-primary/50 text-primary">Đã xác nhận</Badge>}
            {deal.status === "release_requested" && <Badge variant="outline" className="border-warning/50 text-warning">Chờ admin đồng ký</Badge>}
            {deal.status === "cosigned" && <Badge variant="outline" className="border-primary/50 text-primary">Đang chuyển khoản</Badge>}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stat k="Phần thưởng" v={formatVND(Number(deal.result_prize_vnd ?? 0))} />
            <Stat k="Bạn nhận" v={formatVND(Number(deal.player_payout_vnd ?? 0))} primary />
            <Stat k="Người hỗ trợ nhận" v={formatVND(Number(deal.backer_payout_vnd ?? 0))} />
          </div>
          {deal.result_proof_url && (
            <a href={deal.result_proof_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              Xem ảnh kết quả
            </a>
          )}

          {deal.status === "result_entered" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowQR(true)}
              className="w-full mt-2 border-primary/50 text-primary hover:bg-primary/10"
            >
              📱 Hiện lại mã xác nhận cho Lễ tân
            </Button>
          )}
        </div>
      )}

      {isDisputed && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Kết quả đang bị Admin gắn cờ tranh chấp. Vui lòng liên hệ admin để cung cấp bằng chứng bổ sung.
          </AlertDescription>
        </Alert>
      )}

      <ResultQRDialog dealId={showQR ? deal.id : null} onClose={() => setShowQR(false)} />
    </div>
  );
};

const TabEContent = ({ deal, hasRated, onRated }: { deal: Deal; hasRated?: boolean; onRated?: () => void }) => {
  const [open, setOpen] = useState(false);
  if (deal.status === "cancelled") {
    return (
      <Alert>
        <XCircle className="h-4 w-4" />
        <AlertDescription className="text-xs">Deal đã bị huỷ.</AlertDescription>
      </Alert>
    );
  }
  const completedAt = deal.completed_at ? new Date(deal.completed_at).getTime() : null;
  const within7Days = completedAt ? (Date.now() - completedAt) < 7 * 24 * 60 * 60 * 1000 : false;
  const canRate = deal.status === "completed" && within7Days && !hasRated;

  return (
    <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-xs space-y-2">
      <div className="font-semibold text-success flex items-center gap-1">
        <CheckCircle2 className="w-3.5 h-3.5" /> Đã giải ngân hoàn tất
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat k="Prize" v={formatVND(Number(deal.result_prize_vnd ?? 0))} />
        <Stat k="Bạn nhận" v={formatVND(Number(deal.player_payout_vnd ?? 0))} primary />
        <Stat k="Backer nhận" v={formatVND(Number(deal.backer_payout_vnd ?? 0))} />
      </div>
      {deal.status === "completed" && (
        <div className="flex justify-end pt-1">
          {hasRated ? (
            <Badge variant="outline" className="border-success/50 text-success">
              <Star className="w-3 h-3 mr-1 fill-current" /> Đã đánh giá
            </Badge>
          ) : canRate ? (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <Star className="w-3.5 h-3.5 mr-1" /> Đánh giá Backer
            </Button>
          ) : (
            <span className="text-muted-foreground">Đã quá 7 ngày để đánh giá.</span>
          )}
        </div>
      )}
      <RatingDialog
        open={open}
        onOpenChange={setOpen}
        dealId={deal.id}
        counterpartyName={deal.backer?.display_name ?? "Backer"}
        onSubmitted={onRated}
      />
    </div>
  );
};

/* ---------------- Result Entry Modal ---------------- */
const ResultEntryModal = ({
  deal, open, onOpenChange,
}: { deal: Deal; open: boolean; onOpenChange: (o: boolean) => void }) => {
  const { user } = useAuth();
  const [prize, setPrize] = useState<string>("");
  const [placement, setPlacement] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [qrDealId, setQrDealId] = useState<string | null>(null);

  useEffect(() => { if (!open) { setPrize(""); setPlacement(""); setFile(null); } }, [open]);

  const prizeNum = Math.max(0, Math.floor(Number(prize.replace(/[^\d]/g, "")) || 0));
  const fundedPct = Number((deal as any).filled_percent ?? deal.percentage_sold);
  const archiveFee = Number((deal as any).platform_archive_fee ?? 199000);
  const platformFee = prizeNum > 0 ? Math.min(archiveFee, prizeNum) : 0;
  const distributable = Math.max(0, prizeNum - platformFee);
  const backerPayout = Math.round((distributable * fundedPct) / 100);
  const playerKeeps = Math.max(0, distributable - backerPayout);
  const isBust = prizeNum === 0;

  const submit = async () => {
    if (!user) return;
    if (!placement.trim()) { toast.error("Nhập thứ hạng"); return; }
    if (placement.length > 50) { toast.error("Thứ hạng tối đa 50 ký tự"); return; }
    if (!file) { toast.error("Tải ảnh kết quả lên"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Ảnh tối đa 5MB"); return; }
    if (!["image/jpeg","image/png","image/webp"].includes(file.type)) { toast.error("Chỉ JPG/PNG/WEBP"); return; }
    setSubmitting(true);
    try {
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `${user.id}/${deal.id}-${Date.now()}.${ext}`;
      const up = await supabase.storage.from("tournament-results").upload(path, file, {
        contentType: file.type, cacheControl: "3600", upsert: false,
      });
      if (up.error) throw up.error;
      const signed = await supabase.storage.from("tournament-results").createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error("Không tạo được signed URL");

      const { data, error } = await supabase.functions.invoke("staking-enter-result", {
        body: {
          deal_id: deal.id,
          prize_amount: prizeNum,
          placement: placement.trim(),
          proof_url: signed.data.signedUrl,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("✅ Đã gửi kết quả — Vui lòng đưa mã QR cho Cashier để xác minh");
      onOpenChange(false);
      // Open QR dialog for cashier to scan
      setTimeout(() => setQrDealId(deal.id), 200);
    } catch (e: any) {
      toast.error(e?.message ?? "Có lỗi xảy ra");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nhập kết quả giải đấu</DialogTitle>
          <DialogDescription className="text-xs">
            Nhập chính xác. Sai kết quả sẽ bị gắn cờ tranh chấp và tài khoản có thể bị khoá.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Tổng tiền thưởng (VND)</Label>
            <Input
              inputMode="numeric"
              value={prize}
              onChange={(e) => setPrize(e.target.value)}
              placeholder="0"
              className="text-2xl h-14 font-bold"
            />
          </div>
          <div>
            <Label className="text-xs">Thứ hạng</Label>
            <Input value={placement} onChange={(e) => setPlacement(e.target.value)} placeholder="Ví dụ: 1st, 2nd, FT, Busted" maxLength={50} />
          </div>
          <div>
            <Label className="text-xs">Ảnh chụp bảng xếp hạng / biên lai (≤5MB)</Label>
            <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>

          <div className="rounded-lg border border-border bg-card/50 p-3 text-xs space-y-2">
            <div className="font-semibold text-muted-foreground">Phân chia tự động</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded p-2 bg-success/10 border border-success/30">
                <div className="text-[10px] uppercase text-muted-foreground">Backer nhận ({fundedPct}%)</div>
                <div className="font-bold text-success">{formatVND(backerPayout)}</div>
              </div>
              <div className="rounded p-2 bg-primary/10 border border-primary/30">
                <div className="text-[10px] uppercase text-muted-foreground">Bạn giữ</div>
                <div className="font-bold text-primary">{formatVND(playerKeeps)}</div>
              </div>
            </div>
            <div className="flex justify-between items-center text-[11px] text-muted-foreground border-t border-border/50 pt-2">
              <span>Phí lưu trữ hồ sơ</span>
              <span className="font-semibold">{formatVND(platformFee)}</span>
            </div>
            {isBust && (
              <div className="text-warning text-[11px]">⚠️ Busted — Backer không nhận lại gì từ prize.</div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Huỷ / Nhập sau</Button>
          <Button onClick={submit} disabled={submitting} className="gradient-neon text-primary-foreground font-bold">
            {submitting ? "Đang gửi..." : "Xác nhận kết quả"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ResultQRDialog dealId={qrDealId} onClose={() => setQrDealId(null)} />
    </>
  );
};

export default MyDeals;
