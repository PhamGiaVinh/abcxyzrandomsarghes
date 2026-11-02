import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { formatVND, formatDateTime } from "@/lib/format";
import { StakingTransferBankCard } from "@/components/StakingTransferBankCard";
import { TransferInstructions } from "@/components/TransferInstructions";
import { sessionReadEpoch } from '@/lib/sessionReadEpoch';
import { compressImage } from "@/lib/compressImage";
import {
  Wallet, ChevronDown, Clock, Upload, Eye, Loader2, ShieldCheck, XCircle, Star, TrendingUp, TrendingDown,
} from "lucide-react";
import { RatingDialog } from "@/components/RatingDialog";
import { Card, CardContent } from "@/components/ui/card";

interface PurchaseDeal {
  id: string;
  player_id: string;
  tournament_id: string | null;
  custom_event_name: string | null;
  custom_event_date: string | null;
  buy_in_amount_vnd: number;
  percentage_sold: number;
  filled_percent: number;
  markup: number;
  status: string;
  result_prize_vnd: number | null;
  escrow_locked_at: string | null;
  early_closed: boolean;
  completed_at: string | null;
  player_checked_in?: boolean | null;
  player_checkin_at?: string | null;
  tournament?: { name: string; start_time: string } | null;
  player?: { display_name: string | null; avatar_url: string | null } | null;
}

interface PayoutRecipientRow {
  id: string;
  amount_vnd: number;
  platform_fee_vnd: number;
  method: string;
  status: string;
  paid_at: string | null;
  confirmed_at: string | null;
  proof_image_url: string | null;
}

interface Purchase {
  id: string;
  deal_id: string;
  backer_id: string;
  percent: number;
  markup: number;
  amount_vnd: number;
  reference_code: string;
  transfer_proof_url: string | null;
  transfer_proof_submitted: boolean;
  status: "committed" | "funded" | "cancelled";
  committed_at: string;
  funded_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  deal?: PurchaseDeal | null;
  ledger?: { amount_vnd: number; proof_url: string | null; payout_method: string | null } | null;
  recipient?: PayoutRecipientRow | null;
}

type TabKey = "B" | "F" | "L" | "D";

const StakingPortfolio = () => {
  const { user, loading, session } = useAuth();
  return <StakingPortfolioScope key={`${loading ? 'loading' : 'ready'}:${user?.id ?? 'signed-out'}:${sessionReadEpoch(session)}`} />;
};

const StakingPortfolioScope = () => {
  const { user, loading: authLoading } = useAuth();
  const nav = useNavigate();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [ratedDealIds, setRatedDealIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<TabKey>("B");
  const [helperPurchase, setHelperPurchase] = useState<Purchase | null>(null);
  const active = useRef(true);
  const loadGeneration = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; loadGeneration.current += 1; };
  }, []);

  useEffect(() => { if (!authLoading && !user) nav("/auth"); }, [authLoading, user, nav]);

  const load = useCallback(async () => {
    if (!user || authLoading || !active.current) return;
    const generation = ++loadGeneration.current;
    const current = () => active.current && generation === loadGeneration.current;
    setLoading(true);
    setLoadError(false);
    try {
    const { data, error } = await supabase
      .from("staking_purchases")
      .select("*")
      .eq("backer_id", user.id)
      .order("committed_at", { ascending: false });
    if (!current()) return;
    if (error) throw error;
    const rows = (data ?? []) as unknown as Purchase[];
    const dIds = Array.from(new Set(rows.map((p) => p.deal_id)));
    const { data: deals, error: dealsError } = dIds.length
      ? await supabase
          .from("staking_deals")
          .select("id, player_id, tournament_id, custom_event_name, custom_event_date, buy_in_amount_vnd, percentage_sold, filled_percent, markup, status, result_prize_vnd, escrow_locked_at, early_closed, completed_at, player_checked_in, player_checkin_at")
          .in("id", dIds)
      : { data: [] as any[], error: null };
    if (!current()) return;
    if (dealsError) throw dealsError;
    const dealMap = new Map<string, any>((deals ?? []).map((d: any) => [d.id, d]));
    const tIds = Array.from(new Set((deals ?? []).map((d: any) => d.tournament_id).filter(Boolean) as string[]));
    const pIds = Array.from(new Set((deals ?? []).map((d: any) => d.player_id)));
    const [tRes, pRes] = await Promise.all([
      tIds.length ? supabase.from("tournaments").select("id, name, start_time").in("id", tIds) : Promise.resolve({ data: [] } as any),
      pIds.length ? supabase.from("profiles").select("user_id, display_name, avatar_url").in("user_id", pIds) : Promise.resolve({ data: [] } as any),
    ]);
    if (!current()) return;
    if (tRes.error) throw tRes.error;
    if (pRes.error) throw pRes.error;
    const tMap = new Map<string, any>((tRes.data ?? []).map((t: any) => [t.id, t]));
    const pMap = new Map<string, any>((pRes.data ?? []).map((p: any) => [p.user_id, p]));
    // Load ledger entries (VND payout details) for the backer's completed purchases
    const { data: ledger, error: ledgerError } = dIds.length
      ? await supabase
          .from("staking_ledger")
          .select("deal_id, amount_vnd, proof_url, payout_method, metadata")
          .in("deal_id", dIds)
          .eq("entry_type", "escrow_out_backer")
          .eq("user_id", user.id)
      : { data: [] as any[], error: null };
    if (!current()) return;
    if (ledgerError) throw ledgerError;
    // Map by purchase_id (stored in metadata)
    const ledgerByPurchase = new Map<string, any>();
    for (const l of (ledger ?? []) as any[]) {
      const pid = l?.metadata?.purchase_id;
      if (pid) {
        if (ledgerByPurchase.has(pid) || !Number.isSafeInteger(l.amount_vnd) || l.amount_vnd < 0) throw new Error('settlement_evidence_invalid');
        ledgerByPurchase.set(pid, l);
      }
    }
    // Load payout_recipients (fee breakdown + self-confirm) for this backer
    const { data: recipients, error: recipientError } = dIds.length
      ? await supabase
          .from("payout_recipients")
          .select("id, purchase_id, amount_vnd, platform_fee_vnd, method, status, paid_at, confirmed_at, proof_image_url")
          .in("deal_id", dIds)
          .eq("user_id", user.id)
      : { data: [] as any[], error: null };
    if (!current()) return;
    if (recipientError) throw recipientError;
    const recipientByPurchase = new Map<string, PayoutRecipientRow>();
    for (const r of (recipients ?? []) as any[]) {
      if (r.purchase_id) {
        if (recipientByPurchase.has(r.purchase_id) || !Number.isSafeInteger(r.amount_vnd) || r.amount_vnd < 0
          || !Number.isSafeInteger(r.platform_fee_vnd) || r.platform_fee_vnd < 0) throw new Error('settlement_evidence_invalid');
        recipientByPurchase.set(r.purchase_id, r);
      }
    }
    setPurchases(rows.map((p) => {
      const d = dealMap.get(p.deal_id) ?? null;
      const l = ledgerByPurchase.get(p.id) ?? null;
      const recipient = recipientByPurchase.get(p.id) ?? null;
      if (p.status === 'funded' && (d?.status === 'completed' || d?.status === 'released')
        && (!l || !recipient || l.deal_id !== p.deal_id || l.amount_vnd !== recipient.amount_vnd
          || !['paid', 'confirmed'].includes(recipient.status))) throw new Error('settlement_evidence_missing_or_conflicting');
      return {
        ...p,
        deal: d ? {
          ...d,
          tournament: d.tournament_id ? tMap.get(d.tournament_id) ?? null : null,
          player: pMap.get(d.player_id) ?? null,
        } : null,
        ledger: l ? { amount_vnd: l.amount_vnd, proof_url: l.proof_url, payout_method: l.payout_method } : null,
        recipient,
      };
    }));
    if (dIds.length) {
      const { data: rated, error: ratingError } = await supabase.from("deal_ratings")
        .select("deal_id").eq("rater_id", user.id).in("deal_id", dIds);
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

  useEffect(() => {
    if (!user || authLoading) return;
    const ch = supabase
      .channel(`portfolio-${user.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "staking_purchases", filter: `backer_id=eq.${user.id}` },
        () => load())
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "staking_deals" },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, authLoading, load]);

  const grouped = useMemo(() => {
    const g: Record<TabKey, Purchase[]> = { B: [], F: [], L: [], D: [] };
    purchases.forEach((p) => {
      const ds = p.deal?.status;
      if (p.status === "cancelled") g.D.push(p);
      else if (p.status === "committed") g.B.push(p);
      else if (p.status === "funded") {
        // F: funded purchase; deal still committing/committed/funded but not yet locked-result
        if (ds === "released" || ds === "completed") g.D.push(p);
        else if (ds === "locked" || ds === "disputed" || ds === "result_entered" || ds === "result_verified" || ds === "result_disputed" || ds === "release_requested" || ds === "cosigned") g.L.push(p);
        else g.F.push(p);
      }
    });
    return g;
  }, [purchases]);

  const summary = useMemo(() => {
    const funded = purchases.filter((p) => p.status === "funded");
    const totalStaked = funded.reduce((s, p) => s + (p.amount_vnd ?? 0), 0);
    let totalReturned = 0;
    let activeCount = 0;
    funded.forEach((p) => {
      const ds = p.deal?.status;
      if (ds === "completed" || ds === "released") {
        totalReturned += p.ledger!.amount_vnd;
      } else {
        activeCount += 1;
      }
    });
    const settledStaked = funded
      .filter((p) => p.deal?.status === "completed" || p.deal?.status === "released")
      .reduce((s, p) => s + (p.amount_vnd ?? 0), 0);
    const netPnl = totalReturned - settledStaked;
    return { totalStaked, totalReturned, netPnl, activeCount };
  }, [purchases]);

  if (authLoading) return <div className="staking-scope text-muted-foreground">Đang tải...</div>;
  if (loading) return <div className="staking-scope" aria-busy="true" aria-label="Đang tải danh mục backing"><Skeleton className="h-32 rounded-xl" /></div>;
  if (loadError) return (
    <Alert role="alert" className="staking-scope">
      <AlertDescription>Không tải được danh mục backing. Chưa thể xác minh số tiền và thao tác.</AlertDescription>
      <Button variant="outline" onClick={() => void load()}>Thử tải lại danh mục</Button>
    </Alert>
  );

  return (
    <div className="staking-scope space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-primary" />
          <h1 className="text-2xl md:text-3xl font-display font-bold">Danh mục backing của tôi</h1>
        </div>
        <Link to="/marketplace">
          <Button variant="outline" size="sm">Đến bảng thông báo hợp tác</Button>
        </Link>
      </header>

      {/* Summary card */}
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
          <SummaryStat label="Tổng hỗ trợ" value={formatVND(summary.totalStaked)} />
          <SummaryStat label="Đã nhận lại" value={formatVND(summary.totalReturned)} />
          <SummaryStat
            label="Kết quả hợp tác"
            value={`${summary.netPnl >= 0 ? "+" : ""}${formatVND(summary.netPnl)}`}
            tone={summary.netPnl >= 0 ? "success" : "destructive"}
            icon={summary.netPnl >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          />
          <SummaryStat label="Đang hỗ trợ" value={String(summary.activeCount)} />
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="B">Chờ chuyển <Count n={grouped.B.length} /></TabsTrigger>
          <TabsTrigger value="F">Đã khóa <Count n={grouped.F.length} /></TabsTrigger>
          <TabsTrigger value="L">Chờ kết quả <Count n={grouped.L.length} /></TabsTrigger>
          <TabsTrigger value="D">Hoàn tất <Count n={grouped.D.length} /></TabsTrigger>
        </TabsList>

        {(["B","F","L","D"] as TabKey[]).map((k) => (
          <TabsContent key={k} value={k} className="mt-4 space-y-3">
            {loading ? <Skeleton className="h-32 rounded-xl" />
              : grouped[k].length === 0
                ? <Empty tab={k} />
                : grouped[k].map((p) => (
                    <PortfolioRow key={p.id} purchase={p} tab={k}
                      hasRated={ratedDealIds.has(p.deal_id)}
                      onShowHelper={() => setHelperPurchase(p)}
                      onChanged={load} />
                  ))}
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={!!helperPurchase} onOpenChange={(o) => !o && setHelperPurchase(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Hướng dẫn chuyển khoản</DialogTitle></DialogHeader>
          {helperPurchase && (
            <TransferInstructions
              purchaseId={helperPurchase.id}
              dealId={helperPurchase.deal_id}
              amount={helperPurchase.amount_vnd}
              reference={helperPurchase.reference_code}
              committedAt={helperPurchase.committed_at}
              initialProofUrl={helperPurchase.transfer_proof_url}
              initialProofSubmitted={helperPurchase.transfer_proof_submitted}
              onMarkedTransferred={() => { setHelperPurchase(null); load(); }}
              onCancel={() => { setHelperPurchase(null); load(); }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const Count = ({ n }: { n: number }) => (
  <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">{n}</span>
);

const Empty = ({ tab }: { tab: TabKey }) => {
  const msg: Record<TabKey, string> = {
    B: "Bạn không có giữ chỗ nào đang chờ chuyển khoản.",
    F: "Chưa có khoản nào đã khóa trong escrow.",
    L: "Chưa có khoản nào đang chờ kết quả.",
    D: "Chưa có khoản nào hoàn tất.",
  };
  return <div className="text-center py-12 rounded-xl border border-dashed border-border bg-card/30 text-sm text-muted-foreground">{msg[tab]}</div>;
};

const useCountdown = (deadline: number) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const remaining = Math.max(0, deadline - now);
  return {
    remaining, expired: remaining <= 0,
    label: `${String(Math.floor(remaining / 60000)).padStart(2,"0")}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2,"0")}`,
  };
};

const PortfolioRow = ({
  purchase, tab, hasRated, onShowHelper, onChanged,
}: { purchase: Purchase; tab: TabKey; hasRated?: boolean; onShowHelper: () => void; onChanged: () => void }) => {
  const deal = purchase.deal;
  const tournamentName = deal?.tournament?.name ?? deal?.custom_event_name ?? "Sự kiện riêng";
  const dateIso = deal?.tournament?.start_time ?? deal?.custom_event_date;
  const [rateOpen, setRateOpen] = useState(false);
  // Completed returns are committed purchase evidence, never a gross-prize estimate.
  const myPayout = purchase.ledger?.amount_vnd ?? null;
  const completedAt = deal?.completed_at ? new Date(deal.completed_at).getTime() : null;
  const within7Days = completedAt ? (Date.now() - completedAt) < 7 * 24 * 60 * 60 * 1000 : false;
  const canRate = deal?.status === "completed" && purchase.status === "funded" && within7Days && !hasRated;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2">
          {deal?.player && (
            <Avatar className="w-8 h-8">
              <AvatarImage src={deal.player.avatar_url ?? undefined} />
              <AvatarFallback>{(deal.player.display_name ?? "P").slice(0,2).toUpperCase()}</AvatarFallback>
            </Avatar>
          )}
          <div className="min-w-0">
            <div className="font-semibold truncate">{tournamentName}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {deal?.player?.display_name ?? "—"} · {dateIso ? formatDateTime(dateIso) : "—"}
            </div>
          </div>
        </div>
        <PurchaseStatusBadge purchase={purchase} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <Stat k="% phần hợp tác" v={`${purchase.percent}%`} primary />
        <Stat k="Hệ số hỗ trợ" v={`${Number(purchase.markup).toFixed(2)}x`} />
        <Stat k="Bạn hỗ trợ" v={formatVND(purchase.amount_vnd)} />
        <Stat k="Lệ phí tập huấn" v={formatVND(deal?.buy_in_amount_vnd ?? 0)} />
      </div>

      {tab === "B" && <CommittedSection purchase={purchase} onShowHelper={onShowHelper} onChanged={onChanged} />}
      {tab === "F" && (
        <Alert className="border-success/40 bg-success/5">
          <ShieldCheck className="h-4 w-4 text-success" />
          <AlertDescription className="text-xs">
            Đã xác nhận — Tiền của bạn đã khóa trong escrow{purchase.funded_at ? ` lúc ${formatDateTime(purchase.funded_at)}` : ""}.
            {deal?.early_closed && <> Player đã đóng deal sớm với tổng {deal.filled_percent}%.</>}
            {deal?.player_checked_in && (
              <> · ✅ Player đã check-in tại CLB{deal.player_checkin_at ? ` (${formatDateTime(deal.player_checkin_at)})` : ""}.</>
            )}
          </AlertDescription>
        </Alert>
      )}
      {tab === "L" && (
        <Alert className="border-warning/40 bg-warning/5">
          <Clock className="h-4 w-4 text-warning" />
          <AlertDescription className="text-xs">
            Đang chờ kết quả từ Ban tổ chức...
          </AlertDescription>
        </Alert>
      )}
      {tab === "D" && (deal?.status === "released" || deal?.status === "completed") && purchase.status === "funded" && myPayout != null && (
        <ReleasedSection
          purchase={purchase}
          deal={deal}
          myPayout={myPayout}
          hasRated={hasRated}
          canRate={canRate}
          completedAt={completedAt}
          rateOpen={rateOpen}
          setRateOpen={setRateOpen}
          onChanged={onChanged}
        />
      )}
      {tab === "D" && purchase.status === "cancelled" && (
        <Alert className="border-muted bg-muted/20">
          <XCircle className="h-4 w-4" />
          <AlertDescription className="text-xs text-muted-foreground">
            Giữ chỗ này đã bị huỷ{purchase.cancellation_reason ? ` (${purchase.cancellation_reason})` : ""}.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

const PurchaseStatusBadge = ({ purchase }: { purchase: Purchase }) => {
  if (purchase.status === 'funded' && ['completed', 'released'].includes(purchase.deal?.status ?? '') && purchase.ledger && purchase.recipient)
    return <Badge variant="outline" className="border-success/50 text-success">Đã giải ngân</Badge>;
  const map: Record<string, { label: string; tone: string }> = {
    committed: { label: "Chờ chuyển", tone: "border-warning/50 text-warning" },
    funded: { label: "Đã khóa", tone: "border-success/50 text-success" },
    cancelled: { label: "Đã huỷ", tone: "border-muted text-muted-foreground" },
  };
  const m = map[purchase.status] ?? map.committed;
  return <Badge variant="outline" className={m.tone}>{m.label}</Badge>;
};

const Stat = ({ k, v, primary }: { k: string; v: string; primary?: boolean }) => (
  <div className="space-y-0.5">
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
    <div className={`font-semibold text-sm ${primary ? "text-primary" : ""}`}>{v}</div>
  </div>
);

const SummaryStat = ({
  label, value, tone, icon,
}: { label: string; value: string; tone?: "success" | "destructive"; icon?: React.ReactNode }) => {
  const colorClass = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-bold text-base flex items-center gap-1 ${colorClass}`}>
        {icon}{value}
      </div>
    </div>
  );
};

const CommittedSection = ({
  purchase, onShowHelper, onChanged,
}: { purchase: Purchase; onShowHelper: () => void; onChanged: () => void }) => {
  const { user } = useAuth();
  const startedAt = new Date(purchase.committed_at).getTime();
  const { label, expired } = useCountdown(startedAt + 30 * 60 * 1000);
  const [open, setOpen] = useState(true);
  const [uploading, setUploading] = useState(false);
  const uploadBusy=useRef(false);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0];
    if (!raw || !user) return;
    if(uploadBusy.current)return;
    if (!["image/jpeg","image/png","image/webp"].includes(raw.type)) { toast.error("Chỉ JPG/PNG/WEBP"); return; }
    if (raw.size > 5 * 1024 * 1024) { toast.error("Tối đa 5MB"); return; }
    uploadBusy.current=true;
    setUploading(true);
    try {
      const file = await compressImage(raw, { maxEdge: 1600, quality: 0.8 });
      if(!alive.current)return;
      const ext = file.type === "image/png" ? "png" : "jpg";
      const path = `${user.id}/transfer-proofs/${purchase.deal_id}-${purchase.id}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("staking-proofs")
        .upload(path, file, { upsert: false, contentType: file.type, cacheControl: "3600" });
      if(!alive.current)return;
      if (upErr) throw upErr;
      const { data: signed,error:signError } = await supabase.storage.from("staking-proofs").createSignedUrl(path, 60 * 60 * 24 * 365);
      if(!alive.current)return;
      if(signError||!signed?.signedUrl||!/^https?:\/\//i.test(signed.signedUrl))throw new Error('Chưa xác minh được liên kết biên lai. Chưa gửi cho Cashier.');
      const url = signed.signedUrl;
      const { data,error } = await supabase.from("staking_purchases")
        .update({ transfer_proof_url: url, transfer_proof_submitted: true })
        .eq("id", purchase.id).eq('deal_id',purchase.deal_id).eq('backer_id',user.id).eq('status','committed')
        .select('id,status,transfer_proof_url,transfer_proof_submitted');
      if(!alive.current)return;
      if (error) throw error;
      if(!data||data.length!==1||data[0].id!==purchase.id||data[0].status!=='committed'
        ||data[0].transfer_proof_url!==url||data[0].transfer_proof_submitted!==true)
        throw new Error('Chưa xác nhận được biên lai gắn với giao dịch. Hãy tải lại để kiểm tra.');
      toast.success("Đã upload biên lai");
      onChanged();
    } catch (e) {
      if(alive.current)toast.error(e instanceof Error?e.message:'Upload lỗi');
    } finally {
      uploadBusy.current=false;
      if(alive.current)setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-2">
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center justify-between gap-2 p-2 rounded-lg border border-warning/30 bg-warning/5 text-xs">
          <span className="flex items-center gap-2 flex-wrap">
            <Clock className="w-3.5 h-3.5 text-warning" />
            <span className="font-semibold">Thông tin chuyển khoản</span>
            <Badge variant="outline" className={expired ? "border-destructive/50 text-destructive" : "border-warning/50 text-warning"}>
              {expired ? "Hết hạn" : `Còn ${label}`}
            </Badge>
            <Badge variant="outline" className={purchase.transfer_proof_submitted ? "border-success/50 text-success" : "border-muted text-muted-foreground"}>
              {purchase.transfer_proof_submitted ? "Đã gửi biên lai ✅" : "Chưa gửi ❌"}
            </Badge>
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-3 pt-1">
        <StakingTransferBankCard purchaseId={purchase.id} dealId={purchase.deal_id}
          amount={purchase.amount_vnd} reference={purchase.reference_code} />

        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground">Số tiền:</span>
            <span className="font-bold text-primary">{formatVND(purchase.amount_vnd)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Nội dung CK:</span>
            <span className="font-mono font-bold text-primary">VINPoker {purchase.reference_code}</span></div>
        </div>

        <div className="flex flex-wrap gap-2">
          <input id={`up-${purchase.id}`} type="file" hidden disabled={uploading} accept="image/jpeg,image/png,image/webp" onChange={upload} />
          <Button asChild size="sm" variant="outline" className="flex-1" disabled={uploading}>
            <label htmlFor={`up-${purchase.id}`} className="cursor-pointer">
              {uploading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1" />}
              {purchase.transfer_proof_url ? "Tải lại biên lai" : "Upload biên lai"}
            </label>
          </Button>
          <Button size="sm" variant="ghost" onClick={onShowHelper} className="flex-1">
            <Eye className="w-3.5 h-3.5 mr-1" /> Xem hướng dẫn / Huỷ
          </Button>
        </div>

        {purchase.transfer_proof_url && (
          <a href={purchase.transfer_proof_url} target="_blank" rel="noreferrer">
            <img src={purchase.transfer_proof_url} alt="Biên lai" className="w-full max-h-40 object-contain rounded-md border border-border" />
          </a>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};

const ReleasedSection = ({
  purchase, deal, myPayout, hasRated, canRate, completedAt, rateOpen, setRateOpen, onChanged,
}: {
  purchase: Purchase;
  deal: PurchaseDeal | null | undefined;
  myPayout: number;
  hasRated?: boolean;
  canRate: boolean;
  completedAt: number | null;
  rateOpen: boolean;
  setRateOpen: (o: boolean) => void;
  onChanged: () => void;
}) => {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const r = purchase.recipient;
  const fee = Number(r?.platform_fee_vnd ?? 0);
  const grossPrize = Number(deal?.result_prize_vnd ?? 0);
  // Backer share = received + fee (because fee is deducted from the backer side per snapshot)
  const grossShare = (r ? Number(r.amount_vnd) : myPayout) + fee;
  const netReceived = r ? Number(r.amount_vnd) : myPayout;

  const onConfirm = async () => {
    if (!r) return;
    setConfirming(true);
    const { error } = await supabase
      .from("payout_recipients")
      .update({ confirmed_at: new Date().toISOString(), status: "confirmed" })
      .eq("id", r.id);
    setConfirming(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("portfolio.confirmReceiveOk", { defaultValue: "Đã xác nhận nhận tiền" }));
    onChanged();
  };

  return (
    <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-xs space-y-2">
      <div className="font-semibold text-success mb-1">{t("portfolio.released", { defaultValue: "Đã giải ngân" })}</div>
      <div className="space-y-1 rounded bg-background/60 p-2 border border-success/20">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("portfolio.dealPrize", { defaultValue: "Phần thắng deal:" })}</span>
          <span className="font-mono">{formatVND(grossPrize)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("portfolio.yourGrossShare", { defaultValue: "Phần của bạn ({{p}}%):", p: purchase.percent })}</span>
          <span className="font-mono">{formatVND(grossShare)}</span>
        </div>
        {fee > 0 && (
          <div className="flex justify-between text-warning">
            <span>{t("portfolio.platformFee", { defaultValue: "Phí lưu trữ hồ sơ:" })}</span>
            <span className="font-mono">− {formatVND(fee)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-success/20 pt-1">
          <span className="font-semibold">{t("portfolio.netReceive", { defaultValue: "Bạn thực nhận:" })}</span>
          <span className="font-mono font-bold text-success">{formatVND(netReceived)}</span>
        </div>
        {r?.method && r.method !== "pending" && (
          <div className="flex justify-between pt-1">
            <span className="text-muted-foreground">{t("portfolio.payMethod", { defaultValue: "Hình thức:" })}</span>
            <span>
              {r.method === "bank_transfer"
                ? t("portfolio.bankTransfer", { defaultValue: "Chuyển khoản" })
                : r.method === "cash"
                ? t("portfolio.cash", { defaultValue: "Tiền mặt" })
                : r.method}
            </span>
          </div>
        )}
      </div>

      {(r?.proof_image_url || purchase.ledger?.proof_url) && (
        <div className="pt-1 space-y-1">
          <div className="font-semibold text-success/90">{t("portfolio.proofTitle", { defaultValue: "Chứng từ chi trả" })}</div>
          <a href={r?.proof_image_url ?? purchase.ledger?.proof_url ?? "#"} target="_blank" rel="noopener" className="text-primary underline">
            {t("portfolio.viewProof", { defaultValue: "Xem ảnh chuyển khoản" })}
          </a>
        </div>
      )}

      {/* Self-confirm receipt */}
      {r && (
        <div className="pt-1">
          {r.confirmed_at ? (
            <div className="flex items-center gap-1.5 text-success">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{t("portfolio.confirmedAt", { defaultValue: "Đã xác nhận nhận tiền lúc {{t}}", t: formatDateTime(r.confirmed_at) })}</span>
            </div>
          ) : r.paid_at ? (
            <Button size="sm" className="w-full bg-success hover:bg-success/90 text-success-foreground" onClick={onConfirm} disabled={confirming}>
              {confirming ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 mr-1" />}
              {t("portfolio.confirmReceive", { defaultValue: "Tôi xác nhận đã nhận đủ tiền" })}
            </Button>
          ) : (
            <div className="text-muted-foreground italic">{t("portfolio.awaitingCashier", { defaultValue: "Đang chờ CLB xác nhận chi trả..." })}</div>
          )}
        </div>
      )}

      <div className="flex justify-end pt-1">
        {hasRated ? (
          <Badge variant="outline" className="border-success/50 text-success">
            <Star className="w-3 h-3 mr-1 fill-current" /> {t("portfolio.rated", { defaultValue: "Đã đánh giá" })}
          </Badge>
        ) : canRate ? (
          <Button size="sm" variant="outline" onClick={() => setRateOpen(true)}>
            <Star className="w-3.5 h-3.5 mr-1" /> {t("portfolio.ratePlayer", { defaultValue: "Đánh giá Player" })}
          </Button>
        ) : completedAt ? (
          <span className="text-muted-foreground">{t("portfolio.ratingExpired", { defaultValue: "Đã quá 7 ngày để đánh giá." })}</span>
        ) : null}
      </div>
      <RatingDialog
        open={rateOpen}
        onOpenChange={setRateOpen}
        dealId={purchase.deal_id}
        counterpartyName={deal?.player?.display_name ?? "Player"}
        onSubmitted={onChanged}
      />
    </div>
  );
};

export default StakingPortfolio;
