import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Dices } from "lucide-react";
import {
  computeAvailability, capacityCheck,
  type AvailabilityTable, type TournamentTableRow,
} from "@/lib/seatAvailability";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import type { SeatReceiptData } from "@/components/tournament/seat/SeatReceipt";

export interface DrawRegistration {
  id: string;
  reference_code: string;
  player_name: string;
}

type DrawMode = "random_balanced" | "fill_lowest_table";

interface DrawResultRow {
  registrationId: string;
  playerName: string;
  ok: boolean;
  tableNumber?: number | null;
  seatNumber?: number;
  receiptCode?: string;
  error?: string;
  skipped?: boolean;
}

type ConfirmResult = {
  ok: boolean;
  error?: string;
  table_number?: number | null;
  seat_number?: number;
  receipt_code?: string;
  display_name?: string;
  starting_stack?: number | null;
};

// Same wording as TournamentRegistrationsTab — floor-facing.
function mapError(code?: string): string {
  switch (code) {
    case "registration_not_found": return "Không tìm thấy đăng ký";
    case "actor_not_allowed": return "Không có quyền xác nhận cho CLB này";
    case "invalid_status": return "Không còn ở trạng thái chờ (có thể cashier khác vừa xử lý)";
    case "tournament_not_found": return "Không tìm thấy giải";
    case "tournament_not_open": return "Giải đã kết thúc/huỷ";
    case "player_already_active": return "Người chơi đã có ghế";
    case "no_table_available":
    case "no_seat_available": return "Hết bàn/ghế trống";
    case "already_confirmed_no_entry": return "Đã xác nhận trước đó nhưng chưa có ghế — xử lý thủ công";
    default: return code ? `Thất bại (${code})` : "Thất bại";
  }
}

/**
 * Capacity-only preview → sequential commit reveal (owner decision 2026-06-13).
 * The preview NEVER shows which seat a player will get — seats are drawn
 * server-side at commit (atomic, audited, no reroll). The commit loop is
 * sequential on purpose: the RPC serializes per-tournament via FOR UPDATE, and
 * stopping deterministically on the first no_seat_available leaves a clean,
 * explainable state.
 */
export function SeatDrawDialog({
  open, onOpenChange, tournamentId, tournamentName, tournamentDate, registrations, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string | null;
  registrations: DrawRegistration[];
  onDone: () => void;
}) {
  const { user } = useAuth();
  const [phase, setPhase] = useState<"preview" | "committing" | "done">("preview");
  const [availability, setAvailability] = useState<AvailabilityTable[] | null>(null);
  const [availabilityError,setAvailabilityError]=useState(false);
  const [readRevision,setReadRevision]=useState(0);
  const [drawMode, setDrawMode] = useState<DrawMode>("random_balanced");
  const [results, setResults] = useState<DrawResultRow[]>([]);
  const [receipt, setReceipt] = useState<SeatReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  // Load availability fresh on every open (floor state moves fast).
  useEffect(() => {
    if (!open) { setPhase("preview"); setResults([]); setAvailability(null); return; }
    let current=true;setAvailability(null);setAvailabilityError(false);
    (async () => {
      try{
      const [{ data: tables,error:tableError }, { data: seats,error:seatError }] = await Promise.all([
        supabase.from("tournament_tables")
          .select("id, table_name, table_number, max_seats, status, table_id, game_table_id, table_session_id")
          .eq("tournament_id", tournamentId),
        supabase.from("tournament_seats")
          .select("table_id, is_active, tournament_table_id, table_session_id")
          .eq("tournament_id", tournamentId)
          .eq("is_active", true),
      ]);
      if(!current)return;
      if(tableError||seatError||!Array.isArray(tables)||!Array.isArray(seats))throw new Error('capacity_unverified');
      setAvailability(computeAvailability(tables as TournamentTableRow[],seats));
      }catch{if(current)setAvailabilityError(true);}
    })();
    return()=>{current=false;};
  }, [open, tournamentId,user?.id,readRevision]);

  const cap = availability ? capacityCheck(registrations.length, availability) : null;

  const runDraw = async () => {
    if (!user) return;
    setPhase("committing");
    const acc: DrawResultRow[] = [];
    let stopped = false;
    for (const reg of registrations) {
      if (stopped) {
        acc.push({ registrationId: reg.id, playerName: reg.player_name, ok: false, skipped: true });
        setResults([...acc]);
        continue;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC source: supabase/migrations/20260807000001 + 20260811000000; not in generated types yet
      const { data, error } = await (supabase.rpc as any)("confirm_registration_and_assign_seat", {
        p_registration_id: reg.id,
        p_actor_user_id: user.id,
        p_draw_mode: drawMode,
      });
      const res = (data ?? null) as ConfirmResult | null;
      if (error || !res?.ok) {
        const code = error ? error.message : res?.error;
        acc.push({ registrationId: reg.id, playerName: reg.player_name, ok: false, error: mapError(code) });
        // Deterministic stop: once the room is full every later draw fails the same way.
        if (res?.error === "no_seat_available" || res?.error === "no_table_available") stopped = true;
      } else {
        acc.push({
          registrationId: reg.id,
          playerName: res.display_name ?? reg.player_name,
          ok: true,
          tableNumber: res.table_number,
          seatNumber: res.seat_number,
          receiptCode: res.receipt_code,
        });
        if (registrations.length === 1) {
          setReceipt({
            tournamentName,
            tournamentDate,
            playerName: res.display_name ?? reg.player_name,
            tableNumber: res.table_number ?? null,
            seatNumber: res.seat_number!,
            receiptCode: res.receipt_code!,
            startingStack: res.starting_stack ?? null,
            qrValue: res.receipt_code!,
          });
        }
      }
      setResults([...acc]); // progressive reveal
    }
    setPhase("done");
  };

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => !r.ok && !r.skipped).length;
  const skipCount = results.filter((r) => r.skipped).length;

  const close = (v: boolean) => {
    if (phase === "committing") return; // never close mid-draw
    onOpenChange(v);
    if (!v && phase === "done") onDone();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Dices className="w-4 h-4 text-primary" /> Bốc thăm chỗ
            </DialogTitle>
            <DialogDescription>
              {phase === "preview"
                ? "Kiểm tra sức chứa trước khi bốc. Ghế chính xác chỉ được quyết định lúc bốc — kết quả là cuối cùng và được ghi vào lịch sử."
                : "Kết quả bốc thăm — mỗi dòng hiện ra khi server hoàn tất."}
            </DialogDescription>
          </DialogHeader>

          {phase === "preview" && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Người chờ xếp ghế ({registrations.length})</Label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {registrations.map((r) => (
                    <span key={r.id} className="px-2 py-0.5 rounded-md bg-muted/50 border border-border text-xs">
                      {r.player_name}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs">Bàn đang mở</Label>
                {availabilityError?<div role="alert" className="space-y-2 text-sm text-destructive"><p>Không xác minh được sức chứa bàn. Chưa cho phép bốc thăm.</p><Button variant="outline" onClick={()=>setReadRevision(v=>v+1)}>Tải lại sức chứa</Button></div>:availability === null ? (
                  <Skeleton className="h-16 mt-1" />
                ) : availability.length === 0 ? (
                  <div className="mt-1 text-xs text-destructive flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> Không có bàn active nào — mở bàn trong Table Draw trước.
                  </div>
                ) : (
                  <div className="mt-1 space-y-1">
                    {availability.map((t) => (
                      <div key={t.tournamentTableId} className="flex items-center justify-between text-xs rounded-md border border-border bg-card/40 px-2.5 py-1.5">
                        <span className="font-medium">{t.tableName}</span>
                        <span className="text-muted-foreground">
                          {t.activeCount}/{t.maxSeats} ghế · <span className={t.freeSeats > 0 ? "text-success" : "text-destructive"}>{t.freeSeats} trống</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {cap && availability && availability.length > 0 && (
                <div className={`rounded-md border px-3 py-2 text-xs flex items-center gap-2 ${
                  cap.ok ? "border-emerald-600/40 bg-emerald-950/20 text-emerald-300"
                         : "border-amber-600/50 bg-amber-950/30 text-amber-300"
                }`}>
                  {cap.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                  {cap.ok
                    ? `Đủ chỗ: ${cap.waitingCount} người chờ / ${cap.totalFree} ghế trống.`
                    : `${cap.shortBy} người sẽ thiếu ghế (${cap.waitingCount} chờ / ${cap.totalFree} trống) — thêm bàn trước khi bốc, hoặc bốc sẽ dừng khi hết ghế.`}
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">Chế độ xếp chỗ</Label>
                <Select value={drawMode} onValueChange={(v) => setDrawMode(v as DrawMode)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="random_balanced">Bốc thăm cân bàn (mặc định)</SelectItem>
                    <SelectItem value="fill_lowest_table">Lấp bàn số nhỏ trước</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {phase !== "preview" && (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {results.map((r) => (
                <div key={r.registrationId} className="flex items-center justify-between text-sm rounded-md border border-border bg-card/40 px-2.5 py-1.5">
                  <span className="font-medium truncate">{r.playerName}</span>
                  {r.ok ? (
                    <span className="text-success flex items-center gap-1.5 shrink-0">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Bàn {r.tableNumber ?? "?"} · Ghế {r.seatNumber}
                    </span>
                  ) : r.skipped ? (
                    <span className="text-muted-foreground text-xs shrink-0">Bỏ qua — hết ghế</span>
                  ) : (
                    <span className="text-destructive flex items-center gap-1.5 text-xs shrink-0">
                      <XCircle className="w-3.5 h-3.5" /> {r.error}
                    </span>
                  )}
                </div>
              ))}
              {phase === "committing" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang bốc {results.length + 1}/{registrations.length}…
                </div>
              )}
              {phase === "done" && (
                <div className="text-xs text-muted-foreground pt-1.5">
                  Xong: {okCount} có ghế{failCount > 0 ? ` · ${failCount} lỗi` : ""}{skipCount > 0 ? ` · ${skipCount} bỏ qua (hết ghế)` : ""}.
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {phase === "preview" && (
              <>
                <Button variant="outline" onClick={() => close(false)}>Quay lại</Button>
                <Button
                  disabled={registrations.length === 0 || availability === null || availability.length === 0}
                  onClick={runDraw}
                >
                  <Dices className="w-4 h-4 mr-1.5" /> Bốc thăm ({registrations.length} người)
                </Button>
              </>
            )}
            {phase === "done" && (
              <>
                {receipt && okCount === 1 && registrations.length === 1 && (
                  <Button variant="outline" onClick={() => setReceiptOpen(true)}>Xem phiếu</Button>
                )}
                <Button onClick={() => close(false)}>Đóng</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SeatReceiptDialog open={receiptOpen} onOpenChange={setReceiptOpen} receipt={receipt} />
    </>
  );
}
