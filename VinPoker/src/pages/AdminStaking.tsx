import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { z } from "zod";
import {assertStakingFundingReceipt,stakingFundingDeliveryMessage,stakingFundingEmailDelivered} from '@/lib/stakingFundingReceipt';
import {pendingStakingFunding,persistStakingFundingIntent,clearStakingFundingIntent,type StakingFundingIntent} from '@/lib/stakingFundingIntent';
import {pendingListingArchives,persistListingArchive,clearListingArchive,assertListingArchiveReceipt,type StakingListingArchiveIntent} from '@/lib/stakingListingArchiveIntent';
import { sessionReadEpoch } from '@/lib/sessionReadEpoch';
import { readStakingReleaseIntent, persistStakingReleaseIntent, clearStakingReleaseIntent, readStakingReleasePreparation, persistStakingReleasePreparation, clearStakingReleasePreparation, prepareStakingReleaseIntent, type StakingReleaseIntent, type StakingReleasePreparation } from '@/lib/stakingReleaseIntent';
import { parseStakingReleaseDelivery } from '@/lib/stakingReleaseDelivery';
import { StakingReleaseEffectsStatus } from '@/components/admin/StakingReleaseEffectsStatus';
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { formatVND, formatDateTime } from "@/lib/format";
import { compressImage } from "@/lib/compressImage";
import {
  ShieldCheck, Landmark, ScrollText, CheckCircle2, XCircle, Copy, Loader2,
  Plus, Pencil, Image as ImageIcon, RefreshCw, Wallet, AlertTriangle, Send, Signature, PlayCircle, Trash2, ScanLine, Archive,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Download } from "lucide-react";
import { exportToExcel, formatExcelDate } from "@/lib/exportExcel";
import CashierCounter from "@/components/admin/CashierCounter";
import FeeConfigManager from "@/components/admin/FeeConfigManager";
import FeeRevenueDashboard from "@/components/admin/FeeRevenueDashboard";
import { TournamentRegistrationsTab } from "@/components/admin/TournamentRegistrationsTab";

type DealRow = {
  id: string;
  player_id: string;
  backer_id: string | null;
  escrow_amount_vnd: number;
  escrow_bank_reference: string;
  committed_at: string | null;
  transfer_proof_submitted: boolean;
  transfer_proof_image_url: string | null;
  status: string;
  player?: { display_name: string | null } | null;
  backer?: { display_name: string | null } | null;
};

type PurchaseRow = {
  id: string;
  deal_id: string;
  backer_id: string;
  percent: number;
  amount_vnd: number;
  reference_code: string;
  transfer_proof_url: string | null;
  transfer_proof_submitted: boolean;
  status: string;
  committed_at: string;
  backer?: { display_name: string | null; avatar_url: string | null } | null;
};

type PendingDealGroup = {
  deal_id: string;
  club_id: string|null;
  player_name: string | null;
  custom_event_name: string | null;
  tournament_name: string | null;
  percentage_sold: number;
  filled_percent: number;
  early_closed: boolean;
  status: string;
  purchases: PurchaseRow[];
};

type BankAccount = {
  id: string;
  bank_name: string;
  account_number: string;
  account_holder: string;
  account_type: string;
  is_active: boolean;
  qr_code_url: string | null;
  notes: string | null;
  club_id: string | null;
  club?: { name: string } | null;
};

type ClubLite = { id: string; name: string };

type AuditLog = {
  id: string;
  created_at: string;
  deal_id: string | null;
  action: string;
  performed_by: string | null;
  old_status: string | null;
  new_status: string | null;
  metadata: any;
  performer?: { display_name: string | null } | null;
};

const AdminStaking = () => {
  const { t } = useTranslation();
  const { user, isAdmin, isCashier, isStaffOps, loading: authLoading } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (!authLoading) {
      if (!user) nav("/auth");
      else if (!isStaffOps) nav("/");
    }
  }, [authLoading, user, isStaffOps, nav]);

  if (authLoading || !user) return <div className="text-muted-foreground">{t("stakingAdmin.loading")}</div>;
  if (!isStaffOps) return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-center">
      <h2 className="text-lg font-bold text-destructive">{t("stakingAdmin.forbiddenTitle")}</h2>
      <p className="text-sm text-muted-foreground mt-1">{t("stakingAdmin.forbiddenDesc")}</p>
    </div>
  );

  // Cashier: only sees ops group (counter / pending / release / dispute / history)
  const defaultGroup = isCashier && !isAdmin ? "ops" : "ops";
  const [opsTab, setOpsTab] = useState(isCashier && !isAdmin ? "counter" : "counter");
  const [reviewTab, setReviewTab] = useState("listings");
  const [historyTab, setHistoryTab] = useState("confirm");
  const [configTab, setConfigTab] = useState("banks");

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-primary" />
        <h1 className="text-2xl md:text-3xl font-display font-bold">{t("stakingAdmin.title")}</h1>
        {isCashier && !isAdmin && (
          <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider bg-primary/15 text-primary border border-primary/40">
            {t("stakingAdmin.cashierBadge")}
          </span>
        )}
      </header>

      <Tabs defaultValue={defaultGroup}>
        <TabsList className="flex flex-wrap w-full gap-1 h-auto p-1 bg-muted/50">
          <TabsTrigger value="ops" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <PlayCircle className="w-4 h-4 mr-1.5" /> Vận hành
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="review" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Send className="w-4 h-4 mr-1.5" /> Duyệt deal
            </TabsTrigger>
          )}
          <TabsTrigger value="history" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <ScrollText className="w-4 h-4 mr-1.5" /> Lịch sử
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="config" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Wallet className="w-4 h-4 mr-1.5" /> Cấu hình
            </TabsTrigger>
          )}
        </TabsList>

        {/* ============ NHÓM 1: VẬN HÀNH ============ */}
        <TabsContent value="ops" className="mt-4">
          <Tabs value={opsTab} onValueChange={setOpsTab}>
            <TabsList className="flex flex-wrap w-full max-w-5xl gap-1">
              <TabsTrigger value="counter"><ScanLine className="w-3.5 h-3.5 mr-1.5" /> {t("stakingAdmin.tabCounter")}</TabsTrigger>
              <TabsTrigger value="pending"><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> {t("stakingAdmin.tabPending")}</TabsTrigger>
              <TabsTrigger value="tournament_regs"><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Đăng ký giải</TabsTrigger>
              <TabsTrigger value="release"><Wallet className="w-3.5 h-3.5 mr-1.5" /> {t("stakingAdmin.tabRelease")}</TabsTrigger>
              <TabsTrigger value="dispute"><AlertTriangle className="w-3.5 h-3.5 mr-1.5" /> {t("stakingAdmin.tabDispute")}</TabsTrigger>
            </TabsList>
            <TabsContent value="counter" className="mt-4"><CashierCounter /></TabsContent>
            <TabsContent value="pending" className="mt-4"><PendingTab cashierOnlyUserId={isCashier && !isAdmin ? user.id : null} /></TabsContent>
            <TabsContent value="tournament_regs" className="mt-4"><TournamentRegistrationsTab /></TabsContent>
            <TabsContent value="release" className="mt-4"><ReleaseTab currentUserId={user.id} isSuperAdmin={isAdmin} cashierOnlyUserId={isCashier && !isAdmin ? user.id : null} /></TabsContent>
            <TabsContent value="dispute" className="mt-4"><DisputeTab cashierOnlyUserId={isCashier && !isAdmin ? user.id : null} /></TabsContent>
          </Tabs>
        </TabsContent>

        {/* ============ NHÓM 2: DUYỆT DEAL ============ */}
        {isAdmin && (
          <TabsContent value="review" className="mt-4">
            <ReviewListingsTab />
          </TabsContent>
        )}

        {/* ============ NHÓM 3: LỊCH SỬ ============ */}
        <TabsContent value="history" className="mt-4">
          <Tabs value={historyTab} onValueChange={setHistoryTab}>
            <TabsList className="flex flex-wrap gap-1">
              <TabsTrigger value="confirm"><ScrollText className="w-3.5 h-3.5 mr-1.5" /> {t("stakingAdmin.tabHistory")}</TabsTrigger>
              {isAdmin && <TabsTrigger value="audit"><ScrollText className="w-3.5 h-3.5 mr-1.5" /> {t("stakingAdmin.tabAudit")}</TabsTrigger>}
            </TabsList>
            <TabsContent value="confirm" className="mt-4"><ConfirmHistoryTab cashierOnlyUserId={isCashier && !isAdmin ? user.id : null} /></TabsContent>
            {isAdmin && <TabsContent value="audit" className="mt-4"><AuditTab /></TabsContent>}
          </Tabs>
        </TabsContent>

        {/* ============ NHÓM 4: CẤU HÌNH ============ */}
        {isAdmin && (
          <TabsContent value="config" className="mt-4">
            <Tabs value={configTab} onValueChange={setConfigTab}>
              <TabsList className="flex flex-wrap gap-1">
                <TabsTrigger value="banks"><Landmark className="w-3.5 h-3.5 mr-1.5" /> {t("stakingAdmin.tabBanks")}</TabsTrigger>
                <TabsTrigger value="fees"><Wallet className="w-3.5 h-3.5 mr-1.5" /> {t("stakingAdmin.tabFees")}</TabsTrigger>
                <TabsTrigger value="revenue"><Wallet className="w-3.5 h-3.5 mr-1.5" /> Doanh thu phí</TabsTrigger>
              </TabsList>
              <TabsContent value="banks" className="mt-4"><BanksTab /></TabsContent>
              <TabsContent value="fees" className="mt-4"><FeeConfigManager /></TabsContent>
              <TabsContent value="revenue" className="mt-4"><FeeRevenueDashboard /></TabsContent>
            </Tabs>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

/* ---------------- TAB 0: REVIEW LISTINGS (admin approval) ---------------- */

type ReviewDeal = {
  id: string;
  player_id: string;
  buy_in_amount_vnd: number;
  percentage_sold: number;
  markup: number;
  asking_price_vnd: number;
  description: string | null;
  custom_event_name: string | null;
  custom_event_date: string | null;
  custom_event_venue: string | null;
  tournament_id: string | null;
  created_at: string;
  admin_review_status: string;
  admin_review_note: string | null;
  player?: { display_name: string | null; avatar_url: string | null } | null;
  tournament?: { name: string; start_time: string; buy_in: number } | null;
};

export const ReviewListingsTab = () => {
  const {user,session}=useAuth();
  if(!user?.id)return <p>Đăng nhập để kiểm tra phiếu đăng ký.</p>;
  return <ScopedReviewListingsTab key={`${user.id}:${sessionReadEpoch(session)}`} actorId={user.id}/>;
};
const ScopedReviewListingsTab = ({actorId}:{actorId:string}) => {
  const [deals, setDeals] = useState<ReviewDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected">("pending");
  const [actOn, setActOn] = useState<{ deal: ReviewDeal; action: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ReviewDeal | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteInFlight=useRef(false);
  const deleteRead=useRef<AbortController|null>(null);
  const reviewListRead=useRef<AbortController|null>(null);
  const reviewReadGeneration=useRef(0);
  const [reviewReadError,setReviewReadError]=useState(false);
  const reviewAlive=useRef(true);
  useEffect(()=>{reviewAlive.current=true;return()=>{reviewAlive.current=false;deleteRead.current?.abort();reviewListRead.current?.abort();};},[]);
  const [pendingArchives,setPendingArchives]=useState<StakingListingArchiveIntent[]>([]);
  const [archiveIntentError,setArchiveIntentError]=useState(false);
  const [archiveOutcome,setArchiveOutcome]=useState<string|null>(null);
  const [archiveRetryAllowed,setArchiveRetryAllowed]=useState<Set<string>>(()=>new Set());
  const refreshArchives=useCallback(()=>{try{setPendingArchives(pendingListingArchives(actorId));setArchiveIntentError(false);}catch{setArchiveIntentError(true);}},[actorId]);
  useEffect(()=>{refreshArchives();const sync=()=>{if(reviewAlive.current){setArchiveRetryAllowed(new Set());refreshArchives();}};window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);},[refreshArchives]);
  const acceptArchiveReceipt=(value:unknown,intent:StakingListingArchiveIntent)=>{
    assertListingArchiveReceipt(value,intent.deal_id);
    setArchiveOutcome(`Đã lưu trữ phiếu ${intent.deal_id}. Lịch sử và audit được giữ nguyên.`);
    try{clearListingArchive(intent);refreshArchives();}catch{setArchiveOutcome(`Đã lưu trữ phiếu ${intent.deal_id}. Không xóa được yêu cầu trên máy; giữ lại để đối chiếu. Lịch sử và audit được giữ nguyên.`);}
  };
  const recoverArchive=async(intent:StakingListingArchiveIntent)=>{
    if(deleteInFlight.current)return;deleteInFlight.current=true;setDeleting(true);
    setArchiveRetryAllowed(previous=>{const next=new Set(previous);next.delete(intent.deal_id);return next;});
    const controller=new AbortController();deleteRead.current=controller;let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      const {data,error}=await Promise.race([supabase.functions.invoke('admin-staking-listing-archive-status',{body:{deal_id:intent.deal_id,expected_review:intent.expected_review},signal:controller.signal}),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('archive_read_timeout'));},10000);})]);
      if(!reviewAlive.current)return;if(error)throw error;
      const observation=z.object({success:z.literal(false),deal_id:z.literal(intent.deal_id),state:z.enum(['not_recorded','needs_attention'])}).strict().safeParse(data);
      if(observation.success){
        if(observation.data.state==='not_recorded')setArchiveRetryAllowed(previous=>new Set(previous).add(intent.deal_id));
        setArchiveOutcome(observation.data.state==='not_recorded'?`Chưa tìm thấy receipt lưu trữ ${intent.deal_id} ở lần đọc này. Không tự gửi lại; server vẫn phải kiểm tra điều kiện khi bạn xác nhận đúng yêu cầu.`:`Phiếu ${intent.deal_id} cần đối chiếu. Không gửi lại thao tác lưu trữ.`);return;
      }
      acceptArchiveReceipt(data,intent);
    }catch{if(reviewAlive.current)setArchiveOutcome('Không tra được kết quả lưu trữ. Giữ yêu cầu đã lưu; không tự gửi lại.');}
    finally{if(timer)clearTimeout(timer);deleteInFlight.current=false;if(reviewAlive.current)setDeleting(false);}
  };

  const handleDelete = async () => {
    if (!deleteTarget||deleteInFlight.current||loading||reviewReadError||archiveIntentError) return;
    const target=deleteTarget;
    deleteInFlight.current=true;
    setDeleting(true);
    let timer:ReturnType<typeof setTimeout>|undefined;
    let intent:StakingListingArchiveIntent|null=null;
    try{
    if(target.admin_review_status!=='approved'&&target.admin_review_status!=='rejected')throw new Error('Phiếu chưa có trạng thái duyệt phù hợp.');
    if(pendingListingArchives(actorId).some(item=>item.deal_id===target.id)&&!archiveRetryAllowed.has(target.id))throw new Error('Tra yêu cầu lưu trữ đã lưu trước khi xác nhận lại.');
    intent=persistListingArchive({actor_id:actorId,deal_id:target.id,expected_review:target.admin_review_status});refreshArchives();
    setArchiveRetryAllowed(previous=>{const next=new Set(previous);next.delete(target.id);return next;});
    const {data,error}=await Promise.race([supabase.functions.invoke('admin-archive-staking-listing',{body:{deal_id:intent.deal_id,expected_review:intent.expected_review}}),
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('archive_outcome_unknown')),15000);})]);
    if(!reviewAlive.current)return;
    if(error)throw error;
    acceptArchiveReceipt(data,intent);
    toast.success("Đã lưu trữ phiếu, giữ nguyên lịch sử");
    setDeleteTarget(null);
    load();
    }catch{if(reviewAlive.current){setDeleteTarget(null);setArchiveOutcome(intent?'Chưa xác minh được kết quả lưu trữ. Yêu cầu đã lưu; dùng Tra kết quả trước khi thử lại.':'Chưa gửi lưu trữ: không lưu được yêu cầu an toàn hoặc cần tra yêu cầu cũ.');toast.error('Chưa xác minh được kết quả lưu trữ.');}}
    finally{if(timer)clearTimeout(timer);deleteInFlight.current=false;if(reviewAlive.current)setDeleting(false);}
  };

  const load = useCallback(async () => {
    const generation=++reviewReadGeneration.current;reviewListRead.current?.abort();
    const controller=new AbortController();reviewListRead.current=controller;
    const current=()=>reviewAlive.current&&generation===reviewReadGeneration.current;
    let timer:ReturnType<typeof setTimeout>|undefined;
    setLoading(true);
    setReviewReadError(false);
    const read=async()=>{
    const { data, error } = await supabase
      .from("staking_deals")
      .select("id, player_id, buy_in_amount_vnd, percentage_sold, markup, asking_price_vnd, description, custom_event_name, custom_event_date, custom_event_venue, tournament_id, created_at, admin_review_status, admin_review_note, status")
      .eq("admin_review_status", filter)
      .eq("status", "listing")
      .order("created_at", { ascending: false })
      .limit(200).abortSignal(controller.signal);
    if (error||!Array.isArray(data)) throw new Error('review_list_unavailable');
    const list = data;
    if (list.length === 0) return [];
    const playerIds = Array.from(new Set(list.map((d) => d.player_id)));
    const tIds = Array.from(new Set(list.map((d) => d.tournament_id).filter(Boolean) as string[]));
    const [pRes, tRes] = await Promise.all([
      supabase.from("profiles").select("user_id, display_name, avatar_url").in("user_id", playerIds).abortSignal(controller.signal),
      tIds.length ? supabase.from("tournaments").select("id, name, start_time, buy_in").in("id", tIds).abortSignal(controller.signal) : Promise.resolve({ data: [],error:null }),
    ]);
    if(pRes.error||tRes.error||!Array.isArray(pRes.data)||!Array.isArray(tRes.data))throw new Error('review_details_unavailable');
    const pMap = new Map<string, any>((pRes.data ?? []).map((p: any) => [p.user_id, p]));
    const tMap = new Map<string, any>((tRes.data ?? []).map((t: any) => [t.id, t]));
    return list.map((d) => ({ ...d, player: pMap.get(d.player_id) ?? null, tournament: d.tournament_id ? tMap.get(d.tournament_id) ?? null : null }));
    };
    try{const result=await Promise.race([read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('review_read_timeout'));},10000);})]);if(current())setDeals(result);}
    catch{if(current()){setReviewReadError(true);setDeleteTarget(null);}}
    finally{if(timer)clearTimeout(timer);if(current())setLoading(false);}
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase.channel("admin-review-listings")
      .on("postgres_changes", { event: "*", schema: "public", table: "staking_deals" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const openAct = (deal: ReviewDeal, action: "approve" | "reject") => {
    setActOn({ deal, action });
    setNote("");
  };

  const submit = async () => {
    if (!actOn) return;
    if (actOn.action === "reject" && !note.trim()) {
      toast.error("Nhập lý do từ chối");
      return;
    }
    setSubmitting(true);
    const { data: { user: u } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("staking_deals")
      .update({
        admin_review_status: actOn.action === "approve" ? "approved" : "rejected",
        admin_review_note: note.trim() || null,
        reviewed_by: u?.id ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", actOn.deal.id);
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    await supabase.from("notifications").insert({
      user_id: actOn.deal.player_id,
      type: actOn.action === "approve" ? "deal_committed" : "deal_auto_cancelled",
      title: actOn.action === "approve" ? "Deal đã được duyệt" : "Deal bị từ chối",
      body: actOn.action === "approve"
        ? `Deal của bạn đã lên trang STAKE. Backers có thể mua cổ phần ngay.`
        : `Deal bị từ chối. Lý do: ${note.trim()}`,
      data: { deal_id: actOn.deal.id },
    } as any);
    toast.success(actOn.action === "approve" ? "Đã duyệt deal lên trang STAKE" : "Đã từ chối deal");
    setActOn(null);
    load();
  };

  return (
    <>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Lọc:</Label>
          <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
            <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Chờ duyệt</SelectItem>
              <SelectItem value="approved">Đã duyệt</SelectItem>
              <SelectItem value="rejected">Đã từ chối</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">{deals.length} deal</span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={deals.length === 0} onClick={() => exportToExcel(
            deals,
            [
              { header: "Deal ID", get: (d) => d.id },
              { header: "Player", get: (d) => d.player?.display_name ?? "" },
              { header: "Sự kiện", get: (d) => d.tournament?.name ?? d.custom_event_name ?? "" },
              { header: "Ngày", get: (d) => formatExcelDate(d.tournament?.start_time ?? d.custom_event_date) },
              { header: "Địa điểm", get: (d) => d.custom_event_venue ?? "" },
              { header: "Buy-in (VND)", get: (d) => Number(d.buy_in_amount_vnd) },
              { header: "% bán", get: (d) => Number(d.percentage_sold) },
              { header: "Markup", get: (d) => Number(d.markup) },
              { header: "Backer trả (VND)", get: (d) => Number(d.asking_price_vnd) },
              { header: "Mô tả", get: (d) => d.description ?? "" },
              { header: "Trạng thái duyệt", get: (d) => d.admin_review_status },
              { header: "Ghi chú admin", get: (d) => d.admin_review_note ?? "" },
              { header: "Tạo lúc", get: (d) => formatExcelDate(d.created_at) },
            ],
            `staking-review-${filter}`,
            "Review",
          )}>
            <Download className="w-3.5 h-3.5 mr-1" /> Xuất Excel
          </Button>
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Làm mới</Button>
        </div>
      </div>

      {archiveIntentError&&<p role="alert">Không đọc được yêu cầu lưu trữ đã lưu. Giữ nguyên dữ liệu để đối chiếu; chưa gửi yêu cầu mới.</p>}
      {pendingArchives.length>0&&<div className="mb-3 space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm">Yêu cầu lưu trữ đã lưu trên máy. Tra kết quả chỉ đọc, không tự gửi lại thao tác.</p>
        {pendingArchives.map(intent=><div key={intent.deal_id} className="flex flex-wrap items-center gap-2"><span className="break-all text-xs">{intent.deal_id}</span>
          <Button size="sm" variant="outline" disabled={deleting} aria-label={`Tra kết quả lưu trữ ${intent.deal_id}`} onClick={()=>recoverArchive(intent)}>Tra kết quả lưu trữ</Button></div>)}
      </div>}
      {archiveOutcome&&<p role="status" className="mb-3 break-all rounded-lg border border-border p-3 text-sm">{archiveOutcome}</p>}
      {loading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : reviewReadError ? <p role="alert">Không tải được danh sách phiếu. Làm mới để kiểm tra; chưa xác minh danh sách trống.</p> : deals.length === 0 ? (
        <div className="text-center py-12 rounded-xl border border-dashed border-border bg-card/30 text-sm text-muted-foreground">
          Không có deal nào ở trạng thái này.
        </div>
      ) : (
        <div className="space-y-3">
          {deals.map((d) => {
            const eventName = d.tournament?.name ?? d.custom_event_name ?? "Sự kiện riêng";
            const eventDate = d.tournament?.start_time ?? d.custom_event_date ?? null;
            return (
              <div key={d.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{d.player?.display_name ?? "—"}</span>
                      <span className="text-muted-foreground text-sm">·</span>
                      <span className="text-sm">{eventName}</span>
                      {!d.tournament_id && (
                        <Badge variant="outline" className="border-warning/50 text-warning text-[10px]">Sự kiện riêng</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {eventDate && <>Ngày: {formatDateTime(eventDate)} · </>}
                      {d.custom_event_venue && <>Địa điểm: {d.custom_event_venue} · </>}
                      Tạo: {formatDateTime(d.created_at)}
                    </div>
                  </div>
                  <Badge variant="outline" className={
                    d.admin_review_status === "approved" ? "border-success/50 text-success" :
                    d.admin_review_status === "rejected" ? "border-destructive/50 text-destructive" :
                    "border-warning/50 text-warning"
                  }>
                    {d.admin_review_status}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <ReviewStat label="Lệ phí tập huấn" value={formatVND(d.buy_in_amount_vnd)} />
                  <ReviewStat label="% mời hỗ trợ" value={`${d.percentage_sold}%`} />
                  <ReviewStat label="Hệ số hỗ trợ" value={`${Number(d.markup).toFixed(2)}x`} />
                  <ReviewStat label="Người hỗ trợ trả" value={formatVND(d.asking_price_vnd)} highlight />
                </div>

                {d.description && (
                  <div className="text-sm text-muted-foreground bg-muted/20 rounded-lg p-3 border border-border whitespace-pre-wrap">
                    {d.description}
                  </div>
                )}

                {d.admin_review_note && (
                  <div className="text-xs text-muted-foreground italic">
                    Ghi chú admin: {d.admin_review_note}
                  </div>
                )}

                {d.admin_review_status === "pending" ? (
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                    <Button size="sm" variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => openAct(d, "reject")}>
                      <XCircle className="w-3.5 h-3.5 mr-1" /> Từ chối
                    </Button>
                    <Button size="sm" className="bg-success hover:bg-success/90 text-success-foreground" onClick={() => openAct(d, "approve")}>
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Duyệt lên trang STAKE
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                    <Button size="sm" variant="outline" disabled={deleting||archiveIntentError||(pendingArchives.some(item=>item.deal_id===d.id)&&!archiveRetryAllowed.has(d.id))} onClick={() => setDeleteTarget(d)}>
                      <Archive className="w-3.5 h-3.5 mr-1" /> Lưu trữ phiếu đăng ký
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!actOn} onOpenChange={(o) => !o && setActOn(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {actOn?.action === "approve" ? "Duyệt phiếu lên bảng thông báo hợp tác" : "Từ chối phiếu đăng ký"}
            </DialogTitle>
            <DialogDescription>
              {actOn?.action === "approve" 
                ? "Phiếu sẽ xuất hiện trên bảng thông báo hợp tác và người hỗ trợ có thể tham gia ngay."
                : "Vui lòng nhập lý do để người tham gia biết cách điều chỉnh."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-sm">
              Ghi chú {actOn?.action === "reject" ? "(bắt buộc)" : "(tuỳ chọn)"}
            </Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder={actOn?.action === "approve" ? "Ví dụ: Hồ sơ tốt, phiếu đăng ký rõ ràng..." : "Ví dụ: Hệ số hỗ trợ quá cao, vui lòng giảm xuống..."}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActOn(null)}>Huỷ</Button>
            <Button
              disabled={submitting}
              className={actOn?.action === "approve" ? "bg-success hover:bg-success/90 text-success-foreground" : "bg-destructive hover:bg-destructive/90 text-destructive-foreground"}
              onClick={submit}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : (actOn?.action === "approve" ? "Duyệt" : "Từ chối")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleteInFlight.current && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lưu trữ phiếu này?</AlertDialogTitle>
            <AlertDialogDescription>
              Phiếu sẽ ngừng xuất hiện trong danh sách đang mở. Lịch sử và audit được giữ nguyên.
              Server sẽ chặn nếu phiếu đã có purchase hoặc dữ liệu tài chính liên quan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Hủy</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting||loading||reviewReadError||archiveIntentError}
              onClick={(event)=>{event.preventDefault();void handleDelete();}}
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Lưu trữ"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

const ReviewStat = ({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) => (
  <div>
    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className={`font-bold ${highlight ? "text-primary" : "text-foreground"}`}>{value}</div>
  </div>
);

/* ---------------- TAB: CONFIRM HISTORY (funded purchases) ---------------- */

type HistoryRow = {
  id: string;
  deal_id: string;
  backer_id: string;
  amount_vnd: number;
  funded_at: string | null;
  reference_code: string;
  percent: number;
  backer_name?: string | null;
  deal_label?: string | null;
  club_name?: string | null;
};

const ConfirmHistoryTab = ({ cashierOnlyUserId }: { cashierOnlyUserId: string | null }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);

    let allowedDealIds: Set<string> | null = null;
    if (cashierOnlyUserId) {
      const { data: myClubs } = await supabase.rpc("cashier_club_ids", { _user_id: cashierOnlyUserId });
      const clubIds = ((myClubs ?? []) as any[]).map((r: any) => (typeof r === "string" ? r : r.cashier_club_ids ?? r)).filter(Boolean);
      if (clubIds.length === 0) { setRows([]); setLoading(false); return; }
      const { data: scopedDeals } = await supabase.from("staking_deals").select("id").in("club_id", clubIds);
      allowedDealIds = new Set((scopedDeals ?? []).map((d: any) => d.id));
      if (allowedDealIds.size === 0) { setRows([]); setLoading(false); return; }
    }

    let q = supabase
      .from("staking_purchases")
      .select("id, deal_id, backer_id, amount_vnd, funded_at, reference_code, percent")
      .eq("status", "funded")
      .order("funded_at", { ascending: false })
      .limit(200);
    if (allowedDealIds) q = q.in("deal_id", Array.from(allowedDealIds));
    const { data, error } = await q;
    if (error) { toast.error(error.message); setLoading(false); return; }

    const list = (data ?? []) as HistoryRow[];
    if (list.length === 0) { setRows([]); setLoading(false); return; }

    const dealIds = Array.from(new Set(list.map((p) => p.deal_id)));
    const backerIds = Array.from(new Set(list.map((p) => p.backer_id)));
    const [dRes, bRes] = await Promise.all([
      supabase.from("staking_deals").select("id, custom_event_name, tournament_id, club_id").in("id", dealIds),
      supabase.from("profiles").select("user_id, display_name").in("user_id", backerIds),
    ]);
    const deals = (dRes.data ?? []) as any[];
    const tIds = deals.map((d) => d.tournament_id).filter(Boolean) as string[];
    const cIds = deals.map((d) => d.club_id).filter(Boolean) as string[];
    const [tRes, cRes] = await Promise.all([
      tIds.length ? supabase.from("tournaments").select("id, name").in("id", tIds) : Promise.resolve({ data: [] } as any),
      cIds.length ? supabase.from("clubs").select("id, name").in("id", cIds) : Promise.resolve({ data: [] } as any),
    ]);
    const tMap = new Map<string, any>((tRes.data ?? []).map((t: any) => [t.id, t]));
    const cMap = new Map<string, any>((cRes.data ?? []).map((c: any) => [c.id, c]));
    const dMap = new Map<string, any>(deals.map((d) => [d.id, d]));
    const bMap = new Map<string, any>((bRes.data ?? []).map((p: any) => [p.user_id, p]));

    setRows(list.map((p) => {
      const d = dMap.get(p.deal_id);
      return {
        ...p,
        backer_name: bMap.get(p.backer_id)?.display_name ?? null,
        deal_label: d?.tournament_id ? tMap.get(d.tournament_id)?.name ?? null : d?.custom_event_name ?? null,
        club_name: d?.club_id ? cMap.get(d.club_id)?.name ?? null : null,
      };
    }));
    setLoading(false);
  }, [cashierOnlyUserId]);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (r.reference_code?.toLowerCase().includes(q))
      || (r.backer_name?.toLowerCase().includes(q))
      || (r.deal_label?.toLowerCase().includes(q));
  });

  const totalVnd = filtered.reduce((s, r) => s + Number(r.amount_vnd || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-col md:flex-row md:items-center gap-2 justify-between">
        <div className="text-sm text-muted-foreground">
          {t("stakingAdmin.history.summary", { n: filtered.length, amt: totalVnd.toLocaleString("vi-VN") })}
        </div>
        <div className="flex gap-2">
          <Input placeholder={t("stakingAdmin.history.searchPh")} value={search} onChange={(e) => setSearch(e.target.value)} className="md:w-72" />
          <Button size="sm" variant="outline" disabled={filtered.length === 0} onClick={() => exportToExcel(
            filtered,
            [
              { header: "Thời gian", get: (r) => formatExcelDate(r.funded_at) },
              { header: "Backer", get: (r) => r.backer_name ?? "" },
              { header: "Backer ID", get: (r) => r.backer_id },
              { header: "Deal ID", get: (r) => r.deal_id },
              { header: "Deal", get: (r) => r.deal_label ?? "" },
              { header: "CLB", get: (r) => r.club_name ?? "" },
              { header: "%", get: (r) => Number(r.percent) },
              { header: "VND", get: (r) => Number(r.amount_vnd) },
              { header: "Mã CK", get: (r) => r.reference_code },
            ],
            "confirm-history",
            "ConfirmHistory",
          )}>
            <Download className="w-3.5 h-3.5 mr-1" /> {t("stakingAdmin.exportExcel")}
          </Button>
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-3.5 h-3.5 mr-1" /> {t("stakingAdmin.refresh")}</Button>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 rounded-xl border border-dashed border-border bg-card/30 text-sm text-muted-foreground">
          {t("stakingAdmin.history.empty")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground border-b border-border bg-muted/30">
              <tr>
                <th className="text-left py-2 px-3">{t("stakingAdmin.history.thTime")}</th>
                <th className="text-left py-2 px-3">{t("stakingAdmin.history.thBacker")}</th>
                <th className="text-left py-2 px-3">{t("stakingAdmin.history.thDealClub")}</th>
                <th className="text-right py-2 px-3">%</th>
                <th className="text-right py-2 px-3">VND</th>
                <th className="text-left py-2 px-3">{t("stakingAdmin.history.thCode")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="py-2 px-3 whitespace-nowrap">{r.funded_at ? new Date(r.funded_at).toLocaleString("vi-VN") : "—"}</td>
                  <td className="py-2 px-3">{r.backer_name ?? r.backer_id.slice(0, 8)}</td>
                  <td className="py-2 px-3">
                    <div className="font-medium">{r.deal_label ?? "—"}</div>
                    {r.club_name && <div className="text-[10px] text-muted-foreground">{r.club_name}</div>}
                  </td>
                  <td className="py-2 px-3 text-right">{r.percent}%</td>
                  <td className="py-2 px-3 text-right font-mono">{Number(r.amount_vnd).toLocaleString("vi-VN")}</td>
                  <td className="py-2 px-3 font-mono text-[10px]">{r.reference_code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

/* ---------------- TAB 1: PENDING CONFIRMATIONS (Multi-backer) ---------------- */

export const PendingTab = ({ cashierOnlyUserId }: { cashierOnlyUserId: string | null }) => {
  const { user, session } = useAuth();
  if(!user?.id)return <p>Đăng nhập để kiểm tra yêu cầu FUNDED.</p>;
  return <ScopedPendingTab key={`${user.id}:${sessionReadEpoch(session)}:${cashierOnlyUserId ?? 'admin'}`} actorId={user.id} cashierOnlyUserId={cashierOnlyUserId} />;
};

const ScopedPendingTab = ({ cashierOnlyUserId,actorId }: { cashierOnlyUserId: string | null;actorId:string }) => {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const [groups, setGroups] = useState<PendingDealGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [proofView, setProofView] = useState<string | null>(null);
  const [confirmPurchase, setConfirmPurchase] = useState<{ p: PurchaseRow; group: PendingDealGroup } | null>(null);
  const [cancelPurchase, setCancelPurchase] = useState<{ p: PurchaseRow; group: PendingDealGroup } | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [fundingBusy, setFundingBusy] = useState(false);
  const [fundingOutcome,setFundingOutcome]=useState<string|null>(null);
  const [readError, setReadError] = useState(false);
  const readGeneration = useRef(0);
  const activeRead = useRef<AbortController | null>(null);
  const recoveryRead=useRef<AbortController|null>(null);
  const fundingInFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; activeRead.current?.abort();recoveryRead.current?.abort(); }; }, []);
  const [pendingFunding,setPendingFunding]=useState<StakingFundingIntent[]>([]);
  const [intentError,setIntentError]=useState(false);
  const [retryAllowed,setRetryAllowed]=useState<Set<string>>(()=>new Set());
  const refreshFunding=useCallback(()=>{try{setPendingFunding(pendingStakingFunding(actorId));setIntentError(false);}catch{setIntentError(true);}},[actorId]);
  useEffect(()=>{refreshFunding();const sync=()=>{if(alive.current){setRetryAllowed(new Set());refreshFunding();}};window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);},[refreshFunding]);
  const showReceipt=(data:unknown,intent:StakingFundingIntent)=>{
    const receipt=assertStakingFundingReceipt(data,intent.purchase_id);
    setFundingOutcome(`Kết quả lần xác nhận: Đã xác nhận FUNDED (${intent.reference}). ${stakingFundingDeliveryMessage(receipt.delivery,intent.purchase_id)}`);
    if(stakingFundingEmailDelivered(receipt.delivery,intent.purchase_id)){clearStakingFundingIntent(intent);refreshFunding();}
    return receipt;
  };
  const recoverFunding=async(intent:StakingFundingIntent)=>{
    if(fundingInFlight.current)return;fundingInFlight.current=true;setFundingBusy(true);
    setRetryAllowed(previous=>{const next=new Set(previous);next.delete(intent.purchase_id);return next;});
    const controller=new AbortController();recoveryRead.current=controller;let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      const {data,error}=await Promise.race([supabase.functions.invoke('admin-staking-funding-status',{body:{purchase_id:intent.purchase_id},signal:controller.signal}),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('funding_status_timeout'));},10000);})]);
      if(!alive.current)return;if(error)throw error;
      const pending=z.object({success:z.literal(false),purchase_id:z.literal(intent.purchase_id),state:z.enum(['not_recorded','needs_attention'])}).strict().safeParse(data);
      if(pending.success){
        if(pending.data.state==='not_recorded')setRetryAllowed(previous=>new Set(previous).add(intent.purchase_id));
        setFundingOutcome(pending.data.state==='not_recorded'?`Chưa tìm thấy ghi nhận FUNDED (${intent.reference}) ở lần kiểm tra này. Không tự gửi lại; chỉ xác nhận lại đúng yêu cầu sau khi đối chiếu tiền.`:`Yêu cầu FUNDED (${intent.reference}) cần đối chiếu dữ liệu. Không xác nhận tiền lại.`);return;
      }
      showReceipt(data,intent);
    }catch{if(alive.current)setFundingOutcome('Không tra được kết quả FUNDED. Yêu cầu đã lưu vẫn được giữ; chưa gửi lại tiền hoặc email.');}
    finally{if(timer)clearTimeout(timer);fundingInFlight.current=false;if(alive.current)setFundingBusy(false);}
  };

  const load = useCallback(async () => {
    const generation = ++readGeneration.current;
    activeRead.current?.abort();
    const controller = new AbortController();
    activeRead.current = controller;
    const current = () => alive.current && generation === readGeneration.current;
    setLoading(true);
    setReadError(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async (): Promise<PendingDealGroup[]> => {

    // Cashier: chỉ xem deal thuộc CLB họ được gán
    let allowedDealIds: Set<string> | null = null;
    if (cashierOnlyUserId) {
      const { data: myClubs, error: clubError } = await supabase.rpc("cashier_club_ids", { _user_id: cashierOnlyUserId }).abortSignal(controller.signal);
      if (clubError) throw clubError;
      const clubIds = ((myClubs ?? []) as any[]).map((r: any) => (typeof r === "string" ? r : r.cashier_club_ids ?? r)).filter(Boolean);
      if (clubIds.length === 0) return [];
      const { data: scopedDeals, error: scopeError } = await supabase
        .from("staking_deals").select("id").in("club_id", clubIds).abortSignal(controller.signal);
      if (scopeError) throw scopeError;
      allowedDealIds = new Set((scopedDeals ?? []).map((d: any) => d.id));
      if (allowedDealIds.size === 0) return [];
    }

    // 1) All committed (pending) purchases
    let q = supabase
      .from("staking_purchases")
      .select("id, deal_id, backer_id, percent, amount_vnd, reference_code, transfer_proof_url, transfer_proof_submitted, status, committed_at")
      .eq("status", "committed")
      .order("committed_at", { ascending: true });
    if (allowedDealIds) q = q.in("deal_id", Array.from(allowedDealIds));
    const { data: purchases, error } = await q.abortSignal(controller.signal);
    if (error) throw error;
    const list = (purchases ?? []) as PurchaseRow[];
    if (list.length === 0) return [];

    const dealIds = Array.from(new Set(list.map((p) => p.deal_id)));
    const backerIds = Array.from(new Set(list.map((p) => p.backer_id)));

    const [dRes, bRes] = await Promise.all([
      supabase.from("staking_deals")
        .select("id, club_id, player_id, percentage_sold, filled_percent, early_closed, status, custom_event_name, tournament_id")
        .in("id", dealIds).abortSignal(controller.signal),
      supabase.from("profiles").select("user_id, display_name, avatar_url").in("user_id", backerIds).abortSignal(controller.signal),
    ]);
    if (dRes.error || bRes.error) throw dRes.error ?? bRes.error;
    const deals = (dRes.data ?? []) as any[];
    const playerIds = Array.from(new Set(deals.map((d) => d.player_id)));
    const tIds = Array.from(new Set(deals.map((d) => d.tournament_id).filter(Boolean) as string[]));
    const [pRes, tRes] = await Promise.all([
      playerIds.length ? supabase.from("profiles").select("user_id, display_name").in("user_id", playerIds).abortSignal(controller.signal) : Promise.resolve({ data: [] } as any),
      tIds.length ? supabase.from("tournaments").select("id, name").in("id", tIds).abortSignal(controller.signal) : Promise.resolve({ data: [] } as any),
    ]);
    if (pRes.error || tRes.error) throw pRes.error ?? tRes.error;
    const playerMap = new Map<string, any>((pRes.data ?? []).map((p: any) => [p.user_id, p]));
    const tMap = new Map<string, any>((tRes.data ?? []).map((t: any) => [t.id, t]));
    const backerMap = new Map<string, any>((bRes.data ?? []).map((p: any) => [p.user_id, p]));

    const dealMap = new Map<string, PendingDealGroup>();
    deals.forEach((d) => {
      dealMap.set(d.id, {
        deal_id: d.id,
        club_id: d.club_id,
        player_name: playerMap.get(d.player_id)?.display_name ?? null,
        custom_event_name: d.custom_event_name,
        tournament_name: d.tournament_id ? tMap.get(d.tournament_id)?.name ?? null : null,
        percentage_sold: d.percentage_sold,
        filled_percent: d.filled_percent,
        early_closed: !!d.early_closed,
        status: d.status,
        purchases: [],
      });
    });
    list.forEach((p) => {
      const g = dealMap.get(p.deal_id);
      if (!g) return;
      g.purchases.push({ ...p, backer: backerMap.get(p.backer_id) ?? null });
    });
    return Array.from(dealMap.values()).filter((g) => g.purchases.length > 0);
    };
    try {
      const result = await Promise.race([
        read(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('pending_read_timeout')); }, 10000); }),
      ]);
      if (current()) setGroups(result);
    } catch {
      if (current()) { setReadError(true); setConfirmPurchase(null); }
    } finally {
      if (timer) clearTimeout(timer);
      if (current()) setLoading(false);
    }
  }, [cashierOnlyUserId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  useEffect(() => {
    const ch = supabase.channel("admin-pending")
      .on("postgres_changes", { event: "*", schema: "public", table: "staking_deals" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "staking_purchases" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const copyId = (id: string) => { navigator.clipboard.writeText(id); toast.success(t("stakingAdmin.copyId")); };

  const doConfirm = async () => {
    if (!confirmPurchase || fundingInFlight.current || loading || readError) return;
    const { p,group } = confirmPurchase;
    fundingInFlight.current = true;
    setFundingBusy(true);
    try {
    if(pendingStakingFunding(actorId).some(item=>item.purchase_id===p.id)&&!retryAllowed.has(p.id))throw new Error('Tra kết quả FUNDED đã lưu trước khi xác nhận lại.');
    const intent=persistStakingFundingIntent({actor_id:actorId,purchase_id:p.id,club_id:group.club_id,reference:p.reference_code});
    setRetryAllowed(previous=>{const next=new Set(previous);next.delete(p.id);return next;});refreshFunding();
    const { data, error } = await supabase.functions.invoke("admin-confirm-funded", {
      body: { purchase_id: p.id },
    });
    if (!alive.current) return;
    if (error||(data as any)?.error) {setFundingOutcome(`Chưa xác minh được kết quả FUNDED (${p.reference_code}). Yêu cầu đã lưu; dùng Tra kết quả trước khi xác nhận lại.`);setConfirmPurchase(null);toast.error('Chưa xác minh được kết quả FUNDED. Tra yêu cầu đã lưu để đối chiếu.');return;}
    let receipt:ReturnType<typeof assertStakingFundingReceipt>;
    try{receipt=showReceipt(data,intent);}catch{setConfirmPurchase(null);toast.error('Chưa xác minh được receipt FUNDED. Kiểm tra lại đúng purchase, không ghi giao dịch mới.');return;}
    const ds = receipt.deal_status;
    toast.success(ds === "funded" ? t("stakingAdmin.pending.toastFunded") : t("stakingAdmin.pending.toastConfirmed"));
    setConfirmPurchase(null);
    load();
    } catch {
      if (alive.current) {setConfirmPurchase(null);toast.error('Chưa xác minh được kết quả FUNDED hoặc không lưu được yêu cầu an toàn. Kiểm tra yêu cầu đã lưu; không tạo giao dịch mới.');}
    } finally {
      fundingInFlight.current = false;
      if (alive.current) setFundingBusy(false);
    }
  };

  const totalPurchases = groups.reduce((s, g) => s + g.purchases.length, 0);

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">
          {t("stakingAdmin.pending.summary", { p: totalPurchases, d: groups.length })}
        </p>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              disabled={cleaning}
              onClick={async () => {
                setCleaning(true);
                try {
                  const { data, error } = await supabase.functions.invoke("staking-manual-cleanup");
                  if (error) throw error;
                  toast.success(`Đã dọn ${data?.cleaned ?? 0} deal hết hạn · cảnh báo ${data?.notified ?? 0} backer`);
                  await load();
                } catch (e: any) {
                  toast.error(e?.message ?? "Cleanup thất bại");
                } finally {
                  setCleaning(false);
                }
              }}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              {cleaning ? "Đang dọn…" : "Dọn deal hết hạn"}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-3.5 h-3.5 mr-1" /> {t("stakingAdmin.refresh")}</Button>
        </div>
      </div>

      {intentError&&<p role="alert">Không đọc được yêu cầu FUNDED đã lưu. Giữ nguyên dữ liệu để đối chiếu; chưa gửi xác nhận mới.</p>}
      {pendingFunding.length>0&&<div className="mb-3 space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm">Yêu cầu FUNDED đã lưu trên máy. Tra kết quả chỉ đọc, không gửi lại tiền hoặc email.</p>
        {pendingFunding.map(intent=><div key={intent.purchase_id} className="flex flex-wrap items-center gap-2"><span className="break-all text-sm">{intent.reference}</span>
          <Button size="sm" variant="outline" disabled={fundingBusy} aria-label={`Tra kết quả FUNDED ${intent.reference}`} onClick={()=>recoverFunding(intent)}>Tra kết quả FUNDED</Button></div>)}
      </div>}
      {fundingOutcome&&<p role="status" className="mb-3 rounded-lg border border-border p-3 text-sm">{fundingOutcome}</p>}
      {loading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : readError ? (
        <div role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm">Không tải được danh sách chờ xác nhận. Bấm làm mới để kiểm tra lại; chưa xác minh đây là danh sách trống.</div>
      ) : groups.length === 0 ? (
        <div className="text-center py-12 rounded-xl border border-dashed border-border bg-card/30 text-sm text-muted-foreground">
          {t("stakingAdmin.pending.empty")}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const eventName = g.tournament_name ?? g.custom_event_name ?? t("stakingAdmin.pending.customEvent");
            const totalPending = g.purchases.reduce((s, p) => s + Number(p.amount_vnd), 0);
            return (
              <div key={g.deal_id} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="p-3 border-b border-border bg-muted/20 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <button onClick={() => copyId(g.deal_id)} className="font-mono text-xs text-primary hover:underline inline-flex items-center gap-1">
                      {g.deal_id.slice(0, 8)}… <Copy className="w-3 h-3" />
                    </button>
                    <span className="font-semibold">{g.player_name ?? "—"}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">{eventName}</span>
                    {g.early_closed && (
                      <Badge variant="outline" className="border-warning/50 text-warning">{t("stakingAdmin.pending.closedEarly")}</Badge>
                    )}
                    <Badge variant="outline" className="border-primary/50 text-primary">
                      {t("stakingAdmin.pending.soldBadge", { f: g.filled_percent, s: g.percentage_sold })}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("stakingAdmin.pending.pendingTotal")} <b className="text-primary">{formatVND(totalPending)}</b>
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("stakingAdmin.pending.thBacker")}</TableHead>
                      <TableHead className="text-right">%</TableHead>
                      <TableHead className="text-right">{t("stakingAdmin.pending.thAmount")}</TableHead>
                      <TableHead>{t("stakingAdmin.pending.thRef")}</TableHead>
                      <TableHead>{t("stakingAdmin.pending.thProof")}</TableHead>
                      <TableHead>{t("stakingAdmin.pending.thRemaining")}</TableHead>
                      <TableHead className="text-right">{t("stakingAdmin.pending.thAction")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.purchases.map((p) => {
                      const startedAt = new Date(p.committed_at).getTime();
                      const remaining = Math.max(0, startedAt + 30 * 60 * 1000 - now);
                      const mins = Math.floor(remaining / 60000);
                      const secs = Math.floor((remaining % 60000) / 1000);
                      const danger = remaining < 5 * 60 * 1000;
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="text-sm">{p.backer?.display_name ?? "—"}</TableCell>
                          <TableCell className="text-right font-semibold">{p.percent}%</TableCell>
                          <TableCell className="text-right font-semibold text-primary">{formatVND(p.amount_vnd)}</TableCell>
                          <TableCell className="font-mono text-xs">{p.reference_code}</TableCell>
                          <TableCell>
                            {p.transfer_proof_url ? (
                              <button onClick={() => setProofView(p.transfer_proof_url!)} className="block w-12 h-12 rounded border border-border overflow-hidden hover:border-primary">
                                <img src={p.transfer_proof_url} alt="proof" className="w-full h-full object-cover" />
                              </button>
                            ) : (
                              <span className="text-xs text-muted-foreground">{p.transfer_proof_submitted ? t("stakingAdmin.pending.sentNoImg") : "—"}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={remaining <= 0 ? "border-destructive/50 text-destructive" : danger ? "border-destructive/50 text-destructive" : "border-warning/50 text-warning"}>
                              {remaining <= 0 ? t("stakingAdmin.pending.expired") : `${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right space-x-1">
                            <Button size="sm" disabled={fundingBusy||intentError||(pendingFunding.some(item=>item.purchase_id===p.id)&&!retryAllowed.has(p.id))} className="bg-success/90 hover:bg-success text-success-foreground" onClick={() => setConfirmPurchase({ p, group: g })}>
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> {t("stakingAdmin.pending.confirm")}
                            </Button>
                            <Button size="sm" variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => setCancelPurchase({ p, group: g })}>
                              <XCircle className="w-3.5 h-3.5 mr-1" /> {t("stakingAdmin.pending.cancel")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            );
          })}
        </div>
      )}

      {/* Proof image modal */}
      <Dialog open={!!proofView} onOpenChange={(o) => !o && setProofView(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{t("stakingAdmin.pending.proofTitle")}</DialogTitle></DialogHeader>
          {proofView && <img src={proofView} alt="proof" className="w-full max-h-[70vh] object-contain rounded-lg" />}
        </DialogContent>
      </Dialog>

      {/* Confirm dialog */}
      <Dialog open={!!confirmPurchase} onOpenChange={(o) => !o && !fundingInFlight.current && setConfirmPurchase(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("stakingAdmin.pending.confirmDialogTitle")}</DialogTitle>
            <DialogDescription className="pt-2">
              {t("stakingAdmin.pending.confirmDialogDesc", {
                amt: confirmPurchase ? formatVND(confirmPurchase.p.amount_vnd) : "",
                p: confirmPurchase?.p.percent ?? 0,
                name: confirmPurchase?.p.backer?.display_name ?? "—",
              })}
              <br /><span className="text-destructive font-semibold">{t("stakingAdmin.pending.irreversible")}</span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={fundingBusy} onClick={() => setConfirmPurchase(null)}>{t("stakingAdmin.pending.cancel")}</Button>
            <Button disabled={fundingBusy || loading || readError || intentError} aria-busy={fundingBusy} className="bg-success hover:bg-success/90 text-success-foreground" onClick={doConfirm}>
              {t("stakingAdmin.pending.confirmFunded")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CancelPurchaseDialog
        info={cancelPurchase}
        onClose={() => setCancelPurchase(null)}
        onDone={() => { setCancelPurchase(null); load(); }}
      />
    </>
  );
};

const CancelPurchaseDialog = ({
  info, onClose, onDone,
}: { info: { p: PurchaseRow; group: PendingDealGroup } | null; onClose: () => void; onDone: () => void }) => {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { if (!info) setReason(""); }, [info]);

  const submit = async () => {
    if (!info) return;
    if (!reason.trim()) { toast.error(t("stakingAdmin.pending.needReason")); return; }
    setSubmitting(true);
    const { error } = await supabase
      .from("staking_purchases")
      .update({
        status: "cancelled",
        cancellation_reason: reason.trim(),
      })
      .eq("id", info.p.id)
      .eq("status", "committed");
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    // Audit
    await supabase.from("staking_audit_logs").insert({
      deal_id: info.p.deal_id,
      action: "admin_cancelled_deal",
      old_status: "committed",
      new_status: "cancelled",
      metadata: { purchase_id: info.p.id, percent: info.p.percent, reason: reason.trim(), scope: "purchase" },
    });
    toast.success(t("stakingAdmin.pending.toastCancelled"));
    onDone();
  };

  return (
    <Dialog open={!!info} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("stakingAdmin.pending.cancelTitle")}</DialogTitle>
          <DialogDescription>
            {t("stakingAdmin.pending.cancelDesc", { p: info?.p.percent ?? 0 })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>{t("stakingAdmin.pending.reasonLabel")}</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("stakingAdmin.pending.reasonPh")} rows={3} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("stakingAdmin.pending.close")}</Button>
          <Button variant="destructive" onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {t("stakingAdmin.pending.confirmCancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};


/* ---------------- TAB 2: BANK ACCOUNTS ---------------- */

const emptyBank: Omit<BankAccount, "id" | "club"> = {
  bank_name: "", account_number: "", account_holder: "",
  account_type: "escrow", is_active: true, qr_code_url: null, notes: null, club_id: null,
};

const BanksTab = () => {
  const [rows, setRows] = useState<BankAccount[]>([]);
  const [clubs, setClubs] = useState<ClubLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data, error }, { data: clubData }] = await Promise.all([
      supabase.from("platform_bank_accounts")
        .select("*, club:clubs(name)").order("created_at", { ascending: true }),
      supabase.from("clubs").select("id, name").order("name"),
    ]);
    if (error) toast.error(error.message);
    setRows((data ?? []) as any);
    setClubs((clubData ?? []) as ClubLite[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeEscrowCount = rows.filter((r) => r.account_type === "escrow" && r.is_active && !r.club_id).length;

  const toggleActive = async (row: BankAccount, next: boolean) => {
    if (!next && row.account_type === "escrow" && !row.club_id && activeEscrowCount <= 1) {
      toast.error("Phải có ít nhất 1 tài khoản escrow chung (không gắn CLB) đang hoạt động.");
      return;
    }
    const { error } = await supabase.from("platform_bank_accounts")
      .update({ is_active: next }).eq("id", row.id);
    if (error) toast.error(error.message);
    else { toast.success(next ? "Đã kích hoạt" : "Đã tắt"); load(); }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">{rows.length} tài khoản · {activeEscrowCount} escrow chung đang bật</p>
        <Button size="sm" onClick={() => setCreating(true)} className="gradient-neon text-primary-foreground"><Plus className="w-3.5 h-3.5 mr-1" /> Thêm tài khoản</Button>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        💡 Tài khoản gắn với <b>câu lạc bộ</b> sẽ được dùng làm ví nhận tiền cho các deal của CLB đó. Tài khoản không gắn CLB là <b>fallback chung</b>.
      </p>

      {loading ? <Skeleton className="h-48 rounded-xl" /> : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Câu lạc bộ</TableHead>
                <TableHead>Ngân hàng</TableHead>
                <TableHead>Số TK</TableHead>
                <TableHead>Chủ TK</TableHead>
                <TableHead>Loại</TableHead>
                <TableHead>QR</TableHead>
                <TableHead>Hoạt động</TableHead>
                <TableHead className="text-right">Sửa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {r.club_id
                      ? <Badge variant="outline" className="border-primary/40 text-primary">{r.club?.name ?? "—"}</Badge>
                      : <Badge variant="outline" className="border-muted text-muted-foreground">Chung (fallback)</Badge>}
                  </TableCell>
                  <TableCell className="font-semibold">{r.bank_name}</TableCell>
                  <TableCell className="font-mono text-sm">{r.account_number}</TableCell>
                  <TableCell>{r.account_holder}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={r.account_type === "escrow" ? "border-primary/50 text-primary" : "border-muted text-muted-foreground"}>
                      {r.account_type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {r.qr_code_url ? <img src={r.qr_code_url} alt="qr" className="w-8 h-8 rounded border border-border" /> : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <Switch checked={r.is_active} onCheckedChange={(v) => toggleActive(r, v)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">Chưa có tài khoản nào.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <BankFormDialog
        open={creating || !!editing}
        initial={editing ?? null}
        clubs={clubs}
        onClose={() => { setEditing(null); setCreating(false); }}
        onSaved={() => { setEditing(null); setCreating(false); load(); }}
      />
    </>
  );
};

const BankFormDialog = ({
  open, initial, clubs, onClose, onSaved,
}: { open: boolean; initial: BankAccount | null; clubs: ClubLite[]; onClose: () => void; onSaved: () => void }) => {
  const [form, setForm] = useState<Omit<BankAccount, "id" | "club">>(emptyBank);
  const [saving, setSaving] = useState(false);
  const [uploadingQR, setUploadingQR] = useState(false);

  useEffect(() => {
    if (open) {
      if (initial) {
        const { id: _id, club: _c, ...rest } = initial;
        setForm({ ...emptyBank, ...rest });
      } else {
        setForm({ ...emptyBank });
      }
    }
  }, [open, initial]);

  const uploadQR = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0];
    if (!raw) return;
    if (!["image/jpeg","image/png","image/webp"].includes(raw.type)) { toast.error("Chỉ JPG/PNG/WEBP"); return; }
    setUploadingQR(true);
    try {
      const file = await compressImage(raw, { maxEdge: 800, quality: 0.85 });
      const ext = file.type === "image/png" ? "png" : "jpg";
      const path = `qr/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("bank-qr-codes")
        .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("bank-qr-codes").getPublicUrl(path);
      setForm((f) => ({ ...f, qr_code_url: pub.publicUrl }));
      toast.success("Đã tải QR");
    } catch (e: any) {
      toast.error(e.message ?? "Upload lỗi");
    } finally {
      setUploadingQR(false);
      e.target.value = "";
    }
  };

  const save = async () => {
    if (!form.bank_name.trim() || !form.account_number.trim() || !form.account_holder.trim()) {
      toast.error("Điền đủ các trường bắt buộc"); return;
    }
    setSaving(true);
    const payload = {
      bank_name: form.bank_name.trim(),
      account_number: form.account_number.trim(),
      account_holder: form.account_holder.trim(),
      account_type: form.account_type,
      is_active: form.is_active,
      qr_code_url: form.qr_code_url,
      notes: form.notes,
      club_id: form.club_id,
    };
    const res = initial
      ? await supabase.from("platform_bank_accounts").update(payload).eq("id", initial.id)
      : await supabase.from("platform_bank_accounts").insert(payload);
    setSaving(false);
    if (res.error) { toast.error(res.error.message); return; }
    toast.success(initial ? "Đã cập nhật" : "Đã tạo tài khoản");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{initial ? "Sửa tài khoản" : "Thêm tài khoản"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Tên ngân hàng *</Label><Input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} /></div>
          <div><Label>Số tài khoản *</Label><Input value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} /></div>
          <div><Label>Chủ tài khoản *</Label><Input value={form.account_holder} onChange={(e) => setForm({ ...form, account_holder: e.target.value })} /></div>
          <div>
            <Label>Câu lạc bộ</Label>
            <Select
              value={form.club_id ?? "__none__"}
              onValueChange={(v) => setForm({ ...form, club_id: v === "__none__" ? null : v })}
            >
              <SelectTrigger><SelectValue placeholder="Chọn CLB" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Không gắn CLB (fallback chung) —</SelectItem>
                {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">Deal của CLB sẽ ưu tiên dùng tài khoản này.</p>
          </div>
          <div>
            <Label>Loại tài khoản</Label>
            <Select value={form.account_type} onValueChange={(v) => setForm({ ...form, account_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="escrow">escrow</SelectItem>
                <SelectItem value="fee_collection">fee_collection</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between"><Label>Đang hoạt động</Label>
            <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
          </div>
          <div>
            <Label>QR Code</Label>
            <div className="flex items-center gap-3 mt-1">
              {form.qr_code_url
                ? <img src={form.qr_code_url} alt="qr" className="w-16 h-16 rounded border border-border object-cover" />
                : <div className="w-16 h-16 rounded border border-dashed border-border flex items-center justify-center text-muted-foreground"><ImageIcon className="w-5 h-5" /></div>}
              <input id="qr-upload" type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={uploadQR} />
              <Button asChild size="sm" variant="outline" disabled={uploadingQR}>
                <label htmlFor="qr-upload" className="cursor-pointer">
                  {uploadingQR ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5 mr-1" />}
                  {form.qr_code_url ? "Thay QR" : "Tải QR"}
                </label>
              </Button>
            </div>
          </div>
          <div><Label>Ghi chú</Label><Textarea rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Đóng</Button>
          <Button onClick={save} disabled={saving} className="gradient-neon text-primary-foreground">
            {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Lưu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ---------------- TAB 3: AUDIT LOGS ---------------- */

const PAGE_SIZE = 50;
const ACTIONS = [
  "all","created","reviewed","committed","funded","result_entered",
  "release_requested","release_cosigned","released","disputed","admin_override",
  "cancelled","updated","auto_cancelled_timeout","admin_confirmed_funded","admin_cancelled_deal",
];

const AuditTab = () => {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [dealFilter, setDealFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [jsonView, setJsonView] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("staking_audit_logs").select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (dealFilter.trim()) q = q.eq("deal_id", dealFilter.trim());
    if (actionFilter !== "all") q = q.eq("action", actionFilter as any);
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", to + "T23:59:59");
    const { data, error, count } = await q;
    if (error) { toast.error(error.message); setLoading(false); return; }
    const list = (data ?? []) as AuditLog[];
    const ids = Array.from(new Set(list.map((l) => l.performed_by).filter(Boolean) as string[]));
    const { data: profs } = ids.length
      ? await supabase.from("profiles").select("user_id, display_name").in("user_id", ids)
      : { data: [] as any[] };
    const pMap = new Map<string, any>((profs ?? []).map((p: any) => [p.user_id, p]));
    setRows(list.map((l) => ({ ...l, performer: l.performed_by ? pMap.get(l.performed_by) ?? null : null })));
    setHasMore((count ?? 0) > (page + 1) * PAGE_SIZE);
    setLoading(false);
  }, [page, dealFilter, actionFilter, from, to]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
        <Input placeholder="Deal ID" value={dealFilter} onChange={(e) => { setPage(0); setDealFilter(e.target.value); }} />
        <Select value={actionFilter} onValueChange={(v) => { setPage(0); setActionFilter(v); }}>
          <SelectTrigger><SelectValue placeholder="Action" /></SelectTrigger>
          <SelectContent>{ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
        </Select>
        <Input type="date" value={from} onChange={(e) => { setPage(0); setFrom(e.target.value); }} />
        <Input type="date" value={to} onChange={(e) => { setPage(0); setTo(e.target.value); }} />
      </div>

      {loading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Thời gian</TableHead>
                <TableHead>Deal</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Thực hiện</TableHead>
                <TableHead>Chi tiết</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs whitespace-nowrap">{formatDateTime(l.created_at)}</TableCell>
                  <TableCell className="font-mono text-xs">{l.deal_id?.slice(0,8) ?? "—"}…</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{l.action}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{l.old_status ?? "—"} → {l.new_status ?? "—"}</TableCell>
                  <TableCell className="text-xs">{l.performer?.display_name ?? (l.performed_by ? l.performed_by.slice(0,8) + "…" : "system")}</TableCell>
                  <TableCell>
                    {l.metadata && Object.keys(l.metadata).length > 0 ? (
                      <Button size="sm" variant="ghost" onClick={() => setJsonView(l.metadata)}>View JSON</Button>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">Không có log nào.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex items-center justify-between mt-3 text-sm">
        <span className="text-muted-foreground">Trang {page + 1}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={() => exportToExcel(
            rows,
            [
              { header: "Thời gian", get: (l) => formatExcelDate(l.created_at) },
              { header: "Deal ID", get: (l) => l.deal_id ?? "" },
              { header: "Action", get: (l) => l.action },
              { header: "Old Status", get: (l) => l.old_status ?? "" },
              { header: "New Status", get: (l) => l.new_status ?? "" },
              { header: "Performer", get: (l) => l.performer?.display_name ?? l.performed_by ?? "system" },
              { header: "Performed By ID", get: (l) => l.performed_by ?? "" },
              { header: "Metadata", get: (l) => l.metadata ? JSON.stringify(l.metadata) : "" },
            ],
            "audit-logs",
            "Audit",
          )}>
            <Download className="w-3.5 h-3.5 mr-1" /> Xuất Excel
          </Button>
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Trước</Button>
          <Button size="sm" variant="outline" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>Sau</Button>
        </div>
      </div>

      <Dialog open={!!jsonView} onOpenChange={(o) => !o && setJsonView(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Metadata</DialogTitle></DialogHeader>
          <pre className="text-xs bg-muted/30 p-3 rounded-lg overflow-auto max-h-[60vh]">{JSON.stringify(jsonView, null, 2)}</pre>
        </DialogContent>
      </Dialog>
    </>
  );
};

/* ---------------- TAB 4: KẾT QUẢ & GIẢI NGÂN ---------------- */

type ReleaseDeal = {
  id: string;
  player_id: string;
  backer_id: string | null;
  buy_in_amount_vnd: number;
  percentage_sold: number;
  filled_percent?: number | null;
  markup: number;
  result_prize_vnd: number | null;
  backer_payout_vnd: number | null;
  player_payout_vnd: number | null;
  platform_fee_vnd: number | null;
  platform_percent_fee?: number | null;
  platform_archive_fee?: number | null;
  result_proof_url: string | null;
  placement: string | null;
  result_entered_at: string | null;
  result_data: any;
  override_data: any;
  status: string;
  completed_at: string | null;
  player?: { display_name: string | null } | null;
  backer?: { display_name: string | null } | null;
};

type ReleaseRequest = {
  id: string;
  deal_id: string;
  requested_by_admin_id: string;
  cosigned_by_admin_id: string | null;
  status: string;
  note: string | null;
  requester?: { display_name: string | null } | null;
};

const RELEASE_STATUSES = ["result_entered","result_verified","release_requested","cosigned","completed"];

const STATUS_PILL: Record<string, string> = {
  result_entered: "border-warning/50 text-warning bg-warning/10",
  result_verified: "border-primary/50 text-primary bg-primary/10",
  release_requested: "border-warning/50 text-warning bg-warning/10",
  cosigned: "border-[hsl(var(--ds-preassign)_/_0.5)] text-[hsl(var(--ds-preassign))] bg-[hsl(var(--ds-preassign)_/_0.1)]",
  completed: "border-success/50 text-success bg-success/10",
};

const STATUS_LABEL: Record<string, string> = {
  result_entered: "Chờ xác nhận",
  result_verified: "Đã xác nhận",
  release_requested: "Chờ đồng ký",
  cosigned: "Đã đồng ký",
  completed: "Hoàn tất",
};

const ReleaseTab = ({ currentUserId, isSuperAdmin, cashierOnlyUserId }: { currentUserId: string; isSuperAdmin: boolean; cashierOnlyUserId?: string | null }) => {
  const { t } = useTranslation();
  const STATUS_LABEL_I18N: Record<string, string> = {
    result_entered: t("stakingAdmin.release.statusResultEntered"),
    result_verified: t("stakingAdmin.release.statusResultVerified"),
    release_requested: t("stakingAdmin.release.statusReleaseRequested"),
    cosigned: t("stakingAdmin.release.statusCosigned"),
    completed: t("stakingAdmin.release.statusCompleted"),
  };
  const [rows, setRows] = useState<ReleaseDeal[]>([]);
  const [requests, setRequests] = useState<Map<string, ReleaseRequest>>(new Map());
  const [loading, setLoading] = useState(true);
  const [proofView, setProofView] = useState<string | null>(null);
  const [verifyDeal, setVerifyDeal] = useState<ReleaseDeal | null>(null);
  const [requestDeal, setRequestDeal] = useState<ReleaseDeal | null>(null);
  const [cosignReq, setCosignReq] = useState<{ req: ReleaseRequest; deal: ReleaseDeal } | null>(null);
  const [executeReq, setExecuteReq] = useState<{ req: ReleaseRequest; deal: ReleaseDeal } | null>(null);
  const [effectRequest, setEffectRequest] = useState<{ requestId: string; dealId: string } | null>(null);
  const [viewMode, setViewMode] = useState<"scan" | "list">("scan");
  const [scanInput, setScanInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    let allowedClubIds: string[] | null = null;
    if (cashierOnlyUserId) {
      const { data: myClubs } = await supabase.rpc("cashier_club_ids", { _user_id: cashierOnlyUserId });
      allowedClubIds = ((myClubs ?? []) as any[]).map((r: any) => (typeof r === "string" ? r : r.cashier_club_ids ?? r)).filter(Boolean);
      if (allowedClubIds.length === 0) { setRows([]); setRequests(new Map()); setLoading(false); return; }
    }
    let q = supabase
      .from("staking_deals")
      .select("id, player_id, backer_id, buy_in_amount_vnd, percentage_sold, filled_percent, markup, result_prize_vnd, backer_payout_vnd, player_payout_vnd, platform_fee_vnd, platform_percent_fee, platform_archive_fee, result_proof_url, placement, result_entered_at, result_data, override_data, status, completed_at")
      .in("status", RELEASE_STATUSES as any)
      .order("result_entered_at", { ascending: true, nullsFirst: false });
    if (allowedClubIds) q = q.in("club_id", allowedClubIds);
    const { data, error } = await q;
    if (error) { toast.error(error.message); setLoading(false); return; }
    const list = (data ?? []) as unknown as ReleaseDeal[];

    const ids = Array.from(new Set([
      ...list.map((d) => d.player_id),
      ...list.map((d) => d.backer_id).filter(Boolean) as string[],
    ]));
    const dealIds = list.map((d) => d.id);

    const [{ data: profs }, { data: reqs }] = await Promise.all([
      ids.length ? supabase.from("profiles").select("user_id, display_name").in("user_id", ids) : Promise.resolve({ data: [] as any[] }),
      dealIds.length
        ? supabase.from("staking_release_requests").select("*").in("deal_id", dealIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const pMap = new Map<string, any>((profs ?? []).map((p: any) => [p.user_id, p]));

    const reqList = (reqs ?? []) as ReleaseRequest[];
    const requesterIds = Array.from(new Set(reqList.map((r) => r.requested_by_admin_id)));
    const { data: requesterProfs } = requesterIds.length
      ? await supabase.from("profiles").select("user_id, display_name").in("user_id", requesterIds)
      : { data: [] as any[] };
    const rMap = new Map<string, any>((requesterProfs ?? []).map((p: any) => [p.user_id, p]));

    const reqMap = new Map<string, ReleaseRequest>();
    for (const r of reqList) {
      reqMap.set(r.deal_id, { ...r, requester: rMap.get(r.requested_by_admin_id) ?? null });
    }
    setRequests(reqMap);
    setRows(list.map((d) => ({
      ...d,
      player: pMap.get(d.player_id) ?? null,
      backer: d.backer_id ? pMap.get(d.backer_id) ?? null : null,
    })));
    setLoading(false);
  }, [cashierOnlyUserId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const ch = supabase.channel("admin-release")
      .on("postgres_changes", { event: "*", schema: "public", table: "staking_deals" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "staking_release_requests" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const copyId = (id: string) => { navigator.clipboard.writeText(id); toast.success(t("stakingAdmin.copyId")); };

  const handleScan = (raw: string) => {
    if (!raw.trim()) return;
    const m = raw.match(/vinpoker:\/\/result\/([a-f0-9-]+)/i);
    const scanned = (m ? m[1] : raw).trim().toLowerCase();
    const found = rows.find((d) => d.id.toLowerCase() === scanned || d.id.toLowerCase().startsWith(scanned));
    if (!found) {
      toast.error(t("stakingAdmin.release.scanNotFound"));
      return;
    }
    setScanInput("");
    if (found.status === "result_entered") {
      setVerifyDeal(found);
    } else if (found.status === "result_verified") {
      setExecuteReq({ req: { id: "", deal_id: found.id, requested_by_admin_id: currentUserId, cosigned_by_admin_id: null, status: "pending_cosign", note: null, requested_at: new Date().toISOString() } as any, deal: found });
    } else if (found.status === "completed") {
      toast.info(t("stakingAdmin.release.alreadyDone", { t: found.completed_at ? formatDateTime(found.completed_at) : "—" }));
    } else if (found.status === "release_requested" || found.status === "cosigned") {
      const req = requests.get(found.id);
      if (req && found.status === "cosigned") setExecuteReq({ req, deal: found });
      else toast.info(t("stakingAdmin.release.waitingCosign"));
    } else {
      toast.message(t("stakingAdmin.release.currentStatus", { s: STATUS_LABEL_I18N[found.status] ?? found.status }));
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">{t("stakingAdmin.release.summary", { n: rows.length })}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={() => exportToExcel(
            rows,
            [
              { header: "Deal ID", get: (d) => d.id },
              { header: "Player", get: (d) => d.player?.display_name ?? "" },
              { header: "Backer", get: (d) => d.backer?.display_name ?? "" },
              { header: "Buy-in (VND)", get: (d) => Number(d.buy_in_amount_vnd) },
              { header: "% bán", get: (d) => Number(d.percentage_sold) },
              { header: "Markup", get: (d) => Number(d.markup) },
              { header: "Prize (VND)", get: (d) => Number(d.result_prize_vnd ?? 0) },
              { header: "Backer payout (VND)", get: (d) => Number(d.backer_payout_vnd ?? 0) },
              { header: "Player payout (VND)", get: (d) => Number(d.player_payout_vnd ?? 0) },
              { header: "Placement", get: (d) => d.placement ?? "" },
              { header: "Trạng thái", get: (d) => STATUS_LABEL_I18N[d.status] ?? d.status },
              { header: "Nhập kết quả lúc", get: (d) => formatExcelDate(d.result_entered_at) },
              { header: "Hoàn tất lúc", get: (d) => formatExcelDate(d.completed_at) },
            ],
            "release-history",
            "Release",
          )}>
            <Download className="w-3.5 h-3.5 mr-1" /> {t("stakingAdmin.exportExcel")}
          </Button>
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-3.5 h-3.5 mr-1" /> {t("stakingAdmin.refresh")}</Button>
          <Button size="sm" variant={viewMode === "scan" ? "default" : "outline"} onClick={() => setViewMode(viewMode === "scan" ? "list" : "scan")}>
            {viewMode === "scan" ? t("stakingAdmin.release.viewList") : t("stakingAdmin.release.viewScan")}
          </Button>
        </div>
      </div>

      {viewMode === "scan" && (
        <div className="rounded-xl border-2 border-primary/30 bg-card p-5 mb-4 space-y-3">
          <div className="flex items-center gap-2 text-xs uppercase font-bold tracking-wider text-primary">
            <ScanLine className="w-4 h-4" /> {t("stakingAdmin.release.scanTitle")}
          </div>
          <div className="flex gap-2">
            <Input
              autoFocus
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleScan(scanInput); } }}
              placeholder={t("stakingAdmin.release.scanPh")}
              className="font-mono"
            />
            <Button onClick={() => handleScan(scanInput)} disabled={!scanInput.trim()}>
              {t("stakingAdmin.release.scanFind")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("stakingAdmin.release.scanHint")}
          </p>
        </div>
      )}

      {viewMode === "list" && (loading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : rows.length === 0 ? (
        <div className="text-center py-12 rounded-xl border border-dashed border-border bg-card/30 text-sm text-muted-foreground">
          {t("stakingAdmin.release.empty")}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("stakingAdmin.release.thDeal")}</TableHead>
                <TableHead>{t("stakingAdmin.release.thPlayer")}</TableHead>
                <TableHead>{t("stakingAdmin.release.thBacker")}</TableHead>
                <TableHead className="text-right">{t("stakingAdmin.release.thBuyInPct")}</TableHead>
                <TableHead className="text-right">{t("stakingAdmin.release.thPrize")}</TableHead>
                <TableHead className="text-right">{t("stakingAdmin.release.thBackerReceive")}</TableHead>
                <TableHead>{t("stakingAdmin.release.thStatus")}</TableHead>
                <TableHead>{t("stakingAdmin.release.thProof")}</TableHead>
                <TableHead className="text-right">{t("stakingAdmin.release.thAction")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => {
                const req = requests.get(d.id);
                const prize = Number(d.result_prize_vnd ?? 0);
                const backerCalc = Number(d.backer_payout_vnd ?? Math.round((prize * d.percentage_sold) / 100));
                return (
                  <TableRow key={d.id}>
                    <TableCell>
                      <button onClick={() => copyId(d.id)} className="font-mono text-xs text-primary hover:underline inline-flex items-center gap-1">
                        {d.id.slice(0, 8)}… <Copy className="w-3 h-3" />
                      </button>
                    </TableCell>
                    <TableCell className="text-sm">{d.player?.display_name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{d.backer?.display_name ?? "—"}</TableCell>
                    <TableCell className="text-right text-xs">
                      {formatVND(d.buy_in_amount_vnd)} <span className="text-muted-foreground">/ {d.percentage_sold}% × {Number(d.markup).toFixed(2)}</span>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{formatVND(prize)}</TableCell>
                    <TableCell className="text-right font-semibold text-success">{formatVND(backerCalc)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_PILL[d.status] ?? ""}>
                        {STATUS_LABEL[d.status] ?? d.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {d.result_proof_url ? (
                        <button onClick={() => setProofView(d.result_proof_url!)} className="block w-12 h-12 rounded border border-border overflow-hidden hover:border-primary">
                          <img src={d.result_proof_url} alt="proof" className="w-full h-full object-cover" />
                        </button>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {d.status === "result_entered" && (
                        <Button size="sm" onClick={() => setVerifyDeal(d)} className="bg-primary text-primary-foreground">
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Xem & Xác nhận
                        </Button>
                      )}
                      {d.status === "result_verified" && (
                        <Button size="sm" onClick={() => setExecuteReq({ req: { id: "", deal_id: d.id, requested_by_admin_id: currentUserId, cosigned_by_admin_id: null, status: "pending_cosign", note: null, requested_at: new Date().toISOString() } as any, deal: d })} className="gradient-neon text-primary-foreground">
                          <PlayCircle className="w-3.5 h-3.5 mr-1" /> Hoàn tất giải ngân
                        </Button>
                      )}
                      {d.status === "release_requested" && req && (
                        isSuperAdmin ? (
                          <Button size="sm" onClick={() => setCosignReq({ req, deal: d })} className="bg-[hsl(var(--ds-preassign))] hover:bg-[hsl(var(--ds-preassign))] text-white" variant="outline">
                            <Signature className="w-3.5 h-3.5 mr-1" /> Đồng ký (Emergency)
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Đang chờ co-sign nội bộ</span>
                        )
                      )}
                      {d.status === "cosigned" && req && (
                        <Button size="sm" onClick={() => setExecuteReq({ req, deal: d })} variant="destructive">
                          <PlayCircle className="w-3.5 h-3.5 mr-1" /> Thực thi
                        </Button>
                      )}
                      {d.status === "completed" && (
                        <div className="space-y-2"><span className="text-xs text-success font-semibold">
                          {d.completed_at ? formatDateTime(d.completed_at) : "Hoàn tất"}
                        </span>{req && <Button size="sm" variant="outline" onClick={() => setEffectRequest({requestId:req.id,dealId:d.id})}>Thông báo/kết quả sau giải ngân</Button>}</div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ))}

      <Dialog open={!!proofView} onOpenChange={(o) => !o && setProofView(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Ảnh kết quả</DialogTitle></DialogHeader>
          {proofView && <img src={proofView} alt="proof" className="w-full max-h-[75vh] object-contain rounded-lg" />}
        </DialogContent>
      </Dialog>

      <VerifyResultModal deal={verifyDeal} onClose={() => setVerifyDeal(null)} onDone={() => { setVerifyDeal(null); load(); }} />
      <RequestReleaseModal deal={requestDeal} onClose={() => setRequestDeal(null)} onDone={() => { setRequestDeal(null); load(); }} />
      <CosignModal data={cosignReq} onClose={() => setCosignReq(null)} onDone={() => { setCosignReq(null); load(); }} />
      <ExecuteReleaseModal data={executeReq} onClose={() => setExecuteReq(null)} onDone={() => { setExecuteReq(null); load(); }} />
      <Dialog open={!!effectRequest} onOpenChange={open => !open && setEffectRequest(null)}>
        <DialogContent><DialogHeader><DialogTitle>Hậu xử lý giải ngân</DialogTitle><DialogDescription>Trạng thái đọc từ server, không tạo thêm thanh toán.</DialogDescription></DialogHeader>
          {effectRequest && <StakingReleaseEffectsStatus {...effectRequest}/>}</DialogContent>
      </Dialog>
    </>
  );
};

/* ---------------- VERIFY MODAL ---------------- */
const VerifyResultModal = ({ deal, onClose, onDone }: { deal: ReleaseDeal | null; onClose: () => void; onDone: () => void }) => {
  const [submitting, setSubmitting] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [scanInput, setScanInput] = useState("");
  const [identityVerified, setIdentityVerified] = useState(false);
  const [scanWarning, setScanWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!deal) {
      setDisputeOpen(false); setReason(""); setScanInput(""); setIdentityVerified(false); setScanWarning(null);
    }
  }, [deal]);

  // Listen for hardware scanner (rapid keystrokes ending in Enter)
  useEffect(() => {
    if (!deal) return;
    const buf = { chars: "", lastTs: 0 };
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const now = Date.now();
      if (now - buf.lastTs > 80) buf.chars = "";
      buf.lastTs = now;
      if (e.key === "Enter") {
        if (buf.chars.length >= 6) checkScan(buf.chars);
        buf.chars = "";
      } else if (e.key.length === 1) {
        buf.chars += e.key;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?.id]);

  const checkScan = (raw: string) => {
    if (!deal) return;
    // Accept formats: vinpoker://result/{uuid}, raw uuid, short id (first 8)
    const m = raw.match(/vinpoker:\/\/result\/([a-f0-9-]+)/i);
    const scanned = (m ? m[1] : raw).trim().toLowerCase();
    const dealId = deal.id.toLowerCase();
    if (scanned === dealId || dealId.startsWith(scanned)) {
      setIdentityVerified(true);
      setScanWarning(null);
      toast.success("Đã đối chiếu đúng deal");
    } else {
      setIdentityVerified(false);
      setScanWarning(`Mã quét "${scanned.slice(0, 16)}…" KHÔNG khớp deal đang duyệt (${dealId.slice(0, 8)}…)`);
      toast.error("Mã quét không khớp deal");
    }
  };

  if (!deal) return null;
  const prize = Number(deal.result_prize_vnd ?? 0);
  const fundedPct = Number(deal.filled_percent ?? deal.percentage_sold ?? 0);
  // FUTURE: International expansion (preserve)
  //   const percentFee = Number(deal.platform_percent_fee ?? 1.0);
  //   const platformFee = prize > 0 ? Math.floor((prize * percentFee) / 100) : 0;
  const ARCHIVE_FEE = Number(deal.platform_archive_fee ?? 199000);
  const platformFee = prize > 0 ? Math.min(ARCHIVE_FEE, prize) : 0;
  const distributable = Math.max(0, prize - platformFee);
  const backer = Math.round((distributable * fundedPct) / 100);
  const player = Math.max(0, distributable - backer);

  const verify = async () => {
    if (!identityVerified) { toast.error("Bắt buộc đối chiếu QR / Deal ID trước"); return; }
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("staking-verify-result", { body: { deal_id: deal.id } });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    if ((data as any)?.error) { toast.error((data as any).error); return; }
    toast.success("Đã xác nhận kết quả");
    onDone();
  };

  const dispute = async () => {
    if (reason.trim().length < 10) { toast.error("Lý do tối thiểu 10 ký tự"); return; }
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("staking-dispute-result", {
      body: { deal_id: deal.id, reason: reason.trim() },
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    if ((data as any)?.error) { toast.error((data as any).error); return; }
    toast.success("Đã chuyển sang Tranh chấp");
    onDone();
  };

  return (
    <Dialog open={!!deal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Xác nhận kết quả deal</DialogTitle>
          <DialogDescription className="text-xs">
            Bắt buộc quét QR hoặc nhập đúng Deal ID trước khi xác nhận. Không verify khi chưa đối chiếu người thật.
          </DialogDescription>
        </DialogHeader>

        {/* IDENTITY VERIFICATION */}
        <div className={`rounded-lg border-2 p-3 space-y-2 ${identityVerified ? "border-success/50 bg-success/5" : "border-warning/50 bg-warning/5"}`}>
          <div className="flex items-center gap-2 text-xs uppercase font-bold tracking-wider">
            <ScanLine className="w-4 h-4" /> Xác minh danh tính Player
          </div>
          <div className="text-xs text-muted-foreground">
            Quét QR Player đưa (mã <code>vinpoker://result/...</code>) hoặc nhập Deal ID để đối chiếu.
          </div>
          <div className="flex gap-2">
            <Input
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); checkScan(scanInput); } }}
              placeholder="Quét QR hoặc nhập Deal ID (vd: 4624a0...)"
              className="font-mono text-xs"
            />
            <Button size="sm" variant="outline" onClick={() => checkScan(scanInput)} disabled={!scanInput.trim()}>
              Đối chiếu
            </Button>
          </div>
          {identityVerified ? (
            <div className="text-xs text-success font-semibold">✓ Đã đối chiếu đúng deal #{deal.id.slice(0, 8)}</div>
          ) : scanWarning ? (
            <div className="text-xs text-destructive font-semibold">⚠️ {scanWarning}</div>
          ) : (
            <div className="text-xs text-muted-foreground italic">
              Deal ID hiện tại: <code className="bg-background px-1.5 py-0.5 rounded">{deal.id.slice(0, 8)}</code> · Player: <b>{deal.player?.display_name ?? "—"}</b>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            {deal.result_proof_url ? (
              <img src={deal.result_proof_url} alt="proof" className="w-full max-h-[60vh] object-contain rounded-lg border border-border" />
            ) : <div className="rounded-lg border border-dashed border-border h-64 flex items-center justify-center text-muted-foreground text-sm">Không có ảnh</div>}
          </div>
          <div className="space-y-3 text-sm">
            <div><span className="text-muted-foreground">Player:</span> <b>{deal.player?.display_name ?? "—"}</b></div>
            <div><span className="text-muted-foreground">Thứ hạng:</span> <b>{deal.placement ?? "—"}</b></div>
            <div><span className="text-muted-foreground">Tiền thưởng:</span> <b className="text-primary">{formatVND(prize)}</b></div>
            <div><span className="text-muted-foreground">Nhập lúc:</span> {deal.result_entered_at ? formatDateTime(deal.result_entered_at) : "—"}</div>

            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
              <div className="text-xs uppercase text-muted-foreground font-semibold">Phân chia hợp tác</div>
              <div className="flex justify-between"><span>Tổng thành tích:</span><b>{formatVND(prize)}</b></div>
              <div className="flex justify-between text-warning"><span>Phí lưu trữ hồ sơ:</span><span>− {formatVND(platformFee)}</span></div>
              <div className="flex justify-between border-t border-border pt-1.5"><span>Phần chia hợp tác:</span><b>{formatVND(distributable)}</b></div>
              <div className="flex justify-between pl-3"><span className="text-muted-foreground">• Người hỗ trợ ({fundedPct}%):</span><b className="text-success">{formatVND(backer)}</b></div>
              <div className="flex justify-between pl-3"><span className="text-muted-foreground">• Người tập huấn:</span><b className="text-primary">{formatVND(player)}</b></div>
            </div>
            <div className="text-xs text-warning">⚠️ Nếu kết quả sai, hãy chọn Tranh chấp. Nếu đúng, hãy xác nhận.</div>

            {disputeOpen && (
              <div className="space-y-2 pt-2 border-t border-border">
                <Label>Lý do tranh chấp (≥ 10 ký tự)</Label>
                <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mô tả vì sao kết quả không hợp lệ..." />
              </div>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="outline" onClick={onClose} disabled={submitting}>Đóng</Button>
          {!disputeOpen ? (
            <>
              <Button variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => setDisputeOpen(true)}>
                <XCircle className="w-4 h-4 mr-1" /> Từ chối / Tranh chấp
              </Button>
              <Button className="bg-success hover:bg-success/90 text-success-foreground" onClick={verify} disabled={submitting || !identityVerified}
                title={!identityVerified ? "Bắt buộc đối chiếu QR/Deal ID trước" : ""}>
                {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                <CheckCircle2 className="w-4 h-4 mr-1" /> Kết quả đúng — Xác nhận
              </Button>
            </>
          ) : (
            <Button variant="destructive" onClick={dispute} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Gửi tranh chấp
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ---------------- REQUEST RELEASE MODAL ---------------- */
type RequestReleaseProps = { deal: ReleaseDeal | null; onClose: () => void; onDone: () => void };
export const RequestReleaseModal = (props: RequestReleaseProps) => {
  const { user, loading } = useAuth();
  if (loading || !user || !props.deal) return null;
  return <RequestReleaseModalScope key={`${user.id}:${props.deal.id}`} {...props} />;
};
const RequestReleaseModalScope = ({ deal, onClose, onDone }: RequestReleaseProps) => {
  const [preview, setPreview] = useState<z.infer<typeof ReleasePreviewSchema> | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [reload, setReload] = useState(0);
  const active = useRef(true);
  const submitLock = useRef(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { active.current = true;return () => { active.current = false; }; }, []);
  const dealId = deal?.id;
  useEffect(() => {
    let alive = true;setPreview(null);setPreviewError(false);
    if (!dealId) return;
    void (async () => {
      try {
        const rpc = supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
        const response = await rpc.call(supabase, 'get_staking_release_preview_v1', { p_deal: dealId });
        if (!alive) return;
        const parsed = ReleasePreviewSchema.safeParse(response.data);
        if (response.error || !parsed.success || parsed.data.deal_id !== dealId
          || parsed.data.rows.reduce((sum, row) => sum + row.vnd_value, 0) !== parsed.data.backer_amount) throw new Error('invalid_release_preview');
        setPreview(parsed.data);
      } catch { if (alive) setPreviewError(true); }
    })();
    return () => { alive = false; };
  }, [dealId, reload]);

  if (!deal) return null;
  const prize = preview?.prize ?? 0;
  const b = preview?.backer_amount ?? 0;
  const p = preview?.player_amount ?? 0;

  const submit = async () => {
    if (!preview || submitLock.current || !active.current) return;
    submitLock.current = true;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("staking-request-release", {
      body: { deal_id: deal.id, backer_amount: b, player_amount: p, note: note.trim() || null },
      });
      if (!active.current) return;
      const receipt = z.object({ success: z.literal(true), release_request_id: z.string().uuid(), status: z.enum(['release_requested', 'cosigned']) }).safeParse(data);
      if (error || !receipt.success) throw new Error('request_release_unverified');
      toast.success("Đã tạo y/c thanh toán hợp tác. Cần admin khác đồng ký.");onDone();
    } catch { if (active.current) toast.error('Chưa xác minh được yêu cầu thanh toán. Kiểm tra lại trước khi tiếp tục.'); }
    finally { submitLock.current = false;if (active.current) setSubmitting(false); }
  };

  return (
    <Dialog open={!!deal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Tạo yêu cầu thanh toán hợp tác</DialogTitle><DialogDescription>Số tiền đã đối chiếu từ server; muốn thay đổi phải dùng quy trình điều chỉnh riêng.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          {previewError ? <div role="alert">Không xác minh được số tiền từ server. <Button variant="outline" onClick={() => setReload(value => value + 1)}>Tải lại</Button></div> : !preview ? <p role="status">Đang xác minh số tiền…</p> : null}
          {preview && <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs space-y-1">
            <div className="flex justify-between"><span>Tổng phần thưởng thành tích</span><b className="text-primary">{formatVND(prize)}</b></div>
            <div className="flex justify-between"><span>Người hỗ trợ</span><span>{formatVND(b)}</span></div>
            <div className="flex justify-between"><span>Người tham gia</span><span>{formatVND(p)}</span></div>
            <div className="flex justify-between text-muted-foreground"><span>Phí</span><span>{formatVND(preview?.fee ?? 0)}</span></div>
          </div>}
          <div>
            <Label className="text-xs">Backer nhận (VND)</Label>
            <Input aria-label="Backer nhận (VND)" value={preview ? String(b) : ''} readOnly />
          </div>
          <div>
            <Label className="text-xs">Player nhận (VND)</Label>
            <Input aria-label="Player nhận (VND)" value={preview ? String(p) : ''} readOnly />
          </div>
          <div className="flex justify-between text-xs">
            <span>Tổng nhập:</span>
            <b>
              {preview ? formatVND(b + p) : '—'}
            </b>
          </div>
          <div>
            <Label className="text-xs">Ghi chú (tuỳ chọn)</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Player tip 1M tại bàn..." />
          </div>
          <div>
            <Label className="text-xs">Phương thức</Label>
            <Select value="bank_transfer" disabled>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="bank_transfer">Bank transfer</SelectItem></SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Đóng</Button>
          <Button onClick={submit} disabled={submitting || !preview} className="gradient-neon text-primary-foreground">
            {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Tạo yêu cầu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ---------------- COSIGN MODAL ---------------- */
const CosignModal = ({ data, onClose, onDone }: { data: { req: ReleaseRequest; deal: ReleaseDeal } | null; onClose: () => void; onDone: () => void }) => {
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { if (!data) setConfirmed(false); }, [data]);

  if (!data) return null;
  const { req, deal } = data;
  const prize = Number(deal.result_prize_vnd ?? 0);
  const b = Number(deal.backer_payout_vnd ?? Math.round((prize * deal.percentage_sold) / 100));
  const p = Number(deal.player_payout_vnd ?? Math.max(0, prize - b));

  const submit = async () => {
    setSubmitting(true);
    const { data: resp, error } = await supabase.functions.invoke("staking-cosign-release", {
      body: { release_request_id: req.id },
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    if ((resp as any)?.error) { toast.error((resp as any).error); return; }
    toast.success("Đã đồng ký. Sẵn sàng thực thi.");
    onDone();
  };

  return (
    <Dialog open={!!data} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Đồng ký giải ngân</DialogTitle>
          <DialogDescription>Bạn là admin thứ 2. Vui lòng xác nhận đã đối chiếu số tiền.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
            <div className="flex justify-between"><span>Backer nhận</span><b className="text-success">{formatVND(b)}</b></div>
            <div className="flex justify-between"><span>Player nhận</span><b className="text-primary">{formatVND(p)}</b></div>
            <div className="flex justify-between text-muted-foreground text-xs pt-1 border-t border-border">
              <span>Người tạo y/c:</span><span>{req.requester?.display_name ?? req.requested_by_admin_id.slice(0,8)}</span>
            </div>
            {req.note && <div className="text-xs text-muted-foreground pt-1 border-t border-border">Ghi chú: {req.note}</div>}
          </div>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" />
            <span className="text-sm">Tôi xác nhận số tiền đúng.</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Đóng</Button>
          <Button onClick={submit} disabled={!confirmed || submitting} className="bg-[hsl(var(--ds-preassign))] hover:bg-[hsl(var(--ds-preassign))] text-white">
            {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Đồng ký
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ---------------- EXECUTE MODAL (VND) ---------------- */
type BackerRow = {
  purchase_id: string;
  backer_id: string;
  backer_name: string;
  percent: number;
  vnd_value: number;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_holder: string | null;
  payout_method: "bank_transfer" | "cash";
  paid: boolean;
  proof_url: string;
  uploading: boolean;
};

const releaseMoney = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ReleasePreviewSchema = z.object({
  deal_id: z.string().uuid(), preview_hash: z.string().regex(/^[a-f0-9]{32}$/),
  prize: releaseMoney, fee: releaseMoney, distributable: releaseMoney,
  backer_amount: releaseMoney, player_amount: releaseMoney,
  rows: z.array(z.object({
    purchase_id: z.string().uuid(), backer_id: z.string().uuid(), backer_name: z.string().nullable(),
    percent: z.number().int().positive().max(100), vnd_value: releaseMoney,
    bank_name: z.string().nullable(), bank_account_number: z.string().nullable(), bank_account_holder: z.string().nullable(),
  })).min(1).max(100).refine(rows => new Set(rows.map(row => row.purchase_id)).size === rows.length),
});

type ExecuteReleaseProps = { data: { req: ReleaseRequest; deal: ReleaseDeal } | null; onClose: () => void; onDone: () => void };
type ReleaseExecutePayload = {
  release_request_id: string; preview_hash: string; player_paid: true;
  backer_payouts: { purchase_id: string; payout_method: 'cash' | 'bank_transfer'; proof_url: string | null; paid: true }[];
};
const toReleaseExecutePayload = (payload: StakingReleasePreparation['payload'], requestId: string): ReleaseExecutePayload => ({
  release_request_id: requestId, preview_hash: payload.preview_hash, player_paid: payload.player_paid,
  backer_payouts: payload.backer_payouts.map(row => ({
    purchase_id: row.purchase_id, payout_method: row.payout_method, proof_url: row.proof_url, paid: row.paid,
  })),
});
export const ExecuteReleaseModal = (props: ExecuteReleaseProps) => {
  const { user, loading } = useAuth();
  if (loading || !user) return null;
  return <ExecuteReleaseModalScope key={`${user.id}:${props.data?.deal.id ?? 'closed'}`} actorId={user.id} {...props} />;
};
const ExecuteReleaseModalScope = ({ data, onClose, onDone, actorId }: ExecuteReleaseProps & { actorId: string }) => {
  const submitLock = useRef(false);
  const resolvedRequest = useRef(data?.req.id ?? '');
  const requestReady = useRef(!!data?.req.id);
  const targetDealId = data?.deal.id;
  const active = useRef(true);
  useEffect(() => { active.current = true;return () => { active.current = false; }; }, []);
  const [recovery] = useState(() => {
    try { return { intent: data ? readStakingReleaseIntent(localStorage, actorId, data.deal.id) : null,
      preparation: data ? readStakingReleasePreparation(localStorage, actorId, data.deal.id) : null, error: false }; }
    catch { return { intent: null, preparation: null, error: true }; }
  });
  const [preparation, setPreparation] = useState<StakingReleasePreparation | null>(recovery.preparation);
  const [savedIntent, setSavedIntent] = useState<StakingReleaseIntent | null>(recovery.intent);
  const [pendingPayload, setPendingPayload] = useState<ReleaseExecutePayload | null>(recovery.intent ? toReleaseExecutePayload(recovery.intent.payload, recovery.intent.payload.release_request_id) : null);
  const [playerPaid, setPlayerPaid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<BackerRow[]>([]);
  const [preview, setPreview] = useState<z.infer<typeof ReleasePreviewSchema> | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [previewReload, setPreviewReload] = useState(0);

  useEffect(() => {
    if (recovery.intent || recovery.preparation || recovery.error) { setLoading(false);return; }
    setPlayerPaid(false);setRows([]);setPreview(null);setPreviewError(false);
    if (!targetDealId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const rpc = supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
        const response = await rpc.call(supabase, 'get_staking_release_preview_v1', { p_deal: targetDealId });
        if (!alive) return;
        if (response.error) throw response.error;
        const parsed = ReleasePreviewSchema.safeParse(response.data);
        if (!parsed.success || parsed.data.deal_id !== targetDealId
          || parsed.data.rows.reduce((sum, row) => sum + row.vnd_value, 0) !== parsed.data.backer_amount) throw new Error('invalid_release_preview');
        setPreview(parsed.data);
        setRows(parsed.data.rows.map(row => ({ purchase_id: row.purchase_id, backer_id: row.backer_id,
          percent: row.percent, vnd_value: row.vnd_value, bank_name: row.bank_name,
          bank_account_number: row.bank_account_number, bank_account_holder: row.bank_account_holder,
          backer_name: row.backer_name ?? '—',
          payout_method: row.bank_account_number ? 'bank_transfer' : 'cash', paid: false, proof_url: '', uploading: false })));
      } catch {
        if (alive) setPreviewError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [targetDealId, previewReload, recovery]);

  if (!data) return null;
  const { req, deal } = data;
  const prize = preview?.prize ?? 0;
  const platformFee = preview?.fee ?? 0;
  const distributable = preview?.distributable ?? 0;
  const backerSum = preview?.backer_amount ?? 0;
  const playerKeeps = preview?.player_amount ?? 0;

  const updateRow = (idx: number, patch: Partial<BackerRow>) => {
    if (pendingPayload || preparation || submitting || !active.current) return;
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const uploadProof = async (idx: number, file: File) => {
    if (pendingPayload || preparation || submitting || !active.current) return;
    updateRow(idx, { uploading: true });
    try {
      const compressed = await compressImage(file, { maxEdge: 1600, quality: 0.8 });
      if (!active.current) return;
      const ext = compressed.type === "image/png" ? "png" : "jpg";
      const path = `release/${deal.id}/${rows[idx].purchase_id}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("staking-proofs").upload(path, compressed, {
        cacheControl: "3600", upsert: true, contentType: compressed.type,
      });
      if (!active.current) return;
      if (error) throw error;
      const { data: signed } = await supabase.storage.from("staking-proofs").createSignedUrl(path, 60 * 60 * 24 * 365);
      if (!active.current) return;
      updateRow(idx, { proof_url: signed?.signedUrl ?? "", uploading: false });
    } catch (e: any) {
      if (!active.current) return;
      toast.error(e.message ?? "Upload thất bại");
      updateRow(idx, { uploading: false });
    }
  };

  const allBackersReady = rows.length > 0 && rows.every((r) => r.paid && !r.uploading);
  const canSubmit = !recovery.error && !submitting && !loading
    && (!!savedIntent || !!preparation || (!!preview && !previewError && playerPaid && allBackersReady));

  const submit = async () => {
    if (submitLock.current || !canSubmit) return;
    submitLock.current = true;
    setSubmitting(true);
    try {
      const prepared: StakingReleasePreparation = preparation ?? (savedIntent ? prepareStakingReleaseIntent(savedIntent) : {
        actorId, dealId: deal.id, amounts: { backer: preview!.backer_amount, player: preview!.player_amount, fee: preview!.fee },
        payload: { preview_hash: preview!.preview_hash, player_paid: true, backer_payouts: rows.map(row => ({
          purchase_id: row.purchase_id, payout_method: row.payout_method, proof_url: row.proof_url || null, paid: true,
        })) },
      });
      if (!savedIntent) { persistStakingReleasePreparation(localStorage, prepared);setPreparation(prepared); }
      let releaseRequestId = pendingPayload?.release_request_id ?? resolvedRequest.current ?? req.id;

      // If deal already past result_verified, look up existing release_request
      if (!releaseRequestId && (deal.status === "release_requested" || deal.status === "cosigned")) {
        const { data: existing, error: lookupError } = await supabase
          .from("staking_release_requests")
          .select("id, status")
          .eq("deal_id", deal.id)
          .in("status", ["pending_cosign", "approved"])
          .maybeSingle();
        if (!active.current) return;
        if (lookupError) throw lookupError;
        if (existing?.id) {
          releaseRequestId = existing.id;
          resolvedRequest.current = releaseRequestId;
          requestReady.current = existing.status === 'approved';
        }
      }

      // 1-step Cashier flow: auto-create request + cosign first
      if (!releaseRequestId) {
        const reqResp = await supabase.functions.invoke("staking-request-release", {
          body: { deal_id: deal.id, backer_amount: prepared.amounts.backer, player_amount: prepared.amounts.player, note: "Cashier 1-step payout" },
        });
        if (!active.current) return;
        if (reqResp.error) throw new Error(reqResp.error.message);
        if ((reqResp.data as any)?.error) throw new Error((reqResp.data as any).error);
        releaseRequestId = (reqResp.data as any)?.release_request_id;
        if (!z.string().uuid().safeParse(releaseRequestId).success) throw new Error("Không lấy được release_request_id");
        resolvedRequest.current = releaseRequestId;
        requestReady.current = false;
      }
      if (!requestReady.current && !pendingPayload) {
        const cosignResp = await supabase.functions.invoke("staking-cosign-release", {
          body: { release_request_id: releaseRequestId },
        });
        if (!active.current) return;
        if (cosignResp.error) throw new Error(cosignResp.error.message);
        if ((cosignResp.data as any)?.error) throw new Error((cosignResp.data as any).error);
        if (cosignResp.data?.success !== true) throw new Error('Chưa xác minh được đồng ký. Giữ nguyên yêu cầu để kiểm tra lại.');
        requestReady.current = true;
      }

      const payload: ReleaseExecutePayload = pendingPayload ?? toReleaseExecutePayload(prepared.payload, releaseRequestId);
      const intent: StakingReleaseIntent = savedIntent ?? { actorId, dealId: deal.id, payload,
        amounts: prepared.amounts };
      persistStakingReleaseIntent(localStorage, intent);
      clearStakingReleasePreparation(localStorage, prepared);setPreparation(null);
      setSavedIntent(intent);
      setPendingPayload(payload);
      const { data: resp, error } = await supabase.functions.invoke("staking-execute-release", { body: payload });
      if (!active.current) return;
      if (error) throw new Error(error.message);
      if ((resp as any)?.error) throw new Error((resp as any).error);
      if (!resp || resp.success !== true || resp.status !== 'completed'
        || resp.release_request_id !== releaseRequestId || resp.deal_id !== deal.id
        || !resp.amounts || ![resp.amounts.backer, resp.amounts.player, resp.amounts.fee]
          .every(value => Number.isSafeInteger(value) && value >= 0)
        || resp.amounts.backer !== intent.amounts.backer || resp.amounts.player !== intent.amounts.player
        || resp.amounts.fee !== intent.amounts.fee) {
        throw new Error('Kết quả giải ngân chưa xác minh được. Kiểm tra lại cùng yêu cầu, không trả tiền lần nữa.');
      }
      clearStakingReleaseIntent(localStorage, intent);
      const delivery = parseStakingReleaseDelivery(resp.delivery, releaseRequestId, deal.id);
      toast.success(delivery?.state === 'all_delivered' ? 'Đã ghi sổ cái và xử lý xong thông báo/kết quả.'
        : 'Đã ghi sổ cái. Xem mục hậu xử lý để kiểm tra thông báo/kết quả còn chờ hoặc chưa xác minh.');
      onDone();
    } catch (e: any) {
      if (!active.current) return;
      toast.error(e.message ?? "Có lỗi xảy ra");
    } finally {
      submitLock.current = false;
      if (active.current) setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!data} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-destructive">HOÀN TẤT THANH TOÁN HỢP TÁC — KHÔNG THỂ HOÀN TÁC</DialogTitle>
          <DialogDescription>{"\n"}</DialogDescription>
        </DialogHeader>

        {(pendingPayload || preparation) && !submitting && <p role="status" className="text-sm text-warning">Giữ nguyên yêu cầu đã gửi. Bấm xác nhận để kiểm tra lại cùng yêu cầu; không trả tiền lần nữa.</p>}

        {recovery.error ? (
          <p role="alert">Không đọc được yêu cầu giải ngân đã lưu. Chưa thể gửi giao dịch mới; giữ dữ liệu để kiểm tra.</p>
        ) : recovery.intent ? (
          <div role="status" className="space-y-2 text-sm">
            <p>Khôi phục yêu cầu giải ngân chưa xác minh</p>
            <p>Mã yêu cầu: {recovery.intent.payload.release_request_id}</p>
            <p>Người hỗ trợ: {formatVND(recovery.intent.amounts.backer)} · Người tập huấn: {formatVND(recovery.intent.amounts.player)}</p>
            <p>Chỉ kiểm tra lại yêu cầu đã gửi; không trả tiền lần nữa.</p>
          </div>
        ) : recovery.preparation ? (
          <div role="status" className="space-y-2 text-sm"><p>Khôi phục bước chuẩn bị giải ngân chưa xác minh</p>
            <p>Người hỗ trợ: {formatVND(recovery.preparation.amounts.backer)} · Người tập huấn: {formatVND(recovery.preparation.amounts.player)}</p>
            <p>Giữ nguyên phương thức/chứng từ đã xác nhận; không trả tiền lần nữa.</p></div>
        ) : previewError ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>Không xác minh được bảng thanh toán từ server. Chưa thể xác nhận giải ngân.</p>
            <Button variant="outline" onClick={() => setPreviewReload(value => value + 1)}>Thử tải lại bảng thanh toán</Button>
          </div>
        ) : loading || !preview ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <div className="space-y-4 text-sm">
            {/* Fee summary — 3 dòng spec: Tổng / Phí 1% / Phần chia */}
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs space-y-1.5">
              <div className="font-semibold text-warning uppercase tracking-wider mb-1">Bảng thanh toán hợp tác</div>
              <div className="flex justify-between"><span className="text-muted-foreground">Tổng thành tích:</span><span className="font-mono font-semibold">{formatVND(prize)}</span></div>
              <div className="flex justify-between text-warning"><span>Phí lưu trữ hồ sơ:</span><span className="font-mono">− {formatVND(platformFee)}</span></div>
              <div className="flex justify-between border-t border-warning/30 pt-1.5"><span className="font-semibold">Phần chia hợp tác:</span><span className="font-mono font-bold">{formatVND(distributable)}</span></div>
              <div className="flex justify-between pl-3"><span className="text-muted-foreground">↳ Người hỗ trợ nhận tổng:</span><span className="font-mono text-success">{formatVND(backerSum)}</span></div>
              <div className="flex justify-between pl-3"><span className="text-muted-foreground">↳ Người tập huấn nhận:</span><span className="font-mono text-primary">{formatVND(playerKeeps)}</span></div>
            </div>

            {/* Player */}
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
              <div className="font-semibold text-primary">NGƯỜI TẬP HUẤN — Tại CLB</div>
              <div>{deal.player?.display_name ?? "—"} nhận: <b className="text-primary">{formatVND(playerKeeps)}</b></div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" disabled={!!pendingPayload || !!preparation || submitting} checked={playerPaid} onChange={(e) => setPlayerPaid(e.target.checked)} className="mt-1" />
                <span>Đã trả trực tiếp tại CLB.</span>
              </label>
            </div>

            {/* Backers */}
            <div className="space-y-3">
              <div className="font-semibold text-success">NGƯỜI HỖ TRỢ — Chuyển khoản</div>
              {rows.length === 0 && <div className="text-muted-foreground text-xs">Không có Người hỗ trợ nào đã hỗ trợ.</div>}
              {rows.map((r, idx) => (
                <div key={r.purchase_id} className="rounded-lg border border-border p-3 space-y-2 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{r.backer_name} <span className="text-xs text-muted-foreground">({r.percent}%)</span></div>
                    <div className="text-xs">Phải trả: <b className="text-success">{formatVND(r.vnd_value)}</b></div>
                  </div>
                  <div className="text-xs space-y-0.5">
                    {r.bank_account_number ? (
                      <>
                        <div>Ngân hàng: <b>{r.bank_name ?? "—"}</b></div>
                        <div>Số TK: <code className="bg-background px-1 py-0.5 rounded break-all">{r.bank_account_number}</code></div>
                        <div>Chủ TK: <b>{r.bank_account_holder ?? "—"}</b></div>
                      </>
                    ) : (
                      <div className="text-warning">⚠️ Backer chưa lưu TK ngân hàng — vui lòng trả tiền mặt.</div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Hình thức chi trả</Label>
                      <Select disabled={!!pendingPayload || !!preparation || submitting} value={r.payout_method} onValueChange={(v: any) => updateRow(idx, { payout_method: v })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bank_transfer" disabled={!r.bank_account_number}>Chuyển khoản</SelectItem>
                          <SelectItem value="cash">Tiền mặt</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Ảnh chứng từ (nếu có)</Label>
                      <div className="flex items-center gap-2 mt-1">
                        <Input
                          type="file"
                          accept="image/*"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadProof(idx, f); }}
                          disabled={r.uploading || !!pendingPayload || !!preparation || submitting}
                          className="h-9"
                        />
                        {r.uploading && <Loader2 className="w-4 h-4 animate-spin" />}
                        {r.proof_url && !r.uploading && (
                          <a href={r.proof_url} target="_blank" rel="noopener" className="text-xs text-primary underline">Xem</a>
                        )}
                      </div>
                    </div>
                  </div>
                  <label className="flex items-start gap-2 cursor-pointer pt-1">
                    <input type="checkbox" disabled={!!pendingPayload || !!preparation || submitting} checked={r.paid} onChange={(e) => updateRow(idx, { paid: e.target.checked })} className="mt-1" />
                    <span>Đã trả {formatVND(r.vnd_value)} cho Backer này.</span>
                  </label>
                </div>
              ))}
            </div>

            <div className="text-xs text-destructive font-semibold">
              ⚠️ Phải tick xác nhận đã trả cho TẤT CẢ Backer + Player trước khi xác nhận.
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Đóng</Button>
          <Button onClick={submit} disabled={!canSubmit} variant="destructive">
            {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Xác nhận đã giải ngân
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ---------------- TAB 5: TRANH CHẤP ---------------- */
const DisputeTab = ({ cashierOnlyUserId }: { cashierOnlyUserId?: string | null }) => {
  const [rows, setRows] = useState<ReleaseDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<ReleaseDeal | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let allowedClubIds: string[] | null = null;
    if (cashierOnlyUserId) {
      const { data: myClubs } = await supabase.rpc("cashier_club_ids", { _user_id: cashierOnlyUserId });
      allowedClubIds = ((myClubs ?? []) as any[]).map((r: any) => (typeof r === "string" ? r : r.cashier_club_ids ?? r)).filter(Boolean);
      if (allowedClubIds.length === 0) { setRows([]); setLoading(false); return; }
    }
    let q = supabase
      .from("staking_deals")
      .select("id, player_id, backer_id, buy_in_amount_vnd, percentage_sold, filled_percent, markup, result_prize_vnd, backer_payout_vnd, player_payout_vnd, platform_fee_vnd, platform_percent_fee, platform_archive_fee, result_proof_url, placement, result_entered_at, result_data, override_data, status, completed_at")
      .eq("status", "result_disputed" as any)
      .order("result_entered_at", { ascending: true });
    if (allowedClubIds) q = q.in("club_id", allowedClubIds);
    const { data, error } = await q;
    if (error) { toast.error(error.message); setLoading(false); return; }
    const list = (data ?? []) as unknown as ReleaseDeal[];
    const ids = Array.from(new Set([
      ...list.map((d) => d.player_id),
      ...list.map((d) => d.backer_id).filter(Boolean) as string[],
    ]));
    const { data: profs } = ids.length
      ? await supabase.from("profiles").select("user_id, display_name").in("user_id", ids)
      : { data: [] as any[] };
    const pMap = new Map<string, any>((profs ?? []).map((p: any) => [p.user_id, p]));
    setRows(list.map((d) => ({
      ...d,
      player: pMap.get(d.player_id) ?? null,
      backer: d.backer_id ? pMap.get(d.backer_id) ?? null : null,
    })));
    setLoading(false);
  }, [cashierOnlyUserId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const ch = supabase.channel("admin-dispute")
      .on("postgres_changes", { event: "*", schema: "public", table: "staking_deals" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-destructive/15 flex items-center justify-center">
            <AlertTriangle className="w-4.5 h-4.5 text-destructive" />
          </div>
          <div>
            <div className="text-base font-semibold leading-tight">Tranh chấp kết quả</div>
            <div className="text-xs text-muted-foreground">{rows.length} deal đang chờ xử lý</div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={() => exportToExcel(
            rows,
            [
              { header: "Deal ID", get: (d) => d.id },
              { header: "Player", get: (d) => d.player?.display_name ?? "" },
              { header: "Backer", get: (d) => d.backer?.display_name ?? "" },
              { header: "Buy-in (VND)", get: (d) => Number(d.buy_in_amount_vnd) },
              { header: "% bán", get: (d) => Number(d.percentage_sold) },
              { header: "Prize gốc (VND)", get: (d) => Number(d.result_prize_vnd ?? 0) },
              { header: "Override prize (VND)", get: (d) => Number(d.override_data?.prize_vnd ?? 0) },
              { header: "Override backer (VND)", get: (d) => Number(d.override_data?.backer_payout_vnd ?? 0) },
              { header: "Override player (VND)", get: (d) => Number(d.override_data?.player_payout_vnd ?? 0) },
              { header: "Lý do", get: (d) => d.override_data?.reason ?? "" },
              { header: "Placement", get: (d) => d.placement ?? "" },
              { header: "Nhập kết quả lúc", get: (d) => formatExcelDate(d.result_entered_at) },
            ],
            "disputes",
            "Disputes",
          )}>
            <Download className="w-3.5 h-3.5 mr-1" /> Xuất Excel
          </Button>
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Làm mới</Button>
        </div>
      </div>

      {loading ? <Skeleton className="h-64 rounded-xl" /> : rows.length === 0 ? (
        <div className="text-center py-16 rounded-xl border border-dashed border-border bg-card/30">
          <div className="text-3xl mb-2">✅</div>
          <div className="text-sm text-muted-foreground">Không có tranh chấp nào</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map((d) => {
            const prize = Number(d.result_prize_vnd ?? 0);
            return (
              <button key={d.id} onClick={() => setActive(d)}
                className={`group rounded-xl border text-left p-4 hover:border-destructive/60 hover:shadow-lg transition-all ${active?.id === d.id ? "border-destructive bg-destructive/5" : "border-border bg-card"}`}>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <Badge variant="outline" className="border-destructive/50 text-destructive text-[10px]">⚠ Tranh chấp</Badge>
                  <span className="font-mono text-[10px] text-muted-foreground">{d.id.slice(0,8)}</span>
                </div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs w-14 shrink-0">Player</span>
                    <b className="truncate">{d.player?.display_name ?? "—"}</b>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs w-14 shrink-0">Backer</span>
                    <span className="truncate">{d.backer?.display_name ?? "—"}</span>
                  </div>
                  <div className="flex items-center gap-2 pt-1.5 border-t border-border/50 mt-1.5">
                    <span className="text-muted-foreground text-xs w-14 shrink-0">Prize</span>
                    <b className="text-warning">{formatVND(prize)}</b>
                    {d.placement && <span className="text-xs text-muted-foreground ml-auto">#{d.placement}</span>}
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-border/50 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                  Mở để giải quyết →
                </div>
              </button>
            );
          })}
        </div>
      )}

      <DisputeResolutionDialog deal={active} onClose={() => setActive(null)} onDone={() => { setActive(null); load(); }} />
    </>
  );
};

const DisputeResolutionDialog = ({ deal, onClose, onDone }: { deal: ReleaseDeal | null; onClose: () => void; onDone: () => void }) => {
  const [overridePrize, setOverridePrize] = useState<string>("");
  const [overrideBacker, setOverrideBacker] = useState<string>("");
  const [overridePlayer, setOverridePlayer] = useState<string>("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (deal) {
      setOverridePrize("");
      const prize = Number(deal.result_prize_vnd ?? 0);
      const b = Math.round((prize * deal.percentage_sold) / 100);
      setOverrideBacker(String(b));
      setOverridePlayer(String(Math.max(0, prize - b)));
      setReason("");
    }
  }, [deal?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-recalc when override prize changes
  useEffect(() => {
    if (!deal) return;
    const op = Number(overridePrize);
    if (overridePrize && op > 0) {
      const b = Math.round((op * deal.percentage_sold) / 100);
      setOverrideBacker(String(b));
      setOverridePlayer(String(Math.max(0, op - b)));
    }
  }, [overridePrize, deal]);

  if (!deal) return null;
  const originalPrize = Number(deal.result_prize_vnd ?? 0);
  const opNum = overridePrize ? Math.max(0, Math.floor(Number(overridePrize))) : originalPrize;
  const ob = Math.max(0, Math.floor(Number(overrideBacker) || 0));
  const op = Math.max(0, Math.floor(Number(overridePlayer) || 0));
  const sumOk = ob + op === opNum;
  const reasonOk = reason.trim().length >= 20;

  const submit = async () => {
    if (!sumOk) { toast.error("Tổng phải bằng tiền thưởng"); return; }
    if (!reasonOk) { toast.error("Lý do tối thiểu 20 ký tự"); return; }
    setSubmitting(true);
    const body: any = {
      deal_id: deal.id,
      override_backer_amount: ob,
      override_player_amount: op,
      override_reason: reason.trim(),
    };
    if (overridePrize) body.override_prize = opNum;
    const { data, error } = await supabase.functions.invoke("staking-admin-override", { body });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    if ((data as any)?.error) { toast.error((data as any).error); return; }
    toast.success("Đã ghi đè. Chuyển sang Tab 'Thành tích & Thanh toán'.");
    onDone();
  };

  const origBacker = Math.round((originalPrize * deal.percentage_sold) / 100);
  const origPlayer = Math.max(0, originalPrize - origBacker);

  return (
    <Dialog open={!!deal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            Quyết định tranh chấp
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Xem kết quả Player nhập, sau đó nhập số tiền chia lại và lý do.
          </p>
        </DialogHeader>

        <div className="px-5 py-4 space-y-5">
          {/* Section 1: What player submitted (compact) */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Player đã nhập</div>
              <span className="text-[10px] text-muted-foreground">{deal.result_entered_at ? formatDateTime(deal.result_entered_at) : "—"}</span>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-3 grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-3">
              {deal.result_proof_url ? (
                <a href={deal.result_proof_url} target="_blank" rel="noreferrer" className="block sm:w-40 shrink-0">
                  <img src={deal.result_proof_url} alt="proof" className="w-full h-32 object-cover rounded-md border border-border hover:opacity-80 transition" />
                  <div className="text-[10px] text-center text-primary mt-1">Bấm để phóng to</div>
                </a>
              ) : (
                <div className="sm:w-40 h-32 rounded-md border border-dashed border-border flex items-center justify-center text-[10px] text-muted-foreground">Không có ảnh</div>
              )}
              <div className="text-xs space-y-1.5 self-center">
                <div className="flex justify-between"><span className="text-muted-foreground">Prize nhập</span><b>{formatVND(originalPrize)}</b></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Thứ hạng</span><b>{deal.placement ?? "—"}</b></div>
                <div className="pt-1.5 mt-1.5 border-t border-border/60 space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Backer (gốc)</span><span>{formatVND(origBacker)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Player (gốc)</span><span>{formatVND(origPlayer)}</span></div>
                </div>
              </div>
            </div>
          </section>

          {/* Section 2: Override decision */}
          <section className="space-y-3">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Quyết định ghi đè</div>

            <div>
              <Label className="text-xs">Override Prize <span className="text-muted-foreground font-normal">(để trống = giữ {formatVND(originalPrize)})</span></Label>
              <Input className="mt-1" inputMode="numeric" value={overridePrize} onChange={(e) => setOverridePrize(e.target.value)} placeholder={formatVND(originalPrize)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Backer nhận (VND)</Label>
                <Input className="mt-1" inputMode="numeric" value={overrideBacker} onChange={(e) => setOverrideBacker(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Player nhận (VND)</Label>
                <Input className="mt-1" inputMode="numeric" value={overridePlayer} onChange={(e) => setOverridePlayer(e.target.value)} />
              </div>
            </div>

            <div className={`rounded-md px-3 py-2 text-xs flex items-center justify-between ${sumOk ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
              <span>Tổng Backer + Player</span>
              <b>{formatVND(ob + op)} {sumOk ? "✓ khớp" : `≠ ${formatVND(opNum)}`}</b>
            </div>

            <div>
              <Label className="text-xs">Lý do ghi đè <span className="text-destructive">*</span> <span className="text-muted-foreground font-normal">(≥ 20 ký tự)</span></Label>
              <Textarea className="mt-1" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mô tả chi tiết lý do ghi đè kết quả của Player..." />
              <div className={`text-[10px] mt-1 text-right ${reasonOk ? "text-success" : "text-muted-foreground"}`}>{reason.trim().length} / 20</div>
            </div>
          </section>
        </div>

        <DialogFooter className="px-5 py-3 border-t border-border bg-muted/10 sticky bottom-0">
          <Button variant="outline" onClick={onClose} disabled={submitting}>Đóng</Button>
          <Button onClick={submit} disabled={submitting || !sumOk || !reasonOk} className="gradient-neon text-primary-foreground">
            {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Áp dụng & Tạo y/c giải ngân
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AdminStaking;
