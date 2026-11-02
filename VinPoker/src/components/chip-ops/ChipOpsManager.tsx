import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Coins, CheckCircle2, AlertTriangle, Lock, Plus, Trash2, Loader2, Link2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardTab } from "./DashboardTab";
import { BankAuditTab } from "./BankAuditTab";
import { ColorUpTab } from "./ColorUpTab";
import { BagTagTab } from "./BagTagTab";
import { IssuanceCard } from "./IssuanceCard";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import {useChipSetupMetadata} from './useChipSetupMetadata';
import { CreateChipSetControl } from "./CreateChipSetControl";
import { TemplateSaveControl } from './TemplateSaveControl';
import type {ChipTemplateSaveScope} from '@/lib/chipTemplateSaveIntent';
import { createChipSetupWriteGate, type AcquireChipSetupWrite } from '@/lib/chipSetupWriteGate';
import { assertCurrentChipDenominations } from '@/lib/chipInventoryRead';

// The chip_ops_* tables/RPCs are applied live but not yet in the generated Database types,
// so all reads/writes go through this loosely-typed client. Strictly additive feature.
const sb = supabase as any;

interface TourRow { id: string; name: string | null; club_id: string | null; }
interface Denom { id: string; value: number; color: string | null; label: string | null; display_order: number; }
interface TemplateRow { id: string; name: string; stack_value: number; lines: { denomination_id: string; count: number }[]; issued_count: number; }
interface InvDenom { denomination_id: string; value: number; color: string | null; issued_count_total: number; current_count?: number; }
interface Inventory { denominations: InvDenom[]; total_value: number; reconciliation_value: number; reconciled: boolean; error?: string; }

const fmt = (n: number) => (n ?? 0).toLocaleString("vi-VN");

// Map server error codes → friendly Vietnamese.
const ERR: Record<string, string> = {
  Unauthorized: "Bạn chưa đăng nhập.",
  Forbidden: "Bạn không có quyền thực hiện.",
  NAME_EXISTS: "Tên này đã tồn tại.",
  VALUE_EXISTS: "Mệnh giá này đã có trong bộ chip.",
  DENOM_IN_USE: "Mệnh giá đang được một mẫu stack dùng — không xoá được.",
  DENOM_NOT_FOUND: "Không tìm thấy mệnh giá.",
  NO_CHIP_SET_BINDING: "Giải chưa được gán bộ chip.",
  DENOM_NOT_IN_SET: "Mệnh giá không thuộc bộ chip của giải.",
  DUPLICATE_DENOM: "Trùng mệnh giá trong cùng một mẫu.",
  STACK_SUM_MISMATCH: "Tổng chip không khớp giá trị stack.",
  BINDING_LOCKED_TEMPLATES_EXIST: "Đã có mẫu stack — không đổi bộ chip được nữa.",
  CHIP_SET_CLUB_MISMATCH: "Bộ chip không thuộc CLB của giải.",
  CHIP_SET_NOT_FOUND: "Không tìm thấy bộ chip.",
  TOURNAMENT_NOT_FOUND: "Không tìm thấy giải.",
  TEMPLATE_NOT_FOUND: "Không tìm thấy mẫu stack.",
  INVALID_INPUT: "Dữ liệu nhập chưa hợp lệ.",
  CHIP_SET_BINDING_CHANGED_RELOAD: 'Liên kết bộ chip đã thay đổi. Hãy đọc lại trước khi thao tác.',
  CHIP_SET_BINDING_SCOPE_INVALID: 'Liên kết bộ chip không nhất quán với CLB. Cần kiểm tra dữ liệu.',
};

export function ChipOpsManager() {
  const { t } = useTranslation();
  const { user, isClubOwner, isChipMaster, loading: authLoading, rolesLoading, authError, rolesError } = useAuth();
  const allowed = isClubOwner || isChipMaster;
  const authorityScope = JSON.stringify([user?.id, isClubOwner, isChipMaster, authLoading, rolesLoading, authError, rolesError]);
  const [params, setParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState("overview");

  const [toursSnapshot, setToursSnapshot] = useState<{ scope: string; rows: TourRow[] } | null>(null);
  const tours = useMemo(() => toursSnapshot?.scope === authorityScope ? toursSnapshot.rows : [], [toursSnapshot, authorityScope]);
  const toursReady = toursSnapshot?.scope === authorityScope;
  const [tournamentId, setTournamentId] = useState<string>(params.get("t") ?? "");
  const tour = useMemo(() => tours.find((t) => t.id === tournamentId) ?? null, [tours, tournamentId]);

  const [loading, setLoading] = useState(false);
  const [boundChipSetId, setBoundChipSetId] = useState<string | null>(null);
  const [clubChipSets, setClubChipSets] = useState<{ id: string; name: string }[]>([]);
  const [denoms, setDenoms] = useState<Denom[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [coupling, setCoupling] = useState(false);
  const [busyState, setBusyState] = useState<{key:string;value:boolean}|null>(null);
  const [readError, setReadError] = useState<{ scope: { key: string }; code: string } | null>(null);
  const [loadedScope, setLoadedScope] = useState<{ key: string } | null>(null);
  const scopeKey = JSON.stringify([authorityScope, tournamentId, tour?.club_id]);
  const busy=busyState?.key===scopeKey&&busyState.value;
  const setBusy=useCallback((value:boolean)=>setBusyState({key:scopeKey,value}),[scopeKey]);
  const [creationBlock,setCreationBlock]=useState<{key:string;blocked:boolean}|null>(null);
  const creationBlocked=creationBlock?.key===scopeKey&&creationBlock.blocked;
  const onCreationBlock=useCallback((blocked:boolean)=>setCreationBlock({key:scopeKey,blocked}),[scopeKey]);
  const [templateBlock,setTemplateBlock]=useState<{key:string;blocked:boolean}|null>(null);
  const templateBlocked=templateBlock?.key===scopeKey&&templateBlock.blocked;
  const onTemplateBlock=useCallback((blocked:boolean)=>setTemplateBlock({key:scopeKey,blocked}),[scopeKey]);
  const [metadataBlock,setMetadataBlock]=useState<{key:string;blocked:boolean}|null>(null);
  const metadataBlocked=metadataBlock?.key===scopeKey&&metadataBlock.blocked;
  const onMetadataBlock=useCallback((blocked:boolean)=>setMetadataBlock({key:scopeKey,blocked}),[scopeKey]);
  const scopeRef = useRef({ key: scopeKey });
  if (scopeRef.current.key !== scopeKey) scopeRef.current = { key: scopeKey };
  const acquireWrite=useMemo(()=>{
    const scope=scopeRef.current;
    return createChipSetupWriteGate(value=>{if(scopeRef.current===scope)setBusy(value);});
  },[setBusy]);
  const requestRef = useRef(0);
  const workspaceRead = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current += 1; workspaceRead.current?.abort(); }, [scopeKey]);

  // load tournaments (RLS-scoped)
  useEffect(() => {
    let active = true;
    setToursSnapshot(null);
    if (!user?.id || authLoading || rolesLoading || authError || rolesError || !allowed) return;
    const controller = new AbortController();
    observeTrackerContextRead(sb.from("tournaments").select("id,name,club_id,start_time").is("deleted_at", null)
      .order("start_time", { ascending: false }).limit(200).abortSignal(controller.signal))
      .then(({ data, error }: any) => {
        if (!active) return;
        if (error || !Array.isArray(data)) { setReadError({ scope: scopeRef.current, code: "READ_FAILED" }); return; }
        setToursSnapshot({ scope: authorityScope, rows: data.map((row: any) => ({ id: row.id, name: row.name, club_id: row.club_id })) });
      }).catch(() => { if (active) setReadError({ scope: scopeRef.current, code: "READ_FAILED" }); })
      .finally(() => controller.abort());
    return () => { active = false; controller.abort(); };
  }, [user?.id, allowed, authLoading, rolesLoading, authError, rolesError, authorityScope]);

  const reload = useCallback(async (tid: string) => {
    if (!tid) { setBoundChipSetId(null); setDenoms([]); setTemplates([]); setInv(null); setClubChipSets([]); return; }
    if (!user?.id || !allowed || authLoading || rolesLoading || authError || rolesError || !tour?.club_id || tour.id !== tid) return;
    const scope = scopeRef.current;
    const request = ++requestRef.current;
    workspaceRead.current?.abort();
    const controller = new AbortController();
    workspaceRead.current = controller;
    const isCurrent = () => scopeRef.current === scope && requestRef.current === request && !controller.signal.aborted;
    setLoading(true);
    setReadError(null);
    try {
      const snapshot = await observeTrackerContextRead((async () => {
      const t = tours.find((x) => x.id === tid);
      const clubId = t?.club_id ?? null;

      // Independent, server-authorized reads share the same captured scope.
      // Publish only after every metadata and inventory read has been verified.
      const readInventory = async () => {
        const current = await sb.rpc("get_current_chip_inventory", { p_tournament_id: tid }).abortSignal(controller.signal);
        if (!isCurrent()) throw new Error("chip_workspace_read_cancelled");
        if (current.error?.code === "PGRST202") {
          const issued = await sb.rpc("get_issued_chip_inventory", { p_tournament_id: tid }).abortSignal(controller.signal);
          return { ...issued, legacyIssued: true };
        }
        return { ...current, legacyIssued: false };
      };
      const [binding, sets, templateRows, inventory, bank] = await Promise.all([
        sb.from("tournament_chip_set").select("chip_set_id").eq("tournament_id", tid).abortSignal(controller.signal).maybeSingle(),
        clubId ? sb.from("chip_set").select("id,name").eq("club_id", clubId).abortSignal(controller.signal).order("created_at", { ascending: true }) : Promise.resolve({ data: [] }),
        sb.from("stack_template").select("id,name,stack_value").eq("tournament_id", tid).abortSignal(controller.signal).order("stack_value", { ascending: true }),
        readInventory(),
        sb.rpc("get_chip_bank", { p_club_id: clubId }).abortSignal(controller.signal),
      ]);
      if (!isCurrent()) return;
      if (binding.error || sets.error || !Array.isArray(sets.data)) throw new Error("READ_FAILED");
      const bindRow = binding.data, setsRaw = sets.data;
      const csId: string | null = bindRow?.chip_set_id ?? null;
      const { data: tplRaw, error: templateError } = templateRows;
      if (templateError || !Array.isArray(tplRaw)) throw new Error("READ_FAILED");
      if (inventory.error || !inventory.data || inventory.data.error || !Array.isArray(inventory.data.denominations)) throw new Error(inventory.data?.error ?? "READ_FAILED");
      if (!inventory.legacyIssued) assertCurrentChipDenominations(inventory.data.denominations);
      if (bank.error || !bank.data || bank.data.error || typeof bank.data.coupling_enabled !== "boolean") throw new Error(bank.data?.error ?? "READ_FAILED");
      const tplIds = (tplRaw ?? []).map((x: any) => x.id);
      const [denomRows, lineRows, issueRows] = await Promise.all([
        csId ? sb.from("chip_set_denomination").select("id,value,color,label,display_order").eq("chip_set_id", csId).abortSignal(controller.signal).order("value", { ascending: true }) : Promise.resolve({ data: [], error: null }),
        tplIds.length ? sb.from("stack_template_line").select("stack_template_id,denomination_id,count").in("stack_template_id", tplIds).abortSignal(controller.signal) : Promise.resolve({ data: [], error: null }),
        tplIds.length ? sb.from("stack_template_issuance").select("stack_template_id,issued_count").in("stack_template_id", tplIds).abortSignal(controller.signal) : Promise.resolve({ data: [], error: null }),
      ]);
      if (!isCurrent()) return;
      if (denomRows.error || lineRows.error || issueRows.error || !Array.isArray(denomRows.data) || !Array.isArray(lineRows.data) || !Array.isArray(issueRows.data)) throw new Error("READ_FAILED");
      const nextDenoms: Denom[] = denomRows.data;
      const lines: any[] = lineRows.data, issu: any[] = issueRows.data;
      const nextTemplates = tplRaw.map((x: any) => ({
        id: x.id, name: x.name, stack_value: Number(x.stack_value),
        lines: lines.filter((ln) => ln.stack_template_id === x.id).map((ln) => ({ denomination_id: ln.denomination_id, count: Number(ln.count) })),
        issued_count: Number(issu.find((s) => s.stack_template_id === x.id)?.issued_count ?? 0),
      }));

      return { csId, setsRaw, nextDenoms, nextTemplates, inventory: inventory.data as Inventory, coupling: bank.data.coupling_enabled };
      })());
      if (!snapshot || !isCurrent()) return;
      setBoundChipSetId(snapshot.csId);
      setClubChipSets((snapshot.setsRaw ?? []).map((s: any) => ({ id: s.id, name: s.name })));
      setDenoms(snapshot.nextDenoms);
      setTemplates(snapshot.nextTemplates);
      setInv(snapshot.inventory);
      setCoupling(snapshot.coupling);
      setLoadedScope(scope);
    } catch (error) {
      if (isCurrent()) setReadError({ scope, code: error instanceof Error ? error.message : "READ_FAILED" });
    } finally {
      if (isCurrent()) setLoading(false);
      controller.abort();
      if (workspaceRead.current === controller) workspaceRead.current = null;
    }
  }, [tours, user?.id, allowed, authLoading, rolesLoading, authError, rolesError, tour, scopeKey]);

  useEffect(() => { if (tournamentId) reload(tournamentId); }, [tournamentId, reload]);

  const onPick = (id: string) => {
    setTournamentId(id);
    const next = new URLSearchParams(params); next.set("t", id); setParams(next, { replace: true });
  };

  if (authLoading || rolesLoading) {
    return <div role="status" aria-live="polite" className="space-y-3">
      <p className="text-sm text-muted-foreground">Đang xác minh quyền Chip Ops…</p>
      <LoadingCard />
    </div>;
  }
  if (authError || rolesError) {
    return <Card><CardContent className="space-y-3 py-8" role="alert">
      <p>Chưa xác minh được quyền Chip Ops. Vui lòng tải lại để thử lại.</p>
      <Button variant="outline" onClick={() => window.location.reload()}>Thử tải lại</Button>
    </CardContent></Card>;
  }
  if (!allowed) {
    return (
      <Card className="border-border"><CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
        <Lock className="w-5 h-5" /> Bạn không có quyền truy cập Chip Ops.
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Topbar — tournament picker shared across all tabs */}
      <div className="flex items-center gap-2">
        <Coins className="h-5 w-5 shrink-0 text-primary" />
        <Select value={tournamentId} onValueChange={onPick}>
          <SelectTrigger className="min-h-11 min-w-0 w-full sm:w-[340px] [&>span]:truncate"><SelectValue placeholder="Chọn giải đấu" /></SelectTrigger>
          <SelectContent>{tours.map((t) => <SelectItem key={t.id} value={t.id}>{t.name ?? t.id}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {readError?.scope === scopeRef.current || (tournamentId && toursReady && !tour) ? (
        <Card><CardContent role="alert" className="space-y-3 py-8">
          <p>{t("chipOpsRead.error", { defaultValue: "Không đọc được dữ liệu chip. Kho và trạng thái két chưa được xác minh." })}</p>
          {readError?.scope === scopeRef.current && readError.code === "Forbidden" && <p>{t("chipOpsRead.permission", { defaultValue: "Cần quyền Chip Master hoặc chủ CLB của giải này." })}</p>}
          <Button variant="outline" onClick={() => { if (tour) void reload(tournamentId); else window.location.reload(); }}>{t("chipOpsRead.retry", { defaultValue: "Thử tải lại" })}</Button>
        </CardContent></Card>
      ) : !tournamentId ? (
        <Card className="border-border"><CardContent className="py-8 text-sm text-muted-foreground">
          Chọn một giải đấu để xem tổng quan và cài đặt chip.
        </CardContent></Card>
      ) : loading || loadedScope !== scopeRef.current ? <LoadingCard /> : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="flex h-auto flex-wrap justify-start gap-1 [&>button]:min-h-11">
            <TabsTrigger value="overview">Tổng quan</TabsTrigger>
            <TabsTrigger value="setup">Setup stack</TabsTrigger>
            <TabsTrigger value="colorup">Color-Up</TabsTrigger>
            <TabsTrigger value="bagtag">Bag &amp; Tag</TabsTrigger>
            <TabsTrigger value="bank">Két / Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            {loading ? <LoadingCard /> : <DashboardTab tournamentId={tournamentId} inv={inv} denoms={denoms} />}
          </TabsContent>

          <TabsContent value="setup" className="mt-4 space-y-4">
            {loading ? <LoadingCard /> : (
              <>
                <ChipSetCard
                  key={JSON.stringify([authorityScope,tournamentId])}
                  actorId={user?.id??null} creationBusy={busy||!!templateBlocked||!!metadataBlocked} onCreationBlock={onCreationBlock} acquireWrite={acquireWrite}
                  recoveryBusy={busy||!!creationBlocked||!!templateBlocked} onMetadataBlock={onMetadataBlock}
                  tour={tour}
                  boundChipSetId={boundChipSetId}
                  clubChipSets={clubChipSets}
                  denoms={denoms}
                  busy={busy||!!creationBlocked||!!templateBlocked||!!metadataBlocked} setBusy={setBusy}
                  reload={() => reload(tournamentId)}
                />
                {tour?.club_id && user?.id && (
                  <TemplatesCard
                    key={JSON.stringify(['template',authorityScope,tournamentId])}
                    scope={{actorId:user.id,clubId:tour.club_id,tournamentId}}
                    chipSetId={boundChipSetId}
                    onPendingChange={onTemplateBlock}
                    acquireWrite={acquireWrite}
                    denoms={denoms}
                    templates={templates}
                    busy={busy||!!creationBlocked||!!metadataBlocked}
                    reload={() => reload(tournamentId)}
                  />
                )}
                {templates.length > 0 && (
                  <IssuanceCard
                    acquireWrite={acquireWrite}
                    actorId={user?.id ?? null} clubId={tour?.club_id ?? null} tournamentId={tournamentId}
                    templates={templates}
                    coupling={coupling}
                    opsStarted={!!(inv && (((inv as any).ledger_delta_value ?? 0) !== 0 || ((inv as any).rounding_total ?? 0) !== 0))}
                    busy={busy||!!creationBlocked||!!templateBlocked||!!metadataBlocked} setBusy={setBusy}
                    reload={() => reload(tournamentId)}
                  />
                )}
                <InventoryCard inv={inv} />
              </>
            )}
          </TabsContent>

          <TabsContent value="colorup" className="mt-4">
            <ColorUpTab tournamentId={tournamentId} clubId={tour?.club_id ?? null} onOpenSetup={() => setActiveTab("setup")} onInventoryChanged={() => { void reload(tournamentId); }} />
          </TabsContent>
          <TabsContent value="bagtag" className="mt-4">
            <BagTagTab tournamentId={tournamentId} clubId={tour?.club_id ?? null} />
          </TabsContent>
          <TabsContent value="bank" className="mt-4">
            <BankAuditTab clubId={tour?.club_id ?? null} tournamentId={tournamentId} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function LoadingCard() {
  return (
    <Card className="border-border"><CardContent className="space-y-3 py-6">
      <Skeleton className="h-6 w-1/3" /><Skeleton className="h-24 w-full" />
    </CardContent></Card>
  );
}

// ---------- Chip set + denominations ----------
function ChipSetCard({ tour, boundChipSetId, clubChipSets, denoms, busy, setBusy, reload,actorId,creationBusy,onCreationBlock,acquireWrite,recoveryBusy,onMetadataBlock }: {
  tour: TourRow | null; boundChipSetId: string | null; clubChipSets: { id: string; name: string }[];
  denoms: Denom[]; busy: boolean; setBusy: (b: boolean) => void; reload: () => void;
  actorId:string|null;creationBusy:boolean;onCreationBlock:(v:boolean)=>void;
  acquireWrite:AcquireChipSetupWrite;
  recoveryBusy:boolean;onMetadataBlock:(pending:boolean)=>void;
}) {
  const [pickSetId, setPickSetId] = useState("");
  const [dValue, setDValue] = useState("");
  const [dColor, setDColor] = useState("#1e88e5");

  const boundName = clubChipSets.find((s) => s.id === boundChipSetId)?.name;
  const metadata=useChipSetupMetadata({scope:actorId&&tour?.club_id?{actorId,clubId:tour.club_id,tournamentId:tour.id}:null,
    busy:recoveryBusy,acquireWrite,onPendingChange:onMetadataBlock,onResolved:receipt=>{
      if(receipt.outcome==='applied'){
        toast.success(receipt.payload.operation==='bind'?'Đã gán bộ chip.':receipt.payload.operation==='add'?'Đã thêm mệnh giá.':'Đã xoá mệnh giá.');
        if(receipt.payload.operation==='add')setDValue('');reload();
      }else if(receipt.outcome==='cancelled')toast.success('Đã hủy yêu cầu bộ chip chưa thực hiện.');
      else{toast.error(ERR[receipt.error]??('Yêu cầu bị từ chối: '+receipt.error));reload();}
    }});
  const locked=busy||metadata.blocked;
  const pendingPayload=metadata.pending?.payload;
  let pendingLabel='';
  if(pendingPayload?.operation==='bind')pendingLabel='Gán bộ chip';
  else if(pendingPayload?.operation==='add')pendingLabel='Thêm mệnh giá '+fmt(pendingPayload.value);
  else if(pendingPayload?.operation==='delete'){
    const value=denoms.find(d=>d.id===pendingPayload.denomination_id)?.value;
    pendingLabel='Xoá mệnh giá '+(value===undefined?pendingPayload.denomination_id:fmt(value));
  }

  const bindExisting = () => {
    if (!tour || !pickSetId || locked) return;
    metadata.submit({operation:'bind',chip_set_id:pickSetId,expected_chip_set_id:boundChipSetId});
  };
  const addDenom = () => {
    if(locked)return;
    const v = Number(dValue);
    if (!boundChipSetId || !Number.isSafeInteger(v) || v <= 0) { toast.error("Nhập mệnh giá nguyên > 0."); return; }
    metadata.submit({operation:'add',chip_set_id:boundChipSetId,value:v,color:dColor,label:null,display_order:denoms.length});
  };
  const delDenom = (id: string) => {
    if(locked||!boundChipSetId)return;
    metadata.submit({operation:'delete',chip_set_id:boundChipSetId,denomination_id:id});
  };

  return (
    <Card className="border-border">
      <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">1. Bộ chip</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <CreateChipSetControl scope={actorId&&tour?.club_id?{actorId,clubId:tour.club_id,tournamentId:tour.id}:null}
          bound={!!boundChipSetId} busy={creationBusy} setBusy={setBusy} acquireWrite={acquireWrite} onPendingChange={onCreationBlock} onCommitted={reload}/>
        {metadata.error&&<p role="alert" className="text-sm text-warning">{metadata.error}</p>}
        {metadata.pending&&<div className="space-y-2 rounded-lg border border-warning/30 p-3">
          <p className="break-words text-sm">Yêu cầu đang chờ: {pendingLabel}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={recoveryBusy||metadata.working} onClick={metadata.lookup}>Đối chiếu bộ chip</Button>
            <Button variant="outline" disabled={recoveryBusy||metadata.working} onClick={metadata.retry}>Gửi lại nguyên thay đổi</Button>
            <Button variant="outline" disabled={recoveryBusy||metadata.working} onClick={metadata.cancel}>Hủy yêu cầu bộ chip</Button>
          </div>
        </div>}
        {!metadata.pending&&metadata.error&&<Button variant="outline" disabled={recoveryBusy||metadata.working} onClick={metadata.readAgain}>Đọc lại yêu cầu bộ chip</Button>}
        {!boundChipSetId ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Giải này chưa có bộ chip. Tạo bộ mới hoặc gán bộ có sẵn của CLB.</p>
            {clubChipSets.length > 0 && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1"><Label className="text-xs">Hoặc gán bộ có sẵn</Label>
                  <Select value={pickSetId} onValueChange={setPickSetId} disabled={locked}>
                    <SelectTrigger><SelectValue placeholder="Chọn bộ chip" /></SelectTrigger>
                    <SelectContent>{clubChipSets.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                  </Select></div>
                <Button variant="secondary" onClick={bindExisting} disabled={locked || !pickSetId}><Link2 className="w-4 h-4" /> Gán</Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-foreground">Bộ chip: <span className="font-semibold">{boundName ?? boundChipSetId}</span></div>
            {denoms.length > 0 ? (
              <Table>
                <TableHeader><TableRow><TableHead>Màu</TableHead><TableHead>Mệnh giá</TableHead><TableHead className="text-right">Xoá</TableHead></TableRow></TableHeader>
                <TableBody>
                  {denoms.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell><span className="inline-block h-4 w-4 rounded-full border border-border" style={{ backgroundColor: d.color ?? "transparent" }} aria-hidden /></TableCell>
                      <TableCell className="tabular-nums">{fmt(d.value)}</TableCell>
                      <TableCell className="text-right"><Button size="icon" variant="ghost" disabled={locked} onClick={() => delDenom(d.id)} aria-label="Xoá"><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : <p className="text-sm text-muted-foreground">Chưa có mệnh giá. Thêm các mệnh giá (VD 100, 500, 1000, 5000).</p>}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end border-t border-border pt-3">
              <div><Label className="text-xs">Màu</Label><input type="color" disabled={locked} value={dColor} onChange={(e) => setDColor(e.target.value)} className="h-10 w-12 rounded border border-border bg-transparent p-1" /></div>
              <div className="flex-1"><Label className="text-xs">Mệnh giá</Label><Input type="number" inputMode="numeric" disabled={locked} value={dValue} onChange={(e) => setDValue(e.target.value)} placeholder="VD: 5000" /></div>
              <Button onClick={addDenom} disabled={locked || !dValue}><Plus className="w-4 h-4" /> Thêm mệnh giá</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Stack templates ----------
function TemplatesCard({ scope,chipSetId,onPendingChange,denoms, templates, busy, reload,acquireWrite }: {
  scope:ChipTemplateSaveScope;chipSetId:string|null;onPendingChange:(pending:boolean)=>void;
  denoms: Denom[]; templates: TemplateRow[]; busy: boolean; reload: () => void;
  acquireWrite:AcquireChipSetupWrite;
}) {
  const denomName = (id: string) => { const d = denoms.find((x) => x.id === id); return d ? fmt(d.value) : id; };

  return (
    <Card className="border-border">
      <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">2. Mẫu stack</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {templates.length > 0 && (
          <Table>
            <TableHeader><TableRow><TableHead>Tên</TableHead><TableHead>Thành phần</TableHead><TableHead className="text-right">Giá trị</TableHead></TableRow></TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.lines.map((l) => `${l.count}×${denomName(l.denomination_id)}`).join(" + ")}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(t.stack_value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <TemplateSaveControl scope={scope} chipSetId={chipSetId} denoms={denoms} busy={busy} acquireWrite={acquireWrite} onPendingChange={onPendingChange} onCommitted={reload}/>
      </CardContent>
    </Card>
  );
}


// ---------- Read-only inventory ----------
function InventoryCard({ inv }: { inv: Inventory | null }) {
  if (!inv) return null;
  return (
    <Card className="border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base text-foreground">Tồn kho chip đã phát</CardTitle>
        {inv.reconciled
          ? <Badge className="gap-1 border-primary/30 bg-primary/15 text-primary"><CheckCircle2 className="w-3.5 h-3.5" /> Khớp số</Badge>
          : <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Lệch số</Badge>}
      </CardHeader>
      <CardContent>
        {inv.denominations.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">Chưa có mẫu stack hoặc chưa phát bộ nào.</p>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Mệnh giá</TableHead><TableHead className="text-right">Số chip đã phát</TableHead></TableRow></TableHeader>
            <TableBody>
              {inv.denominations.map((d) => (
                <TableRow key={d.denomination_id}>
                  <TableCell className="flex items-center gap-2"><span className="inline-block h-4 w-4 rounded-full border border-border" style={{ backgroundColor: d.color ?? "transparent" }} aria-hidden /><span className="tabular-nums">{fmt(d.value)}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(d.current_count ?? d.issued_count_total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">Tổng giá trị</span>
          <span className="font-semibold tabular-nums text-foreground">{fmt(inv.total_value)}</span>
        </div>
        {!inv.reconciled && <p className="mt-2 text-xs text-destructive">Đối soát lệch: theo mệnh giá {fmt(inv.total_value)} ≠ theo mẫu stack {fmt(inv.reconciliation_value)}.</p>}
      </CardContent>
    </Card>
  );
}

export default ChipOpsManager;
