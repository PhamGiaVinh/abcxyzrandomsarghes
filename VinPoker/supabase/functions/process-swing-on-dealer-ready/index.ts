import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  authorizeInternalTrigger,
  authorizeSwingWorkerRequest,
  getIdempotencyKey,
  parseDealerReadyPayload,
} from "../_shared/internal-trigger-auth.ts";
import { getDealerOperationalTables } from "../_shared/dealerOperationalTables.ts";

interface PickResult {
  outcome: "swung" | "no_table" | "skipped" | "race_lost" | "error";
  table_id?: string;
  assignment_id?: string;
  new_assignment_id?: string;
  rest_deficit_minutes?: number;
  reason?: string;
  error?: string;
  duration_ms?: number;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Existing header callers remain supported; the DB trigger uses the matched Vault worker bearer.
  const auth = req.headers.has("authorization")
    ? authorizeSwingWorkerRequest(req) : authorizeInternalTrigger(req);
  if (!auth.ok) return json({ error: auth.code }, auth.status);

  const idempotencyKey = getIdempotencyKey(req);
  if (!idempotencyKey) return json({ error: "invalid_idempotency_key" }, 400);

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 4096) {
    return json({ error: "payload_too_large" }, 413);
  }

  const payload = parseDealerReadyPayload(await req.json().catch(() => null));
  if (!payload) return json({ error: "invalid_payload" }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "service_not_configured" }, 503);

  // Create the privileged client only after the request passed custom authentication.
  const admin = createClient(url, serviceKey);
  const startTime = Date.now();

  try {
    const { data: clubSettings, error: settingsError } = await admin.from("club_settings")
      .select("auto_swing_enabled").eq("club_id", payload.clubId).maybeSingle();
    if (settingsError) return json({ error: "auto_swing_state_unverified" }, 503);
    if (clubSettings?.auto_swing_enabled !== true) return json({ skipped: "auto_swing_off" });
    const operationalTables = await getDealerOperationalTables(admin, payload.clubId);
    if (operationalTables.length === 0) return json({ skipped: "no_operational_table" });
    const { data: verifyResult, error: verifyError } = await admin.rpc(
      "atomic_dealer_ready_check",
      {
        p_club_id: payload.clubId,
        p_attendance_id: payload.attendanceId,
      },
    );

    if (verifyError) {
      await logMetric(admin, payload.clubId, startTime, "failure", 1, 0, "verify_failed");
      return json({ error: "verify_failed" }, 500);
    }

    if (verifyResult?.skipped) {
      await logMetric(admin, payload.clubId, startTime, "success", 0, 0, "verified_skip");
      return json({ skipped: verifyResult.skipped, verified: false });
    }

    const verifiedAttendanceId = verifyResult?.attendance_id;
    const restThreshold = Number(verifyResult?.rest_threshold_min);
    const restMin = Number(verifyResult?.rest_min);
    if (!verifiedAttendanceId || !Number.isFinite(restThreshold) || !Number.isFinite(restMin)) {
      await logMetric(admin, payload.clubId, startTime, "failure", 1, 0, "invalid_verification_result");
      return json({ error: "verify_failed" }, 500);
    }

    const restDeficit = Math.max(0, restThreshold - restMin);
    const { data: swingConfig, error: plannerError } = await admin
      .from("swing_config")
      .select("rotation_planner_enabled")
      .eq("club_id", payload.clubId)
      .eq("table_type", "tournament")
      .maybeSingle();
    if (plannerError) return json({ error: "rotation_planner_state_unverified" }, 503);

    if (swingConfig?.rotation_planner_enabled === true) {
      await logMetric(admin, payload.clubId, startTime, "success", 0, 0, "deferred_to_planner");
      return json({ skipped: "deferred_to_planner", verified: true });
    }

    const { data: overdueTable, error: overdueError } = await admin
      .from("dealer_assignments")
      .select("id, version, table_id, table_session_id")
      .eq("club_id", payload.clubId)
      .in("table_id", operationalTables.map((table) => table.id))
      .eq("status", "assigned")
      .is("released_at", null)
      .lt("swing_due_at", new Date().toISOString())
      .order("swing_due_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (overdueError) {
      await logMetric(admin, payload.clubId, startTime, "failure", 1, 0, "overdue_table_query_failed");
      return json({ error: "query_failed" }, 500);
    }

    if (!overdueTable) {
      await logMetric(admin, payload.clubId, startTime, "success", 0, 0, "no_overdue_table");
      return json({ skipped: "no_overdue_table", verified: true });
    }

    if (!overdueTable.table_session_id) {
      await logMetric(admin, payload.clubId, startTime, "failure", 1, 0, "table_session_binding_required");
      return json({ error: "table_session_binding_required" }, 409);
    }

    const { data: swingResult, error: swingError } = await admin.rpc("worker_perform_swing", {
      p_assignment_id: overdueTable.id,
      p_table_id: overdueTable.table_id,
      p_table_session_id: overdueTable.table_session_id,
      p_expected_version: overdueTable.version,
      p_next_attendance_id: verifiedAttendanceId,
      p_send_to_break: false,
      p_break_duration_minutes: 15,
      p_duration_minutes: 30,
      p_rest_deficit_minutes: restDeficit,
    });

    if (swingError) {
      await logMetric(admin, payload.clubId, startTime, "failure", 1, 0, "perform_swing_failed");
      return json({ error: "swing_failed" }, 500);
    }

    const result: PickResult = {
      outcome: swingResult?.outcome ?? "error",
      table_id: overdueTable.table_id,
      assignment_id: overdueTable.id,
      new_assignment_id: swingResult?.new_assignment_id,
      rest_deficit_minutes: restDeficit,
      duration_ms: Date.now() - startTime,
    };
    const processedCount = result.outcome === "swung" ? 1 : 0;
    if (!["swung", "no_table", "skipped", "race_lost"].includes(result.outcome)) {
      await logMetric(admin, payload.clubId, startTime, "failure", 1, 0, "non_success_outcome");
      return json({ error: "non_success_outcome" }, 500);
    }
    await logMetric(admin, payload.clubId, startTime, "success", 0, processedCount, `event:${idempotencyKey}`);
    return json(result);
  } catch {
    await logMetric(admin, payload.clubId, startTime, "failure", 1, 0, "handler_failed");
    return json({ error: "handler_failed" }, 500);
  }
});

async function logMetric(
  admin: any,
  clubId: string,
  startTime: number,
  status: "success" | "failure" | "partial",
  errorCount: number,
  processedCount: number,
  errorMessage?: string,
): Promise<void> {
  try {
    await admin.from("cron_metrics").insert({
      cron_name: "process-swing-on-dealer-ready",
      club_id: clubId,
      duration_ms: Date.now() - startTime,
      status,
      error_count: errorCount,
      processed_count: processedCount,
      error_message: errorMessage ? errorMessage.substring(0, 200) : null,
    });
  } catch {
    // Metrics are best-effort and must never reveal request headers or secrets.
  }
}
