import { useEffect, useMemo, useRef, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { createFloorTableControlV3Client, type FloorTableControlV3Rpc, type FloorTournamentTableRoster } from "@/lib/floorTableControlV3";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatStack } from "@/lib/format";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";

type RestoreIntent = Parameters<ReturnType<typeof createFloorTableControlV3Client>["restoreBustedPlayer"]>[0];
const messages: Record<string, string> = {
  restore_result_dependency: "Giải đã có kết quả chốt hoặc payout. Không thể hoàn tác bust.",
  restore_reentry_dependency: "Người chơi đã có entry mới. Hoàn tác bust và re-entry là hai nghiệp vụ riêng.",
  restore_stack_evidence_missing: "Không có chứng cứ stack trước bust. Không tự cấp chip mới.",
  seat_locked: "Ghế đang khóa. Hãy chọn ghế khác.",
  seat_occupied: "Ghế đã có người. Hãy tải lại danh sách bàn.",
  table_has_active_hand: "Bàn đang chơi hand. Hãy chờ hand kết thúc.",
  STALE_STATE: "Phiên bàn đã thay đổi. Đóng cửa sổ và tải lại trước khi chọn ghế.",
  table_session_mismatch: "Phiên bàn đã đóng hoặc bị thay thế. Không chuyển yêu cầu cũ sang phiên mới.",
  exact_session_required: "Cần tải lại phiên bàn trước khi khôi phục.",
  actor_not_allowed: "Tài khoản không có quyền hoàn tác bust ở CLB này.",
};

type RestoreBustDialogProps = {
  tournamentId: string;
  target: { entryId: string; name: string; destination?: { tableId: string; seatNumber: number } } | null;
  onClose: () => void;
  onRestored: () => void;
  actorId: string | null;
};

export function RestoreBustDialog(props: RestoreBustDialogProps) {
  // A new actor/entry lifetime must not accept replies from a previous one,
  // including actor A -> B -> A. Persisted requests remain actor scoped.
  const scope = JSON.stringify([props.actorId, props.tournamentId, props.target?.entryId ?? null]);
  return <ScopedRestoreBustDialog key={scope} {...props} scope={scope} />;
}

function ScopedRestoreBustDialog({ tournamentId, target, onClose, onRestored, actorId, scope }: RestoreBustDialogProps & { scope: string }) {
  const supabase = useSupabaseClient();
  const client = useMemo(() => createFloorTableControlV3Client(
    ((name, args) => (supabase.rpc as unknown as FloorTableControlV3Rpc)(name, args)),
  ), [supabase]);
  const attempts = useRef(new Map<string, RestoreIntent>());
  const storageKey = `vinpoker:restore-bust-pending:${scope}`;
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [tables, setTables] = useState<FloorTournamentTableRoster[]>([]);
  const [stack, setStack] = useState<number | null>(null);
  const [tableId, setTableId] = useState("");
  const [seat, setSeat] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifiedScope, setVerifiedScope] = useState("");
  const [unresolved, setUnresolved] = useState(false);
  const [journalBlocked, setJournalBlocked] = useState(false);
  const [reloadGeneration, setReloadGeneration] = useState(0);
  const pending = useRef(false);
  useEffect(() => {
    let disposed = false;
    setTables([]); setStack(null); setTableId(""); setSeat(""); setError(null); setVerifiedScope("");
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw !== null) {
        const saved = JSON.parse(raw);
        const intent = saved?.intent;
        if (saved.actorId !== actorId || saved.tournamentId !== tournamentId || !intent
          || intent.entryId !== target?.entryId
          || ![intent.toTournamentTableId, intent.expectedTableSessionId, intent.requestId].every((value) => typeof value === "string" && value.length > 0)
          || !Number.isSafeInteger(intent.toSeatNumber) || intent.toSeatNumber < 1
          || !Number.isSafeInteger(intent.expectedRevision) || intent.expectedRevision < 0
          || !Number.isSafeInteger(intent.expectedControlEpoch) || intent.expectedControlEpoch < 0) {
          throw new Error("restore_journal_invalid");
        }
        attempts.current.set(scope, intent);
      }
      setJournalBlocked(false);
    } catch {
      setJournalBlocked(true);
      setError("Không xác minh được yêu cầu đã lưu. Chưa gửi thao tác mới; cần đối chiếu trước khi tiếp tục.");
      return;
    }
    setUnresolved(attempts.current.has(scope));
    if (!target || !actorId) return;
    setLoading(true);
    void waitForManualPlayerResponse(Promise.all([client.getTournamentTableRoster(tournamentId), client.getRestorableEntries(tournamentId)]))
      .then(([roster, entries]) => {
        if (disposed) return;
        if (roster.ok === false || entries.ok === false) {
          setError("Không tải được bàn hoặc chứng cứ stack. Không thể xác nhận lúc này."); return;
        }
        setTables(roster.data);
        setVerifiedScope(scope);
        const prior = attempts.current.get(scope);
        if (prior) { setTableId(prior.toTournamentTableId); setSeat(String(prior.toSeatNumber)); }
        else if (target.destination) { setTableId(target.destination.tableId); setSeat(String(target.destination.seatNumber)); }
        const entry = entries.data.find((row) => row.entryId === target.entryId);
        if (!entry) setError(messages.restore_stack_evidence_missing);
        else setStack(entry.currentStack);
      }).catch(() => { if (!disposed) setError("Không kết nối được server. Hãy đóng và mở lại để thử."); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [client, target, tournamentId, actorId, scope, storageKey, reloadGeneration]);
  const table = tables.find((row) => row.tournamentTableId === tableId);
  const emptySeats = table ? Array.from({ length: table.maxSeats }, (_, i) => i + 1)
    .filter((n) => !table.seats.some((s) => s.seatNumber === n) && !table.seatLocks.some((s) => s.seatNumber === n)) : [];
  function acceptReceipt(intent: RestoreIntent, value: unknown) {
    const receipt = value as Record<string, unknown> | null;
    if (receipt?.status === "cancelled") {
      const payload = receipt.payload as Record<string, unknown> | null;
      if (receipt.ok !== false || receipt.error !== "REQUEST_CANCELLED" || receipt.actor_id !== actorId
        || receipt.request_id !== intent.requestId || !payload
        || Object.keys(payload).length !== 6 || payload.entry_id !== intent.entryId
        || payload.to_tournament_table_id !== intent.toTournamentTableId || payload.to_seat_number !== intent.toSeatNumber
        || payload.expected_revision !== intent.expectedRevision || payload.expected_control_epoch !== intent.expectedControlEpoch
        || payload.expected_table_session_id !== intent.expectedTableSessionId) {
        setError("Chưa xác minh được xác nhận hủy đúng yêu cầu. Giữ nguyên mã để đối chiếu."); return;
      }
      sessionStorage.removeItem(storageKey);
      if (sessionStorage.getItem(storageKey) !== null) throw new Error("restore_journal_clear_failed");
      attempts.current.delete(scope); setUnresolved(false); setJournalBlocked(false);
      setReloadGeneration((value) => value + 1);
      return;
    }
    if (!receipt || receipt.ok !== true || receipt.entry_id !== intent.entryId
      || receipt.tournament_table_id !== intent.toTournamentTableId
      || receipt.table_session_id !== intent.expectedTableSessionId
      || receipt.seat_number !== intent.toSeatNumber
      || typeof receipt.seat_id !== "string" || !receipt.seat_id
      || typeof receipt.chip_count !== "number" || !Number.isSafeInteger(receipt.chip_count) || receipt.chip_count < 0
      || typeof receipt.revision !== "number" || !Number.isSafeInteger(receipt.revision) || receipt.revision <= intent.expectedRevision) {
      setError("Phản hồi chưa xác minh đúng entry và phiên bàn. Đang giữ nguyên yêu cầu để đối chiếu.");
      return;
    }
    sessionStorage.removeItem(storageKey);
    if (sessionStorage.getItem(storageKey) !== null) throw new Error("restore_journal_clear_failed");
    attempts.current.delete(scope); setUnresolved(false); onRestored(); onClose();
  }
  async function reconcile() {
    const intent = attempts.current.get(scope);
    if (!intent || pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      const response = await waitForManualPlayerResponse(client.getRestoreReceipt(intent));
      if (!alive.current) return;
      if (response.ok === false) {
        setError(messages[response.error] ?? `Chưa đối chiếu được yêu cầu (${response.error}).`);
        return;
      }
      const data = response.data as Record<string, unknown> | null;
      if (data?.ok !== true) { setError("Server chưa cho phép đối chiếu yêu cầu. Đang giữ nguyên mã."); return; }
      if (data?.status === "committed") acceptReceipt(intent, data.result);
      else setError("Chưa tìm thấy receipt đã commit. Không kết luận yêu cầu thất bại; gửi lại chỉ dùng nguyên mã và dữ liệu.");
    } catch {
      if (alive.current) setError("Không đối chiếu được kết quả. Đang giữ nguyên yêu cầu; chưa tạo thao tác mới.");
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function cancelRequest() {
    const intent = attempts.current.get(scope);
    if (!intent || pending.current || journalBlocked) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      const response = await waitForManualPlayerResponse(client.cancelRestoreRequest(intent));
      if (!alive.current) return;
      if (response.ok === false) { setError(messages[response.error] ?? `Chưa xác nhận hủy (${response.error}).`); return; }
      const proof = response.data as Record<string, unknown> | null;
      if (proof?.ok === true && proof.status === "committed") acceptReceipt(intent, proof.result);
      else setError("Chưa xác minh được hủy. Giữ nguyên yêu cầu; không tạo mã mới.");
    } catch {
      if (alive.current) setError("Chưa xác nhận được hủy. Đối chiếu lại cùng mã yêu cầu trước khi tiếp tục.");
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function restore() {
    const prior = attempts.current.get(scope);
    if (pending.current || journalBlocked || !target || !actorId || (!prior && (verifiedScope !== scope || !table || stack === null || !emptySeats.includes(Number(seat))))) return;
    const key = scope;
    const intent = prior ?? {
      entryId: target.entryId, toTournamentTableId: table.tournamentTableId, toSeatNumber: Number(seat),
      expectedRevision: table.sessionRevision, expectedControlEpoch: table.controlEpoch, requestId: crypto.randomUUID(),
      expectedTableSessionId: table.tableSessionId,
    };
    try {
      const serialized = JSON.stringify({ actorId, tournamentId, intent });
      sessionStorage.setItem(storageKey, serialized);
      if (sessionStorage.getItem(storageKey) !== serialized) throw new Error("restore_journal_unverified");
    } catch {
      setError("Không lưu được mã yêu cầu an toàn. Chưa gửi hoàn tác bust; hãy kiểm tra bộ nhớ trình duyệt.");
      return;
    }
    attempts.current.set(key, intent); setUnresolved(true);
    pending.current = true; setBusy(true); setError(null);
    try {
      const result = await waitForManualPlayerResponse(client.restoreBustedPlayer(intent));
      if (!alive.current) return;
      if (result.ok === false) {
        // A rejection after an unknown attempt need not prove the original
        // transaction did not commit. Keep the exact intent for reconciliation.
        setError(messages[result.error] ?? `Chưa xác nhận hoàn tác (${result.error}). Thử lại sẽ dùng cùng mã yêu cầu.`); return;
      }
      acceptReceipt(intent, result.data);
    } catch {
      if (alive.current) setError("Chưa biết server đã hoàn tất hay chưa. Thử lại giữ nguyên mã yêu cầu; không tạo thao tác mới.");
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return <Dialog open={target !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>Hoàn tác bust nhầm</DialogTitle><DialogDescription>
        {target?.name} · Khôi phục entry cũ bằng stack có chứng cứ, không phải re-entry.
      </DialogDescription></DialogHeader>
      {loading ? <p role="status">Đang xác minh bàn và stack…</p> : <>
        {stack !== null && <p>Stack sẽ khôi phục: <strong>{formatStack(stack)} chip</strong></p>}
        <label className="grid gap-1">Bàn
          <select aria-label="Bàn khôi phục" className="h-12 rounded-md border bg-background px-3" value={tableId} disabled={busy || unresolved || stack === null}
            onChange={(event) => { setTableId(event.target.value); setSeat(""); }}>
            <option value="">Chọn bàn</option>{tables.map((row) => <option key={row.tournamentTableId} value={row.tournamentTableId}>{row.tableName}</option>)}
          </select>
        </label>
        <label className="grid gap-1">Ghế trống, không khóa
          <select aria-label="Ghế khôi phục" className="h-12 rounded-md border bg-background px-3" value={seat} disabled={busy || unresolved || !table}
            onChange={(event) => setSeat(event.target.value)}>
            <option value="">Chọn ghế</option>{emptySeats.map((n) => <option key={n} value={n}>Ghế {n}</option>)}
          </select>
        </label>
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {journalBlocked && <Button variant="outline" disabled={busy} onClick={() => setReloadGeneration((value) => value + 1)}>Đọc lại yêu cầu đã lưu</Button>}
      {unresolved && <Button variant="outline" className="min-h-12" disabled={busy} onClick={() => void reconcile()}>
        Đối chiếu yêu cầu
      </Button>}
      {unresolved && <>
        <p className="text-sm text-muted-foreground">Hủy chỉ chặn yêu cầu chưa chốt. Nếu đã chốt, server trả kết quả đã lưu; không hoàn nguyên chip.</p>
        <Button variant="outline" className="min-h-12" disabled={busy || journalBlocked} onClick={() => void cancelRequest()}>Hủy yêu cầu đang chờ</Button>
      </>}
      <Button className="min-h-12" disabled={busy || journalBlocked || (!unresolved && (loading || verifiedScope !== scope || stack === null || !table || !seat))} onClick={() => void restore()}>
        {busy ? "Đang xác nhận…" : unresolved ? "Kiểm tra lại yêu cầu đã gửi" : "Xác nhận hoàn tác bust"}
      </Button>
    </DialogContent>
  </Dialog>;
}
