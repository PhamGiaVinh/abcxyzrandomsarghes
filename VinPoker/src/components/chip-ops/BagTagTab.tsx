import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";
import { chipOpsRpcErrorMessage } from "@/lib/chipOpsErrors";
import { canonicalVoiceJson } from "@/lib/trackerVoice/canonicalRequest";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Lock, Unlock, AlertTriangle, Plus, PackageCheck } from "lucide-react";

const sb = supabase as any;
const fmt = (n: number) => (n ?? 0).toLocaleString("vi-VN");
const ERR: Record<string, string> = {
  Unauthorized: "Bạn chưa đăng nhập.", Forbidden: "Bạn không có quyền.",
  TOURNAMENT_NOT_FOUND: "Không tìm thấy giải.",
  DAY_LOCKED: "Ngày đã khoá — mở lại ngày trước khi sửa.",
  REOPEN_FIRST: "Ngày đã khoá — mở lại ngày trước khi mở bao.",
  BAG_SEALED: "Bao đã niêm — mở bao trước khi sửa.",
  VARIANCE_NONZERO: "Còn người chưa đóng đủ chip — không khoá được (hoặc cần ký duyệt).",
  SIGNOFF_REASON_REQUIRED: "Cần nhập lý do ký duyệt.",
  BAG_CODE_TAKEN: "Mã bao đã dùng cho người khác.",
  NO_ACTIVE_SEAT: "Người chơi không còn ghế (đã bị loại?).",
  DAY_NOT_FOUND: "Chưa có ngày này.",
  HAND_IN_PROGRESS: "Còn hand đang chơi. Hoàn tất hoặc hủy hand đúng quy trình trước khi niêm bao/chốt ngày.",
  race_lost: "Số liệu vừa thay đổi, tải lại và thử lại.", INVALID_INPUT: "Dữ liệu chưa hợp lệ.",
};
type BagIntent = { p_tournament_id: string; p_day_number: number; p_operation: 'record'|'unseal'|'close'|'reopen';
  p_payload: Record<string, unknown>; p_request_id: string; p_expected_actor: string };

interface ReconPlayer { player_id: string; player_name: string | null; table_name: string | null; seat_number: number | null; expected: number; counted: number; variance: number; sealed: boolean; bag_code: string | null }
interface Bag { id: string; player_id: string; bag_code: string | null; stack_value: number; total_value: number; sealed: boolean }
interface Player { player_id: string; player_name: string | null; table_name: string | null; seat_number: number | null; chip_count: number }
interface BagState {
  day_number: number;
  day: { status: string; version: number; signed_off: boolean; signoff_reason: string | null };
  reconciliation: { players: ReconPlayer[]; total_expected_value: number; total_counted_value: number; total_variance_value: number; all_zero: boolean };
  bags: Bag[]; players: Player[]; days: number[];
}
type Edit = { bagCode: string; total: string };

export function BagTagTab({ tournamentId, clubId }: { tournamentId: string; clubId: string | null }) {
  const {user}=useAuth();
  const [journalGeneration,setJournalGeneration]=useState(0);
  return <ScopedBagTagTab key={`${user?.id??'anonymous'}:${clubId}:${tournamentId}:${journalGeneration}`} tournamentId={tournamentId} clubId={clubId}
    actorId={user?.id??null} rereadJournal={()=>setJournalGeneration(v=>v+1)}/>;
}

function ScopedBagTagTab({ tournamentId, clubId, actorId, rereadJournal }: { tournamentId: string; clubId: string | null; actorId:string|null; rereadJournal:()=>void }) {
  const storageKey=`vinpoker:bag-tag-pending:${actorId}:${clubId}:${tournamentId}`;
  const [saved]=useState(()=>{
    try{
      const raw=sessionStorage.getItem(storageKey);if(raw===null)return {intent:null,error:false};
      const value=JSON.parse(raw) as BagIntent;
      if(!value||Object.keys(value).sort().join(',')!=='p_day_number,p_expected_actor,p_operation,p_payload,p_request_id,p_tournament_id'
        ||value.p_tournament_id!==tournamentId||value.p_expected_actor!==actorId
        ||!Number.isSafeInteger(value.p_day_number)||value.p_day_number<1
        ||!['record','unseal','close','reopen'].includes(value.p_operation)
        ||typeof value.p_request_id!=='string'||!value.p_request_id.trim()
        ||!value.p_payload||typeof value.p_payload!=='object'||Array.isArray(value.p_payload))throw new Error('invalid_bag_intent');
      return {intent:value,error:false};
    }catch{return {intent:null,error:true};}
  });
  const [pending,setPending]=useState<BagIntent|null>(saved.intent);
  const [journalError,setJournalError]=useState(saved.error);
  const writing=useRef(false);
  const [day, setDay] = useState(1);
  const [state, setState] = useState<BagState | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError,setReadError]=useState(false);
  const generation=useRef(0);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [signoffOpen, setSignoffOpen] = useState(false);
  const [reason, setReason] = useState("");
  const matchesJournal=(intent:BagIntent)=>{
    const raw=sessionStorage.getItem(storageKey);
    return raw!==null&&canonicalVoiceJson(JSON.parse(raw))===canonicalVoiceJson(intent);
  };
  const resolveIntent=async(intent:BagIntent,action:'write'|'read'|'cancel')=>{
    if(writing.current||journalError)return;
    writing.current=true;setBusy(true);
    try{
      if(!matchesJournal(intent)){setJournalError(true);return;}
      const {data,error}=await waitForManualPlayerResponse(Promise.resolve(sb.rpc('chip_ops_bag_intent_v1',{...intent,p_action:action})));
      if(!alive.current)return;
      if(error){toast.error(chipOpsRpcErrorMessage(error));return;}
      if(typeof data?.error==='string'){toast.error(ERR[data.error]??data.error);return;}
      if(data?.status!=='committed'||!data.result||typeof data.result!=='object'||Array.isArray(data.result))return;
      const expected={tournament_id:intent.p_tournament_id,day_number:intent.p_day_number,operation:intent.p_operation,payload:intent.p_payload};
      if(data.actor_id!==intent.p_expected_actor||data.request_id!==intent.p_request_id
        ||canonicalVoiceJson(data.intent)!==canonicalVoiceJson(expected))return;
      const result=data.result;
      if(result.status!=='ok'&&result.status!=='cancelled'&&!(typeof result.error==='string'&&result.error.trim()))return;
      if(!matchesJournal(intent)){setJournalError(true);return;}
      sessionStorage.removeItem(storageKey);
      if(sessionStorage.getItem(storageKey)!==null){setJournalError(true);return;}
      setPending(null);
      if(result.error)toast.error(ERR[result.error]??result.error);
      else toast.success('Đã xác minh thao tác đóng bao.');
      await reload();
    }catch(error){if(alive.current)toast.error(chipOpsRpcErrorMessage(error));}
    finally{writing.current=false;if(alive.current)setBusy(false);}
  };
  const submitIntent=(operation:BagIntent['p_operation'],payload:Record<string,unknown>)=>{
    if(writing.current||pending||journalError||!actorId||!clubId)return;
    const intent:BagIntent={p_tournament_id:tournamentId,p_day_number:day,p_operation:operation,p_payload:payload,
      p_request_id:crypto.randomUUID(),p_expected_actor:actorId};
    try{
      if(sessionStorage.getItem(storageKey)!==null)throw new Error('pending_bag_request');
      sessionStorage.setItem(storageKey,JSON.stringify(intent));
      if(!matchesJournal(intent))throw new Error('bag_journal_unverified');
    }catch{setJournalError(true);return;}
    setPending(intent);void resolveIntent(intent,'write');
  };

  const reload = useCallback(async () => {
    if (!tournamentId) return;
    const request=++generation.current;
    const current=()=>alive.current&&generation.current===request;
    setLoading(true);
    setReadError(false);setState(null);setEdits({});setSignoffOpen(false);setReason('');
    try {
    const {data:s,error}=await waitForManualPlayerResponse(Promise.resolve(sb.rpc("get_bag_tag_state", { p_tournament_id: tournamentId, p_day_number: day })));
    if(!current())return;
    if(error||!s||s.error||s.tournament_id!==tournamentId||s.day_number!==day
      ||!s.day||!['open','locked'].includes(s.day.status)||!Number.isSafeInteger(s.day.version)
      ||!Array.isArray(s.players)||!Array.isArray(s.bags)||!Array.isArray(s.days)
      ||!s.reconciliation||!Array.isArray(s.reconciliation.players)||typeof s.reconciliation.all_zero!=='boolean')throw new Error('bag_state_unverified');
    {
      setState(s as BagState);
      const init: Record<string, Edit> = {};
      for (const p of (s.players || [])) {
        const bag = (s.bags || []).find((b: Bag) => b.player_id === p.player_id);
        // prefill the bag total to the player's stack ("đủ") unless a bag already exists
        init[p.player_id] = { bagCode: bag?.bag_code || "", total: String(bag?.total_value ?? p.chip_count ?? "") };
      }
      setEdits(init);
    }
    }catch{if(current())setReadError(true);}
    finally{if(current())setLoading(false);}
  }, [tournamentId, day]);
  useEffect(() => { reload(); }, [reload]);

  const recon = state?.reconciliation;
  const locked = state?.day?.status === "locked";
  const allZero = !!recon?.all_zero;
  const bagByPlayer = useMemo(() => new Map((state?.bags ?? []).map((b) => [b.player_id, b])), [state]);
  const players = state?.players ?? [];
  const remaining = players.filter((p) => (p.chip_count ?? 0) > 0);
  const sealedCount = (state?.bags ?? []).filter((b) => b.sealed).length;

  const setEdit = (pid: string, patch: Partial<Edit>) =>
    setEdits((e) => ({ ...e, [pid]: { ...(e[pid] || { bagCode: "", total: "" }), ...patch } }));

  const seal = async (pid: string) => {
    const e = edits[pid] || { bagCode: "", total: "" };
    const totalNum = e.total.trim() === "" ? null : Number(e.total);
    if (totalNum !== null && (!Number.isSafeInteger(totalNum) || totalNum < 0)) { toast.error("Số chip không hợp lệ."); return; }
    submitIntent('record',{player_id:pid,bag_code:e.bagCode.trim()||null,total_value:totalNum,seal:true});
  };
  const unseal=(bagId:string)=>submitIntent('unseal',{bag_id:bagId});
  const lockDay=()=>submitIntent('close',{old_version:state?.day.version??0,force_signoff:false,signoff_reason:null});
  const forceLock=()=>{if(!reason.trim()){toast.error('Nhập lý do.');return;}submitIntent('close',{old_version:state?.day.version??0,force_signoff:true,signoff_reason:reason.trim()});};
  const reopen=()=>submitIntent('reopen',{old_version:state?.day.version??0});

  if (!tournamentId || !clubId) return <Card className="border-border"><CardContent className="py-8 text-sm text-muted-foreground">Chọn một giải để đóng kho.</CardContent></Card>;
  if(journalError)return <Card><CardContent className="py-6 space-y-3" role="alert"><p>Không đọc hoặc lưu được yêu cầu đóng bao. Chưa cho phép thao tác; không xoá dữ liệu chờ.</p><Button onClick={rereadJournal}>Đọc lại yêu cầu</Button></CardContent></Card>;
  if(pending)return <Card><CardContent className="py-6 space-y-3" role="alert">
    <p>Chưa xác minh kết quả yêu cầu đóng bao ngày {pending.p_day_number}. Không gửi lại thao tác mới.</p>
    <Button disabled={busy} onClick={()=>void resolveIntent(pending,'read')}>Kiểm tra kết quả</Button>
    <Button disabled={busy} variant="outline" onClick={()=>void resolveIntent(pending,'cancel')}>Hủy nếu chưa thực hiện</Button>
  </CardContent></Card>;
  if(readError)return <Card><CardContent className="py-6 space-y-3" role="alert">
    <p>Không xác minh được dữ liệu đóng bao. Chưa cho phép thao tác; hãy tải lại.</p>
    <Button onClick={()=>void reload()}>Tải lại</Button>
  </CardContent></Card>;
  const verified=state?.day_number===day;

  const dayOptions = Array.from(new Set([...(state?.days ?? []), day, 1])).sort((a, b) => a - b);
  const maxDay = Math.max(1, ...(state?.days ?? [1]));

  // "đủ / thiếu / dư" badge for a bagged total vs the player's stack
  const SufficiencyBadge = ({ bagged, stack }: { bagged: number; stack: number }) => {
    if (!Number.isSafeInteger(bagged) || bagged < 0) return <Badge variant="destructive">Số chip không hợp lệ.</Badge>;
    const diff = bagged - stack;
    if (diff === 0) return <Badge className="gap-1 border-primary/30 bg-primary/15 text-primary"><CheckCircle2 className="h-3.5 w-3.5" /> Đủ</Badge>;
    if (diff < 0) return <Badge variant="destructive" className="gap-1">Thiếu {fmt(-diff)}</Badge>;
    return <Badge variant="outline" className="gap-1 border-warning/40 text-warning">Dư {fmt(diff)}</Badge>;
  };

  return (
    <div className="space-y-4">
      {/* day selector + status */}
      <Card className="border-border">
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <span className="text-sm text-muted-foreground">Ngày</span>
          <Select value={String(day)} onValueChange={(v) => setDay(Number(v))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{dayOptions.map((dn) => <SelectItem key={dn} value={String(dn)}>Ngày {dn}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => setDay(maxDay + 1)}><Plus className="h-4 w-4" /> Ngày mới</Button>
          <div className="ml-auto flex items-center gap-2">
            {loading||!verified?<span className="text-sm text-muted-foreground">Chưa xác minh</span>:locked
              ? <Badge variant="outline" className="gap-1 text-warning"><Lock className="h-3.5 w-3.5" /> Đã khoá{state?.day?.signed_off ? " · ký duyệt" : ""}</Badge>
              : <Badge variant="outline" className="gap-1 text-primary"><Unlock className="h-3.5 w-3.5" /> Đang mở</Badge>}
          </div>
        </CardContent>
      </Card>

      {loading||!verified ? (
        <Card className="border-border"><CardContent className="space-y-3 py-6"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-40 w-full" /></CardContent></Card>
      ) : (
        <>
          {/* bag entry — one bag total per player, checked against their stack */}
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-foreground">Đóng bao cuối ngày</CardTitle>
              <p className="text-xs text-muted-foreground">Mỗi người gói chip của mình vào một bao — chỉ cần đủ số chip bằng stack, không cần đếm từng mệnh giá.</p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {players.length === 0 ? (
                <p className="text-sm text-muted-foreground">Không có người chơi đang hoạt động.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Người chơi</TableHead>
                      <TableHead className="text-right">Stack</TableHead>
                      <TableHead className="text-right">Chip đóng bao</TableHead>
                      <TableHead>Đủ?</TableHead>
                      <TableHead>Mã bao</TableHead>
                      <TableHead className="text-right">Bao</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {players.map((p) => {
                      const bag = bagByPlayer.get(p.player_id);
                      const sealed = !!bag?.sealed;
                      const e = edits[p.player_id] || { bagCode: "", total: "" };
                      const ro = sealed || locked;
                      const bagged = sealed ? (bag?.total_value ?? 0) : (e.total.trim() === "" ? p.chip_count : Number(e.total));
                      return (
                        <TableRow key={p.player_id}>
                          <TableCell>
                            <div className="text-sm font-medium text-foreground">{p.player_name ?? p.player_id.slice(0, 6)}</div>
                            <div className="text-xs text-muted-foreground">{p.table_name ?? ""}{p.seat_number != null ? ` · ghế ${p.seat_number}` : ""}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(p.chip_count)}</TableCell>
                          <TableCell className="text-right">
                            {sealed
                              ? <span className="font-display font-semibold tabular-nums text-foreground">{fmt(bag?.total_value ?? 0)}</span>
                              : <Input type="number" inputMode="numeric" min={0} value={e.total} onChange={(ev) => setEdit(p.player_id, { total: ev.target.value })} className="h-9 w-32 text-right" disabled={ro} placeholder={String(p.chip_count)} />}
                          </TableCell>
                          <TableCell><SufficiencyBadge bagged={Number(bagged)} stack={p.chip_count} /></TableCell>
                          <TableCell><Input value={e.bagCode} onChange={(ev) => setEdit(p.player_id, { bagCode: ev.target.value })} placeholder="BAG-…" className="h-9 w-28" disabled={ro} /></TableCell>
                          <TableCell className="text-right">
                            {sealed
                              ? <Button size="sm" variant="ghost" disabled={busy || locked} onClick={() => unseal(bag!.id)}><Unlock className="h-4 w-4" /> Mở</Button>
                              : <Button size="sm" disabled={busy || locked} onClick={() => seal(p.player_id)}><PackageCheck className="h-4 w-4" /> Niêm</Button>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* close-day summary */}
          <Card className="border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base text-foreground">Chốt ngày</CardTitle>
              {allZero
                ? <Badge className="gap-1 border-primary/30 bg-primary/15 text-primary"><CheckCircle2 className="h-3.5 w-3.5" /> Đủ — khớp</Badge>
                : <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Còn thiếu/lệch</Badge>}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <Stat label="Chip đang chơi" value={fmt(recon?.total_expected_value ?? 0)} />
                <Stat label="Đã đóng bao" value={fmt(recon?.total_counted_value ?? 0)}
                  sub={Number(recon?.total_variance_value ?? 0) !== 0 ? `${Number(recon?.total_variance_value) > 0 ? "+" : ""}${fmt(recon?.total_variance_value ?? 0)}` : "khớp"}
                  warn={Number(recon?.total_variance_value ?? 0) !== 0} />
                <Stat label="Đã niêm" value={`${sealedCount}/${remaining.length}`} />
              </div>

              {/* who is short/over */}
              {!allZero && (recon?.players?.some((r) => r.variance !== 0)) && (
                <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                  <div className="mb-1 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> Chưa đủ:</div>
                  <ul className="space-y-0.5 text-xs">
                    {recon!.players.filter((r) => r.variance !== 0).map((r) => (
                      <li key={r.player_id}>{r.player_name ?? r.player_id.slice(0, 6)}: {r.sealed ? (r.variance > 0 ? `dư ${fmt(r.variance)}` : `thiếu ${fmt(-r.variance)}`) : "chưa niêm bao"}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-2 pt-1">
                {locked ? (
                  <Button variant="ghost" disabled={busy} onClick={reopen}><Unlock className="h-4 w-4" /> Mở lại ngày</Button>
                ) : allZero ? (
                  <Button disabled={busy} onClick={lockDay}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Khoá & chốt ngày</Button>
                ) : (
                  <Button variant="outline" className="border-warning/40 bg-warning/10 text-warning hover:bg-warning/20" disabled={busy} onClick={() => setSignoffOpen(true)}><AlertTriangle className="h-4 w-4" /> Khoá có chênh (ký duyệt)</Button>
                )}
              </div>
              {locked && state?.day?.signed_off && state?.day?.signoff_reason && (
                <p className="text-right text-xs text-warning">Đã ký duyệt: {state.day.signoff_reason}</p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={signoffOpen&&!loading&&verified} onOpenChange={setSignoffOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Khoá ngày khi còn chênh lệch</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Vẫn còn người chưa đóng đủ chip. TD ghi lý do để khoá có ký duyệt (lưu vào nhật ký).</p>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: 1 khách thiếu 5.000 đã xác nhận, đóng bù sáng mai" rows={3} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSignoffOpen(false)}>Huỷ</Button>
            <Button variant="outline" className="border-warning/40 bg-warning/10 text-warning hover:bg-warning/20" disabled={busy || !reason.trim()} onClick={forceLock}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Ký duyệt & khoá</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-display text-lg font-bold tabular-nums text-foreground">{value}</div>
      {sub ? <div className={`text-xs ${warn ? "text-destructive" : "text-muted-foreground"}`}>{sub}</div> : null}
    </div>
  );
}
