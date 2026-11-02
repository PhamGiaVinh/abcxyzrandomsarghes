/**
 * DealerSwingInfraHealth — swing-ENGINE health, shown below the floor "Sức khoẻ sàn"
 * strip (C2). The summary strip shows FLOOR health (coverage/overdue/break); this shows
 * the automation behind it: process-swing lease state (running / idle / stuck-overran),
 * a cron-liveness proxy ("hoạt động gần nhất"), and the Telegram pre-announce queue.
 *
 * Fed by the read-only get_dealer_swing_health RPC (useDealerSwingHealth). PRESENTATION
 * ONLY; unavailable and missing-club responses stay explicit, never healthy by omission.
 */
import { cn } from "@/lib/utils";
import type { ClubSwingHealth } from "@/hooks/useDealerSwingHealth";

interface Props {
  health: ClubSwingHealth[] | null;
  clubs: { id: string; name: string }[];
  unavailable: boolean;
  nowMs: number;
}

/** Compact relative duration from a second-count (e.g. 95 → "1m", 4000 → "1h 6m"). */
function rel(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
}

function ageSecFromIso(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 1000));
}

export default function DealerSwingInfraHealth({ health, clubs, unavailable, nowMs }: Props) {
  if (clubs.length === 0) return null;
  if (unavailable) return (
    <div role="alert" className="mb-4 rounded-xl border border-border/60 bg-card/40 px-4 py-2.5 text-sm text-muted-foreground">
      Hạ tầng swing: Không xác minh được. Kiểm tra kết nối rồi tải lại; chưa có dữ liệu để kết luận hệ thống ổn định.
    </div>
  );
  if (!health) return <div role="status" className="mb-4 text-sm text-muted-foreground">Hạ tầng swing: Đang xác minh…</div>;
  const missing = clubs.filter((club) => !health.some((row) => row.club_id === club.id));
  const nameOf = (id: string) => clubs.find((c) => c.id === id)?.name ?? "CLB";
  const multi = clubs.length > 1;

  return (
    <div className="mb-4 rounded-xl border border-border/60 bg-card/40 px-4 py-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="font-display text-[11px] uppercase tracking-wider text-muted-foreground">Hạ tầng swing</span>
        <span className="text-[10px] text-muted-foreground/70">· bộ máy tự động</span>
      </div>

      <div className="flex flex-col gap-2">
        {missing.length > 0 && <p role="alert" className="text-sm text-muted-foreground">
          Không xác minh được: {missing.map((club) => club.name).join(", ")}. Kiểm tra quyền CLB và tải lại.
        </p>}
        {health.map((h) => {
          const held = !!h.lock?.held;
          const stuck = held && !!h.lock?.is_expired;
          const queueBacklog = (h.pre_announce?.pending ?? 0) + (h.pre_announce?.processing ?? 0);
          const failed = h.pre_announce?.failed_recent ?? 0;
          const actAge = ageSecFromIso(h.last_swing_activity_at, nowMs);

          let engineLabel: string;
          let engineColor: string;
          let dot: string;
          if (stuck) {
            engineLabel = `Kẹt khoá ${rel(h.lock?.age_seconds)}`;
            engineColor = "text-destructive";
            dot = "bg-destructive";
          } else if (held) {
            engineLabel = `Đang chạy ${rel(h.lock?.age_seconds)}`;
            engineColor = "text-primary";
            dot = "bg-primary";
          } else {
            engineLabel = "Nhàn rỗi";
            engineColor = "text-muted-foreground";
            dot = "bg-muted-foreground/50";
          }

          return (
            <div key={h.club_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              {multi && <span className="min-w-[88px] font-medium text-foreground/80">{nameOf(h.club_id)}</span>}

              <span className={cn("inline-flex items-center gap-1.5", engineColor)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", dot, held && !stuck && "animate-pulse")} aria-hidden="true" />
                {engineLabel}
              </span>

              <span className="text-muted-foreground">
                Hoạt động gần nhất:{" "}
                <span className="text-foreground/80">{actAge == null ? "—" : `${rel(actAge)} trước`}</span>
              </span>

              <span className="text-muted-foreground">
                Hàng đợi TB:{" "}
                <span className={queueBacklog > 0 ? "text-warning" : "text-foreground/80"}>{queueBacklog}</span>
                {failed > 0 && <span className="text-destructive"> · {failed} lỗi</span>}
              </span>

              {stuck && (
                <span className="inline-flex items-center gap-1 rounded border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-destructive">
                  ⚠️ lease quá hạn — kiểm tra process-swing
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
