import { useMemo } from "react";
import type { DealerAssignment, DealerAttendance, NextDealerPrediction } from "@/hooks/useDealerSwing";
import type { RotationTableSlots } from "@/hooks/useRotationSchedule";
import { dealerTableCoverage } from "@/lib/dealerTableCoverage";

export type AttentionType = "ot" | "empty_table" | "break_due" | "missing_next_dealer" | "shortage";

export interface AttentionItem {
  id: string;
  type: AttentionType;
  severity: "critical" | "warning";
  score: number;
  title: string;
  subtitle?: string;
  tableId?: string;
  tableName?: string;
  attendanceId?: string;
}

export interface AttentionQueueResult {
  items: AttentionItem[];
  criticalItems: AttentionItem[];
  warningItems: AttentionItem[];
  totalCount: number;
  criticalCount: number;
}

interface UseAttentionQueueProps {
  assignments: DealerAssignment[];
  tables: any[];
  dealers: DealerAttendance[];
  tableAssignmentMap: Record<string, DealerAssignment | null>;
  timelineByTableId: Record<string, { minutesLeft: number; showNextDealerSoon: boolean; isOverdue: boolean }>;
  nextDealerMap: Record<string, NextDealerPrediction> | null;
  /** Live rotation-schedule slots per table — when slot0 exists, automation owns the next-dealer plan. */
  scheduleByTableId?: Record<string, RotationTableSlots> | null;
  nowMs: number;
}

const BASE_SCORE: Record<AttentionType, number> = {
  ot: 100,
  empty_table: 90,
  shortage: 70,
  break_due: 55,
  missing_next_dealer: 40,
};

function cap(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatTimeHHmm(ms: number): string {
  return new Date(ms).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function useAttentionQueue({
  assignments, tables, dealers, tableAssignmentMap,
  timelineByTableId, nextDealerMap, scheduleByTableId, nowMs,
}: UseAttentionQueueProps): AttentionQueueResult {
  return useMemo(() => {
    const items: AttentionItem[] = [];

    // Missing schedule/prediction is not proof of coverage. Use the same exact
    // session coverage as the summary; never offer an action for raw inventory.
    for (const table of tables ?? []) {
      if (table.status !== "active" || !table.table_session_id) continue;
      if (dealerTableCoverage([table], assignments).assignedTables !== 0) continue;
      items.push({
        id: `empty-${table.table_session_id}`,
        type: "empty_table",
        severity: "warning",
        score: BASE_SCORE.empty_table,
        title: `${table.table_name ?? "Bàn"} • Thiếu dealer`,
        subtitle: "Phiên bàn đang mở chưa có phân công hiệu lực",
        tableId: table.id,
        tableName: table.table_name ?? undefined,
      });
    }

    // ── 1. OT — confirmed overtime_started_at ──
    for (const a of assignments) {
      if (a.status !== "assigned") continue;
      if (!a.overtime_started_at) continue;

      const otSec = Math.floor((nowMs - new Date(a.overtime_started_at).getTime()) / 1000);
      const otMin = Math.floor(otSec / 60);
      const timeFactor = cap(otMin, 0, 50);
      const score = BASE_SCORE.ot + timeFactor;

      const otDisplay = otMin >= 60
        ? `+${Math.floor(otMin / 60)}h${otMin % 60}m`
        : `+${otMin}m`;

      items.push({
        id: `ot-${a.id}`,
        type: "ot",
        severity: score >= 80 ? "critical" : "warning",
        score,
        title: `${a.game_tables?.table_name ?? "??"} • OT ${otDisplay}`,
        subtitle: a.dealer_attendance?.dealers?.full_name ?? undefined,
        tableId: a.table_id,
        tableName: a.game_tables?.table_name ?? undefined,
        attendanceId: a.attendance_id,
      });
    }

    // ── 2. Break due ──
    for (const d of dealers ?? []) {
      const assignment = assignments.find((a) => a.attendance_id === d.id && a.status === "assigned");
      let w: number;
      if (assignment?.assigned_at) {
        w = Math.max(0, Math.floor((nowMs - new Date(assignment.assigned_at).getTime()) / 60000));
      } else {
        const stored = d.worked_minutes_since_last_break ?? 0;
        const STALE_DATA_CAP = 180;
        w = stored > STALE_DATA_CAP ? 0 : stored;
      }
      if (w < 90 && !d.priority_break_flag) continue;
      const excess = cap(w - 90, 0, 30);
      const score = BASE_SCORE.break_due + excess;
      const name = (d as any).dealers?.full_name ?? "??";

      items.push({
        id: `break-${d.id}`,
        type: "break_due",
        severity: score >= 80 ? "critical" : "warning",
        score,
        title: `${name} • Cần nghỉ`,
        subtitle: d.priority_break_flag ? "Priority break" : `Đã làm ${w} phút`,
        attendanceId: d.id,
      });
    }

    // ── 3. Shortage — rotation schedule slot-0 flagged is_shortage ──
    for (const t of tables ?? []) {
      const slot0 = scheduleByTableId?.[t.id]?.slot0;
      if (!slot0?.is_shortage) continue;

      const tableName = t.table_name ?? "??";
      const a = tableAssignmentMap[t.id];
      const dueMs = a?.swing_due_at ? new Date(a.swing_due_at).getTime() : null;
      const reliefMs = slot0.planned_relief_at ? new Date(slot0.planned_relief_at).getTime() : null;
      // OT minutes the sitting dealer will absorb: planned relief vs swing due
      // (falls back to "how overdue right now" when no relief time is known).
      const otMin = dueMs != null
        ? Math.max(0, Math.round(((reliefMs ?? nowMs) - dueMs) / 60000))
        : 0;
      const score = BASE_SCORE.shortage + cap(otMin, 0, 30);

      items.push({
        id: `shortage-${slot0.id}`,
        type: "shortage",
        severity: otMin > 10 ? "critical" : "warning",
        score,
        title: `Thiếu dealer — ${tableName}`,
        subtitle: reliefMs != null
          ? `Dự kiến thay ${formatTimeHHmm(reliefMs)} (+${otMin}m OT)`
          : "Chưa có giờ thay dự kiến",
        tableId: t.id,
        tableName,
      });
    }

    // ── 4. Missing next dealer ──
    if (nextDealerMap) {
      for (const t of tables ?? []) {
        // Automation owns the plan when a live slot-0 schedule row exists —
        // skip the manual "missing next dealer" nag for that table.
        if (scheduleByTableId?.[t.id]?.slot0) continue;
        const tl = timelineByTableId[t.id];
        if (!tl?.showNextDealerSoon) continue;
        const pred = nextDealerMap[t.id];
        if (pred?.nextDealerName) continue;

        const minutesToSwing = tl.minutesLeft;
        const timeFactor = cap(30 - minutesToSwing, 0, 30);
        const score = BASE_SCORE.missing_next_dealer + timeFactor;
        const tableName = t.table_name ?? "??";

        items.push({
          id: `next-${t.id}`,
          type: "missing_next_dealer",
          severity: score >= 80 ? "critical" : "warning",
          score,
          title: `${tableName} • Chưa có dealer kế`,
          subtitle: tl.isOverdue ? "Đã quá giờ swing" : `Còn ${minutesToSwing} phút`,
          tableId: t.id,
          tableName,
        });
      }
    }

    // Sort by score descending
    items.sort((a, b) => b.score - a.score);

    return {
      items,
      criticalItems: items.filter((i) => i.severity === "critical"),
      warningItems: items.filter((i) => i.severity === "warning"),
      totalCount: items.length,
      criticalCount: items.filter((i) => i.severity === "critical").length,
    };
  }, [assignments, tables, dealers, tableAssignmentMap, timelineByTableId, nextDealerMap, scheduleByTableId, nowMs]);
}
