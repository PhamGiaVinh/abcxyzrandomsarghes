import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { chipOpsRpcErrorMessage } from "@/lib/chipOpsErrors";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ChipDisc } from "./ChipDisc";
import { Stepper } from "./Stepper";
import { ArrowRight, CheckCircle2, Loader2, Undo2 } from "lucide-react";

const sb = supabase as any;
const fmt = (n: number) => (n ?? 0).toLocaleString("vi-VN");
const ERR: Record<string, string> = {
  Unauthorized: "Bạn chưa đăng nhập.",
  Forbidden: "Bạn không có quyền.",
  SAME_DENOM: "Mệnh giá rút và nhận phải khác nhau.",
  NOT_RACING_UP: "Phải race LÊN mệnh giá cao hơn.",
  NOTHING_TO_REMOVE: "Mệnh giá này không còn chip để rút.",
  VALUE_NOT_CONSERVED: "Số chip nhận không khớp giá trị rút (lệch ≥ 1 chip mục tiêu). Kiểm tra lại.",
  ALREADY_DONE: "Mệnh giá này đã color-up ở level này rồi.",
  DENOM_NOT_IN_SET: "Mệnh giá không thuộc bộ chip của giải.",
  TOURNAMENT_NOT_FOUND: "Không tìm thấy giải.",
  OPERATION_NOT_FOUND: "Không tìm thấy thao tác.",
  INVALID_INPUT: "Dữ liệu nhập chưa hợp lệ.",
  IDEMPOTENCY_CONFLICT: "Mã thao tác đã gắn với dữ liệu khác. Không gửi lại bằng dữ liệu mới.",
  LEGACY_RECEIPT_REVIEW_REQUIRED: "Thao tác cũ thiếu chứng từ yêu cầu. Cần kiểm tra lịch sử trước khi thử lại.",
  UNDO_DEPENDENCY: "Hãy hoàn tác lần color-up phụ thuộc gần nhất trước.",
  INVENTORY_NEGATIVE: "Chip đã được dùng bởi thao tác sau; không đủ tồn để hoàn tác.",
  BANK_NEGATIVE: "Kho không đủ chip để hoàn tác. Cần đối chiếu các thao tác sau.",
};
async function callRpc(fn: string, args: Record<string, unknown>, isCurrent: () => boolean): Promise<any | null> {
  try {
    const { data, error } = await sb.rpc(fn, args);
    if (!isCurrent()) return null;
    if (error) { toast.error(chipOpsRpcErrorMessage(error)); return null; }
    if (data && data.error) { toast.error(ERR[data.error] ?? data.error); return null; }
    return data ?? {};
  } catch (error) { if (isCurrent()) toast.error(chipOpsRpcErrorMessage(error)); return null; }
}

interface Denom { denomination_id: string; value: number; color: string | null; current_count: number }
interface HistoryOp {
  id: string; level_number: number; status: string; denom_removed_value: number; denom_target_value: number;
  removed_count: number; target_added: number; rounding_delta: number;
}

export function ColorUpTab({ tournamentId, clubId, onOpenSetup }: { tournamentId: string; clubId: string | null; onOpenSetup?: () => void }) {
  const { user } = useAuth();
  const [journalGeneration, setJournalGeneration] = useState(0);
  const scope = `${user?.id ?? "anonymous"}:${clubId}:${tournamentId}`;
  return <ScopedColorUpTab key={`${scope}:${journalGeneration}`} scope={scope} actorId={user?.id ?? null} tournamentId={tournamentId} clubId={clubId}
    onOpenSetup={onOpenSetup} onRereadJournal={() => setJournalGeneration((value) => value + 1)} />;
}

interface MutationIntent {
  fn: "chip_ops_color_up" | "chip_ops_reverse_color_up";
  args: Record<string, unknown>;
}

function ScopedColorUpTab({ tournamentId, clubId, scope, actorId, onRereadJournal, onOpenSetup }: { tournamentId: string; clubId: string | null; scope: string; actorId: string | null; onRereadJournal: () => void; onOpenSetup?: () => void }) {
  const storageKey = `vinpoker:color-up-pending:${scope}`;
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denoms, setDenoms] = useState<Denom[]>([]);
  const [bigBlind, setBigBlind] = useState<number | null>(null);
  const [currentLevel, setCurrentLevel] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryOp[]>([]);
  const [removedId, setRemovedId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [added, setAdded] = useState("");
  const [savedRequest] = useState<{ intent: MutationIntent | null; error: boolean }>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw === null) return { intent: null, error: false };
      const saved = JSON.parse(raw);
      const args = saved?.args;
      const nonempty = (value: unknown) => typeof value === "string" && value.trim().length > 0;
      if (!args || Array.isArray(args) || !nonempty(args.p_idempotency_key) || args.p_idempotency_key.length > 128) throw new Error("invalid_intent");
      const expectedKeys = saved.fn === "chip_ops_color_up"
        ? ["p_tournament_id", "p_denom_removed", "p_denom_target", "p_target_added", "p_level_number", "p_idempotency_key"]
        : saved.fn === "chip_ops_reverse_color_up" ? ["p_operation_id", "p_idempotency_key"] : [];
      if (Object.keys(args).length !== expectedKeys.length || !expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(args, key))) throw new Error("invalid_intent");
      if (saved.fn === "chip_ops_color_up" && (args.p_tournament_id !== tournamentId
        || !nonempty(args.p_denom_removed) || !nonempty(args.p_denom_target) || args.p_denom_removed === args.p_denom_target
        || !Number.isSafeInteger(args.p_target_added) || args.p_target_added < 0
        || (args.p_level_number !== null && (!Number.isSafeInteger(args.p_level_number) || args.p_level_number < 0)))) throw new Error("invalid_intent");
      if (saved.fn === "chip_ops_reverse_color_up" && !nonempty(args.p_operation_id)) throw new Error("invalid_intent");
      return { intent: saved, error: false };
    } catch { return { intent: null, error: true }; }
  });
  const [uncertain, setUncertain] = useState<MutationIntent | null>(savedRequest.intent);
  const [journalError, setJournalError] = useState(savedRequest.error);
  const clearIntent = () => {
    try {
      sessionStorage.removeItem(storageKey);
      if (sessionStorage.getItem(storageKey) !== null) throw new Error("intent_clear_unverified");
    } catch {
      setJournalError(true);
      return false;
    }
    setUncertain(null);
    setJournalError(false);
    return true;
  };
  const writing = useRef(false);
  const alive = useRef(true);
  const readGeneration = useRef(0);
  const [readError, setReadError] = useState<string | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const reload = useCallback(async () => {
    if (!tournamentId) return;
    const generation = ++readGeneration.current;
    let accepting = true;
    const current = () => accepting && alive.current && generation === readGeneration.current;
    setLoading(true);
    setReadError(null);
    try {
      const snapshot = await waitForManualPlayerResponse((async () => {
        const inv = await callRpc("get_current_chip_inventory", { p_tournament_id: tournamentId }, current);
        if (!current()) return;
        if (!inv || !Array.isArray(inv.denominations)) throw new Error("inventory_unverified");
        const { data: t, error: tournamentError } = await sb.from("tournaments").select("current_level").eq("id", tournamentId).maybeSingle();
        if (!current()) return;
        if (tournamentError || !t) throw new Error("tournament_unverified");
        let bb: number | null = null;
        if (t.current_level != null) {
          const { data: l, error: levelError } = await sb.from("tournament_levels").select("big_blind").eq("tournament_id", tournamentId).eq("level_number", t.current_level).maybeSingle();
          if (!current()) return;
          if (levelError) throw levelError;
          bb = l?.big_blind ?? null;
        }
        const h = await callRpc("get_color_up_history", { p_tournament_id: tournamentId }, current);
        if (!current()) return;
        if (!h || !Array.isArray(h.operations)) throw new Error("history_unverified");
        return { denoms: inv.denominations.map((d: any) => ({ denomination_id: d.denomination_id, value: d.value, color: d.color, current_count: Number(d.current_count) })),
          currentLevel: t.current_level ?? null, bigBlind: bb, history: h.operations };
      })());
      if (!current() || !snapshot) return;
      setDenoms(snapshot.denoms);
      setCurrentLevel(snapshot.currentLevel);
      setBigBlind(snapshot.bigBlind);
      setHistory(snapshot.history);
    } catch {
      if (current()) setReadError("Không xác minh được tồn chip hoặc lịch sử. Chưa cho phép thao tác; hãy tải lại.");
    } finally {
      if (current()) setLoading(false);
      accepting = false;
    }
  }, [tournamentId]);
  useEffect(() => { reload(); }, [reload]);

  const sorted = useMemo(() => [...denoms].sort((a, b) => a.value - b.value), [denoms]);
  const removed = denoms.find((d) => d.denomination_id === removedId);
  const target = denoms.find((d) => d.denomination_id === targetId);
  const confirmedValues = useMemo(
    () => new Set(history.filter((h) => h.status === "confirmed").map((h) => h.denom_removed_value)),
    [history],
  );

  // when removed changes: default target = next higher, clear added (will pre-fill below)
  useEffect(() => {
    if (!removed) { setTargetId(""); return; }
    const nh = sorted.find((d) => d.value > removed.value);
    setTargetId(nh ? nh.denomination_id : "");
    setAdded("");
  }, [removedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const valueRemoved = removed ? removed.current_count * removed.value : 0;
  const targetVal = target?.value ?? 0;
  const suggested = targetVal > 0 ? Math.round(valueRemoved / targetVal) : 0;
  // pre-fill suggested when target picked and field empty
  useEffect(() => { if (removed && target && added === "") setAdded(String(suggested)); }, [targetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const addedN = Number(added) || 0;
  const valueAdded = addedN * targetVal;
  const rounding = valueRemoved - valueAdded;
  const withinTol = targetVal > 0 && Math.abs(rounding) < targetVal && !!removed && removed.current_count > 0;
  const step = !removed || !target ? 0 : !withinTol ? 1 : 2;

  const acceptResult = (intent: MutationIntent, data: any) => {
    if (data?.status === "cancelled") {
      const args = intent.args;
      const operation = intent.fn === "chip_ops_color_up" ? "color_up" : "reverse_color_up";
      const payload: Record<string, unknown> = intent.fn === "chip_ops_color_up"
        ? { tournament: args.p_tournament_id, removed: args.p_denom_removed, target: args.p_denom_target, added: args.p_target_added, level: args.p_level_number }
        : { operation: args.p_operation_id };
      if (data.error !== "REQUEST_CANCELLED" || data.actor_id !== actorId || data.operation !== operation
        || data.request_key !== args.p_idempotency_key || !data.payload
        || Object.keys(data.payload).length !== Object.keys(payload).length
        || !Object.entries(payload).every(([key, value]) => data.payload[key] === value)) return false;
      if (!clearIntent()) return false;
      toast.success("Đã hủy yêu cầu chưa chốt. Không thay đổi tồn chip.");
      void reload();
      return true;
    }
    if (data?.status !== "ok" || data?.error
      || typeof data.color_up_operation_id !== "string" || data.color_up_operation_id.trim().length === 0
      || !(intent.fn === "chip_ops_color_up"
        ? Number.isSafeInteger(data.removed_count) && data.removed_count > 0
          && Number.isSafeInteger(data.target_added) && data.target_added === intent.args.p_target_added
        : data.color_up_operation_id === intent.args.p_operation_id && (data.reversed === true || data.idempotent === true))) return false;
    if (!clearIntent()) return false;
    toast.success(intent.fn === "chip_ops_color_up" ? "Đã color-up." : "Đã hoàn tác color-up.");
    setRemovedId(""); setTargetId(""); setAdded("");
    void reload();
    return true;
  };
  const reconcileIntent = async (intent: MutationIntent, cancel = false) => {
    if (writing.current || (cancel && journalError)) return;
    writing.current = true;
    setBusy(true);
    const args = intent.args;
    try {
      const { data, error } = await waitForManualPlayerResponse(Promise.resolve(sb.rpc(cancel ? "cancel_chip_color_up_request_v1" : "get_chip_color_up_receipt_v1", {
        p_tournament_id: tournamentId,
        p_operation: intent.fn === "chip_ops_color_up" ? "color_up" : "reverse_color_up",
        p_request_key: args.p_idempotency_key,
        p_payload: intent.fn === "chip_ops_color_up"
          ? { tournament: args.p_tournament_id, removed: args.p_denom_removed, target: args.p_denom_target, added: args.p_target_added, level: args.p_level_number }
          : { operation: args.p_operation_id },
      })));
      if (!alive.current) return;
      if (error) toast.error(chipOpsRpcErrorMessage(error));
      else if (data?.error) toast.error(ERR[data.error] ?? data.error);
      else if (data?.status !== "committed" || !acceptResult(intent, data.result)) {
        toast.error("Chưa xác minh được receipt đã chốt. Giữ nguyên yêu cầu; không tạo mã mới.");
      }
    } catch (error) {
      if (alive.current) toast.error(chipOpsRpcErrorMessage(error));
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const submitIntent = async (intent: MutationIntent) => {
    if (writing.current || journalError) return;
    writing.current = true;
    setBusy(true);
    // Persist before sending: browser reload may follow an already committed mutation.
    try {
      const serialized = JSON.stringify(intent);
      sessionStorage.setItem(storageKey, serialized);
      if (sessionStorage.getItem(storageKey) !== serialized) throw new Error("intent_storage_unverified");
    } catch {
      writing.current = false;
      setBusy(false);
      toast.error("Không lưu được mã yêu cầu an toàn. Chưa gửi thao tác chip; hãy kiểm tra bộ nhớ trình duyệt.");
      return;
    }
    setUncertain(intent);
    try {
      const { data, error } = await waitForManualPlayerResponse(Promise.resolve(sb.rpc(intent.fn, intent.args)));
      if (!alive.current) return;
      if (error) {
        setUncertain(intent);
        toast.error(chipOpsRpcErrorMessage(error));
      } else if (data?.error) {
        // Authorization and business checks can precede receipt lookup. A later
        // rejection does not establish whether an earlier attempt committed.
        setUncertain(intent);
        toast.error(ERR[data.error] ?? data.error);
      } else if (!acceptResult(intent, data)) {
        // A malformed/empty reply is not proof of rejection or success.
        setUncertain(intent);
        toast.error("Chưa xác minh được kết quả. Kiểm tra lại cùng mã thao tác, không tạo lần mới.");
      }
    } catch (error) {
      if (alive.current) { setUncertain(intent); toast.error(chipOpsRpcErrorMessage(error)); }
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const confirm = async () => {
    if (uncertain || !removed || !target || !withinTol || !Number.isSafeInteger(addedN) || addedN < 0) return;
    await submitIntent({ fn: "chip_ops_color_up", args: {
      p_tournament_id: tournamentId, p_denom_removed: removedId, p_denom_target: targetId,
      p_target_added: addedN, p_level_number: currentLevel, p_idempotency_key: crypto.randomUUID(),
    }});
  };
  const reverse = async (opId: string) => {
    if (uncertain) return;
    await submitIntent({ fn: "chip_ops_reverse_color_up", args: { p_operation_id: opId, p_idempotency_key: crypto.randomUUID() }});
  };

  if (!tournamentId || !clubId) {
    return <Card className="border-border"><CardContent className="py-8 text-sm text-muted-foreground">Chọn một giải để color-up.</CardContent></Card>;
  }
  if (journalError) {
    return <Card><CardContent className="py-6 text-sm" role="alert">
      Không xác minh được yêu cầu chip đã lưu. Chưa cho phép thao tác mới; cần đối chiếu yêu cầu trước khi tiếp tục.
      {uncertain && <Button disabled={busy} onClick={() => void reconcileIntent(uncertain)}>Đối chiếu thao tác</Button>}
      <Button disabled={busy} onClick={onRereadJournal}>Đọc lại yêu cầu đã lưu</Button>
    </CardContent></Card>;
  }
  if (loading) {
    return <Card className="border-border"><CardContent className="space-y-3 py-6"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-24 w-full" /></CardContent></Card>;
  }
  const pendingRecovery = uncertain && <Card><CardContent className="space-y-2 py-4" role="alert">
    <p className="text-sm">Chưa xác minh được thao tác vừa gửi. Đang giữ nguyên mã và dữ liệu; chưa được tạo thao tác chip mới.</p>
    <Button disabled={busy} onClick={() => void reconcileIntent(uncertain)}>Đối chiếu thao tác</Button>
    <Button disabled={busy} onClick={() => void submitIntent(uncertain)}>Gửi lại cùng yêu cầu</Button>
    <p className="text-sm">Hủy chỉ chặn yêu cầu chưa chốt, không hoàn tác thao tác đã chốt.</p>
    <Button disabled={busy} onClick={() => void reconcileIntent(uncertain, true)}>Hủy yêu cầu đang chờ</Button>
  </CardContent></Card>;
  if (readError) {
    return <div className="space-y-4">{pendingRecovery}<Card><CardContent className="space-y-3 py-6" role="alert">
      <p className="text-sm">{readError}</p>
      <Button onClick={() => void reload()}>Tải lại</Button>
    </CardContent></Card></div>;
  }

  return (
    <div className="space-y-4">
      {pendingRecovery}
      <Card className="border-border">
        <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">Color-Up / Chip race {currentLevel != null && <span className="text-sm text-muted-foreground">· Level {currentLevel}{bigBlind ? ` · BB ${fmt(bigBlind)}` : ""}</span>}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {denoms.length === 0 ? <div className="space-y-3" role="status">
            <p className="text-sm">Chưa có mệnh giá chip để color-up. Mở Setup stack để kiểm tra bộ chip, mẫu stack và số bộ đã phát của giải.</p>
            {onOpenSetup && <Button className="min-h-11" onClick={onOpenSetup}>Mở Setup stack</Button>}
          </div> : <>
          <Stepper steps={["Chọn mệnh giá", "Nhập số chip race", "Xác nhận"]} current={step} />

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Rút mệnh giá</Label>
              <Select value={removedId} onValueChange={setRemovedId}>
                <SelectTrigger><SelectValue placeholder="Chọn mệnh giá rút" /></SelectTrigger>
                <SelectContent>
                  {sorted.map((d) => (
                    <SelectItem key={d.denomination_id} value={d.denomination_id} disabled={d.current_count <= 0}>
                      T{fmt(d.value)} · còn {fmt(d.current_count)}
                      {bigBlind != null && d.value < bigBlind ? " · đến hạn" : ""}
                      {confirmedValues.has(d.value) && d.current_count > 0 ? " · đã color-up (chip mới)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Race lên</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger><SelectValue placeholder="Chọn mệnh giá nhận" /></SelectTrigger>
                <SelectContent>
                  {sorted.filter((d) => !removed || d.value > removed.value).map((d) => (
                    <SelectItem key={d.denomination_id} value={d.denomination_id}>T{fmt(d.value)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {removed && target && (
            <>
              <div className="flex items-center justify-center gap-4 rounded-lg border border-border bg-secondary/40 p-4">
                <div className="flex flex-col items-center gap-1">
                  <ChipDisc value={removed.value} color={removed.color} size={48} />
                  <div className="text-xs tabular-nums text-muted-foreground">{fmt(removed.current_count)} → <span className="text-foreground">0</span></div>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground" />
                <div className="flex flex-col items-center gap-1">
                  <ChipDisc value={target.value} color={target.color} size={48} />
                  <div className="text-xs tabular-nums text-muted-foreground">{fmt(target.current_count)} → <span className="text-foreground">{fmt(target.current_count + addedN)}</span></div>
                </div>
              </div>

              <div className="text-sm text-muted-foreground">Giá trị rút: <b className="tabular-nums text-foreground">{fmt(valueRemoved)}</b></div>

              <div>
                <Label className="text-xs">Số chip T{fmt(target.value)} race ra (gợi ý {fmt(suggested)})</Label>
                <div className="flex items-center gap-3">
                  <Input type="number" inputMode="numeric" value={added} onChange={(e) => setAdded(e.target.value)} className="w-32" />
                  <span className={`text-sm ${rounding === 0 ? "text-primary" : withinTol ? "text-warning" : "text-destructive"}`}>
                    {rounding === 0 ? "khớp ✓" : withinTol ? `dư ${fmt(Math.abs(rounding))} — trao 1 chip cho high card` : "sai số lớn ✗"}
                  </span>
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={confirm} disabled={busy || !!uncertain || !withinTol || !Number.isSafeInteger(addedN) || addedN < 0}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Xác nhận color-up
                </Button>
              </div>
            </>
          )}
          </>}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">Lịch sử color-up</CardTitle></CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có color-up nào.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Level</TableHead><TableHead>Rút → Nhận</TableHead><TableHead className="text-right">Số rút</TableHead>
                <TableHead className="text-right">Race ra</TableHead><TableHead className="text-right">Dư</TableHead><TableHead className="text-right">Hoàn tác</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {history.map((h) => (
                  <TableRow key={h.id} className={h.status === "reversed" ? "opacity-50" : ""}>
                    <TableCell className="tabular-nums">{h.level_number}</TableCell>
                    <TableCell className="tabular-nums">T{fmt(h.denom_removed_value)} → T{fmt(h.denom_target_value)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(h.removed_count)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(h.target_added)}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(h.rounding_delta) === 0 ? "—" : fmt(Number(h.rounding_delta))}</TableCell>
                    <TableCell className="text-right">
                      {h.status === "reversed" ? <span className="text-xs text-muted-foreground">đã hoàn tác</span> : (
                        <Button size="sm" variant="ghost" aria-label={`Hoàn tác color-up level ${h.level_number}`} disabled={busy || !!uncertain} onClick={() => reverse(h.id)}><Undo2 className="h-4 w-4" /></Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
