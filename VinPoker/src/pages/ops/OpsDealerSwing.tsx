import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";
import {
  ChevronLeft, Repeat, Users, Coffee, ArrowRightLeft, History, Lightbulb, QrCode,
  Monitor, LogOut, ArrowRight, Clock, FlagTriangleRight, Loader2, LogIn,
  CalendarDays, AlertTriangle, Send,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useOperatorClubs, type OperatorClubRow } from "@/hooks/useOperatorClubs";
import {
  usePublishedDealerSchedule,
  type PublishedScheduleAssignment,
} from "@/hooks/usePublishedDealerSchedule";
import { useDealerSwingPhoneRollout } from "@/hooks/useDealerSwingPhoneRollout";
import { DealerPhoneCheckinSheet } from "@/components/ops/dealer-swing/DealerPhoneCheckinSheet";
import { DealerPhoneCloseTablesSheet } from "@/components/ops/dealer-swing/DealerPhoneCloseTablesSheet";
import { DealerPhoneReconcileSheet } from "@/components/ops/dealer-swing/DealerPhoneReconcileSheet";
import {
  useDealerOperationalTables, useActiveAssignmentsWithTimeline, useCheckedInDealers,
  useTodayCheckedOutDealers,
  type DealerAttendance, type DealerAssignment,
} from "@/hooks/useDealerSwing";
import { useShiftPlanner } from "@/hooks/useShiftPlanner";
import type { AvailabilityRequest } from "@/types/shiftPlanner";
import { summarizeDealerCheckoutBatch } from "@/lib/dealerCheckoutResults";
import { classifyManualSwingOutcome } from "@/lib/dealerSwingOutcome";
import { describeCloseBlockers, getDealerTourCloseReadiness, type CloseReadiness } from "@/lib/feltLifecycleReadiness";

/**
 * Dealer Swing (mobileOpsV2) — bản NỐI DỮ LIỆU THẬT (reads).
 * Ngữ cảnh CLB qua `useOperatorClubs()` (đúng nguồn desktop DealerSwingDashboard dùng);
 * bàn/dealer/đếm ngược đọc từ các hook thật `useDealerOperationalTables` / `useActiveAssignmentsWithTimeline`
 * / `useCheckedInDealers` / `useTodayCheckedOutDealers` (realtime).
 *
 * Hành động THẬT đã nối (gate opsSwingActions): swing / gán / nghỉ / đưa-vào-bàn / check-in /
 * check-out / đóng-tour / sửa-nhầm-bàn / duyệt-yêu-cầu / gợi-ý-dealer — mirror desktop DealerSwingTab
 * (perform_swing / assign-dealer / manage-break / checkout-dealer / archive_and_close_dealer_tour /
 * reconcile_dealer_room_state / review_availability_request). Đọc chi tiết (lịch sử bàn / ca hôm nay)
 * là read-only luôn live. Lịch phone chỉ đọc các run đã phát hành và assignment đã lưu.
 */
const BREAK_PRESETS = [15, 30, 45, 60];
const PILLS = [
  { key: "tables", label: "Bàn" },
  { key: "dealers", label: "Dealer" },
  { key: "schedule", label: "Lịch" },
  { key: "requests", label: "Yêu cầu" },
  { key: "staff", label: "Nhân sự" },
  { key: "close", label: "Kết ca" },
] as const;
type Pill = (typeof PILLS)[number]["key"];

type EnrichedAssignment = DealerAssignment & {
  minutesLeft: number | null;
  secondsLeft: number | null;
  showNextDealerSoon: boolean;
  isOverdue: boolean;
  pre_assigned?: {
    dealers?: { full_name?: string | null } | null;
  } | null;
};

/** Target cho break picker — cần attendance_id + club_id (edge manage-break yêu cầu). */
type BreakTarget = { attendanceId: string; clubId: string; name: string };

/** Gợi ý dealer từ edge assign-dealer (return_suggestions_only=true). */
type Sug = { dealer_id: string; dealer_name: string; tier?: string | null; score?: number | null; reason?: string | null };

const hhmm = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "—";

const DEALER_CHIP: Record<string, { label: string; cls: string }> = {
  assigned: { label: "Đang bàn", cls: "bg-sky-400/12 text-sky-300" },
  available: { label: "Sẵn sàng", cls: "bg-emerald-400/12 text-emerald-300" },
  on_break: { label: "Nghỉ", cls: "bg-white/6 text-[#9b8e97]" },
  pre_assigned: { label: "Sắp vào", cls: "bg-pink-400/12 text-pink-300" },
  checked_out: { label: "Đã về", cls: "bg-white/6 text-[#7c7079]" },
};

type ScheduleTone = "ok" | "warn";
const toneCls: Record<ScheduleTone, string> = {
  ok: "bg-emerald-400/12 text-emerald-300",
  warn: "bg-amber-400/12 text-amber-300",
};

const SCHEDULE_STATE: Record<PublishedScheduleAssignment["state"], { label: string; cls: string }> = {
  published: { label: "Đã xếp", cls: "bg-sky-400/12 text-sky-300" },
  confirmed: { label: "Đã xác nhận", cls: "bg-emerald-400/12 text-emerald-300" },
  waiting: { label: "Đã đến · chờ ca", cls: "bg-amber-400/12 text-amber-300" },
  in_pool: { label: "Trong pool", cls: "bg-emerald-400/12 text-emerald-300" },
  closed: { label: "Đã kết ca", cls: "bg-white/6 text-[#9b8e97]" },
};

function vnDateAtOffset(offset: number) {
  const vnNow = new Date(Date.now() + 7 * 3_600_000);
  const date = new Date(Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate() + offset));
  return date.toISOString().slice(0, 10);
}

function scheduleDateParts(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat("vi-VN", { weekday: "short", timeZone: "UTC" }).format(date),
    day: new Intl.DateTimeFormat("vi-VN", { day: "2-digit", timeZone: "UTC" }).format(date),
    full: new Intl.DateTimeFormat("vi-VN", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(date),
  };
}

export default function OpsDealerSwing() {
  const navigate = useNavigate();
  const { loading, user, clubs, clubIds, dealerClubIds, error } = useOperatorClubs();
  const [activeClubId, setActiveClubId] = useState<string | null>(null);
  const eligibleIds = dealerClubIds.length > 0 ? dealerClubIds : clubIds;
  const eligibleClubs = useMemo(
    () => (clubs ?? []).filter((club) => eligibleIds.includes(club.id)),
    [clubs, eligibleIds],
  );
  const eligibleKey = eligibleClubs.map((club) => club.id).sort().join(",");

  useEffect(() => {
    const currentEligibleIds = eligibleKey ? eligibleKey.split(",") : [];
    if (currentEligibleIds.length === 1) {
      setActiveClubId(currentEligibleIds[0]);
      return;
    }
    if (!activeClubId || !currentEligibleIds.includes(activeClubId)) {
      setActiveClubId(null);
    }
  }, [eligibleKey, activeClubId]);

  if (loading) return <Guard icon={<Loader2 className="h-8 w-8 animate-spin text-[#c9a86a]" />} title="Đang tải…" sub="Kiểm tra đăng nhập và phạm vi CLB." onBack={() => navigate("/")} />;
  if (!user) return <Guard icon={<LogIn className="h-8 w-8 text-[#c9a86a]" />} title="Cần đăng nhập" sub="Đăng nhập tài khoản có quyền dealer để xem bảng xoay ca thật." onBack={() => navigate("/")} />;
  if (error) return <Guard icon={<AlertTriangle className="h-8 w-8 text-rose-300" />} title="Không tải được phạm vi CLB" sub={error} onBack={() => navigate("/")} />;
  if (eligibleClubs.length === 0) return <Guard icon={<Users className="h-8 w-8 text-amber-300" />} title="Chưa được phân công CLB" sub="Liên hệ quản trị để được gán quyền điều phối dealer." onBack={() => navigate("/")} />;
  if (!activeClubId) {
    return <ClubPicker clubs={eligibleClubs} onSelect={setActiveClubId} onBack={() => navigate("/")} />;
  }

  return (
    <DealerSwingClubView
      key={JSON.stringify([user.id, activeClubId])}
      activeClubId={activeClubId}
      clubs={eligibleClubs}
      onSelectClub={setActiveClubId}
    />
  );
}

function DealerSwingClubView({
  activeClubId,
  clubs,
  onSelectClub,
}: {
  activeClubId: string;
  clubs: OperatorClubRow[];
  onSelectClub: (clubId: string) => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const scopedIds = useMemo(() => [activeClubId], [activeClubId]);

  const tablesQ = useDealerOperationalTables(scopedIds);
  const asgQ = useActiveAssignmentsWithTimeline(scopedIds);
  const rosterQ = useCheckedInDealers(scopedIds);
  const outQ = useTodayCheckedOutDealers(scopedIds);
  const todayVN = useMemo(() => vnDateAtOffset(0), []);
  const scheduleDates = useMemo(() => Array.from({ length: 7 }, (_, index) => vnDateAtOffset(index)), []);
  const [selectedScheduleDate, setSelectedScheduleDate] = useState(todayVN);
  const scheduleQ = usePublishedDealerSchedule(activeClubId, scheduleDates);
  const phoneCompletionQ = useDealerSwingPhoneRollout(activeClubId);
  const planQ = useShiftPlanner({ clubIds: scopedIds, workDate: todayVN, mode: "live" }); // yêu cầu xin ca/nghỉ

  const [pill, setPill] = useState<Pill>("tables");
  const [tableSheet, setTableSheet] = useState<TableVM | null>(null);
  const [dealerSheet, setDealerSheet] = useState<DealerAttendance | null>(null);
  const [pickFor, setPickFor] = useState<TableVM | null>(null);
  const [breakFor, setBreakFor] = useState<BreakTarget | null>(null);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [closeTablesOpen, setCloseTablesOpen] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileInitialTableId, setReconcileInitialTableId] = useState<string | null>(null);
  const [suggestTableOpen, setSuggestTableOpen] = useState(false); // chọn bàn thiếu người để gợi ý dealer
  const [placeFor, setPlaceFor] = useState<DealerAttendance | null>(null);   // đưa dealer này vào 1 bàn
  const [tourList, setTourList] = useState<{ id: string; clubId: string; name: string }[] | null>(null);
  const [tourToClose, setTourToClose] = useState<string | null>(null);
  const [dongTour, setDongTour] = useState("");
  const [tourCloseReadiness, setTourCloseReadiness] = useState<CloseReadiness | null>(null);
  const [tourCloseReadinessError, setTourCloseReadinessError] = useState<string | null>(null);
  const [tourCloseReadinessLoading, setTourCloseReadinessLoading] = useState(false);
  const [checkout, setCheckout] = useState<Set<string>>(new Set());
  const [histTable, setHistTable] = useState<TableVM | null>(null);      // "Lịch sử bàn này"
  const [histRows, setHistRows] = useState<any[] | null>(null);          // null = đang tải
  const [shiftDealer, setShiftDealer] = useState<DealerAttendance | null>(null); // "Ca hôm nay"
  const [shiftRows, setShiftRows] = useState<any[] | null>(null);
  const [pickSuggestFor, setPickSuggestFor] = useState<TableVM | null>(null);    // gợi ý dealer cho 1 bàn
  const [suggests, setSuggests] = useState<Sug[] | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [reqDecided, setReqDecided] = useState<Record<string, "acknowledged" | "rejected">>({}); // dealerId → quyết định vừa bấm

  const assignments = useMemo(() => (asgQ.data ?? []) as EnrichedAssignment[], [asgQ.data]);
  const roster = useMemo(() => rosterQ.data ?? [], [rosterQ.data]);
  const selectedScheduleDay = scheduleQ.daysByDate[selectedScheduleDate] ?? null;
  const scheduleAssignments = useMemo(() => selectedScheduleDay?.assignments ?? [], [selectedScheduleDay]);
  const todayScheduleAssignments = useMemo(
    () => scheduleQ.daysByDate[todayVN]?.assignments ?? [],
    [scheduleQ.daysByDate, todayVN],
  );
  const scheduleStats = useMemo(() => ({
    total: scheduleAssignments.length,
    confirmed: scheduleAssignments.filter((assignment) => assignment.state === "confirmed").length,
    arrived: scheduleAssignments.filter((assignment) => assignment.arrivalAt !== null).length,
    waiting: scheduleAssignments.filter((assignment) => assignment.state === "waiting").length,
  }), [scheduleAssignments]);

  // Yêu cầu xin ca/nghỉ (đọc live qua useShiftPlanner) + resolve tên dealer / nhãn ca
  const reqDealers = planQ.data?.dealers ?? [];
  const reqTemplates = planQ.data?.templates ?? [];
  const nameOf = (id: string) => reqDealers.find((d) => d.id === id)?.fullName ?? "Dealer";
  const labelOf = (id: string) => reqTemplates.find((t) => t.id === id)?.label ?? id;
  const pendingReqs = (planQ.data?.availability ?? []).filter((r) => (r.status ?? "submitted") === "submitted" || reqDecided[r.dealerId]);

  // table_id → assignment (with timeline)
  const asgByTable = useMemo(() => {
    const m = new Map<string, EnrichedAssignment>();
    for (const a of assignments) m.set(a.table_id, a);
    return m;
  }, [assignments]);
  // attendance_id → table name (dealer đang ở bàn nào)
  const tableByAttendance = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of assignments) if (a.attendance_id) m.set(a.attendance_id, a.game_tables?.table_name ?? "");
    return m;
  }, [assignments]);
  const tableIdByAttendance = useMemo(() => {
    const map = new Map<string, string>();
    for (const assignment of assignments) {
      if (assignment.attendance_id) map.set(assignment.attendance_id, assignment.table_id);
    }
    return map;
  }, [assignments]);

  const tableVMs = useMemo<TableVM[]>(() => {
    const open = (tablesQ.data ?? []).filter((t) => (t.status ?? "active") !== "inactive");
    return open.map((t) => {
      const a = asgByTable.get(t.id);
      const dealer = a?.dealer_attendance?.dealers?.full_name ?? null;
      const next = a?.pre_assigned?.dealers?.full_name ?? null;
      return {
        id: t.id, clubId: t.club_id, tableSessionId: t.table_session_id ?? null,
        name: t.table_name, assignment: a ?? null,
        dealer, next, missing: !a,
        since: a ? hhmm(a.assigned_at) : "—",
      };
    }).sort((x, y) => rank(x) - rank(y));
  }, [tablesQ.data, asgByTable]);

  const staff = useMemo(() => {
    const byState = { assigned: 0, available: 0, on_break: 0, pre_assigned: 0 };
    for (const d of roster) byState[d.current_state as keyof typeof byState] = (byState[d.current_state as keyof typeof byState] ?? 0) + 1;
    return { openTables: tableVMs.length, inShift: roster.length, ...byState };
  }, [roster, tableVMs.length]);
  const phoneCloseTables = useMemo(
    () => tableVMs.map((table) => ({ id: table.id, name: table.name, dealer: table.dealer })),
    [tableVMs],
  );
  const phoneReconcileTables = useMemo(
    () => tableVMs.map((table) => ({
      id: table.id,
      name: table.name,
      recordedAttendanceId: table.assignment?.attendance_id ?? null,
      recordedDealerName: table.dealer,
    })),
    [tableVMs],
  );
  const phoneReconcileDealers = useMemo(
    () => roster.map((dealer) => ({
      attendanceId: dealer.id,
      dealerName: dealer.dealers?.full_name ?? "Dealer",
      currentTableId: tableIdByAttendance.get(dealer.id) ?? null,
      state: dealer.current_state,
    })),
    [roster, tableIdByAttendance],
  );

  const go = <T,>(setter: (v: T) => void, v: T) => { setTableSheet(null); setDealerSheet(null); requestAnimationFrame(() => setter(v)); };

  // Existing mobile actions share the same server paths as desktop. The build
  // flag remains a hard stop and never falls through to an RPC/Edge call.
  const LIVE = FEATURES.opsSwingActions;
  const busyRef = useRef(false);
  const swingRequestIdsRef = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const reloadAll = () => { tablesQ.refetch(); asgQ.refetch(); rosterQ.refetch(); outQ.refetch(); };
  const runAction = async (fn: () => Promise<void>) => {
    if (!LIVE) { toast.warning("Bản dựng này đang ở chế độ chỉ xem."); return; }
    if (tablesQ.loading || asgQ.loading || rosterQ.loading || outQ.loading
      || tablesQ.error || asgQ.error || rosterQ.error || outQ.error) {
      toast.warning("Dữ liệu Dealer Swing chưa được xác minh. Hãy tải lại trước khi thao tác.");
      return;
    }
    if (busyRef.current) return;                   // chống double-tap (ref đồng bộ)
    busyRef.current = true; setBusy(true);
    try { await fn(); } catch (e: any) { toast.error(e?.message ?? "Lỗi mạng"); } finally { busyRef.current = false; setBusy(false); }
  };

  // Swing 1 bàn → authenticated operator RPC (mirror performSwingForTable)
  const doSwing = (t: TableVM) => runAction(async () => {
    const assignment = t.assignment;
    if (!assignment) { toast.error("Bàn chưa có lượt để swing."); return; }
    if (!assignment.table_session_id) {
      toast.error("Bàn chưa có liên kết phiên hợp lệ. Không thể đổi dealer.");
      return;
    }
    const requestId = swingRequestIdsRef.current.get(assignment.id) ?? crypto.randomUUID();
    swingRequestIdsRef.current.set(assignment.id, requestId);
    const { data, error } = await (supabase.rpc as any)("operator_perform_swing", {
      p_assignment_id: assignment.id,
      p_table_id: assignment.table_id,
      p_table_session_id: assignment.table_session_id,
      p_expected_version: assignment.version,
      p_request_id: requestId,
    });
    if (error) { toast.error(`Lỗi swing: ${error.message}`); return; }
    const swingOutcome = classifyManualSwingOutcome(data);
    if (swingOutcome.kind === "success") toast.success(swingOutcome.message);
    else if (swingOutcome.kind === "warning") toast.warning(swingOutcome.message);
    else if (swingOutcome.kind === "info") toast.info(swingOutcome.message);
    else toast.error(swingOutcome.message);
    swingRequestIdsRef.current.delete(assignment.id);
    setTableSheet(null);
    reloadAll();
  });

  // Gán 1 dealer cụ thể vào bàn → edge assign-dealer force_dealer_id (mirror confirmAssign)
  const doAssign = (t: TableVM, d: DealerAttendance) => runAction(async () => {
    const current = tablesQ.data?.find((row) => row.id === t.id && row.club_id === activeClubId);
    if (!user?.id || t.clubId !== activeClubId || !t.tableSessionId
      || current?.table_session_id !== t.tableSessionId || current.status !== "active") {
      toast.error("Phiên bàn đã thay đổi hoặc chưa được xác minh. Tải lại trước khi gán dealer.");
      setPickFor(null);
      reloadAll();
      return;
    }
    const { data, error } = await supabase.functions.invoke("assign-dealer", {
      body: { table_id: t.id, table_session_id: t.tableSessionId, force_dealer_id: d.dealer_id,
        requested_by: user.id, expected_actor_id: user.id, expected_club_id: t.clubId,
        idempotency_key: crypto.randomUUID() },
    });
    if (error) {
      let detail = error.message;
      if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null);
        if (error.context.status === 409) { toast.info("Bàn đã có dealer — đang cập nhật."); setPickFor(null); reloadAll(); return; }
        detail = body?.error ?? body?.message ?? detail;
      }
      toast.error(`Lỗi gán: ${detail}`); return;
    }
    if ((data as any)?.error) { toast.error((data as any).error); return; }
    toast.success(`Đã gán ${d.dealers?.full_name ?? "dealer"} → ${t.name}`);
    setPickFor(null);
    reloadAll();
  });

  // Cho nghỉ → edge manage-break start (mirror sendToBreak). Server kiểm luật nghỉ 15p.
  const doBreak = (target: BreakTarget, minutes: number) => runAction(async () => {
    const { data, error } = await supabase.functions.invoke("manage-break", {
      body: { attendance_id: target.attendanceId, action: "start", requested_by: user?.id, club_id: target.clubId, duration_minutes: minutes, idempotency_key: crypto.randomUUID() },
    });
    if (error) {
      let eb: any = null;
      if (error instanceof FunctionsHttpError) { try { eb = await error.context?.json?.(); } catch { /* ignore */ } }
      toast.error(eb?.error ?? error.message); return;
    }
    const res = data as any;
    if (res?.action === "extended") toast.success(`Đã gia hạn nghỉ ${target.name}, tổng ${res.break_minutes ?? minutes} phút`);
    else toast.success(`Đã cho ${target.name} nghỉ ${minutes} phút`);
    setBreakFor(null);
    reloadAll();
  });

  // Check-out 1 dealer → edge checkout-dealer (mirror doCheckout)
  const doCheckoutOne = (d: DealerAttendance) => runAction(async () => {
    const { data, error } = await supabase.functions.invoke("checkout-dealer", { body: { attendance_id: d.id } });
    if (error) {
      let detail = error.message || "Lỗi check-out";
      try { const ctx = (error as any)?.context; if (ctx?.json) { const b = await ctx.json(); if (b?.error) detail = b.error; } } catch { /* ignore */ }
      toast.error(detail); return;
    }
    const summary = summarizeDealerCheckoutBatch(data, 1);
    if (summary.failedCount > 0) {
      toast.error(summary.failureMessage ?? "Check-out dealer thất bại");
      return;
    }
    const result = summary.results[0];
    if (result?.released_pre_assigned) toast.warning(`Dealer đang pre-assign bàn ${result.pre_assigned_table ?? "?"} được release`);
    toast.success(`Đã check-out ${d.dealers?.full_name ?? "dealer"}`);
    setDealerSheet(null);
    reloadAll();
  });

  // Check-out hàng loạt → edge checkout-dealer attendance_ids (mirror doBatchCheckout)
  const doBatchCheckout = (ids: string[]) => runAction(async () => {
    if (!ids.length) return;
    const { data, error } = await supabase.functions.invoke("checkout-dealer", { body: { attendance_ids: ids } });
    if (error) {
      let detail = error.message || "Lỗi checkout hàng loạt";
      try { const ctx = (error as any)?.context; if (ctx?.json) { const b = await ctx.json(); if (b?.error) detail = b.error; } } catch { /* ignore */ }
      toast.error(detail); return;
    }
    const summary = summarizeDealerCheckoutBatch(data, ids.length);
    if (summary.successCount > 0) toast.success(`Đã check-out ${summary.successCount}/${ids.length} dealer`);
    if (summary.failureMessage) toast.error(summary.failureMessage);
    setCheckout(new Set());
    reloadAll();
  });

  // Explicit stale-shift cleanup: closes only rows with historical end evidence
  // and leaves payroll/OT fields untouched. This is never folded into normal checkout.
  const doStaleCleanup = (ids: string[]) => runAction(async () => {
    if (!ids.length) return;
    const { data, error } = await supabase.functions.invoke("checkout-dealer", {
      body: { attendance_ids: ids, mode: "stale_cleanup" },
    });
    if (error) {
      let detail = error.message || "Lỗi dọn ca treo";
      try { const ctx = (error as any)?.context; if (ctx?.json) { const b = await ctx.json(); if (b?.error) detail = b.error; } } catch { /* ignore */ }
      toast.error(detail); return;
    }
    const summary = summarizeDealerCheckoutBatch(data, ids.length);
    if (summary.successCount > 0) toast.success(`Đã dọn ${summary.successCount}/${ids.length} ca; không tính lại lương/OT`);
    if (summary.failureMessage) toast.warning(`Giữ lại để kiểm tra: ${summary.failureMessage}`);
    setCheckout(new Set());
    reloadAll();
  });

  // Tải danh sách tour (dealer_shifts) để chọn tour đóng (mirror useTours desktop; read-only)
  const loadTours = async () => {
    const { data } = await supabase.from("dealer_shifts").select("id, club_id, tour_name").in("club_id", scopedIds).order("start_time");
    setTourList((data ?? []).map((t: any) => ({ id: t.id, clubId: t.club_id, name: t.tour_name ?? "Tour" })));
  };

  useEffect(() => {
    const tour = tourList?.find((item) => item.id === tourToClose);
    if (!tour) {
      setTourCloseReadiness(null);
      setTourCloseReadinessError(null);
      return;
    }
    let cancelled = false;
    setTourCloseReadinessLoading(true);
    setTourCloseReadiness(null);
    getDealerTourCloseReadiness(tour.id, tour.clubId)
      .then((readiness) => {
        if (!cancelled) {
          setTourCloseReadiness(readiness);
          setTourCloseReadinessError(readiness.ok ? null : readiness.error ?? "Không thể kiểm tra.");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setTourCloseReadinessError(error instanceof Error ? error.message : "Không thể kiểm tra.");
      })
      .finally(() => { if (!cancelled) setTourCloseReadinessLoading(false); });
    return () => { cancelled = true; };
  }, [tourToClose, tourList]);

  // Đóng tour → RPC archive_and_close_dealer_tour (mirror closeTour desktop; lưu trữ + trả bàn)
  const doCloseTour = (tour: { id: string; clubId: string; name: string }) => runAction(async () => {
    let readiness: CloseReadiness;
    try {
      readiness = await getDealerTourCloseReadiness(tour.id, tour.clubId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không kiểm tra được tour.");
      return;
    }
    setTourCloseReadiness(readiness);
    if (!readiness.ok || !readiness.ready) {
      toast.warning(readiness.ok
        ? `Chưa thể đóng tour: ${describeCloseBlockers(readiness.blockers)}`
        : `Không kiểm tra được quyền đóng tour: ${readiness.error ?? "lỗi không rõ"}`);
      return;
    }
    const { data, error } = await (supabase.rpc as any)("archive_and_close_dealer_tour", { p_tour_id: tour.id, p_club_id: tour.clubId });
    if (error) { toast.error(`Đóng tour thất bại: ${error.message}`); return; }
    const r = data as any;
    if (!r?.ok) {
      const m: Record<string, string> = { permission_denied: "Không có quyền đóng tour này.", tour_not_found: "Không tìm thấy tour." };
      toast.error(m[r?.outcome] ?? `Đóng tour thất bại: ${r?.outcome ?? "lỗi"}`); return;
    }
    if (r.outcome === "already_closed") toast.info("Tour đã đóng trước đó.");
    else toast.success(`Đã đóng tour ${tour.name} · giải phóng ${r.tables_released ?? 0} bàn · ${r.dealers_released ?? 0} dealer về pool`);
    // Telegram tổng hợp cho nhóm CLB (chỉ khi đóng THẬT, fire-and-forget) — đồng bộ với
    // desktop closeTour; dùng edge telegram-swing-notifier đã LIVE (__club__ → chat CLB).
    if (r.outcome === "ok") {
      supabase.functions.invoke("telegram-swing-notifier", {
        body: {
          chat_id: "__club__", club_id: tour.clubId,
          message: `📦 Đóng tour ${tour.name}: đã lưu trữ Swing, giải phóng ${r.tables_released ?? 0} bàn`
            + ` và đưa ${r.dealers_released ?? 0} dealer về Break Pool.`,
        },
      }).catch(() => {});
    }
    setDongTour(""); setTourToClose(null); setTourList(null);
    reloadAll();
  });

  // ── Đọc chi tiết (read-only, luôn live — reads trên trang này không gate cờ) ──
  // "Lịch sử bàn này": chuỗi dealer đã ngồi bàn này (dealer_assignments theo table_id)
  const openTableHistory = (t: TableVM) => {
    setTableSheet(null); setHistTable(t); setHistRows(null);
    requestAnimationFrame(async () => {
      const { data, error } = await supabase.from("dealer_assignments")
        .select("id, assigned_at, released_at, status, dealer_attendance!attendance_id(dealers(full_name))")
        .eq("table_id", t.id).order("assigned_at", { ascending: false }).limit(30);
      setHistRows(error ? [] : ((data ?? []) as any[]));
    });
  };
  // "Ca hôm nay": giờ vào/ra (đã có trên dealerSheet) + danh sách bàn đã chia (theo attendance_id)
  const openShiftToday = (d: DealerAttendance) => {
    setDealerSheet(null); setShiftDealer(d); setShiftRows(null);
    requestAnimationFrame(async () => {
      const { data, error } = await supabase.from("dealer_assignments")
        .select("id, table_id, assigned_at, released_at, status, game_tables!inner(table_name)")
        .eq("attendance_id", d.id).order("assigned_at", { ascending: true });
      setShiftRows(error ? [] : ((data ?? []) as any[]));
    });
  };

  // ── Gợi ý dealer cho 1 bàn: đọc điểm từ edge assign-dealer (return_suggestions_only — không ghi) ──
  const openSuggest = (t: TableVM) => {
    setSuggestTableOpen(false); setPickSuggestFor(t); setSuggests(null); setSuggestLoading(true);
    requestAnimationFrame(async () => {
      try {
        const { data } = await supabase.functions.invoke("assign-dealer", {
          body: { table_id: t.id, requested_by: user?.id, return_suggestions_only: true },
        });
        setSuggests(((data as any)?.suggestions ?? []) as Sug[]);
      } catch { setSuggests([]); }
      finally { setSuggestLoading(false); }
    });
  };
  // Gán theo dealer_id đã chọn từ gợi ý → edge assign-dealer force_dealer_id (clone doAssign)
  const doAssignById = (t: TableVM, dealerId: string, name: string) => runAction(async () => {
    const { data, error } = await supabase.functions.invoke("assign-dealer", {
      body: { table_id: t.id, force_dealer_id: dealerId, requested_by: user?.id, idempotency_key: crypto.randomUUID() },
    });
    if (error) {
      let detail = error.message;
      if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null);
        if (error.context.status === 409) { toast.info("Bàn đã có dealer — đang cập nhật."); setPickSuggestFor(null); reloadAll(); return; }
        detail = body?.error ?? body?.message ?? detail;
      }
      toast.error(`Lỗi gán: ${detail}`); return;
    }
    if ((data as any)?.error) { toast.error((data as any).error); return; }
    toast.success(`Đã gán ${name} → ${t.name}`);
    setPickSuggestFor(null);
    reloadAll();
  });

  // Duyệt / từ chối yêu cầu xin ca-nghỉ → RPC review_availability_request (mirror RequestsActionPanel).
  // p_decision: acknowledged = duyệt · rejected = từ chối. RPC source-only → nếu chưa apply, báo trung thực.
  const doReviewRequest = (r: AvailabilityRequest, decision: "acknowledged" | "rejected") => runAction(async () => {
    const clubId = scopedIds[0];
    const { data, error } = await (supabase.rpc as any)("review_availability_request", {
      p_club_id: clubId, p_dealer_id: r.dealerId, p_work_date: todayVN, p_decision: decision,
    });
    if (error) { toast.error(`Lỗi duyệt: ${error.message}`); return; }
    if (!(data as any)?.ok) {
      toast.error((data as any)?.error === "actor_not_allowed" ? "Không có quyền duyệt yêu cầu CLB này." : "Chưa lưu được trạng thái (cần áp dụng RPC trên DB).");
      return;
    }
    setReqDecided((p) => ({ ...p, [r.dealerId]: decision }));
    toast.success(decision === "acknowledged" ? `Đã duyệt yêu cầu của ${nameOf(r.dealerId)}` : `Đã từ chối yêu cầu của ${nameOf(r.dealerId)}`);
    planQ.refetch();
  });

  const activeClub = clubs.find((club) => club.id === activeClubId)!;

  if (tablesQ.error || asgQ.error || rosterQ.error || outQ.error) return (
    <div role="alert" className="ios-in space-y-3 pt-2">
      <Guard icon={<AlertTriangle className="h-8 w-8 text-rose-300" />} title="Không xác minh được dữ liệu Dealer Swing" sub="Không dùng dữ liệu cũ để gán, xoay hoặc kết ca dealer. Hãy thử tải lại." onBack={() => navigate("/")} />
      <button className="ios-press-sm rounded-full px-4 py-2 text-[#c9a86a]" onClick={reloadAll}>Thử lại</button>
    </div>
  );
  if (tablesQ.loading || asgQ.loading || rosterQ.loading || outQ.loading) return <Guard icon={<Loader2 className="h-8 w-8 animate-spin text-[#c9a86a]" />} title="Đang xác minh dữ liệu Dealer Swing…" sub="Chờ xác minh bàn, assignment và ca dealer trước khi thao tác." onBack={() => navigate("/")} />;

  return (
    <div className="ios-in space-y-4 pt-1">
      <header className="px-1">
        <button onClick={() => navigate("/")} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> App chính
        </button>
        <h1 className="mt-1 text-[26px] font-bold leading-tight text-[#f2ece6]">Dealer Swing</h1>
        <p className="mt-0.5 text-[14px] text-[#9b8e97]">{activeClub.name} · việc gấp tự nổi lên đầu</p>
      </header>

      {clubs.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Chọn câu lạc bộ">
          {clubs.map((club) => (
            <button
              key={club.id}
              type="button"
              onClick={() => onSelectClub(club.id)}
              className={cn(
                "ios-press-sm shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium",
                club.id === activeClubId ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]",
              )}
            >
              {club.name}
            </button>
          ))}
        </div>
      )}

      {LIVE ? (
        <div className="rounded-xl bg-emerald-400/8 px-3 py-2 text-[12px] text-emerald-300/90">
          Nút <b>swing · gán · nghỉ · đưa vào bàn · check-in · check-out · sửa nhầm bàn · đóng tour</b> đã bật (dữ liệu thật).
        </div>
      ) : (
        <div className="rounded-xl bg-amber-400/8 px-3 py-2 text-[12px] text-amber-300/90">
          Dữ liệu thật · bản dựng này đang ở chế độ chỉ xem.
        </div>
      )}

      {phoneCompletionQ.error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl bg-rose-400/8 px-3 py-2 text-[12px] text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Không kiểm tra được quyền thao tác phone: {phoneCompletionQ.error}</span>
        </div>
      )}

      <div className="flex gap-1.5 overflow-x-auto px-1 pb-1">
        {PILLS.map((p) => (
          <button key={p.key} onClick={() => { setPill(p.key); if (p.key === "close") loadTours(); }}
            className={cn("ios-press-sm shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium", pill === p.key ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
            {p.label}
          </button>
        ))}
      </div>

      {/* D1 — Bàn + đếm ngược (thật) */}
      {pill === "tables" && (
        <div className="space-y-3">
          <div className="ios-card flex items-center justify-between px-4 py-3 text-[13px]">
            <span><span className="text-sky-300">{staff.assigned} đang bàn</span> · <span className="text-[#9b8e97]">{staff.on_break} nghỉ</span></span>
            {tableVMs.some((t) => t.missing) && <span className="rounded-full bg-rose-400/12 px-2 py-0.5 text-[11px] font-semibold text-rose-300">thiếu {tableVMs.filter((t) => t.missing).length}</span>}
          </div>
          {tableVMs.length === 0 ? (
            <Empty text="Chưa có bàn nào đang mở." />
          ) : (
            <div className="ios-group">
              {tableVMs.map((t) => {
                const c = countdown(t);
                return (
                  <button key={t.id} onClick={() => setTableSheet(t)}
                    className={cn("ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left", (t.missing || t.assignment?.isOverdue) && "bg-rose-500/6")}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] text-[#f2ece6]">{t.name} <span className="text-[#9b8e97]">· {t.dealer ?? "—"}</span></span>
                      <span className="block text-[12px] text-[#9b8e97]">{t.missing ? "chưa có dealer" : t.next ? `kế tiếp: ${t.next}` : `vào ${t.since}`}</span>
                    </span>
                    {t.missing
                      ? <span className="rounded-full bg-rose-400/12 px-2.5 py-1 text-[11px] font-semibold text-rose-300">Gán ngay</span>
                      : <span className={cn("text-[13px] font-semibold tabular-nums", c.cls)}>{c.text}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* D3 — Dealer pool (thật) */}
      {pill === "dealers" && (
        roster.length === 0 ? <Empty text="Chưa có dealer nào trong ca." /> : (
          <div className="ios-group">
            {roster.map((d) => {
              const chip = DEALER_CHIP[d.current_state] ?? DEALER_CHIP.available;
              const table = tableByAttendance.get(d.id);
              return (
                <button key={d.id} onClick={() => setDealerSheet(d)}
                  className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-[#f2ece6]">{d.dealers?.full_name ?? "—"}</span>
                    <span className="block text-[12px] tabular-nums text-[#9b8e97]">vào ca {hhmm(d.check_in_time)}{table ? ` · ${table}` : ""}{d.current_state === "on_break" ? " · đang nghỉ" : ""}</span>
                  </span>
                  <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", chip.cls)}>{chip.label}</span>
                </button>
              );
            })}
          </div>
        )
      )}

      {/* D4a — Lịch dealer swing đã phát hành, chỉ xem trên phone */}
      {pill === "schedule" && (
        <div className="space-y-3">
          <div className="ios-card overflow-hidden p-4">
            <div className="flex items-start justify-between gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#c9a86a]/12 text-[#c9a86a]">
                <CalendarDays className="h-5 w-5" />
              </span>
              {selectedScheduleDay && (
                <span className="rounded-full bg-emerald-400/12 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                  Đã phát hành
                </span>
              )}
            </div>
            <h2 className="mt-3 text-[18px] font-semibold leading-tight text-[#f2ece6]">Lịch đã phát hành</h2>
            <p className="mt-1 text-[13px] leading-5 text-[#9b8e97]">
              {scheduleDateParts(selectedScheduleDate).full} · chỉ xem lịch đã được lưu và phát hành.
            </p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[
                { label: "lượt đã xếp", value: scheduleStats.total, cls: "text-sky-300" },
                { label: "đã xác nhận", value: scheduleStats.confirmed, cls: "text-emerald-300" },
                { label: "đã check-in", value: scheduleStats.arrived, cls: "text-[#c9a86a]" },
                { label: "đang chờ ca", value: scheduleStats.waiting, cls: "text-amber-300" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-white/8 bg-black/20 px-2.5 py-2">
                  <div className={cn("text-[20px] font-bold leading-none tabular-nums", stat.cls)}>{stat.value}</div>
                  <div className="mt-1 min-h-[26px] text-[10.5px] font-medium leading-[13px] text-[#91a49b]">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="ios-card p-3.5">
            <SectionLabel>7 ngày tới</SectionLabel>
            <div className="mt-2 grid grid-cols-7 gap-1.5">
              {scheduleDates.map((date) => {
                const parts = scheduleDateParts(date);
                const selected = date === selectedScheduleDate;
                const published = Boolean(scheduleQ.daysByDate[date]);
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => setSelectedScheduleDate(date)}
                    aria-pressed={selected}
                    className={cn(
                      "ios-press-sm relative rounded-2xl border px-1.5 py-2 text-center",
                      selected
                        ? "border-[#c9a86a]/60 bg-[#c9a86a]/15 text-[#f2ece6]"
                        : "border-white/8 bg-white/[0.035] text-[#9b8e97]",
                    )}
                  >
                    <span className="block text-[10px] font-semibold uppercase leading-none">{parts.weekday}</span>
                    <span className="mt-1 block text-[15px] font-semibold leading-none tabular-nums">{parts.day}</span>
                    {published && <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-emerald-300" />}
                  </button>
                );
              })}
            </div>
          </div>
          {phoneCompletionQ.allowed && tableVMs.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCloseTablesOpen(true)}
                className="ios-press ios-fill flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-semibold text-[#f2ece6]"
              >
                <FlagTriangleRight className="h-4 w-4 text-rose-300" /> Đóng bàn
              </button>
              <button
                type="button"
                onClick={() => { setReconcileInitialTableId(null); setReconcileOpen(true); }}
                className="ios-press ios-fill flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-semibold text-[#f2ece6]"
              >
                <ArrowRightLeft className="h-4 w-4 text-[#c9a86a]" /> Sửa sơ đồ
              </button>
            </div>
          )}

          {scheduleQ.loading ? (
            <div className="ios-card p-8 text-center text-[13px] text-[#9b8e97]">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-[#c9a86a]" />
              Đang tải lịch đã phát hành…
            </div>
          ) : scheduleQ.error ? (
            <div className="ios-card p-5 text-center">
              <AlertTriangle className="mx-auto h-6 w-6 text-rose-300" />
              <p className="mt-2 text-[13px] text-rose-200">{scheduleQ.error}</p>
              <button type="button" onClick={scheduleQ.refetch} className="ios-press ios-fill mt-3 rounded-xl px-4 py-2 text-[13px] font-semibold text-[#f2ece6]">
                Thử lại
              </button>
            </div>
          ) : !selectedScheduleDay ? (
            <Empty text="CLB chưa phát hành lịch cho ngày này." />
          ) : scheduleAssignments.length === 0 ? (
            <Empty text="Lịch đã phát hành nhưng chưa có dealer nào được xếp." />
          ) : (
            <div className="ios-group">
              {scheduleAssignments.map((assignment) => {
                const state = SCHEDULE_STATE[assignment.state];
                return (
                  <div key={assignment.id} className="ios-row-inset px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-semibold text-[#f2ece6]">{assignment.dealerName}</div>
                        <div className="mt-0.5 text-[12px] tabular-nums text-[#9b8e97]">
                          {hhmm(assignment.scheduledStartAt)}-{hhmm(assignment.scheduledEndAt)}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                        {assignment.late && <span className="rounded-full bg-rose-400/12 px-2 py-0.5 text-[10.5px] font-semibold text-rose-300">Đi trễ</span>}
                        <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold", state.cls)}>{state.label}</span>
                      </div>
                    </div>
                    {(assignment.arrivalAt || assignment.payrollStartAt) && (
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-[#91a49b]">
                        <span>Đến CLB <b className="font-semibold text-[#d8cec6]">{hhmm(assignment.arrivalAt)}</b></span>
                        <span>Bắt đầu công <b className="font-semibold text-[#d8cec6]">{hhmm(assignment.payrollStartAt)}</b></span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <button onClick={() => setPill("requests")} className="ios-press ios-fill flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl px-3 py-3 text-[13px] font-semibold text-[#f2ece6]">
            <Send className="h-4 w-4 text-[#c9a86a]" /> Xem yêu cầu đổi lịch
          </button>
        </div>
      )}

      {/* D4b — Yêu cầu xin ca/nghỉ: đọc live (useShiftPlanner) + duyệt/từ chối qua review_availability_request */}
      {pill === "requests" && (
        <div className="space-y-3">
          <div className="ios-card p-3.5">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-amber-400/12 text-amber-300">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-semibold text-[#f2ece6]">Yêu cầu lịch hôm nay</div>
                <div className="mt-1 text-[12px] leading-4 text-[#9b8e97]">Giữ semantic rõ: xanh là có thể xếp, vàng cần xác nhận, đỏ đụng final/thiếu người.</div>
              </div>
            </div>
          </div>

          {planQ.loading ? (
            <div className="ios-card p-6 text-center text-[13px] text-[#9b8e97]"><Loader2 className="mx-auto h-4 w-4 animate-spin" /> Đang tải yêu cầu…</div>
          ) : pendingReqs.length === 0 ? (
            <div className="ios-card p-6 text-center text-[13px] text-[#9b8e97]">Chưa có yêu cầu xin ca / nghỉ hôm nay.</div>
          ) : pendingReqs.map((r) => {
            const name = nameOf(r.dealerId);
            const decided = reqDecided[r.dealerId];
            const parts: string[] = [];
            if (r.preferredTemplateIds.length) parts.push(`Ưu tiên: ${r.preferredTemplateIds.map(labelOf).join(", ")}`);
            if (r.availableTemplateIds.length) parts.push(`Có thể: ${r.availableTemplateIds.map(labelOf).join(", ")}`);
            if (r.note) parts.push(r.note);
            return (
              <div key={r.dealerId} className="ios-card p-3.5">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#c9a86a]/25 bg-[#c9a86a]/10 text-[15px] font-bold text-[#c9a86a]">{name[0] ?? "?"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[15px] font-semibold text-[#f2ece6]">{name} · {r.leaveRequested ? "Xin nghỉ" : "Xin ca"}</div>
                        <div className="mt-1 text-[12px] leading-4 text-[#9b8e97]">{parts.join(" · ") || "—"}</div>
                      </div>
                      <ToneChip label={r.leaveRequested ? "nghỉ" : "xin ca"} tone={r.leaveRequested ? "warn" : "ok"} />
                    </div>
                    {decided ? (
                      <div className={cn("mt-3 text-[13px] font-semibold", decided === "acknowledged" ? "text-emerald-300" : "text-rose-300")}>
                        {decided === "acknowledged" ? "✓ Đã duyệt" : "✕ Đã từ chối"}
                      </div>
                    ) : (
                      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                        <button disabled={busy} onClick={() => doReviewRequest(r, "acknowledged")} className="ios-press ios-primary min-h-[42px] rounded-2xl px-3 text-[13px] font-bold disabled:opacity-50">Duyệt</button>
                        <button disabled={busy} onClick={() => doReviewRequest(r, "rejected")} className="ios-press ios-fill min-h-[42px] rounded-2xl px-3 text-[13px] font-semibold text-[#f2ece6] disabled:opacity-50">Từ chối</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          <button onClick={() => setPill("schedule")} className="ios-press ios-fill flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[14px] font-semibold text-[#f2ece6]">
            <CalendarDays className="h-4 w-4 text-[#c9a86a]" /> Quay lại lịch ca
          </button>
        </div>
      )}

      {/* D5 — Nhân sự ca (thật, số đếm) */}
      {pill === "staff" && (
        <div className="space-y-3">
          <div className="ios-card p-4">
            <Line l="Bàn đang mở" v={String(staff.openTables)} />
            <Line l="Dealer trong ca" v={String(staff.inShift)} vCls="text-emerald-300" />
            <Line l="Đang chia bàn" v={String(staff.assigned)} vCls="text-sky-300" />
            <Line l="Đang nghỉ" v={String(staff.on_break)} vCls="text-amber-300" />
            <Line l="Sẵn sàng" v={String(staff.available)} />
          </div>
          <div className="ios-group">
            {phoneCompletionQ.allowed && (
              <button onClick={() => setCheckinOpen(true)} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3.5 text-left">
                <QrCode className="h-5 w-5 text-[#d8bc85]" />
                <span className="min-w-0 flex-1"><span className="block text-[15px] text-[#f2ece6]">Check-in dealer mới</span><span className="block text-[12px] text-[#9b8e97]">quét QR, dán mã hoặc chọn danh sách</span></span>
              </button>
            )}
            <button onClick={() => setPill("schedule")} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <Monitor className="h-5 w-5 text-[#9b8e97]" />
              <span className="min-w-0 flex-1"><span className="block text-[15px] text-[#f2ece6]">Gợi ý điều phối &amp; xếp lịch</span><span className="block text-[12px] text-[#9b8e97]">xem bản mobile trong tab Lịch</span></span>
            </button>
          </div>
        </div>
      )}

      {/* D6 — Kết ca (thật roster) */}
      {pill === "close" && (
        <div className="space-y-3">
          <div className="ios-card p-3.5">
            <div className="text-[15px] font-semibold text-[#f2ece6]">Check-out hàng loạt</div>
            <div className="mt-0.5 text-[12px] text-[#9b8e97]">chọn dealer đã xong ca</div>
            <div className="mt-2.5 space-y-1">
              {roster.length === 0 ? <div className="py-4 text-center text-[13px] text-[#9b8e97]">Không có dealer đang trong ca.</div> : roster.map((d) => {
                const on = checkout.has(d.id);
                return (
                  <button key={d.id} onClick={() => setCheckout((s) => {
                    const n = new Set(s);
                    if (n.has(d.id)) n.delete(d.id);
                    else n.add(d.id);
                    return n;
                  })}
                    className="ios-press-sm flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left">
                    <span className={cn("grid h-5 w-5 place-items-center rounded-md border", on ? "border-[#c9a86a] bg-[#c9a86a] text-[#241A08]" : "border-white/20 text-transparent")}>✓</span>
                    <span className="flex-1 text-[14px] text-[#f2ece6]">{d.dealers?.full_name ?? "—"}</span>
                    <span className="text-[12px] tabular-nums text-[#9b8e97]">vào {hhmm(d.check_in_time)}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={() => doBatchCheckout([...checkout])} disabled={checkout.size === 0 || busy}
              className="ios-press ios-fill mt-2.5 w-full rounded-2xl py-2.5 text-[14px] font-medium text-[#f2ece6] disabled:opacity-40">
              Check-out {checkout.size} người đã chọn
            </button>
            <button onClick={() => doStaleCleanup([...checkout])} disabled={checkout.size === 0 || busy}
              className="ios-press mt-2 w-full rounded-2xl border border-amber-400/30 bg-amber-400/10 py-2.5 text-[13px] font-medium text-amber-200 disabled:opacity-40">
              Dọn ca treo {checkout.size ? `(${checkout.size})` : ""} · giữ nguyên lương/OT
            </button>
          </div>
          {(outQ.data ?? []).length > 0 && (
            <div className="ios-card p-3.5">
              <div className="text-[13px] text-[#9b8e97]">Đã check-out hôm nay</div>
              <div className="mt-1.5 space-y-1">
                {(outQ.data ?? []).map((d) => (
                  <div key={d.id} className="flex items-center justify-between py-0.5 text-[14px]">
                    <span className="text-[#9b8e97]">{d.dealers?.full_name ?? "—"}</span>
                    <span className="text-[12px] tabular-nums text-[#7c7079]">ra {hhmm(d.check_out_time)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="ios-card border border-rose-500/20 p-3.5">
            <div className="flex items-center gap-1.5 text-[15px] font-semibold text-rose-300"><FlagTriangleRight className="h-4 w-4" /> Đóng tour</div>
            <div className="mt-0.5 text-[12px] text-[#9b8e97]">chọn tour → gõ DONG TOUR. Lưu trữ toàn bộ ca + trả bàn về trống. Không hoàn tác.</div>
            {tourList === null ? (
              <div className="mt-2.5 text-center text-[12px] text-[#7c7079]">đang tải danh sách tour…</div>
            ) : tourList.length === 0 ? (
              <div className="mt-2.5 text-center text-[12px] text-[#7c7079]">Không có tour nào.</div>
            ) : (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {tourList.map((t) => (
                  <button key={t.id} onClick={() => { setTourToClose(t.id); setDongTour(""); }}
                    className={cn("ios-press-sm rounded-full px-3 py-1.5 text-[12px] font-medium", tourToClose === t.id ? "border border-rose-400/40 bg-rose-500/20 text-rose-200" : "bg-white/5 text-[#9b8e97]")}>
                    {t.name}
                  </button>
                ))}
              </div>
            )}
            {tourToClose && (() => {
              const t = tourList?.find((x) => x.id === tourToClose);
              if (!t) return null;
              return (
                <>
                  <div className="mt-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[12px] text-[#d8cbd3]" role="status">
                    {tourCloseReadinessLoading ? "Đang kiểm tra phiên bàn và hand trên server…" :
                      tourCloseReadinessError ? `Không kiểm tra được: ${tourCloseReadinessError}` :
                      tourCloseReadiness?.alreadyClosed ? "Tour đã được đóng." :
                      tourCloseReadiness?.ready ? "Các bàn đã an toàn để đóng tour." :
                      tourCloseReadiness?.blockers.length
                        ? `Cần xử lý trong Floor: ${describeCloseBlockers(tourCloseReadiness.blockers)}`
                        : "Chưa có kết quả kiểm tra từ server."}
                  </div>
                  <input value={dongTour} onChange={(e) => setDongTour(e.target.value.toUpperCase())} placeholder="gõ  DONG TOUR  để mở khoá"
                    className="ios-fill mt-2.5 w-full rounded-xl px-3 py-2.5 text-center text-[14px] font-semibold tracking-normal text-[#f2ece6] outline-none placeholder:text-[#7c7079]" />
                  <button disabled={dongTour.trim() !== "DONG TOUR" || busy || tourCloseReadinessLoading
                    || !tourCloseReadiness?.ok || !tourCloseReadiness.ready || tourCloseReadiness.alreadyClosed}
                    onClick={() => doCloseTour(t)}
                    className={cn("ios-press mt-2.5 w-full rounded-2xl py-3 text-[15px] font-bold", dongTour.trim() === "DONG TOUR" ? "bg-rose-500/90 text-white" : "bg-white/5 text-[#5f545c]")}>
                    Đóng tour {t.name} {dongTour.trim() !== "DONG TOUR" && "(đang khoá)"}
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* D2 — sheet bàn */}
      <Sheet open={tableSheet !== null} onOpenChange={(v) => { if (!v) setTableSheet(null); }}>
        <SheetContent side="bottom" className="ops-sheet rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">
              {tableSheet?.name}
              {tableSheet && (tableSheet.missing || tableSheet.assignment?.isOverdue) && <span className="ml-2 rounded-full bg-rose-400/12 px-2 py-0.5 text-[11px] font-semibold text-rose-300">{tableSheet.missing ? "Thiếu dealer" : "OT"}</span>}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-0.5 text-center text-[13px] tabular-nums text-[#9b8e97]">{tableSheet?.dealer ?? "—"} · vào {tableSheet?.since}</div>
          {tableSheet?.next && (
            <div className="ios-card mt-3 flex items-center gap-2 px-3.5 py-2.5 text-[13px]">
              <Lightbulb className="h-4 w-4 text-[#d8bc85]" />
              <span className="text-[#d8bc85]">Kế tiếp theo lịch: <b>{tableSheet.next}</b></span>
            </div>
          )}
          <div className="mt-3 space-y-1.5">
            <button disabled={busy} onClick={() => { if (!tableSheet) return; tableSheet.missing ? go(setPickFor, tableSheet) : doSwing(tableSheet); }}
              className="ios-press ios-primary flex w-full items-center gap-3 rounded-2xl p-3.5 text-left disabled:opacity-50">
              <Repeat className="h-5 w-5 shrink-0" />
              <span className="text-[15px] font-bold">{tableSheet?.missing ? "Gán dealer ngay" : `Swing ngay${tableSheet?.next ? ` — ${tableSheet.next} vào thay` : ""}`}</span>
            </button>
            <SheetRow icon={<Users className="h-5 w-5 text-sky-300" />} label="Chọn dealer khác…" onTap={() => go(setPickFor, tableSheet)} />
            {tableSheet?.assignment?.attendance_id && (
              <SheetRow icon={<Coffee className="h-5 w-5 text-amber-300" />} label={`Cho ${tableSheet.dealer ?? "dealer"} nghỉ`}
                onTap={() => go(setBreakFor, { attendanceId: tableSheet.assignment!.attendance_id, clubId: tableSheet.clubId, name: tableSheet.dealer ?? "dealer" })} />
            )}
            {phoneCompletionQ.allowed && (
              <SheetRow
                icon={<ArrowRightLeft className="h-5 w-5 text-[#9b8e97]" />}
                label="Sửa nhầm bàn (mở sơ đồ)"
                onTap={() => {
                  const tableId = tableSheet?.id ?? null;
                  setTableSheet(null);
                  setReconcileInitialTableId(tableId);
                  setReconcileOpen(true);
                }}
              />
            )}
            <SheetRow icon={<History className="h-5 w-5 text-[#9b8e97]" />} label="Lịch sử bàn này" onTap={() => tableSheet && openTableHistory(tableSheet)} />
          </div>
        </SheetContent>
      </Sheet>

      {/* D4 — sheet dealer */}
      <Sheet open={dealerSheet !== null} onOpenChange={(v) => { if (!v) setDealerSheet(null); }}>
        <SheetContent side="bottom" className="ops-sheet rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="items-center text-center">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-sky-400 bg-[#241A2C] text-[15px] font-semibold text-sky-300">
              {(dealerSheet?.dealers?.full_name ?? "?").slice(0, 2)}
            </div>
            <SheetTitle className="mt-1.5 text-[16px] font-semibold text-[#f2ece6]">
              {dealerSheet?.dealers?.full_name} {dealerSheet && <span className={cn("ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", (DEALER_CHIP[dealerSheet.current_state] ?? DEALER_CHIP.available).cls)}>{(DEALER_CHIP[dealerSheet.current_state] ?? DEALER_CHIP.available).label}</span>}
            </SheetTitle>
            <div className="text-[12px] tabular-nums text-[#9b8e97]">vào ca {hhmm(dealerSheet?.check_in_time)}{dealerSheet && tableByAttendance.get(dealerSheet.id) ? ` · ${tableByAttendance.get(dealerSheet.id)}` : ""}</div>
          </SheetHeader>
          <div className="mt-3 space-y-1.5">
            <button disabled={busy} onClick={() => dealerSheet && go(setPlaceFor, dealerSheet)}
              className="ios-press ios-primary flex w-full items-center gap-3 rounded-2xl p-3.5 text-left disabled:opacity-50">
              <ArrowRight className="h-5 w-5 shrink-0" /><span className="text-[15px] font-bold">Đưa vào bàn…</span>
            </button>
            <SheetRow icon={<Coffee className="h-5 w-5 text-amber-300" />} label="Cho nghỉ ưu tiên"
              onTap={() => dealerSheet && go(setBreakFor, { attendanceId: dealerSheet.id, clubId: dealerSheet.dealers.club_id, name: dealerSheet.dealers.full_name })} />
            <SheetRow icon={<Clock className="h-5 w-5 text-[#9b8e97]" />} label="Ca hôm nay — giờ vào/ra, số bàn đã chia" onTap={() => dealerSheet && openShiftToday(dealerSheet)} />
            <SheetRow icon={<LogOut className="h-5 w-5 text-rose-300" />} label={<span className="text-rose-300">Check-out khỏi ca</span>} onTap={() => dealerSheet && doCheckoutOne(dealerSheet)} />
          </div>
        </SheetContent>
      </Sheet>

      {/* P1 — chọn dealer khác (roster sẵn sàng) */}
      <Sheet open={pickFor !== null} onOpenChange={(v) => { if (!v) setPickFor(null); }}>
        <SheetContent side="bottom" className="ops-sheet rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Chọn dealer vào {pickFor?.name}</SheetTitle></SheetHeader>
          <div className="ios-group mt-3">
            {roster.filter((d) => d.current_state === "available" || d.current_state === "on_break").length === 0
              ? <div className="px-4 py-6 text-center text-[13px] text-[#9b8e97]">Không có dealer đang rảnh.</div>
              : roster.filter((d) => d.current_state === "available" || d.current_state === "on_break").map((d) => {
                const locked = d.current_state !== "available";
                return (
                  <button key={d.id} disabled={locked || busy} onClick={() => pickFor && doAssign(pickFor, d)}
                    className={cn("ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left", !locked && "ios-press-sm", locked && "opacity-55")}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] text-[#f2ece6]">{d.dealers?.full_name ?? "—"}</span>
                      <span className="block text-[12px] tabular-nums text-[#9b8e97]">vào ca {hhmm(d.check_in_time)}{locked ? " · đang nghỉ" : ""}</span>
                    </span>
                    {locked ? <span className="rounded-full bg-white/6 px-2 py-0.5 text-[11px] text-[#9b8e97]">nghỉ</span> : <span className="text-[13px] text-[#c9a86a]">chọn</span>}
                  </button>
                );
              })}
          </div>
          <div className="mt-2.5 text-center text-[12px] text-[#7c7079]">luật nghỉ 15p sẽ được server kiểm khi bật nút thật</div>
        </SheetContent>
      </Sheet>

      {/* break picker */}
      <Sheet open={breakFor !== null} onOpenChange={(v) => { if (!v) setBreakFor(null); }}>
        <SheetContent side="bottom" className="ops-sheet rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Cho {breakFor?.name} nghỉ</SheetTitle></SheetHeader>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {BREAK_PRESETS.map((m) => (
              <button key={m} disabled={busy} onClick={() => breakFor && doBreak(breakFor, m)} className="ios-press ios-fill rounded-2xl py-3 text-center text-[15px] font-semibold text-[#f2ece6] disabled:opacity-50">{m}p</button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* gợi ý dealer — bước 1: chọn bàn đang thiếu người */}
      <Sheet open={suggestTableOpen} onOpenChange={setSuggestTableOpen}>
        <SheetContent side="bottom" className="ops-sheet rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Gợi ý dealer cho bàn nào?</SheetTitle></SheetHeader>
          <div className="ios-group mt-3">
            {tableVMs.filter((t) => t.missing).length === 0
              ? <div className="px-4 py-6 text-center text-[13px] text-[#9b8e97]">Không có bàn nào đang thiếu dealer.</div>
              : tableVMs.filter((t) => t.missing).map((t) => (
                <button key={t.id} onClick={() => { setSuggestTableOpen(false); openSuggest(t); }}
                  className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left">
                  <span className="min-w-0 flex-1"><span className="block text-[15px] text-[#f2ece6]">{t.name}</span><span className="block text-[12px] text-rose-300">chưa có dealer</span></span>
                  <span className="text-[13px] text-[#c9a86a]">chọn</span>
                </button>
              ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* gợi ý dealer — bước 2: xếp hạng thật từ edge assign-dealer (chạm 1 dealer = gán) */}
      <Sheet open={pickSuggestFor !== null} onOpenChange={(v) => { if (!v) { setPickSuggestFor(null); setSuggests(null); } }}>
        <SheetContent side="bottom" className="ops-sheet rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Chọn dealer vào {pickSuggestFor?.name}</SheetTitle></SheetHeader>
          <div className="mt-1 text-center text-[12px] leading-4 text-[#9b8e97]">Điểm xếp hạng theo nghỉ đủ · ưu tiên ca · tier (server tính). Chạm 1 dealer để gán.</div>
          {suggestLoading ? (
            <div className="mt-3 flex items-center justify-center gap-2 py-6 text-[13px] text-[#9b8e97]"><Loader2 className="h-4 w-4 animate-spin" /> Đang xếp hạng…</div>
          ) : !suggests || suggests.length === 0 ? (
            <div className="mt-3 py-6 text-center text-[13px] text-[#9b8e97]">Không có dealer sẵn sàng cho bàn này.</div>
          ) : (
            <div className="ios-group mt-3 max-h-[52vh] overflow-y-auto">
              {suggests.map((s) => (
                <button key={s.dealer_id} disabled={busy}
                  onClick={() => pickSuggestFor && doAssignById(pickSuggestFor, s.dealer_id, s.dealer_name)}
                  className="ios-press-sm ios-row-inset flex w-full items-start gap-3 px-4 py-3 text-left disabled:opacity-50">
                  <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#c9a86a]/35 bg-[#c9a86a]/12 text-[13px] font-bold text-[#c9a86a]">{s.score ?? "—"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-[#f2ece6]">{s.dealer_name}{s.tier ? ` · ${s.tier}` : ""}</span>
                    {s.reason && <span className="mt-1 block text-[12px] leading-4 text-[#9b8e97]">{s.reason}</span>}
                  </span>
                  <span className="mt-1 rounded-full bg-[#c9a86a]/12 px-2.5 py-1 text-[11px] font-semibold text-[#c9a86a]">gán</span>
                </button>
              ))}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Lịch sử bàn này — chuỗi dealer đã ngồi (read-only) */}
      <Sheet open={histTable !== null} onOpenChange={(v) => { if (!v) { setHistTable(null); setHistRows(null); } }}>
        <SheetContent side="bottom" className="ops-sheet rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Lịch sử {histTable?.name}</SheetTitle></SheetHeader>
          {histRows === null ? (
            <div className="mt-3 flex items-center justify-center gap-2 py-6 text-[13px] text-[#9b8e97]"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải…</div>
          ) : histRows.length === 0 ? (
            <div className="mt-3 py-6 text-center text-[13px] text-[#9b8e97]">Chưa có lịch sử bàn này.</div>
          ) : (
            <div className="ios-group mt-3 max-h-[56vh] overflow-y-auto">
              {histRows.map((h) => (
                <div key={h.id} className="ios-row-inset flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-[#f2ece6]">{h.dealer_attendance?.dealers?.full_name ?? "—"}</span>
                    <span className="block text-[12px] tabular-nums text-[#9b8e97]">vào {hhmm(h.assigned_at)} → {h.released_at ? `ra ${hhmm(h.released_at)}` : "đang chia"}</span>
                  </span>
                  <span className="text-[11px] text-[#7c7079]">{h.status}</span>
                </div>
              ))}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Ca hôm nay — giờ vào/ra + bàn đã chia (read-only) */}
      <Sheet open={shiftDealer !== null} onOpenChange={(v) => { if (!v) { setShiftDealer(null); setShiftRows(null); } }}>
        <SheetContent side="bottom" className="ops-sheet rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Ca hôm nay — {shiftDealer?.dealers?.full_name}</SheetTitle></SheetHeader>
          <div className="mt-1 text-center text-[12px] tabular-nums text-[#9b8e97]">
            vào {hhmm(shiftDealer?.check_in_time)} · ra {shiftDealer?.check_out_time ? hhmm(shiftDealer.check_out_time) : "—"} · số bàn đã chia: {shiftRows?.length ?? "…"}
          </div>
          {shiftRows === null ? (
            <div className="mt-3 flex items-center justify-center gap-2 py-6 text-[13px] text-[#9b8e97]"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải…</div>
          ) : shiftRows.length === 0 ? (
            <div className="mt-3 py-6 text-center text-[13px] text-[#9b8e97]">Chưa chia bàn nào hôm nay.</div>
          ) : (
            <div className="ios-group mt-3 max-h-[52vh] overflow-y-auto">
              {shiftRows.map((s) => (
                <div key={s.id} className="ios-row-inset flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1 text-[15px] text-[#f2ece6]">{s.game_tables?.table_name ?? "—"}</span>
                  <span className="text-[12px] tabular-nums text-[#9b8e97]">{hhmm(s.assigned_at)} → {s.released_at ? hhmm(s.released_at) : "đang chia"}</span>
                </div>
              ))}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* đưa dealer vào bàn — chọn bàn đang thiếu người */}
      <Sheet open={placeFor !== null} onOpenChange={(v) => { if (!v) setPlaceFor(null); }}>
        <SheetContent side="bottom" className="ops-sheet rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Đưa {placeFor?.dealers?.full_name} vào bàn</SheetTitle></SheetHeader>
          <div className="ios-group mt-3">
            {tableVMs.filter((t) => t.missing).length === 0
              ? <div className="px-4 py-6 text-center text-[13px] text-[#9b8e97]">Không có bàn nào đang thiếu dealer.</div>
              : tableVMs.filter((t) => t.missing).map((t) => (
                <button key={t.id} disabled={busy} onClick={() => { const d = placeFor; setPlaceFor(null); if (d) doAssign(t, d); }}
                  className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-50">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-[#f2ece6]">{t.name}</span>
                    <span className="block text-[12px] text-rose-300">chưa có dealer</span>
                  </span>
                  <span className="text-[13px] text-[#c9a86a]">chọn</span>
                </button>
              ))}
          </div>
          <div className="mt-2.5 text-center text-[12px] text-[#7c7079]">chỉ hiện bàn đang thiếu dealer · luật nghỉ do server kiểm</div>
        </SheetContent>
      </Sheet>

      {phoneCompletionQ.allowed && (
        <DealerPhoneCheckinSheet
          actorId={user?.id??null}
          open={checkinOpen}
          activeClubId={activeClubId}
          scheduleAssignments={todayScheduleAssignments}
          onOpenChange={setCheckinOpen}
          onCompleted={() => { reloadAll(); scheduleQ.refetch(); }}
          onRolloutDisabled={phoneCompletionQ.refetch}
        />
      )}
      {phoneCompletionQ.allowed && (
        <DealerPhoneCloseTablesSheet
          open={closeTablesOpen}
          activeClubId={activeClubId}
          tables={phoneCloseTables}
          onOpenChange={setCloseTablesOpen}
          onCompleted={reloadAll}
          onConflict={reloadAll}
          onRolloutDisabled={phoneCompletionQ.refetch}
        />
      )}
      {phoneCompletionQ.allowed && (
        <DealerPhoneReconcileSheet
          open={reconcileOpen}
          activeClubId={activeClubId}
          initialTableId={reconcileInitialTableId}
          tables={phoneReconcileTables}
          dealers={phoneReconcileDealers}
          onOpenChange={(nextOpen) => {
            setReconcileOpen(nextOpen);
            if (!nextOpen) setReconcileInitialTableId(null);
          }}
          onApplied={reloadAll}
          onRaceLost={reloadAll}
          onRolloutDisabled={phoneCompletionQ.refetch}
        />
      )}
    </div>
  );
}

interface TableVM {
  id: string; clubId: string; tableSessionId: string | null; name: string;
  assignment: EnrichedAssignment | null;
  dealer: string | null; next: string | null; missing: boolean; since: string;
}

function rank(t: TableVM) {
  if (t.missing) return -1000;
  if (t.assignment?.isOverdue) return -500;
  return t.assignment?.minutesLeft ?? 9999;
}
function countdown(t: TableVM) {
  const a = t.assignment;
  if (!a || a.minutesLeft == null) return { text: "—", cls: "text-[#9b8e97]" };
  if (a.isOverdue) return { text: "OT", cls: "text-rose-300" };
  const m = Math.floor(a.minutesLeft);
  const s = (a.secondsLeft ?? 0) % 60;
  const cls = m < 5 ? "text-amber-300" : "text-emerald-300";
  return { text: `còn ${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`, cls };
}

function ToneChip({ label, tone }: { label: string; tone: ScheduleTone }) {
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold", toneCls[tone])}>{label}</span>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase leading-none text-[#91a49b]">{children}</div>;
}

function Line({ l, v, vCls }: { l: string; v: string; vCls?: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-[14px]">
      <span className="text-[#9b8e97]">{l}</span>
      <span className={cn("text-[16px] font-semibold tabular-nums", vCls ?? "text-[#f2ece6]")}>{v}</span>
    </div>
  );
}
function SheetRow({ icon, label, onTap }: { icon: React.ReactNode; label: React.ReactNode; onTap: () => void }) {
  return (
    <button onClick={onTap} className="ios-press ios-fill flex w-full items-center gap-3 rounded-2xl p-3.5 text-left">
      {icon}<span className="text-[15px] text-[#f2ece6]">{label}</span>
    </button>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="ios-card py-10 text-center text-[14px] text-[#9b8e97]">{text}</div>;
}
function ClubPicker({ clubs, onSelect, onBack }: { clubs: OperatorClubRow[]; onSelect: (clubId: string) => void; onBack: () => void }) {
  return (
    <div className="ios-in space-y-4 pt-1">
      <header className="px-1">
        <button onClick={onBack} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> App chính
        </button>
        <h1 className="mt-1 text-[26px] font-bold leading-tight text-[#f2ece6]">Dealer Swing</h1>
        <p className="mt-0.5 text-[14px] text-[#9b8e97]">Chọn CLB cần điều hành trong ca này.</p>
      </header>
      <div className="ios-group">
        {clubs.map((club) => (
          <button
            key={club.id}
            type="button"
            onClick={() => onSelect(club.id)}
            className="ios-press-sm ios-row-inset flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
          >
            <span className="min-w-0 truncate text-[15px] font-semibold text-[#f2ece6]">{club.name}</span>
            <ArrowRight className="h-4 w-4 shrink-0 text-[#c9a86a]" />
          </button>
        ))}
      </div>
    </div>
  );
}
function Guard({ icon, title, sub, onBack }: { icon: React.ReactNode; title: string; sub: string; onBack: () => void }) {
  return (
    <div className="ios-in space-y-4 pt-1">
      <header className="px-1">
        <button onClick={onBack} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> App chính
        </button>
        <h1 className="mt-1 text-[26px] font-bold leading-tight text-[#f2ece6]">Dealer Swing</h1>
      </header>
      <div className="ios-card flex flex-col items-center gap-2 py-12 text-center">
        {icon}
        <div className="mt-1 text-[16px] font-semibold text-[#f2ece6]">{title}</div>
        <div className="max-w-[260px] text-[13px] text-[#9b8e97]">{sub}</div>
      </div>
    </div>
  );
}
