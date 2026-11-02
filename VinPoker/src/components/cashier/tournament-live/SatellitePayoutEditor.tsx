import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Plus, Save, Ticket, Trash2 } from "lucide-react";
import { parseSatellitePayout, type SatellitePrizeRow } from "@/lib/satellitePayout";
import {observeTrackerContextRead} from '@/lib/tournament/observeTrackerContextRead';

// Satellite payout (nhập tay) — giải vé trả GHẾ/vé + 1 phần tiền "bubble", KHÔNG qua payout engine
// (engine money-only + Σ=pool bắt buộc → không chứa được vé). Owner muốn ĐƠN GIẢN: operator tự nhập,
// tự tính. Lưu tách vào tournaments.satellite_payout (jsonb tự do) — không đụng tournament_prizes /
// prepare_payout_snapshot / apply_payout_run. Gated bởi FEATURES.payoutSatelliteManual ở component cha.
//
// Cột satellite_payout là SOURCE-ONLY (migration 20261238000000 — owner apply qua controlled runbook).
// Trước khi apply: đọc lỗi "column không tồn tại" → coi như trống; ghi báo cần cập nhật CSDL.

const EMPTY_ROW: SatellitePrizeRow = { label: "", prize: "" };
const isMissingColumn = (msg?: string) =>
  !!msg && /satellite_payout/i.test(msg) && /(column|does not exist|schema cache|find the)/i.test(msg);

export function SatellitePayoutEditor({ tournamentId }: { tournamentId: string }) {
  return <TournamentSatellitePayoutEditor key={tournamentId} tournamentId={tournamentId}/>;
}

function TournamentSatellitePayoutEditor({ tournamentId }: { tournamentId: string }) {
  const [rows, setRows] = useState<SatellitePrizeRow[]>([{ ...EMPTY_ROW }]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dbMissing, setDbMissing] = useState(false);
  // Stale-request token (mẫu requestSeqRef của useTournamentTvData): đổi giải / "Thử lại" liên tiếp
  // → response cũ về muộn KHÔNG được ghi đè state của request mới.
  const loadSeqRef = useRef(0);
  const activeRef=useRef(false);
  const readControllerRef=useRef<AbortController|null>(null);

  const load = useCallback(async () => {
    if(!activeRef.current)return;
    readControllerRef.current?.abort();
    const controller=new AbortController();readControllerRef.current=controller;
    const seq = ++loadSeqRef.current;
    const current=()=>activeRef.current&&seq===loadSeqRef.current&&!controller.signal.aborted;
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await observeTrackerContextRead(Promise.resolve((supabase as any)
        .from("tournaments")
        .select("satellite_payout")
        .eq("id", tournamentId)
        .abortSignal(controller.signal)
        .maybeSingle()));
      if (!current()) return;
      if (error) {
        // Preserve the explicit missing-column compatibility branch, not a
        // general empty-data fallback for network or authorization failures.
        if(isMissingColumn(error.message)){
          setDbMissing(true);setRows([{...EMPTY_ROW}]);setDirty(false);return;
        }
        throw error;
      }
      if(!data||typeof data!=='object'||!Object.prototype.hasOwnProperty.call(data,'satellite_payout'))
        throw new Error('Không xác minh được cơ cấu satellite của giải. Vui lòng tải lại.');
      setDbMissing(false);
      const parsed = parseSatellitePayout(data.satellite_payout);
      setRows(parsed && parsed.rows.length > 0 ? parsed.rows.map((r) => ({ ...r })) : [{ ...EMPTY_ROW }]);
      setDirty(false);
    } catch(error:unknown) {
      if(!current())return;
      const message=error&&typeof error==='object'&&'message' in error?String(error.message):'';
      setDbMissing(false);
      setLoadError(message==='tracker_context_read_timeout'
        ?'Hết thời gian tải cơ cấu satellite. Vui lòng tải lại.':message||'Không tải được cơ cấu satellite');
      controller.abort();
    } finally {
      if(activeRef.current&&readControllerRef.current===controller)setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    activeRef.current=true;
    void load();
    return ()=>{activeRef.current=false;readControllerRef.current?.abort();readControllerRef.current=null;};
  }, [load]);

  const setRow = (i: number, patch: Partial<SatellitePrizeRow>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const addRow = () => {
    setRows((prev) => [...prev, { ...EMPTY_ROW }]);
    setDirty(true);
  };
  const removeRow = (i: number) => {
    setRows((prev) => (prev.length <= 1 ? [{ ...EMPTY_ROW }] : prev.filter((_, idx) => idx !== i)));
    setDirty(true);
  };

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const clean = rows
        .map((r) => ({ label: r.label.trim(), prize: r.prize.trim() }))
        .filter((r) => r.label !== "" || r.prize !== "");
      // Rỗng hết → xoá cơ cấu (NULL) = không dùng satellite.
      const payload = clean.length > 0 ? { rows: clean } : null;
      // .select("id") = RETURNING: UPDATE bị RLS lọc (0 row) trả data=[] KHÔNG error → phải bắt
      // tay, nếu không sẽ toast success giả rồi load() xoá sạch dữ liệu operator vừa gõ.
      // An toàn không báo lỗi giả: SELECT trên tournaments rộng hơn UPDATE (anon-read qual=true
      // + tournaments_select) → ai UPDATE được chắc chắn SELECT được row RETURNING.
      const { data, error } = await (supabase as any)
        .from("tournaments")
        .update({ satellite_payout: payload })
        .eq("id", tournamentId)
        .select("id");
      if (error) {
        if (isMissingColumn(error.message)) {
          setDbMissing(true);
          toast.error("Chưa thể lưu — cần áp dụng cập nhật CSDL satellite (owner) trước.");
        } else {
          toast.error(error.message || "Không lưu được cơ cấu satellite");
        }
        return;
      }
      if (Array.isArray(data) && data.length === 0) {
        if (import.meta.env.DEV) console.warn("[save_satellite_payout] zero-row update", { tournamentId, returnedRows: 0 });
        toast.error("Không có quyền lưu — cần tài khoản chủ CLB hoặc quyền điều hành sàn.");
        return;
      }
      if (!Array.isArray(data) || data.length !== 1 || data[0]?.id !== tournamentId) {
        toast.error("Chưa xác minh được kết quả lưu cơ cấu satellite. Hãy tải lại giải để kiểm tra trước khi lưu lại.");
        return;
      }
      toast.success(payload ? "Đã lưu cơ cấu satellite" : "Đã xoá cơ cấu satellite");
      setDirty(false);
      await load();
    } catch {
      toast.error("Chưa xác minh được kết quả lưu cơ cấu satellite. Hãy tải lại giải để kiểm tra trước khi lưu lại.");
    } finally {
      setSaving(false);
    }
  }, [rows, tournamentId, load]);

  return (
    <Card className="p-4 space-y-3 border-amber-500/30">
      <div className="flex items-center gap-2">
        <Ticket className="w-4 h-4 text-amber-500" />
        <span className="font-semibold">Satellite — trả vé <span className="font-normal text-muted-foreground">· nhập tay</span></span>
      </div>
      <p className="text-xs text-muted-foreground">
        Giải vé (satellite) trả GHẾ/vé + phần tiền "bubble" — tự nhập, tự tính. Không qua engine tính tiền, không cần Σ = prize pool.
        Ví dụ: <span className="text-foreground">Hạng "1–12" → "1 vé"</span>, <span className="text-foreground">Hạng "13" → "4.500.000"</span>.
      </p>

      {dbMissing && (
        <div className="rounded border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
          CSDL chưa có cột <code>satellite_payout</code> — owner cần áp dụng cập nhật (migration 20261238000000) trước khi lưu.
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Đang tải…
        </div>
      ) : loadError ? (
        // Lỗi tải THẬT (không phải thiếu cột) → chặn editor: nếu cho sửa trên bảng trống,
        // Lưu sẽ đè dữ liệu thật bằng bảng trống. Chỉ cho Thử lại.
        <div className="space-y-2 py-3 text-center">
          <p role="alert" className="text-sm text-destructive">{loadError}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
            Thử lại
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-[11px] text-muted-foreground">
              <span>Khoảng hạng</span>
              <span>Phần thưởng</span>
              <span className="w-8" />
            </div>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input
                  value={r.label}
                  onChange={(e) => setRow(i, { label: e.target.value })}
                  placeholder="vd: 1–12"
                  aria-label={`Khoảng hạng dòng ${i + 1}`}
                />
                <Input
                  value={r.prize}
                  onChange={(e) => setRow(i, { prize: e.target.value })}
                  placeholder="vd: 1 vé / 4.500.000"
                  aria-label={`Phần thưởng dòng ${i + 1}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => removeRow(i)}
                  aria-label={`Xoá dòng ${i + 1}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              <Plus className="w-4 h-4 mr-1" /> Thêm dòng
            </Button>
            <Button type="button" size="sm" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              Lưu
            </Button>
            {dirty && <span className="text-[11px] text-muted-foreground">có thay đổi chưa lưu</span>}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Để trống hết rồi Lưu = xoá cơ cấu satellite (giải trả tiền như bình thường).
          </p>
        </>
      )}
    </Card>
  );
}
