import type { SeriesClubLivePulseV1 } from "@/lib/series-intelligence/seriesClubLivePulseV1";
import { buildOpsIntelligenceReadModelV1, type OpsLiveOperationInputV1, type OpsSourceAvailabilityV1 } from "./opsIntelligenceReadModel";
import { festivalGaps, resolveIntelligenceScope, scopeForTournament, tournamentGaps, type OpsIntelligenceContextV1, type OpsIntelligenceScopeV1 } from "./opsIntelligenceContextV1";
import type { OpsRegistrationPaceQ0, OpsSepayReadStateQ0 } from "./opsQuantDataHealthQ0";

export type IntelligenceTabV1 = "overview" | "quant" | "live" | "health";
export function sourceTarget(sourceId: string): { tab: IntelligenceTabV1; label: string; retryContext?: boolean } | null {
  switch (sourceId) {
    case "registration": case "sepay": return { tab: "health", label: "Mở Data Health" };
    case "operations": return { tab: "live", label: "Mở Live Ops" };
    case "context": return { tab: "overview", label: "Đọc lại phạm vi", retryContext: true };
    default: return null;
  }
}
export interface OverviewSourceV1 {
  id: string; label: string; definition: string; availability: OpsSourceAvailabilityV1;
  asOf: string | null; observedAt: string | null; reason: string | null;
}
export interface OverviewMetricV1 extends OverviewSourceV1 { value: number | null; grain: string }
export interface OverviewActionV1 {
  id: string; title: string; severity: "info" | "warning" | "critical";
  reason: string; source: string; scope: OpsIntelligenceScopeV1; tab: IntelligenceTabV1; retryContext?: boolean;
}
type Accepted<T> = { value: T; observedAt: string } | null;
export interface OverviewInputV1 {
  clubId: string; scope: OpsIntelligenceScopeV1; context: Accepted<OpsIntelligenceContextV1>;
  contextReason: string | null; pulse: Accepted<SeriesClubLivePulseV1>; operations: OpsLiveOperationInputV1;
  registration: Accepted<OpsRegistrationPaceQ0>; sepay: Accepted<OpsSepayReadStateQ0>;
}

export function buildOpsIntelligenceOverviewV1(input: OverviewInputV1) {
  const context = input.context?.value ?? null;
  const resolved = resolveIntelligenceScope(context, input.scope);
  const core = buildOpsIntelligenceReadModelV1({ clubId: input.clubId, pulse: input.pulse, pulseError: null, operations: input.operations, supplemental: [], verifiedTrackerAlertCount: null });
  const registrationEvent = resolved.tournamentId ? input.registration?.value.events.find((row) => row.eventId === resolved.tournamentId) : null;
  const registrationAvailability = !input.registration ? "unavailable" : input.registration.value.events.some((row) => row.timelineAvailability === "partial") ? "partial" : "exact";
  const source = (id: string, label: string, definition: string, accepted: Accepted<{ asOf: string }>, availability: OpsSourceAvailabilityV1, reason: string | null): OverviewSourceV1 => ({ id, label, definition, availability, asOf: accepted?.value.asOf ?? null, observedAt: accepted?.observedAt ?? null, reason });
  const sources: OverviewSourceV1[] = [
    source("registration", "Đăng ký", "Lượt confirmed trong cửa sổ Q0; người duy nhất không cộng giữa các flight.", input.registration, registrationAvailability, !input.registration ? "REGISTRATION_READ_UNAVAILABLE" : registrationAvailability === "partial" ? "REGISTRATION_TIMELINE_PARTIAL" : null),
    { id: "operations", label: "Bàn & Dealer", definition: "Phân bổ bàn theo tournamentId; không phải inventory rảnh hoặc roster cả ca.", availability: input.operations.availability, asOf: input.operations.asOf, observedAt: input.operations.availability === "unavailable" ? null : input.operations.observedAt, reason: input.operations.reasonCode },
    source("sepay", "SePay", "Số giao dịch cần xử lý toàn CLB; không phải doanh thu hoặc prize pool.", input.sepay, input.sepay ? "exact" : "unavailable", input.sepay ? null : "SEPAY_READ_UNAVAILABLE"),
    source("history", "Series / lịch sử", "Tổng quan không tải history hoặc suy rằng outcome đã final.", null, "unavailable", "HISTORY_NOT_MOUNTED"),
    source("context", "Phạm vi lịch", "Daily: event_id null. Festival: tournament_events.id; con: tournaments.event_id.", input.context, context ? "exact" : "unavailable", context ? null : input.contextReason ?? "CONTEXT_READ_UNAVAILABLE"),
  ];
  const pulseMetrics = ["players_playing_now", "entries_today", "open_tables", "dealers_on_duty", "unique_players_today"].map((id): OverviewMetricV1 => {
    const metric = core.metrics.find((row) => row.metricId === id);
    const exact = metric?.availability === "exact";
    return { id, label: metric?.label ?? ({ players_playing_now: "Người đang chơi", entries_today: "Lượt vào hôm nay", open_tables: "Bàn đang mở", dealers_on_duty: "Dealer đang trực", unique_players_today: "Người chơi duy nhất hôm nay" }[id] ?? id), definition: id === "unique_players_today" ? "Người có lượt đăng ký confirmed ở các giải bắt đầu hôm nay theo múi giờ CLB; loại trùng toàn CLB, không cộng số người giữa các flight." : "Quan sát Club Pulse toàn CLB, không phải tổng riêng của festival đang chọn.", value: exact ? metric.value : null, grain: "TOÀN CLB", availability: metric?.availability ?? "unavailable", asOf: metric?.asOf ?? null, observedAt: input.pulse?.observedAt ?? null, reason: exact ? null : "CLUB_PULSE_METRIC_UNAVAILABLE" };
  });
  const scopedMetrics = [...pulseMetrics];
  if (input.scope.kind !== "club") {
    const rows = input.operations.rows.filter((row) => row.tournamentId === resolved.tournamentId);
    const allocationExact = !!resolved.tournamentId && input.operations.availability === "exact" && rows.every((row) => row.sourceAvailability === "exact");
    scopedMetrics[1] = { ...sources[0], id: "selected-entries", label: "Lượt vào phạm vi chọn", grain: input.scope.kind.toUpperCase(), value: registrationEvent?.confirmedEntries ?? null, availability: registrationEvent ? "exact" : "unavailable", reason: registrationEvent ? null : "NO_EXACT_SCOPE_AGGREGATE" };
    scopedMetrics[2] = { ...sources[1], id: "selected-tables", label: "Bàn được cấp cho giải", grain: input.scope.kind.toUpperCase(), value: allocationExact ? rows.length : null, availability: allocationExact ? "exact" : "unavailable", reason: allocationExact ? null : "SCOPE_ALLOCATION_UNAVAILABLE" };
    scopedMetrics[3] = { ...sources[1], id: "selected-dealers", label: "Dealer đứng bàn của giải", grain: input.scope.kind.toUpperCase(), value: allocationExact ? rows.filter((row) => row.dealerName !== null && (row.dealerAssignmentState === "assigned" || row.dealerAssignmentState === "overdue")).length : null, availability: allocationExact ? "exact" : "unavailable", reason: allocationExact ? null : "SCOPE_ALLOCATION_UNAVAILABLE" };
  }
  scopedMetrics.push({ ...sources[2], id: "sepay-actionable", label: "SePay cần xử lý", value: input.sepay?.value.buckets.find((row) => row.state === "actionable")?.transactionCount ?? null, grain: "TOÀN CLB" });
  const actions: OverviewActionV1[] = sources.flatMap((row): OverviewActionV1[] => {
    const target = sourceTarget(row.id);
    return row.availability !== "exact" && target ? [{ id: row.id, title: `${row.label}: ${row.availability === "unavailable" ? "chưa đọc được" : "cần kiểm tra"}`, severity: "warning", reason: row.reason ?? "SOURCE_PARTIAL", source: row.id, scope: input.scope, tab: target.tab, retryContext: target.retryContext }] : [];
  });
  if (!resolved.valid) actions.push({ id: "scope", title: "Phạm vi đã chọn chưa xác minh được", severity: "warning", reason: "SELECTED_SCOPE_UNAVAILABLE", source: "context", scope: input.scope, tab: "overview" });
  const actionable = scopedMetrics.find((metric) => metric.id === "sepay-actionable")?.value;
  if ((actionable ?? 0) > 0) actions.push({ id: "sepay-actionable", title: `${actionable} giao dịch cần xử lý`, severity: "warning", reason: "SEPAY_ACTIONABLE", source: "sepay", scope: { kind: "club" }, tab: "health" });
  for (const alert of core.alerts.filter((row) => row.kind === "dealer_assignment_missing" || row.kind === "dealer_rotation_overdue")) {
    const tableId = alert.alertId.split(":")[1];
    const row = input.operations.rows.find((item) => item.tableId === tableId);
    if (input.scope.kind !== "club" && row?.tournamentId !== resolved.tournamentId) continue;
    actions.push({ id: alert.alertId, title: alert.title, severity: alert.severity, reason: alert.detail, source: "operations", scope: context && row?.tournamentId ? scopeForTournament(context, row.tournamentId) ?? input.scope : input.scope, tab: "live" });
  }
  const festivals = resolved.festival ? [resolved.festival] : input.scope.kind === "club" ? context?.festivals ?? [] : [];
  for (const festival of festivals) {
    for (const reason of festivalGaps(festival)) actions.push({ id: `${festival.festivalId}:${reason}`, title: `${festival.name}: ${gapLabel(reason)}`, severity: "warning", reason, source: "context", scope: { kind: "festival", festivalId: festival.festivalId }, tab: "overview" });
    for (const child of festival.tournaments) for (const reason of tournamentGaps(child, true)) actions.push({ id: `${child.tournamentId}:${reason}`, title: `${child.name}: ${gapLabel(reason)}`, severity: "info", reason, source: "context", scope: { kind: "festival", festivalId: festival.festivalId }, tab: "overview" });
  }
  const daily = resolved.tournament && input.scope.kind === "daily" ? [resolved.tournament] : input.scope.kind === "club" ? context?.dailyTournaments ?? [] : [];
  for (const row of daily) for (const reason of tournamentGaps(row, false)) actions.push({ id: `${row.tournamentId}:${reason}`, title: `${row.name}: ${gapLabel(reason)}`, severity: "info", reason, source: "context", scope: { kind: "daily", tournamentId: row.tournamentId }, tab: "overview" });
  return { headlineStatus: core.headlineStatus, metrics: scopedMetrics, sources, actions, resolved, daily, festivals, noWindowEvents: !!input.registration && input.registration.value.events.length === 0 };
}

export function gapLabel(reason: string): string {
  const labels: Record<string, string> = { NO_LINKED_TOURNAMENTS: "chưa có giải con", FINAL_TOURNAMENT_MISSING: "chưa có liên kết Final", FINAL_POINTER_NOT_IN_LINKED_SET: "Final không thuộc tập giải liên kết", FLIGHT_LABEL_MISSING: "thiếu nhãn flight", PHASE_UNSPECIFIED: "vai trò chưa xác định", START_TIME_MISSING: "chưa có giờ bắt đầu", BUY_IN_MISSING: "thiếu buy-in", GTD_MISSING: "chưa có GTD" };
  return labels[reason] ?? reason;
}
