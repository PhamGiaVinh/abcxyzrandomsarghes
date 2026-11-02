import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BadgeInfo, CircleDot, DatabaseZap, RefreshCw, ShieldCheck, Table2, UsersRound } from "lucide-react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { Button } from "@/components/ui/button";
import { currentMonthFinanceRange, loadFinanceSummary } from "@/ops/finance/financeReadAdapter";
import { createOwnerDailyDigestSupabaseSource } from "@/ops/digest/ownerDailyDigestSupabaseSource";
import { loadOwnerDailyDigestReport } from "@/ops/digest/ownerDailyDigestReadAdapter";
import { FEATURES } from "@/lib/featureFlags";
import { listTrackerFloorAlerts } from "@/lib/tracker-floor-alerts/trackerFloorAlertsRead";
import {
  buildOpsIntelligenceReadModelV1,
  type OpsHeadlineStatusV1,
  type OpsSourceAvailabilityV1,
  type OpsSupplementalSourceInputV1,
} from "./opsIntelligenceReadModel";
import { shouldReadTrackerAlerts } from "./opsIntelligenceGate";
import { OpsQuantDataHealthQ0Panel } from "./OpsQuantDataHealthQ0Panel";
import { isOpsQuantDataHealthQ0Enabled } from "./opsQuantDataHealthGate";
import { operationsQueryOptions, pulseQueryOptions, type OpsReadEnvelope } from "./opsIntelligenceQueryOptions";

const PENDING_OBSERVED_AT = "1970-01-01T00:00:00.000Z";
type FinanceRead = OpsReadEnvelope<Awaited<ReturnType<typeof loadFinanceSummary>>> & {
  queryRange: ReturnType<typeof currentMonthFinanceRange>;
};

export function OpsIntelligenceCommandCenterV1({
  clubId,
  clubName,
  embedded = false,
  showDataHealth = true,
}: {
  clubId: string;
  clubName: string | null;
  embedded?: boolean;
  showDataHealth?: boolean;
}) {
  const client = useSupabaseClient();
  const q0Enabled = isOpsQuantDataHealthQ0Enabled();
  const [range,setRange] = useState(currentMonthFinanceRange);
  const pulse = useQuery(pulseQueryOptions(client, clubId));
  const operations = useQuery(operationsQueryOptions(client, clubId, q0Enabled));
  const finance = useQuery({
    queryKey: ["ops", clubId, "intelligence", "finance", range.from, range.to],
    refetchInterval: 5_000,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    queryFn: async (): Promise<FinanceRead> => {
      const queryRange = currentMonthFinanceRange();
      try {
        return Object.freeze({ value: await loadFinanceSummary(client, clubId, queryRange), queryRange, availability: "exact", observedAt: new Date().toISOString(), reasonCode: null });
      } catch (error) {
        return Object.freeze({ value: null, queryRange, availability: "unavailable", observedAt: new Date().toISOString(), reasonCode: error instanceof Error ? error.message : "FINANCE_READ_FAILED" });
      }
    },
  });
  const digest = useQuery({
    queryKey: ["ops", clubId, "intelligence", "daily-digest"],
    queryFn: async () => {
      try {
        const value = await loadOwnerDailyDigestReport(
          createOwnerDailyDigestSupabaseSource(client),
          { clubId },
        );
        return Object.freeze({ value, availability: "exact", observedAt: new Date().toISOString(), reasonCode: value ? null : "OWNER_DIGEST_EMPTY" } satisfies OpsReadEnvelope<typeof value>);
      } catch (error) {
        return Object.freeze({ value: null, availability: "unavailable", observedAt: new Date().toISOString(), reasonCode: error instanceof Error ? error.message : "OWNER_DIGEST_READ_FAILED" });
      }
    },
  });
  const tracker = useQuery({
    queryKey: ["ops", clubId, "intelligence", "tracker-alerts", operations.data?.runningTournamentIds.join(",") ?? ""],
    enabled: shouldReadTrackerAlerts(FEATURES.trackerVoiceInput, operations.data?.runningTournamentIds ?? []),
    queryFn: async (): Promise<OpsReadEnvelope<number>> => {
      const results = await Promise.all(operations.data!.runningTournamentIds.map((tournamentId) => listTrackerFloorAlerts(client, tournamentId)));
      const failed = results.find((result) => !result.ok);
      if (failed && "error" in failed) return Object.freeze({ value: null, availability: "unavailable", observedAt: new Date().toISOString(), reasonCode: failed.error });
      return Object.freeze({
        value: results.reduce((total, result) => total + (result.ok ? result.alerts.length : 0), 0),
        availability: "exact",
        observedAt: new Date().toISOString(),
        reasonCode: null,
      });
    },
  });

  const model = useMemo(() => {
    const operationValue = operations.isError ? emptyOperations() : operations.data ?? emptyOperations();
    const pulseResult = pulse.isError ? null : pulse.data?.value;
    const pulseValue = pulseResult?.ok ? { value: pulseResult.value, observedAt: pulse.data!.observedAt } : null;
    const supplemental: OpsSupplementalSourceInputV1[] = [
      sourceFromRead("finance-summary", "Tài chính & Đối soát", finance.data, operationValue.observedAt),
      sourceFromRead("owner-daily-digest", "Daily Digest", digest.data, operationValue.observedAt),
      trackerSource(FEATURES.trackerVoiceInput, tracker.data, operationValue.observedAt, operationValue.runningTournamentIds.length),
      unavailableSource("registration-pace", "Nhịp đăng ký", operationValue.observedAt, "REGISTRATION_PACE_READ_CONTRACT_MISSING"),
      unavailableSource("sepay", "SePay", operationValue.observedAt, "SEPAY_READ_CONTRACT_MISSING"),
      unavailableSource("event-stream", "Event stream", operationValue.observedAt, "EVENT_STREAM_READ_CONTRACT_MISSING"),
    ];
    const pulseError = pulseResult && "error" in pulseResult
      ? pulseResult.error
      : pulse.error
        ? "CLUB_PULSE_READ_FAILED"
        : null;
    return buildOpsIntelligenceReadModelV1({
      clubId,
      pulse: pulseValue,
      pulseError,
      operations: operationValue,
      supplemental,
      verifiedTrackerAlertCount: tracker.data?.availability === "exact" ? tracker.data.value : null,
    });
  }, [clubId, digest.data, finance.data, operations.data, operations.isError, pulse.data, pulse.error, pulse.isError, tracker.data]);

  const refresh = () => {
    const nextRange=currentMonthFinanceRange();
    setRange(nextRange);
    const refreshes: Promise<unknown>[] = [pulse.refetch(), operations.refetch(), digest.refetch()];
    // A new query key fetches the new cutoff. Same-millisecond refresh still rereads.
    if(nextRange.from===range.from&&nextRange.to===range.to)refreshes.push(finance.refetch());
    if (shouldReadTrackerAlerts(FEATURES.trackerVoiceInput, operations.data?.runningTournamentIds ?? [])) refreshes.push(tracker.refetch());
    void Promise.allSettled(refreshes);
  };

  return (
    <main className="space-y-4" data-testid="ops-intelligence-command-center">
      {!embedded && <header className="border border-emerald-300/20 bg-[#07100c] px-5 py-4 shadow-[0_0_32px_rgba(16,185,129,0.05)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Tổng quan điều hành</p>
            <h1 className="mt-1 text-2xl font-semibold text-white">Ops Intelligence Command Center</h1>
            <p className="mt-1 text-sm text-[#91a49b]">{clubName ?? "CLB đã xác thực"} · Chỉ đọc · Mỗi nguồn giữ provenance riêng.</p>
          </div>
          <div className="flex items-center gap-3">
            <HeadlineStatus status={model.headlineStatus} />
            <Button type="button" variant="outline" size="sm" onClick={refresh} data-ops-action="intelligence.refresh">
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Làm mới
            </Button>
          </div>
        </div>
      </header>}

      <section className="grid grid-cols-2 gap-px overflow-hidden border border-white/10 bg-white/10 xl:grid-cols-5" aria-label="Chỉ số sàn hiện tại">
        {model.metrics.map((metric) => <MetricTile key={metric.metricId} label={metric.label} value={metric.value} availability={metric.availability} />)}
      </section>

      <div className="grid grid-cols-12 gap-4">
        <section className="col-span-12 border border-white/10 bg-[#07100c] xl:col-span-8" aria-labelledby="ops-intelligence-board">
          <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
            <div>
              <h2 id="ops-intelligence-board" className="text-sm font-semibold text-white">Operations Board</h2>
              <p className="mt-0.5 text-xs text-[#73867c]">Liên kết bàn, giải và assignment hiện có. Không tự suy luận số thiếu.</p>
            </div>
            <span className="font-mono text-xs tabular-nums text-[#91a49b]">{!operations.isError && operations.data?.availability==='exact'
              ? operations.data.configuredTableCount !== null && operations.data.configuredTableCount !== undefined
                ? `${operations.data.openTableCount ?? "—"} bàn đang mở · ${operations.data.configuredTableCount} bàn cấu hình`
                : `${model.operations.length} bàn`
              : model.operations.length ? `${model.operations.length} bàn đã đọc · chưa xác minh đầy đủ` : 'Chưa xác minh số bàn'}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="border-b border-white/8 text-[10px] uppercase tracking-[0.12em] text-[#73867c]">
                <tr><th className="px-4 py-3 font-medium">Bàn</th><th className="px-4 py-3 font-medium">Giải</th><th className="px-4 py-3 font-medium">Level / Stack TB</th><th className="px-4 py-3 font-medium">Dealer</th></tr>
              </thead>
              <tbody>
                {model.operations.map((row) => <tr key={row.tableId} className="border-b border-white/6 last:border-0">
                  <td className="px-4 py-3 font-medium text-white"><span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />{row.tableName}</td>
                  <td className="px-4 py-3 text-[#b9c8c0]">{row.tournamentName ?? "Chưa liên kết giải"}</td>
                  <td className="px-4 py-3 font-mono tabular-nums text-[#d8bc85]">{row.currentLevel === null ? "Không có contract" : `L${row.currentLevel}`} {row.averageStack === null ? "" : `· ${formatNumber(row.averageStack)}`}</td>
                  <td className={`px-4 py-3 ${row.dealerAssignmentState === "overdue" ? "text-rose-200" : row.dealerAssignmentState === "missing" ? "text-amber-200" : "text-[#b9c8c0]"}`}>{row.dealerName ?? (row.sourceAvailability === "exact" ? "Chưa phân công" : "Chưa xác minh")}</td>
                </tr>)}
                {!model.operations.length && <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-[#73867c]">{!operations.isError && operations.data?.availability==='exact'
                  ? 'Chưa có bàn vận hành được đọc từ nguồn hiện hữu.' : 'Không xác minh được danh sách bàn. Hãy làm mới.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="col-span-12 border border-white/10 bg-[#07100c] xl:col-span-4" aria-labelledby="ops-intelligence-alerts">
          <div className="border-b border-white/8 px-4 py-3">
            <h2 id="ops-intelligence-alerts" className="text-sm font-semibold text-white">Cảnh báo cần xem</h2>
          </div>
          <div className="space-y-2 p-3">
            {model.alerts.slice(0, 8).map((alert) => <article key={alert.alertId} className="border border-white/8 bg-black/20 p-3">
              <div className="flex gap-2"><AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${alert.severity === "critical" ? "text-rose-300" : alert.severity === "warning" ? "text-amber-300" : "text-sky-300"}`} /><div><h3 className="text-xs font-semibold text-white">{alert.title}</h3><p className="mt-1 text-xs leading-5 text-[#91a49b]">{alert.detail}</p></div></div>
            </article>)}
            {!model.alerts.length && <p className="py-6 text-center text-sm text-[#91a49b]">Không có cảnh báo xác định từ các nguồn đã đọc.</p>}
          </div>
        </section>

        <section className="col-span-12 border border-white/10 bg-[#07100c] p-4 xl:col-span-6">
          <PanelHeading icon={<DatabaseZap className="h-4 w-4" />} title="Tài chính & Đối soát" detail={`LIVE AGGREGATE · ${formatRange(finance.data?.queryRange ?? range)}`} />
          {finance.data?.value ? <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><DataPoint label="Doanh thu" value={formatVnd(finance.data.value.revenue.total)} /><DataPoint label="Còn lại theo range" value={formatVnd(finance.data.value.net)} /></dl> : <Unavailable detail={finance.data?.reasonCode ?? "Đang đọc nguồn tài chính."} />}
        </section>
        <section className="col-span-12 border border-white/10 bg-[#07100c] p-4 xl:col-span-6">
          <PanelHeading icon={<CircleDot className="h-4 w-4" />} title="Daily Digest" detail="Snapshot riêng, không cộng với Tài chính" />
          {digest.data?.value ? <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><DataPoint label="Ngày snapshot" value={digest.data.value.reportDate} /><DataPoint label="Trạng thái" value={`${digest.data.value.moneyState} · ${digest.data.value.freshnessState}`} /></dl> : digest.data?.availability === "exact" ? <EmptyExact detail={digest.data.reasonCode ?? "OWNER_DIGEST_EMPTY"} /> : <Unavailable detail={digest.data?.reasonCode ?? "Đang đọc Daily Digest."} />}
        </section>
      </div>

      <section className="border border-white/10 bg-[#07100c]" aria-labelledby="ops-intelligence-provenance">
        <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3"><ShieldCheck className="h-4 w-4 text-emerald-300" /><h2 id="ops-intelligence-provenance" className="text-sm font-semibold text-white">Source health & provenance</h2></div>
        <div className="grid divide-y divide-white/8 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">
          {model.sources.map((source) => <article key={source.sourceId} className="min-w-0 p-3"><div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-medium text-[#d7e3dc]">{source.label}</span><AvailabilityBadge availability={source.availability} /></div><p className="mt-2 font-mono text-[10px] leading-4 text-[#73867c]">as-of {source.asOf ?? "không do source cung cấp"}<br />receipt {source.observedAt===PENDING_OBSERVED_AT ? 'chưa nhận phản hồi' : formatTimestamp(source.observedAt)}</p>{source.reasonCode && <p className="mt-1 font-mono text-[10px] text-amber-200">{source.reasonCode}</p>}</article>)}
        </div>
      </section>
      {showDataHealth && q0Enabled && <OpsQuantDataHealthQ0Panel clubId={clubId} baselineSources={model.sources} />}
    </main>
  );
}

function sourceFromRead(sourceId: string, label: string, result: OpsReadEnvelope<unknown> | undefined, fallbackObservedAt: string): OpsSupplementalSourceInputV1 {
  return Object.freeze({ sourceId, label, availability: result?.availability ?? "unavailable", asOf: null, observedAt: result?.observedAt ?? fallbackObservedAt, reasonCode: result?.reasonCode ?? (result ? null : "SOURCE_PENDING") });
}

function trackerSource(enabled: boolean, result: OpsReadEnvelope<number> | undefined, fallbackObservedAt: string, tournamentCount: number): OpsSupplementalSourceInputV1 {
  if (!enabled) return unavailableSource("tracker-alerts", "Tracker alerts", fallbackObservedAt, "TRACKER_ALERT_ROLLOUT_DISABLED");
  if (!tournamentCount) return unavailableSource("tracker-alerts", "Tracker alerts", fallbackObservedAt, "TRACKER_ALERT_NO_RUNNING_TOURNAMENT");
  return sourceFromRead("tracker-alerts", "Tracker alerts", result, fallbackObservedAt);
}

function unavailableSource(sourceId: string, label: string, observedAt: string, reasonCode: string): OpsSupplementalSourceInputV1 {
  return Object.freeze({ sourceId, label, availability: "unavailable", asOf: null, observedAt, reasonCode });
}

function emptyOperations() {
  return Object.freeze({ observedAt: PENDING_OBSERVED_AT, asOf: null, availability: "unavailable" as const, reasonCode: "OPS_LIVE_PENDING", rows: Object.freeze([]), runningTournamentIds: Object.freeze([]), openTableCount: null, configuredTableCount: null, operationalTableCount: null, dealersOnDutyCount: null, countComparisonEligible: false });
}

function HeadlineStatus({ status }: { status: OpsHeadlineStatusV1 }) {
  const tone = { LIVE: "border-emerald-300/35 text-emerald-200", STALE: "border-amber-300/35 text-amber-200", PARTIAL: "border-amber-300/35 text-amber-200", UNAVAILABLE: "border-rose-300/35 text-rose-200" }[status];
  return <span className={`border px-2.5 py-1 font-mono text-xs font-semibold ${tone}`}>{status}</span>;
}

function AvailabilityBadge({ availability }: { availability: OpsSourceAvailabilityV1 }) {
  const label = { exact: "EXACT", partial: "PARTIAL", stale: "STALE", unavailable: "UNAVAILABLE" }[availability];
  const tone = availability === "exact" ? "text-emerald-200" : availability === "unavailable" ? "text-rose-200" : "text-amber-200";
  return <span className={`shrink-0 font-mono text-[10px] ${tone}`}>{label}</span>;
}

function MetricTile({ label, value, availability }: { label: string; value: number | null; availability: OpsSourceAvailabilityV1 }) {
  return <article className="min-w-0 bg-[#07100c] px-4 py-4"><div className="flex items-center justify-between gap-2"><p className="text-xs text-[#91a49b]">{label}</p><AvailabilityBadge availability={availability} /></div><p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-white">{value === null ? "—" : formatNumber(value)}</p></article>;
}

function PanelHeading({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <div className="flex items-start gap-2"><span className="mt-0.5 text-emerald-300">{icon}</span><div><h2 className="text-sm font-semibold text-white">{title}</h2><p className="mt-0.5 text-xs text-[#73867c]">{detail}</p></div></div>;
}

function DataPoint({ label, value }: { label: string; value: string }) {
  return <div className="border border-white/8 bg-black/20 p-3"><dt className="text-xs text-[#91a49b]">{label}</dt><dd className="mt-1 font-mono text-sm font-semibold tabular-nums text-white">{value}</dd></div>;
}

function Unavailable({ detail }: { detail: string }) {
  return <p className="mt-4 border border-dashed border-white/12 px-3 py-4 font-mono text-xs text-[#91a49b]">UNAVAILABLE · {detail}</p>;
}

function EmptyExact({ detail }: { detail: string }) {
  return <p className="mt-4 border border-dashed border-emerald-300/20 px-3 py-4 font-mono text-xs text-[#91a49b]">EMPTY EXACT · {detail}</p>;
}

function formatNumber(value: number): string { return value.toLocaleString("vi-VN"); }
function formatVnd(value: number): string { return `${formatNumber(value)} ₫`; }
function formatRange(range: { from: string; to: string }): string { return `${formatTimestamp(range.from)} → ${formatTimestamp(range.to)}`; }
function formatTimestamp(value: string): string { return new Date(value).toLocaleString("vi-VN", { timeZone:'Asia/Ho_Chi_Minh', day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
