import { useEffect, useMemo, useState } from "react";
import { TrendingUp, FlaskConical, AlertTriangle, ChevronRight, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatVndShort } from "@/lib/clubFinance";
import { FEATURES } from "@/lib/featureFlags";
import type { SeriesEvent } from "@/lib/series-intelligence/nativeData";
import { useNativeSeriesEvents } from "@/lib/series-intelligence/useNativeSeriesEvents";
import {
  forecastTurnout,
  forecastToOverlayFeed,
  describeFeature,
  type ForecastConfidence,
  type ForecastOverlayFeed,
} from "@/lib/series-intelligence/turnoutForecast";
import { naiveBaseline, baselineDeltaPct } from "@/lib/series-intelligence/naiveBaseline";
import { runBaselineBattery } from "@/lib/series-intelligence/baselineBattery";
import { toHonestForecastResult } from "@/lib/series-intelligence/honestForecast";
import { BaselineBatteryCard } from "./BaselineBatteryCard";
import { HonestForecastView } from "./HonestForecastView";
import { ExplainHint } from "./ExplainHint";
import { EmptyExplainer } from "./EmptyExplainer";
import { RegimeNotice } from "./RegimeNotice";
import { VThinkingIndicator } from "./VThinkingIndicator";

/** What this panel emits upward so the group-history overlay simulator can offer a forecast center. */
export type ForecastFeedWithFee = ForecastOverlayFeed & { fee: number };

const CONF: Record<ForecastConfidence, { label: string; cls: string }> = {
  low: { label: "Thấp — ít dữ liệu", cls: "border-destructive/50 bg-destructive/10 text-destructive" },
  medium: { label: "Trung bình", cls: "border-warning/50 bg-warning/10 text-warning" },
  high: { label: "Cao", cls: "border-primary/50 bg-primary/10 text-primary" },
};
const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const TOMORROW_FORECAST_THINKING_MS = 10_000;

function isTomorrowLocalDate(date: string, now = new Date()): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;

  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return (
    Number(match[1]) === tomorrow.getFullYear()
    && Number(match[2]) === tomorrow.getMonth() + 1
    && Number(match[3]) === tomorrow.getDate()
  );
}

const median = (v: Array<number | null>): number | null => {
  const s = v.filter((x): x is number => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * TurnoutForecastPanel — "Dự báo lượng khách — giải sắp tới" (quant-spec mockup layout: form + factor
 * contributions on the left, the BIG number + band + tier + CV tiles + CTA on the right). Transparent ridge
 * log-linear; the number never appears without band + tier + error + disclaimer. Labeled Hypothesis — never
 * Model Estimate. The CTA hands the forecast to the overlay simulator below (explicit adapter, no fake n).
 */
export function TurnoutForecastPanel({
  csvEvents,
  onForecastFeed,
  onViewOverlayWithForecast,
}: {
  csvEvents?: SeriesEvent[] | null;
  /** Fires whenever the usable forecast feed changes (null when nothing usable). */
  onForecastFeed?: (feed: ForecastFeedWithFee | null) => void;
  /** CTA "Xem rủi ro overlay với dự đoán này" — the page switches the simulator's center source + scrolls. */
  onViewOverlayWithForecast?: () => void;
}) {
  const native = useNativeSeriesEvents();
  const csvSelected = csvEvents != null;
  const availableEvents = csvEvents ?? native.events;
  const clubIds = useMemo(() => [...new Set(availableEvents.map(event => event.clubId))].sort(), [availableEvents]);
  const [selection, setSelection] = useState({ sourceKey: "", club: "" });
  const sourceKey = JSON.stringify([csvSelected ? "csv" : "native", clubIds]);
  const club = clubIds.length === 1 ? clubIds[0] : selection.sourceKey === sourceKey ? selection.club : "";
  const events = useMemo(() => club === "portfolio" ? availableEvents
    : club ? availableEvents.filter(event => event.clubId === club) : [], [availableEvents, club]);

  const [date, setDate] = useState("");
  // Real start hour matters: training rows carry true start times (hour-slot feature); a date-only value
  // would parse as UTC midnight (= 07:00 VN → always the morning slot). Default 19:00, editable.
  const [startTime, setStartTime] = useState("19:00");
  const [buyIn, setBuyIn] = useState<number | null>(null);
  const [gtd, setGtd] = useState<number | null>(null);
  const [typeKeyword, setTypeKeyword] = useState("");
  const [override, setOverride] = useState<number | null>(null);
  // TP2 — optional brand/series name; ONLY feeds the edition-trend feature, and the field only appears when
  // seriesCalendarFeatures is on (so the default UI is unchanged).
  const [seriesName, setSeriesName] = useState("");
  // TP6 — optional venue capacity of the upcoming event; the field only appears when seriesCensoring is on.
  const [capacity, setCapacity] = useState<number | null>(null);
  // TP5 — rival clash: a manual "đối thủ có giải lớn cùng ngày?" reminder. Does NOT feed the model (it hasn't
  // learned this factor); it only surfaces a caution + records context. Fields appear when seriesRivalClash is on.
  const [rival, setRival] = useState(false);
  const [rivalGtd, setRivalGtd] = useState<number | null>(null);
  const [settledTomorrowForecastKey, setSettledTomorrowForecastKey] = useState<string | null>(null);
  const [tomorrowForecastRunRevision, setTomorrowForecastRunRevision] = useState(0);

  const ready = date.trim() !== "" && buyIn !== null && buyIn > 0;
  // Local datetime (never date-only) so the hour-slot feature matches the training rows' bucketing.
  const eventDateTime = `${date}T${/^\d{2}:\d{2}$/.test(startTime) ? startTime : "19:00"}:00+07:00`;
  const fc = useMemo(
    () =>
      ready
        ? forecastTurnout(
            events,
            { event_date: eventDateTime, buy_in: buyIn as number, gtd, typeKeyword: typeKeyword.trim() || null, event_name: seriesName.trim() || null, capacity },
            { calendarFeatures: FEATURES.seriesCalendarFeatures, censoring: FEATURES.seriesCensoring },
          )
        : null,
    [events, eventDateTime, buyIn, gtd, typeKeyword, seriesName, capacity, ready],
  );
  const medianFee = useMemo(() => median(events.map((e) => e.fee)), [events]);

  // Explicit forecast→overlay adapter feed (σ recovered from the forecast band; NO synthetic n anywhere).
  const feed = useMemo(() => forecastToOverlayFeed(fc, buyIn, override), [fc, buyIn, override]);

  // Bubble the feed up so the simulator below can offer "Dự báo" as a center source.
  useEffect(() => {
    onForecastFeed?.(feed && medianFee !== null ? { ...feed, fee: medianFee } : null);
  }, [feed, medianFee, onForecastFeed]);

  const contributions = (fc?.coefContributions ?? []).filter((c) => Math.abs(c.impactPct) >= 1).slice(0, 8);
  const showCoef = fc?.available && fc.confidence !== "low" && contributions.length > 0;

  // W5 — naive baseline: the dumbest honest guess (mean of the last 3 same-type past events) shown next
  // to the model, so the owner can feel whether the model earns its complexity. Leakage-safe (past only).
  const baseline = useMemo(
    () => (FEATURES.seriesNaiveBaseline && ready ? naiveBaseline(events, typeKeyword.trim() || null, eventDateTime) : null),
    [events, typeKeyword, eventDateTime, ready],
  );
  const baseVsModel = baselineDeltaPct(fc?.base ?? null, baseline?.value ?? null);

  // A3 — Baseline Battery ("Mốc dự báo đơn giản") + A4b adapter input. Computed over the SAME target/opts as
  // `fc` (folds match the model CV) when EITHER the A3 card could show (seriesBaselineBattery ON + a forecast)
  // OR the A4b honest adapter needs it (seriesInsufficientDataUx ON, ready — even when the model is unavailable,
  // for the baseline_only path). The A3-only condition is preserved exactly, so A3 stays byte-identical; null
  // otherwise.
  const battery = useMemo(
    () =>
      ready && (FEATURES.seriesInsufficientDataUx || (FEATURES.seriesBaselineBattery && fc?.available))
        ? runBaselineBattery(
            events,
            { event_date: eventDateTime, buy_in: buyIn as number, gtd, typeKeyword: typeKeyword.trim() || null, event_name: seriesName.trim() || null, capacity },
            { calendarFeatures: FEATURES.seriesCalendarFeatures, censoring: FEATURES.seriesCensoring },
          )
        : null,
    [events, eventDateTime, buyIn, gtd, typeKeyword, seriesName, capacity, ready, fc?.available],
  );

  // A4b — honest insufficient-data result. Adapts the EXISTING fc (public output UNCHANGED) + the A4a
  // capability gate + the A3 battery into one discriminated result, so the panel never shows a fabricated 0.
  // Only computed when seriesInsufficientDataUx is ON; null ⇒ the panel uses its existing branches (byte-identical).
  const honestResult = useMemo(
    () => (FEATURES.seriesInsufficientDataUx && ready && fc ? toHonestForecastResult(fc, battery) : null),
    [fc, battery, ready],
  );

  const tomorrowForecastKey = useMemo(() => {
    if (!fc?.available || !isTomorrowLocalDate(date)) return null;
    return [date, startTime, buyIn, gtd, typeKeyword, seriesName, capacity, rival, rivalGtd, tomorrowForecastRunRevision].join("|");
  }, [fc?.available, date, startTime, buyIn, gtd, typeKeyword, seriesName, capacity, rival, rivalGtd, tomorrowForecastRunRevision]);
  const isThinkingAboutTomorrow = tomorrowForecastKey !== null && settledTomorrowForecastKey !== tomorrowForecastKey;

  useEffect(() => {
    if (!tomorrowForecastKey) {
      setSettledTomorrowForecastKey(null);
      return;
    }

    const timeout = window.setTimeout(() => setSettledTomorrowForecastKey(tomorrowForecastKey), TOMORROW_FORECAST_THINKING_MS);
    return () => window.clearTimeout(timeout);
  }, [tomorrowForecastKey]);

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-display text-lg flex flex-wrap items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" /> Dự báo lượng khách — giải sắp tới
          <span className="inline-flex items-center gap-0.5 rounded-full border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[9px] text-warning">
            <FlaskConical className="h-2.5 w-2.5" /> Hypothesis · dự báo thống kê — chưa backtest đủ
          </span>
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Học từ các giải đã chạy của club, chỉ dùng thông tin biết-trước-giải. Khác với "gợi ý từ giải tương tự" ở
          Bước ⑥ — đây là mô hình hồi quy nhiều yếu tố. Cả hai đều KHÔNG phải cam kết.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {csvSelected ? "Nguồn: CSV đang chọn" : "Nguồn: giải trên VBacker"} · {events.length} giải trong phạm vi
        </p>
        {clubIds.length > 1 && (
          <label className="mt-2 flex max-w-sm flex-col gap-1 text-xs">
            Phạm vi dự báo
            <select className="h-8 rounded-md border bg-background px-2" value={club}
              onChange={event => setSelection({ sourceKey, club: event.target.value })}>
              <option value="">Chọn CLB hoặc danh mục</option>
              {clubIds.map(id => <option key={id} value={id}>CLB {id}</option>)}
              <option value="portfolio">Danh mục {clubIds.length} CLB</option>
            </select>
          </label>
        )}
        {clubIds.length === 1 && !csvSelected && <p className="text-xs text-muted-foreground">CLB {club}</p>}
        {!csvSelected && native.status === "unavailable" && <p role="alert" className="text-xs text-muted-foreground">{native.reason ?? "Chưa xác minh được nguồn giải."}</p>}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* LEFT — form + factor contributions */}
        <div className="space-y-3">
          <Card className="p-3 border-primary/30 space-y-2">
            <div className="text-[11px] font-medium">Thông số giải sắp tới</div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <label className="flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Ngày giải</span><Input type="date" className="h-8" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label className="flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Giờ bắt đầu</span><Input type="time" className="h-8" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></label>
              <label className="flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Buy-in (prize)</span><Input type="number" className="h-8" placeholder="vd 3000000" value={buyIn ?? ""} onChange={(e) => setBuyIn(numOrNull(e.target.value))} /></label>
              <label className="flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">GTD dự kiến</span><Input type="number" className="h-8" placeholder="(tùy chọn)" value={gtd ?? ""} onChange={(e) => setGtd(numOrNull(e.target.value))} /></label>
              <label className="col-span-2 flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Loại giải (vd Main, Turbo — auto từ tên nếu trống)</span><Input className="h-8" value={typeKeyword} onChange={(e) => setTypeKeyword(e.target.value)} /></label>
              {FEATURES.seriesCalendarFeatures && (
                <label className="col-span-2 flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Tên giải/thương hiệu (vd APT Main — để tính "kỳ thứ mấy", tùy chọn)</span><Input className="h-8" value={seriesName} onChange={(e) => setSeriesName(e.target.value)} /></label>
              )}
              {FEATURES.seriesCensoring && (
                <label className="col-span-2 flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Sức chứa phòng (số ghế tối đa — chặn trần dự báo, tùy chọn)</span><Input type="number" className="h-8" placeholder="vd 300" value={capacity ?? ""} onChange={(e) => setCapacity(numOrNull(e.target.value))} /></label>
              )}
              {FEATURES.seriesRivalClash && (
                <>
                  <label className="col-span-2 flex items-center gap-2 text-[11px]"><input type="checkbox" className="h-3.5 w-3.5 accent-[hsl(var(--warning))]" checked={rival} onChange={(e) => setRival(e.target.checked)} /><span>Đối thủ có giải lớn cùng ngày?</span></label>
                  {rival && (
                    <label className="col-span-2 flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">GTD đối thủ (nếu biết — tùy chọn)</span><Input type="number" className="h-8" placeholder="vd 500000000" value={rivalGtd ?? ""} onChange={(e) => setRivalGtd(numOrNull(e.target.value))} /></label>
                  )}
                </>
              )}
            </div>
          </Card>

          <Card className="p-3 border-border/60 space-y-1.5">
            <div className="text-[11px] font-medium">
              Yếu tố đóng góp dự đoán <span className="font-normal text-muted-foreground">(hiện khi đủ dữ liệu)</span>
            </div>
            {showCoef ? (
              <>
                <ul className="space-y-1">
                  {contributions.map((c) => (
                    <li key={c.feature} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-muted-foreground">{describeFeature(c.feature)}</span>
                      <span className={cn("tabular-nums font-medium", c.impactPct >= 0 ? "text-primary" : "text-destructive")}>
                        {c.impactPct >= 0 ? "+" : ""}{c.impactPct}%
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-warning/90">Điều chỉnh của model — tương quan, KHÔNG phải nhân quả.</p>
              </>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                Cần ≥ 8 giải đã chạy để model tách được từng yếu tố (thứ trong tuần, khung giờ, loại giải…).
              </p>
            )}
          </Card>
        </div>

        {/* RIGHT — the number (always with band + tier + error + disclaimer) */}
        <div>
          {!ready ? (
            <Card className="flex h-full min-h-[220px] items-center justify-center border-dashed border-border p-4 text-[11px] text-muted-foreground">
              Nhập ngày + buy-in giải sắp tới để xem dự báo.
            </Card>
          ) : !fc?.available ? (
            FEATURES.seriesInsufficientDataUx && honestResult ? (
              // A4b — honest unavailable / baseline_only (never a fabricated 0). Flag OFF ⇒ the existing
              // EmptyExplainer / warning branches below render byte-identically.
              <HonestForecastView result={honestResult} />
            ) : FEATURES.seriesEmptyExplainer ? (
              <EmptyExplainer
                tone="warning"
                className="h-full min-h-[220px]"
                what="Dự báo lượng khách cho giải sắp tới"
                why={fc?.missingDataNotes[0] ?? "chưa đủ giải trước đó cùng loại để mô hình học (cần ≥2 giải)."}
                how="Nạp thêm các giải đã chạy ở Bước ① — từ 2 giải có số; ≥8 giải mới đủ độ tin cao."
              />
            ) : (
              <Card className="flex h-full min-h-[220px] items-center justify-center border-dashed border-warning/40 bg-warning/5 p-4 text-[11px] text-warning">
                <span><AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> Cần thêm dữ liệu — {fc?.missingDataNotes[0] ?? "chưa đủ giải trước đó để dự báo."}</span>
              </Card>
            )
          ) : isThinkingAboutTomorrow ? (
            <Card className="flex h-full min-h-[220px] items-center justify-center border-primary/40 p-4">
              <VThinkingIndicator mode="tomorrow-attendance" />
            </Card>
          ) : (
            <Card className="gradient-card space-y-3 border-primary/40 p-4">
              <div className="text-center">
                <div className="text-[11px] text-muted-foreground">Dự đoán lượng khách</div>
                <div className="flex items-baseline justify-center gap-2">
                  <span className="font-display text-5xl tabular-nums text-primary">{override ?? fc.base}</span>
                  {override !== null && <span className="text-[10px] text-warning">(đã sửa tay)</span>}
                </div>
                <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                  khoảng {fc.low} – {fc.high} khách (p10–p90)
                </div>
                <span className={cn("mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px]", CONF[fc.confidence].cls)}>
                  Độ tin: {CONF[fc.confidence].label} · N={fc.sampleSize} giải
                </span>
                {tomorrowForecastKey !== null && (
                  <div className="mt-3 flex justify-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => setTomorrowForecastRunRevision((revision) => revision + 1)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      Dự báo lại ngày mai
                    </Button>
                  </div>
                )}
              </div>

              {/* TP5 — rival clash caution. The forecast number is NOT changed; this is a manual reminder that
                  the model hasn't learned rival-event competition (so it likely reads high on a clash day). */}
              {FEATURES.seriesRivalClash && rival && (
                <div className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  <span>
                    Có đối thủ lớn cùng ngày{rivalGtd ? ` (GTD ~${formatVndShort(rivalGtd)})` : ""} — dự báo dễ{" "}
                    <b>lệch xuống</b>, model chưa học yếu tố này. Con số <b>giữ nguyên</b>; đây là nhắc tay để cân nhắc
                    hạ GTD / đẩy vệ tinh.
                  </span>
                </div>
              )}

              {/* W5 — naive baseline: the plain "just average the last few" guess, next to the model */}
              {FEATURES.seriesNaiveBaseline && baseline && baseline.value !== null && (
                <div className="flex items-start gap-1.5 rounded-md border border-border/60 bg-card/40 p-2 text-[11px] text-muted-foreground">
                  <TrendingUp className="mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden />
                  <span>
                    Nếu chỉ lấy trung bình {baseline.count} giải{baseline.sameType ? ` ${baseline.typeLabel}` : ""} gần nhất:{" "}
                    <b className="text-foreground tabular-nums">{baseline.value} khách</b>
                    {baseVsModel !== null && (
                      <>
                        {" "}— model đang đoán{" "}
                        <b className={baseVsModel >= 0 ? "text-primary" : "text-warning"}>
                          {baseVsModel >= 0 ? "cao hơn" : "thấp hơn"} {Math.abs(baseVsModel)}%
                        </b>
                      </>
                    )}
                    . Hai số gần nhau là bình thường; lệch xa thì đọc kỹ yếu tố đóng góp bên dưới.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-border/60 bg-card/40 p-2 text-center">
                  <div className="font-display text-lg tabular-nums">{fc.modelMapePct !== null ? `${fc.modelMapePct}%` : "—"}</div>
                  <div className="text-[10px] text-muted-foreground">Sai số kiểm chứng (walk-forward CV)</div>
                  {fc.deltaVsBaselinePct !== null && (
                    <div className={cn("text-[10px]", fc.deltaVsBaselinePct > 0 ? "text-primary" : "text-warning")}>
                      {fc.deltaVsBaselinePct > 0 ? "tốt hơn" : "kém hơn"} baseline {Math.abs(fc.deltaVsBaselinePct)}%
                    </div>
                  )}
                </div>
                <div className="rounded-md border border-border/60 bg-card/40 p-2 text-center">
                  <div className="font-display text-lg tabular-nums">{fc.sampleSize}</div>
                  <div className="text-[10px] text-muted-foreground">Giải trước đó đã học</div>
                </div>
              </div>

              {/* A3 — Baseline Battery card (behind seriesBaselineBattery; OFF ⇒ not rendered ⇒ byte-identical) */}
              {FEATURES.seriesBaselineBattery && battery && (
                <BaselineBatteryCard battery={battery} modelBase={override ?? fc.base} modelMapePct={fc.modelMapePct} />
              )}

              <label className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
                Sửa đè con số (chủ club luôn quyết):
                <Input type="number" className="h-6 w-24" value={override ?? ""} placeholder={String(fc.base)} onChange={(e) => setOverride(numOrNull(e.target.value))} />
                {override !== null && (
                  <button type="button" className="text-primary underline" onClick={() => setOverride(null)}>dùng dự đoán</button>
                )}
              </label>

              <Button
                className="w-full gap-1.5"
                disabled={!feed || medianFee === null || gtd === null || gtd <= 0}
                onClick={() => onViewOverlayWithForecast?.()}
                title={gtd === null || gtd <= 0 ? "Nhập GTD dự kiến ở form bên trái trước" : undefined}
              >
                <ChevronRight className="h-4 w-4" /> Xem rủi ro overlay với dự đoán này
              </Button>
              {(gtd === null || gtd <= 0) && (
                <p className="text-center text-[10px] text-muted-foreground">Nhập GTD dự kiến để mở máy tính rủi ro overlay bên dưới.</p>
              )}
              {feed && (
                <p className="text-center text-[10px] text-muted-foreground/80">
                  {medianFee === null ? "Chưa đủ dữ liệu phí để mô phỏng overlay từ dự báo này."
                    : `Phí mô phỏng lấy trung vị của mẫu (${formatVndShort(medianFee)} — giả định).`}
                </p>
              )}

              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] leading-snug text-destructive/90">
                {fc.disclaimer}
              </div>
              <RegimeNotice />
              <ExplainHint term="sai số kiểm chứng (walk-forward)">
                Máy <b>thử đoán lại từng giải trong quá khứ</b> — mỗi lần CHỈ dùng các giải diễn ra trước nó — rồi chấm
                điểm đoán sai bao nhiêu %. "Baseline" = cách đoán ngây thơ nhất (lấy số giữa của các giải trước).
                Model chỉ đáng dùng khi thắng baseline bền vững.
              </ExplainHint>
              {fc.missingDataNotes.map((n, i) => (
                <p key={i} className="text-[10px] text-muted-foreground">• {n}</p>
              ))}
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}
