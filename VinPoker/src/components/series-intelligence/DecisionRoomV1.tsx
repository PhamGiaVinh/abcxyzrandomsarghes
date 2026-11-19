import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  DatabaseZap,
  FileClock,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatShortDate } from "@/lib/format";
import {
  createDecisionPacket,
  freezeDecisionPacket,
  getDecisionEventState,
  promoteNativeEventActual,
  reconcileEventActual,
  recordEventActual,
} from "@/lib/series-intelligence/decisionPacketRpc";
import type {
  DecisionEventStateActualRevision,
  DecisionEventStatePacket,
  DecisionEventStateResponse,
} from "@/lib/series-intelligence/decisionPacketRuntimeTypes";
import type {
  CountMetricInput,
  DecisionPacketHorizon,
  EventActualCreateRequestInput,
  EventActualMetrics,
  EventActualMetricsInput,
  MetricAvailability,
} from "@/lib/series-intelligence/decisionPacketV1";
import { useSeriesCapture } from "@/lib/series-intelligence/useSeriesCapture";

const HORIZONS: readonly DecisionPacketHorizon[] = ["T-21", "T-7", "T-1", "T-0"];

const BLOCK_REASON_LABELS: Record<string, string> = {
  packet_not_frozen: "Packet chưa được khóa",
  no_forecast: "Chưa có dự báo được gắn vào packet",
  manual_expectation_only: "Chỉ có kỳ vọng nhập tay",
  forecast_provenance_incomplete: "Dấu vết dự báo chưa đầy đủ",
  forecast_not_identity_eligible: "Dự báo chưa đủ điều kiện nhận diện",
  no_actual_revision: "Chưa có kết quả thật",
  actual_not_final: "Kết quả chưa phải bản cuối",
  actual_scope_mismatch: "Phạm vi kết quả không phải toàn giải",
  actual_metric_missing: "Thiếu chỉ số cần chấm",
  actual_conflict: "Kết quả đang xung đột",
  reconciliation_required: "Cần đối soát hai nguồn",
  stale_reconciliation: "Bản đối soát đã cũ",
  outcome_precedes_forecast: "Mốc thời gian kết quả không hợp lệ",
  target_metric_mismatch: "Chỉ số mục tiêu không khớp",
};

const METRIC_LABELS: Record<string, string> = {
  entries: "Entries",
  uniquePlayers: "Unique players",
  totalBullets: "Total bullets",
  reentries: "Re-entries",
  registrationRecords: "Registration records",
  paidPlaces: "Paid places",
  prizePool: "Prize pool",
  overlay: "Overlay",
};

function statusLabel(state: DecisionEventStateResponse["actualTruth"]["state"]): string {
  if (state === "current") return "Đang dùng";
  if (state === "needs_reconciliation") return "Cần đối soát";
  if (state === "conflict") return "Xung đột";
  return "Chưa có kết quả";
}

function packetLabel(packet: DecisionEventStatePacket): string {
  return `${packet.horizon} · ${packet.packetState === "frozen" ? "Đã khóa" : "Bản nháp"}`;
}

function formatMoney(amountMinor: string | null, currency: string | null, scale: number | null): string {
  if (amountMinor === null || currency === null || scale === null) return "Chưa có dữ liệu";
  const negative = amountMinor.startsWith("-");
  const digits = negative ? amountMinor.slice(1) : amountMinor;
  const padded = digits.padStart(scale + 1, "0");
  const split = scale === 0 ? padded : `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
  return `${negative ? "-" : ""}${split} ${currency}`;
}

function formatMetric(metric: { availability: MetricAvailability; value?: number | null; amountMinor?: string | null; currency?: string | null; scale?: number | null }): string {
  if (metric.availability === "missing") return "Chưa có dữ liệu";
  if (metric.availability === "uncertain") return "Chưa chắc chắn";
  if (metric.availability === "conflicting") return "Đang xung đột";
  if (metric.availability === "not_applicable") return "Không áp dụng";
  if ("amountMinor" in metric) return formatMoney(metric.amountMinor ?? null, metric.currency ?? null, metric.scale ?? null);
  return metric.value === null || metric.value === undefined ? "Chưa có dữ liệu" : metric.value.toLocaleString("vi-VN");
}

function emptyCount(): CountMetricInput {
  return { availability: "missing", value: null };
}

function emptyMetrics(entries: number): EventActualMetricsInput {
  const entryMetric: CountMetricInput = entries === 0
    ? { availability: "explicit_zero", value: 0 }
    : { availability: "present", value: entries };
  return {
    entries: entryMetric,
    uniquePlayers: emptyCount(),
    totalBullets: emptyCount(),
    reentries: emptyCount(),
    registrationRecords: emptyCount(),
    paidPlaces: emptyCount(),
    prizePool: { availability: "missing", amountMinor: null, currency: null, scale: null },
    overlay: { availability: "missing", amountMinor: null, currency: null, scale: null },
  };
}

type ReconciliationMode = "blocked_conflict" | "manual";

function manualResolutionFields(metrics: EventActualMetrics): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(metrics).map(([key, metric]) => [key, { ...metric, resolutionSource: "chose_manual" }]),
  );
}

function errorLabel(error: string): string {
  if (error === "backend_unavailable") return "Backend D2A/D2B chưa có trên môi trường này.";
  if (error === "malformed_response") return "Phản hồi backend không đúng contract; đã dừng và không hiển thị số liệu.";
  return "Không thực hiện được thao tác. Kiểm tra quyền owner và thử tải lại.";
}

function ActualMetrics({ revision }: { revision: DecisionEventStateActualRevision }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="decision-room-actual-metrics">
      {Object.entries(revision.metrics).map(([key, metric]) => (
        <div key={key} className="rounded-md border border-border/60 bg-muted/10 p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{METRIC_LABELS[key] ?? key}</p>
          <p className="mt-1 break-words text-sm font-medium">{formatMetric(metric)}</p>
        </div>
      ))}
    </div>
  );
}

function PacketList({
  packets,
  onCorrect,
}: {
  packets: readonly DecisionEventStatePacket[];
  onCorrect: (packet: DecisionEventStatePacket) => void;
}) {
  if (packets.length === 0) {
    return <p className="text-sm text-muted-foreground">Chưa có packet nào cho giải này.</p>;
  }
  const supersededPacketIds = new Set(
    packets
      .map((packet) => packet.supersedesPacketId)
      .filter((packetId): packetId is string => packetId !== null),
  );
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-testid="decision-room-packets">
      {packets.map((packet) => (
        <div key={packet.packetId} className="rounded-md border border-border/60 p-3" data-testid={`decision-room-packet-${packet.packetId}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{packetLabel(packet)}</span>
            <Badge variant={packet.packetState === "frozen" && !supersededPacketIds.has(packet.packetId) ? "default" : "outline"}>
              {supersededPacketIds.has(packet.packetId) ? "Đã được thay thế" : packet.packetState === "frozen" ? "Đang dùng" : "Bản nháp"}
            </Badge>
          </div>
          <dl className="mt-3 grid gap-2 text-xs text-muted-foreground">
            <div className="flex justify-between gap-3"><dt>Trạng thái dữ báo</dt><dd className="text-right text-foreground">{packet.forecastState}</dd></div>
            <div className="flex justify-between gap-3"><dt>Chỉ số</dt><dd className="text-right text-foreground">{packet.targetMetric}</dd></div>
            <div className="flex justify-between gap-3"><dt>Khóa lúc</dt><dd className="text-right text-foreground">{packet.frozenAt ? formatShortDate(packet.frozenAt) : "Chưa khóa"}</dd></div>
          </dl>
          {packet.packetState === "frozen" && !supersededPacketIds.has(packet.packetId) && (
            <Button
              className="mt-3 w-full sm:w-auto"
              data-testid="decision-room-correction"
              onClick={() => onCorrect(packet)}
              size="sm"
              variant="outline"
            >
              Tạo bản sửa
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

export function DecisionRoomV1() {
  const capture = useSeriesCapture();
  const [eventId, setEventId] = useState("");
  const [horizon, setHorizon] = useState<DecisionPacketHorizon>("T-7");
  const [decisionReason, setDecisionReason] = useState("");
  const [correctionSource, setCorrectionSource] = useState<DecisionEventStatePacket | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [actualEntries, setActualEntries] = useState("");
  const [reconciliationMode, setReconciliationMode] = useState<ReconciliationMode>("blocked_conflict");
  const [reconciliationReason, setReconciliationReason] = useState("");
  const [loadedState, setState] = useState<{
    request: { scope: string; sequence: number };
    value: DecisionEventStateResponse;
  } | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [loadingState, setLoadingState] = useState(false);
  const [saving, setSaving] = useState(false);
  const readScope = JSON.stringify([capture.clubId, eventId]);
  const readRequest = useRef({ scope: readScope, sequence: 0 });
  if (readRequest.current.scope !== readScope) readRequest.current = { scope: readScope, sequence: 0 };
  const state = loadedState?.request === readRequest.current ? loadedState.value : null;

  useEffect(() => {
    setEventId((current) => (capture.events.some((event) => event.id === current) ? current : capture.events[0]?.id ?? ""));
  }, [capture.events]);

  const selectedEvent = useMemo(
    () => capture.events.find((event) => event.id === eventId) ?? null,
    [capture.events, eventId],
  );

  const refreshState = async () => {
    const request = readRequest.current;
    if (request.scope !== readScope) return;
    const sequence = ++request.sequence;
    if (!eventId || !capture.clubId) {
      setState(null);
      setLoadingState(false);
      setStateError(null);
      return;
    }
    setLoadingState(true);
    setStateError(null);
    const result = await getDecisionEventState(eventId);
    if (readRequest.current !== request || request.sequence !== sequence) return;
    setLoadingState(false);
    if (result.ok === false) {
      setState(null);
      setStateError(result.error);
      return;
    }
    if (result.value.event.eventId !== eventId || result.value.event.clubId !== capture.clubId) {
      setState(null);
      setStateError("malformed_response");
      return;
    }
    setState({ request, value: result.value });
  };

  useEffect(() => {
    const request = readRequest.current;
    setCorrectionSource(null);
    setCorrectionReason("");
    setReconciliationMode("blocked_conflict");
    setReconciliationReason("");
    void refreshState();
    return () => { request.sequence += 1; };
    // Event selection is the deliberate refresh boundary; the button handles manual refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readScope]);

  const runMutation = async (action: () => Promise<{ readonly ok: boolean; readonly error?: string }>, message: string) => {
    setSaving(true);
    const result = await action();
    setSaving(false);
    if (result.ok === false) {
      toast.error(errorLabel(result.error ?? "rpc_error"));
      return false;
    }
    toast.success(message);
    await refreshState();
    return true;
  };

  const createPacket = async (sourcePacket: DecisionEventStatePacket | null = correctionSource) => {
    if (!selectedEvent?.start_time || !capture.clubId) {
      toast.error("Giải chưa có thời điểm bắt đầu hoặc chưa chọn CLB.");
      return;
    }
    const normalizedCorrectionReason = correctionReason.trim();
    if (sourcePacket && !normalizedCorrectionReason) {
      toast.error("Bản sửa phải có lý do.");
      return;
    }
    const asOf = new Date();
    const request = {
      eventId: selectedEvent.id,
      horizon: sourcePacket?.horizon ?? horizon,
      targetMetric: "entries" as const,
      asOfTs: asOf.toISOString(),
      sourceCutoff: new Date(asOf.getTime() - 1000).toISOString(),
      targetEventTs: new Date(selectedEvent.start_time).toISOString(),
      forecastSnapshotId: null,
      forecastState: "no_forecast_available" as const,
      manualExpectation: null,
      publicEvidence: [],
      registrationSlice: null,
      campaignSlice: null,
      knownInformation: {},
      recommendedAction: null,
      ownerDecision: null,
      publicAction: null,
      decisionReason: decisionReason.trim() || normalizedCorrectionReason || null,
      alternatives: [],
      assumptions: ["Decision Room V1 tạo packet không có dự báo khi chưa có snapshot đủ provenance."],
      uncertaintyNotes: "Chưa có forecast snapshot identity-eligible.",
      supersedesPacketId: sourcePacket?.packetId ?? null,
      correctionReason: sourcePacket ? normalizedCorrectionReason : null,
      idempotencyKey: sourcePacket
        ? `d2c:packet-correction:${sourcePacket.packetId}:${asOf.getTime()}`
        : `d2c:packet:${selectedEvent.id}:${horizon}:${asOf.getTime()}`,
    };
    const succeeded = await runMutation(
      () => createDecisionPacket(request),
      sourcePacket ? "Đã tạo bản nháp sửa; packet cũ vẫn được giữ nguyên." : "Đã tạo packet bản nháp.",
    );
    if (succeeded && sourcePacket) {
      setCorrectionSource(null);
      setCorrectionReason("");
    }
  };

  const freezePacket = async (packet: DecisionEventStatePacket) => {
    if (packet.packetState !== "draft") return;
    await runMutation(
      () => freezeDecisionPacket({ packetId: packet.packetId, expectedDraftVersion: 1 }),
      "Đã khóa packet. Nếu server có xung đột phiên bản, thao tác sẽ bị từ chối.",
    );
  };

  const recordActual = async () => {
    const entries = Number(actualEntries);
    if (!Number.isSafeInteger(entries) || entries < 0) {
      toast.error("Entries phải là số nguyên không âm.");
      return;
    }
    const request: EventActualCreateRequestInput = {
      eventId,
      scope: "event_total",
      finality: "final",
      sourceTimestampState: "not_reported",
      sourceTimestamp: null,
      metrics: emptyMetrics(entries),
      supersedesRevisionId: null,
      idempotencyKey: `d2c:actual:${eventId}:${Date.now()}`,
      correctionReason: null,
    };
    await runMutation(() => recordEventActual(request), "Đã ghi kết quả thật với các trường thiếu được giữ là thiếu.");
  };

  const submitReconciliation = async () => {
    const autoHead = state?.actualTruth.autoHead;
    const manualHead = state?.actualTruth.manualHead;
    const normalizedReason = reconciliationReason.trim();
    if (!autoHead || !manualHead || !normalizedReason) {
      toast.error("Đối soát phải có đủ hai nguồn và lý do.");
      return;
    }
    const resolution = reconciliationMode === "manual"
      ? { mode: "manual", fields: manualResolutionFields(manualHead.metrics) }
      : { mode: "blocked_conflict", blockReasons: ["owner_review_required"] };
    await runMutation(
      () => reconcileEventActual({
        autoRevisionId: autoHead.revisionId,
        manualRevisionId: manualHead.revisionId,
        resolution,
        reason: normalizedReason,
        idempotencyKey: `d2c:reconcile:${eventId}:${reconciliationMode}:${Date.now()}`,
      }),
      reconciliationMode === "manual"
        ? "Đã chọn nguồn manual làm kết quả đã đối soát."
        : "Đã ghi trạng thái xung đột để owner xem lại.",
    );
  };

  if (!capture.loading && capture.clubs.length === 0) {
    return <Card className="border-primary/30 p-5 text-sm text-muted-foreground">Bạn chưa sở hữu CLB nào để mở Decision Room.</Card>;
  }

  const actual = state?.actualTruth.chosenRevision;
  const draftPacket = state?.decisionPackets.find((packet) => packet.packetState === "draft");
  const canPromote = state?.actualTruth.state === "unavailable" && state.dataQuality.legacyActualCacheAvailable;
  const canReconcile = state?.actualTruth.state === "needs_reconciliation" && state.actualTruth.autoHead && state.actualTruth.manualHead;

  return (
    <div className="space-y-4" data-testid="decision-room-v1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
          Decision Room V1 · owner-scoped · contract-first
        </div>
        <Button variant="outline" size="sm" onClick={() => void refreshState()} disabled={loadingState || !eventId}>
          <RefreshCw className={loadingState ? "mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" : "mr-2 h-4 w-4"} />
          Tải lại trạng thái
        </Button>
      </div>

      <Card className="border-primary/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-xl"><DatabaseZap className="h-5 w-5 text-primary" /> Chọn giải</CardTitle>
          <CardDescription>Chỉ đọc dữ liệu theo CLB owner. Mọi ghi dữ liệu đi qua RPC có tên cố định và server kiểm quyền.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          {capture.clubs.length > 1 && (
            <Select value={capture.clubId ?? undefined} onValueChange={capture.setClubId}>
              <SelectTrigger aria-label="Chọn CLB"><SelectValue placeholder="Chọn CLB" /></SelectTrigger>
              <SelectContent>{capture.clubs.map((club) => <SelectItem key={club.id} value={club.id}>{club.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <Select key={eventId || "event-empty"} value={eventId || undefined} onValueChange={setEventId}>
            <SelectTrigger aria-label="Chọn giải"><SelectValue placeholder="Chọn giải" /></SelectTrigger>
            <SelectContent>{capture.events.map((event) => <SelectItem key={event.id} value={event.id}>{event.name}{event.start_time ? ` · ${formatShortDate(event.start_time)}` : ""}</SelectItem>)}</SelectContent>
          </Select>
        </CardContent>
      </Card>

      {stateError && (
        <Card className="border-destructive/50 bg-destructive/5 p-4" role="alert">
          <div className="flex gap-3"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" /><div><p className="font-medium">Không đọc được Decision Room</p><p className="mt-1 text-sm text-muted-foreground">{errorLabel(stateError)}</p></div></div>
        </Card>
      )}

      {!stateError && !state && loadingState && <Card className="p-5 text-sm text-muted-foreground">Đang đọc trạng thái packet và kết quả...</Card>}

      {state && selectedEvent && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Giải đang xem</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="font-medium">{selectedEvent.name}</p>
                <p className="text-muted-foreground">Trạng thái: <span className="text-foreground">{state.event.status}</span></p>
                <p className="text-muted-foreground">Ngày giải: <span className="text-foreground">{state.event.targetEventTs ? formatShortDate(state.event.targetEventTs) : "Chưa có"}</span></p>
              </CardContent>
            </Card>
            <Card data-testid="decision-room-truth">
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-primary" /> Kết quả thật</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Trạng thái</span><Badge variant={state.actualTruth.state === "current" ? "default" : "outline"}>{statusLabel(state.actualTruth.state)}</Badge></div>
                <p className="text-xs text-muted-foreground">{state.actualTruth.reason ?? "Chưa có kết quả được chọn làm sự thật hiện hành."}</p>
                {state.actualTruth.sourceState && <p className="text-xs text-muted-foreground">Nguồn: <span className="text-foreground">{state.actualTruth.sourceState}</span></p>}
              </CardContent>
            </Card>
            <Card data-testid="decision-room-scoring">
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-4 w-4 text-primary" /> Đủ điều kiện đối chiếu</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Badge variant={state.scoring.eligibility === "eligible" ? "default" : "outline"}>{state.scoring.eligibility === "eligible" ? "Đủ điều kiện" : "Đang chặn"}</Badge>
                <ul className="space-y-1 text-xs text-muted-foreground">{state.scoring.blockReasons.length === 0 ? <li>Không có lý do chặn.</li> : state.scoring.blockReasons.map((reason) => <li key={reason}>· {BLOCK_REASON_LABELS[reason] ?? reason}</li>)}</ul>
                <p className="border-t border-border/60 pt-2 text-[11px] text-muted-foreground">Room không tự tính điểm, không dự báo và không tạo quyết định tiền.</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><LockKeyhole className="h-4 w-4 text-primary" /> Decision packets</CardTitle><CardDescription>Packet là bản ghi append-only. Freeze chỉ khóa packet; không sửa lại lịch sử.</CardDescription></CardHeader>
            <CardContent className="space-y-4"><PacketList packets={state.decisionPackets} onCorrect={setCorrectionSource} />
               <div className="grid gap-3 border-t border-border/60 pt-4 md:grid-cols-[8rem_minmax(0,1fr)_auto]">
                 <Select value={horizon} onValueChange={(value) => setHorizon(value as DecisionPacketHorizon)}><SelectTrigger aria-label="Horizon"><SelectValue /></SelectTrigger><SelectContent>{HORIZONS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                 <Textarea value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} placeholder="Lý do quyết định (tuỳ chọn)" aria-label="Lý do quyết định" className="min-h-10" />
                 <Button data-testid="decision-room-create-packet" onClick={() => void createPacket()} disabled={saving || !selectedEvent.start_time || Boolean(correctionSource && !correctionReason.trim())}><FileClock className="mr-2 h-4 w-4" /> {correctionSource ? "Tạo bản sửa" : "Tạo bản nháp"}</Button>
               </div>
               {correctionSource && (
                 <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                   <p className="text-sm font-medium">Đang tạo bản sửa cho {correctionSource.horizon}. Packet đã khóa sẽ không bị sửa.</p>
                   <Textarea data-testid="decision-room-correction-reason" value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Lý do bản sửa (bắt buộc)" aria-label="Lý do bản sửa" className="min-h-16" />
                   <Button type="button" variant="ghost" size="sm" onClick={() => { setCorrectionSource(null); setCorrectionReason(""); }}>Hủy bản sửa</Button>
                 </div>
               )}
               {draftPacket && <Button variant="outline" onClick={() => void freezePacket(draftPacket)} disabled={saving}><LockKeyhole className="mr-2 h-4 w-4" /> Khóa packet bản nháp</Button>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-4 w-4 text-primary" /> Kết quả thật hiện hành</CardTitle><CardDescription>Thiếu vẫn là thiếu. Ghi entries không tự suy ra unique players, bullets, re-entry hay tiền.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {actual ? <ActualMetrics revision={actual} /> : <p className="text-sm text-muted-foreground">Chưa có bản ghi kết quả thật để hiển thị.</p>}
              <div className="grid gap-3 border-t border-border/60 pt-4 md:grid-cols-[minmax(0,14rem)_auto]">
                <Input inputMode="numeric" type="number" min={0} step={1} value={actualEntries} onChange={(event) => setActualEntries(event.target.value)} placeholder="Entries (nếu đã biết)" aria-label="Entries kết quả thật" />
                <Button variant="outline" onClick={() => void recordActual()} disabled={saving || !actualEntries || !eventId}><ClipboardCheck className="mr-2 h-4 w-4" /> Ghi kết quả thật</Button>
              </div>
              <p className="text-xs text-muted-foreground">Bản ghi manual V1 chưa có source timestamp sẽ không đủ điều kiện chấm forecast. Đây là chủ ý fail-closed.</p>
              {canPromote && <Button variant="outline" onClick={() => void runMutation(() => promoteNativeEventActual({ eventId, idempotencyKey: `d2c:native:${eventId}:${Date.now()}` }), "Đã yêu cầu đưa nguồn hệ thống vào D2B.")} disabled={saving}><DatabaseZap className="mr-2 h-4 w-4" /> Đưa nguồn hệ thống vào</Button>}
              {canReconcile && (
                <div className="space-y-2 border-t border-border/60 pt-4" data-testid="decision-room-reconciliation">
                  <p className="text-sm font-medium">Hai nguồn đang khác nhau. Chọn cách xử lý và ghi rõ lý do.</p>
                  <Select value={reconciliationMode} onValueChange={(value) => setReconciliationMode(value as ReconciliationMode)}>
                    <SelectTrigger aria-label="Cách đối soát"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="blocked_conflict">Giữ xung đột để owner xem lại</SelectItem>
                      <SelectItem value="manual">Chọn toàn bộ nguồn manual</SelectItem>
                    </SelectContent>
                  </Select>
                  <Textarea data-testid="decision-room-reconciliation-reason" value={reconciliationReason} onChange={(event) => setReconciliationReason(event.target.value)} placeholder="Lý do đối soát (bắt buộc)" aria-label="Lý do đối soát" className="min-h-16" />
                  <Button variant="outline" onClick={() => void submitReconciliation()} disabled={saving || !reconciliationReason.trim()}>
                    <AlertTriangle className="mr-2 h-4 w-4" /> {reconciliationMode === "manual" ? "Chọn nguồn manual" : "Ghi nhận xung đột"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-muted/10">
            <CardHeader className="pb-3"><CardTitle className="text-base">Data quality</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <p>Revision D2A: <strong>{state.dataQuality.d2aRevisionAvailable ? "Có" : "Chưa có"}</strong></p>
              <p>Legacy cache: <strong>{state.dataQuality.legacyActualCacheAvailable ? "Có, chưa tự promote" : "Không có"}</strong></p>
              <div><p className="text-muted-foreground">Trường thiếu</p><p>{state.dataQuality.missingFields.length ? state.dataQuality.missingFields.join(", ") : "Không ghi nhận"}</p></div>
              <div><p className="text-muted-foreground">Cảnh báo derivation</p><p>{state.dataQuality.unsupportedDerivationWarnings.length ? state.dataQuality.unsupportedDerivationWarnings.join(", ") : "Không ghi nhận"}</p></div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
