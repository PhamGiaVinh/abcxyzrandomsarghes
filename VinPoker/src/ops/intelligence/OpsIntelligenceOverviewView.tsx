import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, CalendarDays, CircleAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { operationsQueryOptions, pulseQueryOptions, registrationQ0QueryOptions, sepayQ0QueryOptions } from "./opsIntelligenceQueryOptions";
import { isOpsQuantDataHealthQ0Enabled } from "./opsQuantDataHealthGate";
import { buildOpsIntelligenceOverviewV1, gapLabel, sourceTarget, type IntelligenceTabV1, type OverviewSourceV1 } from "./opsIntelligenceOverviewV1";
import { festivalGaps, scopeForTournament, tournamentGaps, type OpsIntelligenceContextV1, type OpsIntelligenceScopeV1, type TournamentContextV1 } from "./opsIntelligenceContextV1";
import type { OpsLiveOperationInputV1 } from "./opsIntelligenceReadModel";
import type { QuantSourceReceiptsQ1 } from "./opsQuantDashboardQ1";
import { OpsIntelligenceTimelineSection } from "./OpsIntelligenceTimelinePanel";

const EMPTY_OPERATIONS: OpsLiveOperationInputV1 = { availability: "unavailable", reasonCode: "OPERATIONS_NOT_ACCEPTED", observedAt: "", asOf: null, rows: [], runningTournamentIds: [], openTableCount: null, configuredTableCount: null, operationalTableCount: null, dealersOnDutyCount: null, countComparisonEligible: false };

export function OpsIntelligenceOverviewV1({ clubId, scope, context, contextReason, onRetryContext, navigate, receipts, onReceiptsChange }: {
  clubId: string; scope: OpsIntelligenceScopeV1;
  context: { value: OpsIntelligenceContextV1; observedAt: string } | null;
  contextReason: string | null;
  onRetryContext: () => void;
  navigate: (scope: OpsIntelligenceScopeV1, tab: IntelligenceTabV1) => void;
  receipts: QuantSourceReceiptsQ1; onReceiptsChange: Dispatch<SetStateAction<QuantSourceReceiptsQ1>>;
}) {
  const client = useSupabaseClient();
  const queryClient = useQueryClient();
  const pulse = useQuery(pulseQueryOptions(client, clubId));
  const operations = useQuery(operationsQueryOptions(client, clubId, isOpsQuantDataHealthQ0Enabled()));
  const registration = useQuery(registrationQ0QueryOptions(client, clubId));
  const sepay = useQuery(sepayQ0QueryOptions(client, clubId));
  const [detailId, setDetailId] = useState<string | null>(null);
  const scopeKey = `${clubId}:${scope.kind}:${"festivalId" in scope ? scope.festivalId : ""}:${"tournamentId" in scope ? scope.tournamentId : ""}`;
  const [timelineState, setTimelineState] = useState<{ scopeKey: string; source: OverviewSourceV1 } | null>(null);
  const pulseValue = !pulse.isError && pulse.data?.value?.ok ? { value: pulse.data.value.value, observedAt: pulse.data.observedAt } : null;
  const registrationValue = !registration.isError && registration.data?.value ? { value: registration.data.value, observedAt: registration.data.observedAt } : null;
  const sepayValue = !sepay.isError && sepay.data?.value ? { value: sepay.data.value, observedAt: sepay.data.observedAt } : null;
  const model = buildOpsIntelligenceOverviewV1({ clubId, scope, context, contextReason, pulse: pulseValue, operations: operations.isError ? EMPTY_OPERATIONS : operations.data ?? EMPTY_OPERATIONS, registration: registrationValue, sepay: sepayValue });
  const timelineFallback: OverviewSourceV1 = { id: "timeline", label: "Operational timeline", definition: "Entry lifecycle, table sessions, dealer assignments và GTD registrations theo exact tournament.", availability: "unavailable", asOf: null, observedAt: null, reason: scope.kind === "club" ? "TIMELINE_TOURNAMENT_SCOPE_REQUIRED" : scope.kind === "festival" ? "TIMELINE_CHILD_SCOPE_REQUIRED" : "TIMELINE_NOT_ACCEPTED" };
  const timelineSource = timelineState?.scopeKey === scopeKey ? timelineState.source : timelineFallback;
  const readinessSources = [...model.sources, timelineSource];
  const detail = [...model.metrics, ...readinessSources].find((row) => row.id === detailId) ?? null;
  const acceptTimelineSource = useCallback((source: OverviewSourceV1) => {
    setTimelineState((previous) => previous?.scopeKey === scopeKey && previous.source.availability === source.availability && previous.source.asOf === source.asOf && previous.source.observedAt === source.observedAt && previous.source.reason === source.reason ? previous : { scopeKey, source });
  }, [scopeKey]);
  useEffect(() => {
    const accepted: QuantSourceReceiptsQ1 = {};
    for (const source of [...model.sources, ...model.metrics]) if (source.observedAt) accepted[`overview:${source.id}`] = { asOf: source.asOf, observedAt: source.observedAt };
    onReceiptsChange((previous) => Object.entries(accepted).every(([key, value]) => previous[key]?.asOf === value.asOf && previous[key]?.observedAt === value.observedAt) ? previous : { ...previous, ...accepted });
  }, [model.sources, model.metrics, onReceiptsChange]);
  const pending = pulse.isPending || operations.isPending || registration.isPending || sepay.isPending;
  const refresh = () => void Promise.allSettled([
    pulse.refetch(), operations.refetch(), registration.refetch(), sepay.refetch(),
    queryClient.refetchQueries({ queryKey: ["ops", clubId, "intelligence", "timeline-v1"] }),
  ]);
  const openTournament = (id: string) => {
    const next = context && scopeForTournament(context.value, id);
    if (next) navigate(next, "quant");
  };
  const openSource = (sourceId: string) => {
    const target = sourceTarget(sourceId);
    if (!target) return;
    setDetailId(null);
    if (target.retryContext) onRetryContext();
    else navigate(scope, target.tab);
  };
  return <section data-testid="ops-intelligence-overview-v1" className="space-y-3 text-[13px] text-[#c7d4d0]">
    <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold text-white">Tình hình CLB <span className="ml-2 text-sm text-emerald-200">{pending ? "ĐANG ĐỌC" : model.headlineStatus}</span></h2><Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="mr-2 h-4 w-4" />Làm mới</Button></div>
    <div className="grid grid-cols-2 divide-x divide-white/10 border border-white/10 bg-[#071014] sm:grid-cols-3 xl:grid-cols-6">{model.metrics.map((metric) => <button type="button" key={metric.id} onClick={() => setDetailId(metric.id)} className="min-w-0 p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 hover:bg-white/5"><span className="block text-[#a1b4ad]">{metric.label}</span><strong className={`my-2 block font-mono text-2xl tabular-nums ${metric.value === null ? "text-amber-200" : "text-cyan-200"}`}>{metric.value === null ? "—" : metric.value.toLocaleString("vi-VN")}</strong><span className="block text-xs">{metric.grain} · {metric.availability.toUpperCase()}</span></button>)}</div>
    {model.noWindowEvents && <p role="status" className="border-l-2 border-cyan-300/50 bg-cyan-300/5 px-3 py-2">Không có giải trong khoảng vận hành hiện tại. Lịch dưới đây giữ nguyên các liên kết do nguồn cung cấp.</p>}
    {!model.resolved.valid && <p role="alert" className="border-l-2 border-amber-300 px-3 py-2">Phạm vi đã chọn chưa khả dụng. Không tự chuyển sang giải khác.</p>}
    <OpsIntelligenceTimelineSection clubId={clubId} scope={scope} festival={model.resolved.festival} navigate={navigate} receipts={receipts} onReceiptsChange={onReceiptsChange} onSourceState={acceptTimelineSource} />
    <div className="grid grid-cols-12 gap-3">
      <section className="col-span-4 min-w-0 border border-white/10 bg-[#050b0d]"><h2 className="border-b border-white/10 p-3 text-sm font-semibold text-white"><CircleAlert className="mr-2 inline h-4 w-4 text-amber-200" />Việc cần xử lý <span className="text-[#a1b4ad]">({model.actions.length})</span></h2><div className="max-h-[430px] overflow-y-auto divide-y divide-white/10">{model.actions.map((action) => <div key={action.id} data-testid={`overview-action-${action.id}`} className="p-3"><p className={action.severity === "critical" ? "text-rose-200" : "text-amber-100"}>{action.title}</p><p className="mt-1 break-words text-xs text-[#a1b4ad]">{action.source} · {action.severity.toUpperCase()}</p><button type="button" onClick={() => action.retryContext ? onRetryContext() : navigate(action.scope, action.tab)} className="mt-2 min-h-8 text-cyan-200 underline focus-visible:outline">{action.retryContext ? sourceTarget(action.source)?.label : action.tab === "overview" ? "Xem phạm vi" : sourceTarget(action.source)?.label}<ArrowUpRight className="ml-1 inline h-3.5 w-3.5" /></button></div>)}{!model.actions.length && <p className="p-3">Không có việc cần xử lý từ các nguồn đã đọc.</p>}</div></section>
      <section className="col-span-8 min-w-0 border border-white/10 bg-[#050b0d]"><h2 className="border-b border-white/10 p-3 text-sm font-semibold text-white"><CalendarDays className="mr-2 inline h-4 w-4 text-cyan-200" />Lịch giải · sắp tới & lịch sử</h2>
        {!context && <p className="p-3" role="status">{contextReason ? "Không đọc được lịch. Kiểm tra nguồn phạm vi." : "Đang đọc lịch CLB…"}</p>}
        {context && !model.daily.length && !model.festivals.length && <p className="p-3">Nguồn lịch trả về rỗng ở phạm vi này.</p>}
        <div className="max-h-[430px] overflow-y-auto">{sortSchedule(model.daily, context?.value.asOf).map((row) => <TournamentRow key={row.tournamentId} row={row} linked={false} asOf={context?.value.asOf ?? null} open={() => openTournament(row.tournamentId)} />)}
        {model.festivals.map((festival) => <section key={festival.festivalId} className="border-b border-white/10">
          <div className="flex items-start justify-between gap-3 bg-white/[0.025] p-3"><div><button type="button" className="text-left font-semibold text-cyan-100 underline focus-visible:outline" onClick={() => navigate({ kind: "festival", festivalId: festival.festivalId }, "overview")}>{festival.name}</button><p className="mt-1 text-xs">FESTIVAL · {festival.status ?? "Chưa có trạng thái"}</p><p className="mt-1 text-xs text-amber-100">{festivalGaps(festival).map(gapLabel).join(" · ") || `Final: ${festival.tournaments.find((row) => row.tournamentId === festival.finalTournamentId)?.name ?? "Chưa xác minh"}`}</p></div><span className="text-xs text-[#a1b4ad]">Không cộng GTD / người giữa các flight</span></div>
          {sortSchedule(festival.tournaments, context?.value.asOf).map((row) => <TournamentRow key={row.tournamentId} row={row} linked asOf={context?.value.asOf ?? null} open={() => openTournament(row.tournamentId)} />)}
        </section>)}</div>
      </section>
    </div>
    <section data-testid="overview-readiness" className="border border-white/10 bg-[#050b0d]"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-3"><h2 className="text-sm font-semibold text-white">Mức sẵn sàng dữ liệu</h2><div className="flex flex-wrap gap-4">{scope.kind === "festival" ? <span className="text-[#a1b4ad]">Chọn Flight hoặc Final để mở Quant</span> : scope.kind !== "club" && <button type="button" className="text-cyan-200 underline focus-visible:outline" onClick={() => navigate(scope, "quant")}>Mở Quant</button>}{([['live', 'Mở Live Ops'], ['health', 'Mở Data Health']] as const).map(([tab, label]) => <button key={tab} type="button" className="text-cyan-200 underline focus-visible:outline" onClick={() => navigate(scope, tab)}>{label}</button>)}</div></div><div className="grid grid-cols-2 divide-x divide-white/10 sm:grid-cols-3 xl:grid-cols-6">{readinessSources.map((source) => <button key={source.id} type="button" onClick={() => setDetailId(source.id)} className="min-w-0 p-3 text-left hover:bg-white/5 focus-visible:outline"><span className="block">{source.label}</span><span className={`mt-1 block text-xs ${source.availability === "exact" ? "text-emerald-200" : "text-amber-200"}`}>{source.availability.toUpperCase()}</span></button>)}</div></section>
    <SourceSheet source={detail} receipt={detail ? receipts[`overview:${detail.id}`] : undefined} scope={scope} onClose={() => setDetailId(null)} onSource={openSource} />
  </section>;
}

function sortSchedule(rows: readonly TournamentContextV1[], asOf: string | undefined) {
  const cutoff = asOf ? Date.parse(asOf) - 86400000 : 0;
  return [...rows].sort((a, b) => {
    const aTime = a.startTime ? Date.parse(a.startTime) : Infinity;
    const bTime = b.startTime ? Date.parse(b.startTime) : Infinity;
    return Number(aTime < cutoff) - Number(bTime < cutoff) || aTime - bTime || a.tournamentId.localeCompare(b.tournamentId);
  });
}
function TournamentRow({ row, linked, asOf, open }: { row: TournamentContextV1; linked: boolean; asOf: string | null; open: () => void }) {
  const gaps = tournamentGaps(row, linked);
  const unknown = linked && row.phase !== "flight" && row.phase !== "final";
  return <div className="grid grid-cols-[110px_minmax(0,1fr)_120px_90px] items-center gap-3 border-t border-white/8 p-3" data-testid={`schedule-${row.tournamentId}`}>
    <span className="text-xs tabular-nums">{row.startTime ? new Date(row.startTime).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : "Chưa có giờ"}{row.startTime && asOf && row.startTime < asOf && <span className="block text-[#a1b4ad]">Đã bắt đầu / lịch sử</span>}</span>
    <div className="min-w-0"><p className="break-words font-medium text-white">{row.name}</p><p className="mt-1 text-xs text-[#a1b4ad]">{!linked ? "DAILY" : unknown ? "VAI TRÒ CHƯA XÁC ĐỊNH" : `${row.phase?.toUpperCase()} ${row.flightLabel ?? ""}`} · {row.status ?? "Chưa có trạng thái"}</p><p className="mt-1 text-xs text-amber-100">{gaps.map(gapLabel).join(" · ") || "Liên kết và trường lịch đầy đủ"}</p></div>
    <span className="text-xs tabular-nums">Buy-in: {row.buyIn === null ? "—" : row.buyIn.toLocaleString("vi-VN")} ₫<br />GTD giải này: {row.gtd === null ? "—" : row.gtd.toLocaleString("vi-VN")} ₫</span>
    <Button type="button" size="sm" variant="outline" disabled={unknown} onClick={open}>Mở Quant</Button>
  </div>;
}
function SourceSheet({ source, receipt, scope, onClose, onSource }: { source: OverviewSourceV1 | null; receipt: { asOf: string | null; observedAt: string } | undefined; scope: OpsIntelligenceScopeV1; onClose: () => void; onSource: (sourceId: string) => void }) {
  const target = source && sourceTarget(source.id);
  return <Sheet open={!!source} onOpenChange={(open) => { if (!open) onClose(); }}><SheetContent className="text-sm"><SheetHeader><SheetTitle>{source?.label ?? "Nguồn dữ liệu"}</SheetTitle><SheetDescription>{source?.definition}</SheetDescription></SheetHeader>{source && <dl className="mt-6 space-y-4 break-words"><div><dt>Phạm vi đang xem</dt><dd>{scope.kind}{"festivalId" in scope && ` · ${scope.festivalId}`}{"tournamentId" in scope && ` · ${scope.tournamentId}`}</dd></div><div><dt>Nguồn</dt><dd>{source.id} · {source.availability.toUpperCase()}</dd></div><div><dt>Source asOf</dt><dd>{source.asOf ?? "Nguồn chưa cung cấp"}</dd></div><div><dt>Lần đọc thành công</dt><dd>{receipt?.observedAt ?? source.observedAt ?? "Chưa có"}</dd></div><div><dt>Lý do</dt><dd>{source.reason ? gapLabel(source.reason) : "Nguồn đã xác minh"}</dd></div>{source.id === "history" && <p>Chưa được nối trong Wave 2</p>}{target && <Button onClick={() => onSource(source.id)}>{target.label}</Button>}</dl>}</SheetContent></Sheet>;
}
