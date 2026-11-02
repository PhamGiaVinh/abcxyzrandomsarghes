/**
 * FeatureTablePoolBox — right-rail "Bàn tâm điểm / Final" LEAN SUMMARY
 * (Dealer Swing UI declutter, 2026-07-02).
 *
 * Shows ONLY special (feature/final) tables + their reserved pool — the one thing the
 * battle map does NOT already show. The old full per-table list (EVERY table + a mode
 * filter + a per-table config gear) used to render here and re-listed all ~100 tables,
 * duplicating the map and towering over the right rail. That full CONFIG surface moved
 * into FeatureTableManageDialog, opened on demand via the "Cấu hình…" header button, so
 * the always-on rail now holds a read-only summary of just the special tables.
 *
 * NO logic/RPC change: same store (getProfile/isSpecial), same enforcement banner, same
 * FeatureTableConfigDialog (now reached through the manage dialog). Only WHICH rows render
 * in the rail changed (special-only) + WHERE editing lives (a dialog). Rendered only when
 * FEATURES.dealerFeatureTables (gated at the call site).
 */
import { useMemo, useState } from "react";
import { Settings2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FeatureTableBadge } from "./FeatureTableBadge";
import { FeatureTableManageDialog } from "./FeatureTableManageDialog";
import {
  getProfile, isSpecial, useFeatureTableVersion,
  useFeatureTableRules, useFeatureEnforcementEnabled,
} from "./featureTableMock";

export function FeatureTablePoolBox({ clubId, tables, dealers }: { clubId: string | null; tables: any[]; dealers: any[] }) {
  const ver = useFeatureTableVersion();
  const { loading, error, refetch } = useFeatureTableRules(clubId); // P1-B: reads via get_table_dealer_rules
  const { enabled: enforcementOn, loading: enforcementLoading, error: enforcementError,
    refetch: retryEnforcement } = useFeatureEnforcementEnabled();
  const [manageOpen, setManageOpen] = useState(false);

  // in-shift dealer → live state, for the pool availability label
  const stateByDealer = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of dealers ?? []) { if (d?.dealer_id) m.set(d.dealer_id, d.current_state ?? "available"); }
    return m;
  }, [dealers]);

  // ONLY special tables — never the normal ones (the battle map is the source of truth for those).
  const special = useMemo(
    () => (tables ?? []).filter((t) => isSpecial(getProfile(t.id))),
    [tables, ver],
  );

  const counts = useMemo(() => {
    let feature = 0, final = 0;
    for (const t of special) {
      if (getProfile(t.id).isFinal) final++;
      else feature++;
    }
    return { feature, final };
  }, [special, ver]);

  const emptyPoolCount = useMemo(
    () => special.filter((t) => getProfile(t.id).pool.length === 0).length,
    [special, ver],
  );

  const availLabel = (st: string | undefined) =>
    st === "on_break" ? { t: "nghỉ", c: "text-[hsl(var(--ds-active))]" }
      : st === "assigned" ? { t: "đang chia", c: "text-muted-foreground" }
        : st ? { t: "sẵn sàng", c: "text-success" } : { t: "—", c: "text-muted-foreground/50" };

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-display text-sm font-bold tracking-wide text-foreground">Bàn tâm điểm / Final</span>
        <div className="flex items-center gap-2">
          {loading && <span className="text-[10px] text-muted-foreground">Đang tải…</span>}
          <button
            onClick={() => setManageOpen(true)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Settings2 className="h-3 w-3" aria-hidden="true" /> Cấu hình…
          </button>
        </div>
      </div>

      {enforcementLoading && <p role="status" className="mb-2 text-[11px] text-muted-foreground">Đang xác minh trạng thái bảo vệ bàn…</p>}
      {enforcementError && (
        <div role="alert" className="mb-2 space-y-1 rounded-md border border-warning/40 bg-warning/5 p-2 text-[11px] text-warning">
          <p>{enforcementError}</p>
          <button type="button" onClick={() => void retryEnforcement()} className="underline">Thử lại trạng thái bảo vệ</button>
        </div>
      )}
      {enforcementOn === false && (
        <div className="mb-2 rounded-md border border-warning/40 bg-warning/5 p-2 text-[11px] text-warning">
          ℹ Cấu hình đã lưu nhưng <b>enforcement đang TẮT</b> — nhóm dealer chưa bảo vệ bàn (bật sau).
        </div>
      )}
      {error && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-[11px] text-destructive">
          <span className="min-w-0 flex-1 truncate">Lỗi tải cấu hình: {error}</span>
          <button onClick={() => void refetch()} className="shrink-0 underline">Thử lại</button>
        </div>
      )}

      {/* compact summary line (special-only) */}
      <div className="mb-2 text-[11px] text-muted-foreground">
        Tâm điểm <b className="text-success">{counts.feature}</b> · Final <b className="text-amber-400">{counts.final}</b>
      </div>

      {emptyPoolCount > 0 && (
        <button
          onClick={() => setManageOpen(true)}
          className="mb-2 flex w-full items-center gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-2 py-1.5 text-left text-[11px] text-warning transition-colors hover:bg-warning/10"
        >
          ⚠ {emptyPoolCount} bàn chưa có đội — bấm để cấu hình
        </button>
      )}

      {special.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-2 py-3 text-center text-[11px] text-muted-foreground">
          Chưa có bàn tâm điểm — nhấn <b className="text-foreground">Cấu hình…</b> để đặt
        </div>
      ) : (
        <div className="max-h-72 space-y-1 overflow-auto">
          {special.map((t) => {
            const p = getProfile(t.id);
            return (
              <div key={t.id} className="rounded-md border border-border bg-muted/20 p-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{t.table_name}</span>
                  <FeatureTableBadge tableId={t.id} />
                </div>
                <div className="mt-1 space-y-0.5">
                  {p.pool.length === 0 ? (
                    <div className="text-[11px] text-warning">⚠ Chưa có dealer — sẽ báo thiếu</div>
                  ) : p.pool.map((m) => {
                    const av = availLabel(stateByDealer.get(m.dealerId));
                    return (
                      <div key={m.dealerId} className="flex items-center gap-1.5 text-[11px]">
                        {m.isPrimary && <span className="shrink-0 text-amber-400" aria-hidden="true">★</span>}
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{m.name}</span>
                        <span className={cn("shrink-0", av.c)}>{av.t}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {clubId && (
        <FeatureTableManageDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          clubId={clubId}
          tables={tables}
          dealers={dealers}
        />
      )}
    </Card>
  );
}
