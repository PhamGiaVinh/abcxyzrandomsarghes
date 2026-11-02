import type { SeriesClubLivePulseV1, SeriesClubPulseAvailability } from "@/lib/series-intelligence/seriesClubLivePulseV1";

export type OpsSourceAvailabilityV1 = "exact" | "partial" | "stale" | "unavailable";
export type OpsHeadlineStatusV1 = "UNAVAILABLE" | "PARTIAL" | "STALE" | "LIVE";

export interface OpsMetricV1 {
  readonly metricId: string;
  readonly label: string;
  readonly value: number | null;
  readonly unit: "count" | "vnd";
  readonly sourceId: string;
  readonly grain: string;
  readonly availability: OpsSourceAvailabilityV1;
  readonly asOf: string | null;
  readonly observedAt: string;
}

export interface OpsSourceStateV1 {
  readonly sourceId: string;
  readonly label: string;
  readonly availability: OpsSourceAvailabilityV1;
  readonly asOf: string | null;
  readonly observedAt: string;
  readonly reasonCode: string | null;
  readonly requiredForHeadline: boolean;
}

export interface OpsOperationRowV1 {
  readonly tableId: string;
  readonly tableName: string;
  readonly tableStatus: string;
  readonly tournamentId: string | null;
  readonly tournamentName: string | null;
  readonly currentLevel: number | null;
  readonly averageStack: number | null;
  readonly dealerName: string | null;
  readonly dealerAssignmentState: "assigned" | "missing" | "overdue";
  readonly sourceAvailability: OpsSourceAvailabilityV1;
}

export interface OpsDerivedAlertV1 {
  readonly alertId: string;
  readonly severity: "info" | "warning" | "critical";
  readonly kind: "dealer_assignment_missing" | "dealer_rotation_overdue" | "source_state" | "source_count_mismatch" | "tracker_alert";
  readonly title: string;
  readonly detail: string;
  readonly sourceIds: readonly string[];
}

export interface OpsLiveOperationInputV1 {
  readonly observedAt: string;
  readonly asOf: string | null;
  readonly availability: OpsSourceAvailabilityV1;
  readonly reasonCode: string | null;
  readonly rows: readonly OpsOperationRowV1[];
  readonly runningTournamentIds: readonly string[];
  readonly openTableCount: number | null;
  readonly configuredTableCount: number | null;
  readonly operationalTableCount: number | null;
  readonly dealersOnDutyCount: number | null;
  /** Count comparisons are legal only after source contracts prove matching grain. */
  readonly countComparisonEligible: boolean;
}

export interface OpsIntelligenceReadModelV1 {
  readonly version: "ops-intelligence-command-center-v1";
  readonly clubId: string;
  readonly headlineStatus: OpsHeadlineStatusV1;
  readonly metrics: readonly OpsMetricV1[];
  readonly sources: readonly OpsSourceStateV1[];
  readonly operations: readonly OpsOperationRowV1[];
  readonly alerts: readonly OpsDerivedAlertV1[];
}

export type OpsSupplementalSourceInputV1 = {
  readonly sourceId: string;
  readonly label: string;
  readonly availability: OpsSourceAvailabilityV1;
  readonly asOf: string | null;
  readonly observedAt: string;
  readonly reasonCode: string | null;
};

export function toOpsAvailability(value: SeriesClubPulseAvailability): OpsSourceAvailabilityV1 {
  return value;
}

export function buildOpsIntelligenceReadModelV1(input: {
  readonly clubId: string;
  readonly pulse: { readonly value: SeriesClubLivePulseV1; readonly observedAt: string } | null;
  readonly pulseError: string | null;
  readonly operations: OpsLiveOperationInputV1;
  readonly supplemental: readonly OpsSupplementalSourceInputV1[];
  readonly verifiedTrackerAlertCount: number | null;
}): OpsIntelligenceReadModelV1 {
  const pulseSource = buildPulseSource(input.pulse, input.pulseError, input.operations.observedAt);
  const operationsSource: OpsSourceStateV1 = Object.freeze({
    sourceId: "ops-live-operations",
    label: "Bàn & Dealer đang chạy",
    availability: input.operations.availability,
    asOf: input.operations.asOf,
    observedAt: input.operations.observedAt,
    reasonCode: input.operations.reasonCode,
    requiredForHeadline: true,
  });
  const sources = Object.freeze([pulseSource, operationsSource, ...input.supplemental.map((source) => Object.freeze({
    ...source,
    requiredForHeadline: false,
  }))]);
  const metrics = input.pulse ? buildPulseMetrics(input.pulse.value, input.pulse.observedAt) : Object.freeze([]);
  const alerts = buildAlerts(
    pulseSource,
    input.operations,
    input.pulse,
    input.supplemental,
    input.verifiedTrackerAlertCount,
  );
  return Object.freeze({
    version: "ops-intelligence-command-center-v1",
    clubId: input.clubId,
    headlineStatus: deriveHeadlineStatus(pulseSource.availability, input.operations.availability, metrics),
    metrics,
    sources,
    operations: Object.freeze([...input.operations.rows]),
    alerts: Object.freeze(alerts),
  });
}

export function deriveHeadlineStatus(
  pulseAvailability: OpsSourceAvailabilityV1,
  operationsAvailability: OpsSourceAvailabilityV1,
  metrics: readonly OpsMetricV1[],
): OpsHeadlineStatusV1 {
  const core = [pulseAvailability, operationsAvailability];
  const usable = core.filter((state) => state !== "unavailable");
  if (!usable.length) return "UNAVAILABLE";
  const pulseRequired = ["entries_today", "players_playing_now", "running_events", "open_tables", "dealers_on_duty"];
  const pulseMissingRequired = metrics.some((metric) => pulseRequired.includes(metric.metricId) && metric.availability !== "exact");
  if (core.some((state) => state === "unavailable" || state === "partial") || pulseMissingRequired) return "PARTIAL";
  if (core.some((state) => state === "stale")) return "STALE";
  return "LIVE";
}

function buildPulseSource(
  pulse: { readonly value: SeriesClubLivePulseV1; readonly observedAt: string } | null,
  error: string | null,
  fallbackObservedAt: string,
): OpsSourceStateV1 {
  if (!pulse) return Object.freeze({
    sourceId: "series-club-live-pulse",
    label: "Club Pulse",
    availability: "unavailable",
    asOf: null,
    observedAt: fallbackObservedAt,
    reasonCode: error ?? "CLUB_PULSE_UNAVAILABLE",
    requiredForHeadline: true,
  });
  const quality = pulse.value.dataQuality;
  const availability: OpsSourceAvailabilityV1 = quality.unavailableMetricIds.length
    ? "partial"
    : quality.partialMetricIds.length
      ? "partial"
      : quality.staleMetricIds.length
        ? "stale"
        : "exact";
  return Object.freeze({
    sourceId: "series-club-live-pulse",
    label: "Club Pulse",
    availability,
    asOf: pulse.value.asOf,
    observedAt: pulse.observedAt,
    reasonCode: availability === "exact" ? null : "CLUB_PULSE_METRIC_AVAILABILITY",
    requiredForHeadline: true,
  });
}

function buildPulseMetrics(pulse: SeriesClubLivePulseV1, observedAt: string): readonly OpsMetricV1[] {
  const keys = ["entriesToday", "playersPlayingNow", "runningEvents", "openTables", "dealersOnDuty", "uniquePlayersToday"] as const;
  return Object.freeze(keys.map((key) => {
    const metric = pulse[key];
    return Object.freeze({
      metricId: metric.metricId,
      label: {
        entriesToday: "Lượt vào giải hôm nay",
        uniquePlayersToday: "Người chơi duy nhất hôm nay",
        playersPlayingNow: "Người đang chơi",
        runningEvents: "Giải đang chạy",
        openTables: "Bàn đang mở",
        dealersOnDuty: "Dealer đang trực",
      }[key],
      value: metric.value,
      unit: "count" as const,
      sourceId: metric.sourceId,
      grain: metric.grain,
      availability: toOpsAvailability(metric.availability),
      asOf: metric.asOf,
      observedAt,
    });
  }));
}

function buildAlerts(
  pulse: OpsSourceStateV1,
  operations: OpsLiveOperationInputV1,
  acceptedPulse: { readonly value: SeriesClubLivePulseV1; readonly observedAt: string } | null,
  supplemental: readonly OpsSupplementalSourceInputV1[],
  verifiedTrackerAlertCount: number | null,
): OpsDerivedAlertV1[] {
  const alerts: OpsDerivedAlertV1[] = [];
  for (const source of [pulse, {
    sourceId: "ops-live-operations",
    label: "Bàn & Dealer đang chạy",
    availability: operations.availability,
    reasonCode: operations.reasonCode,
  }]) {
    if (source.availability !== "exact") {
      alerts.push(Object.freeze({
        alertId: `source:${source.sourceId}:${source.availability}`,
        severity: source.availability === "unavailable" ? "critical" : "warning",
        kind: "source_state",
        title: `${source.label} ${source.availability === "unavailable" ? "chưa dùng được" : "chưa đầy đủ"}`,
        detail: source.reasonCode ?? "SOURCE_AVAILABILITY_REQUIRES_REVIEW",
        sourceIds: Object.freeze([source.sourceId]),
      }));
    }
  }
  if (operations.availability !== "unavailable") {
    for (const row of operations.rows) {
      if (row.sourceAvailability !== "exact") continue;
      if (row.dealerAssignmentState === "missing") alerts.push(Object.freeze({
        alertId: `missing-dealer:${row.tableId}`,
        severity: "warning",
        kind: "dealer_assignment_missing",
        title: `Thiếu dealer tại ${row.tableName}`,
        detail: "Bảng vận hành không có assignment đang hiệu lực cho bàn này.",
        sourceIds: Object.freeze(["ops-live-operations"]),
      }));
      if (row.dealerAssignmentState === "overdue") alerts.push(Object.freeze({
        alertId: `overdue-dealer:${row.tableId}`,
        severity: "critical",
        kind: "dealer_rotation_overdue",
        title: `Đến hạn xoay dealer tại ${row.tableName}`,
        detail: "Theo đúng trạng thái và mốc thời gian canonical của Dealer Swing.",
        sourceIds: Object.freeze(["ops-live-operations"]),
      }));
    }
  }
  if (operations.countComparisonEligible && acceptedPulse && operations.availability !== "unavailable"
    && acceptedPulse.value.openTables.availability === "exact"
    && acceptedPulse.value.dealersOnDuty.availability === "exact"
    && acceptedPulse.value.openTables.value !== null
    && acceptedPulse.value.dealersOnDuty.value !== null
    && operations.openTableCount !== null
    && operations.dealersOnDutyCount !== null
    && (acceptedPulse.value.openTables.value !== operations.openTableCount
      || acceptedPulse.value.dealersOnDuty.value !== operations.dealersOnDutyCount)) {
    alerts.push(Object.freeze({
      alertId: "source-count-mismatch:pulse:operations",
      severity: "info",
      kind: "source_count_mismatch",
      title: "Nguồn tổng hợp và bảng chi tiết đang lệch số lượng",
      detail: "Giữ nguyên số của từng nguồn để kiểm tra definition và grain; hệ thống không tự điều chỉnh.",
      sourceIds: Object.freeze(["series-club-live-pulse", "ops-live-operations"]),
    }));
  }
  for (const source of supplemental) {
    if (source.sourceId === "tracker-alerts" && source.availability === "exact") {
      if ((verifiedTrackerAlertCount ?? 0) > 0) alerts.push(Object.freeze({
        alertId: "tracker-alerts:verified",
        severity: "warning",
        kind: "tracker_alert",
        title: `${verifiedTrackerAlertCount} cảnh báo Tracker đã xác minh`,
        detail: "Chỉ đọc từ nguồn Tracker đã rollout; màn này không chuyển trạng thái cảnh báo.",
        sourceIds: Object.freeze(["tracker-alerts"]),
      }));
      continue;
    }
    if (source.availability !== "exact") alerts.push(Object.freeze({
      alertId: `source:${source.sourceId}:${source.availability}`,
      severity: "info",
      kind: "source_state",
      title: `${source.label}: ${source.availability === "unavailable" ? "chưa khả dụng" : "cần xem lại"}`,
      detail: source.reasonCode ?? "SOURCE_AVAILABILITY_REQUIRES_REVIEW",
      sourceIds: Object.freeze([source.sourceId]),
    }));
  }
  return alerts;
}
