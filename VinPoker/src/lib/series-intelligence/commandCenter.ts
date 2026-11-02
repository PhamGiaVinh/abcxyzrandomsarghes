import { financeBusinessToday } from "../financeSummaryRead";
// Series Intelligence — Owner Command Center (Phase 1 BI, read-only, PURE).
//
// Turns the live native `SeriesEvent[]` (from `get_club_series_events` via
// `useNativeSeriesEvents`) into descriptive Business-Intelligence summaries:
// economics totals, a data-readiness score, labeled risk flags, and an owner
// action checklist.
//
// HONESTY CONTRACT (ties to the merged Club Intelligence safety contract):
//  - This is BI ("what happened / is happening"), NOT prediction. Every derived
//    insight carries exactly one label ∈ {Known Rule, Observed Pattern,
//    Hypothesis}. It NEVER emits `Model Estimate` or `Tested Finding`.
//  - Nothing is fabricated: any missing field stays null and is reported. Totals
//    that drew on incomplete data are flagged `partial`.
//  - These are descriptive, NON-AUTHORITATIVE numbers (not an accounting report,
//    not profit/P&L). A missing GTD stays missing — never faked from prize_pool.
//  - ITM / Final Table / finish positions / blind structure are NOT in the RPC
//    payload and are intentionally absent here (no fabrication, no new RPC).

import type { SeriesEvent } from "./nativeData";
import { typeOf, TYPE_LABEL, type SeriesEventType } from "./seriesEventType";

/** The only labels this BI surface may emit. `Model Estimate`/`Tested Finding` are never produced. */
export type InsightLabel = "Known Rule" | "Observed Pattern" | "Hypothesis";

/** Visual/severity bucket for a risk flag (maps to theme tokens in the UI). */
export type RiskSeverity = "info" | "warning" | "risk";

// ----------------------------------------------------------------------------
// Economics summary
// ----------------------------------------------------------------------------

/** One aggregated total + how complete the data behind it was (honest "≈" rendering). */
export interface MetricTotal {
  value: number;
  /** true when at least one event lacked a field that this total needed. */
  partial: boolean;
  /** events that actually contributed to `value`. */
  contributingCount: number;
  /** total events considered. */
  totalCount: number;
}

export interface SeriesEconomics {
  events: number;
  totalEntries: MetricTotal;
  uniquePlayers: MetricTotal;
  reentries: MetricTotal;
  totalBuyIn: MetricTotal; // Σ buy_in × entries (entries = confirmed total_entries, incl. re-entries)
  totalRake: MetricTotal; // Σ fee × entries
  totalPrizePool: MetricTotal; // Σ prize_pool_actual
}

/** One row for the per-event economics table. `rakeYieldPct` is derived, null when not safely derivable. */
export interface EventEconomicsRow {
  event_id: string;
  event_name: string | null;
  event_date: string | null;
  buy_in: number | null;
  fee: number | null;
  serviceFeeAmount: number | null;
  total_entries: number | null;
  unique_entries: number | null;
  reentries: number | null;
  prize_pool_actual: number | null;
  gtd: number | null; // committed guarantee (tournaments.guarantee_amount); null when the event has none
  rakeYieldPct: number | null; // fee / buy_in × 100, only when buy_in > 0 and both present
  missingFields: string[];
}

function total(values: Array<number | null>): MetricTotal {
  const present = values.filter((v): v is number => v !== null);
  const sum = present.reduce((a, b) => a + b, 0);
  return {
    value: sum,
    partial: present.length < values.length,
    contributingCount: present.length,
    totalCount: values.length,
  };
}

/** Σ over events that have BOTH factors present; partial if any event is missing either. */
function productTotal(
  events: SeriesEvent[],
  a: (e: SeriesEvent) => number | null,
  b: (e: SeriesEvent) => number | null,
): MetricTotal {
  const contributions = events.map((e) => {
    const av = a(e);
    const bv = b(e);
    return av !== null && bv !== null ? av * bv : null;
  });
  return total(contributions);
}

export function computeEconomicsSummary(events: SeriesEvent[]): SeriesEconomics {
  return {
    events: events.length,
    totalEntries: total(events.map((e) => e.total_entries)),
    uniquePlayers: total(events.map((e) => e.unique_entries)),
    reentries: total(events.map((e) => e.reentries)),
    totalBuyIn: productTotal(events, (e) => e.buy_in, (e) => e.total_entries),
    totalRake: productTotal(events, (e) => e.fee, (e) => e.total_entries),
    totalPrizePool: total(events.map((e) => e.prize_pool_actual)),
  };
}

/** Map a SeriesEvent → economics-table row, computing the safe rake-yield ratio. */
export function toEventEconomicsRow(e: SeriesEvent): EventEconomicsRow {
  const rakeYieldPct =
    e.fee !== null && e.buy_in !== null && e.buy_in > 0 ? (e.fee / e.buy_in) * 100 : null;
  return {
    event_id: e.event_id,
    event_name: e.event_name,
    event_date: e.event_date,
    buy_in: e.buy_in,
    fee: e.fee,
    serviceFeeAmount: e.serviceFeeAmount,
    total_entries: e.total_entries,
    unique_entries: e.unique_entries,
    reentries: e.reentries,
    prize_pool_actual: e.prize_pool_actual,
    gtd: e.gtd,
    rakeYieldPct,
    missingFields: e.missingFields,
  };
}

export function toEventEconomicsRows(events: SeriesEvent[]): EventEconomicsRow[] {
  return events.map(toEventEconomicsRow);
}

// ----------------------------------------------------------------------------
// Contribution margin by event type ("Biên đóng góp theo loại giải")
// ----------------------------------------------------------------------------
//
// DELIBERATELY NOT "profit"/"gross margin": it is fee revenue kept − observed GTD overlay cost, and it
// EXCLUDES staff/marketing/venue/operations. Grouping axis = event TYPE (main/turbo/bounty/… via the
// shared seriesEventType helper), NOT referenceDistribution's same-name axis. Money rules (locked):
//  - revenue = fee (rake) ONLY; buy-in is pass-through and never enters revenue;
//  - entries factor = total_entries (all bullets incl. re-entries) — NEVER unique_players;
//  - overlay cost only for events WITH a committed GTD and a derivable estimate; missing GTD is
//    counted + noted, never guessed.

export interface ContributionByTypeRow {
  type: SeriesEventType;
  typeLabel: string;
  eventCount: number;
  feeRevenue: MetricTotal; // Σ fee × total_entries over this type
  overlayCost: MetricTotal; // Σ max(0, gtd − buy_in × total_entries) over events with gtd + estimate
  gtdMissingCount: number; // events in this type with NO committed GTD (no cost charged — noted)
  /** feeRevenue − overlayCost; null when no event in the type had fee+entries (nothing measured). */
  margin: number | null;
  notes: string[];
}

export interface ContributionByTypeResult {
  available: boolean;
  label: InsightLabel; // Observed Pattern — measured facts only
  rows: ContributionByTypeRow[];
  disclaimer: string;
}

const CONTRIBUTION_DISCLAIMER =
  "Biên đóng góp = fee giữ lại − chi phí bù GTD (ước tính entry × buy-in). CHƯA gồm nhân sự, marketing, " +
  "mặt bằng, vận hành — KHÔNG phải lợi nhuận. Buy-in là tiền chạy qua, không nằm trong doanh thu.";

export function computeContributionByType(events: SeriesEvent[]): ContributionByTypeResult {
  const byType = new Map<SeriesEventType, SeriesEvent[]>();
  for (const e of events) {
    const t = typeOf(e.event_name);
    const list = byType.get(t);
    if (list) list.push(e);
    else byType.set(t, [e]);
  }

  const rows: ContributionByTypeRow[] = [];
  for (const [type, list] of byType) {
    const feeRevenue = productTotal(list, (e) => e.fee, (e) => e.total_entries);
    // overlay estimate per event: only when a GTD is committed AND entry×buy-in is derivable
    const withGtd = list.filter((e) => e.gtd !== null);
    const overlayCost = total(
      withGtd.map((e) =>
        e.buy_in !== null && e.total_entries !== null
          ? Math.max(0, (e.gtd as number) - e.buy_in * e.total_entries)
          : null,
      ),
    );
    const gtdMissingCount = list.length - withGtd.length;

    const notes: string[] = [];
    if (gtdMissingCount > 0) notes.push(`${gtdMissingCount} giải không đặt GTD — không tính chi phí bù (không đoán)`);
    if (feeRevenue.partial)
      notes.push(`${feeRevenue.totalCount - feeRevenue.contributingCount}/${feeRevenue.totalCount} giải thiếu fee hoặc entries — không tính vào doanh thu`);
    if (overlayCost.partial)
      notes.push(`${overlayCost.totalCount - overlayCost.contributingCount} giải có GTD nhưng thiếu buy-in/entries — chưa ước được chi phí bù`);
    // Asymmetric-missing-data artifact: an event can contribute overlay COST while its fee revenue was
    // uncountable (fee missing) — a negative margin may then be a data hole, not a real bleed. Say so.
    if (feeRevenue.partial && overlayCost.value > 0)
      notes.push("⚠ có giải bị tính chi phí bù nhưng thiếu fee — biên có thể ÂM GIẢ TẠO do thiếu dữ liệu, kiểm tra trước khi kết luận");

    rows.push({
      type,
      typeLabel: TYPE_LABEL[type],
      eventCount: list.length,
      feeRevenue,
      overlayCost,
      gtdMissingCount,
      margin: feeRevenue.contributingCount > 0 ? feeRevenue.value - overlayCost.value : null,
      notes,
    });
  }

  rows.sort((a, b) => (b.margin ?? Number.NEGATIVE_INFINITY) - (a.margin ?? Number.NEGATIVE_INFINITY));
  return {
    available: rows.some((r) => r.margin !== null),
    label: "Observed Pattern",
    rows,
    disclaimer: CONTRIBUTION_DISCLAIMER,
  };
}

/**
 * Average contribution margin per MEASURED event, derived from an existing
 * `ContributionByTypeResult` so the overview KPI and the by-type card can never disagree.
 * Denominator = events whose fee×entries actually contributed (same rule the card uses) —
 * NOT the raw event count, so data holes can't dilute the average. F&B / staff / marketing /
 * operations are NOT in this number (per-event F&B is not linked into the series data yet).
 */
export function avgContributionPerEvent(result: ContributionByTypeResult): {
  value: number | null;
  measuredCount: number;
} {
  const measured = result.rows.filter((r) => r.margin !== null);
  const measuredCount = measured.reduce((a, r) => a + r.feeRevenue.contributingCount, 0);
  if (measuredCount === 0) return { value: null, measuredCount: 0 };
  const sum = measured.reduce((a, r) => a + (r.margin as number), 0);
  return { value: sum / measuredCount, measuredCount };
}

// ----------------------------------------------------------------------------
// Quarterly breakdown ("Giải đã chạy theo quý")
// ----------------------------------------------------------------------------
//
// Descriptive counting only (Observed Pattern): events / entries / fee revenue / estimated GTD
// overlay per calendar quarter. Quarter comes from event_date in the UTC+7 business calendar; independent of
// the browser timezone. Events with no (or unparseable) date are NEVER guessed into
// a quarter; they are counted separately in `undatedCount`.

export interface QuarterlyRow {
  /** Sort key, e.g. "2026-q0" — lexicographic order == chronological order. */
  key: string;
  /** Display label, e.g. "Quý 1/2026". */
  label: string;
  eventCount: number;
  entries: MetricTotal;
  feeRevenue: MetricTotal; // Σ fee × total_entries (buy-in never enters revenue)
  overlayCost: MetricTotal; // Σ max(0, gtd − buy_in × entries), estimate — only events WITH a GTD
  gtdMissingCount: number;
}

export interface QuarterlySummary {
  available: boolean;
  label: InsightLabel; // Observed Pattern — measured facts only
  /** Newest quarter first. */
  rows: QuarterlyRow[];
  undatedCount: number;
}

function quarterOf(iso: string | null): { key: string; label: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const [year, month] = financeBusinessToday(d).split('-').map(Number);
  const q = Math.floor((month - 1) / 3);
  return { key: `${year}-q${q}`, label: `Quý ${q + 1}/${year}` };
}

export function computeQuarterlySummary(events: SeriesEvent[]): QuarterlySummary {
  const byQuarter = new Map<string, { label: string; list: SeriesEvent[] }>();
  let undatedCount = 0;
  for (const e of events) {
    const qk = quarterOf(e.event_date);
    if (!qk) {
      undatedCount += 1;
      continue;
    }
    const cur = byQuarter.get(qk.key);
    if (cur) cur.list.push(e);
    else byQuarter.set(qk.key, { label: qk.label, list: [e] });
  }

  const rows: QuarterlyRow[] = [...byQuarter.entries()].map(([key, { label, list }]) => {
    const withGtd = list.filter((e) => e.gtd !== null);
    return {
      key,
      label,
      eventCount: list.length,
      entries: total(list.map((e) => e.total_entries)),
      feeRevenue: productTotal(list, (e) => e.fee, (e) => e.total_entries),
      overlayCost: total(
        withGtd.map((e) =>
          e.buy_in !== null && e.total_entries !== null
            ? Math.max(0, (e.gtd as number) - e.buy_in * e.total_entries)
            : null,
        ),
      ),
      gtdMissingCount: list.length - withGtd.length,
    };
  });
  rows.sort((a, b) => (a.key < b.key ? 1 : -1)); // newest first

  return { available: rows.length > 0, label: "Observed Pattern", rows, undatedCount };
}

// ----------------------------------------------------------------------------
// F&B club-level window ("F&B toàn CLB trong kỳ series")
// ----------------------------------------------------------------------------
//
// F&B revenue CANNOT be attributed per-tournament: an `fnb_orders` row carries only club_id +
// paid_at, never a tournament_id (F&B is sold at a shared counter). So the only honest way to bring
// F&B into Series Intelligence is a CLUB-LEVEL total over the series' calendar window, shown as a
// SEPARATE line — never folded into the per-event contribution margin. This helper derives that
// window (club + from/to instants) from the loaded native events; the actual F&B numbers come from
// the live read-only `fnb_get_report(from,to,club)` RPC in the component.

export interface SeriesDateWindow {
  clubId: string;
  /** Start-of-day (UTC+7) of the earliest event, as an ISO instant for the timestamptz RPC. */
  fromIso: string;
  /** End-of-day (UTC+7) of the latest event, as an ISO instant. */
  toIso: string;
  fromLabel: string; // dd/mm/yyyy of the earliest event (UTC+7)
  toLabel: string; // dd/mm/yyyy of the latest event (UTC+7)
}

const dmyLabel = (d: Date): string => financeBusinessToday(d).split('-').reverse().join('/');
const dayStartIso = (d: Date): string => `${financeBusinessToday(d)}T00:00:00+07:00`;
// fnb_get_report uses inclusive BETWEEN at PostgreSQL microsecond precision.
const dayEndIso = (d: Date): string => `${financeBusinessToday(d)}T23:59:59.999999+07:00`;
/**
 * Compute the club + calendar window spanned by the loaded native events, for the club-level F&B read.
 * Returns null when no event has a usable club id + parseable date (never guesses a window). Uses the
 * FIRST event's club id (native mode is single-club). Window = [start of earliest day, end of latest day].
 */
export function seriesDateWindow(events: SeriesEvent[]): SeriesDateWindow | null {
  const clubId = events.find((e) => e.clubId)?.clubId ?? null;
  if (!clubId) return null;
  const dated = events
    .map((e) => (e.event_date ? new Date(e.event_date) : null))
    .filter((d): d is Date => d !== null && !Number.isNaN(d.getTime()));
  if (dated.length === 0) return null;
  let min = dated[0];
  let max = dated[0];
  for (const d of dated) {
    if (d.getTime() < min.getTime()) min = d;
    if (d.getTime() > max.getTime()) max = d;
  }
  return {
    clubId,
    fromIso: dayStartIso(min),
    toIso: dayEndIso(max),
    fromLabel: dmyLabel(min),
    toLabel: dmyLabel(max),
  };
}

// ----------------------------------------------------------------------------
// Data readiness
// ----------------------------------------------------------------------------

/** Core fields an owner can fill today (GTD is excluded from the score — it has no column yet). */
const CORE_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "event_name", label: "Tên giải" },
  { key: "event_date", label: "Ngày" },
  { key: "buy_in", label: "Buy-in" },
  { key: "fee", label: "Fee (rake)" },
  { key: "prize_pool_actual", label: "Prize pool thực tế" },
  { key: "total_entries", label: "Tổng lượt entry" },
  { key: "unique_entries", label: "Người chơi (unique)" },
  { key: "reentries", label: "Re-entry" },
];

export interface ReadinessField {
  key: string;
  label: string;
  missingCount: number;
  totalCount: number;
}

export interface ReadinessResult {
  /** 0–100 coverage over CORE_FIELDS (fields an owner can actually fill today). */
  score: number;
  label: InsightLabel; // 'Observed Pattern' — a measured fact about the data
  fields: ReadinessField[];
  /** Plain-VN "what is still missing before stronger analysis". */
  missingSummary: string[];
  /** Some events have no committed GTD (tournaments.guarantee_amount) — reported separately from the coverage score. */
  gtdStructuralGap: boolean;
}

export function computeReadiness(events: SeriesEvent[]): ReadinessResult {
  const n = events.length;
  const fields: ReadinessField[] = CORE_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    missingCount: events.filter((e) => e.missingFields.includes(f.key)).length,
    totalCount: n,
  }));

  const totalCells = n * CORE_FIELDS.length;
  const missingCells = fields.reduce((a, f) => a + f.missingCount, 0);
  const score = totalCells === 0 ? 0 : Math.round(((totalCells - missingCells) / totalCells) * 100);

  const missingSummary: string[] = [];
  for (const f of fields) {
    if (f.missingCount > 0) {
      missingSummary.push(`${f.missingCount}/${n} giải thiếu ${f.label}`);
    }
  }
  const gtdMissingCount = events.filter((e) => e.gtd === null).length;
  const gtdStructuralGap = gtdMissingCount > 0;
  if (gtdStructuralGap) {
    missingSummary.push(`${gtdMissingCount}/${n} giải chưa đặt GTD — không suy ra từ prize pool`);
  }

  return { score, label: "Observed Pattern", fields, missingSummary, gtdStructuralGap };
}

// ----------------------------------------------------------------------------
// Risk flags
// ----------------------------------------------------------------------------

export interface RiskFlag {
  id: string;
  label: InsightLabel;
  severity: RiskSeverity;
  title: string;
  message: string;
  provenance: string; // why this is shown / the rule or observation behind it
  basis: string; // sample basis, e.g. "dựa trên 6 giải"
}

/** Tunables — named so the thresholds are auditable, not magic numbers. */
const REENTRY_DEPENDENCE_RATIO = 0.35; // Σreentries / Σentries at/above this = "re-entry dependence"
const LOW_FIELD_ENTRIES = 30; // a tournament with fewer confirmed entries is "low field"
const HIGH_BUYIN_PERCENTILE = 0.75; // buy-in at/above this percentile is "high buy-in"
const CONCENTRATION_TOP_SHARE = 0.6; // top-N events holding ≥ this share of entries = "concentration"

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * (sortedAsc.length - 1)));
  return sortedAsc[idx];
}

export function computeRiskFlags(events: SeriesEvent[]): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const n = events.length;
  if (n === 0) return flags;

  // GTD missing — always (no native column yet). Observed Pattern.
  if (events.some((e) => e.gtd === null)) {
    flags.push({
      id: "gtd-missing",
      label: "Observed Pattern",
      severity: "warning",
      title: "Chưa có dữ liệu GTD",
      message: "Không thể đánh giá rủi ro overlay/ngân sách chính xác khi chưa có GTD.",
      provenance: "GTD chưa có cột trong dữ liệu VinPoker (Phase 3).",
      basis: `dựa trên ${n} giải`,
    });
  }

  // Re-entry dependence — observed ratio over events that have both counts.
  const reentrySum = events.reduce((a, e) => a + (e.reentries ?? 0), 0);
  const entrySum = events.reduce((a, e) => a + (e.total_entries ?? 0), 0);
  if (entrySum > 0) {
    const ratio = reentrySum / entrySum;
    if (ratio >= REENTRY_DEPENDENCE_RATIO) {
      flags.push({
        id: "reentry-dependence",
        label: "Observed Pattern",
        severity: "info",
        title: "Phụ thuộc re-entry cao",
        message: `Re-entry chiếm ${Math.round(ratio * 100)}% tổng lượt entry của chuỗi.`,
        provenance: "Tỷ lệ Σre-entry / Σentry quan sát từ dữ liệu.",
        basis: `dựa trên ${events.filter((e) => e.total_entries !== null).length} giải có số entry`,
      });
    }
  }

  // Low-field + high buy-in — a Hypothesis (worth a look, not a conclusion).
  const buyIns = events
    .map((e) => e.buy_in)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const highBuyInCut = percentile(buyIns, HIGH_BUYIN_PERCENTILE);
  if (highBuyInCut !== null) {
    const lowFieldHighBuyIn = events.filter(
      (e) => e.buy_in !== null && e.buy_in >= highBuyInCut && e.total_entries !== null && e.total_entries < LOW_FIELD_ENTRIES,
    );
    if (lowFieldHighBuyIn.length > 0) {
      flags.push({
        id: "low-field-high-buyin",
        label: "Hypothesis",
        severity: "warning",
        title: "Buy-in cao nhưng field thấp",
        message: `${lowFieldHighBuyIn.length} giải buy-in cao có dưới ${LOW_FIELD_ENTRIES} lượt entry — có thể cần satellite/marketing.`,
        provenance: "Buy-in ≥ phân vị 75 và entry < ngưỡng field thấp (giả thuyết, cần kiểm chứng).",
        basis: `dựa trên ${lowFieldHighBuyIn.length}/${n} giải`,
      });
    }
  }

  // Entry concentration — a few events holding most of the entries.
  const eventEntries = events
    .map((e) => e.total_entries)
    .filter((v): v is number => v !== null)
    .sort((a, b) => b - a);
  if (eventEntries.length >= 3 && entrySum > 0) {
    const topN = Math.max(1, Math.ceil(eventEntries.length * 0.25));
    const topShare = eventEntries.slice(0, topN).reduce((a, b) => a + b, 0) / entrySum;
    if (topShare >= CONCENTRATION_TOP_SHARE) {
      flags.push({
        id: "entry-concentration",
        label: "Observed Pattern",
        severity: "info",
        title: "Lượt entry tập trung ở ít giải",
        message: `Top ${topN} giải chiếm ${Math.round(topShare * 100)}% tổng lượt entry.`,
        provenance: "Phân bố entry quan sát từ dữ liệu.",
        basis: `dựa trên ${eventEntries.length} giải có số entry`,
      });
    }
  }

  return flags;
}

// ----------------------------------------------------------------------------
// Owner action checklist
// ----------------------------------------------------------------------------

export interface OwnerAction {
  id: string;
  label: InsightLabel;
  text: string;
  rationale: string;
}

/** Derive 3–7 concrete, non-guaranteeing actions from the events + risk flags. */
export function computeOwnerActionChecklist(events: SeriesEvent[], risks: RiskFlag[]): OwnerAction[] {
  const actions: OwnerAction[] = [];
  const byId = new Set(risks.map((r) => r.id));

  if (byId.has("gtd-missing")) {
    actions.push({
      id: "verify-gtd",
      label: "Known Rule",
      text: "Xác minh GTD trước khi công bố lịch giải",
      rationale: "GTD chưa có dữ liệu — cần chốt để đánh giá overlay/ngân sách.",
    });
  }
  if (byId.has("low-field-high-buyin")) {
    actions.push({
      id: "add-satellite",
      label: "Known Rule",
      text: "Thêm satellite trước các event buy-in cao",
      rationale: "Giải buy-in cao thường cần feeder để đủ field.",
    });
    actions.push({
      id: "marketing-low-field",
      label: "Hypothesis",
      text: "Đẩy marketing cho các event ít field",
      rationale: "Field thấp có thể cải thiện nếu tăng truyền thông trước D-2 (cần kiểm chứng).",
    });
  }
  if (byId.has("reentry-dependence")) {
    actions.push({
      id: "review-reentry",
      label: "Hypothesis",
      text: "Rà soát cấu trúc re-entry / late reg",
      rationale: "Chuỗi đang phụ thuộc nhiều vào re-entry — xem lại cấu trúc để ổn định doanh thu.",
    });
  }

  // General known-rule actions to keep the checklist useful (cap 7, floor 3).
  const general: OwnerAction[] = [
    {
      id: "capacity",
      label: "Known Rule",
      text: "Chuẩn bị đủ bàn & dealer cho khung giờ cao điểm",
      rationale: "Đủ capacity giúp tránh nghẽn seating khi field tăng.",
    },
    {
      id: "fill-data",
      label: "Known Rule",
      text: "Bổ sung các trường dữ liệu còn thiếu để phân tích mạnh hơn",
      rationale: "Dữ liệu đầy đủ hơn cho phép kịch bản/đối chiếu chính xác hơn.",
    },
    {
      id: "review-after",
      label: "Known Rule",
      text: "Rà soát sau series: đối chiếu entry, prize pool, fee",
      rationale: "So sánh thực tế với kế hoạch để cải thiện series sau.",
    },
  ];
  for (const g of general) {
    if (actions.length >= 7) break;
    actions.push(g);
  }

  return actions.slice(0, 7);
}
