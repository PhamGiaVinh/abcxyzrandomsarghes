import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { createFloorTableControlV3Client, type FloorTableControlV3Rpc } from "@/lib/floorTableControlV3";
import { settleManualPlayerIntent, readManualPlayerIntent, validateManualPlayerReceipt, waitForManualPlayerResponse, type ManualPlayerIntent } from "@/lib/floorManualPlayerIntent";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import type { SeatReceiptData } from "@/components/tournament/seat/SeatReceipt";

type Props = {
  open: boolean; onOpenChange: (v: boolean) => void; tournamentId: string; tournamentName: string;
  tournamentDate: string | null; tableTtId: string; maxSeats: number; occupiedSeats: number[];
  lockedSeats?: number[]; defaultSeatNumber?: number | null; onDone: () => void;
  actorId: string | null; tableSessionId: string | null; expectedRevision: number | null;
  expectedControlEpoch: number | null; contextReady?: boolean;
};
const errors: Record<string, string> = {
  seat_locked: "Ghế đang khóa. Chọn ghế khác.", seat_occupied: "Ghế vừa có người. Hãy tải lại.",
  STALE_STATE: "Bàn đã thay đổi. Tải lại trước khi gửi yêu cầu mới.",
  table_session_mismatch: "Phiên bàn đã đóng hoặc thay thế. Không dùng yêu cầu cũ cho phiên mới.",
  table_has_active_hand: "Bàn đang chơi hand. Chờ hand kết thúc.",
  actor_not_allowed: "Không có quyền thêm người vào giải này.",
  tournament_not_open: "Giải không còn mở đăng ký.",
};
export function AddPlayerDialog(props: Props) {
  // Revision/epoch updates must not discard a request awaiting reconciliation.
  const scope = JSON.stringify([props.actorId, props.tournamentId, props.tableTtId, props.tableSessionId]);
  return <ScopedAddPlayerDialog key={scope} {...props} scope={scope} />;
}
function ScopedAddPlayerDialog(p: Props & { scope: string }) {
  const supabase = useSupabaseClient();
  const client = useMemo(() => createFloorTableControlV3Client((name, args) =>
    (supabase.rpc as unknown as FloorTableControlV3Rpc)(name, args)), [supabase]);
  const storageKey = `vinpoker:manual-player-pending:${p.scope}`;
  const inputId = useId();
  const alive = useRef(false);
  const pending = useRef(false);
  const intentRef = useRef<ManualPlayerIntent | null>(null);
  const wasOpen = useRef(false);
  const [intent, setIntent] = useState<ManualPlayerIntent | null>(null);
  const [journalBlocked, setJournalBlocked] = useState(false);
  const [name, setName] = useState("");
  const [seat, setSeat] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SeatReceiptData | null>(null);
  const freeSeats = Array.from({ length: p.maxSeats }, (_, n) => n + 1)
    .filter((n) => !p.occupiedSeats.includes(n) && !p.lockedSeats?.includes(n));
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!p.open) { wasOpen.current = false; return; }
    if (wasOpen.current) return;
    wasOpen.current = true;
    try {
      const raw = sessionStorage.getItem(storageKey);
      const stored = raw === null ? null : readManualPlayerIntent(raw, {
        actorId: p.actorId ?? "", tournamentId: p.tournamentId, tableId: p.tableTtId, sessionId: p.tableSessionId ?? "",
      });
      const saved = stored?.resolved ? null : stored;
      intentRef.current = saved; setIntent(saved); setJournalBlocked(false); setError(null);
      setName(saved?.name ?? "");
      setSeat(saved?.seat ?? (p.defaultSeatNumber != null && freeSeats.includes(p.defaultSeatNumber) ? p.defaultSeatNumber : freeSeats[0] ?? null));
    } catch { setJournalBlocked(true); setError("Không xác minh được yêu cầu đã lưu. Chưa gửi thao tác mới."); }
  });
  function accept(i: ManualPlayerIntent, value: unknown) {
    const result = validateManualPlayerReceipt(i, value);
    if (result.status === "unknown") { setError("Chưa xác minh được kết quả đúng yêu cầu. Giữ nguyên mã để đối chiếu."); return; }
    settleManualPlayerIntent(sessionStorage, storageKey, i);
    intentRef.current = null; setIntent(null);
    if (result.status === "rejected") {
      setError(errors[result.error] ?? `Server từ chối (${result.error}). Hãy tải lại bàn.`); p.onDone(); return;
    }
    const r = result.receipt;
    setReceipt({ tournamentName: p.tournamentName, tournamentDate: p.tournamentDate,
      playerName: r.display_name, tableNumber: r.table_number, seatNumber: r.seat_number,
      receiptCode: r.receipt_code, startingStack: r.starting_stack, qrValue: r.receipt_code });
    toast.success(`Đã xếp ${r.display_name} vào ghế ${r.seat_number}.`);
    p.onDone();
  }
  const contextValid = p.contextReady !== false && !!p.actorId && !!p.tableSessionId
    && Number.isSafeInteger(p.expectedRevision) && (p.expectedRevision ?? -1) >= 0
    && Number.isSafeInteger(p.expectedControlEpoch) && (p.expectedControlEpoch ?? -1) >= 0;
  async function send(reconcile: boolean) {
    if (pending.current || journalBlocked) return;
    let i = intentRef.current;
    if (!i) {
      if (reconcile || !contextValid || name.trim().length < 2 || name.trim().length > 100 || seat === null || !freeSeats.includes(seat)) return;
      i = { actorId: p.actorId!, tournamentId: p.tournamentId, tableId: p.tableTtId, sessionId: p.tableSessionId!,
        name: name.trim(), seat, revision: p.expectedRevision!, epoch: p.expectedControlEpoch!, requestId: crypto.randomUUID() };
      try {
        // A sibling view may already have an unknown request. Never overwrite it.
        const prior = sessionStorage.getItem(storageKey);
        if (prior !== null && !readManualPlayerIntent(prior, i).resolved) throw new Error("journal_changed");
        const raw = JSON.stringify(i); sessionStorage.setItem(storageKey, raw);
        if (sessionStorage.getItem(storageKey) !== raw) throw new Error("journal_unverified");
      } catch { setJournalBlocked(true); setError("Không lưu được mã yêu cầu an toàn. Chưa gửi thêm người; đóng và mở lại để đối chiếu."); return; }
      intentRef.current = i; setIntent(i);
    }
    pending.current = true; setBusy(true); setError(null);
    try {
      const response = await waitForManualPlayerResponse(reconcile ? client.getManualPlayerReceipt(i) : client.addManualPlayer(i));
      if (!alive.current) return;
      if (!response.ok) { setError("Chưa biết server đã chốt hay chưa. Giữ nguyên yêu cầu và đối chiếu; không tạo mã mới."); return; }
      if (!reconcile) accept(i, response.data);
      else {
        const data = response.data as { ok?: boolean; status?: string; result?: unknown } | null;
        if (data?.ok === true && data.status === "resolved") accept(i, data.result);
        else setError("Chưa tìm thấy kết quả đã chốt. Không kết luận thất bại; chỉ gửi lại nguyên yêu cầu.");
      }
    } catch { if (alive.current) setError("Không xác minh được kết quả. Giữ nguyên mã; dùng Đối chiếu trước khi tiếp tục."); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const frozen = busy || intent !== null || journalBlocked;
  return <>
    <Dialog open={p.open && receipt === null} onOpenChange={(v) => { if (!busy) p.onOpenChange(v); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Thêm người mới</DialogTitle><DialogDescription>
          Tạo entry thủ công và xếp ghế với stack cấu hình của giải. Không thu tiền hoặc phát chip từ kho ở bước này.
        </DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Label htmlFor={inputId}>Tên người chơi</Label>
          <Input id={inputId} value={name} maxLength={100} disabled={frozen} onChange={(e) => setName(e.target.value)} placeholder="Nhập tên…" />
          <label className="grid gap-1">Ghế trống, không khóa
            <select className="h-12 rounded-md border bg-background px-3" value={seat ?? ""} disabled={frozen}
              onChange={(e) => setSeat(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Chọn ghế</option>
              {intent && !freeSeats.includes(intent.seat) && <option value={intent.seat}>Ghế {intent.seat} · yêu cầu đã gửi</option>}
              {freeSeats.map((n) => <option key={n} value={n}>Ghế {n}</option>)}
            </select>
          </label>
        </div>
        {!intent && !contextValid && <p role="alert">Chưa xác minh được phiên bàn. Tải lại trước khi thêm người.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {intent && <><p className="text-xs text-muted-foreground">Đang giữ yêu cầu đã gửi. Đóng cửa sổ không hủy thao tác trên server.</p>
          <Button variant="outline" disabled={busy} onClick={() => void send(true)}>Đối chiếu yêu cầu</Button></>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => p.onOpenChange(false)}>Đóng</Button>
          <Button disabled={busy || journalBlocked || (!intent && (!contextValid || name.trim().length < 2 || seat === null || !freeSeats.includes(seat)))}
            onClick={() => void send(false)}>{busy ? "Đang xác nhận…" : intent ? "Gửi lại nguyên yêu cầu" : "Thêm người"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <SeatReceiptDialog open={receipt !== null} receipt={receipt} onOpenChange={(v) => { if (!v) { setReceipt(null); p.onOpenChange(false); } }} />
  </>;
}
