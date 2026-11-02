import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ChipDisc } from "./ChipDisc";
import { ArrowDown, ArrowUp, Loader2, Vault, Zap, RefreshCw, Info } from "lucide-react";
import { parseChipCountInput } from "./bankInput";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { chipBankAdjustmentArgs,parseChipBankAdjustmentReceipt,type ChipBankAdjustmentIntent } from '@/lib/chipBankAdjustmentReceipt';
import { observeTrackerContextRead } from '@/lib/tournament/observeTrackerContextRead';
import { waitForManualPlayerResponse } from '@/lib/floorManualPlayerIntent';

// chip_ops_* bank objects are applied live but not in generated types.
type BankRpcResponse={data:Record<string,unknown>|null;error:{code?:string}|null};
type AbortableRead<T>=PromiseLike<T>&{abortSignal:(signal:AbortSignal)=>PromiseLike<T>};
const sb = supabase as unknown as {
  rpc: (fn: string, args: Record<string, unknown>) => AbortableRead<BankRpcResponse>;
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        order: (column: string, options: { ascending: boolean }) => {
          limit: (count: number) => AbortableRead<{ data: LedgerRow[] | null; error: unknown }>;
        };
      };
    };
  };
};
const fmt = (n: number) => (n ?? 0).toLocaleString("vi-VN");
const ERR: Record<string, string> = {
  Forbidden: "Bạn không có quyền.",
  Unauthorized: "Bạn chưa đăng nhập.",
  BANK_NEGATIVE: "Không đủ chip trong két để xuất (thủ công).",
  race_lost: "Số liệu vừa thay đổi, mở lại và thử lại.",
  DENOM_NOT_IN_CLUB: "Mệnh giá không thuộc CLB.",
  INVALID_INPUT: "Dữ liệu nhập chưa hợp lệ.",
};
// bank-ledger reason → friendly label
const REASON: Record<string, string> = {
  manual: "Thủ công",
  couple_issuance: "Phát chip (tự động)",
  couple_color_up: "Color-up (tự động)",
  couple_color_up_reverse: "Hoàn color-up (tự động)",
  sync: "Đồng bộ",
};

interface BankDenom { denomination_id: string; value: number; color: string | null; on_hand_count: number; version: number }
interface LedgerRow { id: string; denomination_id: string; direction: string; count: number; balance_after: number; reason: string | null; created_at: string }
interface SyncRow { denomination_id: string; total: number; in_play: number; on_hand: number }
type PendingAdjustment=ChipBankAdjustmentIntent;

const pendingKey = (clubId: string) => `vinpoker:chip-bank-pending:${clubId}`;

type PendingRead = {pending:PendingAdjustment|null;error:boolean};
function readPending(clubId: string | null, actorId: string): PendingRead {
  if (!clubId) return {pending:null,error:false};
  try {
    const raw = sessionStorage.getItem(pendingKey(clubId));
    if (raw === null) return {pending:null,error:false};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {pending:null,error:true};
    const command = value as PendingAdjustment;
    const valid=command.actorId === actorId && command.clubId === clubId && typeof command.requestId === "string" && !!command.requestId &&
      typeof command.denominationId === "string" && !!command.denominationId && Number.isSafeInteger(command.count) &&
      command.count > 0 && Number.isSafeInteger(command.oldVersion) && command.oldVersion>=0 &&
      (command.tournamentId===null||typeof command.tournamentId==='string'&&!!command.tournamentId) &&
      (command.direction === "thu" || command.direction === "xuat");
    return valid?{pending:command,error:false}:{pending:null,error:true};
  } catch { return {pending:null,error:true}; }
}

async function callRpc(fn: string, args: Record<string, unknown>, isCurrent:()=>boolean): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await sb.rpc(fn, args);
    if (!isCurrent()) return null;
    if (error) {
      toast.error(error.code === "PGRST202" ? "Máy chủ chưa có chức năng két chip." : "Không kết nối được dữ liệu két chip. Vui lòng thử lại.");
      return null;
    }
    if (data?.error) {
      const code = typeof data.error === "string" ? data.error : "INVALID_INPUT";
      toast.error(ERR[code] ?? code);
      return null;
    }
    if (data == null) { toast.error("Máy chủ không xác nhận thao tác két chip."); return null; }
    return data;
  } catch { if(isCurrent())toast.error("Có lỗi xảy ra, thử lại."); return null; }
}

// on-hand count: negative = a deficit (ghi nợ) under auto-coupling → render red.
function OnHand({ n, className = "" }: { n: number; className?: string }) {
  const neg = n < 0;
  return <span className={`tabular-nums ${neg ? "text-destructive" : "text-foreground"} ${className}`}>{fmt(n)}{neg ? " (ghi nợ)" : ""}</span>;
}

/** Két / Audit — club chip bank: balances + manual xuất/thu + auto-coupling (Model A) toggle + đồng bộ + log. */
export function BankAuditTab({ clubId, tournamentId }: { clubId: string | null; tournamentId: string }) {
  const {user,session,loading,rolesLoading,authError,rolesError}=useAuth();
  const epoch=sessionReadEpoch(session);
  if(!user||!session||loading||rolesLoading||authError||rolesError){
    return <p role="alert" className="p-3 text-sm text-warning">Chưa xác minh phiên đăng nhập để đọc hoặc thao tác két chip. Giữ nguyên lệnh đang chờ.</p>;
  }
  return <ScopedBankAuditTab key={JSON.stringify([user.id,epoch,clubId,tournamentId])} actorId={user.id} clubId={clubId} tournamentId={tournamentId}/>;
}

function ScopedBankAuditTab({actorId,clubId,tournamentId}:{actorId:string;clubId:string|null;tournamentId:string}){
  const alive=useRef(false),lifetime=useRef<object>({});
  const readFlight=useRef<AbortController|null>(null),receiptReadFlight=useRef<AbortController|null>(null);
  useEffect(()=>{
    alive.current=true;
    return()=>{alive.current=false;lifetime.current={};readFlight.current?.abort();receiptReadFlight.current?.abort();};
  },[]);
  const [bank, setBank] = useState<BankDenom[]>([]);
  const [coupling, setCoupling] = useState(false);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denomId, setDenomId] = useState("");
  const [dir, setDir] = useState<"thu" | "xuat">("thu");
  const [count, setCount] = useState("");
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncTotals, setSyncTotals] = useState<Record<string, string>>({});
  const [syncResult, setSyncResult] = useState<{ rows: SyncRow[]; tours: { name: string | null }[] } | null>(null);
  const [journal,setJournal]=useState<PendingRead>(()=>readPending(clubId,actorId));
  const pendingAdjustment=journal.pending;
  const journalError=journal.error;
  const requestSequence = useRef(0);
  const adjustmentInFlight = useRef(false);
  const activeClub = useRef(clubId);
  activeClub.current = clubId;

  const reload = useCallback(async () => {
    readFlight.current?.abort();
    const controller=new AbortController();readFlight.current=controller;
    const request = ++requestSequence.current;
    const token=lifetime.current,isCurrent=()=>alive.current&&lifetime.current===token&&request===requestSequence.current&&readFlight.current===controller;
    if (!clubId) { setBank([]); setLedger([]); setCoupling(false); setLoadError(false); setLoading(false);readFlight.current=null;controller.abort(); return; }
    setLoading(true);
    try {
      const {b,lg}=await observeTrackerContextRead((async()=>{
        const {data:b,error:bankError}=await sb.rpc('get_chip_bank',{p_club_id:clubId}).abortSignal(controller.signal);
        if(controller.signal.aborted)throw Error('BANK_READ_ABORTED');
        if(bankError||!b||b.error||!Array.isArray(b.denominations))throw Error('BANK_READ_UNVERIFIED');
        const {data:lg,error}=await sb.from('chip_bank_ledger')
          .select('id,denomination_id,direction,count,balance_after,reason,created_at')
          .eq('club_id',clubId).order('created_at',{ascending:false}).limit(50).abortSignal(controller.signal);
        if(error||!Array.isArray(lg))throw Error('BANK_LEDGER_UNVERIFIED');
        return {b,lg};
      })());
      if (!isCurrent() || clubId !== activeClub.current) return;
      setBank(b.denominations as BankDenom[]);
      setCoupling(!!b.coupling_enabled);
      setLedger(lg);
      setLoadError(false);
    } catch {
      if (isCurrent() && request === requestSequence.current && clubId === activeClub.current) { toast.error("Không tải được dữ liệu két chip."); setLoadError(true); }
    } finally {
      if (isCurrent() && clubId === activeClub.current) {setLoading(false);readFlight.current=null;}
      controller.abort();
    }
  }, [clubId]);

  useEffect(() => {
    void reload();
    return () => { requestSequence.current += 1;readFlight.current?.abort(); };
  }, [reload]);

  useEffect(() => {
    setDenomId("");
    setCount("");
    setSyncTotals({});
    setSyncResult(null);
    setSyncOpen(false);
    setJournal(readPending(clubId,actorId));
  }, [clubId,actorId]);

  const valueOf = (id: string) => bank.find((d) => d.denomination_id === id)?.value ?? 0;
  const hasDeficit = useMemo(() => bank.some((d) => d.on_hand_count < 0), [bank]);

  const submit = async (mode:'apply'|'lookup'='apply') => {
    if (!alive.current || adjustmentInFlight.current || journalError) return;
    if(mode==='lookup'&&!pendingAdjustment)return;
    const token=lifetime.current,isCurrent=()=>alive.current&&lifetime.current===token;
    const n = parseChipCountInput(count);
    const d = bank.find((x) => x.denomination_id === denomId);
    if (!pendingAdjustment && (loadError || loading || !d || n === null)) {
      toast.error("Chọn mệnh giá và nhập số chip nguyên dương hợp lệ."); return;
    }
    const command = pendingAdjustment ?? {
      actorId,clubId: clubId!, tournamentId: tournamentId || null, denominationId: denomId,
      direction: dir, count: n!, oldVersion: d!.version, requestId: crypto.randomUUID(),
    };
    if (command.actorId!==actorId || command.clubId !== clubId) return;
    if (!pendingAdjustment) {
      try {
        const raw=JSON.stringify(command);
        sessionStorage.setItem(pendingKey(command.clubId),raw);
        if(sessionStorage.getItem(pendingKey(command.clubId))!==raw)throw Error('CHIP_BANK_JOURNAL_NOT_PERSISTED');
      }
      catch { toast.error("Không lưu được mã thử lại an toàn; chưa gửi lệnh chip."); return; }
      setJournal({pending:command,error:false});
    }
    adjustmentInFlight.current = true;
    setBusy(true);
    try {
      const args=chipBankAdjustmentArgs(command);
      let response:BankRpcResponse|null=null;
      if(pendingAdjustment){
        const controller=new AbortController();receiptReadFlight.current=controller;
        try{response=await observeTrackerContextRead(sb.rpc('get_chip_bank_adjust_receipt_v2',args).abortSignal(controller.signal));}
        finally{if(receiptReadFlight.current===controller)receiptReadFlight.current=null;controller.abort();}
        if(!isCurrent())return;
        if(response.error)throw Error('CHIP_BANK_RECEIPT_UNAVAILABLE');
        if(response.data===null){
          if(mode==='lookup'){
            toast.error('Chưa tìm thấy receipt; lệnh có thể vẫn đang xử lý. Giữ nguyên mã, chỉ thử lại đúng lệnh cũ.');return;
          }
          response=null;
        }
      }
      response??=await waitForManualPlayerResponse(Promise.resolve(sb.rpc('chip_ops_bank_adjust_v2',args)));
      if (!isCurrent() || clubId !== activeClub.current) return;
      if(response.error)throw Error('CHIP_BANK_RESPONSE_UNAVAILABLE');
      const receipt=parseChipBankAdjustmentReceipt(response.data,command);
      if(sessionStorage.getItem(pendingKey(command.clubId))!==JSON.stringify(command))throw Error('CHIP_BANK_JOURNAL_CHANGED');
      sessionStorage.removeItem(pendingKey(command.clubId));
      if(sessionStorage.getItem(pendingKey(command.clubId))!==null)throw Error('CHIP_BANK_JOURNAL_CLEAR_FAILED');
      setJournal({pending:null,error:false});setCount('');
      if(receipt.outcome==='applied'){
        toast.success(command.direction === "thu" ? "Đã thu chip vào két." : "Đã xuất chip khỏi két.");
      } else {
        toast.error(ERR[receipt.error]??receipt.error);
      }
      void reload();
    } catch {
      if (isCurrent() && clubId === activeClub.current) toast.error("Chưa xác minh được receipt lệnh chip. Giữ nguyên mã, đối chiếu lệnh cũ trước khi thử lại; không tạo lệnh mới.");
    } finally { if(isCurrent()){adjustmentInFlight.current = false; setBusy(false);} }
  };

  const toggleCoupling = async (enabled: boolean) => {
    if (!alive.current || loadError || loading || journalError || pendingAdjustment) return;
    const token=lifetime.current,isCurrent=()=>alive.current&&lifetime.current===token;
    setBusy(true);
    const r = await callRpc("chip_ops_set_bank_coupling", { p_club_id: clubId, p_enabled: enabled },isCurrent);
    if (!isCurrent() || clubId !== activeClub.current) return;
    if (r?.status === "ok") { setCoupling(enabled); toast.success(enabled ? "Đã bật két tự động." : "Đã tắt két tự động."); }
    else if (r && !r.error) toast.error("Máy chủ chưa xác nhận thay đổi két tự động.");
    setBusy(false);
  };

  const runSync = async () => {
    if (!alive.current || loadError || loading || journalError || pendingAdjustment) return;
    const token=lifetime.current,isCurrent=()=>alive.current&&lifetime.current===token;
    const entered = bank.filter((d) => (syncTotals[d.denomination_id] ?? "").trim() !== "");
    if (entered.some((d) => parseChipCountInput(syncTotals[d.denomination_id], true) === null)) {
      toast.error("Tổng sở hữu phải là số chip nguyên không âm; không thể bỏ qua mệnh giá nhập sai.");
      return;
    }
    const totals = entered.map((d) => ({
      denomination_id: d.denomination_id,
      total: parseChipCountInput(syncTotals[d.denomination_id], true)!,
    }));
    if (totals.length === 0) { toast.error("Nhập tổng số chip sở hữu cho ít nhất một mệnh giá."); return; }
    setBusy(true);
    const r = await callRpc("chip_ops_bank_sync", { p_club_id: clubId, p_totals: totals },isCurrent);
    if (!isCurrent() || clubId !== activeClub.current) return;
    if (r?.status === "ok") {
      setSyncResult({ rows: (r.denominations ?? []) as SyncRow[], tours: (r.tournaments_counted ?? []) as { name: string | null }[] });
      toast.success("Đã đồng bộ kho két.");
      void reload();
    }
    else if (r && !r.error) toast.error("Máy chủ chưa xác nhận đồng bộ két chip. Hãy tải lại trước khi thử tiếp.");
    setBusy(false);
  };

  if (!clubId) {
    return <Card className="border-border"><CardContent className="py-8 text-sm text-muted-foreground">Chọn một giải để xác định CLB của két.</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      {journalError&&<p role="alert" className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
        Không đọc được mã lệnh két đã lưu hoặc chưa xác minh người tạo lệnh. Chưa thể gửi lệnh mới, đổi két tự động hoặc đồng bộ. Giữ nguyên dữ liệu để đối chiếu lệnh cũ; không tự nhận lệnh từ tài khoản khác.
      </p>}
      {loadError && (
        <Card className="border-destructive/50"><CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm text-destructive">
          Không tải được dữ liệu két chip. Số tồn và nhật ký cũ không được xem là số hiện tại.
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>Thử lại</Button>
        </CardContent></Card>
      )}
      {pendingAdjustment && (
        <Card className="border-warning/50"><CardContent className="py-3 text-sm text-warning">
          Có lệnh {pendingAdjustment.direction === "thu" ? "Thu" : "Xuất"} {fmt(pendingAdjustment.count)} chip chưa rõ kết quả. Chỉ thử lại lệnh cũ; không đổi mệnh giá hoặc số chip.
          <Button variant="outline" size="sm" className="mt-2" disabled={busy} onClick={()=>void submit('lookup')}>Đối chiếu lệnh cũ</Button>
        </CardContent></Card>
      )}
      {/* auto-coupling (Model A) */}
      <Card className="border-border">
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Zap className={`h-4 w-4 ${coupling ? "text-primary" : "text-muted-foreground"}`} />
              <div>
                <div className="text-sm font-medium text-foreground">Két tự động (Model A)</div>
                <div className="text-xs text-muted-foreground">Phát chip tự trừ két · color-up tự thu/xuất.</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={busy || loading || loadError || journalError || !!pendingAdjustment} onClick={() => { setSyncResult(null); setSyncOpen(true); }}>
                <RefreshCw className="h-4 w-4" /> Đồng bộ kho két
              </Button>
              <Switch checked={coupling} disabled={busy || loading || loadError || journalError || !!pendingAdjustment} onCheckedChange={toggleCoupling} aria-label="Bật két tự động" />
            </div>
          </div>
          {coupling && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/10 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <div>
                Đang BẬT: mỗi lần <b className="text-foreground">phát stack</b> sẽ tự <b className="text-foreground">xuất</b> chip khỏi két, và <b className="text-foreground">color-up</b> tự <b className="text-foreground">thu</b> chip nhỏ về + <b className="text-foreground">xuất</b> chip lớn. Két thiếu thì hiện <span className="text-destructive">ghi nợ</span> (vẫn cho làm). Hãy bấm <b className="text-foreground">Đồng bộ kho két</b> để số trong két khớp thực tế.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base text-foreground"><Vault className="h-4 w-4 text-primary" /> Tồn kho két chip (CLB)</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-20 w-full" /> : loadError ? (
            <p className="text-sm text-destructive">Không thể xác nhận tồn kho. Hãy thử tải lại trước khi thao tác.</p>
          ) : bank.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có mệnh giá trong CLB (hoặc tính năng két chưa bật trên máy chủ). Tạo bộ chip ở tab <b className="text-foreground">Setup stack</b> trước.</p>
          ) : (
            <div className="flex flex-wrap gap-5">
              {bank.map((d) => (
                <div key={d.denomination_id} className="flex w-20 flex-col items-center gap-2">
                  <ChipDisc value={d.value} color={d.color} size={48} />
                  <div className="font-display text-sm font-bold"><OnHand n={d.on_hand_count} /></div>
                  <div className="text-[11px] text-muted-foreground">T{fmt(d.value)}</div>
                </div>
              ))}
            </div>
          )}
          {!loading && !loadError && hasDeficit && <p className="mt-3 text-xs text-destructive">Có mệnh giá đang <b>ghi nợ</b> (két âm) — nạp thêm chip hoặc đồng bộ lại kho két.</p>}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">Xuất / Thu thủ công</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label className="text-xs">Mệnh giá</Label>
            <Select value={pendingAdjustment?.denominationId ?? denomId} onValueChange={setDenomId} disabled={journalError || !!pendingAdjustment || loading || loadError}>
              <SelectTrigger><SelectValue placeholder="Chọn mệnh giá" /></SelectTrigger>
              <SelectContent>{bank.map((d) => <SelectItem key={d.denomination_id} value={d.denomination_id}>T{fmt(d.value)} · tồn {fmt(d.on_hand_count)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Chiều</Label>
            <Select value={pendingAdjustment?.direction ?? dir} onValueChange={(v) => setDir(v as "thu" | "xuat")} disabled={journalError || !!pendingAdjustment || loading || loadError}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="thu">Thu vào</SelectItem>
                <SelectItem value="xuat">Xuất ra</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Số chip</Label>
            <Input type="number" inputMode="numeric" value={pendingAdjustment?.count ?? count} onChange={(e) => setCount(e.target.value)} placeholder="0" className="w-32" disabled={journalError || !!pendingAdjustment || loading || loadError} />
          </div>
          <Button onClick={()=>void submit()} disabled={journalError || busy || (!pendingAdjustment && (loading || loadError || !denomId || !count))}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : dir === "thu" ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
            {pendingAdjustment ? "Thử lại lệnh cũ" : dir === "thu" ? "Thu" : "Xuất"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">Nhật ký xuất / thu</CardTitle></CardHeader>
        <CardContent>
          {loading || loadError ? (
            <p className="text-sm text-muted-foreground">Nhật ký chưa được xác nhận. Hãy tải lại dữ liệu két chip.</p>
          ) : ledger.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có sự kiện nào.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Thời gian</TableHead><TableHead>Mệnh giá</TableHead><TableHead>Chiều</TableHead>
                <TableHead>Nguồn</TableHead><TableHead className="text-right">Số chip</TableHead><TableHead className="text-right">Tồn sau</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {ledger.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("vi-VN")}</TableCell>
                    <TableCell className="tabular-nums">T{fmt(valueOf(e.denomination_id))}</TableCell>
                    <TableCell>{e.direction === "thu" ? <span className="text-primary">Thu</span> : <span className="text-warning">Xuất</span>}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{REASON[e.reason ?? "manual"] ?? e.reason}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(e.count)}</TableCell>
                    <TableCell className="text-right"><OnHand n={e.balance_after} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Đồng bộ kho két */}
      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Đồng bộ kho két</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Nhập <b className="text-foreground">tổng số chip CLB sở hữu</b> mỗi mệnh giá. App tự trừ phần đang chơi (các giải đang chạy) để ra số còn trong két.</p>
          <div className="space-y-2">
            {bank.map((d) => (
              <div key={d.denomination_id} className="flex items-center gap-3">
                <ChipDisc value={d.value} color={d.color} size={32} />
                <span className="w-16 shrink-0 text-sm tabular-nums text-muted-foreground">T{fmt(d.value)}</span>
                <Input type="number" inputMode="numeric" min={0} value={syncTotals[d.denomination_id] ?? ""}
                  onChange={(e) => setSyncTotals((s) => ({ ...s, [d.denomination_id]: e.target.value }))}
                  placeholder="tổng sở hữu" className="h-9" />
              </div>
            ))}
          </div>
          {syncResult && (
            <div className="rounded-lg border border-border p-3 text-xs">
              <div className="mb-1 text-muted-foreground">Đã tính (đang chơi ở: {syncResult.tours.map((t) => t.name ?? "—").join(", ") || "không có giải đang chạy"}):</div>
              <Table>
                <TableHeader><TableRow><TableHead>Mệnh giá</TableHead><TableHead className="text-right">Sở hữu</TableHead><TableHead className="text-right">Đang chơi</TableHead><TableHead className="text-right">Trong két</TableHead></TableRow></TableHeader>
                <TableBody>
                  {syncResult.rows.map((r) => (
                    <TableRow key={r.denomination_id}>
                      <TableCell className="tabular-nums">T{fmt(valueOf(r.denomination_id))}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.total)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(r.in_play)}</TableCell>
                      <TableCell className="text-right"><OnHand n={r.on_hand} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSyncOpen(false)}>Đóng</Button>
            <Button disabled={busy || loading || loadError} onClick={runSync}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Đồng bộ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
