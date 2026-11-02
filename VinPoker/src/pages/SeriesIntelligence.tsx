import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, FileSpreadsheet, Info, ShieldCheck, ChevronDown, FileText, BarChart3, CalendarRange, Dice5, FileImage, ClipboardList } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { FEATURES } from "@/lib/featureFlags";
import { SERIES_INTEL } from "@/lib/seriesIntelligence";
import { OwnerCommandCenter } from "@/components/series-intelligence/OwnerCommandCenter";
import { SeriesHealthReport } from "@/components/series-intelligence/SeriesHealthReport";
import { CsvImportPanel } from "@/components/series-intelligence/CsvImportPanel";
import { SeriesLibraryPanel } from "@/components/series-intelligence/SeriesLibraryPanel";
import { ReferenceDistributionPanel } from "@/components/series-intelligence/ReferenceDistributionPanel";
import { MonteCarloPanel } from "@/components/series-intelligence/MonteCarloPanel";
import { TurnoutForecastPanel, type ForecastFeedWithFee } from "@/components/series-intelligence/TurnoutForecastPanel";
import { ScheduleGeneratorPanel } from "@/components/series-intelligence/ScheduleGeneratorPanel";
import { FestivalEvPanel } from "@/components/series-intelligence/FestivalEvPanel";
import { ScheduleExportPanel } from "@/components/series-intelligence/ScheduleExportPanel";
import { Stepper, type StepperItem } from "@/components/series-intelligence/Stepper";
import { StepSection } from "@/components/series-intelligence/StepSection";
import { SeriesIntelEmptyState } from "@/components/series-intelligence/SeriesIntelEmptyState";
import { SeriesCaptureConsole } from "@/components/series-intelligence/SeriesCaptureConsole";
import { SeriesAssistant } from "@/components/series-intelligence/SeriesAssistant";
import { VCopilotPanel } from "@/components/series-intelligence/VCopilotPanel";
import { ClubPulsePanel } from "@/components/series-intelligence/ClubPulsePanel";
import TourRevenuePanel from "@/ops/finance/TourRevenuePanel";
import { SeriesCandidateAuthoringPanel } from "@/components/series-intelligence/SeriesCandidateAuthoringPanel";
import { RegistrationPacePanel } from "@/components/series-intelligence/RegistrationPacePanel";
import { SeriesIntelligenceWorkspaceNav } from "@/components/series-intelligence/SeriesIntelligenceWorkspaceNav";
import { parseSeriesCsv, SAMPLE_CSV_TEXT } from "@/lib/series-intelligence/csvImport";
import type { ScheduleEvent } from "@/lib/series-intelligence/scheduleGenerator";
import { useSeriesLibrary } from "@/lib/series-intelligence/useSeriesLibrary";
import { useGroupingOverrides } from "@/lib/series-intelligence/useGroupingOverrides";
import { mapClubPulseToExternalCopilotContextV1, type SeriesClubLivePulseV1 } from "@/lib/series-intelligence/seriesClubLivePulseV1";
import { mapSeriesClubPulseDemoToCopilotContextV1, SERIES_CLUB_PULSE_DEMO_CLUB_ID } from "@/lib/series-intelligence/seriesClubPulseDemoV1";

/**
 * Club Admin → Series Intelligence — Owner Command Center (Phase 9).
 * Role-guarded (club admin / club owner / super_admin). Reads the club's own live native series data
 * (read-only) and presents it as a guided 5-step flow: ①Nạp dữ liệu → ②Dữ liệu nói gì → ③Lên lịch →
 * ④Kiểm rủi ro & EV → ⑤Xuất. UI-only re-architecture — no backend / DB / write path, no logic change.
 */
export default function SeriesIntelligence() {
  const nav = useNavigate();
  const { user, session, isAdmin, isClubAdmin, isClubOwner, loading } = useAuth();
  const readerScope = JSON.stringify([user?.id ?? null, sessionReadEpoch(session)]);
  // W3 — F5 redirect race: useAuth flips `loading` false as soon as getSession resolves, but roles /
  // club-ownership are fetched a beat later (fetchRoles is async + fired separately). On a hard reload
  // that left an authorized owner briefly "unauthorized" → Navigate("/") kicked them home. Give roles a
  // short grace before actually redirecting; if they arrive (owner/admin becomes true) we cancel.
  const authorized = isClubAdmin || isClubOwner || isAdmin;
  const [redirectReady, setRedirectReady] = useState(false);
  useEffect(() => {
    if (loading || authorized) {
      setRedirectReady(false);
      return;
    }
    const t = setTimeout(() => setRedirectReady(true), 1500);
    return () => clearTimeout(t);
  }, [loading, authorized]);
  const [mode, setMode] = useState<"dashboard" | "report">("dashboard");
  // Series Library (browser-only). The dashboard renders the ACTIVE series, or live native when none.
  const lib = useSeriesLibrary();
  // Manual grouping overrides for the reference distribution (browser-only, persisted).
  const grouping = useGroupingOverrides(lib.series);
  // Generated festival schedule — LIFTED here so the EV (④) and Export (⑤) panels share it with the generator (③).
  const [draft, setDraft] = useState<ScheduleEvent[] | null>(null);
  // Forecast → overlay feed (lifted like `draft`): TurnoutForecastPanel emits it; MonteCarloPanel offers it
  // as an OPT-IN center source (default stays group history). Only exists while the forecast flag is on.
  const [forecastFeed, setForecastFeed] = useState<ForecastFeedWithFee | null>(null);
  // CTA "Xem rủi ro overlay với dự đoán này": bump the signal → the simulator switches source + we scroll to it.
  const [forecastSignal, setForecastSignal] = useState(0);
  const [acceptedClubPulse, setAcceptedClubPulse] = useState<{
    scope: string;
    value: SeriesClubLivePulseV1 | null;
  } | null>(null);
  const liveClubPulse = acceptedClubPulse?.scope === readerScope ? acceptedClubPulse.value : null;
  const acceptClubPulse = useCallback((value: SeriesClubLivePulseV1 | null) => {
    setAcceptedClubPulse({ scope: readerScope, value });
  }, [readerScope]);
  const [clubPulseDemoMode, setClubPulseDemoMode] = useState(false);
  // Demo->live clears asynchronously in ClubPulsePanel; never send its sentinel to a money reader.
  const moneyClubId = liveClubPulse?.clubId === SERIES_CLUB_PULSE_DEMO_CLUB_ID ? null : liveClubPulse?.clubId;
  const viewOverlayWithForecast = () => {
    setForecastSignal((s) => s + 1);
    // scroll after the state flush so the panel has re-rendered in forecast mode
    setTimeout(() => document.getElementById("mc-overlay-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  const hasData = lib.count > 0;
  const scrollToLoad = (): void => document.getElementById("step-load")?.scrollIntoView({ behavior: "smooth", block: "start" });
  // "Dùng dữ liệu mẫu" — reuses the EXISTING sample CSV + parser + add-handler (no new data/logic).
  const loadSample = (): void => {
    const parsed = parseSeriesCsv(SAMPLE_CSV_TEXT);
    if (parsed.events.length > 0) lib.addSeriesFromParse("series-mau.csv", parsed.events);
  };

  const stepItems: StepperItem[] = [
    { n: 1, label: "Nạp dữ liệu", targetId: "step-load" },
    { n: 2, label: "Dữ liệu nói gì", targetId: "step-insights" },
    ...(FEATURES.forwardLayerMonteCarlo
      ? [
          { n: 3, label: "Lên lịch", targetId: "step-schedule" },
          { n: 4, label: "Kiểm rủi ro & EV", targetId: "step-risk" },
          { n: 5, label: "Xuất", targetId: "step-export" },
        ]
      : []),
    ...(FEATURES.seriesDecisionLog ? [{ n: 6, label: "Ghi quyết định", targetId: "step-capture" }] : []),
  ];

  if (loading) return null;
  // Wait out the roles grace before redirecting (fixes the F5-kicks-you-home race). Only redirect
  // once roles have had time to load and the user is genuinely unauthorized.
  if (!authorized) return redirectReady ? <Navigate to="/" replace /> : null;

  if (mode === "report") {
    return (
      <div className="container max-w-5xl mx-auto p-4 space-y-4">
        <SeriesHealthReport onBack={() => setMode("dashboard")} />
      </div>
    );
  }

  return (
    <div className="container max-w-5xl mx-auto p-4 space-y-5">
      {/* header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav(-1)} aria-label="Quay lại">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="font-display text-2xl text-primary flex items-center gap-2">
            <Sparkles className="w-5 h-5 shrink-0" /> {SERIES_INTEL.title}
          </h1>
          <p className="text-xs text-muted-foreground">{SERIES_INTEL.commandCenterSubtitle}</p>
        </div>
      </div>

      <SeriesIntelligenceWorkspaceNav active="operations" />

      {FEATURES.seriesClubPulseV1 && <ClubPulsePanel key={readerScope} enabled demoMode={clubPulseDemoMode} onDemoModeChange={setClubPulseDemoMode} onPulseChange={acceptClubPulse} />}
      {FEATURES.seriesClubPulseV1 && user && !clubPulseDemoMode && moneyClubId && (
        <TourRevenuePanel key={`${readerScope}:${moneyClubId}`} clubId={moneyClubId} />
      )}

      {/* transparency badge + report entry */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden />
          {SERIES_INTEL.transparencyBadge}
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setMode("report")}>
          <FileText className="h-4 w-4" /> Xem báo cáo
        </Button>
      </div>

      {!FEATURES.clubSeriesIntelligence && (
        <Card className="p-3 border-primary/40 bg-primary/5 flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="w-4 h-4 text-primary shrink-0" />
          <span>{SERIES_INTEL.previewNote}</span>
        </Card>
      )}

      {/* safety boundary */}
      <Card className="p-4 gradient-card border-primary/40">
        <p className="text-sm text-muted-foreground">{SERIES_INTEL.safetyBoundary}</p>
      </Card>

      {/* step legend */}
      <Stepper items={stepItems} current={hasData ? undefined : 1} />

      {/* W1 — Trợ lý Series: workflow ring + "hôm nay cần làm gì" (gated; hooks only run when mounted) */}
      {FEATURES.seriesAssistant && <SeriesAssistant csvEvents={lib.activeEvents} onLoadSample={loadSample} />}
      {FEATURES.seriesVCandidateAuthoringV1 && !clubPulseDemoMode && (
        <SeriesCandidateAuthoringPanel clubId={liveClubPulse?.clubId ?? null} />
      )}
      {FEATURES.seriesVCopilotV1 && (
        <VCopilotPanel
          contextMode={clubPulseDemoMode ? "mock" : FEATURES.seriesClubPulseV1 ? "live" : "mock"}
          clubId={liveClubPulse?.clubId ?? null}
          clubPulse={liveClubPulse
            ? clubPulseDemoMode
              ? mapSeriesClubPulseDemoToCopilotContextV1(liveClubPulse)
              : mapClubPulseToExternalCopilotContextV1(liveClubPulse)
            : null}
        />
      )}

      {/* start-here CTA when no series is loaded */}
      {!hasData && <SeriesIntelEmptyState onUpload={scrollToLoad} onSample={loadSample} />}

      {/* ① Nạp dữ liệu */}
      <StepSection
        id="step-load"
        n={1}
        title="Nạp dữ liệu"
        subtitle="Tải CSV các series đã chạy — mỗi file là một series. Chỉ nằm trên trình duyệt này."
        icon={<FileSpreadsheet className="h-4 w-4 text-primary" />}
      >
        <Collapsible defaultOpen={!hasData}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between gap-2">
              <span className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4" /> {SERIES_INTEL.csvSectionLabel}
              </span>
              <ChevronDown className="w-4 h-4 opacity-60" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3">
            {FEATURES.seriesIntelligenceCsvImport ? (
              <CsvImportPanel
                onSeriesParsed={lib.addSeriesFromParse}
                loadedCount={lib.count}
                existingFilenames={lib.filenames}
                lastSaveError={lib.lastSaveError}
              />
            ) : (
              <>
                {/* legacy static fallback (flag off) */}
                <div className="space-y-3">
                  {SERIES_INTEL.steps.map((s) => (
                    <Card key={s.n} className="p-4 gradient-card border-primary/40 flex items-start gap-3">
                      <div className="grid place-items-center w-7 h-7 rounded-full bg-primary/15 text-primary text-sm font-semibold shrink-0">
                        {s.n}
                      </div>
                      <div>
                        <h3 className="font-display text-base">{s.label}</h3>
                        <p className="text-xs text-muted-foreground">{s.desc}</p>
                      </div>
                    </Card>
                  ))}
                </div>

                <Card className="p-4 gradient-card border-primary/40">
                  <h3 className="font-display text-base flex items-center gap-2 mb-2">
                    <FileSpreadsheet className="w-4 h-4 text-primary" /> Cột CSV cần chuẩn bị
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {SERIES_INTEL.requiredColumns.map((c) => (
                      <Badge key={c} variant="secondary" className="font-mono text-[11px]">
                        {c}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{SERIES_INTEL.eventIdNote}</span>
                  </p>
                </Card>

                <Card className="p-4 border-primary/30">
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {SERIES_INTEL.demoNotes.map((n, i) => (
                      <li key={i} className="flex gap-2">
                        <span aria-hidden>•</span>
                        <span>{n}</span>
                      </li>
                    ))}
                  </ul>
                </Card>

                <Button disabled variant="outline" className="w-full gap-2">
                  <FileSpreadsheet className="w-4 h-4" /> {SERIES_INTEL.ctaDisabledLabel}
                </Button>
              </>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Series Library — loaded CSV series; pick the active one (browser-only). Secondary, near ①. */}
        {FEATURES.seriesIntelligenceCsvImport && (
          <SeriesLibraryPanel
            series={lib.series}
            activeId={lib.activeId}
            onSelect={lib.select}
            onRename={lib.rename}
            onRemove={lib.remove}
            onClearAll={lib.clearAll}
          />
        )}
      </StepSection>

      {/* ② Dữ liệu nói gì */}
      <StepSection
        id="step-insights"
        n={2}
        title="Dữ liệu nói gì"
        subtitle="Các series đã qua: kinh tế, rủi ro, và mỗi giải thường đông bao nhiêu."
        icon={<BarChart3 className="h-4 w-4 text-primary" />}
      >
        <OwnerCommandCenter csvEvents={lib.activeEvents} />
        {FEATURES.seriesIntelligenceCsvImport && (
          <ReferenceDistributionPanel
            series={lib.series}
            overrideLabels={grouping.overrideLabels}
            onMerge={grouping.merge}
            onReset={grouping.reset}
            onResetAll={grouping.resetAll}
            hasOverrides={grouping.hasOverrides}
          />
        )}
      </StepSection>

      {/* ③ Lên lịch */}
      {FEATURES.forwardLayerMonteCarlo && (
        <StepSection
          id="step-schedule"
          n={3}
          title="Lên lịch"
          subtitle="Sinh lịch festival nháp: giờ thi đấu, cấu trúc, GTD — sửa được, cần TD review."
          icon={<CalendarRange className="h-4 w-4 text-primary" />}
        >
          <ScheduleGeneratorPanel draft={draft} onDraftChange={setDraft} />
        </StepSection>
      )}

      {/* ④ Kiểm rủi ro & EV — overlay 1 giải TRƯỚC, EV festival SAU */}
      {FEATURES.forwardLayerMonteCarlo && (
        <StepSection
          id="step-risk"
          n={4}
          title="Kiểm rủi ro & EV"
          subtitle="Soi rủi ro trước, EV sau. Mô phỏng overlay GTD & EV (Monte Carlo) — kịch bản, không phải dự báo."
          icon={<Dice5 className="h-4 w-4 text-primary" />}
        >
          {/* forecast FIRST (reading order = data flow: dự báo → rủi ro overlay → EV) */}
          {FEATURES.seriesTurnoutForecast && (
            <TurnoutForecastPanel
              csvEvents={lib.activeEvents}
              onForecastFeed={setForecastFeed}
              onViewOverlayWithForecast={viewOverlayWithForecast}
            />
          )}
          <MonteCarloPanel
            series={lib.series}
            overrideLabels={grouping.overrideLabels}
            audience="internal"
            forecastFeed={FEATURES.seriesTurnoutForecast ? forecastFeed : undefined}
            forecastSourceSignal={forecastSignal}
          />
          <FestivalEvPanel draft={draft} />
          {FEATURES.seriesRegistrationPace && <RegistrationPacePanel />}
        </StepSection>
      )}

      {/* ⑤ Xuất — poster PNG + Excel, sau khi đã kiểm rủi ro */}
      {FEATURES.forwardLayerMonteCarlo && (
        <StepSection
          id="step-export"
          n={5}
          title="Xuất"
          subtitle="Poster PNG + Excel để marketing & vận hành. Poster dán nhãn DRAFT tới khi bạn xác nhận đã TD review."
          icon={<FileImage className="h-4 w-4 text-primary" />}
        >
          <ScheduleExportPanel draft={draft} />
        </StepSection>
      )}

      {/* ⑥ Ghi quyết định & Kết quả — CAPTURE console (owner-scoped DB write, flag-gated) */}
      {FEATURES.seriesDecisionLog && (
        <StepSection
          id="step-capture"
          n={6}
          title="Ghi quyết định & Kết quả"
          subtitle="Ghi quyết định vận hành + kết quả sau giải cho từng giải (chủ CLB). Tầng ghi dữ liệu — không model, không dự đoán."
          icon={<ClipboardList className="h-4 w-4 text-primary" />}
        >
          <SeriesCaptureConsole />
        </StepSection>
      )}
    </div>
  );
}
