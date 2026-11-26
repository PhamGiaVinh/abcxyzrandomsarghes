import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, Sparkles, SlidersHorizontal, UserPlus, AlertTriangle, Undo2, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  buildSaveRunPayload,
  buildSchedulePng,
  buildWeeklySchedulePng,
  downloadDataUrl,
  generateDailyDraft,
  requirementFromTemplates,
  shiftDurationHours,
  chipStates,
  ctaFor,
  REJECTION_HINTS,
  parseRunParams,
  buildRunParamsExtra,
  validateFinalDesignations,
  stableParamsKey,
  EMPTY_RUN_PARAMS,
  type PlannerStep,
  type WeeklyImageInput,
} from "@/lib/shiftPlanner";
import { buildShiftGroups, weekDates, weekdayLabel } from "../shift-planner/ShiftPlanner.utils";
import type { DraftAssignment, FinalShortage, RejectionReason } from "@/types/shiftPlanner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useShiftPlanner } from "@/hooks/useShiftPlanner";
import { useScheduleRunStatus } from "@/hooks/useScheduleRunStatus";
import { useWeekTournaments } from "@/hooks/useWeekTournaments";
import { useDealerLinkStatus } from "@/hooks/useDealerLinkStatus";
import ShiftSummaryCards from "../shift-planner/ShiftSummaryCards";
import CoverageMiniStrip from "../shift-planner/CoverageMiniStrip";
import DailyShiftTable from "../shift-planner/DailyShiftTable";
import ShiftTemplateEditor from "../shift-planner/ShiftTemplateEditor";
import { PlannerFlowHeader } from "./PlannerFlowHeader";
import { WeekStrip } from "./WeekStrip";
import { DealerPickListDialog } from "./DealerPickListDialog";
import { RequestsActionPanel } from "./RequestsActionPanel";
import { DemandDialog } from "./DemandDialog";
import { PublishPanel, type DealerNotifyRow, type PublishStage } from "./PublishPanel";

type ClubRow = { id: string; name: string };

function todayInVN(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** Demo tour counts for mock mode so the week strip is previewable without DB. */
const MOCK_TOURS = [1, 2, 2, 2, 3, 2, 1];

const EMPTY_PARAMS_KEY = stableParamsKey(EMPTY_RUN_PARAMS);

/**
 * Dealer Shift Planner V2 — guided 4-step operator flow (owner-approved mockups,
 * 2026-07-02): week strip → 1 Tạo lịch → 2 Thêm thủ công (pick-from-list) →
 * 3 Rà soát (plain-VN warnings, undo) → 4 Phát hành & báo dealer (one action:
 * save + publish + Telegram + app, per-dealer delivery/confirm list) + image
 * exports + actionable dealer requests. Reuses the SAME RPCs/handlers as V1
 * (save_shift_run / publish_shift_run / send-shift-schedule) — layout and
 * guidance changed, no logic/RPC change. Rendered behind FEATURES.shiftPlannerV2.
 */
export default function ShiftPlannerV2Tab({
  clubIds,
  mode = "mock",
  autofillEnabled = false,
}: {
  clubIds: string[];
  clubs: ClubRow[];
  mode?: "mock" | "live";
  /** Show the "⚡ Tự động xếp" action (solver honours preferences + chia-final
   *  pins). Preview-gated by the parent; behind FEATURES.shiftPlannerAutofill. */
  autofillEnabled?: boolean;
}) {
  const [workDate, setWorkDate] = useState<string>(todayInVN());
  const [step, setStep] = useState<PlannerStep>(1);
  const [savedRunId, setSavedRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishStage, setPublishStage] = useState<PublishStage>("idle");
  const [overrides, setOverrides] = useState<DraftAssignment[] | null>(null);
  const [demandOverrides, setDemandOverrides] = useState<Record<string, number>>({});
  // "Chia final" pins per template for THIS day (persisted in run params).
  const [finalDesignations, setFinalDesignations] = useState<Record<string, string[]>>({});
  // Designees the last auto-fill run could not pin (on leave / already assigned…).
  const [finalShortages, setFinalShortages] = useState<FinalShortage[]>([]);
  const [reqOpen, setReqOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [pickTemplateId, setPickTemplateId] = useState<string | null>(null);
  const [demandOpen, setDemandOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [dmByDealer, setDmByDealer] = useState<Record<string, "sent" | "skipped">>({});

  const { data, loading, source, regenerate, refetch } = useShiftPlanner({ clubIds, workDate, mode });

  const clubId = clubIds[0] ?? null;
  const live = source === "live";
  const days = useMemo(() => weekDates(workDate), [workDate]);

  const runStatus = useScheduleRunStatus({ clubId, dates: days, enabled: live });
  const tourCountsLive = useWeekTournaments({ clubId, dates: days, enabled: live });
  const linkMapLive = useDealerLinkStatus({ clubIds, enabled: live });

  const tourCounts = useMemo(() => {
    if (live) return tourCountsLive;
    const m: Record<string, number> = {};
    days.forEach((d, i) => (m[d] = MOCK_TOURS[i] ?? 1));
    return m;
  }, [live, tourCountsLive, days]);

  // dealer_shift_* RPCs aren't in the generated types yet → untyped client (as V1).
  const rpc = supabase as unknown as {
    rpc: (fn: string, args: object) => Promise<{ data: any; error: { message?: string } | null }>;
  };

  // ── Draft derivation (demand overrides → local re-solve; manual overrides on top)
  const adjustedTemplates = useMemo(() => {
    if (!data) return [];
    if (Object.keys(demandOverrides).length === 0) return data.templates;
    return data.templates.map((t) => (demandOverrides[t.id] != null ? { ...t, needCount: demandOverrides[t.id] } : t));
  }, [data, demandOverrides]);

  const baseDraft = useMemo(() => {
    if (!data) return null;
    if (Object.keys(demandOverrides).length === 0) return data.draft;
    return generateDailyDraft({
      workDate,
      clubId: data.clubId,
      dealers: data.dealers,
      templates: adjustedTemplates,
      availability: data.availability,
      config: { ...data.config, requirementByHour: requirementFromTemplates(adjustedTemplates, data.config.tzOffsetMinutes) },
    });
  }, [data, demandOverrides, adjustedTemplates, workDate]);

  const effectiveDraft = useMemo(
    () => (baseDraft ? (overrides ? { ...baseDraft, assignments: overrides } : baseDraft) : null),
    [baseDraft, overrides]
  );
  const effAssignments = useMemo(() => effectiveDraft?.assignments ?? [], [effectiveDraft]);
  const assignedDealerIds = useMemo(() => new Set(effAssignments.map((a) => a.dealerId)), [effAssignments]);

  // Supply today (dealers who will actually work = active − on-leave) vs total
  // demand — surfaced on step 1 so the floor requests the right total (a dealer
  // fills at most one shift/day, so total demand is summed across windows).
  const supplyToday = useMemo(() => {
    if (!data) return { active: 0, off: 0, available: 0 };
    const off = new Set(data.availability.filter((a) => a.leaveRequested).map((a) => a.dealerId));
    const active = data.dealers.filter((d) => d.status === "active");
    const offActive = active.filter((d) => off.has(d.id)).length;
    return { active: active.length, off: offActive, available: active.length - offActive };
  }, [data]);
  const totalDemand = useMemo(() => adjustedTemplates.reduce((s, t) => s + t.needCount, 0), [adjustedTemplates]);

  // ── Chia-final validation inputs (effective need + day off-list + active roster)
  const needByTemplateEff = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of adjustedTemplates) m[t.id] = t.needCount;
    return m;
  }, [adjustedTemplates]);
  const offDealerIds = useMemo(
    () => new Set((data?.availability ?? []).filter((a) => a.leaveRequested).map((a) => a.dealerId)),
    [data]
  );
  const activeDealerIds = useMemo(
    () => new Set((data?.dealers ?? []).filter((d) => d.status === "active").map((d) => d.id)),
    [data]
  );
  const finalDesignationBlockers = useMemo(
    () =>
      validateFinalDesignations(finalDesignations, needByTemplateEff, offDealerIds, activeDealerIds).filter(
        (i) => i.kind === "over_cap" || i.kind === "unknown_dealer"
      ),
    [finalDesignations, needByTemplateEff, offDealerIds, activeDealerIds]
  );

  const publishedRun = runStatus.runsByDate[workDate]?.status === "published" ? runStatus.runsByDate[workDate] : null;
  const persistedToday = useMemo(() => runStatus.assignmentsByDate[workDate] ?? [], [runStatus.assignmentsByDate, workDate]);

  const shortage = useMemo(
    () => (effectiveDraft ? effectiveDraft.unfilled.reduce((s, u) => s + u.missing, 0) : 0),
    [effectiveDraft]
  );
  // Dirty vs a BASELINE key (not vs emptiness): after hydrating saved params the
  // screen must NOT claim "chưa lưu" — the baseline is set to the hydrated key.
  const paramsBaselineRef = useRef<string>(EMPTY_PARAMS_KEY);
  const paramsDirty = stableParamsKey({ demandOverrides, finalDesignations }) !== paramsBaselineRef.current;
  const dirty = (overrides !== null || paramsDirty) && savedRunId === null;
  const flags = {
    draftExists: effAssignments.length > 0,
    dirty,
    saved: savedRunId !== null,
    published: publishedRun !== null,
    shortage,
  };

  // ── Unsaved-changes protection: stash + beforeunload ─────────────────────────
  const stashKey = `spv2:${clubId ?? "c"}:${workDate}`;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    try {
      if (overrides !== null && savedRunId === null) sessionStorage.setItem(stashKey, JSON.stringify(overrides));
      else sessionStorage.removeItem(stashKey);
    } catch { /* storage unavailable — guard is best-effort */ }
  }, [overrides, savedRunId, stashKey]);

  const restoredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!data || overrides !== null || restoredRef.current === stashKey) return;
    restoredRef.current = stashKey;
    try {
      const raw = sessionStorage.getItem(stashKey);
      if (raw) {
        const parsed = JSON.parse(raw) as DraftAssignment[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setOverrides(parsed);
          setStep(3);
          toast.info("Đã khôi phục thay đổi chưa lưu của ngày này");
        }
      }
    } catch { /* ignore malformed stash */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, stashKey]);

  // ── Hydrate saved run params (demand + chia-final pins) once per club+date ────
  // Without this, a designation saved the night before vanished on reload: params
  // were written by save_shift_run but never read back. Mirrors the restoredRef
  // pattern above. Never clobbers unsaved in-session edits (dirtyRef guard), and
  // post-save refetches can't re-hydrate (key already marked).
  const hydratedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!live) return;
    if (runStatus.loading) return; // wait for the week fetch — "no run" vs "not loaded yet"
    const key = `${clubId ?? "c"}:${workDate}`;
    if (hydratedKeyRef.current === key) return;
    hydratedKeyRef.current = key;
    const run = runStatus.runsByDate[workDate];
    if (!run?.params) {
      paramsBaselineRef.current = EMPTY_PARAMS_KEY;
      return;
    }
    if (dirtyRef.current) return; // user already editing this day — keep their state
    const parsed = parseRunParams(run.params);
    // Stale/unknown dealer ids are kept intentionally — DemandDialog shows them in
    // red and Apply/Save stay blocked until the floor unpins them (no silent drop).
    setDemandOverrides(parsed.demandOverrides);
    setFinalDesignations(parsed.finalDesignations);
    paramsBaselineRef.current = stableParamsKey(parsed); // hydrated state = saved state, not dirty
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, clubId, workDate, runStatus.loading, runStatus.runsByDate]);

  // ── Date navigation (with unsaved confirm) ────────────────────────────────────
  const resetForDate = (d: string) => {
    setWorkDate(d || todayInVN());
    setSavedRunId(null);
    setOverrides(null);
    setDemandOverrides({});
    setFinalDesignations({});
    setFinalShortages([]);
    paramsBaselineRef.current = EMPTY_PARAMS_KEY; // hydration re-baselines if the new day has a run
    setDmByDealer({});
    setPublishStage("idle");
    setStep(1);
  };
  const requestDateChange = (d: string) => {
    if (!d || d === workDate) return;
    if (dirtyRef.current) setPendingDate(d);
    else resetForDate(d);
  };

  // ── Draft edit handlers ───────────────────────────────────────────────────────
  const handleAddAssignment = (a: DraftAssignment) => {
    setOverrides((prev) => [...(prev ?? baseDraft?.assignments ?? []), a]);
    setSavedRunId(null);
  };
  const handleRemoveAssignment = (templateId: string, dealerId: string) => {
    const list = overrides ?? baseDraft?.assignments ?? [];
    const removed = list.find((x) => x.templateId === templateId && x.dealerId === dealerId);
    setOverrides(list.filter((x) => !(x.templateId === templateId && x.dealerId === dealerId)));
    setSavedRunId(null);
    if (removed) {
      toast(`Đã xoá ${removed.dealerName} khỏi ca ${removed.templateLabel}`, {
        action: { label: "Hoàn tác", onClick: () => setOverrides((prev) => [...(prev ?? []), removed]) },
        icon: <Undo2 className="h-4 w-4" />,
      });
    }
  };
  const handleRegenerate = () => {
    setOverrides(null);
    setSavedRunId(null);
    regenerate();
    toast.success("Đã tạo lại bản nháp AI");
    setStep(2);
  };

  const approveIntoShift = useCallback(
    (dealerId: string, templateId: string): boolean => {
      const dealer = data?.dealers.find((d) => d.id === dealerId);
      const tpl = adjustedTemplates.find((t) => t.id === templateId);
      if (!dealer || !tpl) {
        toast.error("Không tìm thấy dealer/khung ca cho yêu cầu này.");
        return false;
      }
      handleAddAssignment({
        templateId: tpl.id,
        templateLabel: tpl.label,
        dealerId: dealer.id,
        dealerName: dealer.fullName,
        workDate,
        scheduledStartAt: tpl.startAt,
        scheduledEndAt: tpl.endAt,
        durationHours: Math.round(shiftDurationHours(tpl.startAt, tpl.endAt) * 10) / 10,
        role: "Dealer",
        status: "draft",
        score: 0,
        scoreBreakdown: [],
        reasons: ["Duyệt yêu cầu xin ca"],
        isNightShift: false,
      });
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, adjustedTemplates, workDate, baseDraft, overrides]
  );

  // Inline per-shift demand stepper (Bước 1) — set "số người cần" for a template
  // directly on the create screen (matches the approved mockup B1). Editing demand
  // invalidates the current working draft, same as the DemandDialog "Áp dụng".
  const bumpNeed = (templateId: string, base: number, delta: number) => {
    setDemandOverrides((p) => {
      const cur = p[templateId] ?? base;
      return { ...p, [templateId]: Math.max(0, Math.min(30, cur + delta)) };
    });
    setOverrides(null);
    setSavedRunId(null);
    setFinalShortages([]);
  };

  // ── Auto-fill ("⚡ Tự động xếp", Patch 3) ────────────────────────────────────
  // Re-solve honouring per-dealer shift_preference + the floor's chia-final pins,
  // keeping any manual edits (gap-fill, idempotent). Result becomes the working
  // draft (overrides); unfillable designees surface in a shortage panel.
  const handleAutofill = () => {
    if (!data) return;
    const result = generateDailyDraft({
      workDate,
      clubId: data.clubId,
      dealers: data.dealers,
      templates: adjustedTemplates,
      availability: data.availability,
      config: {
        ...data.config,
        requirementByHour: requirementFromTemplates(adjustedTemplates, data.config.tzOffsetMinutes),
        applyShiftPreference: true,
      },
      finalDesignations,
      keepAssignments: overrides ?? [],
    });
    setOverrides(result.assignments);
    setFinalShortages(result.finalShortages ?? []);
    setSavedRunId(null);
    setStep(3);
    const pinned = result.assignments.filter((a) => a.finalDesignated).length;
    const short = result.finalShortages?.length ?? 0;
    toast.success(
      `Đã tự động xếp ${result.assignments.length} ca` +
        (pinned ? ` · ${pinned} chia final` : "") +
        (short ? ` · ⚠ ${short} thiếu người chia final` : "")
    );
  };

  // ── Persistence (same RPCs as V1) ─────────────────────────────────────────────
  const persistDraft = async (): Promise<string | null> => {
    if (!data || !effectiveDraft || !clubId) return null;
    // P0: never persist invalid pins — over-cap or a dealer no longer in the roster.
    if (finalDesignationBlockers.length > 0) {
      toast.error(
        "Chỉ định chia final chưa hợp lệ — mở '✎ Sửa nhu cầu' để bỏ bớt dealer (quá số cần hoặc dealer không còn hoạt động)."
      );
      return null;
    }
    const extra = buildRunParamsExtra({ demandOverrides, finalDesignations });
    const { data: res, error } = await rpc.rpc("save_shift_run", buildSaveRunPayload(clubId, workDate, effectiveDraft, extra));
    if (error) {
      if (String(error.message ?? "").includes("published_schedule_exists")) {
        toast.error("Lịch ngày này đã phát hành — không thể ghi đè.");
        runStatus.refetch();
      } else {
        toast.error(error.message ?? "Lưu nháp thất bại");
      }
      return null;
    }
    const runId = (res?.run_id as string) ?? null;
    setSavedRunId(runId);
    // Saved state becomes the new baseline — the day is no longer params-dirty.
    paramsBaselineRef.current = stableParamsKey({ demandOverrides, finalDesignations });
    try { sessionStorage.removeItem(stashKey); } catch { /* best-effort */ }
    return runId;
  };

  const handleSave = async (): Promise<boolean> => {
    if (!live) {
      toast.info("Chế độ demo — lưu/phát hành chạy ở chế độ live.");
      return false;
    }
    setBusy(true);
    try {
      const runId = await persistDraft();
      if (runId) {
        toast.success(`Đã lưu nháp (${effAssignments.length} ca)`);
        runStatus.refetch();
        return true;
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  const dateLabel = useMemo(
    () =>
      new Date(`${workDate}T00:00:00+07:00`).toLocaleDateString("vi-VN", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "Asia/Ho_Chi_Minh",
      }),
    [workDate]
  );

  const buildDayPng = async (): Promise<string | null> => {
    if (!data || effAssignments.length === 0) return null;
    const dealersById = new Map(data.dealers.map((d) => [d.id, d]));
    const groups = buildShiftGroups(adjustedTemplates, effAssignments).map((g) => ({
      label: g.template.label,
      window: `${g.template.startAt.slice(11, 16)} – ${g.template.endAt.slice(11, 16)}`,
      need: g.template.needCount,
      rows: g.assignments.map((a) => ({
        name: a.dealerName,
        role: a.role,
        skills: dealersById.get(a.dealerId)?.skills ?? [],
      })),
    }));
    return buildSchedulePng({ title: `Lịch dealer · ${dateLabel}`, subtitle: `${effAssignments.length} ca`, groups });
  };

  const sendTelegram = async (): Promise<boolean> => {
    if (!data || !clubId) return false;
    const png = await buildDayPng();
    if (!png) {
      toast.error("Không tạo được ảnh lịch để gửi");
      return false;
    }
    const recipients = effAssignments.map((a) => ({
      dealer_id: a.dealerId,
      shift_label: `${a.templateLabel} (${a.scheduledStartAt.slice(11, 16)}–${a.scheduledEndAt.slice(11, 16)})`,
    }));
    const { data: res, error } = await supabase.functions.invoke("send-shift-schedule", {
      body: {
        club_id: clubId,
        work_date: workDate,
        caption_title: `🗓️ Lịch dealer ngày ${workDate}`,
        image_base64: png,
        recipients,
      },
    });
    if (error) return false;
    const r = res as { group_sent?: boolean; group_configured?: boolean; dm_sent?: number; dm_skipped?: number } | null;
    // Per-dealer DM approximation until the edge fn returns dm_results (planned):
    // the edge only skips unlinked dealers, so linked → sent, unlinked → skipped.
    const dm: Record<string, "sent" | "skipped"> = {};
    for (const a of effAssignments) {
      const linked = live ? linkMapLive[a.dealerId]?.telegramLinked : true;
      dm[a.dealerId] = linked === false ? "skipped" : "sent";
    }
    setDmByDealer(dm);
    const groupTxt = r?.group_sent ? "nhóm ✓" : r?.group_configured ? "nhóm lỗi" : "nhóm chưa cấu hình";
    toast.success(`Đã báo dealer — ${groupTxt}, DM ${r?.dm_sent ?? 0} người${r?.dm_skipped ? `, bỏ qua ${r.dm_skipped}` : ""}`);
    return true;
  };

  const publishAndNotify = async () => {
    if (!live) {
      toast.info("Chế độ demo — phát hành chạy ở chế độ live.");
      return;
    }
    if (effAssignments.length === 0) {
      toast.error("Chưa có ca nào để phát hành");
      return;
    }
    setBusy(true);
    setStep(4);
    try {
      setPublishStage("saving");
      const runId = savedRunId ?? (await persistDraft());
      if (!runId) {
        setPublishStage("idle");
        return;
      }
      setPublishStage("publishing");
      const { error } = await rpc.rpc("publish_shift_run", { p_run_id: runId });
      if (error) {
        toast.error(error.message ?? "Phát hành thất bại");
        setPublishStage("idle");
        return;
      }
      setPublishStage("telegram");
      const ok = await sendTelegram();
      setPublishStage(ok ? "done" : "telegram_failed");
      if (!ok) toast.error("Đã phát hành nhưng gửi Telegram lỗi — bấm 'Gửi lại Telegram'.");
      refetch();
      runStatus.refetch();
    } finally {
      setBusy(false);
    }
  };

  const retryTelegram = async () => {
    setBusy(true);
    try {
      const ok = await sendTelegram();
      setPublishStage(ok ? "done" : "telegram_failed");
    } finally {
      setBusy(false);
    }
  };

  // ── Image exports ─────────────────────────────────────────────────────────────
  const exportDay = async () => {
    setExporting(true);
    try {
      const png = await buildDayPng();
      if (!png) {
        toast.error("Chưa có ca nào để xuất");
        return;
      }
      downloadDataUrl(`lich-ngay-${workDate}.png`, png);
      toast.success("Đã tải ảnh lịch ngày");
    } catch {
      toast.error("Không tạo được ảnh");
    } finally {
      setExporting(false);
    }
  };

  const buildWeekInput = (): WeeklyImageInput | null => {
    if (!data) return null;
    const dealerName = (id: string) => data.dealers.find((d) => d.id === id)?.fullName ?? id;
    const dayHeads = days.map((d, i) => `${weekdayLabel(i)} ${d.slice(8, 10)}/${d.slice(5, 7)}`);
    let totalShifts = 0;
    let totalHours = 0;
    const rows = [...adjustedTemplates]
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
      .map((t) => ({
        label: t.label,
        window: `${t.startAt.slice(11, 16)} – ${t.endAt.slice(11, 16)}`,
        cells: days.map((d) => {
          const persisted = (runStatus.assignmentsByDate[d] ?? []).filter((a) => a.templateId === t.id);
          const names =
            d === workDate
              ? effAssignments.filter((a) => a.templateId === t.id).map((a) => a.dealerName)
              : persisted.map((a) => dealerName(a.dealerId));
          totalShifts += names.length;
          totalHours += names.length * shiftDurationHours(t.startAt, t.endAt);
          return { names };
        }),
      }));
    const weekLabel = `${days[0].slice(8, 10)}/${days[0].slice(5, 7)} – ${days[6].slice(8, 10)}/${days[6].slice(5, 7)}`;
    return {
      title: `Lịch dealer · Tuần ${weekLabel}`,
      subtitle: `${totalShifts} ca · ${Math.round(totalHours)} giờ`,
      days: dayHeads,
      rows,
    };
  };

  const exportWeek = async () => {
    setExporting(true);
    try {
      const input = buildWeekInput();
      if (!input) return;
      const png = await buildWeeklySchedulePng(input);
      downloadDataUrl(`lich-tuan-${days[0]}--${days[6]}.png`, png);
      toast.success("Đã tải ảnh lịch tuần");
    } catch {
      toast.error("Không tạo được ảnh tuần");
    } finally {
      setExporting(false);
    }
  };

  const sendWeekTelegram = async () => {
    if (!live || !clubId) {
      toast.info("Chế độ demo — gửi Telegram chạy ở chế độ live.");
      return;
    }
    setExporting(true);
    try {
      const input = buildWeekInput();
      if (!input) return;
      const png = await buildWeeklySchedulePng(input);
      const { error } = await supabase.functions.invoke("send-shift-schedule", {
        body: {
          club_id: clubId,
          work_date: workDate,
          caption_title: `🗓️ ${input.title}`,
          image_base64: png,
          recipients: [], // group broadcast only — no per-dealer DMs for the week grid
        },
      });
      if (error) toast.error("Gửi ảnh tuần thất bại");
      else toast.success("Đã gửi ảnh tuần lên nhóm Telegram");
    } catch {
      toast.error("Không tạo được ảnh tuần");
    } finally {
      setExporting(false);
    }
  };

  // ── Step 4 per-dealer rows ────────────────────────────────────────────────────
  const finalDealerSet = useMemo(() => new Set(Object.values(finalDesignations).flat()), [finalDesignations]);
  const notifyRows: DealerNotifyRow[] = useMemo(() => {
    if (!data) return [];
    const persistedByDealer = new Map(persistedToday.map((p) => [p.dealerId, p]));
    const src = publishedRun && persistedToday.length > 0 && effAssignments.length === 0
      ? persistedToday.map((p) => ({
          dealerId: p.dealerId,
          name: data.dealers.find((d) => d.id === p.dealerId)?.fullName ?? p.dealerId,
          label: `${p.scheduledStartAt.slice(11, 16)}–${p.scheduledEndAt.slice(11, 16)}`,
        }))
      : effAssignments.map((a) => ({ dealerId: a.dealerId, name: a.dealerName, label: a.templateLabel }));
    return src.map((s) => {
      const link = live ? linkMapLive[s.dealerId] : null;
      return {
        dealerId: s.dealerId,
        name: s.name,
        shiftLabel: s.label,
        telegramLinked: live ? (link ? link.telegramLinked : null) : true,
        appLinked: live ? (link ? link.appLinked : null) : true,
        dm: dmByDealer[s.dealerId] ?? null,
        status: persistedByDealer.get(s.dealerId)?.status ?? null,
        finalDesignated: finalDealerSet.has(s.dealerId),
      };
    });
  }, [data, effAssignments, persistedToday, publishedRun, live, linkMapLive, dmByDealer, finalDealerSet]);

  // ── CTA wiring ────────────────────────────────────────────────────────────────
  const cta = ctaFor(step, flags);
  const onCta = () => {
    switch (cta.action) {
      case "generate":
        handleRegenerate();
        break;
      case "goManual":
        setStep(2);
        break;
      case "goReview":
        setStep(3);
        break;
      case "save":
        void handleSave().then((ok) => ok && setStep(4));
        break;
      case "publish":
        void publishAndNotify();
        break;
    }
  };

  const freeDealers = useMemo(
    () => (data ? data.dealers.filter((d) => d.status === "active" && !assignedDealerIds.has(d.id)).slice(0, 8) : []),
    [data, assignedDealerIds]
  );

  const assignmentCountByDate = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of days) m[d] = (runStatus.assignmentsByDate[d] ?? []).length;
    return m;
  }, [days, runStatus.assignmentsByDate]);

  const openPickFor = (templateId: string | null) => {
    setPickTemplateId(templateId ?? adjustedTemplates[0]?.id ?? null);
    setPickOpen(true);
  };

  const readOnly = publishedRun !== null;

  // ═════════════════════════════ render ═════════════════════════════
  return (
    <div className="space-y-3">
      {/* Title + date */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <CalendarRange className="h-5 w-5 text-primary" /> Xếp lịch dealer
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{dateLabel}</span>
            {source === "mock" && (
              <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] text-warning">
                Dữ liệu demo
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={workDate} onChange={(e) => requestDateChange(e.target.value)} className="h-9 w-[150px]" />
          {live && (
            <Button variant="outline" size="sm" className="h-9" onClick={() => setEditorOpen(true)}>
              <SlidersHorizontal className="mr-1.5 h-4 w-4" /> Thêm / quản lý ca
            </Button>
          )}
        </div>
      </div>

      {/* Week strip */}
      <WeekStrip
        workDate={workDate}
        runsByDate={runStatus.runsByDate}
        assignmentCountByDate={assignmentCountByDate}
        tourCountByDate={tourCounts}
        onSelectDate={requestDateChange}
      />

      {/* 4-step flow header */}
      <PlannerFlowHeader
        step={step}
        states={chipStates(step, flags)}
        cta={cta}
        busy={busy}
        dirtyChip={
          readOnly
            ? null
            : dirty
              ? { label: "● Chưa lưu", tone: "warn" }
              : savedRunId
                ? { label: "✓ Đã lưu nháp", tone: "ok" }
                : null
        }
        requestCount={data?.availability.filter((a) => (a.status ?? "submitted") === "submitted").length ?? 0}
        onStepClick={(s) => !readOnly && setStep(s)}
        onCta={onCta}
        onToggleRequests={() => setReqOpen((v) => !v)}
      />

      {/* Chia-final shortages from the last ⚡ auto-fill run (never auto-substituted) */}
      {finalShortages.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5 p-3">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4" /> Thiếu người chia final ({finalShortages.length})
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Dealer được chỉ định chia final nhưng không xếp được — hệ thống KHÔNG tự thay người khác. Đổi người ở "✎ Sửa nhu cầu" hoặc chấp nhận.
          </p>
          <ul className="mt-1.5 space-y-1">
            {finalShortages.map((s, i) => (
              <li key={`${s.templateId}-${s.dealerId}-${i}`} className="flex flex-wrap items-center gap-1.5 text-[12px]">
                <span className="rounded border border-border px-1.5 py-0 text-[10px] text-muted-foreground">{s.templateLabel}</span>
                <span className="font-medium text-foreground">{s.dealerName}</span>
                <span className="text-destructive">— {s.detail}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {loading || !data || !effectiveDraft ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        <>
          {/* Requests panel (toggled) */}
          {reqOpen && (
            <Card className="border-[hsl(var(--ds-active)_/_0.35)] p-4">
              <div className="mb-2 text-sm font-semibold">
                Yêu cầu từ Dealer App{" "}
                <span className="text-[11px] font-normal text-muted-foreground">
                  — duyệt & xếp vào ca trong 1 chạm; dealer thấy kết quả khi phát hành
                </span>
              </div>
              <RequestsActionPanel
                availability={data.availability}
                templates={adjustedTemplates}
                dealers={data.dealers}
                clubId={clubId}
                workDate={workDate}
                live={live}
                assignedDealerIds={assignedDealerIds}
                onApproveIntoShift={approveIntoShift}
                onDecided={() => { refetch(); runStatus.refetch(); }}
              />
            </Card>
          )}

          {/* Published banner + read-only view */}
          {readOnly ? (
            <>
              <Card className="border-success/40 bg-success/5 p-4">
                <div className="text-sm font-semibold text-success">
                  ✅ Lịch {dateLabel} đã phát hành
                  {publishedRun?.publishedAt
                    ? ` lúc ${new Date(publishedRun.publishedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" })}`
                    : ""}{" "}
                  — đã khoá
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Dealer Control mở tab này là thấy cùng lịch (tự đồng bộ). Muốn sửa lịch đã phát hành? Tính năng đang được bổ sung.
                </p>
              </Card>
              <PublishPanel
                assignments={effAssignments}
                publishedAt={publishedRun?.publishedAt ?? null}
                stage={publishStage}
                rows={notifyRows}
                botUsername={null}
                onRetryTelegram={() => void retryTelegram()}
                onExportDay={() => void exportDay()}
                onExportWeek={() => void exportWeek()}
                onSendWeekTelegram={() => void sendWeekTelegram()}
                exporting={exporting}
              />
            </>
          ) : (
            <>
              {/* Step 1 — Tạo lịch */}
              {step === 1 && (
                <Card className="p-6 text-center">
                  <div className="text-sm font-semibold">
                    {flags.draftExists ? `Đã có nháp ${effAssignments.length} ca cho ngày này` : `${dateLabel} chưa có lịch`}
                  </div>
                  <div className="mt-1 text-[12px] text-muted-foreground">
                    {tourCounts[workDate] != null && <>{tourCounts[workDate]} tour trong ngày · </>}
                    <b className="text-foreground">{supplyToday.available}</b> dealer sẽ đi làm
                    <span className="text-[11px]"> ({supplyToday.active} hoạt động − {supplyToday.off} xin nghỉ)</span>
                  </div>
                  <div className="mt-4 mx-auto max-w-md space-y-1.5 text-left">
                    <div className="text-center text-[11px] font-semibold text-muted-foreground">
                      Số người cần cho mỗi ca
                    </div>
                    {adjustedTemplates.map((t) => {
                      const base = data.templates.find((x) => x.id === t.id)?.needCount ?? t.needCount;
                      const finalN = finalDesignations[t.id]?.length ?? 0;
                      return (
                        <div key={t.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
                          <span className="flex-1 truncate text-[12px] font-medium text-foreground">{t.label}</span>
                          {finalN > 0 && <span className="text-[10px] text-primary">📌 {finalN} chia final</span>}
                          <div className="flex items-center overflow-hidden rounded-md border border-border">
                            <button type="button" aria-label="Bớt người" onClick={() => bumpNeed(t.id, base, -1)} className="h-7 w-7 text-base font-bold text-primary hover:bg-primary/10">−</button>
                            <span className="w-9 text-center font-mono text-[13px] tabular-nums text-foreground">{t.needCount}</span>
                            <button type="button" aria-label="Thêm người" onClick={() => bumpNeed(t.id, base, 1)} className="h-7 w-7 text-base font-bold text-primary hover:bg-primary/10">+</button>
                          </div>
                        </div>
                      );
                    })}
                    <div className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-[12px] ${totalDemand > supplyToday.available ? "bg-destructive/10 text-destructive" : "bg-muted/40 text-muted-foreground"}`}>
                      <span>Tổng nhu cầu đang nhập</span>
                      <span className="font-bold">
                        {totalDemand} lượt{totalDemand > supplyToday.available ? ` · vượt quân số (${supplyToday.available})` : ` / ${supplyToday.available} dealer`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDemandOpen(true)}
                      className="w-full pt-0.5 text-[11px] text-primary hover:underline"
                    >
                      📌 Chỉ định dealer chia final / sửa chi tiết
                    </button>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    {autofillEnabled && (
                      <Button onClick={handleAutofill} className="bg-primary text-primary-foreground hover:bg-primary/90">
                        <Zap className="mr-1.5 h-4 w-4" /> Tự động xếp
                      </Button>
                    )}
                    <Button onClick={handleRegenerate} variant={autofillEnabled ? "outline" : "default"}>
                      <Sparkles className="mr-1.5 h-4 w-4" /> {flags.draftExists ? "Tạo lại nháp AI" : "Tạo nháp AI — xếp tự động"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setOverrides(overrides ?? baseDraft?.assignments ?? []);
                        setStep(2);
                      }}
                    >
                      <UserPlus className="mr-1.5 h-4 w-4" /> Xếp tay từ đầu
                    </Button>
                  </div>
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    {autofillEnabled
                      ? "⚡ Tự động xếp: theo ca ưa thích của dealer + giữ người chia final đã chỉ định, đắp phần thiếu (giữ nguyên chỉnh tay)."
                      : "AI xếp theo: đăng ký rảnh · giờ nghỉ giữa ca · giới hạn giờ/tuần · công bằng ca đêm"}
                  </p>
                </Card>
              )}

              {/* Step 2 — Thêm thủ công */}
              {step === 2 && (
                <>
                  <Card className="border-[hsl(var(--ds-preassign)_/_0.35)] p-3">
                    <div className="text-[12.5px]">
                      <b>Bước 2 · Thêm thủ công</b>{" "}
                      <span className="text-muted-foreground">
                        — bấm "Thêm dealer" ở khung ca, hoặc mở 🔔 Yêu cầu để duyệt người xin ca
                      </span>
                    </div>
                    {freeDealers.length > 0 && (
                      <div className="mt-1.5 text-[11px] text-muted-foreground">
                        Dealer chưa có ca hôm nay:{" "}
                        <b className="text-foreground">{freeDealers.map((d) => d.fullName).join(" · ")}</b>
                      </div>
                    )}
                  </Card>
                  <DailyShiftTable
                    templates={adjustedTemplates}
                    assignments={effAssignments}
                    dealers={data.dealers}
                    onRemove={handleRemoveAssignment}
                    onAddToTemplate={openPickFor}
                  />
                </>
              )}

              {/* Step 3 — Rà soát */}
              {step === 3 && (
                <>
                  <ShiftSummaryCards templates={adjustedTemplates} availability={data.availability} draft={effectiveDraft} />
                  {effectiveDraft.unfilled.length > 0 ? (
                    <Card className="border-warning/40 bg-warning/5 p-4">
                      {effectiveDraft.unfilled.map((u) => (
                        <div key={u.templateId} className="flex flex-wrap items-center gap-2 py-1">
                          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                          <span className="text-[12.5px] font-semibold text-warning">
                            Thiếu {u.missing} dealer · khung {u.templateLabel}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{u.detail}</span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 border-warning/50 px-2 text-[11px] text-warning hover:bg-warning/10"
                            onClick={() => openPickFor(u.templateId)}
                          >
                            ＋ Thêm vào khung này
                          </Button>
                        </div>
                      ))}
                      {effectiveDraft.rejections.length > 0 && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Gợi ý:{" "}
                          {[...new Set(effectiveDraft.rejections.map((r) => r.reason))]
                            .slice(0, 3)
                            .map((r) => REJECTION_HINTS[r as RejectionReason])
                            .join(" · ")}
                        </p>
                      )}
                    </Card>
                  ) : (
                    <Card className="border-success/35 bg-success/5 p-3 text-[12.5px] text-success">
                      ✓ Lịch đầy đủ — không còn cảnh báo
                    </Card>
                  )}
                  <Card className="p-4">
                    <div className="mb-3 text-sm font-semibold">Coverage theo giờ</div>
                    <CoverageMiniStrip coverage={effectiveDraft.coverage} />
                  </Card>
                  <DailyShiftTable
                    templates={adjustedTemplates}
                    assignments={effAssignments}
                    dealers={data.dealers}
                    onRemove={handleRemoveAssignment}
                    onAddToTemplate={openPickFor}
                  />
                </>
              )}

              {/* Step 4 — Phát hành & báo dealer */}
              {step === 4 && (
                <PublishPanel
                  assignments={effAssignments}
                  publishedAt={null}
                  stage={publishStage}
                  rows={notifyRows}
                  botUsername={null}
                  onRetryTelegram={() => void retryTelegram()}
                  onExportDay={() => void exportDay()}
                  onExportWeek={() => void exportWeek()}
                  onSendWeekTelegram={() => void sendWeekTelegram()}
                  exporting={exporting}
                />
              )}
            </>
          )}
        </>
      )}

      {/* Dialogs */}
      {data && (
        <DealerPickListDialog
          open={pickOpen}
          onOpenChange={setPickOpen}
          templateId={pickTemplateId}
          onTemplateChange={setPickTemplateId}
          dealers={data.dealers}
          templates={adjustedTemplates}
          availability={data.availability}
          config={data.config}
          workDate={workDate}
          assignedDealerIds={assignedDealerIds}
          onAdd={handleAddAssignment}
        />
      )}
      {data && (
        <DemandDialog
          open={demandOpen}
          onOpenChange={setDemandOpen}
          templates={data.templates}
          overrides={demandOverrides}
          dealers={data.dealers}
          availability={data.availability}
          finalDesignations={finalDesignations}
          tourCount={tourCounts[workDate] ?? null}
          onApply={(next) => {
            setDemandOverrides(next.demand);
            setFinalDesignations(next.final);
            setOverrides(null);
            setFinalShortages([]);
            setSavedRunId(null);
            if (Object.keys(next.demand).length > 0 || Object.keys(next.final).length > 0)
              toast.success("Đã áp dụng nhu cầu mới cho ngày này");
          }}
        />
      )}
      {live && clubId && (
        <ShiftTemplateEditor open={editorOpen} onOpenChange={setEditorOpen} clubId={clubId} refDate={workDate} onChanged={refetch} />
      )}

      {/* Unsaved-changes confirm on date change */}
      <AlertDialog open={pendingDate !== null} onOpenChange={(o) => !o && setPendingDate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bạn có thay đổi chưa lưu</AlertDialogTitle>
            <AlertDialogDescription>
              Chuyển sang ngày khác sẽ bỏ các chỉnh sửa chưa lưu của {dateLabel}. Lưu nháp trước khi chuyển?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Ở lại</AlertDialogCancel>
            <AlertDialogAction
              className="bg-muted text-foreground hover:bg-muted/80"
              onClick={() => {
                const d = pendingDate;
                setPendingDate(null);
                try { sessionStorage.removeItem(stashKey); } catch { /* best-effort */ }
                if (d) resetForDate(d);
              }}
            >
              Bỏ thay đổi
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                const d = pendingDate;
                setPendingDate(null);
                void handleSave().then((ok) => {
                  if (ok && d) resetForDate(d);
                });
              }}
            >
              Lưu nháp rồi chuyển
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
