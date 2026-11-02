import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Calculator, Loader2, Lock, Save, Pencil, AlertTriangle, RefreshCw, Plus, Trash2, Upload, Wand2, Undo2 } from "lucide-react";
import { FEATURES } from "@/lib/featureFlags";
import { parseFileToCustomRows } from "@/lib/customPayoutImport";
import { seedCustomLadder, suggestLadderFromRank1, type SuggestedLadder, type SuggestShape } from "@/lib/payoutSuggest";
import { groupPayoutRows } from "@/lib/tv/payoutBands";
import { PrizePayoutTrackingSection } from "./PrizePayoutTrackingSection";
import { SatellitePayoutEditor } from "./SatellitePayoutEditor";
import { SatelliteAwardPlanPanel } from "./SatelliteAwardPlanPanel";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { payoutEditBackend } from "@/lib/payoutEditIntent";
import { usePayoutEditIntent } from "@/hooks/usePayoutEditIntent";

// PR-3: flag-gated (FEATURES.payoutEngine) operator UI for the "Engine 3-neo" payout backend
// (PR-2a RPCs + PR-2b compute-payouts Edge). Forecast preview (no persist) · one-way close-and-
// generate official · guarded manual edit. Renders ONLY when payoutEngine is ON; otherwise the
// old PrizeStructurePanel is shown unchanged (see PrizesTab).

type Archetype = "DAILY" | "INTL" | "MULTI" | "TRITON" | "CUSTOM" | "LIVE_STANDARD";
const ARCHE_LABEL: Record<Archetype, string> = { DAILY: "DAILY (top nặng · 2×)", INTL: "INTL (phẳng · 2×)", MULTI: "MULTI (phẳng · 1.5×)", TRITON: "TRITON (tham khảo)", CUSTOM: "CUSTOM — CLB tự cấu hình", LIVE_STANDARD: "LIVE STANDARD (final table riêng · ngoài FT theo nhóm)" };
const DEFAULT_MINCASH: Record<Archetype, number> = { DAILY: 2, INTL: 2, MULTI: 1.5, TRITON: 1.6, CUSTOM: 2, LIVE_STANDARD: 2 };

interface PayoutRow { position: number; amount: number; percentage: number; }
interface EngineResult { rows: PayoutRow[]; itmPlaces: number; effectiveFloor: number; prizePool?: number; archetype: Archetype; warnings: string[]; }
interface PayoutTemplateRow { id: string; name: string; custom_percents: { position: number; percent_bp: number }[] | null; rounding_unit: number | null; min_cash_x: number | null; }

const ERR_VI: Record<string, string> = {
  REGISTRATION_CLOSED: "Đăng ký đã đóng — không thể tạo entry mới.",
  REGISTRATION_NOT_CLOSED: "Chưa đóng đăng ký — không thể chốt payout.",
  SUM_MISMATCH: "Tổng tiền không khớp prize pool đã chốt.",
  RUN_NOT_DRAFT: "Bản payout này đã được áp dụng — không chạy lại được.",
  RUN_NOT_FOUND: "Không tìm thấy bản nháp payout.",
  NOT_AUTHORIZED: "Bạn không có quyền (cần Owner/Admin/Cashier của CLB).",
  PAYOUT_AUTHORITY_UNVERIFIED: "Chưa xác minh được quyền trả thưởng do lỗi kết nối hệ thống. Tải lại để đối chiếu trước khi thử tiếp.",
  MANUAL_EDIT_REASON_REQUIRED: "Cần nhập lý do khi chỉnh tay.",
  PRIZE_POOL_OVERRIDE_REASON_REQUIRED: "Cần lý do khi sửa prize pool.",
  MULTIDAY_UNSUPPORTED: "Giải nhiều ngày chưa hỗ trợ payout tự động.",
  CUSTOM_SCHEMA_NOT_READY: "Chế độ CUSTOM chưa sẵn sàng (DB chưa được cập nhật).",
  NO_PAID_ENTRIES: "Chưa có entry đã trả tiền.",
  NO_APPLIED_RUN: "Chưa có payout chính thức để chỉnh tay.",
  PAYOUT_AMOUNT_EXCEEDS_COLUMN_LIMIT: "Một suất vượt giới hạn lưu trữ (>10 tỉ).",
  POOL_BELOW_MIN_CASH: "Pool nhỏ hơn min-cash — chỉ trả 1 suất.",
  NOT_MONOTONE: "Bảng payout phải giảm dần theo hạng.",
  POSITION_GAP_OR_DUP: "Hạng phải liên tục 1..N, không trùng/thiếu.",
};
function friendly(msg?: string): string {
  if (!msg) return "Lỗi không xác định";
  for (const k of Object.keys(ERR_VI)) if (msg.includes(k)) return `${ERR_VI[k]} (${k})`;
  return msg;
}
const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");

function payoutNumber(value: unknown): number {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return NaN;
  return Number(value);
}

function readOfficialPayout(prizes: unknown, run: unknown, tournamentId: string): { rows: PayoutRow[]; appliedRun: Record<string, unknown> | null } {
  const invalid = () => new Error("Dữ liệu payout chính thức không hợp lệ. Không thể tiếp tục; vui lòng kiểm tra và tải lại.");
  if (!Array.isArray(prizes)) throw invalid();
  const rows = prizes.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
    const position = payoutNumber(raw.position);
    const amount = payoutNumber(raw.amount);
    const percentage = payoutNumber(raw.percentage);
    if (!Number.isSafeInteger(position) || position < 1 || !Number.isSafeInteger(amount) || amount < 0
      || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) throw invalid();
    return { position, amount, percentage };
  }).sort((a, b) => a.position - b.position);
  if (rows.some((row, index) => row.position !== index + 1)) throw invalid();
  if (run === null) return { rows, appliedRun: null };
  if (!run || typeof run !== "object" || Array.isArray(run)) throw invalid();
  const appliedRun = run as Record<string, unknown>;
  const pool = payoutNumber(appliedRun.prize_pool_snapshot);
  const entries = payoutNumber(appliedRun.entries_snapshot);
  const places = payoutNumber(appliedRun.itm_places);
  if (typeof appliedRun.id !== "string" || !appliedRun.id.trim()
    || appliedRun.tournament_id !== tournamentId || appliedRun.status !== "applied"
    || !Number.isSafeInteger(pool) || pool < 0 || !Number.isSafeInteger(entries) || entries < 1
    || !Number.isSafeInteger(places) || places < 1 || places > entries || places !== rows.length
    || !["close", "regenerate", "manual_edit"].includes(String(appliedRun.source))
    || rows.reduce((sum, row) => sum + row.amount, 0) !== pool) throw invalid();
  return { rows, appliedRun };
}

function readPreparedPayout(raw: unknown, confirmed: {
  entries: number; buyIn: number; rake: number; pool: number; itm: number;
  archetype: Archetype; minCash: number; rounding: number;
}): string {
  const invalid = () => new Error("Snapshot payout không khớp cấu hình vừa xác nhận. Chưa áp dụng payout; tải lại và đối chiếu bản nháp trước khi tiếp tục.");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
  const row = raw as Record<string, unknown>;
  if (!["prepared", "resumed"].includes(String(row.status)) || typeof row.run_id !== "string" || !row.run_id.trim()
    || payoutNumber(row.entries_snapshot) !== confirmed.entries || !Number.isSafeInteger(confirmed.entries) || confirmed.entries < 1
    || payoutNumber(row.buy_in_snapshot) !== confirmed.buyIn || payoutNumber(row.rake_snapshot) !== confirmed.rake
    || payoutNumber(row.prize_pool_snapshot) !== confirmed.pool || !Number.isSafeInteger(confirmed.pool) || confirmed.pool <= 0
    || row.archetype !== confirmed.archetype || payoutNumber(row.itm_percent) !== confirmed.itm
    || payoutNumber(row.min_cash_x) !== confirmed.minCash || payoutNumber(row.rounding_unit) !== confirmed.rounding
    || !Number.isSafeInteger(payoutNumber(row.effective_floor)) || payoutNumber(row.effective_floor) < 0) throw invalid();
  return row.run_id;
}

interface FrozenPayoutDraft {
  id: string; tournament_id: string; status: "draft_snapshot"; archetype: Archetype;
  entries_snapshot: number; buy_in_snapshot: number; rake_snapshot: number; prize_pool_snapshot: number;
  effective_floor: number; itm_percent: number; min_cash_x: number; rounding_unit: number;
  custom_percents: { position: number; percent_bp: number }[] | null;
}
function readFrozenPayoutDraft(raw: unknown, tournamentId: string): FrozenPayoutDraft | null {
  if (raw === null) return null;
  const invalid = () => new Error("Dữ liệu bản nháp payout không hợp lệ. Tải lại để đối chiếu trước khi tiếp tục.");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id.trim() || row.tournament_id !== tournamentId || row.status !== "draft_snapshot"
    || !Object.prototype.hasOwnProperty.call(ARCHE_LABEL, String(row.archetype))) throw invalid();
  const numbers = Object.fromEntries(["entries_snapshot", "buy_in_snapshot", "rake_snapshot", "prize_pool_snapshot", "effective_floor", "itm_percent", "min_cash_x", "rounding_unit"]
    .map(key => [key, payoutNumber(row[key])])) as Pick<FrozenPayoutDraft, "entries_snapshot" | "buy_in_snapshot" | "rake_snapshot" | "prize_pool_snapshot" | "effective_floor" | "itm_percent" | "min_cash_x" | "rounding_unit">;
  if (![numbers.entries_snapshot, numbers.prize_pool_snapshot, numbers.rounding_unit].every(value => Number.isSafeInteger(value) && value > 0)
    || ![numbers.buy_in_snapshot, numbers.rake_snapshot, numbers.effective_floor].every(value => Number.isSafeInteger(value) && value >= 0)
    || !Number.isFinite(numbers.itm_percent) || numbers.itm_percent <= 0 || numbers.itm_percent > 1
    || !Number.isFinite(numbers.min_cash_x) || numbers.min_cash_x <= 0) throw invalid();
  let custom: FrozenPayoutDraft["custom_percents"] = null;
  if (row.archetype === "CUSTOM") {
    if (!Array.isArray(row.custom_percents) || !row.custom_percents.length || row.custom_percents.length > numbers.entries_snapshot) throw invalid();
    custom = row.custom_percents.map((item: unknown, index: number) => {
      if (!item || typeof item !== "object" || !("position" in item) || !("percent_bp" in item)) throw invalid();
      const position = payoutNumber(item.position), bp = payoutNumber(item.percent_bp);
      if (position !== index + 1 || !Number.isSafeInteger(bp) || bp <= 0 || bp > 10000) throw invalid();
      return { position, percent_bp: bp };
    });
    if (custom.reduce((sum, item) => sum + item.percent_bp, 0) !== 10000
      || custom.some((item, index) => index > 0 && item.percent_bp > custom![index - 1].percent_bp)) throw invalid();
  } else if (row.custom_percents != null) throw invalid();
  return {id: row.id, tournament_id: tournamentId, status: "draft_snapshot", archetype: row.archetype as Archetype, ...numbers, custom_percents: custom};
}

const SUGGEST_WARN_VI: Record<string, string> = {
  PLACES_REDUCED_BY_ENGINE: "Quỹ giải/min-cash chỉ đủ trả ít suất hơn — đã giảm số suất.",
  TARGET_BELOW_FLAT_MIN: "% hạng nhất thấp hơn mức chia đều — đã nâng lên mức tối thiểu.",
  TARGET_ABOVE_MAX: "% hạng nhất quá cao so với số suất/min-cash — đã hạ xuống mức tối đa.",
  FLOOR_ABOVE_FEASIBLE_MAX: "Min-cash quá cao cho số suất này — đã hạ sàn cho khả thi.",
  FLOOR_NOT_APPLIED_NO_POOL: "Chưa có số entry → chưa dùng min-cash làm sàn (chia theo % thuần).",
  TAIL_BELOW_GUIDANCE: "Hạng chót thấp hơn min-cash tham khảo (CUSTOM cho phép).",
  TARGET_SHIFTED_BY_INTEGER_ROUNDING: "Làm tròn khiến % hạng nhất lệch nhẹ so với yêu cầu.",
};

interface TournamentRow {
  id: string; buy_in: number; rake_amount: number | null; prize_pool: number | null; itm_places: number | null;
  registration_closed_at: string | null; live_status: string | null; event_id: string | null; club_id: string;
  planned_itm_percent?: number | null; planned_payout_archetype?: string | null;
  planned_min_cash_x?: number | null; planned_rounding_unit?: number | null;
  operations_mode?: string;
}

export function PayoutEnginePanel({ tournamentId }: { tournamentId: string }) {
  const { user, session } = useAuth();
  let backend = "invalid";
  try { backend = payoutEditBackend(import.meta.env.VITE_SUPABASE_URL); } catch { /* Never put credentials or invalid config into the key. */ }
  // A changed actor/session must retire the old two-step writer as well as reads.
  return <TournamentPayoutPanel key={JSON.stringify([backend, tournamentId, user?.id, sessionReadEpoch(session)])} tournamentId={tournamentId} />;
}

function TournamentPayoutPanel({ tournamentId }: { tournamentId: string }) {
  const { user } = useAuth();
  const active = useRef(false);
  const loadController = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tour, setTour] = useState<TournamentRow | null>(null);
  const [officialRows, setOfficialRows] = useState<PayoutRow[]>([]);
  const [appliedRun, setAppliedRun] = useState<any | null>(null);
  const [draftRun, setDraftRun] = useState<FrozenPayoutDraft | null>(null);
  const [liveEntries, setLiveEntries] = useState<number>(0);

  // generator inputs
  const [entries, setEntries] = useState<number>(0);
  const [itmPct, setItmPct] = useState<number>(15); // percent in the UI; sent as /100
  const [archetype, setArchetype] = useState<Archetype>("DAILY");
  const [minCashX, setMinCashX] = useState<number>(2);
  const [roundingUnit, setRoundingUnit] = useState<number>(100000);
  const [poolOverride, setPoolOverride] = useState<string>(""); // empty = auto
  const [overrideReason, setOverrideReason] = useState<string>("");
  // CUSTOM mode (gated by FEATURES.payoutCustomMode): club enters its own % per rank.
  const customMode = FEATURES.payoutCustomMode;
  const [customRows, setCustomRows] = useState<{ position: number; percent: number }[]>([
    { position: 1, percent: 50 }, { position: 2, percent: 30 }, { position: 3, percent: 20 },
  ]);
  // CUSTOM extras (gated by FEATURES.payoutCustomTemplates): import Excel/CSV + save/load templates.
  const customTemplates = FEATURES.payoutCustomTemplates;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [templates, setTemplates] = useState<PayoutTemplateRow[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [savingTpl, setSavingTpl] = useState(false);
  // Planned settings (gated by FEATURES.payoutPlannedSettings): pre-fill from tournaments.planned_*
  // once per tournament (before any official payout), then a "save default" button writes them back.
  const plannedAppliedRef = useRef(false);
  const plannedMinCashRef = useRef<number | null>(null);
  const [savingPlanned, setSavingPlanned] = useState(false);
  // Auto-suggest CUSTOM ladder (gated by FEATURES.payoutCustomSuggest): pre-fill customRows from a
  // shape preset OR a target top-prize % — client-only, editable after. N auto-derives from ITM until
  // the operator edits it (dirty ref). Snapshot before apply → "Hoàn tác gợi ý".
  const suggestOn = FEATURES.payoutCustomSuggest;
  const [suggestShape, setSuggestShape] = useState<SuggestShape>("DAILY");
  const [rank1Input, setRank1Input] = useState("22");
  const [suggestN, setSuggestN] = useState(3);
  const suggestNDirtyRef = useRef(false);
  const [lastSuggest, setLastSuggest] = useState<SuggestedLadder | null>(null);
  const undoRowsRef = useRef<{ position: number; percent: number }[] | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  const [preview, setPreview] = useState<EngineResult | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "official">("");
  const officialInFlight = useRef(false);

  // manual edit
  const [editing, setEditing] = useState(false);
  const [editRows, setEditRows] = useState<PayoutRow[]>([]);
  const [editReason, setEditReason] = useState("");
  const [editBase, setEditBase] = useState<{runId: string; pool: number} | null>(null);

  const isClosed = !!tour?.registration_closed_at || tour?.live_status === "finished";
  const hasOfficial = officialRows.length > 0;
  const isMultiDay = !!tour?.event_id;
  const isSatellite = FEATURES.satelliteAwardsV1 && tour?.operations_mode === "satellite";
  const editedManually = appliedRun?.source === "manual_edit";
  const isCustom = archetype === "CUSTOM";

  const customBp = useCallback(
    () => customRows.map((r, i) => ({ position: i + 1, percent_bp: Math.round((Number(r.percent) || 0) * 100) })),
    [customRows],
  );
  const customBpTotal = useMemo(() => customBp().reduce((s, r) => s + r.percent_bp, 0), [customBp]);
  const customValid = useMemo(() => {
    const bp = customBp();
    if (bp.length < 1) return false;
    for (let i = 0; i < bp.length; i++) {
      if (!(bp[i].percent_bp > 0)) return false;
      if (i > 0 && bp[i].percent_bp > bp[i - 1].percent_bp) return false;
    }
    return customBpTotal === 10000;
  }, [customBp, customBpTotal]);

  const load = useCallback(async () => {
    if (!active.current) return;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const current = () => loadController.current === controller && !controller.signal.aborted;
    setLoading(true); setLoadError(null);
    try {
      // Satellite award plans do not depend on the one-day payout engine's prize/run
      // reads. Resolve the mode first so an unrelated payout-source failure cannot
      // hide the TD's locked Satellite decision. This preflight only runs when enabled.
      if (FEATURES.satelliteAwardsV1) {
        const { data: satelliteTour, error: modeError } = await observeTrackerContextRead(Promise.resolve((supabase as any)
          .from("tournaments").select("id, club_id, operations_mode, buy_in, rake_amount, prize_pool, itm_places, registration_closed_at, live_status, event_id")
          .eq("id", tournamentId).abortSignal(controller.signal).single()));
        if (!current()) return;
        if (modeError) throw modeError;
        if (satelliteTour?.operations_mode === "satellite") {
          setTour(satelliteTour as TournamentRow);
          return;
        }
      }
      const [{ data: t, error: te }, prizesRes, runRes, cntRes, draftRes] = await observeTrackerContextRead(Promise.all([
        // (supabase as any): registration_closed_at + planned_* are live (PR-2a) but not in the
        // generated types.ts (no regen) — treat tournaments as any here, same as the rows/entries reads.
        (supabase as any).from("tournaments").select(`id, buy_in, rake_amount, prize_pool, itm_places, registration_closed_at, live_status, event_id, club_id, planned_itm_percent, planned_payout_archetype, planned_min_cash_x, planned_rounding_unit${FEATURES.satelliteAwardsV1 ? ", operations_mode" : ""}`).eq("id", tournamentId).abortSignal(controller.signal).single(),
        (supabase.rpc as any)("get_tournament_prizes", { p_tournament_id: tournamentId }).abortSignal(controller.signal),
        (supabase as any).from("tournament_payout_runs").select("*").eq("tournament_id", tournamentId).eq("status", "applied").abortSignal(controller.signal).maybeSingle(),
        // Match prepare_payout_snapshot's COALESCE(status,'') eligibility, including legacy NULL.
        (supabase as any).from("tournament_entries").select("id", { count: "exact", head: true }).eq("tournament_id", tournamentId).or("status.is.null,status.not.in.(void,voided,cancelled,canceled,refunded,rejected)").abortSignal(controller.signal),
        supabase.from("tournament_payout_runs").select("*").eq("tournament_id", tournamentId).eq("status", "draft_snapshot").abortSignal(controller.signal).maybeSingle(),
      ]));
      if (!current()) return;
      if (te) throw te;
      if (prizesRes?.error) throw prizesRes.error;
      if (runRes?.error) throw runRes.error;
      if (cntRes?.error) throw cntRes.error;
      if (draftRes.error) throw draftRes.error;
      if (!t || t.id !== tournamentId || !Array.isArray(prizesRes?.data)
        || runRes?.data === undefined || !Number.isSafeInteger(cntRes?.count) || cntRes.count < 0) {
        throw new Error("Không tải được dữ liệu payout đầy đủ. Vui lòng thử lại.");
      }
      const { rows: prizes, appliedRun: validatedRun } = readOfficialPayout(prizesRes.data, runRes.data, tournamentId);
      const frozenDraft = readFrozenPayoutDraft(draftRes.data, tournamentId);
      setTour(t as TournamentRow);
      setOfficialRows(prizes);
      setAppliedRun(validatedRun);
      setDraftRun(validatedRun ? null : frozenDraft);
      const cnt = Number(cntRes?.count ?? 0);
      setLiveEntries(cnt);
      setEntries((prev) => (prev > 0 ? prev : cnt));
      setRoundingUnit((t as TournamentRow).buy_in < 2_000_000 ? 100_000 : 1_000_000);

      // PR-4: pre-fill the generator from tournaments.planned_* — ONCE per tournament, and only
      // before any official payout exists (a closed/edited tournament's real settings shouldn't
      // be silently overwritten by an old planned default).
      if (FEATURES.payoutPlannedSettings && !plannedAppliedRef.current && prizes.length === 0) {
        plannedAppliedRef.current = true;
        const pt = t as TournamentRow;
        const arche = pt.planned_payout_archetype as Archetype | null;
        // LIVE_STANDARD is no longer a selectable style (superseded — every preset now bands ranks
        // 10+ by default) so a stale planned_payout_archetype='LIVE_STANDARD' falls through to the
        // "else" branch below (only min-cash is pre-filled; archetype stays at its default).
        const archeAllowed = !!arche && (
          ["DAILY", "INTL", "MULTI", "TRITON"].includes(arche)
          || (arche === "CUSTOM" && FEATURES.payoutCustomMode)
        );
        if (pt.planned_min_cash_x != null) plannedMinCashRef.current = Number(pt.planned_min_cash_x);
        if (archeAllowed) setArchetype(arche as Archetype);
        else if (pt.planned_min_cash_x != null) setMinCashX(Number(pt.planned_min_cash_x));
        if (pt.planned_itm_percent != null) setItmPct(Number(pt.planned_itm_percent) * 100);
        if (pt.planned_rounding_unit != null) setRoundingUnit(Number(pt.planned_rounding_unit));
      }
      return { appliedRun: validatedRun, rows: prizes };
    } catch (e: any) {
      if (!current()) return;
      setLoadError(e?.message === "tracker_context_read_timeout"
        ? "Hết thời gian tải dữ liệu payout. Vui lòng tải lại." : e?.message || "Không tải được dữ liệu payout");
      controller.abort();
    } finally {
      if (loadController.current === controller) setLoading(false);
    }
  }, [tournamentId]);
  const manualEdit = usePayoutEditIntent(user?.id, tournamentId, load, () => { setEditing(false); setEditBase(null); });
  const savingEdit = manualEdit.busy;

  useEffect(() => { plannedAppliedRef.current = false; }, [tournamentId]);
  useEffect(() => {
    active.current = true;
    void load();
    return () => { active.current = false; loadController.current?.abort(); loadController.current = null; };
  }, [load]);
  // Số suất gợi ý tự bám ITM% × entries cho tới khi operator sửa tay (dirty ref) — không đè giá trị đã nhập.
  useEffect(() => {
    if (suggestNDirtyRef.current) return;
    const n = Math.ceil((entries * itmPct) / 100);
    if (Number.isFinite(n) && n >= 1) setSuggestN(n);
  }, [entries, itmPct]);
  // DEFAULT_MINCASH resets min-cash whenever the style changes; a pending planned_min_cash_x
  // (set just before setArchetype during PR-4 pre-fill, above) wins ONCE then is consumed, so a
  // later MANUAL style change still falls back to the archetype's normal default.
  useEffect(() => {
    setMinCashX(plannedMinCashRef.current ?? DEFAULT_MINCASH[archetype]);
    plannedMinCashRef.current = null;
  }, [archetype]);

  const savePlanned = useCallback(async () => {
    setSavingPlanned(true);
    try {
      // .select("id") = RETURNING: UPDATE bị RLS lọc → 0 row, KHÔNG error → nếu không bắt sẽ
      // toast success giả (cashier không có quyền UPDATE tournaments). SELECT rộng hơn UPDATE
      // (anon-read qual=true) nên ai UPDATE được chắc chắn nhận lại row — không có lỗi giả.
      const { data, error } = await (supabase as any).from("tournaments").update({
        planned_itm_percent: itmPct / 100, planned_payout_archetype: archetype,
        planned_min_cash_x: minCashX, planned_rounding_unit: roundingUnit,
      }).eq("id", tournamentId).select("id");
      if (error) { toast.error(/row-level security|permission|policy|denied/i.test(error.message) ? "Bạn không có quyền lưu mặc định cho giải này (cần TD/Chủ CLB)." : friendly(error.message)); return; }
      if (Array.isArray(data) && data.length === 0) {
        if (import.meta.env.DEV) console.warn("[save_planned_payout] zero-row update", { tournamentId, returnedRows: 0 });
        toast.error("Không có quyền lưu mặc định — cần tài khoản chủ CLB hoặc quyền điều hành sàn.");
        return;
      }
      if (!Array.isArray(data) || data.length !== 1 || data[0]?.id !== tournamentId) {
        toast.error("Chưa xác minh được kết quả lưu mặc định. Hãy tải lại giải để kiểm tra trước khi lưu lại.");
        return;
      }
      toast.success("Đã lưu mặc định payout cho giải này");
    } catch (e: any) { toast.error(friendly(e?.message)); } finally { setSavingPlanned(false); }
  }, [tournamentId, archetype, itmPct, minCashX, roundingUnit]);

  // ---- CUSTOM templates + file import (gated by FEATURES.payoutCustomTemplates) ----
  const loadTemplates = useCallback(async () => {
    if (!customTemplates || !tour?.club_id) return;
    const { data, error } = await (supabase as any)
      .from("payout_templates").select("id, name, custom_percents, rounding_unit, min_cash_x")
      .eq("club_id", tour.club_id).eq("archetype", "CUSTOM").order("created_at", { ascending: false });
    if (!error) setTemplates((data ?? []) as PayoutTemplateRow[]);
  }, [customTemplates, tour?.club_id]);
  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const handleFile = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const res = await parseFileToCustomRows(file);
      setArchetype("CUSTOM");
      setCustomRows(res.rows.map((r, i) => ({ position: i + 1, percent: r.percent })));
      toast.success(`Đã nạp ${res.rows.length} hạng từ file${res.warnings.length ? ` (${res.warnings.join(" ")})` : ""}`);
    } catch (e: any) {
      const map: Record<string, string> = {
        FILE_EMPTY: "File rỗng.", FILE_NO_NUMBERS: "Không tìm thấy số trong file.",
        FILE_SUM_ZERO: "Tổng bằng 0 — không hợp lệ.", FILE_TOO_MANY_ROWS: "File quá nhiều dòng.",
      };
      toast.error(map[e?.message] ?? `Không đọc được file: ${e?.message ?? ""}`);
    } finally { setImporting(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  }, []);

  const saveTemplate = useCallback(async () => {
    const name = templateName.trim();
    if (!name) { toast.error("Nhập tên mẫu"); return; }
    if (!customValid) { toast.error("Cấu hình % chưa hợp lệ — Σ phải = 100%, giảm dần, mỗi hạng > 0"); return; }
    if (!tour?.club_id) return;
    setSavingTpl(true);
    try {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { error } = await (supabase as any).from("payout_templates").insert({
        club_id: tour.club_id, name, archetype: "CUSTOM", custom_percents: customBp(),
        itm_percent: 0, min_cash_x: minCashX, rounding_unit: roundingUnit, created_by: uid,
      });
      if (error) { toast.error(/row-level security|permission|policy|denied/i.test(error.message) ? "Chỉ Chủ CLB/Admin mới lưu được mẫu." : friendly(error.message)); return; }
      toast.success(`Đã lưu mẫu "${name}"`);
      setTemplateName("");
      await loadTemplates();
    } catch (e: any) { toast.error(friendly(e?.message)); } finally { setSavingTpl(false); }
  }, [templateName, customValid, tour?.club_id, customBp, minCashX, roundingUnit, loadTemplates]);

  const loadTemplate = useCallback((id: string) => {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    const cps = (tpl.custom_percents ?? []).slice().sort((a, b) => a.position - b.position);
    if (!cps.length) { toast.error("Mẫu không có dữ liệu %"); return; }
    setArchetype("CUSTOM");
    setCustomRows(cps.map((c, i) => ({ position: i + 1, percent: c.percent_bp / 100 })));
    if (tpl.rounding_unit) setRoundingUnit(Number(tpl.rounding_unit));
    toast.success(`Đã nạp mẫu "${tpl.name}"`);
  }, [templates]);

  const deleteTemplate = useCallback(async (id: string) => {
    const { error } = await (supabase as any).from("payout_templates").delete().eq("id", id);
    if (error) { toast.error(/row-level security|permission|policy|denied/i.test(error.message) ? "Chỉ Chủ CLB/Admin mới xoá được mẫu." : friendly(error.message)); return; }
    toast.success("Đã xoá mẫu");
    await loadTemplates();
  }, [loadTemplates]);

  const defaultPool = useMemo(() => entries * (tour?.buy_in ?? 0), [entries, tour]);
  const officialDefaultPool = liveEntries * (tour?.buy_in ?? 0);
  const officialPool = poolOverride.trim() ? Number(poolOverride) : officialDefaultPool;

  // ---- Auto-suggest CUSTOM ladder (client-only pre-fill of customRows; server re-validates on chốt) ----
  const suggestPool = () => (poolOverride.trim() && Number(poolOverride) !== defaultPool ? Number(poolOverride) : defaultPool);
  const suggestFloorVnd = () => minCashX * ((tour?.buy_in ?? 0) + (tour?.rake_amount ?? 0));
  const applySuggest = (ladder: SuggestedLadder) => {
    undoRowsRef.current = customRows;          // snapshot for "Hoàn tác gợi ý"
    setCanUndo(true);
    setLastSuggest(ladder);
    suggestNDirtyRef.current = true;           // sau khi gợi ý, N do người dùng làm chủ
    setSuggestN(ladder.effectivePlaces);
    setCustomRows(ladder.percentsBp.map((bp, i) => ({ position: i + 1, percent: bp / 100 })));
  };
  const seedByShape = () => {
    const pool = suggestPool();
    const floor = suggestFloorVnd();
    if (!(entries > 0) || !(pool > 0) || !(floor > 0)) {
      toast.error("Cần số entry, prize pool và min-cash > 0 để gợi ý theo kiểu.");
      return;
    }
    try {
      applySuggest(seedCustomLadder({ entries, prizePool: pool, floor, requestedPlaces: Math.max(1, suggestN), roundingUnit, shape: suggestShape }));
    } catch (e: any) { toast.error(friendly(e?.message)); }
  };
  const suggestByRank1 = () => {
    const N = Math.max(1, Math.floor(suggestN));
    const target = Number(rank1Input);
    if (!(target > 0) || target > 100) { toast.error("% hạng nhất phải trong khoảng 0–100."); return; }
    const pool = suggestPool();
    const floorBp = pool > 0 ? Math.round((suggestFloorVnd() / pool) * 10000) : 0;
    try {
      const ladder = suggestLadderFromRank1({ targetRank1Bp: Math.round(target * 100), places: N, floorBp });
      if (pool <= 0 && !ladder.warnings.includes("FLOOR_NOT_APPLIED_NO_POOL")) ladder.warnings.push("FLOOR_NOT_APPLIED_NO_POOL");
      applySuggest(ladder);
    } catch (e: any) { toast.error(friendly(e?.message)); }
  };
  const undoSuggest = () => {
    if (!undoRowsRef.current) return;
    setCustomRows(undoRowsRef.current);
    undoRowsRef.current = null;
    setCanUndo(false);
    setLastSuggest(null);
  };

  function reqBody() {
    const body: Record<string, unknown> = {
      mode: "preview", tournament_id: tournamentId, archetype,
      min_cash_x: minCashX, rounding_unit: roundingUnit, entries_override: entries,
    };
    if (isCustom) body.custom_percents = customBp();
    else body.itm_percent = itmPct / 100;
    const ov = poolOverride.trim() ? Number(poolOverride) : null;
    if (ov != null && ov !== defaultPool) body.prize_pool_override = ov;
    return body;
  }

  const runPreview = useCallback(async () => {
    if (!(entries > 0)) { toast.error("Nhập số entry > 0 để xem trước"); return; }
    if (isCustom && !customValid) { toast.error("Cấu hình % chưa hợp lệ — Σ phải = 100%, giảm dần, mỗi hạng > 0"); return; }
    setBusy("preview");
    try {
      const { data, error } = await supabase.functions.invoke("compute-payouts", { body: reqBody() });
      const res = data as any;
      if (error || res?.error) { toast.error(friendly(res?.error || error?.message)); return; }
      setPreview({ rows: res.result.rows, itmPlaces: res.result.itmPlaces, effectiveFloor: res.result.effectiveFloor, prizePool: res.prizePool, archetype: res.result.archetype, warnings: res.result.warnings ?? [] });
    } catch (e: any) { toast.error(friendly(e?.message)); } finally { setBusy(""); }
  }, [entries, itmPct, archetype, minCashX, roundingUnit, poolOverride, defaultPool, tournamentId, isCustom, customValid, customBp]);

  // Official: close registration (one-way) via prepare_payout_snapshot, then compute-payouts official.
  const runOfficial = useCallback(async (confirmedDraft?: FrozenPayoutDraft) => {
    if (!active.current || officialInFlight.current) return;
    if (!confirmedDraft && isCustom && !customValid) { toast.error("Cấu hình % chưa hợp lệ — Σ phải = 100%, giảm dần, mỗi hạng > 0"); return; }
    if (!tour || (!confirmedDraft && (!Number.isSafeInteger(liveEntries) || liveEntries < 1 || !Number.isSafeInteger(officialPool) || officialPool <= 0))) {
      toast.error("Chưa xác minh được số entry đã trả tiền hoặc prize pool chính thức."); return;
    }
    if (!confirmedDraft && officialPool !== officialDefaultPool && !overrideReason.trim()) {
      toast.error(friendly("PRIZE_POOL_OVERRIDE_REASON_REQUIRED")); return;
    }
    officialInFlight.current = true;
    setBusy("official");
    let outcomeRunId: string | undefined;
    let outcomeError: string | undefined;
    let alreadyApplied = false;
    try {
      let runId: string;
      if (confirmedDraft) {
        const fresh = await observeTrackerContextRead(Promise.resolve(supabase.from("tournament_payout_runs")
          .select("*").eq("id", confirmedDraft.id).eq("tournament_id", tournamentId).eq("status", "draft_snapshot").maybeSingle()));
        if (!active.current) return;
        if (fresh.error) throw fresh.error;
        const verified = readFrozenPayoutDraft(fresh.data, tournamentId);
        if (!verified || JSON.stringify(verified) !== JSON.stringify(confirmedDraft)) {
          throw new Error("Bản nháp đã thay đổi hoặc đã áp dụng. Tải lại và xem lại trước khi tiếp tục.");
        }
        runId = verified.id;
      } else {
        const expectedCustom = isCustom ? customBp() : null;
        const prep = await (supabase.rpc as any)("prepare_payout_snapshot", {
          p_tournament_id: tournamentId, p_itm_percent: itmPct / 100, p_archetype: archetype,
          p_min_cash_x: minCashX, p_rounding_unit: roundingUnit,
          p_prize_pool_override: officialPool !== officialDefaultPool ? officialPool : null,
          p_override_reason: overrideReason.trim() || null, p_regenerate: false, p_reason: null,
          p_custom_percents: expectedCustom,
        });
        if (!active.current) return;
        if (prep.error) { toast.error(friendly(prep.error.message)); return; }
        if (prep.data?.status === "already_applied") {
          if (typeof prep.data.run_id !== "string" || !prep.data.run_id.trim()) {
            toast.error("Chưa xác minh được mã payout đã áp dụng. Tải lại để đối chiếu."); return;
          }
          outcomeRunId = prep.data.run_id;
          alreadyApplied = true;
          outcomeError = "Đã có payout nhưng chưa đối chiếu được bảng chính thức. Tải lại trước khi tiếp tục.";
          return;
        }
        runId = readPreparedPayout(prep.data, {
          entries: liveEntries, buyIn: tour.buy_in, rake: tour.rake_amount ?? 0, pool: officialPool,
          itm: expectedCustom ? expectedCustom.length / liveEntries : itmPct / 100,
          archetype, minCash: minCashX, rounding: roundingUnit,
        });
        if (expectedCustom) {
          // prepare's public response does not echo the frozen CUSTOM ladder.
          const frozen = await supabase.from("tournament_payout_runs")
            .select("id,tournament_id,status,custom_percents").eq("id", runId).eq("tournament_id", tournamentId).maybeSingle();
          if (!active.current) return;
          if (frozen.error) throw frozen.error;
          const row = frozen.data;
          if (row?.id !== runId || row?.tournament_id !== tournamentId || row?.status !== "draft_snapshot"
            || !Array.isArray(row.custom_percents) || row.custom_percents.length !== expectedCustom.length
            || !row.custom_percents.every((value: unknown, index: number) =>
              value !== null && typeof value === "object" && "position" in value && "percent_bp" in value
              && value.position === expectedCustom[index].position && value.percent_bp === expectedCustom[index].percent_bp)) {
            throw new Error("Bản nháp CUSTOM khác tỷ lệ vừa xác nhận. Chưa áp dụng payout; đối chiếu bản nháp trước khi tiếp tục.");
          }
        }
      }
      outcomeRunId = runId;
      const { data, error } = await supabase.functions.invoke("compute-payouts", { body: { mode: "official", run_id: runId } });
      if (!active.current) return;
      const res = data as any;
      if (error || res?.error) outcomeError = friendly(res?.error || error?.message);
    } catch (e: any) {
      if (active.current) {
        if (outcomeRunId) outcomeError = friendly(e?.message);
        else toast.error(friendly(e?.message));
      }
    } finally {
      // prepare can commit the one-way registration close before compute fails,
      // or before its response is lost. Re-read facts; never infer a rollback or
      // automatically retry either mutation from a transport failure.
      if (active.current) {
        const fresh = await load();
        if (active.current && outcomeRunId) {
          if (fresh?.appliedRun?.id === outcomeRunId) {
            setPreview(null);
            toast.success(alreadyApplied ? "Đã đối chiếu payout chính thức có sẵn; không tính lại." : "Đã đối chiếu payout chính thức đã lưu.");
          } else {
            toast.error(outcomeError ?? "Chưa đối chiếu được payout đã lưu. Tải lại trước khi thử tiếp; không gửi yêu cầu mới khi chưa rõ kết quả.");
          }
        }
      }
      officialInFlight.current = false;
      if (active.current) setBusy("");
    }
  }, [tournamentId, tour, liveEntries, itmPct, archetype, minCashX, roundingUnit, officialPool, officialDefaultPool, overrideReason, load, isCustom, customValid, customBp]);

  const startEdit = () => {
    if (busy !== "" || manualEdit.busy || manualEdit.pending || manualEdit.blocked || !appliedRun?.id) return;
    setEditRows(officialRows.map((r) => ({ ...r }))); setEditReason("");
    setEditBase({runId: appliedRun.id, pool: Number(appliedRun.prize_pool_snapshot)}); setEditing(true);
  };
  const editSum = useMemo(() => editRows.reduce((s, r) => s + (Number(r.amount) || 0), 0), [editRows]);
  const lockedPool = Number(appliedRun?.prize_pool_snapshot ?? tour?.prize_pool ?? 0);

  const editStale = editing && editBase?.runId !== appliedRun?.id;
  const saveEdit = async () => {
    if (!editBase || editStale || busy !== "" || manualEdit.pending || manualEdit.blocked || manualEdit.busy) return;
    if (!editReason.trim()) { toast.error(friendly("MANUAL_EDIT_REASON_REQUIRED")); return; }
    const rows = editRows.map((r) => ({ position: r.position, amount: Math.round(Number(r.amount) || 0) }));
    await manualEdit.submit(editBase.runId, editBase.pool, rows, editReason);
  };

  const recovery = (manualEdit.pending || manualEdit.blocked || manualEdit.message) && <div role="status" className="rounded border border-warning/30 p-3 space-y-2 text-xs">
    {manualEdit.pending && <>
      <p>Chỉnh tay đang chờ xác minh · {manualEdit.pending.rows.length} suất · pool {vnd(manualEdit.pending.pool)}đ</p>
      <p className="break-all">Mã yêu cầu: {manualEdit.pending.requestId}. Không tạo yêu cầu mới khi chưa rõ kết quả.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={manualEdit.busy} onClick={() => void manualEdit.recover()}>Đối chiếu chỉnh tay</Button>
        <Button size="sm" variant="outline" disabled={manualEdit.busy || manualEdit.blocked} onClick={() => void manualEdit.retry()}>Gửi lại đúng yêu cầu</Button>
        <Button size="sm" variant="outline" disabled={manualEdit.busy || manualEdit.blocked} onClick={() => void manualEdit.cancel()}>Hủy yêu cầu an toàn</Button>
      </div>
    </>}
    {manualEdit.blocked && <p role="alert">Không xác minh được journal chỉnh tay. Tạm khóa chỉnh tay mới; không xóa yêu cầu để thử lại.</p>}
    {manualEdit.message && <p>{friendly(manualEdit.message)}</p>}
  </div>;

  // ---------- render ----------
  if (loading) return <div className="space-y-3">{recovery}<Card className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></Card></div>;
  if (loadError) return (
    <div className="space-y-3">{recovery}<Card className="p-6 space-y-3 text-center">
      <p className="text-sm text-destructive">{loadError}</p>
      <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Thử lại</Button>
    </Card></div>
  );

  // Grouped payout: gộp hạng LIỀN KỀ cùng mức tiền thành 1 dải ("13–15") — dùng chung
  // groupPayoutRows với màn TV + cockpit (đã test; KHÔNG gộp qua khoảng trống → không giấu hạng
  // thiếu). % lấy theo hạng ĐẦU dải (các hạng cùng tiền → cùng %). Σ footer vẫn tính trên TỪNG
  // hạng gốc (rows) nên tổng tiền/số suất KHÔNG đổi. Chỉ gộp hiển thị, không đụng số liệu.
  const RowsTable = ({ rows, pool }: { rows: PayoutRow[]; pool: number }) => {
    const bands = groupPayoutRows(rows, rows.length).rows;
    const pctByPos = new Map(rows.map((r) => [r.position, r.percentage]));
    // Bảng kết quả cuộn theo TRANG (bỏ max-h + overflow-y — hết 2 thanh cuộn lồng nhau);
    // sticky top-0 bỏ cùng vì nó bám vào container cuộn cũ, giữ lại sẽ dính viewport.
    return (
      <div className="rounded border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-muted-foreground"><tr>
            <th className="text-left px-3 py-1.5 font-medium">Hạng</th>
            <th className="text-right px-3 py-1.5 font-medium">Tiền thưởng</th>
            <th className="text-right px-3 py-1.5 font-medium">%</th>
          </tr></thead>
          <tbody>
            {bands.map((b) => {
              const startPos = parseInt(b.label, 10);
              const isBand = /\D/.test(b.label);   // "13–15" có ký tự ngăn cách → là dải
              return (
                <tr key={b.label} className="border-t border-border/60">
                  <td className="px-3 py-1.5">{b.label}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-foreground">
                    {vnd(b.amount)}{isBand && <span className="font-sans text-muted-foreground"> /suất</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">{(pctByPos.get(startPos) ?? 0).toFixed(2)}%</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr className="border-t border-border bg-secondary/50">
            <td className="px-3 py-1.5 font-medium">Σ ({rows.length} suất)</td>
            <td className="px-3 py-1.5 text-right font-mono tabular-nums text-primary">{vnd(rows.reduce((s, r) => s + r.amount, 0))}</td>
            <td className="px-3 py-1.5 text-right text-muted-foreground">/ {vnd(pool)}</td>
          </tr></tfoot>
        </table>
      </div>
    );
  };

  if (isSatellite && tour) {
    return <SatelliteAwardPlanPanel tournamentId={tournamentId} clubId={tour.club_id} />;
  }

  return (
    <div className="space-y-4">
      {recovery}
      {/* Satellite (nhập tay) — giải vé: cơ cấu tách khỏi engine tính tiền. Flag-gated; ẩn hoàn toàn khi OFF. */}
      {FEATURES.payoutSatelliteManual && <SatellitePayoutEditor tournamentId={tournamentId} />}
      <Card className="p-4 space-y-4">
      {/* header + state badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Calculator className="w-4 h-4 text-primary" />
          <span className="font-semibold">Cơ cấu giải thưởng <span className="text-muted-foreground font-normal">· Engine 3-neo</span></span>
        </div>
        {hasOfficial
          ? <Badge className="bg-primary/15 text-primary border-primary/30">PAYOUT CHÍNH THỨC{editedManually ? " · Đã chỉnh tay" : ""}</Badge>
          : isClosed
            ? <Badge className="bg-warning/15 text-warning border-warning/30">Đã đóng đăng ký — chưa tạo payout</Badge>
            : <Badge variant="outline" className="text-muted-foreground">Đăng ký đang mở</Badge>}
      </div>

      {isMultiDay && (
        <div className="flex items-start gap-2 rounded border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Giải nhiều ngày (multi-day) chưa hỗ trợ payout tự động. Hãy chốt thủ công cho từng flight/Main Event.</span>
        </div>
      )}

      {/* ===== generator / preview inputs ===== */}
      <div className="space-y-3 rounded border border-border p-3">
        {hasOfficial && <p className="text-xs text-muted-foreground">Cấu hình dự kiến — không thay thế payout chính thức</p>}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Số entry {isClosed ? "" : "(dự kiến)"}</Label>
            <Input type="number" value={entries} onChange={(e) => setEntries(Number(e.target.value))} />
            <p className="text-[11px] text-muted-foreground">đang có {liveEntries} (đã trả tiền)</p>
          </div>
          {!isCustom && (
            <div className="space-y-1">
              <Label className="text-xs">ITM %</Label>
              <Input type="number" step="0.5" aria-label="ITM %" value={itmPct} onChange={(e) => setItmPct(Number(e.target.value))} />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Kiểu giải</Label>
            <Select value={archetype} onValueChange={(v) => setArchetype(v as Archetype)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {/* LIVE_STANDARD is no longer offered — every preset here now bands ranks 10+ by
                    default (see computePayouts/applyBanding), so INTL alone covers what LIVE_STANDARD
                    used to be a separate choice for. The archetype/engine path stays functional
                    (hidden, not deleted) for the historical LIVE_STANDARD run + defensive back-compat. */}
                {(["DAILY", "MULTI", "INTL", ...(customMode ? ["CUSTOM"] : [])] as Archetype[]).map((a) => <SelectItem key={a} value={a}>{ARCHE_LABEL[a]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Min-cash ×</Label>
            <Input type="number" step="0.5" aria-label="Min-cash ×" value={minCashX} onChange={(e) => setMinCashX(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Làm tròn (đ)</Label>
            <Input type="number" step="100000" aria-label="Làm tròn (đ)" value={roundingUnit} onChange={(e) => setRoundingUnit(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Prize pool (sửa tay)</Label>
            <Input type="number" placeholder={`auto = ${vnd(defaultPool)}`} value={poolOverride} onChange={(e) => setPoolOverride(e.target.value)} />
          </div>
        </div>
        {FEATURES.payoutPlannedSettings && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={savingPlanned} onClick={savePlanned}>
              {savingPlanned ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />} Lưu mặc định cho giải này
            </Button>
            <p className="text-[11px] text-muted-foreground">Lần sau mở lại giải này sẽ tự điền kiểu giải/ITM%/min-cash/làm tròn.</p>
          </div>
        )}
        {isCustom && (
          <div className="space-y-2 rounded border border-primary/30 bg-primary/5 p-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Cơ cấu % tự cấu hình (giảm dần · Σ = 100%)</Label>
              <span className={`text-xs font-mono ${customBpTotal === 10000 ? "text-primary" : "text-destructive"}`}>
                Σ {(customBpTotal / 100).toFixed(2)}% {customBpTotal === 10000 ? "✓" : "✗ phải = 100%"}
              </span>
            </div>
            {suggestOn && (
              <div className="space-y-2 rounded border border-primary/20 bg-background/40 p-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                  <Wand2 className="w-3.5 h-3.5" /> Gợi ý cơ cấu (từ vị trí 1) — sửa lại được sau
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Số suất trả thưởng</Label>
                    <Input type="number" min={1} value={suggestN} aria-label="Số suất trả thưởng"
                      onChange={(e) => { suggestNDirtyRef.current = true; setSuggestN(Math.max(1, Math.floor(Number(e.target.value) || 1))); }} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Kiểu chia</Label>
                    <Select value={suggestShape} onValueChange={(v) => setSuggestShape(v as SuggestShape)}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DAILY">Top nặng</SelectItem>
                        <SelectItem value="INTL">Cân bằng</SelectItem>
                        <SelectItem value="MULTI">Phẳng</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button size="sm" variant="outline" className="h-9" onClick={seedByShape}>
                    <Wand2 className="w-3.5 h-3.5 mr-1" /> Gợi ý theo kiểu
                  </Button>
                  <div className="space-y-1">
                    <Label className="text-[11px]">% hạng nhất</Label>
                    <Input type="number" step="0.5" inputMode="decimal" value={rank1Input} aria-label="% hạng nhất"
                      onChange={(e) => setRank1Input(e.target.value)} />
                  </div>
                  <Button size="sm" variant="outline" className="h-9" onClick={suggestByRank1}>
                    <Wand2 className="w-3.5 h-3.5 mr-1" /> Gợi ý theo % hạng 1
                  </Button>
                  {canUndo && (
                    <Button size="sm" variant="ghost" className="h-9" onClick={undoSuggest}>
                      <Undo2 className="w-3.5 h-3.5 mr-1" /> Hoàn tác gợi ý
                    </Button>
                  )}
                </div>
                {lastSuggest && (
                  <div className="space-y-0.5 text-[11px] text-muted-foreground">
                    <div>
                      Đã gợi ý {lastSuggest.effectivePlaces} suất
                      {lastSuggest.requestedPlaces !== lastSuggest.effectivePlaces ? ` (yêu cầu ${lastSuggest.requestedPlaces})` : ""}
                      {" · hạng nhất "}{(lastSuggest.effectiveRank1Bp / 100).toFixed(2)}%. Chỉnh tay bên dưới nếu cần.
                    </div>
                    {lastSuggest.warnings.map((w) => (
                      <div key={w} className="text-warning">⚠ {SUGGEST_WARN_VI[w] ?? w}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="max-h-[34vh] overflow-y-auto space-y-1 pr-1">
              {customRows.map((r, i) => {
                const pool = poolOverride.trim() && Number(poolOverride) !== defaultPool ? Number(poolOverride) : defaultPool;
                const amt = Math.round((pool * Math.round((Number(r.percent) || 0) * 100)) / 10000);
                return (
                  <div key={i} className="grid grid-cols-[2.5rem_1fr_7rem_2rem] gap-2 items-center">
                    <span className="text-xs text-muted-foreground text-right">#{i + 1}</span>
                    <Input type="number" step="0.5" value={r.percent} aria-label={`percent rank ${i + 1}`}
                      onChange={(e) => setCustomRows((prev) => prev.map((x, j) => (j === i ? { ...x, percent: Number(e.target.value) } : x)))} />
                    <span className="text-xs font-mono tabular-nums text-muted-foreground text-right">{vnd(amt)}đ</span>
                    <Button size="icon" variant="ghost" className="h-7 w-7" disabled={customRows.length <= 1} aria-label={`remove rank ${i + 1}`}
                      onClick={() => setCustomRows((prev) => prev.filter((_, j) => j !== i).map((x, j) => ({ ...x, position: j + 1 })))}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
            <Button size="sm" variant="outline" onClick={() => setCustomRows((prev) => [...prev, { position: prev.length + 1, percent: 0 }])}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Thêm hạng
            </Button>
            {customTemplates && (
              <div className="space-y-2 border-t border-primary/20 pt-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                    onChange={(e) => handleFile(e.target.files?.[0])} aria-label="Tải file payout" />
                  <Button size="sm" variant="outline" disabled={importing} onClick={() => fileInputRef.current?.click()}>
                    {importing ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1" />} Tải file (Excel/CSV)
                  </Button>
                  <Input className="h-8 max-w-[11rem]" placeholder="Tên mẫu" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
                  <Button size="sm" variant="outline" disabled={savingTpl || !customValid || !templateName.trim()} onClick={saveTemplate}>
                    {savingTpl ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />} Lưu mẫu
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">File ghi % hoặc số tiền mỗi hạng — hệ tự nhận diện và quy ra %.</p>
                {templates.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground">Mẫu đã lưu:</span>
                    {templates.map((t) => (
                      <span key={t.id} className="inline-flex items-center gap-1 rounded border border-border bg-secondary/40 px-2 py-0.5 text-[11px]">
                        <button type="button" className="hover:text-primary" onClick={() => loadTemplate(t.id)}>{t.name}</button>
                        <button type="button" className="text-muted-foreground hover:text-destructive" aria-label={`xoá mẫu ${t.name}`} onClick={() => deleteTemplate(t.id)}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {poolOverride.trim() && Number(poolOverride) !== officialDefaultPool && (
          <Input placeholder="Lý do sửa prize pool (bắt buộc)" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={runPreview} disabled={busy !== "" || isMultiDay || (isCustom && !customValid)}>
            {busy === "preview" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Calculator className="w-3.5 h-3.5 mr-1" />} Xem trước (Dự kiến)
          </Button>

          {/* official / close-and-generate */}
          {!hasOfficial && !draftRun && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" className="gap-1" disabled={busy !== "" || isMultiDay || !(liveEntries > 0) || (isCustom && !customValid)}>
                  <Lock className="w-3.5 h-3.5" /> {isClosed ? "Tạo payout chính thức" : "Đóng đăng ký & tạo payout"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2"><Lock className="w-4 h-4 text-warning" /> {isClosed ? "Tạo payout chính thức?" : "Đóng đăng ký & chốt payout?"}</AlertDialogTitle>
                  <AlertDialogDescription className="space-y-2">
                    {!isClosed && <span className="block font-medium text-warning">⚠️ Đóng đăng ký là MỘT CHIỀU — không mở lại được.</span>}
                    <span className="block">Hệ thống sẽ chốt {liveEntries} entry đã trả tiền (snapshot), prize pool {vnd(officialPool)}đ, rồi tạo bảng payout chính thức ({isCustom ? `CUSTOM · ${customRows.length} suất` : `${archetype}, ITM ${itmPct}%`}). Số entry dự kiến chỉ dùng cho xem trước. Sau đó vẫn chỉnh tay được (có ghi audit).</span>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Hủy</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void runOfficial()}>{isClosed ? "Tạo payout" : "Đóng đăng ký & tạo"}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        {!hasOfficial && draftRun && (
          <div className="rounded border border-warning/30 bg-warning/10 p-3 space-y-2">
            <p className="text-sm font-medium">Có bản nháp payout đã lưu</p>
            <p className="text-xs text-muted-foreground">Chưa áp dụng. Xem snapshot đã chốt trước khi tiếp tục; cấu hình dự kiến ở trên không thay thế bản nháp này.</p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy !== "" || isMultiDay}>Xem & tiếp tục bản nháp</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Áp dụng đúng bản nháp đã lưu?</AlertDialogTitle>
                  <AlertDialogDescription className="space-y-2">
                    <span className="block">{draftRun.archetype} · {draftRun.entries_snapshot} entry · pool {vnd(draftRun.prize_pool_snapshot)}đ · ITM {Number((draftRun.itm_percent * 100).toFixed(6))}%</span>
                    <span className="block">Buy-in {vnd(draftRun.buy_in_snapshot)}đ · phí {vnd(draftRun.rake_snapshot)}đ · min-cash {draftRun.min_cash_x}× · sàn {vnd(draftRun.effective_floor)}đ · làm tròn {vnd(draftRun.rounding_unit)}đ</span>
                    {draftRun.custom_percents && <span className="block">{draftRun.custom_percents.map(row => `Hạng ${row.position}: ${row.percent_bp / 100}%`).join(" · ")}</span>}
                    <span className="block break-all">Mã bản nháp: {draftRun.id}. Không tạo lại snapshot, không đổi cấu hình đã lưu và chưa ghi thanh toán cho người chơi.</span>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Hủy</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void runOfficial(draftRun)}>Áp dụng bản nháp đã xem</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      {/* ===== preview result (estimated, no persist) ===== */}
      {preview && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
            <AlertTriangle className="w-3.5 h-3.5" /> <span>{hasOfficial ? "DỰ KIẾN — không thay thế payout chính thức" : isClosed ? "DỰ KIẾN — không thay đổi bản nháp đã chốt" : `DỰ KIẾN${isCustom ? " — custom" : ""} — chưa đóng đăng ký, chưa lưu. Số liệu thay đổi theo entry.`}</span>
          </div>
          {isCustom && preview.rows.length > 0 && (() => {
            const floor = minCashX * ((tour?.buy_in ?? 0) + (tour?.rake_amount ?? 0));
            const last = preview.rows[preview.rows.length - 1].amount;
            return last < floor ? (
              <p className="text-[11px] text-warning">Lưu ý: hạng cuối ({vnd(last)}đ) thấp hơn min-cash tham khảo ({vnd(floor)}đ). CUSTOM bỏ qua sàn min-cash — vẫn cho phép.</p>
            ) : null;
          })()}
          {preview.warnings.length > 0 && <p className="text-[11px] text-muted-foreground">Cảnh báo: {preview.warnings.join(", ")}</p>}
          <RowsTable rows={preview.rows} pool={preview.prizePool ?? defaultPool} />
        </div>
      )}

      {/* ===== official table + manual edit ===== */}
      {hasOfficial && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Chốt: {appliedRun?.entries_snapshot ?? tour?.itm_places} entry · pool {vnd(lockedPool)}đ · {appliedRun?.itm_places ?? officialRows.length} suất
            </p>
            {!editing && <Button size="sm" variant="outline" disabled={busy !== "" || manualEdit.busy || !!manualEdit.pending || manualEdit.blocked} onClick={startEdit}><Pencil className="w-3.5 h-3.5 mr-1" /> Chỉnh tay</Button>}
          </div>

          <p className="text-xs text-muted-foreground">Kiểu chia đã chốt: {Object.prototype.hasOwnProperty.call(ARCHE_LABEL, String(appliedRun?.archetype)) ? String(appliedRun.archetype) : "chưa xác minh"}</p>

          {!editing ? (
            <RowsTable rows={officialRows} pool={lockedPool} />
          ) : (
            <div className="space-y-2">
              {editStale && <p role="alert" className="text-xs text-destructive">Bảng payout đã thay đổi. Hủy bản chỉnh đang mở rồi xem dữ liệu mới trước khi sửa tiếp.</p>}
              <div className="flex items-start gap-2 rounded border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Chỉnh tay được GHI AUDIT. Tổng phải = prize pool đã chốt ({vnd(lockedPool)}đ), giảm dần theo hạng.</span>
              </div>
              <div className="max-h-[40vh] overflow-y-auto space-y-1 pr-1">
                {editRows.map((r, i) => (
                  <div key={r.position} className="grid grid-cols-[3rem_1fr] gap-2 items-center">
                    <span className="text-xs text-muted-foreground text-right">#{r.position}</span>
                    <Input type="number" value={r.amount} onChange={(e) => setEditRows((prev) => prev.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} />
                  </div>
                ))}
              </div>
              <div className={`text-xs ${editSum === lockedPool ? "text-primary" : "text-destructive"}`}>
                Σ = {vnd(editSum)}đ {editSum === lockedPool ? "✓ khớp pool" : `✗ phải = ${vnd(lockedPool)}đ`}
              </div>
              <Textarea placeholder="Lý do chỉnh tay (bắt buộc — ghi audit)" value={editReason} onChange={(e) => setEditReason(e.target.value)} rows={2} />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={saveEdit} disabled={savingEdit || !!manualEdit.pending || manualEdit.blocked || editStale || !editReason.trim() || editSum !== editBase?.pool}>
                  {savingEdit ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />} Lưu chỉnh tay
                </Button>
                <Button size="sm" variant="ghost" disabled={savingEdit || !!manualEdit.pending} onClick={() => { setEditing(false); setEditBase(null); }}>Hủy</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== W3-B2: record prize paid (cashier), flag-gated, only after official prizes exist ===== */}
      {hasOfficial && FEATURES.prizePayoutTracking && (
        <PrizePayoutTrackingSection tournamentId={tournamentId} />
      )}
      </Card>
    </div>
  );
}
