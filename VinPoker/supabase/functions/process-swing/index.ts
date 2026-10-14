import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  pickNextDealer,
  evaluateBreakNeed,
  computeSwingDuration,
  computeNextSwingAt,
  fillEmptyTables,
  getTableIdsForClub,
  type FillResult,
} from "../_shared/dealer-utils.ts";
import {
  buildDealerCandidates,
  isCandidateSnapshotFailure,
} from "../_shared/pickNextDealer.ts";
import { getFeatureTablePoolIds } from "../_shared/featureTableGate.ts"; // Patch 5b: feature/final pool gate
import { scaleLockTimeoutSeconds } from "../_shared/lockTimeout.ts";
import {
  sendTelegramNotification,
  getClubTelegramChatId,
  formatMassAssignMessage,
  formatEmergencyPreAssignMessage,
  notifyFloorManagerDM,
  mention,
} from "../_shared/telegram.ts";
import { TelegramNotifier } from "../_shared/telegramNotifier.ts";
import type {
  BreakStartEvent,
} from "../_shared/telegramNotifier.ts";
import {
  calculateBatchSwingDuration,
  resolveSwingConfig,
  type PoolSnapshot,
  type SwingConfig,
} from "./calculateBatchSwingDuration.ts";
import { pass2PreAssignNext } from "./passes/pass2-pre-assign.ts";
import { runEmptyTablePreAssign } from "./passes/passS2-empty-table-preassign.ts";
import { pass25InitialAssign } from "./passes/pass2.5-initial-assign.ts";
import { pass15RotationPlanner } from "./passes/pass1.5-rotation-planner.ts";
import { postSwingPreAssign } from "./passes/pass3-post-swing-assign.ts";
import {
  passRRotationPlanner,
  replanSingleTable,
  type PassRContext,
} from "./passes/passR-rotation-planner.ts";
import { runPass3Diagnostic, shouldPersistPass3Diagnostic } from "./diagnostics.ts";
import { endMealBreak } from "../_shared/mealBreakService.ts";
import {
  ZOMBIE_LOCK_WINDOW_MS,
  derivePreAssignStatus,
  sortPass3Candidates,
} from "../_shared/preAssignState.ts";
import { SWING_POLICY } from "../_shared/swingPolicy.ts";
import { parseRequestedClubIds } from "./requestScope.ts";
import {
  assessEmptyFillOutcome,
  parseProcessSwingDispatchContext,
  type ProcessSwingDispatchContext,
} from "./dispatchContext.ts";
import { assessPreAssignPreflight } from "./preAssignPreflight.ts";
import {
  assessAvailableDealerCount,
  assessCandidateSnapshotFailure,
  assessCoreQueryFailure,
  assessDealerInventory,
  assessLockOwnershipLoss,
  assessPerformSwingResponse,
  assessShortageAlertFailure,
  assessSwingExecutionFailure,
  ensureLockOwnership,
  fetchAutoSwingSettings,
  LockOwnershipLost,
  mergeDispatchOutcome,
  type DispatchSafetyOutcome,
  type ProcessSwingDispatchState,
} from "./executionSafety.ts";
import { runDealerShortageAlert } from "./shortageAlert.ts";
import { manualDealerIntentHeaders } from "../_shared/dealerMutationIntent.ts";
import { getDealerOperationalTables, type DealerOperationalTable } from "../_shared/dealerOperationalTables.ts";
import { isExactOperationalAssignment } from "./pass3SessionFence.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SWING_THRESHOLDS = {
  OVERDUE_THRESHOLD_MINUTES: 60,
  CRITICALLY_OVERDUE_HOURS: 4,
  BASE_LOCK_TIMEOUT_SECONDS: 120,
  LOCK_TIMEOUT_PER_TABLE: 10,
  MAX_LOCK_TIMEOUT_SECONDS: 300,
  RELEASE_BATCH_SIZE: 50,
  MAX_ERRORS_TO_LOG: 3,
  ALERT_THROTTLE_HOURS: 1,
  ROLLBACK_MAX_RETRIES: 3,
  ROLLBACK_BASE_BACKOFF_MS: 100,
  ROLLBACK_MAX_BACKOFF_MS: 5000,
  BULK_CLEAR_MAX_RETRIES: 3,
  BULK_CLEAR_BASE_BACKOFF_MS: 200,
} as const;

const DEFAULT_PRE_ANNOUNCE_MINUTES = SWING_POLICY.defaults.preAnnounceMinutes;
const DEFAULT_PRE_ASSIGN_WINDOW_MINUTES = 4;
const DEFAULT_MAX_WORK_MINUTES = 120;
const DEFAULT_MIN_WORK_MINUTES = 60;
const DEFAULT_SWING_DURATION_MINUTES = SWING_POLICY.defaults.swingDurationMinutes;
const DEFAULT_BREAK_DURATION_MINUTES = SWING_POLICY.defaults.breakDurationMinutes;
const SWING_WINDOW_BUFFER_MINUTES = 2;
const MAX_SWING_RETRIES = 3;

// ── Owner policy (2026-06-13) ────────────────────────────────────────────────
// The scheduler must NEVER auto force-release an overdue dealer: with no
// replacement the dealer stays on OVERTIME (Pass R already stamps
// overtime_started_at) and the floor intervenes manually. And it must NEVER
// auto-open/auto-staff an empty table — opening is manual-only (the "Gán" /
// "Gán loạt" buttons via the assign-dealer / mass-assign edge functions, which
// are unaffected by these flags). Flip either to true to restore the previous
// automatic behavior.
const FORCE_RELEASE_ENABLED = false;
const AUTO_OPEN_EMPTY_TABLES_ENABLED = false;
// ── Step 1 auto-staff (default ON for all clubs) ──────────────────────────────
// Auto-STAFF an empty ACTIVE table (never opens/activates a new table) with a
// genuinely-FREE (current_state='available') dealer ONLY + a direct DM.
// Default: ON for every club (no config needed — new clubs work automatically).
// To EXCLUDE specific clubs, set env `AUTO_STAFF_EXCLUDE_CLUB_IDS` = comma/space-
// separated club UUIDs. Leave unset or empty = all clubs enabled.
// To disable entirely, set `AUTO_STAFF_EMPTY_TABLES_CLUB_IDS=disabled`.
function parseClubIdEnv(name: string): Set<string> | "*" {
  const raw = (Deno.env.get(name) ?? "").trim();
  if (!raw || raw === "*" || raw === "ALL") return "*"; // unset = all clubs ON
  if (raw === "disabled" || raw === "none") return new Set(); // explicit disable all
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}
function clubEnabled(gate: Set<string> | "*", clubId: string): boolean {
  if (gate === "*") return true;
  return gate.has(String(clubId).toLowerCase());
}
const AUTO_STAFF_EMPTY_TABLES_CLUB_IDS = parseClubIdEnv("AUTO_STAFF_EMPTY_TABLES_CLUB_IDS");
// ── Step 2 auto-preassign (default ON for all clubs) ──────────────────────────
// Predictive PRE-ASSIGN: when an empty active table has no available dealer to
// fill now, reserve the soonest-free ON_BREAK dealer + countdown Telegram, and
// execute (promote reserved→assigned) when their break ends + 13-min rest gate.
// Default: ON for every club (same pattern as Step 1, no manual setup needed).
// To EXCLUDE specific clubs, set env `AUTO_PREASSIGN_EMPTY_TABLES_CLUB_IDS` to UUIDs.
const AUTO_PREASSIGN_EMPTY_TABLES_CLUB_IDS = parseClubIdEnv("AUTO_PREASSIGN_EMPTY_TABLES_CLUB_IDS");
// Automatic swing requires a PLANNED replacement (pre_assigned_attendance_id).
// The Pass 3 escalation tier picker (Tier 0 normal-rest + tiers 1–3 relaxed)
// that auto-picks an UNPLANNED pool dealer for an overdue table is disabled:
// no pre-assigned replacement → the current dealer stays on OT (alert / manual
// intervention). Predicted / pre-assign PLANNING (Pass R, lock_rotation_slot,
// set_rotation_slot_dealer) is NOT affected — a resting dealer may still be
// pre-assigned for a future swing. Flip true to restore emergency auto-pick.
const UNPLANNED_AUTO_PICK_ENABLED = false;
// Hard rest revalidation at EXECUTE time (owner policy 2026-06-13, raised to 15 on
// 2026-07-05): the incoming pre-assigned dealer must have >= 15 min rest at swing
// time. If still short, do NOT swing — keep the current dealer on OT and alert.
// Planning may pre-assign a resting dealer who is expected to be valid by swing
// time; execution enforces the hard rest floor. SINGLE SOURCE =
// SWING_POLICY.rest.executeMinRestFloorMinutes, which the PLANNER also uses
// (buildRotationSupply floor + passR solver restMs) so plan and execute never
// disagree — a plan floor below this leaves tables stuck on OT (fixed 2026-07-06).
const EXECUTE_MIN_REST_MINUTES = SWING_POLICY.rest.executeMinRestFloorMinutes;
// Owner policy (2026-06-14): do NOT spam Telegram with Pass 0c OT alerts — both
// the per-tick "đang OT, cần can thiệp thủ công" overdue alert AND the >45-min
// extended-OT alert. With force-release disabled a dealer on overtime is the
// EXPECTED state (no relief yet) and the floor already sees it on the Dealer
// Swing map / ĐÀI CHỈ HUY, so a Telegram ping every cron tick for every overdue
// table is noise. Both OT alerts are now console-only. Flip true to restore the
// Telegram pings. (Force-release failure alerts, if force-release is re-enabled,
// are NOT gated by this flag.)
const OT_ALERT_TELEGRAM_ENABLED = false;

// Owner request (2026-07-05): hide the post-swing confirmation on Telegram —
// "🔵 <dealer> vừa vào Bàn X / Thay thế: <dealer>" (and the "- Thay" variants in
// the dormant force-release / unplanned-pick / fallback branches). It is redundant
// with the 5-min-ahead "📋 Tiếp theo" pre-assign announce (pass2-pre-assign.ts),
// which is NOT affected by this flag and still fires. When false, all 7 Pass-3
// swing-confirmation sends are console-only. Flip true to restore the confirmations.
const SWING_CONFIRM_TELEGRAM_ENABLED = false;

// ─── Dealer State Machine ─────────────────────────────────────────────────────
// Wrapper around transition_dealer_state RPC. Dùng cho individual operations.
// Batch cleanup (Pass 1b, 1c) dùng direct UPDATE — trigger ghi audit tự động.

interface StateTransitionResult {
  success: boolean;
  from?: string;
  to?: string;
  noop?: boolean;
  error?: string;
}

async function transitionDealerState(
  admin: any,
  attendanceId: string,
  newState: string,
  reason?: string
): Promise<StateTransitionResult> {
  try {
    const { data, error } = await admin.rpc("transition_dealer_state", {
      p_attendance_id: attendanceId,
      p_new_state: newState,
      p_reason: reason ?? null,
    });
    if (error) {
      console.error(`[state] ❌ RPC error ${attendanceId}: ${error.message}`);
      return { success: false, error: error.message };
    }
    if (!data || data.ok !== true) {
      console.error(
        `[state] ❌ FAILED ${attendanceId}: ${data?.from ?? "?"} → ${newState}` +
        ` (${data?.error ?? "unknown"})` + (reason ? ` reason=${reason}` : "")
      );
      return { success: false, from: data?.from, to: newState, error: data?.error ?? "transition failed" };
    }
    if (data.noop) {
      return { success: true, noop: true, from: data.from, to: data.to };
    }
    console.log(`[state] ✅ ${attendanceId}: ${data.from} → ${data.to}` + (reason ? ` (${reason})` : ""));
    return { success: true, from: data.from, to: data.to };
  } catch (err: any) {
    console.error(`[state] ❌ Exception ${attendanceId}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ─── Break settings cache ─────────────────────────────────────────────────────
const breakSettingsCache = new Map<string, { breakDuration: number; maxBreak: number; cachedAt: number }>();

async function getBreakSettings(
  admin: any,
  clubId: string
): Promise<{ breakDuration: number; maxBreak: number }> {
  const CACHE_TTL = 5 * 60 * 1000;
  const now = Date.now();
  const cached = breakSettingsCache.get(clubId);
  if (cached && now - cached.cachedAt < CACHE_TTL) {
    return { breakDuration: cached.breakDuration, maxBreak: cached.maxBreak };
  }

  const { data: clubCfg } = await admin
    .from("club_settings")
    .select("break_duration_minutes, max_break_duration_minutes")
    .eq("club_id", clubId)
    .maybeSingle();

  const breakDuration = Math.max(5, Math.min(60, clubCfg?.break_duration_minutes ?? 15));
  const maxBreak = Math.max(breakDuration, Math.min(120, clubCfg?.max_break_duration_minutes ?? 60));

  breakSettingsCache.set(clubId, { breakDuration, maxBreak, cachedAt: now });
  return { breakDuration, maxBreak };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClubSwingConfig {
  swing_duration_minutes: number;
  break_duration_minutes: number;
  pre_announce_minutes: number;
  warn_at_minutes: number;
  crit_at_minutes: number;
  auto_adjust_duration: boolean;
  min_duration: number;
  auto_swing_enabled: boolean;
  base_duration_minutes: number;
  target_ratio: number;
  max_duration_minutes: number;
  sync_swings: boolean;
  sync_window_minutes: number;
  rotation_planner_enabled: boolean;
  min_inter_swing_rest_minutes: number;
  tier_a_min_buyin: number;
  tier_b_min_buyin: number;
}

// ─── Config fetching ──────────────────────────────────────────────────────────

async function fetchAllClubConfigs(
  admin: any
): Promise<Map<string, ClubSwingConfig>> {
  const configMap = new Map<string, ClubSwingConfig>();

  const { data: swingData, error } = await admin
    .from("swing_config")
    .select("*")
    .eq("table_type", "tournament");

  if (error) {
    console.error("[process-swing] fetchAllClubConfigs error:", error.message);
    return configMap;
  }

  const settingsMap = await fetchAutoSwingSettings(admin);

  for (const row of swingData ?? []) {
    configMap.set(row.club_id, {
      swing_duration_minutes: Math.max(SWING_POLICY.defaults.swingDurationMinutes, row.swing_duration_minutes ?? DEFAULT_SWING_DURATION_MINUTES),
      break_duration_minutes: row.break_duration_minutes ?? DEFAULT_BREAK_DURATION_MINUTES,
      pre_announce_minutes: row.pre_announce_minutes ?? DEFAULT_PRE_ANNOUNCE_MINUTES,
      warn_at_minutes: row.warn_at_minutes ?? 5,
      crit_at_minutes: row.crit_at_minutes ?? 2,
      auto_adjust_duration: row.auto_adjust_duration ?? false,
      min_duration: Math.max(30, row.min_duration ?? 30),
      auto_swing_enabled: settingsMap.get(row.club_id) === true,
      base_duration_minutes: row.base_duration_minutes ?? row.swing_duration_minutes ?? 40,
      target_ratio: row.target_ratio ?? 1.43,
      max_duration_minutes: row.max_duration_minutes ?? 60,
      sync_swings: row.sync_swings ?? false,
      sync_window_minutes: row.sync_window_minutes ?? 5,
      rotation_planner_enabled: row.rotation_planner_enabled ?? false,
      min_inter_swing_rest_minutes: row.min_inter_swing_rest_minutes ?? 10,
      tier_a_min_buyin: row.tier_a_min_buyin ?? 10_000_000,
      tier_b_min_buyin: row.tier_b_min_buyin ?? 3_000_000,
    });
  }
  return configMap;
}

function getClubConfig(
  configMap: Map<string, ClubSwingConfig>,
  clubId: string
): ClubSwingConfig {
  return (
    configMap.get(clubId) ?? {
      swing_duration_minutes: DEFAULT_SWING_DURATION_MINUTES,
      break_duration_minutes: DEFAULT_BREAK_DURATION_MINUTES,
      pre_announce_minutes: DEFAULT_PRE_ANNOUNCE_MINUTES,
      warn_at_minutes: 5,
      crit_at_minutes: 2,
      auto_adjust_duration: false,
      min_duration: 15,
      auto_swing_enabled: false,
      base_duration_minutes: DEFAULT_SWING_DURATION_MINUTES,
      target_ratio: 1.43,
      max_duration_minutes: 60,
      sync_swings: false,
      sync_window_minutes: 5,
      rotation_planner_enabled: false,
      min_inter_swing_rest_minutes: 10,
      tier_a_min_buyin: 10_000_000,
      tier_b_min_buyin: 3_000_000,
    }
  );
}

async function getClubLocalDate(
  admin: any,
  clubId: string
): Promise<string> {
  const { data } = await admin.rpc("club_local_date", { p_club_id: clubId });
  return data ?? new Date().toISOString().split("T")[0];
}

// ─── Pass 1b Types ────────────────────────────────────────────────────────

interface StalePreAssignRow {
  id: string;
  pre_assigned_attendance_id: string | null;
  pre_assigned_at: string | null;
  version: number;
  status?: string;
}

interface LockAcquisitionResult {
  acquired: boolean;
}

interface DealerAttendanceState {
  id: string;
  current_state: string;
}

// ─── Pass 1b Helpers ──────────────────────────────────────────────────────

function truncateId(id: string | null | undefined): string {
  if (!id) return "unknown";
  return id.length > 8 ? `${id.slice(0, 8)}\u2026` : id;
}

function formatCriticalAlert(
  rows: StalePreAssignRow[],
  clubName: string,
  cid: string
): string {
  const MAX_DETAILS = SWING_THRESHOLDS.MAX_ERRORS_TO_LOG;
  const dealerLines = rows.slice(0, MAX_DETAILS).map((r, i) => {
    const dealerId = truncateId(r.pre_assigned_attendance_id);
    const assignmentId = truncateId(r.id);
    const overdueTime = r.pre_assigned_at
      ? new Date(r.pre_assigned_at).toISOString()
      : "unknown";
    return `${i + 1}. ${dealerId} \u2014 assignment ${assignmentId}, overdue since ${overdueTime}`;
  }).join("\n");

  const overflow =
    rows.length > MAX_DETAILS
      ? `\n\n_...and ${rows.length - MAX_DETAILS} more_`
      : "";

  return (
    `\U0001F6D2 *CRITICAL OVERDUE* (${clubName})\n\n` +
    `${rows.length} pre-assignment(s) stuck \u2265${SWING_THRESHOLDS.CRITICALLY_OVERDUE_HOURS}h \u2014 force-releasing:\n` +
    (dealerLines ? `\n${dealerLines}` : "") +
    overflow +
    `\n\n\U0001F50D Check \`dealer_state_transitions\` for details.`
  );
}

async function safeGetTelegramChatId(
  admin: SupabaseClient,
  cid: string
): Promise<string | null> {
  try {
    return await getClubTelegramChatId(admin, cid);
  } catch (err) {
    console.error(`[Telegram] Failed to get chat ID for club ${cid}:`, (err as Error).message);
    return null;
  }
}

/**
 * Sends a Telegram alert message. Handles chat ID retrieval and send failures gracefully.
 * @param admin - Supabase admin client
 * @param cid - Club ID
 * @param message - Markdown-formatted message to send
 * @param botToken - Telegram bot token (optional)
 */
async function sendAlert(
  admin: SupabaseClient,
  cid: string,
  message: string,
  botToken: string | undefined
): Promise<void> {
  const chatId = await safeGetTelegramChatId(admin, cid);
  if (!botToken || !chatId) {
    if (!chatId) console.warn(`[Pass 1b] No Telegram chat ID for club ${cid}`);
    return;
  }
  await sendTelegramNotification(botToken, chatId, message, { parse_mode: "Markdown" })
    .catch(err => console.error("[Pass 1b] \u274C Telegram send failed:", err.message));
}

async function safeSendAlert(
  admin: SupabaseClient,
  cid: string,
  message: string,
  botToken: string | undefined
): Promise<void> {
  await sendAlert(admin, cid, message, botToken)
    .catch(err => console.error("[Pass 1b] \u274C Alert send failed:", (err as Error).message));
}

/**
 * Sends a critical alert with formatted details about stuck pre-assignments.
 * @param admin - Supabase admin client
 * @param cid - Club ID
 * @param clubName - Human-readable club name
 * @param rows - Array of stuck assignment records
 * @param botToken - Telegram bot token (optional)
 */
async function sendCriticalAlert(
  admin: SupabaseClient,
  cid: string,
  clubName: string,
  rows: StalePreAssignRow[],
  botToken: string | undefined
): Promise<void> {
  const chatId = await safeGetTelegramChatId(admin, cid);
  if (!botToken || !chatId) {
    if (!chatId) console.warn(`[Pass 1b] No Telegram chat ID for club ${cid}`);
    return;
  }
  const message = formatCriticalAlert(rows, clubName, cid);
  await sendTelegramNotification(botToken, chatId, message, { parse_mode: "Markdown" })
    .catch(err => console.error("[Pass 1b] \u274C Telegram send failed:", err.message));
}

/**
 * Clears pre_assigned fields on dealer_attendance records with retry logic.
 * @param admin - Supabase admin client
 * @param dealerAttendanceIds - IDs to clear
 * @param context - Label for logging (e.g., "critical", "stale")
 * @returns true if successful, false if failed after retries
 */
async function bulkClearDealerPreAssignedFields(
  admin: SupabaseClient,
  dealerAttendanceIds: string[],
  context: string
): Promise<boolean> {
  if (dealerAttendanceIds.length === 0) {
    return true;
  }

  let success = false;
  let lastErr: any = null;

  for (let retry = 0; retry < SWING_THRESHOLDS.BULK_CLEAR_MAX_RETRIES; retry++) {
    const { error } = await admin
      .from("dealer_attendance")
      .update({ pre_assigned_table_id: null, pre_assigned_at: null })
      .in("id", dealerAttendanceIds);

    if (!error) {
      success = true;
      if (retry > 0) {
        console.log(`[Pass 1b] \u2705 ${context} bulk clear succeeded on retry ${retry}`);
      }
      break;
    }

    lastErr = error;
    console.warn(`[Pass 1b] \u26A0\uFE0F ${context} bulk clear attempt ${retry + 1}/${SWING_THRESHOLDS.BULK_CLEAR_MAX_RETRIES} failed:`, error.message);
    if (retry < SWING_THRESHOLDS.BULK_CLEAR_MAX_RETRIES - 1) {
      await new Promise(resolve => setTimeout(resolve, SWING_THRESHOLDS.BULK_CLEAR_BASE_BACKOFF_MS * Math.pow(2, retry)));
    }
  }

  if (!success) {
    console.error(
      `[Pass 1b] \U0001F6D2 ${context.toUpperCase()}: Bulk clear failed after ${SWING_THRESHOLDS.BULK_CLEAR_MAX_RETRIES} retries for ${dealerAttendanceIds.length} dealers!`
    );
    if (lastErr) {
      console.error("[Pass 1b] Last error:", lastErr);
    }
  }

  return success;
}

type ProcessSwingAuth = { internal: boolean; uid: string | null };

async function authenticateProcessSwingRequest(
  req: Request,
  admin: SupabaseClient,
  requestedClubId: string | null | undefined,
  manualTrigger: boolean,
): Promise<ProcessSwingAuth | Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const token = authHeader.slice("Bearer ".length).trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const internalSecret = Deno.env.get("PROCESS_SWING_INTERNAL_SECRET") ?? "";
  // Cron must use the service-role key or a separately provisioned secret. The
  // public anon key is deliberately not accepted because this function mutates
  // dealer state and is deployed with verify_jwt disabled.
  if (token === serviceKey || (internalSecret.length > 0 && token === internalSecret)) {
    return { internal: true, uid: null };
  }

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceKey,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await userClient.auth.getUser(token);
  const uid = userData?.user?.id;
  if (!uid) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!requestedClubId || !manualTrigger) {
    return new Response(JSON.stringify({ error: "Manual process-swing requires club_id and manual_trigger" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: isControl } = await admin.rpc("is_club_dealer_control", {
    _user_id: uid,
    _club_id: requestedClubId,
  });
  if (!isControl) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return { internal: false, uid };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let dispatchAdmin: any = null;
  let dispatchContext: ProcessSwingDispatchContext | null = null;
  let dispatchFinalState: ProcessSwingDispatchState = "completed";
  let dispatchErrorCode: string | null = null;
  const dispatchDiagnostics: Array<{ club_id: string; stage: string; code: string }> = [];
  const markDispatchOutcome = (
    state: ProcessSwingDispatchState,
    errorCode: string | null,
  ) => {
    const merged = mergeDispatchOutcome(
      { state: dispatchFinalState, errorCode: dispatchErrorCode },
      { state, errorCode },
    );
    dispatchFinalState = merged.state;
    dispatchErrorCode = merged.errorCode;
  };
  const recordDispatchSafetyOutcome = (
    clubId: string,
    outcome: DispatchSafetyOutcome,
  ) => {
    markDispatchOutcome(outcome.dispatchState, outcome.dispatchErrorCode);
    dispatchDiagnostics.push({ club_id: clubId, ...outcome.diagnostic });
  };

  try {
    let admin: any = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    dispatchAdmin = admin;
    const performSwingWithDispatchSafety = async (
      clubId: string,
      args: Record<string, unknown>,
    ) => {
      const assignmentId = args.p_assignment_id;
      const { data: assignmentContext, error: contextError } = await admin
        .from("dealer_assignments")
        .select("id, club_id, table_id, table_session_id")
        .eq("id", assignmentId)
        .eq("club_id", clubId)
        .maybeSingle();

      if (contextError || !assignmentContext?.table_session_id) {
        const error = contextError ?? { code: "TABLE_SESSION_BINDING_REQUIRED" };
        const failure = assessCoreQueryFailure("perform_swing_context", error);
        recordDispatchSafetyOutcome(clubId, failure);
        return { data: null, error };
      }

      const response = await admin.rpc("worker_perform_swing", {
        ...args,
        p_table_id: assignmentContext.table_id,
        p_table_session_id: assignmentContext.table_session_id,
      });
      const failure = assessPerformSwingResponse(response.data, response.error);
      if (failure) recordDispatchSafetyOutcome(clubId, failure);
      return response;
    };

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      console.error(
        "[process-swing] TELEGRAM_BOT_TOKEN is not set. " +
          "Swings will execute but Telegram notifications will be skipped. " +
          "Run: supabase secrets set TELEGRAM_BOT_TOKEN=<your_token>"
      );
    }

    const parsedBody = await req.json().catch(() => ({}));
    const body: any = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
      ? parsedBody
      : {};
    const {
      club_id: clubId,
      club_ids: requestedClubIdsValue,
      shift_id: shiftId,
      force_all: forceAll = false,
      dry_run: dryRun = false,
      manual_trigger: manualTrigger = false,
      required_game_types,
      pre_assign_only: preAssignOnly = false,
      manual_window_minutes: manualWindowMinutes = 15,
    } = body;

    const authResult = await authenticateProcessSwingRequest(
      req,
      admin,
      clubId ?? null,
      manualTrigger === true,
    );
    if (authResult instanceof Response) return authResult;

    if (authResult.internal && manualTrigger === true) {
      return new Response(JSON.stringify({ error: "manual_trigger_requires_authenticated_actor" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (authResult.uid) {
      admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
        global: { headers: manualDealerIntentHeaders(authResult.uid) },
      });
      dispatchAdmin = admin;
    }

    if (!authResult.internal && requestedClubIdsValue !== undefined) {
      return new Response(JSON.stringify({ error: "club_ids is restricted to internal callers" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let requestedClubIds: string[] | undefined;
    try {
      requestedClubIds = parseRequestedClubIds(requestedClubIdsValue);
    } catch (err) {
      return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Invalid club_ids" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (clubId && requestedClubIds !== undefined) {
      return new Response(JSON.stringify({ error: "Use club_id or club_ids, not both" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      dispatchContext = parseProcessSwingDispatchContext(body);
    } catch (err) {
      return new Response(JSON.stringify({
        error: "invalid_dispatch_context",
        detail: err instanceof Error ? err.message : "Invalid dispatch context",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (dispatchContext) {
      if (!authResult.internal) {
        return new Response(JSON.stringify({ error: "dispatch_context_requires_internal_auth" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: claim, error: claimError } = await admin.rpc(
        "claim_process_swing_dispatch",
        {
          p_run_id: dispatchContext.runId,
          p_request_id: dispatchContext.requestId,
          p_club_id: dispatchContext.clubId,
        },
      );
      if (claimError) {
        dispatchFinalState = "dependency_unavailable";
        dispatchErrorCode = "dispatch_claim_unavailable";
        return new Response(JSON.stringify({
          ok: false,
          status: "dependency_unavailable",
          error_code: dispatchErrorCode,
        }), {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const claimOutcome = String(claim?.outcome ?? "invalid_claim_response");
      if (claimOutcome === "duplicate") {
        return new Response(JSON.stringify({
          ok: true,
          status: "duplicate",
          business_state: claim?.business_state ?? null,
          run_id: dispatchContext.runId,
          request_id: dispatchContext.requestId,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (claimOutcome !== "claimed") {
        return new Response(JSON.stringify({
          ok: false,
          status: "business_failed",
          error_code: `dispatch_${claimOutcome}`,
        }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const startTime = Date.now();
    // B2.2b: per-invocation owner id stamped on the fenced club lock (observability).
    const runOwnerId = `process-swing:${crypto.randomUUID()}`;
    const allClubConfigs = await fetchAllClubConfigs(admin);

    let clubIds: string[] = [];
    if (clubId) {
      clubIds = [String(clubId)];
    } else if (requestedClubIds !== undefined) {
      // An explicit [] is a valid no-work scope from run_process_swing_cron().
      clubIds = requestedClubIds;
    } else {
      const { data: clubs } = await admin
        .from("clubs")
        .select("id")
        .in("status", ["approved"]);
      clubIds = (clubs ?? []).map((c: { id: string }) => c.id);
    }

    const metricsPerClub: Record<
      string,
      { total: number; success: number; failed: number; no_dealer: number; tg_failed: number; skipped: number }
    > = {};

    const executionStartTime = Date.now();
    let clubsProcessed = 0;
    let clubsSkippedLocked = 0;
    let clubsSkippedError = 0;

    // ═══════════════════════════════════════════════════════════════════════════
    //  Process each club independently with club-level locking
    // ═══════════════════════════════════════════════════════════════════════════
    for (const cid of clubIds) {
      let lockAcquired = false;
      let lockToken: string | null = null;  // B2.2b: fencing token from the fenced acquire
      let clubHadPass3Error = false;
      // C3 — per-club-run trace + pass-timing checkpoints (durations = diffs between marks).
      const traceId = crypto.randomUUID();
      const swingMarks: Array<{ pass: string; at: number }> = [];
      const mark = (pass: string) => { swingMarks.push({ pass, at: Date.now() }); };
      mark("run_start");

      // ── B2.1: scale the lock lease by active-table count ─────────
      // Worst-case runs (80–200s) can exceed the old hardcoded 120s lease, which the
      // 60s cron then reclaims → two concurrent runners (FM-1). Best-effort table
      // count; on ANY error fall back to BASE (today's behavior), never shorter.
      // NOTE: this only shrinks the FM-1 overrun window — it does NOT fix the
      // unconditional release_club_lock (FM-2). Fencing/tokens = B2.2.
      let lockTimeoutSec: number = SWING_THRESHOLDS.BASE_LOCK_TIMEOUT_SECONDS;
      try {
        const activeTableCount = (await getTableIdsForClub(admin, cid)).length;
        lockTimeoutSec = scaleLockTimeoutSeconds(activeTableCount, {
          baseSeconds: SWING_THRESHOLDS.BASE_LOCK_TIMEOUT_SECONDS,
          perTableSeconds: SWING_THRESHOLDS.LOCK_TIMEOUT_PER_TABLE,
          maxSeconds: SWING_THRESHOLDS.MAX_LOCK_TIMEOUT_SECONDS,
        });
        console.log(`[process-swing] lock_timeout_scaled club=${cid} active_table_count=${activeTableCount} timeout_seconds=${lockTimeoutSec}`);
      } catch (err) {
        console.warn(`[process-swing] lock_timeout_scaled: table count read failed for ${cid}, using base ${lockTimeoutSec}s:`, err);
      }

      // ── Acquire club processing lock ────────────────────────────
      try {
        const { data: lockResult, error: lockErr } = await admin.rpc("try_acquire_club_lock_fenced", {
          p_club_id: cid,
          p_timeout_seconds: lockTimeoutSec,
          p_owner_id: runOwnerId,
        });

        if (lockErr) {
          console.error(`[process-swing] \u274C Lock RPC failed for ${cid}:`, lockErr.message);
          markDispatchOutcome("business_failed", "club_lock_query_failed");
          clubsSkippedError++;
          continue;
        }

        if (!lockResult || typeof lockResult !== "object" || !("acquired" in lockResult)) {
          console.error(`[process-swing] \u274C Invalid lock result for ${cid}:`, JSON.stringify(lockResult));
          markDispatchOutcome("business_failed", "club_lock_invalid_response");
          clubsSkippedError++;
          continue;
        }

        const acquired = (lockResult as LockAcquisitionResult).acquired === true;
        if (!acquired) {
          console.log(`[process-swing] \U0001F512 Club ${cid} locked by another instance`);
          markDispatchOutcome("locked", "club_lock_held");
          clubsSkippedLocked++;
          continue;
        }

        lockToken = (lockResult as { lock_token?: string | null }).lock_token ?? null;
        lockAcquired = true;
      } catch (err) {
        console.error(`[process-swing] \u274C Lock acquisition exception for ${cid}:`, err);
        markDispatchOutcome("business_failed", "club_lock_exception");
        clubsSkippedError++;
        continue;
      }

      try {
        // ── Guard: club config ───────────────────────────────
        let clubCfg: ClubSwingConfig;
        try {
          clubCfg = getClubConfig(allClubConfigs, cid);
        } catch (err) {
          console.error(`[process-swing] \u274C Failed to get config for club ${cid}:`, err);
          markDispatchOutcome("business_failed", "club_config_failed");
          clubsSkippedError++;
          continue;
        }

        if (!manualTrigger && !clubCfg.auto_swing_enabled) {
          console.log(`[process-swing] Club ${cid} auto-swing disabled \u2014 skipping`);
          continue;
        }

        if (!metricsPerClub[cid]) {
          metricsPerClub[cid] = { total: 0, success: 0, failed: 0, no_dealer: 0, tg_failed: 0, skipped: 0 };
        }
        const metrics = metricsPerClub[cid];

        // ── Cache table IDs once per club ─────────────────────────
        let clubTableIds: string[];
        try {
          clubTableIds = await getTableIdsForClub(admin, cid);
        } catch (err) {
          console.error(`[process-swing] \u274C getTableIdsForClub failed for club ${cid}:`, err);
          markDispatchOutcome("business_failed", "club_tables_failed");
          clubsSkippedError++;
          continue;
        }

        // ═════════════════════════════════════════════════════════════════
        // \U0001F4CC IMPORTANT: Use cached `clubTableIds` for ALL table queries
        //   \u2713 Pass 1b queries
        //   \u2713 Pass 3 queries
        //   \u2713 Canonical shortage-alert snapshot
        //   DO NOT call getTableIdsForClub(admin, cid) again in this club loop
        // ═════════════════════════════════════════════════════════════════

        const cycleExcludedIds = new Set<string>();

        // ── TelegramNotifier for this club cycle ──────────────────────────
        let notifier: TelegramNotifier | null = null;
        let clubZone: string | null = null;
        let pass2ChatId: string | null = null;  // hoisted for pre-assign notification fallback
        if (botToken) {
          const [chatId, zoneData] = await Promise.all([
            getClubTelegramChatId(admin, cid),
            admin.from("swing_config").select("club_zone").eq("club_id", cid).maybeSingle(),
          ]);
          pass2ChatId = chatId;
          if (chatId) {
            notifier = new TelegramNotifier(botToken, chatId);
            clubZone = (zoneData as any)?.club_zone ?? null;
          }
        }

        mark("pass0");
        // ── PASS 0 — Batch swing duration from pool snapshot ──────────────
        let batchDurationMinutes = clubCfg.swing_duration_minutes;
        let batchSwingDueAt: string | undefined;
        if (!dryRun) {
          try {
            const { data: snapshotData } = await admin.rpc("get_dealer_pool_snapshot", {
              p_club_id: cid,
            });
            if (snapshotData) {
              const snapshot = snapshotData as PoolSnapshot;
              const swingCfg: SwingConfig = resolveSwingConfig({
                swing_duration_minutes: clubCfg.swing_duration_minutes,
                auto_adjust_duration: clubCfg.auto_adjust_duration,
                base_duration_minutes: clubCfg.base_duration_minutes,
                target_ratio: clubCfg.target_ratio,
                min_duration_minutes: clubCfg.min_duration,
                max_duration_minutes: clubCfg.max_duration_minutes,
              });
              const batchResult = calculateBatchSwingDuration(swingCfg, snapshot);
              batchDurationMinutes = batchResult.durationMinutes;
              batchSwingDueAt = batchResult.swingDueAt;
              console.log(`[process-swing] Batch swing duration for club ${cid}: ${batchResult.rationale}`);
            }
          } catch (err) {
            console.warn(`[process-swing] Pool snapshot failed for club ${cid}, using config default:`, err);
          }
        }

        console.log(`[process-swing] Club ${cid}: checking swingDueAt fallback (dryRun=${dryRun}, hasDueAt=${!!batchSwingDueAt})`);
        if (!dryRun && !batchSwingDueAt) {
          batchSwingDueAt = new Date(
            Date.now() + clubCfg.swing_duration_minutes * 60_000
          ).toISOString();
          console.log(`[process-swing] Fallback swingDueAt for club ${cid}: config default ${clubCfg.swing_duration_minutes}min`);
        }

        // ── Pre-fetch club dealer IDs (used by available count, Pass 0c, and seeding) ──
        console.log(`[process-swing] Club ${cid}: querying dealers...`);
        let cidDealerIds: string[];
        try {
          const { data: clubDealers, error: clubDealersError } = await admin
            .from("dealers")
            .select("id")
            .eq("club_id", cid);
          const inventory = assessDealerInventory(clubDealers, clubDealersError);
          if (inventory.failure) {
            recordDispatchSafetyOutcome(
              cid,
              inventory.failure,
            );
            clubsSkippedError++;
            continue;
          }
          cidDealerIds = inventory.dealerIds;
        } catch (err) {
          recordDispatchSafetyOutcome(
            cid,
            assessCoreQueryFailure("dealer_inventory", err),
          );
          clubsSkippedError++;
          continue;
        }

        if (cidDealerIds.length === 0) {
          console.log(`[process-swing] No dealers for club ${cid} — skipping`);
          continue;
        }

        // ── PASS 0b — Query available dealer count for break deadlock guard ──
        let availableDealerCount: number | undefined;
        if (!dryRun) {
          try {
            const { count, error: availableCountError } = await admin
              .from("dealer_attendance")
              .select("id", { head: true, count: "exact" })
              .in("dealer_id", cidDealerIds)
              .eq("current_state", "available")
              .eq("status", "checked_in");
            const availability = assessAvailableDealerCount(count, availableCountError);
            if (availability.failure) {
              recordDispatchSafetyOutcome(
                cid,
                availability.failure,
              );
              clubsSkippedError++;
              continue;
            }
            availableDealerCount = availability.count;
          } catch (err) {
            recordDispatchSafetyOutcome(
              cid,
              assessCoreQueryFailure("available_dealer_count", err),
            );
            clubsSkippedError++;
            continue;
          }
        }

        mark("pass0c");
        // ── PASS 0c: Detect & auto-fix stuck dealers ────────────────────────

        if (!dryRun) {
          const stuckIssues: Array<{ id: string; dealer_name: string; issue: string }> = [];

          // 1. Stuck pre_assigned (no table OR no timestamp — incomplete pre-assign)
          const { data: stuckPre } = await admin
            .from("dealer_attendance")
            .select(`
              id,
              dealer_id,
              current_state,
              pre_assigned_table_id,
              pre_assigned_at,
              dealers!inner(full_name)
            `)
            .eq("current_state", "pre_assigned")
            .or("pre_assigned_table_id.is.null,pre_assigned_at.is.null")
            .in("dealer_id", cidDealerIds);

          if (stuckPre && stuckPre.length > 0) {
            console.log(`[Pass 0c] Found ${stuckPre.length} stuck pre_assigned dealers (missing fields)`);
            for (const s of stuckPre) {
              const dealerName = (s.dealers as any)?.full_name ?? "Unknown";
              stuckIssues.push({
                id: s.id,
                dealer_name: dealerName,
                issue: `pre_assigned_incomplete: table=${s.pre_assigned_table_id ?? 'NULL'}, at=${s.pre_assigned_at ?? 'NULL'}`,
              });
              await transitionDealerState(admin, s.id, "available", "pass0c_stuck_pre_assigned_incomplete");
            }
          }

          // 1b. Orphaned pre_assigned (no active assignment pointing to them)
          const { data: orphanedPreAssigned } = await admin
            .from("dealer_attendance")
            .select(`
              id,
              dealer_id,
              pre_assigned_table_id,
              dealers!inner(full_name)
            `)
            .eq("current_state", "pre_assigned")
            .eq("status", "checked_in")
            .in("dealer_id", cidDealerIds);

          if (orphanedPreAssigned && orphanedPreAssigned.length > 0) {
            const { data: validPreAssigns } = await admin
              .from("dealer_assignments")
              .select("pre_assigned_attendance_id")
              .in("pre_assigned_attendance_id", orphanedPreAssigned.map((d: any) => d.id))
              .eq("status", "assigned")
              .is("released_at", null);

            const validPreIds = new Set(
              (validPreAssigns ?? []).map((a: any) => a.pre_assigned_attendance_id)
            );
            const toReleasePre = orphanedPreAssigned.filter(
              (d: any) => !validPreIds.has(d.id)
            );

            for (const dealer of toReleasePre) {
              const dealerName = (dealer.dealers as any)?.full_name ?? "Unknown";
              stuckIssues.push({
                id: dealer.id,
                dealer_name: dealerName,
                issue: "pre_assigned_orphaned_no_assignment",
              });
              await transitionDealerState(
                admin, dealer.id, "available",
                `pass0c_orphaned_pre_assigned_${dealer.pre_assigned_table_id ?? "none"}`
              );
              cycleExcludedIds.add(dealer.id);
              console.log(`[Pass 0c] Released orphaned pre_assigned dealer ${dealerName}`);
            }
          }

          // 2. Stuck on_break (overdue)
          const { data: stuckBreaks, error: breakErr } = await admin.rpc("detect_stuck_breaks", { p_club_id: cid });
          if (breakErr) {
            console.error("[Pass 0c] ❌ detect_stuck_breaks RPC failed:", breakErr);
          } else if (stuckBreaks && stuckBreaks.length > 0) {
            console.log(`[Pass 0c] Found ${stuckBreaks.length} stuck breaks (overdue)`);
            for (const b of stuckBreaks) {
              // Only alert if break is significantly overdue (>5 min); otherwise
              // it's just a normal expired break and auto-end without noise.
              if (b.overdue_min > 5) {
                stuckIssues.push({ id: b.attendance_id, dealer_name: b.dealer_name, issue: `break_overdue_${b.overdue_min}m` });
              }
              const { data: endResult, error: endErr } = await admin.rpc("end_dealer_break", {
                p_break_id: b.break_id,
                p_attendance_id: b.attendance_id,
              });
              if (endErr || endResult?.outcome !== "success") {
                console.error(`[Pass 0c] ❌ Failed to end stuck break ${b.break_id}:`, endErr?.message ?? endResult?.message);
              } else {
                console.log(`[Pass 0c] ✅ Auto-ended stuck break for ${b.dealer_name} (${b.overdue_min}m overdue)`);
              }
            }
          }

          // 3. Stuck in_transition (>5 minutes)
          // Use updated_at, not check_in_time. check_in_time is the shift start
          // and can be many hours old, which would force-release healthy swaps.
          const { data: stuckTransition } = await admin
            .from("dealer_attendance")
            .select("id, dealer_id, updated_at, dealers!inner(full_name)")
            .eq("current_state", "in_transition")
            .in("dealer_id", cidDealerIds)
            .lt("updated_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());

          if (stuckTransition && stuckTransition.length > 0) {
            console.log(`[Pass 0c] Found ${stuckTransition.length} stuck in_transition dealers (>5min)`);
            for (const s of stuckTransition) {
              const dealerName = (s.dealers as any)?.full_name ?? "Unknown";
              const stuckMinutes = Math.floor((Date.now() - new Date(s.updated_at).getTime()) / 60000);
              stuckIssues.push({ id: s.id, dealer_name: dealerName, issue: `in_transition_stuck_${stuckMinutes}m` });
              await transitionDealerState(admin, s.id, "available", `pass0c_stuck_in_transition_${stuckMinutes}m`);
            }
          }

          // ── 4. Stuck assigned (no active assignment) ──────────────────────
          const { data: orphanedAssigned } = await admin
            .from("dealer_attendance")
            .select(`
              id,
              dealer_id,
              check_in_time,
              dealers!inner(full_name)
            `)
            .eq("current_state", "assigned")
            .eq("status", "checked_in")
            .in("dealer_id", cidDealerIds);

          if (orphanedAssigned && orphanedAssigned.length > 0) {
            const { data: activeAssignments } = await admin
              .from("dealer_assignments")
              .select("attendance_id")
              .in("attendance_id", orphanedAssigned.map((d: any) => d.id))
              .eq("status", "assigned")
              .is("released_at", null);

            const activeIds = new Set((activeAssignments ?? []).map((a: any) => a.attendance_id));
            const toRelease = orphanedAssigned.filter((d: any) => !activeIds.has(d.id));

            for (const dealer of toRelease) {
              const dealerName = (dealer.dealers as any)?.full_name ?? "Unknown";
              const stuckMinutes = Math.floor(
                (Date.now() - new Date(dealer.check_in_time).getTime()) / 60000
              );
              stuckIssues.push({
                id: dealer.id,
                dealer_name: dealerName,
                issue: `assigned_orphaned_${stuckMinutes}m`,
              });
              await transitionDealerState(
                admin,
                dealer.id,
                "available",
                `pass0c_orphaned_assigned_stuck_${stuckMinutes}m`
              );
              cycleExcludedIds.add(dealer.id);
              console.log(`[Pass 0c] Released orphaned dealer ${dealerName} (was: assigned, stuck: ${stuckMinutes}m)`);
            }
          }

          // ── 4b. Dangling on_break assignment rows blocking the pool ──────────
          // Break-end RPCs (end_dealer_break, complete_dealer_break) transition
          // dealer_attendance to available but never release the old on_break
          // dealer_assignments row. pickNextDealer step-5b sees that row as
          // "dealer busy" → excludes from pool → amplifies starvation.
          // Fix: release any on_break assignment row where the dealer is available.
          {
            const danglingCutoff = new Date(Date.now() - 2 * 60_000).toISOString();
            const { data: danglingRows } = await admin
              .from("dealer_assignments")
              .select(`
                id, attendance_id, table_id, assigned_at,
                dealer_attendance!attendance_id(
                  id, current_state,
                  dealers(full_name)
                )
              `)
              .eq("club_id", cid)
              .eq("status", "on_break")
              .is("released_at", null)
              .lt("assigned_at", danglingCutoff);

            if (danglingRows && danglingRows.length > 0) {
              const healCandidates = (danglingRows as any[]).filter((row) => {
                return (row.dealer_attendance as any)?.current_state === "available";
              });

              if (healCandidates.length > 0) {
                const candidateAttIds = healCandidates.map((r: any) => r.attendance_id);
                const { data: activeAssigned } = await admin
                  .from("dealer_assignments")
                  .select("attendance_id")
                  .in("attendance_id", candidateAttIds)
                  .eq("status", "assigned")
                  .is("released_at", null);

                const busyAttIds = new Set(
                  (activeAssigned ?? []).map((a: any) => a.attendance_id)
                );
                const toHeal = healCandidates.filter(
                  (r: any) => !busyAttIds.has(r.attendance_id)
                );

                for (const row of toHeal) {
                  const dealerName =
                    (row.dealer_attendance as any)?.dealers?.full_name ?? "Unknown";
                  const { error: healErr } = await admin
                    .from("dealer_assignments")
                    .update({
                      status: "completed",
                      released_at: new Date().toISOString(),
                      release_reason: "pass0c_dangling_available_cleanup",
                    })
                    .eq("id", row.id)
                    .eq("status", "on_break")
                    .is("released_at", null);

                  if (healErr) {
                    console.error(
                      `[Pass 0c] ❌ Failed to heal dangling on_break row for ${dealerName}:`,
                      healErr.message,
                    );
                  } else {
                    stuckIssues.push({
                      id: row.attendance_id,
                      dealer_name: dealerName,
                      issue: "on_break_dangling_healed",
                    });
                    console.log(
                      `[Pass 0c] 🩹 Healed dangling on_break assignment for ${dealerName} ` +
                      `(row ${row.id.slice(0, 8)}…)`,
                    );
                  }
                }
              }
            }
          }

          // ── 4c. Stale dealer_breaks rows: dealer already left on_break but break_end not set ──
          // Swing RPCs transition the outgoing dealer's attendance state (on_break→assigned/
          // pre_assigned) without closing the dealer_breaks row. end_expired_breaks (Pass 4)
          // only handles dealers still in on_break — it never catches these orphaned rows.
          // Fix: close break rows where attendance state is no longer on_break.
          // Data hygiene only — does NOT change dealer_attendance state, does NOT fix pool starvation.
          try {
            const staleCutoff = new Date(Date.now() - 2 * 60_000).toISOString();

            const { data: staleBreakRows, error: staleBreakError } = await admin
              .from("dealer_breaks")
              .select("id, attendance_id, break_start")
              .eq("club_id", cid)
              .is("break_end", null)
              .not("attendance_id", "is", null)
              .lt("break_start", staleCutoff);

            if (staleBreakError) {
              console.warn("[Pass 0c] stale dealer_breaks scan failed", staleBreakError.message);
            } else if (staleBreakRows && staleBreakRows.length > 0) {
              const attendanceIds = [
                ...new Set(
                  (staleBreakRows as any[])
                    .map((r: any) => r.attendance_id)
                    .filter(Boolean),
                ),
              ];

              const { data: attendanceRows, error: attendanceError } = await admin
                .from("dealer_attendance")
                .select("id, current_state")
                .in("id", attendanceIds);

              if (attendanceError) {
                console.warn(
                  "[Pass 0c] stale dealer_breaks attendance lookup failed",
                  attendanceError.message,
                );
              } else {
                const stateByAttId = new Map(
                  (attendanceRows ?? []).map((r: any) => [r.id, r.current_state]),
                );

                const idsToClose = (staleBreakRows as any[])
                  .filter((row: any) => {
                    const state = stateByAttId.get(row.attendance_id);
                    return state !== undefined && state !== "on_break";
                  })
                  .map((row: any) => row.id);

                const stillOnBreakCount = (staleBreakRows as any[]).filter(
                  (row: any) => stateByAttId.get(row.attendance_id) === "on_break",
                ).length;

                const missingAttendanceCount = (staleBreakRows as any[]).filter(
                  (row: any) => !stateByAttId.has(row.attendance_id),
                ).length;

                if (idsToClose.length > 0) {
                  const nowIso = new Date().toISOString();
                  const { error: closeError } = await admin
                    .from("dealer_breaks")
                    .update({ break_end: nowIso })
                    .in("id", idsToClose)
                    .is("break_end", null);

                  if (closeError) {
                    console.warn(
                      "[Pass 0c] stale dealer_breaks close failed",
                      closeError.message,
                    );
                  } else {
                    console.log("[Pass 0c] 🩹 Closed stale dealer_breaks rows", {
                      scanned: staleBreakRows.length,
                      closed: idsToClose.length,
                      stillOnBreak: stillOnBreakCount,
                      missingAttendance: missingAttendanceCount,
                    });
                  }
                }
              }
            }
          } catch (err: any) {
            console.warn("[Pass 0c] stale dealer_breaks cleanup unexpected error", err?.message ?? err);
          }

          // 5. Telegram notification
          if (stuckIssues.length > 0) {
            console.warn(`[Pass 0c] ⚠️ Found ${stuckIssues.length} stuck dealers (auto-fixed)`);
            const chatId = await getClubTelegramChatId(admin, cid);
            if (botToken && chatId) {
              const msg = `⚠️ *${stuckIssues.length} dealer bị treo — đã tự động sửa*\n\n` +
                stuckIssues.slice(0, 10).map(s => `  • *${s.dealer_name}*: ${s.issue}\n    \`${s.id.slice(0, 8)}…\``).join("\n") +
                (stuckIssues.length > 10 ? `\n\n_...và ${stuckIssues.length - 10} dealers khác_` : "") +
                `\n\n🔍 Kiểm tra \`dealer_state_transitions\` để biết chi tiết.`;
              await sendTelegramNotification(botToken, chatId, msg, { parse_mode: "Markdown" });
            }
          } else {
            console.log("[Pass 0c] ✅ No stuck dealers found");
          }

          // 6. Phase 4: Force-release stuck assignments + critical alerting
          // Detects conditions that Pass 3 cannot catch proactively and force-releases
          //   rows past force_release_at_overdue_min (default 30) via RPC.
          // Pass 3 also runs this logic but Pass 0c runs FIRST in the cron tick
          // and can catch rows that Pass 3 wouldn't reach (e.g., already in
          //   progress locks or pre-assigned race_lost).
          // Also alerts on extended OT (45+ min) but does NOT auto-fix.
          const { data: pass0cEsc } = await admin.rpc("get_escalation_config", { p_club_id: cid }).single();
          const forceReleaseThreshold = pass0cEsc?.force_release_at_overdue_min ?? 30;
          const overdueThreshold = new Date(Date.now() - forceReleaseThreshold * 60_000).toISOString();

          const { data: overdueAssignments, error: overdueErr } = await admin
            .from("dealer_assignments")
            .select(`
              id, table_id, swing_due_at, overtime_started_at,
              game_tables(table_name),
              dealer_attendance!attendance_id(dealers(full_name))
            `)
            .eq("club_id", cid)
            .eq("status", "assigned")
            .is("swing_processed_at", null)
            .lt("swing_due_at", overdueThreshold);

          const otThreshold = new Date(Date.now() - 45 * 60_000).toISOString();
          const { data: extendedOtAssignments, error: otErr } = await admin
            .from("dealer_assignments")
            .select(`
              id, table_id, overtime_started_at,
              game_tables(table_name),
              dealer_attendance!attendance_id(dealers(full_name))
            `)
            .eq("club_id", cid)
            .eq("status", "assigned")
            .is("swing_processed_at", null)
            .not("overtime_started_at", "is", null)
            .lt("overtime_started_at", otThreshold);

          const criticalAlerts: string[] = [];
          let forceReleasedCount = 0;

          // Force-release stuck rows past threshold
          if (overdueErr) {
            console.error("[Pass 0c] ❌ Overdue query error:", overdueErr.message);
          } else if (overdueAssignments && overdueAssignments.length > 0) {
            if (FORCE_RELEASE_ENABLED) {
              console.warn(`[Pass 0c] ⚠️ Found ${overdueAssignments.length} overdue assignments (>${forceReleaseThreshold}min) — force-releasing`);
              for (const a of overdueAssignments) {
                const overdueMin = Math.floor(
                  (Date.now() - new Date(a.swing_due_at).getTime()) / 60_000
                );
                const tableName = (a.game_tables as any)?.table_name ?? a.table_id;
                const dealerName = (a.dealer_attendance as any)?.dealers?.full_name ?? "Unknown";

                // Call force_release_stuck_assignment RPC
                const forceResult = await admin.rpc("force_release_stuck_assignment", {
                  p_assignment_id: a.id,
                  p_club_id: cid,
                  p_reason: `pass0c_force_release_overdue_${Math.min(overdueMin, 240)}min`,
                });

                if (forceResult.error) {
                  console.error(`[Pass 0c] ❌ force_release RPC error for ${tableName}:`, forceResult.error.message);
                  criticalAlerts.push(`🔴 *${tableName}* — Dealer ${dealerName}: QUÁ HẠN ${overdueMin}ph. Force-release FAILED!`);
                  continue;
                }

                const fr = forceResult.data as { success: boolean; reason?: string };
                if (!fr?.success) {
                  console.warn(`[Pass 0c] ⚠️ force_release returned for ${tableName}:`, fr);
                  criticalAlerts.push(`🔴 *${tableName}* — Dealer ${dealerName}: QUÁ HẠN ${overdueMin}ph. Force-release rejected: ${fr?.reason}`);
                  continue;
                }

                forceReleasedCount++;
                console.log(`[Pass 0c] ✅ Force-released ${tableName} (overdue ${overdueMin}min, reason: ${fr.reason})`);
                criticalAlerts.push(`✅ *${tableName}* — Đã force-release (${overdueMin}ph quá hạn).`);
              }
            } else {
              // Owner policy: NEVER force-release. The dealer stays on OT (Pass R
              // stamped overtime_started_at). A dealer on OT is the EXPECTED state
              // and the floor sees it in the UI, so the per-tick overdue alert is
              // console-only by default (OT_ALERT_TELEGRAM_ENABLED) — no Telegram.
              console.warn(`[Pass 0c] ⚠️ Found ${overdueAssignments.length} overdue assignments (>${forceReleaseThreshold}min) — on OT, manual intervention (force-release disabled)`);
              for (const a of overdueAssignments) {
                const overdueMin = Math.floor(
                  (Date.now() - new Date(a.swing_due_at).getTime()) / 60_000
                );
                const tableName = (a.game_tables as any)?.table_name ?? a.table_id;
                const dealerName = (a.dealer_attendance as any)?.dealers?.full_name ?? "Unknown";
                console.warn(`[Pass 0c] 🔴 ${tableName} — ${dealerName}: overdue ${overdueMin}min, on OT (manual intervention)`);
                if (OT_ALERT_TELEGRAM_ENABLED) {
                  criticalAlerts.push(`🔴 *${tableName}* — Dealer ${dealerName}: QUÁ HẠN ${overdueMin}ph — đang OT, cần can thiệp thủ công.`);
                }
              }
            }
          }

          if (otErr) {
            console.error("[Pass 0c] ❌ Extended OT query error:", otErr.message);
          } else if (extendedOtAssignments && extendedOtAssignments.length > 0) {
            console.warn(`[Pass 0c] ⚠️ Found ${extendedOtAssignments.length} extended OT assignments (>45 min) — on OT (console-only)`);
            for (const a of extendedOtAssignments) {
              const otMin = Math.floor(
                (Date.now() - new Date(a.overtime_started_at).getTime()) / 60_000
              );
              const tableName = (a.game_tables as any)?.table_name ?? a.table_id;
              const dealerName = (a.dealer_attendance as any)?.dealers?.full_name ?? "Unknown";
              console.warn(`[Pass 0c] ⏱ ${tableName} — ${dealerName}: extended OT ${otMin}min`);
              if (OT_ALERT_TELEGRAM_ENABLED) {
                criticalAlerts.push(`⏱ *${tableName}* — Dealer ${dealerName}: OT ${otMin}ph (extended). Cần can thiệp!`);
              }
            }
          }

          // Send Telegram summary if anything happened
          if (criticalAlerts.length > 0) {
            const chatId = await getClubTelegramChatId(admin, cid);
            if (botToken && chatId) {
              const header = forceReleasedCount > 0
                ? `🚨 *Pass 0c — ${forceReleasedCount} force-releases + ${criticalAlerts.length - forceReleasedCount} alerts*\n\n`
                : `🚨 *${criticalAlerts.length} cảnh báo nghiêm trọng*\n\n`;
              const msg = header +
                criticalAlerts.slice(0, 10).join("\n\n") +
                (criticalAlerts.length > 10 ? `\n\n_...và ${criticalAlerts.length - 10} cảnh báo khác_` : "") +
                (forceReleasedCount > 0 ? `\n\n✅ Đã force-release ${forceReleasedCount} bàn quá hạn.` : `\n\n🔍 Cron sẽ thử lại ở lần chạy tiếp theo.`);
              await sendTelegramNotification(botToken, chatId, msg, { parse_mode: "Markdown" });
            }
          } else {
            console.log("[Pass 0c] ✅ No critically overdue or extended OT assignments");
          }
        }

        // ── PASS 0d: Reconcile dealer states ──────────────────────────────────
        {
          const RECONCILE_TIMEOUT_MS = 3000;

          try {
            const response = await Promise.race([
              admin.rpc('reconcile_dealer_states', { p_club_id: cid }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('reconcile_timeout')), RECONCILE_TIMEOUT_MS)
              )
            ]);

            if (response.error) {
              console.error(`[Pass 0d] ❌ DB error:`, response.error.message);
            } else {
              const result = Array.isArray(response.data) ? response.data[0] : response.data;
              const orphan  = result?.fixed_pre_assigned_orphan ?? 0;
              const timeout  = result?.fixed_pre_assigned_timeout ?? 0;
              const orphanAssignments = result?.fixed_orphan_assignments ?? 0;
              const total    = (result?.fixed_available ?? 0)
                            + (result?.fixed_assigned ?? 0)
                            + orphan + timeout
                            + (result?.cleared_orphaned ?? 0)
                            + orphanAssignments;

              const ORPHAN_ALERT_THRESHOLD = 3;
              const TOTAL_FIXES_ALERT_THRESHOLD = 5;

              if (orphan > 0) {
                console.error(`[Pass 0d] 🚨 B6 pattern: ${orphan} orphaned pre_assigned`);
              }
              if (orphanAssignments > 0) {
                console.warn(
                  `[Pass 0d] B6 cleanup: ${orphanAssignments} orphan assignments released by Step 1.5`
                );
              }
              if (orphanAssignments > ORPHAN_ALERT_THRESHOLD) {
                console.error(`[Pass 0d] 🚨 Abnormal orphan count: ${orphanAssignments} — investigate B6 root cause`);
              }
              if (total > TOTAL_FIXES_ALERT_THRESHOLD) {
                console.error(`[Pass 0d] 🚨 Excessive fixes (${total})! Possible systemic issue.`);
              }
              if (total > 0) {
                console.warn(`[Pass 0d] ⚠️ Fixed ${total} inconsistencies:`, result);
              } else {
                console.log(`[Pass 0d] ✅ No inconsistencies found`);
              }
            }
          } catch (err: any) {
            const isTimeout = err.message === 'reconcile_timeout';
            console[isTimeout ? 'warn' : 'error'](
              `[Pass 0d] ${isTimeout ? '⏱️ Timed out' : '❌ Network error'} after ${RECONCILE_TIMEOUT_MS}ms`
            );
          }
        }

        // ── PASS 0e — Auto-end expired meal breaks ──────────────────────────────
        // End meal breaks that have exceeded their total_duration_minutes.
        // Runs before Pass 1 so dealers are back in pool for fillEmptyTables.
        try {
          const { data: expiredMealBreaks } = await admin
            .from("dealer_meal_breaks")
            .select("attendance_id, dealer_id, break_start, total_duration_minutes")
            .eq("status", "active")
            .eq("club_id", cid);

          if (expiredMealBreaks && expiredMealBreaks.length > 0) {
            const nowMs = Date.now();
            for (const mb of expiredMealBreaks) {
              const elapsedMin = (nowMs - new Date(mb.break_start).getTime()) / 60_000;
              if (elapsedMin >= mb.total_duration_minutes) {
                const result = await endMealBreak(admin, mb.attendance_id);
                if (result.ok && !result.alreadyEnded) {
                  console.log(`[Pass 0e] Auto-ended meal break for dealer ${mb.dealer_id} (${Math.floor(elapsedMin)}m elapsed, limit ${mb.total_duration_minutes}m)`);
                }
              }
            }
          }
        } catch (pass0eErr) {
          console.error("[Pass 0e] Meal break auto-end error:", pass0eErr instanceof Error ? pass0eErr.message : pass0eErr);
        }

        // B2.2b: still hold the lock before mutating? (lease reclaimed → abort)
        await ensureLockOwnership(admin, cid, lockToken, lockTimeoutSec);
        mark("pass1");
        // ── PASS 1 — Auto-fill empty tables ───────────────────────────────
        // RUNS FIRST (before pre-assign) so tables with NO dealer get priority.
        // Pre-assign only targets tables that ALREADY have a dealer due to swing soon.
        let fillResult: FillResult = {
          status: "ok",
          error_code: null,
          assignments: [],
          assignedAttendanceIds: new Set<string>(),
          diagnostics: [],
        };
        let fillAssessment = assessEmptyFillOutcome("ok", null);
        // Auto-fill empty ACTIVE tables. Gated: legacy global flag (OFF) OR the
        // Step-1 per-club opt-in (owner policy 2026-06-15, default OFF). Manual
        // "Gán" / "Gán loạt" buttons (assign-dealer / mass-assign) call
        // fillEmptyTables independently and are NOT affected by this gate.
        // Per-club path runs with availableOnly=true: only genuinely-free
        // dealers (no on_break), rest guard preserved, never opens a new table,
        // + a direct DM to the chosen dealer.
        const autoStaffThisClub = clubEnabled(AUTO_STAFF_EMPTY_TABLES_CLUB_IDS, String(cid));
        if (!dryRun && (AUTO_OPEN_EMPTY_TABLES_ENABLED || autoStaffThisClub)) {
          fillResult = await fillEmptyTables(
            admin, cid, shiftId, botToken ?? "", cycleExcludedIds, batchSwingDueAt,
            clubCfg.min_inter_swing_rest_minutes,
            autoStaffThisClub, // availableOnly — only on the per-club Step-1 path
          );
          fillAssessment = assessEmptyFillOutcome(
            fillResult.status,
            fillResult.error_code,
          );
          if (fillResult.status !== "ok") {
            markDispatchOutcome(
              fillAssessment.dispatchState,
              fillAssessment.dispatchErrorCode,
            );
            console.error("[process-swing] empty_fill_degraded", JSON.stringify({
              club_id: cid,
              status: fillResult.status,
              error_code: fillResult.error_code,
              diagnostics: fillResult.diagnostics,
            }));
          }
          for (const aid of fillResult.assignedAttendanceIds) cycleExcludedIds.add(aid);
          // Pass 1 swing_in intentionally NOT enqueued here:
          // formatMassAssignMessage already sends "Mở Bàn (N bàn)" batch.
          // Keeping only the direct Mở Bàn notification to avoid duplicate.
          if (fillResult.assignments.length > 0 && botToken && pass2ChatId) {
            const mopMsg = formatMassAssignMessage(
              fillResult.assignments.map(a => ({
                tableName: a.table_name,
                dealer: {
                  full_name: a.full_name,
                  telegram_username: (a as any).telegram_username ?? null,
                },
              }))
            );
            sendTelegramNotification(botToken, pass2ChatId, mopMsg).catch(err => console.error("[process-swing] Telegram error:", err));
          }
        }

        // ── PASS S2 — predictive pre-assign for empty tables (owner Step 2) ────
        // Per-club, default OFF. Runs AFTER Step-1 fill (so only tables with NO
        // available dealer remain empty) and after Pass 0e (freed dealers are
        // already 'available'). Reserves the soonest-free on_break dealer +
        // countdown Telegram, and executes reservations whose dealer's break has
        // ended (15-min rest gate). All via the reservation RPCs — never raw
        // updates. NEVER opens a new table; never pulls a dealer off break early.
        if (!dryRun && clubEnabled(AUTO_PREASSIGN_EMPTY_TABLES_CLUB_IDS, String(cid))) {
          try {
            const s2 = await runEmptyTablePreAssign(admin, cid, {
              botToken: botToken ?? undefined,
              chatId: pass2ChatId,
              minInterSwingRestMinutes: clubCfg.min_inter_swing_rest_minutes,
              swingDurationMinutes: (clubCfg as any).swing_duration_minutes ?? undefined,
            });
            if (s2.candidateStatus) {
              recordDispatchSafetyOutcome(
                cid,
                assessCandidateSnapshotFailure(
                  "passS2_candidate_snapshot",
                  s2.candidateStatus,
                  s2.candidateErrorCode,
                ),
              );
              clubsSkippedError++;
              console.warn(`[passS2] candidate snapshot unavailable for club ${cid}; remaining passes aborted.`);
              continue;
            }
            if (s2.executed || s2.reserved || s2.cancelled) {
              console.log(`[passS2] club=${cid} executed=${s2.executed} reserved=${s2.reserved} cancelled=${s2.cancelled}`);
            }
          } catch (s2Err) {
            recordDispatchSafetyOutcome(cid, assessCoreQueryFailure("passS2_reservation", s2Err));
            clubsSkippedError++;
            console.error("[passS2] error:", s2Err instanceof Error ? s2Err.message : s2Err);
            continue;
          }
        }

        await ensureLockOwnership(admin, cid, lockToken, lockTimeoutSec);  // B2.2b ownership guard
        mark("pass1b");
        // ── PASS 1b — Three-tier circuit breaker for stale pre-assign cleanup ──
        // Tier 3 (critical): pre-assign overdue ≥4h → force-release + alert
        // Tier 1+2 (stale):   pre-assign overdue ≥60min + assignment past due → cleanup
        if (clubTableIds.length === 0) {
          console.log(`[Pass 1b] No active tables for club ${cid}`);
        } else {
          // ═══ Fetch club info ONCE for all tiers ════════════════════════════
          const { data: clubInfo, error: clubInfoErr } = await admin
            .from("clubs")
            .select("name, last_critical_alert_at")
            .eq("id", cid)
            .single();
          if (clubInfoErr) {
            console.warn("[Pass 1b] \u26A0\uFE0F Failed to fetch club info:", clubInfoErr.message);
          }
          const clubName = clubInfo?.name ?? `Club ${cid.slice(0, 8)}`;

          const overdueThreshold = new Date(
            Date.now() - SWING_THRESHOLDS.OVERDUE_THRESHOLD_MINUTES * 60 * 1000
          ).toISOString();
          const criticalThreshold = new Date(
            Date.now() - SWING_THRESHOLDS.CRITICALLY_OVERDUE_HOURS * 60 * 60 * 1000
          ).toISOString();
          const nowISO = new Date().toISOString();

          // ─── Tier 3: Critically overdue (4h+) ────────────────────────────
          const { data: criticalRows, error: criticalErr } = await admin
            .from("dealer_assignments")
            .select("id, pre_assigned_attendance_id, pre_assigned_at, version")
            .eq("status", "assigned")
            .not("pre_assigned_attendance_id", "is", null)
            .lt("pre_assigned_at", criticalThreshold)
            .lt("swing_due_at", nowISO)
            .in("table_id", clubTableIds)
            .limit(SWING_THRESHOLDS.RELEASE_BATCH_SIZE);

          if (criticalErr) {
            console.error("[Pass 1b] \u274C Critical tier query error:", criticalErr.message);
          }

          let pass1bCriticalReleased = 0;
          const failedCritical: Array<{ assignmentId: string; reason: string }> = [];
          const successfulCritical: string[] = [];

          if (criticalRows && criticalRows.length > 0) {
            console.error(
              `[Pass 1b] \U0001F6D2 Force-releasing ${criticalRows.length} critical records ` +
              `(${SWING_THRESHOLDS.CRITICALLY_OVERDUE_HOURS}h+ overdue)`
            );

            const trulyCritical = criticalRows as StalePreAssignRow[];

            for (const row of trulyCritical) {
              if (!row.pre_assigned_attendance_id) {
                console.warn(`[Pass 1b] \u26A0\uFE0F Skipping assignment ${row.id} \u2014 missing attendance ID`);
                continue;
              }

              try {
                const { data: updData, error: updErr } = await admin
                  .from("dealer_assignments")
                  .update({
                    pre_assigned_attendance_id: null,
                    pre_assigned_at: null,
                    version: row.version + 1,
                  })
                  .eq("id", row.id)
                  .eq("version", row.version)
                  .is("released_at", null)
                  .select("id");

                if (updErr || !updData || updData.length === 0) {
                  console.warn(`[Pass 1b] \u26A0\uFE0F CAS skip for assignment ${row.id}: already modified`);
                  continue;
                }

                const transResult = await transitionDealerState(
                  admin, row.pre_assigned_attendance_id, "available",
                  "pass1b_release_critical_overdue"
                );

                if (!transResult.success && !transResult.noop) {
                  console.error(
                    `[Pass 1b] \U0001F6D2 INCONSISTENT: Assignment ${row.id} cleared but dealer ` +
                    `${row.pre_assigned_attendance_id} transition failed: ${transResult.error}`
                  );
                  failedCritical.push({
                    assignmentId: row.id,
                    reason: `Dealer transition failed: ${transResult.error}`
                  });

                  // ── Rollback with CAS protection and state verification ──
                  let rollbackSuccess = false;
                  for (let rollbackAttempt = 0; rollbackAttempt < SWING_THRESHOLDS.ROLLBACK_MAX_RETRIES; rollbackAttempt++) {
                    const { data: rolled, error: rollbackErr } = await admin
                      .from("dealer_assignments")
                      .update({
                        pre_assigned_attendance_id: row.pre_assigned_attendance_id,
                        pre_assigned_at: row.pre_assigned_at,
                        version: row.version + 2,
                      })
                      .eq("id", row.id)
                      .eq("version", row.version + 1)
                      .select("id");

                    if (!rollbackErr && rolled && rolled.length > 0) {
                      rollbackSuccess = true;
                      console.log(`[Pass 1b] \u2705 Rollback succeeded for ${row.id}${rollbackAttempt > 0 ? ` (attempt ${rollbackAttempt + 1})` : ""}`);
                      break;
                    }

                    // CAS failed or error — verify current state before deciding
                    if (!rollbackErr && (!rolled || rolled.length === 0)) {
                      const { data: currentAssignment } = await admin
                        .from("dealer_assignments")
                        .select("version, released_at, pre_assigned_attendance_id, status")
                        .eq("id", row.id)
                        .single();

                      if (!currentAssignment) {
                        console.error(
                          `[Pass 1b] \U0001F6D2 Assignment ${row.id} NOT FOUND during rollback \u2014 ` +
                          `dealer ${truncateId(row.pre_assigned_attendance_id)} may be stuck!`
                        );
                        await safeSendAlert(
                          admin, cid,
                          `\U0001F6D2 *ASSIGNMENT MISSING*: Assignment \`${truncateId(row.id)}\` not found during rollback. ` +
                          `Dealer \`${truncateId(row.pre_assigned_attendance_id)}\` may need manual verification.`,
                          botToken
                        );
                        if (row.pre_assigned_attendance_id) {
                          try {
                            await transitionDealerState(admin, row.pre_assigned_attendance_id, "available", "pass1b_rollback_missing_assignment");
                            console.log(`[Pass 1b] \u2705 Dealer ${row.pre_assigned_attendance_id} recovered to available`);
                            rollbackSuccess = true;
                          } catch (recoveryErr) {
                            console.error(`[Pass 1b] \u274C Failed to recover dealer:`, (recoveryErr as Error).message);
                          }
                        } else {
                          rollbackSuccess = true;
                        }
                        break;
                      }

                      if ((currentAssignment as any).status !== "assigned" || currentAssignment.released_at !== null) {
                        console.log(`[Pass 1b] Assignment ${row.id} no longer active (status: ${(currentAssignment as any).status})`);
                        rollbackSuccess = true;
                        break;
                      }

                      if (currentAssignment.version > row.version + 1) {
                        const versionDiff = currentAssignment.version - (row.version + 1);
                        console.error(
                          `[Pass 1b] \U0001F6D2 Assignment ${row.id} version jumped by ${versionDiff} ` +
                          `(expected ${row.version + 1}, found ${currentAssignment.version})`
                        );
                        const dealerNeedsRecovery = (currentAssignment as any).status === "assigned" &&
                                                     currentAssignment.pre_assigned_attendance_id === null &&
                                                     currentAssignment.released_at === null;
                        if (dealerNeedsRecovery) {
                          await safeSendAlert(
                            admin, cid,
                            `\U0001F6D2 *VERSION ANOMALY*: Assignment \`${truncateId(row.id)}\` version mismatch ` +
                            `(expected ${row.version + 1}, found ${currentAssignment.version}). ` +
                            `Dealer \`${truncateId(row.pre_assigned_attendance_id)}\` may be stuck. Manual check needed.`,
                            botToken
                          );
                        } else {
                          console.log(`[Pass 1b] Assignment ${row.id} active but appears resolved (version ${currentAssignment.version})`);
                        }
                        rollbackSuccess = true;
                        break;
                      }

                      console.warn(
                        `[Pass 1b] \u26A0\uFE0F Rollback attempt ${rollbackAttempt + 1}/${SWING_THRESHOLDS.ROLLBACK_MAX_RETRIES} ` +
                        `for ${row.id} \u2014 unexpected CAS failure, retrying`
                      );
                    } else if (rollbackErr) {
                      console.warn(
                        `[Pass 1b] \u26A0\uFE0F Rollback attempt ${rollbackAttempt + 1}/${SWING_THRESHOLDS.ROLLBACK_MAX_RETRIES} ` +
                        `for ${row.id}:`, rollbackErr.message
                      );
                    }

                    if (rollbackAttempt < SWING_THRESHOLDS.ROLLBACK_MAX_RETRIES - 1) {
                      const backoffMs = Math.min(
                        SWING_THRESHOLDS.ROLLBACK_BASE_BACKOFF_MS * Math.pow(2, rollbackAttempt),
                        SWING_THRESHOLDS.ROLLBACK_MAX_BACKOFF_MS
                      );
                      await new Promise(resolve => setTimeout(resolve, backoffMs));
                    }
                  }

                  if (!rollbackSuccess) {
                    console.error(`[Pass 1b] \U0001F6D2\U0001F6D2 ROLLBACK FAILED after ${SWING_THRESHOLDS.ROLLBACK_MAX_RETRIES} attempts for ${row.id}`);
                    await safeSendAlert(
                      admin, cid,
                      `\U0001F6D2\U0001F6D2 *ROLLBACK FAILED*: Assignment \`${truncateId(row.id)}\` stuck in inconsistent state. URGENT manual fix required!`,
                      botToken
                    );
                  }

                  continue;
                }

                successfulCritical.push(row.pre_assigned_attendance_id);
              } catch (err) {
                console.error(`[Pass 1b] \u274C Exception processing critical row ${row.id}:`, err);
                failedCritical.push({
                  assignmentId: row.id,
                  reason: `Exception: ${(err as Error).message}`
                });
              }
            }

            // Bulk clear dealer_attendance pre-assigned fields for successful critical releases
            if (successfulCritical.length > 0) {
              const criticalCleanOk = await bulkClearDealerPreAssignedFields(
                admin, successfulCritical, "critical"
              );
              if (!criticalCleanOk) {
                await sendAlert(
                  admin, cid,
                  `\U0001F6D2 *CRITICAL* (${clubName}): Failed to clear ${successfulCritical.length} dealers after retries. Manual cleanup required!`,
                  botToken
                );
              }
            }

            pass1bCriticalReleased = successfulCritical.length;

            // ── Throttle Telegram alerts via CAS update ─────────────────────
            const throttleThreshold = new Date(
              Date.now() - SWING_THRESHOLDS.ALERT_THROTTLE_HOURS * 60 * 60 * 1000
            ).toISOString();
            const { data: alertUpdated, error: alertUpdateErr } = await admin
              .from("clubs")
              .update({ last_critical_alert_at: new Date().toISOString() })
              .eq("id", cid)
              .or(`last_critical_alert_at.is.null,last_critical_alert_at.lt.${throttleThreshold}`)
              .select("id");

            const shouldSendAlert = alertUpdateErr || (alertUpdated && alertUpdated.length > 0);
            if (alertUpdateErr) {
              console.error("[Pass 1b] \u26A0\uFE0F Alert throttle update failed \u2014 sending anyway:", alertUpdateErr.message);
            }

            if (shouldSendAlert) {
              await sendCriticalAlert(admin, cid, clubName, trulyCritical, botToken);
            } else {
              console.log(`[Pass 1b] \U0001F507 Alert throttled (sent within last ${SWING_THRESHOLDS.ALERT_THROTTLE_HOURS}h)`);
            }
          }

          // ─── Tier 1+2: Stale pre-assign cleanup (60min+) ──────────────
          // Build exclusion set from Tier 3
          const criticalAssignmentIds = new Set(
            (criticalRows ?? []).map((r: any) => (r as StalePreAssignRow).id)
          );

          // Hoist counters for summary log
          let staleFoundCount = 0;
          let trulyStaleCount = 0;
          let tier2Count = 0;
          const allSuccessfulAttIds: string[] = [];
          const failedStaleTransitions: Array<{ rowId: string; dealerId: string; reason: string }> = [];

          let safetyThresholdMin = 15;
          let blockedRowsCount = 0;
          let safeStaleRowsCount = 0;
          let circuitBreakerThreshold = 0;

          const { data: allStaleRaw, error: staleErr } = await admin
            .from("dealer_assignments")
            .select("id, pre_assigned_attendance_id, pre_assigned_at, version")
            .eq("status", "assigned")
            .not("pre_assigned_attendance_id", "is", null)
            .lt("pre_assigned_at", overdueThreshold)
            .lt("swing_due_at", nowISO)
            .in("table_id", clubTableIds)
            .limit(SWING_THRESHOLDS.RELEASE_BATCH_SIZE);

          if (staleErr) {
            console.error("[Pass 1b] \u274C Stale tier query error:", staleErr.message);
          } else if (allStaleRaw && allStaleRaw.length > 0) {
            // Filter out critically overdue (already handled above)
            const staleRecords = (allStaleRaw as StalePreAssignRow[]).filter(
              r => !criticalAssignmentIds.has(r.id)
            );
            staleFoundCount = staleRecords.length;

            if (staleRecords.length > 0) {
              console.log(`[Pass 1b] Found ${staleRecords.length} stale pre-assign records`);

              // ── Classify into Tier 1 (truly stale) vs Tier 2 (still waiting) ──
              const attendanceIds = Array.from(new Set(
                staleRecords
                  .map(r => r.pre_assigned_attendance_id)
                  .filter((id): id is string => id !== null)
              ));

              const { data: staleAttendanceData, error: staleAttErr } = await admin
                .from("dealer_attendance")
                .select("id, current_state")
                .in("id", attendanceIds);

              if (staleAttErr) {
                console.error("[Pass 1b] \u274C Stale attendance query failed:", staleAttErr.message);
                console.warn("[Pass 1b] \u26A0\uFE0F Treating all as STILL WAITING (safe default) \u2014 skipping stale cleanup");
              } else {
                const attendanceMap = new Map<string, string>(
                  (staleAttendanceData ?? []).map((a: DealerAttendanceState) => [a.id, a.current_state])
                );

                const trulyStaleRows: StalePreAssignRow[] = [];

                for (const row of staleRecords) {
                  if (!row.pre_assigned_attendance_id) continue;
                  const dealerState = attendanceMap.get(row.pre_assigned_attendance_id);
                  if (dealerState !== "pre_assigned") {
                    trulyStaleRows.push(row);
                  } else {
                    tier2Count++;
                  }
                }

                trulyStaleCount = trulyStaleRows.length;

if (tier2Count > 0) {
                  console.log(`[Pass 1b] ℹ️ ${tier2Count} stale assignments — dealer still pre_assigned — monitoring only`);
                }

                // ── Pass 1b SAFEGUARD: Block recently pre-assigned dealers ──
                let safeStaleRows: StalePreAssignRow[];

                try {
                  const now = Date.now();
                  safetyThresholdMin = Math.max(clubCfg.pre_announce_minutes + 5, 15);
                  const safetyThresholdMs = safetyThresholdMin * 60 * 1000;

                  const blockedRows: Array<{ id: string; age: number }> = [];
                  safeStaleRows = [];

                  for (const row of trulyStaleRows) {
                    if (!row.pre_assigned_at) {
                      safeStaleRows.push(row);
                      continue;
                    }
                    const preAssignTime = new Date(row.pre_assigned_at).getTime();
                    const ageMs = now - preAssignTime;
                    const ageMinutes = Math.floor(ageMs / 60000);

                    if (ageMs < safetyThresholdMs) {
                      blockedRows.push({ id: row.id, age: ageMinutes });
                      continue;
                    }
                    safeStaleRows.push(row);
                  }

                  if (blockedRows.length > 0) {
                    const blockedSummary = blockedRows.length > 5
                      ? `${blockedRows.slice(0, 5).map(r => `${truncateId(r.id)}(${r.age}min)`).join(', ')} +${blockedRows.length - 5} more`
                      : blockedRows.map(r => `${truncateId(r.id)}(${r.age}min)`).join(', ');

                    console.warn(
                      `[Pass 1b] 🛡️ SAFEGUARD: Blocked ${blockedRows.length} assignments: ${blockedSummary} ` +
                      `(threshold: ${safetyThresholdMin}min)`
                    );
                  }

                  blockedRowsCount = blockedRows.length;

                  circuitBreakerThreshold = clubTableIds.length === 0
                    ? 0
                    : Math.max(
                        Math.min(Math.floor(clubTableIds.length * 0.3), clubTableIds.length - 1),
                        Math.min(clubTableIds.length, 3)
                      );

                  if (safeStaleRows.length === 0) {
                    console.log(`[Pass 1b] ✅ No stale assignments for ${clubTableIds.length} tables`);
                    safeStaleRowsCount = 0;
                  } else if (safeStaleRows.length >= circuitBreakerThreshold) {
                    const severity = safeStaleRows.length > clubTableIds.length * 0.5 ? '🚨 CRITICAL' : '⚠️ WARNING';

                    console.error(
                      `[Pass 1b] ${severity}: ${safeStaleRows.length} stale assignments ` +
                      `(${Math.round(safeStaleRows.length / clubTableIds.length * 100)}% of ${clubTableIds.length} tables) ` +
                      `exceeds threshold ${circuitBreakerThreshold}`
                    );

                    await safeSendAlert(admin, cid,
                      `${severity} *CIRCUIT BREAKER*: ${safeStaleRows.length}/${clubTableIds.length} stale assignments. ` +
                      `Processing limited to ${circuitBreakerThreshold}. Manual review required.`,
                      botToken
                    );

                    const originalCount = safeStaleRows.length;
                    safeStaleRows.splice(circuitBreakerThreshold);
                    safeStaleRowsCount = circuitBreakerThreshold;
                    console.warn(`[Pass 1b] Limited processing from ${originalCount} to ${circuitBreakerThreshold}`);
                  } else {
                    console.log(`[Pass 1b] Processing ${safeStaleRows.length} stale assignments (threshold: ${circuitBreakerThreshold})`);
                    safeStaleRowsCount = safeStaleRows.length;
                  }
                } catch (safeguardErr) {
                  console.error('[Pass 1b] ⚠️ Safeguard failed, falling back to unfiltered:', (safeguardErr as Error).message);
                  safeStaleRows = trulyStaleRows;
                  safeStaleRowsCount = trulyStaleRows.length;
                  blockedRowsCount = 0;
                  circuitBreakerThreshold = 0;
                }

                // ── Tier 1: Process safe stale assignments ────────────────
                if (safeStaleRows.length > 0) {
                  for (const row of safeStaleRows) {
                    try {
                      // Guard: skip rows with missing attendance ID
                      if (!row.pre_assigned_attendance_id) {
                        console.warn(`[Pass 1b] \u26A0\uFE0F Skipping row ${row.id} \u2014 missing attendance ID`);
                        continue;
                      }

                      const { data: updData, error: updErr } = await admin
                        .from("dealer_assignments")
                        .update({
                          pre_assigned_attendance_id: null,
                          pre_assigned_at: null,
                          version: row.version + 1,
                        })
                        .eq("id", row.id)
                        .is("released_at", null)
                        .select("id");

                      if (updErr || !updData || updData.length === 0) {
                        failedStaleTransitions.push({
                          rowId: row.id,
                          dealerId: row.pre_assigned_attendance_id,
                          reason: updErr?.message ?? "Update failed \u2014 no rows affected",
                        });
                        continue;
                      }

                      const transResult = await transitionDealerState(
                        admin, row.pre_assigned_attendance_id,
                        "available",
                        "pass1b_release_stale_pre_assign"
                      );

                      if (transResult.success || transResult.noop) {
                        allSuccessfulAttIds.push(row.pre_assigned_attendance_id);
                      } else {
                        failedStaleTransitions.push({
                          rowId: row.id,
                          dealerId: row.pre_assigned_attendance_id,
                          reason: transResult.error ?? "Unknown transition error",
                        });
                      }
                    } catch (err) {
                      failedStaleTransitions.push({
                        rowId: row.id,
                        dealerId: row.pre_assigned_attendance_id ?? "unknown",
                        reason: (err as Error).message,
                      });
                    }
                  }

                  if (failedStaleTransitions.length > 0) {
                    console.error(`[Pass 1b] \u274C ${failedStaleTransitions.length} stale transitions failed:`);
                    failedStaleTransitions.slice(0, SWING_THRESHOLDS.MAX_ERRORS_TO_LOG).forEach(({ rowId, dealerId, reason }) => {
                      console.error(`  - ${truncateId(rowId)} (dealer ${truncateId(dealerId)}): ${reason}`);
                    });
                    if (failedStaleTransitions.length > SWING_THRESHOLDS.MAX_ERRORS_TO_LOG) {
                      console.error(`  ... and ${failedStaleTransitions.length - SWING_THRESHOLDS.MAX_ERRORS_TO_LOG} more`);
                    }
                  }

                  if (allSuccessfulAttIds.length > 0) {
                    const staleCleanOk = await bulkClearDealerPreAssignedFields(
                      admin, allSuccessfulAttIds, "stale"
                    );
                    if (!staleCleanOk) {
                      await sendAlert(
                        admin, cid,
                        `\U0001F6D2 *CRITICAL* (${clubName}): Pass 1b bulk clear failed for ${allSuccessfulAttIds.length} dealers. Manual cleanup required!`,
                        botToken
                      );
                    }
                  }

                  console.log(`[Pass 1b] \u2705 Released ${allSuccessfulAttIds.length}/${safeStaleRows.length} stale dealers`);
                  }
                }
            }
          }

          // ── Pass 1b summary log ──────────────────────────────────────────
          console.log("[Pass 1b] Summary", JSON.stringify({
            club_id: cid,
            critical: {
              found: criticalRows?.length ?? 0,
              released: pass1bCriticalReleased,
              failed: failedCritical?.length ?? 0,
            },
            stale: {
              found: staleFoundCount,
              truly_stale: trulyStaleCount,
              safeguard_blocked: blockedRowsCount,
              safeguard_threshold_min: safetyThresholdMin,
              circuit_breaker: circuitBreakerThreshold,
              processed: safeStaleRowsCount,
              still_waiting: tier2Count,
              released: allSuccessfulAttIds.length,
              failed: failedStaleTransitions.length,
            },
            timestamp: new Date().toISOString(),
          }));
        }

        // ── Pass 1c: Release orphaned pre_assigned (no table, no assignment) ──
        if (cidDealerIds.length > 0) {
          const { data: orphanedAttendances } = await admin
            .from("dealer_attendance")
            .select("id")
            .eq("current_state", "pre_assigned")
            .is("pre_assigned_table_id", null)
            .in("dealer_id", cidDealerIds);
          if (orphanedAttendances && orphanedAttendances.length > 0) {
            const orphanIds = orphanedAttendances.map((r: { id: string }) => r.id);
            console.log(`[Pass 1c] Releasing ${orphanIds.length} orphaned pre_assigned dealers...`);
            let releaseOk = 0;
            let releaseFail = 0;
            for (const attId of orphanIds) {
              const result = await transitionDealerState(
                admin, attId, "available", "pass1c_release_orphan_pre_assign"
              );
              if (!result.success) {
                releaseFail++;
                if (releaseFail <= 3) console.error(`[Pass 1c] transitionDealerState failed for ${attId}:`, result.error);
                continue;
              }
              await admin.from("dealer_attendance")
                .update({ pre_assigned_table_id: null, pre_assigned_at: null })
                .eq("id", attId);
              releaseOk++;
            }
            if (releaseFail > 0) {
              console.error(`[Pass 1c] ❌ Released ${releaseOk}/${orphanIds.length} orphans (${releaseFail} failed)`);
            } else {
              console.log(`[Pass 1c] ✅ All ${releaseOk} orphaned dealers released with pass1c context`);
            }
          }
        }

        // ── SEED: Pre-assigned dealers remaining after cleanup ────────────────
        // Runs AFTER Pass 1b/1c cleanup so only TRULY pre-assigned dealers
        // (within the 10-min RECENT window) are excluded from Pass 2.
        // Dealers released by Pass 1b (stale) or Pass 1c (orphaned) are no
        // longer pre_assigned and correctly remain eligible for pre-assignment.
        if (!dryRun) {
          const { data: preAssignedDealers } = await admin
            .from("dealer_attendance")
            .select("id")
            .eq("current_state", "pre_assigned")
            .eq("status", "checked_in")
            .in("dealer_id", cidDealerIds);

          if (preAssignedDealers && preAssignedDealers.length > 0) {
            for (const d of preAssignedDealers) cycleExcludedIds.add(d.id);
            console.log(`[process-swing] Seeded ${preAssignedDealers.length} pre-assigned dealers into cycleExcludedIds for club ${cid}`);
          }
        }

        // ── Scheduler switch ─────────────────────────────────────────────
        // rotation_planner_enabled now selects the Forward Rotation Scheduler
        // (Pass R) instead of the legacy Pass 1.5 greedy planner. forceAll
        // ("Swing All") always uses the legacy execution semantics — manual
        // override means "swing everything due now".
        const scheduleDriven = !forceAll && clubCfg.rotation_planner_enabled === true;
        const passRCtx: PassRContext = {
          clubId: cid,
          clubZone,
          chatId: pass2ChatId,
          botToken: botToken ?? null,
          cycleExcludedIds,
          preAnnounceMinutes: clubCfg.pre_announce_minutes,
          minInterSwingRestMinutes: clubCfg.min_inter_swing_rest_minutes,
          clubBreakDurationMinutes: clubCfg.break_duration_minutes,
          swingDurationMinutes: clubCfg.swing_duration_minutes,
          tierAMinBuyin: clubCfg.tier_a_min_buyin,
          tierBMinBuyin: clubCfg.tier_b_min_buyin,
          requiredGameTypes: required_game_types,
        };

        await ensureLockOwnership(admin, cid, lockToken, lockTimeoutSec);  // B2.2b ownership guard
        mark("passR");
        // ── PASS R — Forward Rotation Scheduler ─────────────────────────
        // Reconcile/adopt → snapshot → honest OT marking → solve (R1-R6) →
        // persist schedule → CHỐT due slots + per-tournament Telegram batch.
        // swing_due_at is never written; shortage = honest later relief.
        if (scheduleDriven && !dryRun) {
          try {
            const passRResult = await passRRotationPlanner(admin, passRCtx);
            if (passRResult.candidateStatus) {
              recordDispatchSafetyOutcome(
                cid,
                assessCandidateSnapshotFailure(
                  "passR_candidate_snapshot",
                  passRResult.candidateStatus,
                  passRResult.candidateErrorCode,
                ),
              );
              clubsSkippedError++;
              console.warn(`[Pass R] candidate snapshot unavailable for club ${cid}; remaining passes aborted.`);
              continue;
            }
            metrics.total += passRResult.locked;
            metrics.success += passRResult.locked;
            if (passRResult.errors.length > 0) {
              recordDispatchSafetyOutcome(cid, assessCoreQueryFailure("passR_rotation", passRResult.errors.map((failure) => failure.error).join("; ")));
              console.error(
                `[Pass R] ${passRResult.errors.length} errors:`,
                passRResult.errors.map((e) => `${e.scope}: ${e.error}`).join("; ")
              );
            }
          } catch (err: any) {
            if (isCandidateSnapshotFailure(err)) {
              recordDispatchSafetyOutcome(
                cid,
                assessCandidateSnapshotFailure("passR_candidate_snapshot", err.status, err.errorCode),
              );
              clubsSkippedError++;
              console.warn(`[Pass R] candidate snapshot unavailable for club ${cid}; remaining passes aborted.`);
              continue;
            }
            console.error(`[Pass R] ❌ Unhandled error:`, err?.message ?? err);
            recordDispatchSafetyOutcome(cid, assessCoreQueryFailure("passR_rotation", err));
          }
        }

        // ── PASS 1.5 — LEGACY Rotation Planner (greedy batch pre-assign) ──
        // Only runs on the legacy path (scheduler off). Removed in Stage 4.
        if (!forceAll && !preAssignOnly && !scheduleDriven && clubCfg.rotation_planner_enabled) {
          try {
            const p15Result = await pass15RotationPlanner(admin, cid, {
              dryRun: !!dryRun,
              preAnnounceMinutes: clubCfg.pre_announce_minutes,
              requiredGameTypes: required_game_types,
              cycleExcludedIds,
              clubId: cid,
            });
            if (p15Result.candidateStatus) {
              recordDispatchSafetyOutcome(
                cid,
                assessCandidateSnapshotFailure(
                  "pass15_candidate_snapshot",
                  p15Result.candidateStatus,
                  p15Result.candidateErrorCode,
                ),
              );
              clubsSkippedError++;
              console.warn(`[Pass 1.5] candidate snapshot unavailable for club ${cid}; remaining passes aborted.`);
              continue;
            }
            console.log(
              `[Pass 1.5] ${p15Result.assigned} assigned, ` +
              `${p15Result.unassigned} unassigned` +
              `${p15Result.dryRun ? " (dryRun)" : ""}`
            );
            if (p15Result.errors.length > 0) {
              recordDispatchSafetyOutcome(
                cid,
                assessCoreQueryFailure("pass15_planner", {
                  message: p15Result.errors.map(e => `${e.tableId}: ${e.error}`).join("; "),
                }),
              );
              console.error(
                `[Pass 1.5] ${p15Result.errors.length} write errors:`,
                p15Result.errors.map(e => `${e.tableId}: ${e.error}`).join("; ")
              );
            }
          } catch (err: any) {
            if (isCandidateSnapshotFailure(err)) {
              recordDispatchSafetyOutcome(
                cid,
                assessCandidateSnapshotFailure("pass15_candidate_snapshot", err.status, err.errorCode),
              );
              clubsSkippedError++;
              console.warn(`[Pass 1.5] candidate snapshot unavailable for club ${cid}; remaining passes aborted.`);
              continue;
            }
            recordDispatchSafetyOutcome(cid, assessCoreQueryFailure("pass15_planner", err));
            console.error(`[Pass 1.5] ❌ Error:`, err.message);
          }
        }

        // ── PASS 2 — LEGACY pre-assign (scheduler off) ───────────────────
        // Uses pickNextDealer + CAS RPC to atomically pre-assign dealers
        // for tables whose swing due falls within the pre-announce window.
        // forceAll: skip pre-assign to preserve dealer pool for backlog processing.
        // Under the scheduler, Pass R owns pre-assignment entirely.
        if (!forceAll && !scheduleDriven) {
          // chatId hoisted to outer scope and passed into the pre-assign
          // notification helper (direct send with queue fallback).
          const pass2Options: Parameters<typeof pass2PreAssignNext>[3] = {
            clubZone,
            cycleExcludedIds,
            chatId: pass2ChatId,
            botToken,
            minInterSwingRestMinutes: clubCfg.min_inter_swing_rest_minutes,
          };
          if (preAssignOnly) {
            pass2Options.manualWindowMinutes = manualWindowMinutes;
          }
          let pass2Result: Awaited<ReturnType<typeof pass2PreAssignNext>>;
          try {
            pass2Result = await pass2PreAssignNext(
              admin, cid, clubCfg.pre_announce_minutes,
              pass2Options,
            );
          } catch (err) {
            if (isCandidateSnapshotFailure(err)) {
              recordDispatchSafetyOutcome(
                cid,
                assessCandidateSnapshotFailure("pass2_candidate_snapshot", err.status, err.errorCode),
              );
              clubsSkippedError++;
              console.warn(`[Pass 2] candidate snapshot unavailable for club ${cid}; remaining passes aborted.`);
              continue;
            }
            console.error(
              `[Pass 2] ❌ Unhandled error for club ${cid}:`,
              err instanceof Error ? err.stack : err
            );
            pass2Result = { pre_assigned_count: 0, skipped_count: 0, errors: [{ table_id: "", error: err instanceof Error ? err.message : String(err) }] };
          }
          if (pass2Result.errors.length > 0) {
            recordDispatchSafetyOutcome(
              cid,
              assessCoreQueryFailure("pass2_pre_assign", pass2Result.errors.map((failure) => failure.error).join("; ")),
            );
          }
          if (pass2Result.pre_assigned_count > 0) {
            console.log(`[Pass 2] ✅ Pre-assigned ${pass2Result.pre_assigned_count} dealers`);
          }
          metrics.total += pass2Result.pre_assigned_count;
          metrics.success += pass2Result.pre_assigned_count;
        }

        if (preAssignOnly) {
          console.log(`[process-swing] pre_assign_only mode — skipping Pass 2.5+ for club ${cid}`);
          continue;
        }

        // ── PASS 2.5 — Assign initial dealers to empty assignments ──────
        // Catches assignments that have status='assigned' but dealer_id=NULL.
        // This happens when the initial creation sets attendance_id but
        // dealer_id was never linked (e.g. pre-assign succeeded but the
        // subsequent swing that writes dealer_id failed).
        // Runs after Pass 2 so pre-assigned dealers get priority.
        {
          const pass25Result = await pass25InitialAssign(
            admin, cid, cycleExcludedIds, required_game_types, clubCfg.min_inter_swing_rest_minutes,
          );
          if (pass25Result.assigned_count > 0) {
            console.log(`[Pass 2.5] ✅ Assigned ${pass25Result.assigned_count} initial dealers`);
          }
        }

        // ── Dynamic swing duration ────────────────────────────────────────
        const swingDurResult = await computeSwingDuration(admin, cid, {
          swing_duration_minutes: clubCfg.swing_duration_minutes,
          auto_adjust_duration: clubCfg.auto_adjust_duration,
          min_duration: clubCfg.min_duration,
          max_duration: clubCfg.max_duration_minutes,
          sync_swings: clubCfg.sync_swings,
          sync_window_minutes: clubCfg.sync_window_minutes,
        });
        console.log(`[process-swing] Club ${cid} swing duration:`, swingDurResult.durationRationale);

        // B2.2b: final + most important ownership gate before executing real swings.
        await ensureLockOwnership(admin, cid, lockToken, lockTimeoutSec);
        mark("pass3");
        // ── PASS 3 — Execute swings at T-0 ────────────────────────────────
        const nowPlusBuf = new Date(Date.now() + SWING_WINDOW_BUFFER_MINUTES * 60 * 1000).toISOString();
        const now = new Date().toISOString();

        // ═══ DIAGNOSTIC: Compare simple vs nested query (Phase 1) ═══════
        try {
          const diagnostic = await runPass3Diagnostic(admin, cid, forceAll);
          console.log('[Pass 3 Diagnostic] Summary:', {
            confirmed_bug: diagnostic.confirmed_bug,
            lost_rows: diagnostic.lost_rows,
            simple_count: diagnostic.simple_query.count,
            nested_count: diagnostic.nested_query.data_length
          });
          if (shouldPersistPass3Diagnostic(diagnostic)) {
            await admin.from("diagnostic_logs").insert({
              timestamp: diagnostic.timestamp,
              club_id: diagnostic.club_id,
              diagnostic_type: 'pass3_query_issue',
              result: diagnostic,
              metadata: { force_all: forceAll, pass: 3 }
            }).then((result: any) => {
              const { error: insertErr } = result ?? {};
              if (insertErr) {
                console.warn('[Pass 3 Diagnostic] Failed to save:', insertErr.message);
              }
            });
          }
        } catch (diagErr: any) {
          console.warn('[Pass 3 Diagnostic] Diagnostic failed (non-blocking):', diagErr?.message);
        }
        // ═══ End diagnostic ═════════════════════════════════════════════

        const dueColumns = `
          id, table_id, table_session_id, attendance_id, swing_due_at, version, updated_at,
          last_swing_attempted_at, pre_assigned_attendance_id, pre_assigned_at,
          planned_relief_at,
          overtime_started_at, last_ot_alert_at, swing_in_progress, is_emergency_pre_assign,
          game_tables(table_name, table_type, status),
          dealer_attendance!attendance_id(dealers(full_name, telegram_username, telegram_user_id))
        `;

        const buildDueQuery = () => admin
          .from("dealer_assignments")
          .select(dueColumns)
          .eq("status", "assigned")
          .is("released_at", null)
          .is("swing_processed_at", null)
          .eq("club_id", cid)
          .lte("swing_due_at", forceAll ? now : nowPlusBuf);

        // Schedule-driven execution trigger: an announced lock whose honest
        // planned_relief_at has arrived. swing_due_at deliberately NOT in the
        // filter — under shortage relief is later than due (visible OT).
        // Uses `now` (NOT nowPlusBuf): planned_relief_at IS the exact intended
        // entry time and announce_at was set to relief − 3min. Firing the
        // 2-min legacy look-ahead buffer here would execute the swing up to
        // 2 min early, collapsing the 3-min announce lead and violating R2
        // (announce ≥3 min before entry). Slightly late (next 60s tick) is
        // safe; early is not.
        const buildScheduleDueQuery = () => admin
          .from("dealer_assignments")
          .select(dueColumns)
          .eq("status", "assigned")
          .is("released_at", null)
          .is("swing_processed_at", null)
          .eq("club_id", cid)
          .not("planned_relief_at", "is", null)
          .lte("planned_relief_at", now);

        const zombieCutoff = new Date(Date.now() - ZOMBIE_LOCK_WINDOW_MS).toISOString();

        const [{ data: preAssignedDueAssignments, error: preAssignedDueErr }, { data: normalDueAssignments, error: normalDueErr }, { data: zombieDueAssignments, error: zombieDueErr }] = await Promise.all([
          (scheduleDriven ? buildScheduleDueQuery() : buildDueQuery())
            .eq("swing_in_progress", false)
            .not("pre_assigned_attendance_id", "is", null)
            .order("swing_due_at", { ascending: true })
            .order("updated_at", { ascending: true })
            .order("id", { ascending: true })
            .limit(100),
          // Under the scheduler, tables without an announced lock are NOT
          // executed — they show honest OT with their predicted relief.
          scheduleDriven
            ? Promise.resolve({ data: [], error: null })
            : buildDueQuery()
                .eq("swing_in_progress", false)
                .is("pre_assigned_attendance_id", null)
                .order("swing_due_at", { ascending: true })
                .order("updated_at", { ascending: true })
                .order("id", { ascending: true })
                .limit(100),
          buildDueQuery()
            .eq("swing_in_progress", true)
            .lt("updated_at", zombieCutoff)
            .order("updated_at", { ascending: true })
            .order("swing_due_at", { ascending: true })
            .order("id", { ascending: true })
            .limit(100),
        ]);

        if (preAssignedDueErr || normalDueErr || zombieDueErr) {
          const err = preAssignedDueErr ?? normalDueErr ?? zombieDueErr;
          const failure = assessCoreQueryFailure("pass3_due_query", err);
          recordDispatchSafetyOutcome(cid, failure);
          clubsSkippedError++;
          console.error("[process-swing] Pass 3 query failed", {
            club_id: cid,
            stage: failure.diagnostic.stage,
            code: failure.diagnostic.code,
          });
          continue;
        }

        const dueAssignments = sortPass3Candidates([
          ...(preAssignedDueAssignments ?? []),
          ...(normalDueAssignments ?? []),
          ...(zombieDueAssignments ?? []),
        ]).slice(0, 8);

        const validatedBreakDuration = clubCfg.break_duration_minutes == null
          ? DEFAULT_BREAK_DURATION_MINUTES
          : Math.max(5, Math.min(60, clubCfg.break_duration_minutes));

        // Pre-compute consistent swing_due_at for all Pass 3 swings
        const pass3SwingDueAt = dryRun ? undefined : computeNextSwingAt(
          swingDurResult.durationMinutes,
          clubCfg.sync_swings ? { sync_swings: true, sync_window_minutes: clubCfg.sync_window_minutes } : undefined
        );

        const logPass3Diagnostic = async (
          diagnosticType: string,
          assignment: any,
          result: Record<string, unknown>,
          metadata: Record<string, unknown> = {},
        ) => {
          await admin.from("diagnostic_logs").insert({
            club_id: cid,
            diagnostic_type: diagnosticType,
            result,
            metadata: {
              table_id: assignment.table_id,
              attendance_id: assignment.attendance_id,
              assignment_id: assignment.id,
              ...metadata,
            },
          }).then((result: any) => {
            const { error } = result ?? {};
            if (error) console.warn(`[diagnostic_logs] ${diagnosticType} insert failed:`, error.message);
          });
        };

        const fetchAssignmentSnapshot = async (assignmentId: string) => {
          const { data, error } = await admin
            .from("dealer_assignments")
            .select("id, version, status, swing_processed_at, overtime_started_at, pre_assigned_attendance_id, swing_in_progress, updated_at, last_swing_attempted_at")
            .eq("id", assignmentId)
            .single();
          if (error) {
            console.warn(`[Pass 3] Failed to refresh assignment ${assignmentId}:`, error.message);
            return null;
          }
          return data as {
            id: string;
            version: number;
            status: string | null;
            swing_processed_at: string | null;
            overtime_started_at: string | null;
            pre_assigned_attendance_id: string | null;
            swing_in_progress: boolean | null;
            updated_at: string | null;
            last_swing_attempted_at: string | null;
          } | null;
        };

        const releasePass3Lock = async (locked: any, reason: string) => {
          if (dryRun || !(locked as any).__locked) return true;

          let query = admin
            .from("dealer_assignments")
            .update({ swing_in_progress: false })
            .eq("id", locked.id)
            .eq("swing_in_progress", true)
            .eq("version", (locked as any).__lockedVersion ?? locked.version);

          if (locked.last_swing_attempted_at) {
            query = query.eq("last_swing_attempted_at", locked.last_swing_attempted_at);
          }

          const { data, error } = await query
            .select("id")
            .maybeSingle();
          if (error || !data) {
            console.warn(`[Pass 3] lock release CAS lost for ${locked.id} (${reason})`, error?.message ?? "no row");
            return false;
          }

          (locked as any).__locked = false;
          return true;
        };

        const runReplacementFallback = async (
          fallbackAssignment: any,
          fallbackTableName: string,
          fallbackOutgoingDealer: any,
          fallbackReason: string,
          snapshot?: {
            version: number;
            status: string | null;
            swing_processed_at: string | null;
            overtime_started_at: string | null;
          } | null,
        ) => {
          const effectiveRow = snapshot ?? await fetchAssignmentSnapshot(fallbackAssignment.id);
          if (effectiveRow?.status === "completed" || effectiveRow?.swing_processed_at) {
            console.log(`[Pass 3] ${fallbackTableName} already completed after ${fallbackReason}`);
            metrics.success++;
            return;
          }

          const activeVersion = effectiveRow?.version ?? fallbackAssignment.version;
          const isOtFallback = !!effectiveRow?.overtime_started_at;
          const fbBreakDecision = isOtFallback
            ? { shouldBreak: true, reason: "mandatory" as const, workedMinutes: 999 }
            : await evaluateBreakNeed(admin, fallbackAssignment.attendance_id, {
                maxWorkMinutes: Math.max(DEFAULT_MAX_WORK_MINUTES, swingDurResult.durationMinutes * 3),
                minWorkMinutes: Math.max(DEFAULT_MIN_WORK_MINUTES, swingDurResult.durationMinutes * 2),
                clubId: cid,
                availableDealerCount,
                clubDealerIds: cidDealerIds,
              });

          const fbDealer = await pickNextDealer(admin, cid, {
            currentTableId: fallbackAssignment.table_id,
            excludeAttendanceIds: cycleExcludedIds,
            requiredGameTypes: required_game_types,
            minInterSwingRestMinutes: clubCfg.min_inter_swing_rest_minutes,
          });

          if (fbDealer) {
            const { breakDuration: fbBreakDuration } = await getBreakSettings(admin, cid);
            const { data: fbResult } = await performSwingWithDispatchSafety(cid, {
              p_assignment_id: fallbackAssignment.id,
              p_duration_minutes: swingDurResult.durationMinutes,
              p_send_to_break: fbBreakDecision.shouldBreak,
              p_break_duration_minutes: fbBreakDuration,
              p_expected_version: activeVersion,
              p_next_attendance_id: fbDealer.id,
            });

            if (fbResult?.outcome === "swung") {
              metrics.success++;
              cycleExcludedIds.add(fbDealer.id);
              if (SWING_CONFIRM_TELEGRAM_ENABLED && botToken && pass2ChatId) {
                const swingMsg = `🔵 ${mention({ full_name: fbDealer.full_name, telegram_username: fbDealer.telegram_username ?? null })} vào ${fallbackTableName}${fallbackOutgoingDealer.full_name !== "Unknown" ? ` - Thay ${mention({ full_name: fallbackOutgoingDealer.full_name, telegram_username: fallbackOutgoingDealer.telegram_username ?? null })}` : ""}`;
                sendTelegramNotification(botToken, pass2ChatId, swingMsg).catch(err => console.error("[process-swing] Telegram error:", err));
              }
              if (fbBreakDecision.shouldBreak) {
                notifier?.enqueue({
                  type: "break_start",
                  dealerName: fallbackOutgoingDealer.full_name,
                  username: fallbackOutgoingDealer.telegram_username ?? null,
                  telegramUserId: fallbackOutgoingDealer.telegram_user_id ? Number(fallbackOutgoingDealer.telegram_user_id) : null,
                  durationMin: clubCfg.break_duration_minutes,
                } satisfies BreakStartEvent);
              }
              try {
                const { data: fc2 } = await admin.rpc("count_available_dealers", { p_club_id: cid });
                availableDealerCount = fc2 ?? 0;
              } catch { /* keep stale count */ }
              const postAssign = await postSwingPreAssign(admin, cid, fbResult.new_assignment_id, fallbackAssignment.table_id, {
                chatId: pass2ChatId,
                botToken,
                minInterSwingRestMinutes: clubCfg.min_inter_swing_rest_minutes,
              });
              if (postAssign.assigned) {
                console.log(`[Pass 3] ✅ Post-swing pre-assigned ${postAssign.dealerName} for next swing at table ${fallbackTableName}`);
              } else if (postAssign.reason !== "no dealer available") {
                console.warn(`[Pass 3] ⚠️ Post-swing pre-assign issue: ${postAssign.reason}`);
              }
              return;
            }

            if (fbResult?.outcome === "no_dealer") {
              metrics.no_dealer++;
            } else {
              metrics.failed++;
              console.warn(`[process-swing] Replacement perform_swing outcome after ${fallbackReason}: ${fbResult?.outcome}`);
            }
            return;
          }

          const { breakDuration: otBreakDur } = await getBreakSettings(admin, cid);
          const { data: otResult } = await performSwingWithDispatchSafety(cid, {
            p_assignment_id: fallbackAssignment.id,
            p_duration_minutes: swingDurResult.durationMinutes,
            p_send_to_break: false,
            p_break_duration_minutes: otBreakDur,
            p_expected_version: activeVersion,
            p_next_attendance_id: null,
          });
          metrics.no_dealer++;
          if (otResult?.outcome !== "no_dealer") {
            metrics.failed++;
          }
        };

        // ── DRY RUN ───────────────────────────────────────────────────────
        if (dryRun && dueAssignments.length > 0) {
          console.log(`[process-swing] DRY RUN — club ${cid} would swing ${dueAssignments.length} assignments, skipping Pass 3 execution`);
          for (const da of dueAssignments) {
            metrics.total++;
            metrics.success++;
          }
          continue;
        }

        let pass3OperationalTables: DealerOperationalTable[];
        try {
          pass3OperationalTables = dueAssignments.length ? await getDealerOperationalTables(admin, cid) : [];
        } catch (error) {
          recordDispatchSafetyOutcome(cid, assessCoreQueryFailure("pass3_operational_inventory", error));
          clubsSkippedError++;
          continue;
        }
        for (const assignment of dueAssignments) {
          // A reusable physical status is not session truth. Absence/ambiguity
          // must not release either attendance or assignment; canonical RPCs
          // recheck exact session under their commit locks.
          if (!isExactOperationalAssignment(pass3OperationalTables, assignment)) {
            recordDispatchSafetyOutcome(cid, assessSwingExecutionFailure("pass3_session_unverified"));
            metrics.failed++;
            console.warn(`[process-swing] Pass3 assignment ${assignment.id}: exact session unverified; repair required`);
            continue;
          }
          metrics.total++;
          try {
          const tableName = assignment.game_tables?.table_name ?? assignment.table_id;
          const outgoingDealer = assignment.dealer_attendance?.dealers ?? { full_name: "Unknown" };
          const nowMs = Date.now();
          const minsLeft = Math.round(
            (new Date(assignment.swing_due_at).getTime() - nowMs) / 60000
          );
          const preAssignStatus = derivePreAssignStatus(assignment, nowMs);
          const isZombieLock = !!assignment.swing_in_progress && nowMs - new Date(assignment.updated_at).getTime() > ZOMBIE_LOCK_WINDOW_MS;

          if (assignment.pre_assigned_attendance_id && preAssignStatus === "stale" && !assignment.swing_in_progress) {
            await logPass3Diagnostic(
              "stale_lock_warning",
              assignment,
              {
                message: `Stale pre-assigned row for ${tableName}`,
                level: "WARNING",
                pre_assign_status: preAssignStatus,
              },
              {
                swing_due_at: assignment.swing_due_at,
                pre_assigned_at: assignment.pre_assigned_at,
                updated_at: assignment.updated_at,
                swing_in_progress: assignment.swing_in_progress,
              },
            );
          }
          if (isZombieLock) {
            await logPass3Diagnostic(
              "zombie_lock_warning",
              assignment,
              {
                message: `Zombie lock detected for ${tableName}`,
                level: "WARNING",
                updated_at: assignment.updated_at,
                version: assignment.version,
              },
              {
                swing_due_at: assignment.swing_due_at,
                last_swing_attempted_at: assignment.last_swing_attempted_at,
              },
            );
          }

          // ── Optimistic lock: prevent duplicate swing execution (Issue 2) ──
          // If two cron ticks or RPC retries both grab the same assignment,
          // the second CAS update will fail.
          if (!dryRun) {
            const lockAttemptAt = new Date().toISOString();
            const lockQuery = admin
              .from("dealer_assignments")
              .update({
                swing_in_progress: true,
                last_swing_attempted_at: lockAttemptAt,
              });
            const lockResult = isZombieLock
              ? await lockQuery
                  .eq("id", assignment.id)
                  .eq("swing_in_progress", true)
                  .eq("version", assignment.version)
                  .eq("updated_at", assignment.updated_at)
                  .select("id, version, updated_at, last_swing_attempted_at")
                  .maybeSingle()
              : await lockQuery
                  .eq("id", assignment.id)
                  .eq("swing_in_progress", false)
                  .select("id, version, updated_at, last_swing_attempted_at")
                  .maybeSingle();
            const lockedAssignment = lockResult.data;
            const lockErr = lockResult.error;
            if (lockErr || !lockedAssignment) {
              console.log(`[Pass 3] Skip ${tableName} — already in progress or lock failed`);
              if (isZombieLock) {
                await logPass3Diagnostic(
                  "zombie_lock_warning",
                  assignment,
                  {
                    message: `Zombie lock reclaim race lost for ${tableName}`,
                    level: "WARNING",
                    reason: "reclaim_race_lost",
                  },
                  {
                    updated_at: assignment.updated_at,
                    version: assignment.version,
                  },
                );
              }
              continue;
            }
            (assignment as any).__locked = true;
            (assignment as any).__lockedVersion = lockedAssignment.version;
            assignment.version = lockedAssignment.version;
            assignment.updated_at = lockedAssignment.updated_at ?? assignment.updated_at;
            assignment.last_swing_attempted_at = lockedAssignment.last_swing_attempted_at ?? lockAttemptAt;
          }
          // ── FORCE-RELEASE: Stuck swing detection (REPLACES 60-min circuit breaker) ──
          // If swing is overdue by > force_release_at_overdue_min (default 30),
          // call force_release_stuck_assignment RPC for atomic release.
          // Pass 0c also runs this logic, but Pass 3 catches it first if it gets here.
          // (The old 60-min CIRCUIT_BREAKER_THRESHOLD is removed — single source of truth
          //  lives in swing_escalation_config.force_release_at_overdue_min)
          const forceReleaseThresholdMin = await admin.rpc("get_escalation_config", { p_club_id: cid })
            .then((r: any) => r.data?.force_release_at_overdue_min ?? 30)
            .catch(() => 30);
          // Owner policy: NEVER force-release. When disabled, an overdue table
          // falls through to the normal pre-assigned-swing path below (relieve
          // only if a replacement is pre-assigned; otherwise the dealer stays on
          // OT — overtime_started_at already stamped by Pass R). No release, no
          // relaxed-guard escalation, no auto re-staff.
          if (FORCE_RELEASE_ENABLED && minsLeft < -forceReleaseThresholdMin) {
            console.error(
              `[Pass 3] 🚨 FORCE-RELEASE: ${tableName} overdue by ${-minsLeft}min (threshold ${forceReleaseThresholdMin}min)`
            );
            if (!dryRun) {
              const forceResult = await admin.rpc("force_release_stuck_assignment", {
                p_assignment_id: assignment.id,
                p_club_id: cid,
                p_reason: `pass3_force_release_overdue_${Math.min(-minsLeft, 240)}min`,
              });

              if (forceResult.error) {
                console.error(`[Pass 3] ❌ force_release_stuck_assignment RPC error:`, forceResult.error.message);
                metrics.failed++;
                continue;
              }

              const fr = forceResult.data as { success: boolean; reason?: string };
              if (!fr?.success) {
                console.warn(`[Pass 3] ⚠️ force_release_stuck_assignment returned:`, fr);
                metrics.failed++;
                continue;
              }

              console.log(`[Pass 3] ✅ Force-released ${tableName} (overdue ${-minsLeft}min)`);

              if (scheduleDriven) {
                // Scheduler path: cancel any live slot for this assignment so
                // the lock holder (if any) is released cleanly, then leave the
                // now-empty table to fillEmptyTables next tick. No escalation
                // tiers — R1 rest is absolute; shortage = honest later relief.
                const { data: frSlots } = await admin
                  .from("dealer_rotation_schedule")
                  .select("id")
                  .eq("assignment_id", assignment.id)
                  .in("status", ["predicted", "announced", "executing"]);
                for (const slot of frSlots ?? []) {
                  await admin.rpc("cancel_rotation_slot", {
                    p_schedule_id: slot.id,
                    p_reason: "force_released",
                  });
                }
                metrics.no_dealer++;
                console.log(`[Pass 3] ${tableName}: slots cancelled after force-release — fillEmptyTables re-staffs next tick`);
                continue;
              }

              // BUG #4 FIX: After force-release, try to find a replacement dealer.
              // The old dealer is released but the table still needs a dealer.
              // Attempt graduated tier picker; if no replacement, skip perform_swing
              // so the next tick can re-evaluate with fresh pool state.
              const forceMinutesOverdue = Math.max(0, -minsLeft);
              const { data: forceEscData } = await admin
                .rpc("get_escalation_config", { p_club_id: cid })
                .single()
                .catch(() => ({ data: null }));
              const forceReleaseEsc = forceEscData ?? {
                tier_1_min_overdue_min: 5, tier_1_min_rest_min: 5,
                tier_2_min_overdue_min: 15, tier_2_min_rest_min: 3, tier_2_skip_priority_break: true,
                tier_3_min_overdue_min: 30, tier_3_min_rest_min: 0, tier_3_skip_fatigue_cap: true,
                force_release_at_overdue_min: 30,
              };
              const forceExcludes = new Set([...cycleExcludedIds, assignment.attendance_id]);
              const forceBaseOpts = {
                currentTableId: assignment.table_id,
                excludeAttendanceIds: forceExcludes,
                requiredGameTypes: required_game_types,
                clubBreakDurationMinutes: clubCfg.break_duration_minutes,
                minInterSwingRestMinutes: clubCfg.min_inter_swing_rest_minutes,
              };

              let replacementDealer = await pickNextDealer(admin, cid, {
                ...forceBaseOpts,
                minRestMinutes: clubCfg.break_duration_minutes ?? 10,
              });

              if (!replacementDealer && forceMinutesOverdue >= forceReleaseEsc.tier_1_min_overdue_min) {
                replacementDealer = await pickNextDealer(admin, cid, {
                  ...forceBaseOpts,
                  minRestMinutes: forceReleaseEsc.tier_1_min_rest_min,
                });
              }
              if (!replacementDealer && forceMinutesOverdue >= forceReleaseEsc.tier_2_min_overdue_min) {
                replacementDealer = await pickNextDealer(admin, cid, {
                  ...forceBaseOpts,
                  minRestMinutes: forceReleaseEsc.tier_2_min_rest_min,
                  skipPriorityBreakGuard: forceReleaseEsc.tier_2_skip_priority_break,
                });
              }
              if (!replacementDealer && forceMinutesOverdue >= forceReleaseEsc.tier_3_min_overdue_min) {
                replacementDealer = await pickNextDealer(admin, cid, {
                  ...forceBaseOpts,
                  minRestMinutes: forceReleaseEsc.tier_3_min_rest_min,
                  skipPriorityBreakGuard: true,
                  skipFatigueHardCap: forceReleaseEsc.tier_3_skip_fatigue_cap,
                });
              }

              if (replacementDealer) {
                // ── PATCH J ──────────────────────────────────────────────────
                // force_release_stuck_assignment already set the old assignment to
                // status='completed', so the table is now EMPTY. perform_swing
                // requires status='assigned' and would therefore always return
                // 'not_found' here (the replacement was picked but never assigned).
                // Assign the replacement to the now-empty table via the same atomic
                // RPC fillEmptyTables uses (assign_dealer_to_table): it releases the
                // dealer's other active rows and honors idx_one_active_per_dealer.
                // ─────────────────────────────────────────────────────────────
                const frSwingDueAt = new Date(
                  Date.now() + Math.max(1, swingDurResult.durationMinutes) * 60_000,
                ).toISOString();

                // assign_dealer_to_table requires the replacement to be 'available'.
                // Under escalation, pickNextDealer can return an 'on_break' dealer; end
                // their break first so they can cover this overdue table (mirrors the
                // inline break-close the old perform_swing path performed). Guarded by
                // current_state='on_break' (CAS) and safe under the per-club cron lock.
                if (replacementDealer.current_state === "on_break") {
                  const frNowIso = new Date().toISOString();
                  await admin.from("dealer_breaks")
                    .update({ break_end: frNowIso })
                    .eq("attendance_id", replacementDealer.id)
                    .is("break_end", null);
                  await admin.from("dealer_attendance")
                    .update({ current_state: "available", worked_minutes_since_last_break: 0 })
                    .eq("id", replacementDealer.id)
                    .eq("current_state", "on_break");
                }

                const { data: frAssign, error: frAssignErr } = await admin.rpc("worker_assign_dealer_to_session_v1", {
                  p_attendance_id: replacementDealer.id,
                  p_table_id: assignment.table_id,
                  p_table_session_id: assignment.table_session_id,
                  p_swing_due_at: frSwingDueAt,
                  p_club_id: cid,
                  p_idempotency_key: `replacement_${assignment.id}_${assignment.table_session_id}_${assignment.version}`,
                });
                const frOutcome = typeof frAssign === "string" ? frAssign : (frAssign as any)?.outcome;

                if (!frAssignErr && frOutcome === "ok") {
                  metrics.success++;
                  cycleExcludedIds.add(replacementDealer.id);
                  console.log(`[Pass 3] ✅ Replacement after force-release: ${replacementDealer.full_name} → ${tableName}`);
                  if (SWING_CONFIRM_TELEGRAM_ENABLED && botToken && pass2ChatId) {
                    const swingMsg = `🔵 ${mention({ full_name: replacementDealer.full_name, telegram_username: replacementDealer.telegram_username ?? null })} vào ${tableName}${outgoingDealer.full_name !== "Unknown" ? ` - Thay ${mention({ full_name: outgoingDealer.full_name, telegram_username: (outgoingDealer as any).telegram_username ?? null })}` : ""}`;
                    sendTelegramNotification(botToken, pass2ChatId, swingMsg).catch(err => console.error("[process-swing] Telegram error:", err));
                  }
                  // Refresh available count after force-release replacement.
                  try {
                    const { data: fc2 } = await admin.rpc("count_available_dealers", { p_club_id: cid });
                    availableDealerCount = fc2 ?? 0;
                  } catch { /* keep stale count */ }
                } else {
                  metrics.no_dealer++;
                  console.warn(
                    `[Pass 3] ⚠️ assign_dealer_to_table after force-release for ${tableName} returned: ` +
                    `${frAssignErr?.message ?? frOutcome} — fillEmptyTables will fill it next tick`,
                  );
                }
              } else {
                metrics.no_dealer++;
                console.warn(`[Pass 3] ⚠️ No replacement after force-release for ${tableName} — table unassigned until next tick`);
              }
            }
            continue;
          }

          if (assignment.pre_assigned_attendance_id) {
            // ── Pre-assigned swing path ───────────────────────────────────
            const { data: preflightRaw, error: preflightError } = await admin
              .from("dealer_attendance")
              .select("current_state, status, last_released_at, dealers(full_name)")
              .eq("id", assignment.pre_assigned_attendance_id)
              .maybeSingle();
            const preflight = assessPreAssignPreflight(
              preflightRaw as any,
              preflightError,
              EXECUTE_MIN_REST_MINUTES,
            );

            if (preflight.kind === "query_error") {
              await logPass3Diagnostic(
                "preflight_query_error",
                assignment,
                {
                  message: `Preflight query failed for ${tableName}`,
                  level: "ERROR",
                  error: preflight.error,
                  action: "keep_outgoing_ot_retry_next_tick",
                },
                { pre_assigned_attendance_id: assignment.pre_assigned_attendance_id },
              );
              await releasePass3Lock(assignment, "preflight_query_error");
              metrics.failed++;
              continue;
            }

            const preflightAtt = preflight.attendance;
            const preflightInvalid = preflight.kind === "invalid";
            if (preflightInvalid) {
              await logPass3Diagnostic(
                "invalid_preassign",
                assignment,
                {
                  message: `Preflight invalid for ${tableName}`,
                  level: "WARNING",
                  current_state: preflightAtt?.current_state ?? "missing",
                  status: preflightAtt?.status ?? "missing",
                  dealer_name: preflightAtt?.full_name ?? "Unknown",
                },
                { pre_assigned_attendance_id: assignment.pre_assigned_attendance_id },
              );

              const lockedVersion = (assignment as any).__lockedVersion ?? assignment.version;
              const { data: cleared, error: clearError } = await admin
                .from("dealer_assignments")
                .update({
                  pre_assigned_attendance_id: null,
                  pre_assigned_at: null,
                  is_emergency_pre_assign: false,
                  swing_in_progress: false,
                })
                .eq("id", assignment.id)
                .eq("version", lockedVersion)
                .eq("swing_in_progress", true)
                .eq("pre_assigned_attendance_id", assignment.pre_assigned_attendance_id)
                .select("id, version, status, swing_processed_at, overtime_started_at")
                .maybeSingle();

              if (clearError || !cleared) {
                await logPass3Diagnostic(
                  "replan_outcome",
                  assignment,
                  {
                    message: `Invalid pre-assign cleanup race lost for ${tableName}`,
                    level: "WARNING",
                    outcome: "race_lost",
                    error: clearError?.message ?? null,
                  },
                );
                metrics.skipped++;
                continue;
              }
              (assignment as any).__locked = false;

              await admin
                .from("dealer_attendance")
                .update({
                  current_state: "available",
                  pre_assigned_table_id: null,
                  pre_assigned_at: null,
                })
                .eq("id", assignment.pre_assigned_attendance_id)
                .eq("current_state", "pre_assigned")
                .eq("pre_assigned_table_id", assignment.table_id);

              if (scheduleDriven) {
                const staleExcludes = new Set([
                  ...cycleExcludedIds,
                  assignment.attendance_id,
                  assignment.pre_assigned_attendance_id,
                ]);
                const replan = await replanSingleTable(
                  admin, passRCtx, assignment.id, staleExcludes, "invalid_preassign",
                );
                await logPass3Diagnostic(
                  "replan_outcome",
                  assignment,
                  {
                    message: `Invalid pre-assign replan for ${tableName}`,
                    level: replan.relocked ? "INFO" : "WARNING",
                    outcome: replan.relocked ? "relocked" : "no_replacement",
                    detail: replan.detail,
                  },
                );
                if (replan.relocked) metrics.success++;
                else metrics.skipped++;
              } else {
                await runReplacementFallback(
                  assignment,
                  tableName,
                  outgoingDealer,
                  "invalid_preassign",
                  cleared,
                );
                await logPass3Diagnostic(
                  "replan_outcome",
                  assignment,
                  {
                    message: `Legacy replacement attempted for ${tableName}`,
                    level: "INFO",
                    outcome: "fallback_attempted",
                  },
                );
              }
              continue;
            }

            // ── Execute-time HARD rest revalidation (owner policy 2026-06-13) ──
            // Planning may pre-assign a resting dealer expected to be valid by
            // swing time. At execute, the incoming dealer MUST have
            // >= EXECUTE_MIN_REST_MINUTES rest. If still short, DO NOT swing —
            // keep the current dealer on OT (Pass R already stamped it) and alert.
            // The pre-assign lock is left intact so a later tick swings once the
            // incoming dealer is rested. No force-release, no auto-pick, no bypass.
            const incomingRestMin = preflight.kind === "rest_blocked" || preflight.kind === "ready"
              ? preflight.restMinutes
              : Number.POSITIVE_INFINITY;
            if (incomingRestMin < EXECUTE_MIN_REST_MINUTES) {
              console.warn("[process-swing][pass3][rest-revalidation-block]", {
                club_id: cid,
                table_name: tableName,
                assignment_id: assignment.id,
                incoming_dealer_id: assignment.pre_assigned_attendance_id,
                incoming_dealer_name: preflightAtt?.full_name,
                incoming_rest_min: Math.floor(incomingRestMin),
                required_min: EXECUTE_MIN_REST_MINUTES,
                reason: "incoming_not_rested_keep_ot",
              });
              // (B, 2026-07-06) Scheduler mode: instead of waiting on a lock whose
              // incoming dealer isn't rested yet, re-plan THIS tick onto a genuinely-
              // rested free dealer (excluding the current OT dealer + the marginal
              // pre-assign). Still strictly planned-only: if no rested dealer is free,
              // replan fails and we fall through to the OT alert below — never a
              // force-release, never an unplanned pick.
              if (scheduleDriven) {
                const restExcludes = new Set([
                  ...cycleExcludedIds,
                  assignment.attendance_id,
                  assignment.pre_assigned_attendance_id,
                ]);
                const replan = await replanSingleTable(
                  admin, passRCtx, assignment.id, restExcludes, "incoming_not_rested",
                );
                if (replan.relocked) {
                  console.log(`[Pass 3] ${tableName}: not-rested lock re-planned to a rested dealer — ${replan.detail}`);
                  metrics.success++;
                  continue;
                }
                console.log(`[Pass 3] ${tableName}: no rested replacement to substitute — dealer stays on OT (${replan.detail})`);
              }
              if (botToken) {
                const chatId = await getClubTelegramChatId(admin, cid).catch(() => null);
                if (chatId) {
                  await sendTelegramNotification(
                    botToken, chatId,
                    `⏸ *${tableName}* — Hoãn đổi: ${preflightAtt?.full_name ?? "dealer thay"} mới nghỉ ${Math.floor(incomingRestMin)}ph (<${EXECUTE_MIN_REST_MINUTES}ph). Dealer hiện tại tiếp tục OT — cần can thiệp thủ công.`,
                    { parse_mode: "Markdown" },
                  ).catch((err: unknown) => console.error("[process-swing] Telegram error:", err));
                }
              }
              metrics.skipped++;
              continue;
            }

            const breakDecision = await evaluateBreakNeed(admin, assignment.attendance_id, {
              maxWorkMinutes: Math.max(DEFAULT_MAX_WORK_MINUTES, swingDurResult.durationMinutes * 3),
              minWorkMinutes: Math.max(DEFAULT_MIN_WORK_MINUTES, swingDurResult.durationMinutes * 2),
              clubId: cid,
              availableDealerCount,
              clubDealerIds: cidDealerIds,
            });

            const { data: rpcResult, error: rpcErr } = await admin.rpc(
              "worker_execute_pre_assigned_swing",
              {
                p_table_id:             assignment.table_id,
                p_table_session_id:     assignment.table_session_id,
                p_old_assignment_id:    assignment.id,
                p_expected_version:     (assignment as any).__lockedVersion ?? assignment.version,
                p_next_attendance_id:   assignment.pre_assigned_attendance_id,
                p_swing_due_at:         pass3SwingDueAt,
                p_duration_minutes:     swingDurResult.durationMinutes,
                p_send_to_break:        breakDecision.shouldBreak,
                p_break_duration_minutes: validatedBreakDuration,
              }
            );

            if (rpcErr) {
              const failure = assessCoreQueryFailure("swing_execution_rpc", rpcErr);
              recordDispatchSafetyOutcome(cid, failure);
              clubHadPass3Error = true;
              console.error("[process-swing][pass3][execute-failed]", {
                club_id: cid,
                stage: failure.diagnostic.stage,
                code: failure.diagnostic.code,
              });
              await logPass3Diagnostic("swing_execution_blocked", assignment, {
                status: "failed",
                error_code: failure.dispatchErrorCode,
                provider_code: failure.diagnostic.code,
              });
              metrics.failed++;
              if (preflightInvalid) {
                await runReplacementFallback(
                  assignment,
                  tableName,
                  outgoingDealer,
                  "refresh_failed",
                  null,
                );
              }
              continue;
            }

            switch (rpcResult?.status) {
              case "success":
                metrics.success++;
                cycleExcludedIds.add(assignment.pre_assigned_attendance_id);
                {
                  const refreshed = await fetchAssignmentSnapshot(assignment.id).catch(() => null);
                  if (!refreshed || (refreshed.status !== "completed" && !refreshed.swing_processed_at)) {
                    console.warn(`[process-swing] Post-RPC refresh failed or incomplete for ${tableName}, triggering replacement fallback`);
                    await runReplacementFallback(
                      assignment,
                      tableName,
                      outgoingDealer,
                      "refresh_failed",
                      refreshed,
                    );
                    break;
                  }
                }

                // Scheduler bookkeeping: the announced slot is now executed.
                if (scheduleDriven) {
                  const { data: doneSlots } = await admin
                    .from("dealer_rotation_schedule")
                    .select("id")
                    .eq("assignment_id", assignment.id)
                    .in("status", ["announced", "executing"]);
                  for (const slot of doneSlots ?? []) {
                    await admin.rpc("complete_rotation_slot", {
                      p_schedule_id: slot.id,
                      p_new_assignment_id: rpcResult?.new_assignment_id ?? null,
                    });
                  }
                }

                // Patch 2: send a present-tense completion confirmation now that
                // the pre-assigned swing has actually committed (refresh guard passed).
                // This is distinct from the Pass 2 pre-announce ("📋 Tiếp theo …",
                // future tense, fired minutes earlier): this branch confirms the
                // handoff is DONE. Fire-and-forget so a Telegram failure can never
                // fail the swing.
                if (SWING_CONFIRM_TELEGRAM_ENABLED && botToken && pass2ChatId) {
                  const incomingName = preflightAtt?.full_name ?? "Dealer";
                  const outgoingName =
                    outgoingDealer?.full_name && outgoingDealer.full_name !== "Unknown"
                      ? outgoingDealer.full_name
                      : null;
                  const swingMsg = outgoingName
                    ? `🔵 ${incomingName} vừa vào ${tableName}\nThay thế: ${outgoingName}`
                    : `🔵 ${incomingName} vừa vào ${tableName} (Bàn trống)`;
                  console.log("[process-swing][pass3][telegram-confirmation-dispatched]", {
                    club_id: cid,
                    table_id: assignment.table_id,
                    table_name: tableName,
                    incoming_dealer_name: incomingName,
                    outgoing_dealer_name: outgoingName,
                  });
                  sendTelegramNotification(botToken, pass2ChatId, swingMsg).catch((err) =>
                    console.error("[process-swing][pass3][telegram-confirmation-failed]", {
                      club_id: cid,
                      table_id: assignment.table_id,
                      table_name: tableName,
                      incoming_dealer_name: incomingName,
                      error: err?.message ?? String(err),
                    })
                  );
                }

                console.log("[process-swing][pass3][execute-success]", {
                  club_id: cid,
                  table_id: assignment.table_id,
                  table_name: tableName,
                  assignment_id: assignment.id,
                  incoming_dealer_id: assignment.pre_assigned_attendance_id,
                  incoming_dealer_name: preflightAtt?.full_name,
                  outgoing_dealer_name: outgoingDealer?.full_name,
                  new_assignment_id: rpcResult?.new_assignment_id,
                });

                try {
                  const { data: fc } = await admin.rpc("count_available_dealers", { p_club_id: cid });
                  availableDealerCount = fc ?? 0;
                } catch {
                  const { count: fb } = await admin
                    .from("dealer_attendance")
                    .select("id", { head: true, count: "exact" })
                    .in("dealer_id", cidDealerIds)
                    .eq("current_state", "available")
                    .eq("status", "checked_in");
                  availableDealerCount = fb ?? 0;
                }
                const postAssign3 = await postSwingPreAssign(admin, cid, rpcResult.new_assignment_id, assignment.table_id, {
                  chatId: pass2ChatId,
                  botToken,
                  minInterSwingRestMinutes: clubCfg.min_inter_swing_rest_minutes,
                });
                if (postAssign3.assigned) {
                  console.log(`[Pass 3] ✅ Post-swing pre-assigned ${postAssign3.dealerName} for next swing at table ${tableName}`);
                } else if (postAssign3.reason !== "no dealer available") {
                  console.warn(`[Pass 3] ⚠️ Post-swing pre-assign issue: ${postAssign3.reason}`);
                }
                // Swing-in confirmation already sent above (right after the refresh
                // guard). Pass 2 sends the future-tense pre-announce; the send above
                // is the present-tense "đã vào" confirmation — distinct, not a duplicate.
                if (breakDecision.shouldBreak) {
                  const outgoingUsername = (outgoingDealer as any)?.telegram_username ?? null;
                  notifier?.enqueue({
                    type: "break_start",
                    dealerName: outgoingDealer.full_name,
                    username: outgoingUsername,
                    telegramUserId: (outgoingDealer as any)?.telegram_user_id ? Number((outgoingDealer as any).telegram_user_id) : null,
                    durationMin: clubCfg.break_duration_minutes,
                  } satisfies BreakStartEvent);
                }
                break;

              case "race_lost": {
                // Phase 2: No-show detection — distinguish actual race_lost from dealer no-show
                const incomingId = assignment.pre_assigned_attendance_id;
                let isNoShow = false;
                let incomingAtt: { current_state: string; status: string; full_name: string } | null = null;

                if (incomingId) {
                  const { data, error } = await admin
                    .from("dealer_attendance")
                    .select("current_state, status, dealers(full_name)")
                    .eq("id", incomingId)
                    .single();
                  if (error || !data) {
                    isNoShow = true;
                  } else {
                    const dealer = Array.isArray((data as any).dealers)
                      ? (data as any).dealers[0]
                      : (data as any).dealers;
                    incomingAtt = {
                      current_state: (data as any).current_state,
                      status: (data as any).status,
                      full_name: dealer?.full_name ?? "Unknown",
                    };
                    // PATCH J: a dealer who cleanly released to 'available' between the
                    // preflight check and the RPC is a BENIGN race, not a no-show — do
                    // not blame them. Fall through to the normal race_lost fallback
                    // below, which swings a fresh dealer (the old dealer is still
                    // 'assigned' since race_lost rolled back, so the table is not
                    // dealer-less). Only flag a genuine no-show for truly invalid
                    // states (checked_out, missing, or assigned/in_transition/on_break
                    // elsewhere — i.e. neither 'pre_assigned' nor 'available').
                    if (
                      !incomingAtt ||
                      incomingAtt.status === "checked_out" ||
                      (incomingAtt.current_state !== "pre_assigned" &&
                        incomingAtt.current_state !== "available")
                    ) {
                      isNoShow = true;
                    }
                  }
                }

                if (isNoShow && incomingId) {
                  // ── Phase 2: NO-SHOW HANDLING ──
                  console.warn(`[Pass 3] NO-SHOW detected: ${incomingAtt?.full_name ?? "Unknown"} for ${tableName}`);

                  // 1. Log to diagnostic_logs (no Telegram)
                  await admin.from("diagnostic_logs").insert({
                    club_id: cid,
                    diagnostic_type: "dealer_no_show",
                    result: {
                      message: `Dealer ${incomingAtt?.full_name ?? "Unknown"} no-show for ${tableName}`,
                      level: "WARNING",
                      attendance_id: incomingId,
                      table_id: assignment.table_id,
                      previous_state: incomingAtt?.current_state ?? "not_found",
                    },
                    metadata: {
                      swing_due_at: assignment.swing_due_at,
                      is_emergency_pre_assign: assignment.is_emergency_pre_assign,
                    },
                  }).then((result: any) => {
                    const { error } = result ?? {};
                    if (error) console.warn("[diagnostic_logs] no_show insert failed:", error.message);
                  });

                  if (scheduleDriven) {
                    // Scheduler path: mark the slot no_show (cancel_rotation_slot
                    // clears the lock + frees the dealer atomically), then plan
                    // and lock a replacement THIS tick with the 3-min lead.
                    // swing_due_at untouched — OT keeps accruing honestly.
                    const noShowExcludes = new Set([
                      ...cycleExcludedIds,
                      assignment.attendance_id,
                      incomingId,
                    ]);
                    const replan = await replanSingleTable(
                      admin, passRCtx, assignment.id, noShowExcludes, "no_show",
                    );
                    console.log(`[Pass 3] ${tableName}: no-show re-planned — ${replan.detail}`);
                    if (replan.relocked) metrics.success++;
                    else metrics.no_dealer++;
                    break; // End of no-show handling (scheduler path)
                  }

                  // 2. Clear pre-assign
                  await admin.from("dealer_assignments").update({
                    pre_assigned_attendance_id: null,
                    is_emergency_pre_assign: false,
                    pre_assigned_at: null,
                  }).eq("id", assignment.id);

                  // 3. Find replacement (exclude the no-show dealer to prevent ping-pong)
                  const noShowExcludes = new Set([...cycleExcludedIds, incomingId]);
                  const basePickOptions = {
                    currentTableId: assignment.table_id,
                    excludeAttendanceIds: noShowExcludes,
                    requiredGameTypes: required_game_types,
                    minInterSwingRestMinutes: clubCfg.min_inter_swing_rest_minutes,
                  };

                  let replacementDealer = await pickNextDealer(admin, cid, {
                    ...basePickOptions,
                    minRestMinutes: clubCfg.break_duration_minutes ?? 10,
                  });

                  // Escalation Tiers (copy from Pass 3 non-pre-assigned path)
                  const minutesOverdue = Math.max(0, -Math.round((new Date(assignment.swing_due_at).getTime() - Date.now()) / 60000));
                  const { data: escalationConfig } = await admin
                    .rpc("get_escalation_config", { p_club_id: cid })
                    .single()
                    .catch(() => ({ data: null }));
                  const esc = escalationConfig ?? {
                    tier_1_min_overdue_min: 5, tier_1_min_rest_min: 5,
                    tier_2_min_overdue_min: 15, tier_2_min_rest_min: 3, tier_2_skip_priority_break: true,
                    tier_3_min_overdue_min: 30, tier_3_min_rest_min: 0, tier_3_skip_fatigue_cap: true,
                    force_release_at_overdue_min: 30,
                  };

                  if (!replacementDealer && minutesOverdue >= esc.tier_1_min_overdue_min) {
                    replacementDealer = await pickNextDealer(admin, cid, {
                      ...basePickOptions,
                      minRestMinutes: esc.tier_1_min_rest_min,
                    });
                  }
                  if (!replacementDealer && minutesOverdue >= esc.tier_2_min_overdue_min) {
                    replacementDealer = await pickNextDealer(admin, cid, {
                      ...basePickOptions,
                      minRestMinutes: esc.tier_2_min_rest_min,
                      skipPriorityBreakGuard: esc.tier_2_skip_priority_break,
                    });
                  }
                  if (!replacementDealer && minutesOverdue >= esc.tier_3_min_overdue_min) {
                    replacementDealer = await pickNextDealer(admin, cid, {
                      ...basePickOptions,
                      minRestMinutes: esc.tier_3_min_rest_min,
                      skipPriorityBreakGuard: true,
                      skipFatigueHardCap: esc.tier_3_skip_fatigue_cap,
                    });
                  }

                  if (replacementDealer) {
                    // 4a. Emergency Re-assign with delay
                    const notifyMinutes = clubCfg.pre_announce_minutes ?? 3;
                    const newSwingDueAt = new Date(Date.now() + notifyMinutes * 60_000);

                    const { error: emErr } = await admin
                      .from("dealer_assignments")
                      .update({
                        pre_assigned_attendance_id: replacementDealer.id,
                        pre_assigned_at: new Date().toISOString(),
                        swing_due_at: newSwingDueAt.toISOString(),
                        is_emergency_pre_assign: true,
                      })
                      .eq("id", assignment.id)
                      .is("pre_assigned_attendance_id", null);

                    if (!emErr) {
                      await admin.from("dealer_attendance")
                        .update({ current_state: "pre_assigned" })
                        .eq("id", replacementDealer.id);

                      // Log success (no Telegram)
                      await admin.from("diagnostic_logs").insert({
                        club_id: cid,
                        diagnostic_type: "emergency_re_assign",
                        result: {
                          message: `Re-assigned ${replacementDealer.full_name} to ${tableName} after no-show`,
                          level: "INFO",
                          new_attendance_id: replacementDealer.id,
                          delay_minutes: notifyMinutes,
                          swing_at: newSwingDueAt.toISOString(),
                        },
                        metadata: { no_show_dealer_id: incomingId },
                      }).then((result: any) => {
                        const { error } = result ?? {};
                        if (error) console.warn("[diagnostic_logs] emergency_re_assign insert failed:", error.message);
                      });

                      metrics.success++;
                      cycleExcludedIds.add(replacementDealer.id);
                      console.log(`[Pass 3] 🔄 No-show re-assign: ${replacementDealer.full_name} → ${tableName} in ${notifyMinutes} min`);
                    } else {
                      console.error(`[Pass 3] Failed to re-assign after no-show for ${tableName}:`, emErr);
                      // Fallback to OT
                      const { breakDuration: otBreakDur } = await getBreakSettings(admin, cid);
                      await performSwingWithDispatchSafety(cid, {
                        p_assignment_id: assignment.id,
                        p_duration_minutes: swingDurResult.durationMinutes,
                        p_send_to_break: false,
                        p_break_duration_minutes: otBreakDur,
                        p_expected_version: (assignment as any).__lockedVersion ?? assignment.version,
                        p_next_attendance_id: null,
                      });
                      metrics.no_dealer++;
                      await admin.from("diagnostic_logs").insert({
                        club_id: cid,
                        diagnostic_type: "swing_ot_fallback",
                        result: {
                          message: `No replacement after no-show for ${tableName}. ${outgoingDealer.full_name} continues OT.`,
                          level: "ERROR",
                        },
                        metadata: { table_id: assignment.table_id, outgoing_dealer_id: assignment.attendance_id },
                      }).then((result: any) => {
                        const { error } = result ?? {};
                        if (error) console.warn("[diagnostic_logs] ot_fallback insert failed:", error.message);
                      });
                    }
                  } else {
                    // 4b. No replacement → OT mode
                    const { breakDuration: otBreakDur } = await getBreakSettings(admin, cid);
                    await performSwingWithDispatchSafety(cid, {
                      p_assignment_id: assignment.id,
                      p_duration_minutes: swingDurResult.durationMinutes,
                      p_send_to_break: false,
                      p_break_duration_minutes: otBreakDur,
                      p_expected_version: (assignment as any).__lockedVersion ?? assignment.version,
                      p_next_attendance_id: null,
                    });
                    metrics.no_dealer++;
                    await admin.from("diagnostic_logs").insert({
                      club_id: cid,
                      diagnostic_type: "swing_ot_fallback",
                      result: {
                        message: `No replacement after no-show for ${tableName}. ${outgoingDealer.full_name} continues OT.`,
                        level: "ERROR",
                      },
                      metadata: { table_id: assignment.table_id, outgoing_dealer_id: assignment.attendance_id },
                    }).then((result: any) => {
                      const { error } = result ?? {};
                      if (error) console.warn("[diagnostic_logs] ot_fallback insert failed:", error.message);
                    });
                    console.log(`[Pass 3] ❌ No-show fallback: ${tableName} -> OT mode`);
                  }

                  break; // End of no-show handling
                }

                // ── Normal race_lost fallback (dealer still pre_assigned but lost race) ──
                cycleExcludedIds.add(assignment.pre_assigned_attendance_id);
                console.warn(`[process-swing] Pre-assign race_lost for ${tableName}, fallback...`);

                const { data: freshRow } = await admin
                  .from("dealer_assignments")
                  .select("id, version, overtime_started_at, status, swing_processed_at")
                  .eq("id", assignment.id)
                  .single();

                if (!freshRow) {
                  console.warn(`[process-swing] Assignment ${assignment.id} not found after race_lost`);
                  break;
                }

                if (freshRow.status === "completed" || freshRow.swing_processed_at !== null) {
                  console.log(`[process-swing] Assignment ${assignment.id} already completed`);
                  metrics.success++;
                  break;
                }

                if (scheduleDriven) {
                  // Scheduler path: NO perform_swing fallback (it would bypass
                  // R1/R3 ordering via its internal auto-pick). Cancel the dead
                  // slot and re-plan + re-lock this tick; the table stays
                  // honestly OT until its replacement's relief time.
                  const raceExcludes = new Set([
                    ...cycleExcludedIds,
                    assignment.attendance_id,
                  ]);
                  const replan = await replanSingleTable(
                    admin, passRCtx, assignment.id, raceExcludes, "race_lost",
                  );
                  console.log(`[Pass 3] ${tableName}: race_lost re-planned — ${replan.detail}`);
                  if (replan.relocked) metrics.success++;
                  else metrics.no_dealer++;
                  break;
                }

                const isOtFallback = !!(freshRow as any).overtime_started_at;
                const fbBreakDecision = isOtFallback
                  ? { shouldBreak: true, reason: "mandatory" as const, workedMinutes: 999 }
                  : await evaluateBreakNeed(admin, assignment.attendance_id, {
                      maxWorkMinutes: Math.max(DEFAULT_MAX_WORK_MINUTES, swingDurResult.durationMinutes * 3),
                      minWorkMinutes: Math.max(DEFAULT_MIN_WORK_MINUTES, swingDurResult.durationMinutes * 2),
                      clubId: cid,
                      availableDealerCount,
                      clubDealerIds: cidDealerIds,
                    });

                const fbDealer = await pickNextDealer(admin, cid, {
                  currentTableId: assignment.table_id,
                  excludeAttendanceIds: cycleExcludedIds,
                  requiredGameTypes: required_game_types,
                  minInterSwingRestMinutes: clubCfg.min_inter_swing_rest_minutes,
                });

                if (fbDealer) {
                  const { breakDuration: fbBreakDuration } = await getBreakSettings(admin, cid);
                  const { data: fbResult } = await performSwingWithDispatchSafety(cid, {
                    p_assignment_id: assignment.id,
                    p_duration_minutes: swingDurResult.durationMinutes,
                    p_send_to_break: fbBreakDecision.shouldBreak,
                    p_break_duration_minutes: fbBreakDuration,
                    p_expected_version: freshRow.version,
                    p_next_attendance_id: fbDealer.id,
                  });

                  if (fbResult?.outcome === "swung") {
                    metrics.success++;
                    cycleExcludedIds.add(fbDealer.id);
                    if (SWING_CONFIRM_TELEGRAM_ENABLED && botToken && pass2ChatId) {
                      const swingMsg = `🔵 ${mention({ full_name: fbDealer.full_name, telegram_username: fbDealer.telegram_username ?? null })} vào ${tableName}${outgoingDealer.full_name !== "Unknown" ? ` - Thay ${mention({ full_name: outgoingDealer.full_name, telegram_username: (outgoingDealer as any).telegram_username ?? null })}` : ""}`;
                      sendTelegramNotification(botToken, pass2ChatId, swingMsg).catch(err => console.error("[process-swing] Telegram error:", err));
                    }
                  } else if (fbResult?.outcome === "no_dealer") {
                    metrics.no_dealer++;
                    if (fbResult.is_new_overtime) {
                      const chatId = await getClubTelegramChatId(admin, cid);
                      if (botToken && chatId) {
                        await sendTelegramNotification(botToken, chatId,
                          `⏱ *${tableName}* — Dealer đang OT (fallback sau race_lost).`, {});
                      }
                    }
                  } else {
                    metrics.failed++;
                    console.warn(`[process-swing] Fallback perform_swing outcome: ${fbResult?.outcome}`);
                  }
                } else {
                  // No fallback → OT path
                  const { breakDuration: otBreakDur } = await getBreakSettings(admin, cid);
                  const { data: otResult } = await performSwingWithDispatchSafety(cid, {
                    p_assignment_id: assignment.id,
                    p_duration_minutes: swingDurResult.durationMinutes,
                    p_send_to_break: false,
                    p_break_duration_minutes: otBreakDur,
                    p_expected_version: freshRow.version,
                    p_next_attendance_id: null,
                  });
                  metrics.no_dealer++;
                  if (otResult?.outcome === "no_dealer" && otResult?.is_new_overtime) {
                    const chatId = await getClubTelegramChatId(admin, cid);
                    if (botToken && chatId) {
                      await sendTelegramNotification(botToken, chatId,
                        `⏱ *${tableName}* — Dealer OT (không người thay sau race_lost).`, {});
                    }
                  }
                }
                break;
              }

              default: {
                const failure = assessSwingExecutionFailure(rpcResult?.error);
                recordDispatchSafetyOutcome(cid, failure);
                clubHadPass3Error = true;
                console.error("[process-swing][pass3][execute-failed]", {
                  club_id: cid,
                  stage: failure.diagnostic.stage,
                  code: failure.diagnostic.code,
                });
                await logPass3Diagnostic("swing_execution_blocked", assignment, {
                  status: "blocked",
                  error_code: failure.dispatchErrorCode,
                  rpc_status: typeof rpcResult?.status === "string" ? rpcResult.status : "unknown",
                });
                metrics.failed++;
                break;
              }
            }
          } else {
            // ── Non-pre-assigned path ─────────────────────────────────────
            // Under the scheduler this branch is unreachable via the normal
            // queries (the schedule query requires a pre-assigned lock; the
            // legacy no-lock query is disabled) — only the shared zombie-
            // reclaim query can route a stuck no-lock row here. The legacy
            // path below mutates the immutable swing_due_at and falls back
            // to perform_swing auto-pick, both forbidden under the scheduler
            // (R1/R3/R4). Recover the stuck lock instead — the finally below
            // resets swing_in_progress — and let Pass R re-plan the table.
            if (scheduleDriven) {
              console.warn(
                `[Pass 3] zombie reclaim on un-locked ${tableName} under scheduler — ` +
                `releasing stuck swing_in_progress; Pass R re-plans next tick`
              );
              continue;
            }
            const isOtDealer = !!(assignment as any).overtime_started_at;

            const breakDecision = isOtDealer
              ? { shouldBreak: true, reason: "mandatory" as const, workedMinutes: 999 }
: await evaluateBreakNeed(admin, assignment.attendance_id, {
                   maxWorkMinutes: swingDurResult.durationMinutes * 3,
                   minWorkMinutes: swingDurResult.durationMinutes * 2,
                   clubId: cid,
                   availableDealerCount,
                   clubDealerIds: cidDealerIds,
                 });

            const nextExcludes = new Set([...cycleExcludedIds, assignment.attendance_id]);

            // Compute OT minutes for escalation threshold check
            const otMinutes = isOtDealer && (assignment as any).overtime_started_at
              ? Math.floor((Date.now() - new Date((assignment as any).overtime_started_at).getTime()) / 60000)
              : 0;

            // Shared base options for all pick attempts
            const basePickOptions = {
              currentTableId: assignment.table_id,
              excludeAttendanceIds: nextExcludes,
              requiredGameTypes: required_game_types,
              clubBreakDurationMinutes: clubCfg.break_duration_minutes,
              minInterSwingRestMinutes: clubCfg.min_inter_swing_rest_minutes,
            };

            // ── Graduated escalation: config-driven, NOT hardcoded ────────────
            // Fetch per-club thresholds from swing_escalation_config.
            // Falls back to defaults (5/15/30, force=30) if no config row.
            // Tier 0 (normal): default 10-min min_rest from swing_config.break_duration_minutes
            // Tier 1 (5+ min overdue):  min_rest=5
            // Tier 2 (15+ min overdue): min_rest=3, skip priority break guard
            // Tier 3 (30+ min overdue): min_rest=0, skip fatigue cap (last resort)
            // After Tier 3 fails: force_release_stuck_assignment RPC (Pass 0c also calls)
            const minutesOverdue = Math.max(0, -minsLeft);
            const { data: escalationConfig, error: escErr } = await admin
              .rpc("get_escalation_config", { p_club_id: cid })
              .single();
            if (escErr) {
              console.warn(`[Pass 3] ⚠️ Failed to fetch escalation config for ${cid}, using defaults:`, escErr.message);
            }
            const esc = escalationConfig ?? {
              tier_1_min_overdue_min: 5, tier_1_min_rest_min: 5,
              tier_2_min_overdue_min: 15, tier_2_min_rest_min: 3, tier_2_skip_priority_break: true,
              tier_3_min_overdue_min: 30, tier_3_min_rest_min: 0, tier_3_skip_fatigue_cap: true,
              force_release_at_overdue_min: 30,
            };

            // ── Tier 0: Normal pick (UNPLANNED auto-pick — gated) ─────────────
            // Owner policy: automatic swing requires a PLANNED pre-assignment.
            // When unplanned auto-pick is disabled, no pool dealer is picked here
            // (Tier 0 or relaxed tiers below) — the table stays on OT.
            let nextDealer = UNPLANNED_AUTO_PICK_ENABLED
              ? await pickNextDealer(admin, cid, {
                  ...basePickOptions,
                  minRestMinutes: clubCfg.break_duration_minutes ?? 10,
                })
              : null;

            // ── Tier 1: 5+ min overdue, relax min_rest to 5 ──────────────────
            if (UNPLANNED_AUTO_PICK_ENABLED && !nextDealer && minutesOverdue >= esc.tier_1_min_overdue_min) {
              console.log(
                `[Pass 3] Tier 1 fallback for ${tableName} ` +
                `(overdue ${minutesOverdue.toFixed(1)}min): min_rest=${esc.tier_1_min_rest_min}`
              );
              nextDealer = await pickNextDealer(admin, cid, {
                ...basePickOptions,
                minRestMinutes: esc.tier_1_min_rest_min,
              });
            }

            // ── Tier 2: 15+ min overdue, relax min_rest to 3, skip priority break ──
            if (UNPLANNED_AUTO_PICK_ENABLED && !nextDealer && minutesOverdue >= esc.tier_2_min_overdue_min) {
              console.log(
                `[Pass 3] Tier 2 fallback for ${tableName} ` +
                `(overdue ${minutesOverdue.toFixed(1)}min): min_rest=${esc.tier_2_min_rest_min}, skipPriorityBreak=${esc.tier_2_skip_priority_break}`
              );
              nextDealer = await pickNextDealer(admin, cid, {
                ...basePickOptions,
                minRestMinutes: esc.tier_2_min_rest_min,
                skipPriorityBreakGuard: esc.tier_2_skip_priority_break,
              });
            }

            // ── Tier 3: 30+ min overdue, min_rest=0, skip fatigue cap (last resort) ──
            if (UNPLANNED_AUTO_PICK_ENABLED && !nextDealer && minutesOverdue >= esc.tier_3_min_overdue_min) {
              console.warn(
                `[Pass 3] Tier 3 fallback for ${tableName} ` +
                `(overdue ${minutesOverdue.toFixed(1)}min): min_rest=${esc.tier_3_min_rest_min}, skipFatigue=${esc.tier_3_skip_fatigue_cap} — LAST RESORT`
              );
              nextDealer = await pickNextDealer(admin, cid, {
                ...basePickOptions,
                minRestMinutes: esc.tier_3_min_rest_min,
                minInterSwingRestMinutes: 0,
                skipPriorityBreakGuard: true,
                skipFatigueHardCap: esc.tier_3_skip_fatigue_cap,
              });
            }

            // ── No normally-eligible replacement: dealer stays on OT ──────────
            // Owner policy: no normal (Tier 0) replacement → the current dealer
            // remains on OT for manual intervention. Relaxed-rest tiers 1–3 and
            // Pass 0c/Pass 3 force-release are disabled, so nothing auto-releases
            // or bypasses rest here — only telemetry + the existing OT alerts.
            if (!nextDealer && minutesOverdue >= esc.force_release_at_overdue_min) {
              console.error(
                `[Pass 3] 🚨 NO NORMAL REPLACEMENT for ${tableName} ` +
                `(overdue ${minutesOverdue.toFixed(1)}min ≥ threshold ${esc.force_release_at_overdue_min}) — ` +
                `dealer stays on OT, cần can thiệp thủ công`
              );
              // Track for diagnostic logging
              admin.from("diagnostic_logs").insert({
                club_id: cid,
                diagnostic_type: "tiers_exhausted_force_release_pending",
                result: {
                  table_id: assignment.table_id,
                  table_name: tableName,
                  minutes_overdue: minutesOverdue,
                  threshold: esc.force_release_at_overdue_min,
                  tiers_tried: [0, 1, 2, 3],
                },
                metadata: {
                  attendance_id: assignment.attendance_id,
                },
              }).then((result: any) => {
                const { error } = result ?? {};
                if (error) console.warn("[tiers_exhausted] log failed:", error.message);
              });
            }

            // ── Log desperate pick for floor visibility ──────────────────────
            if (nextDealer && isOtDealer && otMinutes > 0) {
              console.warn(
                `[process-swing] Desperate pick for OT table ${tableName}: ` +
                `assigned ${nextDealer.full_name} ` +
                `(worked ${nextDealer.worked_minutes_since_last_break}min, ` +
                `priorityBreak=${nextDealer.priority_break_flag})`
              );
              // Send Telegram alert if this was Tier 3 (extended OT, 30+ min)
              if (minutesOverdue >= esc.tier_3_min_overdue_min) {
                const chatId = botToken ? await getClubTelegramChatId(admin, cid).catch(() => null) : null;
                if (botToken && chatId) {
                  await sendTelegramNotification(
                    botToken, chatId,
                    `⚠️ *${tableName}* — Cấp cứu OT ${otMinutes}ph: đã gán ${mention({ full_name: nextDealer.full_name, telegram_username: nextDealer.telegram_username ?? null })} theo luật nới lỏng.\nCần theo dõi sát!`,
                    {}
                  ).catch(err => console.error("[process-swing] Telegram error:", err));
                }
              }
            }

                // SAFEGUARD: verify dealer belongs to this club before assigning
            if (nextDealer?.id) {
              let dealerClub: { club_id: string } | null = null;
              try {
                const res = await admin
                  .from("dealers")
                  .select("club_id")
                  .eq("id", nextDealer.dealer_id)
                  .single();
                dealerClub = res.data;
              } catch { /* ignore */ }
              if (!dealerClub || dealerClub.club_id !== cid) {
                console.warn(`[process-swing] SAFEGUARD: dealer ${nextDealer.full_name} club ${dealerClub?.club_id} != table club ${cid}, skipping`);
                const safeguardResult = await transitionDealerState(
                  admin,
                  nextDealer.id,
                  "available",
                  `safeguard_club_mismatch_table_${assignment.table_id}`
                );
                if (!safeguardResult.success) {
                  console.error(`[Pass 3] ❌ Safeguard failed to release dealer ${nextDealer.id}:`, safeguardResult.error);
                }
                continue;
              }
            }

            // ── Emergency Pre-assign (Hướng 2) ────────────────────────────────
            // Nếu Pass 3 mới tìm được dealer (không có pre-assign trước đó),
            // delay thêm X phút để dealer chuẩn bị + gửi Telegram ngay.
            if (nextDealer) {
              const notifyMinutes = clubCfg.pre_announce_minutes ?? 3;
              const newSwingDueAt = new Date(Date.now() + notifyMinutes * 60_000);

              // Cập nhật assignment CHỈ NẾU chưa có pre_assigned (race-safe)
              const { data: emUpdated, error: emErr } = await admin
                .from("dealer_assignments")
                .update({
                  pre_assigned_attendance_id: nextDealer.id,
                  pre_assigned_at: new Date().toISOString(),
                  swing_due_at: newSwingDueAt.toISOString(),
                  pre_announce_due_at: new Date().toISOString(),
                  is_emergency_pre_assign: true,
                })
                .eq("id", assignment.id)
                .is("pre_assigned_attendance_id", null)
                .select("id")
                .single();

              if (emErr || !emUpdated) {
                console.error(`[Pass 3] ❌ Emergency pre-assign DB race for ${tableName}:`, emErr?.message);
                // Fallback: swing ngay lập tức nếu không thể pre-assign
                const { breakDuration: fbBreakDur } = await getBreakSettings(admin, cid);
                const { data: fbSwingResult } = await performSwingWithDispatchSafety(cid, {
                  p_assignment_id: assignment.id,
                  p_duration_minutes: swingDurResult.durationMinutes,
                  p_send_to_break: breakDecision.shouldBreak,
                  p_break_duration_minutes: fbBreakDur,
                  p_expected_version: (assignment as any).__lockedVersion ?? assignment.version,
                  p_next_attendance_id: nextDealer.id,
                });
                if (fbSwingResult?.outcome === "swung") {
                  metrics.success++;
                  cycleExcludedIds.add(nextDealer.id);
                  if (SWING_CONFIRM_TELEGRAM_ENABLED && botToken && pass2ChatId) {
                    const swingMsg = `🔵 ${mention({ full_name: nextDealer.full_name, telegram_username: nextDealer.telegram_username ?? null })} vào ${tableName}${outgoingDealer.full_name !== "Unknown" ? ` - Thay ${mention({ full_name: outgoingDealer.full_name, telegram_username: (outgoingDealer as any).telegram_username ?? null })}` : ""}`;
                    sendTelegramNotification(botToken, pass2ChatId, swingMsg).catch(err => console.error("[process-swing] Telegram error:", err));
                  }
                }
              } else {
                // Set dealer thành pre_assigned để bàn khác không pick
                // + ghi metadata để Pass 0c không detect là stuck
                await admin
                  .from("dealer_attendance")
                  .update({
                    current_state: "pre_assigned",
                    pre_assigned_table_id: assignment.table_id,
                    pre_assigned_at: new Date().toISOString(),
                  })
                  .eq("id", nextDealer.id);

                // Gửi Telegram Emergency NGAY
                const emChatId = botToken ? await getClubTelegramChatId(admin, cid).catch(() => null) : null;
                if (botToken && emChatId) {
                  const emMsg = formatEmergencyPreAssignMessage({
                    tableName,
                    outDealer: { full_name: outgoingDealer.full_name ?? "Unknown", telegram_username: (outgoingDealer as any).telegram_username ?? null },
                    inDealer: { full_name: nextDealer.full_name, telegram_username: nextDealer.telegram_username ?? null },
                    swingAt: newSwingDueAt,
                    minutesLeft: notifyMinutes,
                  });
                  await sendTelegramNotification(botToken, emChatId, emMsg, {});
                }

                console.log(`[Pass 3] 🚨 Emergency pre-assign: ${nextDealer.full_name} → ${tableName} in ${notifyMinutes} min`);
                metrics.success++;
                cycleExcludedIds.add(nextDealer.id);
              }
              continue; // Skip perform_swing this tick; next tick sẽ chạy path pre-assigned
            }

            // ── Không tìm được dealer → OT path ─────────────────────────────────
            // NHƯNG: Thử tìm dealer đơn giản từ pool trước (giống perform_swing wrapper).
            // Nếu có → Emergency Pre-assign để báo trước X phút, tránh gấp gáp.
            // Nếu không → OT thật sự.
            // Patch 5b: feature/final pool gate (điểm chọn thứ 3 — raw self-pick). When the gate is
            // active, restrict to the table's pool; an empty intersection → skip the emergency pick →
            // OT/no_dealer keep-seat (CLEAN shortage), never pre-assigning a non-pool dealer that the
            // seat trigger would later DT006-rollback. Inert when kill-switch off (emPoolIds = null).
            const emPoolIds = await getFeatureTablePoolIds(admin, assignment.table_id);
            const emDealerIds = emPoolIds
              ? cidDealerIds.filter((id: string) => emPoolIds.has(id))
              : cidDealerIds;
            let emergencyCandidates:
              | { id: string; current_state: string; dealer_id: string; dealers: unknown }[]
              | null = [];
            if (emDealerIds.length > 0) {
              const { data } = await admin
                .from("dealer_attendance")
                .select(`
                  id,
                  current_state,
                  dealer_id,
                  dealers!inner(id, full_name, telegram_username, club_id)
                `)
                .in("dealer_id", emDealerIds)
                .eq("status", "checked_in")
                .is("check_out_time", null)
                .neq("id", assignment.attendance_id)
                .or("current_state.eq.available,current_state.eq.on_break")
                .limit(1);
              emergencyCandidates = data as typeof emergencyCandidates;
            }

            if (emergencyCandidates && emergencyCandidates.length > 0) {
              const nextDealer = emergencyCandidates[0];
              const notifyMinutes = clubCfg.pre_announce_minutes ?? 3;
              const newSwingDueAt = new Date(Date.now() + notifyMinutes * 60_000);

              // Cập nhật assignment CHỈ NẾU chưa có pre_assigned (race-safe)
              const { data: emUpdated, error: emErr } = await admin
                .from("dealer_assignments")
                .update({
                  pre_assigned_attendance_id: nextDealer.id,
                  pre_assigned_at: new Date().toISOString(),
                  swing_due_at: newSwingDueAt.toISOString(),
                  pre_announce_due_at: new Date().toISOString(),
                  is_emergency_pre_assign: true,
                })
                .eq("id", assignment.id)
                .is("pre_assigned_attendance_id", null)
                .select("id")
                .single();

              if (emErr || !emUpdated) {
                console.error(`[Pass 3] ❌ Emergency pre-assign DB race for ${tableName}:`, emErr?.message);
                // Fallback: swing ngay lập tức nếu không thể pre-assign
                const { breakDuration: fbBreakDur } = await getBreakSettings(admin, cid);
                const { data: fbSwingResult } = await performSwingWithDispatchSafety(cid, {
                  p_assignment_id: assignment.id,
                  p_duration_minutes: swingDurResult.durationMinutes,
                  p_send_to_break: breakDecision.shouldBreak,
                  p_break_duration_minutes: fbBreakDur,
                  p_expected_version: (assignment as any).__lockedVersion ?? assignment.version,
                  p_next_attendance_id: nextDealer.id,
                });
                if (fbSwingResult?.outcome === "swung") {
                  metrics.success++;
                  cycleExcludedIds.add(nextDealer.id);
                  if (SWING_CONFIRM_TELEGRAM_ENABLED && botToken && pass2ChatId) {
                    const swingMsg = `🔵 ${mention({ full_name: (nextDealer.dealers as any)?.full_name ?? "Dealer", telegram_username: (nextDealer.dealers as any)?.telegram_username ?? null })} vào ${tableName}${outgoingDealer?.full_name && outgoingDealer.full_name !== "Unknown" ? ` - Thay ${mention({ full_name: outgoingDealer.full_name, telegram_username: (outgoingDealer as any).telegram_username ?? null })}` : ""}`;
                    sendTelegramNotification(botToken, pass2ChatId, swingMsg).catch(err => console.error("[process-swing] Telegram error:", err));
                  }
                }
              } else {
                // Set dealer thành pre_assigned để bàn khác không pick
                // + ghi metadata để Pass 0c không detect là stuck
                await admin
                  .from("dealer_attendance")
                  .update({
                    current_state: "pre_assigned",
                    pre_assigned_table_id: assignment.table_id,
                    pre_assigned_at: new Date().toISOString(),
                  })
                  .eq("id", nextDealer.id);

                // Gửi Telegram Emergency NGAY
                const emChatId = botToken ? await getClubTelegramChatId(admin, cid).catch(() => null) : null;
                if (botToken && emChatId) {
                  const emMsg = formatEmergencyPreAssignMessage({
                    tableName,
                    outDealer: { full_name: outgoingDealer?.full_name ?? "Unknown", telegram_username: (outgoingDealer as any)?.telegram_username ?? null },
                    inDealer: { full_name: (nextDealer.dealers as any)?.full_name ?? "Unknown", telegram_username: (nextDealer.dealers as any)?.telegram_username ?? null },
                    swingAt: newSwingDueAt,
                    minutesLeft: notifyMinutes,
                  });
                  await sendTelegramNotification(botToken, emChatId, emMsg, {});
                }

                console.log(`[Pass 3] 🚨 Emergency pre-assign (from OT path): ${(nextDealer.dealers as any)?.full_name} → ${tableName} in ${notifyMinutes} min`);
                metrics.success++;
                cycleExcludedIds.add(nextDealer.id);
              }
              continue; // Skip perform_swing this tick; next tick chạy path pre-assigned
            }

            // ── Thật sự không có dealer → OT path ──────────────────────────────
            const { breakDuration: pBreakDuration } = await getBreakSettings(admin, cid);
            const { data: swingResult } = await performSwingWithDispatchSafety(cid, {
              p_assignment_id: assignment.id,
              p_duration_minutes: swingDurResult.durationMinutes,
              p_send_to_break: breakDecision.shouldBreak,
              p_break_duration_minutes: pBreakDuration,
              p_expected_version: (assignment as any).__lockedVersion ?? assignment.version,
              p_next_attendance_id: null,
            });

            const outcome = swingResult?.outcome ?? "failed";

            if (outcome === "swung") {
              // perform_swing wrapper auto-picked a dealer from pool.
              metrics.success++;

              // Query the NEW assignment to notify the incoming dealer
              try {
                const { data: newAssignment } = await admin
                  .from("dealer_assignments")
                  .select("id, attendance_id, dealer:attendance_id(dealers(full_name, telegram_username, telegram_user_id))")
                  .eq("table_id", assignment.table_id)
                  .eq("status", "assigned")
                  .order("assigned_at", { ascending: false })
                  .limit(1)
                  .single();

                const incomingDealer = (newAssignment?.dealer as any)?.dealers;
                if (incomingDealer) {
                  console.log(`[Pass 3] Auto-picked dealer confirmed for ${tableName}: ${incomingDealer.full_name}`);
                  if (SWING_CONFIRM_TELEGRAM_ENABLED && botToken && pass2ChatId) {
                    const swingMsg = `🔵 ${incomingDealer.full_name} vào ${tableName}${outgoingDealer.full_name !== "Unknown" ? ` - Thay ${outgoingDealer.full_name}` : ""}`;
                    sendTelegramNotification(botToken, pass2ChatId, swingMsg).catch(err => console.error("[process-swing] Telegram error:", err));
                  }
                }
              } catch (notifyErr) {
                console.warn(`[Pass 3] Failed to confirm auto-picked dealer at ${tableName}:`, (notifyErr as Error).message);
              }

              try {
                const { data: freshCount } = await admin
                  .rpc("count_available_dealers", { p_club_id: cid });
                availableDealerCount = freshCount ?? 0;
              } catch {
                const { count: fbCount } = await admin
                  .from("dealer_attendance")
                  .select("id", { head: true, count: "exact" })
                  .in("dealer_id", cidDealerIds)
                  .eq("current_state", "available")
                  .eq("status", "checked_in");
                availableDealerCount = fbCount ?? 0;
              }
              if (breakDecision.shouldBreak) {
                const outgoingUsername = (outgoingDealer as any)?.telegram_username ?? null;
                notifier?.enqueue({
                  type: "break_start",
                  dealerName: outgoingDealer.full_name,
                  username: outgoingUsername,
                  telegramUserId: (outgoingDealer as any)?.telegram_user_id ? Number((outgoingDealer as any).telegram_user_id) : null,
                  durationMin: clubCfg.break_duration_minutes,
                } satisfies BreakStartEvent);
              }
            } else if (outcome === "no_dealer") {
              metrics.no_dealer++;
              // Patch 5b clean-shortage alert: no_dealer on a feature/final table = no eligible pool
              // relief (NOT a generic shortage). The seat is kept (OT) by this no_dealer path — the
              // CLEAN backstop, never a trigger-rollback. Emit ONE diagnostic_logs row pointing to the
              // remedy. emPoolIds non-null ⇒ gate active (kill-switch on + this table is feature/final).
              if (emPoolIds) {
                admin.from("diagnostic_logs").insert({
                  club_id: cid,
                  diagnostic_type: "feature_pool_shortage",
                  result: {
                    table_id: assignment.table_id,
                    table_name: tableName,
                    reason: "ineligible_no_pool_relief",
                    pool_size: emPoolIds.size,
                    remedy: "Add an eligible dealer to this table's pool, or floor manual override via assign_dealer_to_table (audited).",
                  },
                  metadata: { attendance_id: assignment.attendance_id },
                }).then((r: { error?: { message?: string } | null }) => {
                  if (r?.error) console.warn("[feature_pool_shortage] log failed:", r.error.message);
                });
              }
              console.warn(
                `[process-swing] no_dealer for ${tableName}: ` +
                `level=${isOtDealer ? (otMinutes >= 20 ? 3 : 2) : 1} ` +
                `retry=${swingResult?.retry_attempts ?? 0}`
              );
              if (swingResult?.is_new_overtime === true) {
                // Telegram suppressed per user request
              } else if ((assignment as any).overtime_started_at) {
                const lastAlertAt = (assignment as any).last_ot_alert_at;
                const minutesSinceLastAlert = lastAlertAt
                  ? Math.floor((Date.now() - new Date(lastAlertAt).getTime()) / 60_000)
                  : 999;

                if (minutesSinceLastAlert >= 5) {
                  const otMs = Date.now() - new Date((assignment as any).overtime_started_at).getTime();
                  const otMinutes = Math.floor(otMs / 60_000);
                  // Telegram suppressed per user request

                  try {
                    await admin
                      .from("dealer_assignments")
                      .update({ last_ot_alert_at: new Date().toISOString() })
                      .eq("id", assignment.id);
                  } catch (e: unknown) {
                    console.error("[process-swing] last_ot_alert_at update failed:", e instanceof Error ? e.message : e);
                  }
                }
              }
            } else if (outcome === "swing_skipped") {
              metrics.skipped++;
              const chatId = await getClubTelegramChatId(admin, cid);
              if (botToken && chatId) {
                await sendTelegramNotification(botToken, chatId,
                  formatSwingSkippedAlert(tableName, swingResult.retry_count), {});
                await notifyFloorManagerDM(botToken, admin, cid,
                  formatSwingSkippedAlert(tableName, swingResult.retry_count));
              }
            } else {
              metrics.failed++;
            }
          }
          } catch (swingErr: any) {
            if (isCandidateSnapshotFailure(swingErr)) throw swingErr;
            metrics.failed++;
            console.error(
              `[Pass 3] ❌ Swing failed for assignment ${assignment.id} (table ${assignment.table_id}):`,
              swingErr?.message ?? swingErr
            );
            try {
              await admin
                .from("dealer_assignments")
                .update({
                  pre_assigned_attendance_id: null,
                  pre_assigned_at: null,
                })
                .eq("id", assignment.id);
              if (assignment.pre_assigned_attendance_id) {
                await transitionDealerState(
                  admin,
                  assignment.pre_assigned_attendance_id,
                  "available",
                  "pass3_swing_failure_cleanup"
                );
                console.log(
                  `[Pass 3] Released stuck dealer ${assignment.pre_assigned_attendance_id} ` +
                  `from failed assignment ${assignment.id}`
                );
              }
            } catch (cleanupErr: any) {
              console.error(
                `[Pass 3] ⚠️ Cleanup failed for ${assignment.id}:`,
                cleanupErr?.message ?? cleanupErr
              );
            }
          } finally {
            // ── Reset swing_in_progress lock (Issue 2) ──────────────────────
            // Always reset in finally, even on success or error. If the lock
            // gets stuck, the Pass 3 query filter (swing_in_progress=false)
            // would permanently skip this assignment.
            if (!dryRun && (assignment as any).__locked) {
              try {
                await releasePass3Lock(assignment, "pass3_finally");
              } catch (resetErr: any) {
                console.error(
                  `[Pass 3] ⚠️ Failed to reset swing_in_progress for ${assignment.id}:`,
                  resetErr?.message ?? resetErr
                );
              }
            }
            continue;
          }
        }

        mark("pass4");
        // ── PASS 4 — End expired breaks ──────────────────────────────────
        if (!dryRun) {
          const { data: endedBreaks } = await admin.rpc("end_expired_breaks", {
            p_club_id: cid,
          });
          if (endedBreaks && endedBreaks.length > 0) {
            console.log(`[process-swing] Pass 4: ended ${endedBreaks.length} expired breaks for club ${cid}`,
              endedBreaks.map((b: any) => b.dealer_name).join(", "));
          }
        }

        // Canonical alert lifecycle. This is deliberately independent from
        // per-pass metrics: alert eligibility is derived from the same rotation
        // supply and solver constraints that govern real assignments.
        if (!dryRun) {
          const shortageAlert = await runDealerShortageAlert(admin, {
            clubId: cid,
            botToken: botToken ?? null,
            minInterSwingRestMinutes: clubCfg.min_inter_swing_rest_minutes,
            clubBreakDurationMinutes: clubCfg.break_duration_minutes,
            preAnnounceMinutes: clubCfg.pre_announce_minutes,
          });
          if (shortageAlert.failure) {
            recordDispatchSafetyOutcome(
              cid,
              assessShortageAlertFailure(
                shortageAlert.failure.stage,
                shortageAlert.failure.status,
                shortageAlert.failure.errorCode,
              ),
            );
          }
          console.log("[shortage-alert] evaluated", {
            club_id: cid,
            classification: shortageAlert.classification,
            notification: shortageAlert.notification,
            snapshot_status: shortageAlert.snapshot.status,
            error_code: shortageAlert.snapshot.error_code,
          });
        }

        // Flush TelegramNotifier
        notifier?.flush().catch((err) =>
          console.warn("[process-swing] notifier flush error:", err.message)
        );

        // ── Write metrics ─────────────────────────────────────────────────
        const localDate = await getClubLocalDate(admin, cid);
        if (metrics.total > 0 || metrics.skipped > 0) {
          await admin.from("swing_metrics").upsert(
            {
              club_id: cid,
              date: localDate,
              total_swings: metrics.total,
              successful_swings: metrics.success,
              failed_swings: metrics.failed,
              no_dealer_swings: metrics.no_dealer,
              skipped_swings: metrics.skipped,
              telegram_failures: metrics.tg_failed,
            },
            { onConflict: "club_id,date", ignoreDuplicates: false }
          );
        }

        if (clubHadPass3Error) clubsSkippedError++;
        clubsProcessed++; // Track successful club processing

      } catch (err) {
        if (isCandidateSnapshotFailure(err)) {
          recordDispatchSafetyOutcome(
            cid,
            assessCandidateSnapshotFailure("candidate_snapshot", err.status, err.errorCode),
          );
          clubsSkippedError++;
          console.warn(`[process-swing] club ${cid}: candidate snapshot unavailable; remaining passes aborted, releasing.`);
        } else if (err instanceof LockOwnershipLost) {
          const ownershipOutcome = assessLockOwnershipLoss(err);
          recordDispatchSafetyOutcome(cid, ownershipOutcome);
          if (err.reason === "lease_reclaimed") {
            clubsSkippedLocked++;
          } else {
            clubsSkippedError++;
          }
          console.warn(
            `[process-swing] club ${cid}: ${ownershipOutcome.dispatchErrorCode}; remaining passes aborted, releasing.`,
          );
        } else {
          markDispatchOutcome("business_failed", "club_processing_exception");
          clubsSkippedError++;
          console.error(
            `[process-swing] \u274C Unhandled error for club ${cid}:`,
            err instanceof Error ? err.stack ?? err.message : err
          );
        }
      } finally {
        // C3 — best-effort per-run metrics (trace_id + per-pass durations). NEVER throws.
        try {
          mark("run_end");
          const passDurations: Record<string, number> = {};
          for (let i = 1; i < swingMarks.length; i++) {
            passDurations[swingMarks[i - 1].pass] = swingMarks[i].at - swingMarks[i - 1].at;
          }
          const runTotalMs = swingMarks.length > 1
            ? swingMarks[swingMarks.length - 1].at - swingMarks[0].at
            : 0;
          console.log(`[process-swing] run_metrics trace=${traceId} club=${cid} total_ms=${runTotalMs} ${JSON.stringify(passDurations)}`);
          await admin.from("swing_run_metrics").insert({
            trace_id: traceId,
            club_id: cid,
            total_ms: runTotalMs,
            pass_durations: passDurations,
            lock_token: lockToken,
          });
        } catch (metricsErr) {
          console.warn(`[process-swing] run_metrics insert skipped (non-fatal) club=${cid}:`, metricsErr);
        }

        if (lockAcquired) {
          try {
            // B2.2b: token-scoped release \u2014 only deletes OUR lock (fixes FM-2: an overran
            // worker can no longer delete a successor's lock). Falls back to the legacy
            // unconditional release only if somehow no token (defensive; should not happen).
            if (lockToken) {
              await admin.rpc("release_club_lock_if_owner", { p_club_id: cid, p_lock_token: lockToken });
            } else {
              await admin.rpc("release_club_lock", { p_club_id: cid });
            }
          } catch (releaseErr) {
            console.error(`[process-swing] \u274C Lock release failed for ${cid}:`, releaseErr);
          }
        }
      }
    } // END club processing loop

    // Global monitoring view: refresh once per invocation, never once per club.
    // No successful club or dry-run means no refresh work.
    if (!dryRun && clubsProcessed > 0) {
      console.log("[process-swing] 🔄 Refreshing dealer pool summary once...");
      const poolStartTime = Date.now();
      try {
        const { error: refreshErr } = await admin.rpc("refresh_dealer_pool_summary");
        if (refreshErr) {
          console.warn("[process-swing] ⚠️ Pool summary refresh failed:", refreshErr.message);
        } else {
          console.log(`[process-swing] ✅ Pool summary refreshed (${Date.now() - poolStartTime}ms)`);
        }
      } catch (err: any) {
        console.warn("[process-swing] ⚠️ Pool summary refresh exception:", err.message);
      }
    }

    const totalExecutionMs = Date.now() - executionStartTime;

    // ═══════════════════════════════════════════════════════════════
    // Execution Summary — logged once per invocation after all clubs
    // ═══════════════════════════════════════════════════════════════
    console.log("[process-swing] Execution summary", JSON.stringify({
      total_clubs: clubIds.length,
      processed: clubsProcessed,
      skipped_locked: clubsSkippedLocked,
      skipped_error: clubsSkippedError,
      diagnostics: dispatchDiagnostics,
      execution_time_ms: totalExecutionMs,
      timestamp: new Date().toISOString(),
    }));

    if (dispatchContext) {
      const { data: finishResult, error: finishError } = await admin.rpc(
        "finish_process_swing_dispatch",
        {
          p_run_id: dispatchContext.runId,
          p_request_id: dispatchContext.requestId,
          p_club_id: dispatchContext.clubId,
          p_business_state: dispatchFinalState,
          p_error_code: dispatchErrorCode,
          p_diagnostics: {
            execution_time_ms: totalExecutionMs,
            processed: clubsProcessed,
            skipped_locked: clubsSkippedLocked,
            skipped_error: clubsSkippedError,
            dispatch_diagnostics: dispatchDiagnostics,
          },
        },
      );
      const finishOutcome = String(finishResult?.outcome ?? "invalid_finish_response");
      if (finishError || !["recorded", "idempotent_replay"].includes(finishOutcome)) {
        console.error("[process-swing] dispatch_finalize_failed", JSON.stringify({
          run_id: dispatchContext.runId,
          request_id: dispatchContext.requestId,
          outcome: finishOutcome,
        }));
        return new Response(JSON.stringify({
          ok: false,
          status: "dependency_unavailable",
          error_code: "dispatch_finalize_unavailable",
        }), {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        status: dispatchContext ? dispatchFinalState : "completed",
        error_code: dispatchContext ? dispatchErrorCode : null,
        run_id: dispatchContext?.runId ?? null,
        request_id: dispatchContext?.requestId ?? null,
        execution_time_ms: totalExecutionMs,
        metrics: metricsPerClub,
        diagnostics: dispatchDiagnostics,
        dry_run: dryRun,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (dispatchAdmin && dispatchContext) {
      try {
        await dispatchAdmin.rpc("finish_process_swing_dispatch", {
          p_run_id: dispatchContext.runId,
          p_request_id: dispatchContext.requestId,
          p_club_id: dispatchContext.clubId,
          p_business_state: "business_failed",
          p_error_code: "unhandled_process_swing_error",
          p_diagnostics: null,
        });
      } catch {
        // Best effort only: the response remains non-2xx and retry is fenced by
        // claim_process_swing_dispatch.
      }
    }
    return new Response(
      JSON.stringify({ error: "Internal error", detail: msg }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function formatSwingSkippedAlert(tableName: string, retryCount: number): string {
  return `🚨 *${tableName}* — Không có dealer thay sau ${retryCount} lần thử. Cần can thiệp thủ công!`;
}
