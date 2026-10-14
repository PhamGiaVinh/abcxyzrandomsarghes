// ═══════════════════════════════════════════════════════════
// FILE: supabase/functions/process-swing/passes/pass2-pre-assign.ts
// REWRITTEN — Previous version used non-existent columns
// (club_id, shift_id, status='active', ended_at) on dealer_assignments.
// Now uses correct schema: game_tables join, status='assigned',
// released_at, swing_processed_at, pickNextDealer + CAS RPC.
// ═══════════════════════════════════════════════════════════

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickNextDealer } from "../../_shared/dealer-utils.ts";
import { isCandidateSnapshotFailure } from "../../_shared/pickNextDealer.ts";
import { sendPreAssignTelegramWithFallback } from "../../_shared/preAssignTelegram.ts";
import { SWING_POLICY } from "../../_shared/swingPolicy.ts";

interface Pass2Result {
  pre_assigned_count: number;
  skipped_count: number;
  errors: Array<{ table_id: string; error: string }>;
}

interface PreAssignResult {
  outcome: "pre_assigned" | "race_lost" | "dealer_unavailable" | "error";
  dealer_id?: string;
  effective_swing_due_at?: string;
  original_swing_due_at?: string;
  rest_deficit_min?: number;
  current_rest_min?: number;
  detail?: string;
}

interface Pass2Options {
  clubZone: string | null;
  chatId: string | null;
  botToken?: string | null;
  cycleExcludedIds: Set<string>;
  /** When set, overrides the window calculation.
   *  Default window: [now + (preAnnounceMinutes-2), now + (preAnnounceMinutes+2)]
   *  Manual window:  [now, now + manualWindowMinutes]
   *  Used by manual pre-assign trigger so cashier sees immediate results. */
  manualWindowMinutes?: number;
  /** Minimum inter-swing rest minutes for pickNextDealer cooldown. */
  minInterSwingRestMinutes?: number;
}

function normalizeTelegramUserId(value: unknown): string | number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const text = String(value).trim();
  return text ? text : null;
}

export async function pass2PreAssignNext(
  admin: any,
  clubId: string,
  preAnnounceMinutes: number,
  options: Pass2Options,
): Promise<Pass2Result> {
  console.log("[Pass 2] 🔄 Pre-assigning next dealers...");

  const result: Pass2Result = {
    pre_assigned_count: 0,
    skipped_count: 0,
    errors: [],
  };

  const { clubZone, chatId, botToken, cycleExcludedIds, manualWindowMinutes } = options;

  // Emergency OT pre-announce window: 3 minutes instead of normal 6 min.
  // Tables in overtime get notified sooner so dealers can prepare.
  const EMERGENCY_OT_PRE_ANNOUNCE_MINUTES = SWING_POLICY.preAssignWindow.emergencyOtPreAnnounceMinutes;

  try {
    // ════════════════════════════════════════════════════════
    // STEP 1: Find assignments needing pre-assignment
    //
    // Normal tables: window [now + (preAnnounceMins - 2), now + (preAnnounceMins + 2)]
    //   e.g. preAnnounceMins=5 → window [T+3min, T+7min]
    //
    // OT emergency: window [now + (EMERGENCY_OT - 2), now + (EMERGENCY_OT + 2)]
    //   i.e. EMERGENCY_OT=3 → window [T+1min, T+5min]
    //
    // We query BOTH windows and merge (UNION behavior via OR).
    // Manual window:  [now, now + manualWindowMinutes]
    //   e.g. manualWindowMinutes=15 → window [T+0min, T+15min]
    // ════════════════════════════════════════════════════════

    const normalWindowStart = new Date(
      Date.now() + (manualWindowMinutes ? 0 : Math.max(0, preAnnounceMinutes - SWING_POLICY.preAssignWindow.halfWidthMinutes) * 60_000)
    ).toISOString();
    const normalWindowEnd = new Date(
      Date.now() + (manualWindowMinutes ?? (preAnnounceMinutes + SWING_POLICY.preAssignWindow.halfWidthMinutes)) * 60_000
    ).toISOString();

    // Emergency OT window: shorter notification window
    const otWindowStart = new Date(
      Date.now() + (EMERGENCY_OT_PRE_ANNOUNCE_MINUTES - SWING_POLICY.preAssignWindow.halfWidthMinutes) * 60_000
    ).toISOString();
    const otWindowEnd = new Date(
      Date.now() + (EMERGENCY_OT_PRE_ANNOUNCE_MINUTES + SWING_POLICY.preAssignWindow.halfWidthMinutes) * 60_000
    ).toISOString();

    // For manual trigger, use single wide window
    // For automatic: query normal window OR (OT window if overtime_started_at IS NOT NULL)
    const windowStart = manualWindowMinutes
      ? new Date(Date.now()).toISOString()
      : normalWindowStart;
    const windowEnd = manualWindowMinutes
      ? new Date(Date.now() + manualWindowMinutes * 60_000).toISOString()
      : normalWindowEnd;

    let upcomingAssignments: any[] = [];

    if (manualWindowMinutes) {
      // Manual trigger: single wide window
      const { data, error: queryErr } = await admin
        .from("dealer_assignments")
        .select(`
          id, table_id, attendance_id, swing_due_at, version, overtime_started_at,
          pre_assigned_attendance_id,
          game_tables!inner(id, table_name, table_type, shift_id),
          dealer_attendance!attendance_id(
            dealers!inner(full_name, telegram_username, telegram_user_id)
          )
        `)
        .eq("club_id", clubId)
        .eq("status", "assigned")
        .is("released_at", null)
        .is("swing_processed_at", null)
        .is("pre_assigned_attendance_id", null)
        .gte("swing_due_at", windowStart)
        .lt("swing_due_at", windowEnd);

      if (queryErr) {
        console.error("[Pass 2] ❌ Query error:", queryErr.message);
        result.errors.push({ table_id: "", error: `manual assignment read: ${queryErr.message}` });
        return result;
      }
      upcomingAssignments = data ?? [];
    } else {
      // Automatic: separate queries for normal and OT emergency windows
      // Normal tables: pre-announce at default window
      const { data: normalData, error: normalErr } = await admin
        .from("dealer_assignments")
        .select(`
          id, table_id, attendance_id, swing_due_at, version, overtime_started_at,
          pre_assigned_attendance_id,
          game_tables!inner(id, table_name, table_type, shift_id),
          dealer_attendance!attendance_id(
            dealers!inner(full_name, telegram_username, telegram_user_id)
          )
        `)
        .eq("club_id", clubId)
        .eq("status", "assigned")
        .is("released_at", null)
        .is("swing_processed_at", null)
        .is("pre_assigned_attendance_id", null)
        .is("overtime_started_at", null)
        .lte("swing_due_at", normalWindowEnd);

      if (normalErr) {
        console.error("[Pass 2] ❌ Normal window query error:", normalErr.message);
        result.errors.push({ table_id: "", error: `normal assignment read: ${normalErr.message}` });
        return result;
      }

      // OT emergency: shortened pre-announce window (3 min instead of 6)
      const { data: otData, error: otErr } = await admin
        .from("dealer_assignments")
        .select(`
          id, table_id, attendance_id, swing_due_at, version, overtime_started_at,
          pre_assigned_attendance_id,
          game_tables!inner(id, table_name, table_type, shift_id),
          dealer_attendance!attendance_id(
            dealers!inner(full_name, telegram_username, telegram_user_id)
          )
        `)
        .eq("club_id", clubId)
        .eq("status", "assigned")
        .is("released_at", null)
        .is("swing_processed_at", null)
        .is("pre_assigned_attendance_id", null)
        .not("overtime_started_at", "is", null)
        .lte("swing_due_at", otWindowEnd);

      if (otErr) {
        console.error("[Pass 2] ❌ OT window query error:", otErr.message);
        result.errors.push({ table_id: "", error: `OT assignment read: ${otErr.message}` });
        return result;
      }

      // Merge and deduplicate by assignment id
      const seen = new Set<string>();
      for (const row of [...(normalData ?? []), ...(otData ?? [])]) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          upcomingAssignments.push(row);
        }
      }
    }

    if (upcomingAssignments.length === 0) {
      console.log(
        `[Pass 2] No tables needing pre-assignment in window ` +
        `(overdue-inclusive, ≤${normalWindowEnd}) ` +
        `(N=${preAnnounceMinutes})`
      );
      return result;
    }

    // ── PATCH D: sort by urgency (most overdue / nearest deadline first) ──
    upcomingAssignments.sort((a: any, b: any) => {
      const tA = new Date(a.swing_due_at).getTime();
      const tB = new Date(b.swing_due_at).getTime();
      return tA !== tB ? tA - tB : a.id.localeCompare(b.id);
    });

    const otCount = upcomingAssignments.filter((a: any) => a.overtime_started_at).length;
    console.log(
      `[Pass 2] Found ${upcomingAssignments.length} tables needing pre-assignment ` +
      `(${otCount} OT emergency at ${EMERGENCY_OT_PRE_ANNOUNCE_MINUTES}min, ` +
      `${upcomingAssignments.length - otCount} normal at ${preAnnounceMinutes}min)`
    );
    // ── PATCH D: starvation diagnostic ──────────────────────────────────
    console.log(
      `[Pass 2] 📊 Pool pressure: ${upcomingAssignments.length} tables_due, ` +
      `${cycleExcludedIds.size} dealers_excluded_from_pool_this_tick`,
    );

    // Tour name per shift (so the Telegram pre-announce shows which tour) —
    // one dealer_shifts lookup for all tables due this tick.
    const shiftIds = [...new Set(
      upcomingAssignments
        .map((a) => (a.game_tables as any)?.shift_id)
        .filter((id): id is string => !!id),
    )];
    const shiftTourMap = new Map<string, string>();
    if (shiftIds.length > 0) {
      const { data: shiftRows } = await admin
        .from("dealer_shifts")
        .select("id, tour_name")
        .in("id", shiftIds);
      for (const s of (shiftRows ?? [])) {
        if (s?.id && s?.tour_name) shiftTourMap.set(s.id as string, s.tour_name as string);
      }
    }

    // ════════════════════════════════════════════════════════
    // STEP 2: Pre-assign one dealer per table
    // ════════════════════════════════════════════════════════

    for (const assignment of upcomingAssignments) {
      try {
        const tableName = (assignment.game_tables as any)?.table_name ?? "??";
        const tourName = shiftTourMap.get((assignment.game_tables as any)?.shift_id) ?? null;

        // PATCH D: per-table exclude set starts from shared pool snapshot.
        // Failed candidates are added here so the next attempt tries a different
        // dealer without polluting cycleExcludedIds (which spans all tables this tick).
        const localExcludes = new Set(cycleExcludedIds);
        let succeeded = false;

        retry: for (let attempt = 1; attempt <= 3; attempt++) {
          const minInterSwingRestMinutes = options.minInterSwingRestMinutes ?? 10;
          const nominalSwingAtMs = new Date(assignment.swing_due_at).getTime();
          const reservationSwingAt = new Date(
            nominalSwingAtMs + minInterSwingRestMinutes * 60_000
          ).toISOString();
          const nextDealer = await pickNextDealer(admin, clubId, {
            currentTableId: assignment.table_id,
            excludeAttendanceIds: localExcludes,
            minInterSwingRestMinutes,
            swingDueAt: reservationSwingAt,
            reservationMode: true,
          });

          if (!nextDealer) {
            console.log(`[Pass 2] ⏭️ ${tableName}: no available dealer (attempt ${attempt})`);
            break retry;
          }

          // (Bug 1 legacy, 2026-07-06) The scheduler path (#717) defers relief via
          // buildRotationSupply's eligible_at so a locked dealer is always >= the
          // execute rest floor. The legacy Pass 2 path has no such deferral (its RPC
          // only enforces a 10-min soft floor), so a dealer eligible here can still be
          // blocked at execute (EXECUTE_MIN_REST_MINUTES=15) → table stuck on OT. Guard:
          // only pre-assign a dealer who WILL have >= the execute rest floor by the time
          // the swing actually runs (max(swing_due_at, now)). Otherwise exclude + retry;
          // if none qualifies, no pre-assign this tick (honest OT, never a bad swap).
          const restFloorMs = SWING_POLICY.rest.executeMinRestFloorMinutes * 60_000;
          const executeAtMs = Math.max(nominalSwingAtMs, Date.now());
          const releasedMs = nextDealer.last_released_at
            ? new Date(nextDealer.last_released_at).getTime()
            : 0;
          const restAtExecuteMs = releasedMs > 0 ? executeAtMs - releasedMs : Infinity;
          if (restAtExecuteMs < restFloorMs) {
            console.log(
              `[Pass 2] ${tableName}: ${nextDealer.full_name} sẽ chưa đủ ${SWING_POLICY.rest.executeMinRestFloorMinutes}' nghỉ lúc đổi ` +
              `(còn ${Math.floor(restAtExecuteMs / 60_000)}') — thử dealer khác (attempt ${attempt})`
            );
            localExcludes.add(nextDealer.id);
            continue retry;
          }

          // Call CAS-based RPC for atomic pre-assignment
          const { data: rpcResult, error: rpcErr } = await admin.rpc(
            "pre_assign_next_dealer_for_table",
            {
              p_assignment_id: assignment.id,
              p_club_id: clubId,
              p_next_attendance_id: nextDealer.id,
              p_version: assignment.version,
            },
          );

          if (rpcErr) {
            result.errors.push({ table_id: assignment.table_id, error: rpcErr.message });
            console.error(`[Pass 2] ❌ RPC error for ${tableName}:`, rpcErr.message, {
              code: rpcErr.code, detail: rpcErr.details,
            });
            break retry;
          }

          const result_outcome = rpcResult as PreAssignResult | null;
          const outcome = result_outcome?.outcome;

          switch (outcome) {
            case "pre_assigned": {
              result.pre_assigned_count++;
              // Only mutate shared exclude set on confirmed success
              cycleExcludedIds.add(nextDealer.id);
              succeeded = true;

              // NOTE: overtime_started_at is NOT cleared here. It was
              // previously cleared prematurely (before the RPC committed),
              // which broke the rollback path in execute_pre_assigned_swing
              // (step [8] would restore NULL instead of the original OT timestamp).
              // The RPC now handles OT clearing correctly in step [6] on success
              // and preserves the original value on rollback in step [8].

              // Bàn 10 fix: read effective_swing_due_at from RPC (may be delayed
              // by rest_deficit_min to enforce 10-min soft min rest). Fall back
              // to assignment.swing_due_at for backward compat if RPC didn't
              // return the field.
              const nominalSwingAt = result_outcome?.original_swing_due_at
                ?? assignment.swing_due_at;
              const effectiveSwingAt = result_outcome?.effective_swing_due_at
                ?? nominalSwingAt;
              const restDeficit = result_outcome?.rest_deficit_min ?? 0;
              const currentRest = result_outcome?.current_rest_min ?? null;

              if (restDeficit > 0) {
                console.log(
                  `[Pass 2] ⏸ ${tableName}: ${nextDealer.full_name} pre-assigned with ` +
                  `rest deficit ${restDeficit}min (had ${currentRest}min rest, ` +
                  `min 10min) — swing delayed from ${assignment.swing_due_at} ` +
                  `to ${effectiveSwingAt}`,
                );
                // Diagnostic log only — no Telegram re-announce in v1.
                // BUG FIX 2026-06-06: diagnostic_logs schema is
                //   (id, timestamp, club_id, diagnostic_type, result, metadata, created_at).
                // Old code used non-existent columns (level, source, event, payload)
                // so the insert silently dropped fields. Use fire-and-forget to
                // avoid blocking the pre-assign loop.
                admin.from("diagnostic_logs").insert({
                  club_id: clubId,
                  diagnostic_type: "soft_min_rest_delay",
                  result: {
                    table_id: assignment.table_id,
                    assignment_id: assignment.id,
                    dealer_id: result_outcome?.dealer_id ?? nextDealer.dealer_id ?? null,
                    dealer_name: nextDealer.full_name,
                    rest_deficit_min: restDeficit,
                    current_rest_min: currentRest,
                    original_due_at: nominalSwingAt,
                    effective_due_at: effectiveSwingAt,
                  },
                  metadata: {
                    source: "pass2_pre_assign",
                  },
                }).then((result: any) => {
                  const { error } = result ?? {};
                  if (error) {
                    console.warn("[Pass 2] diagnostic log insert failed:", error.message);
                  }
                });
              }

              // Compute minutes until the nominal swing time for the notification.
              const swingAt = new Date(nominalSwingAt).getTime();
              const minutesLeft = Math.max(0, Math.floor((swingAt - Date.now()) / 60_000));

              console.log(
                `[Pass 2] ✅ ${tableName}: ${nextDealer.full_name} pre-assigned ` +
                `(notify in ~${minutesLeft} min, handoff at ${new Date(effectiveSwingAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })})` +
                (restDeficit > 0 ? ` [delayed ${restDeficit}min for rest]` : ""),
              );
              console.log("[process-swing][pass2][preassign-created]", {
                club_id: clubId,
                table_id: assignment.table_id,
                table_name: tableName,
                assignment_id: assignment.id,
                incoming_dealer_id: nextDealer.id,
                incoming_dealer_name: nextDealer.full_name,
                outgoing_dealer_name: (assignment as any).dealer_attendance?.dealers?.full_name ?? null,
                minutes_left: minutesLeft,
                rest_deficit_min: restDeficit,
              });

              // Telegram pre-announce notification: send immediately, then
              // queue to pre_announce_jobs only if the direct send fails.
              if (chatId) {
                const outgoing = (assignment as any).dealer_attendance?.dealers ?? {};
                const outgoingAtt = (assignment as any).dealer_attendance ?? {};
                const notification = await sendPreAssignTelegramWithFallback(
                  admin,
                  {
                    clubId,
                    tableId: assignment.table_id,
                    assignmentId: assignment.id,
                    attendanceId: nextDealer.id,
                    outAttendanceId: outgoingAtt.id ?? null,
                    tableName,
                    tournamentName: tourName,
                    zone: clubZone,
                    outName: outgoing.full_name ?? "Unknown",
                    outUsername: outgoing.telegram_username ?? null,
                    outTelegramUserId: normalizeTelegramUserId(outgoing.telegram_user_id),
                    inName: nextDealer.full_name,
                    inUsername: nextDealer.telegram_username ?? null,
                    inTelegramUserId: normalizeTelegramUserId(nextDealer.telegram_user_id),
                    swingAt: new Date(nominalSwingAt),
                    minutesLeft,
                    restDeficitMin: restDeficit,
                    chatId,
                  },
                  botToken,
                  "[Pass 2]",
                );

                if (!notification.delivered && !notification.queued) {
                  console.warn(
                    `[Pass 2] ⚠️ ${tableName}: pre-assign notification lost ` +
                    `(direct=${notification.directError ?? "unknown"}, ` +
                    `fallback=${notification.fallbackError ?? "none"})`,
                  );
                }
                if (notification.delivered) {
                  console.log("[process-swing][pass2][telegram-preannounce-sent]", {
                    club_id: clubId,
                    table_id: assignment.table_id,
                    table_name: tableName,
                    assignment_id: assignment.id,
                    incoming_dealer_name: nextDealer.full_name,
                  });
                } else if (notification.queued) {
                  console.log("[process-swing][pass2][telegram-preannounce-queued]", {
                    club_id: clubId,
                    table_id: assignment.table_id,
                    table_name: tableName,
                    assignment_id: assignment.id,
                    incoming_dealer_name: nextDealer.full_name,
                    direct_error: notification.directError,
                  });
                } else {
                  console.warn("[process-swing][pass2][telegram-preannounce-failed]", {
                    club_id: clubId,
                    table_id: assignment.table_id,
                    table_name: tableName,
                    assignment_id: assignment.id,
                    incoming_dealer_name: nextDealer.full_name,
                    direct_error: notification.directError,
                    fallback_error: notification.fallbackError,
                  });
                }
              } else {
                // No chatId — skip notification but still log so cashier can see
                console.log(
                  `[Pass 2] ⏭️ ${tableName}: no Telegram chat configured, ` +
                  `pre-assigned ${nextDealer.full_name} (swing in ~${minutesLeft} min)`,
                );
              }
              break retry;
            }

            case "race_lost": {
              console.log(`[Pass 2] ⏭️ ${tableName}: race_lost (concurrent swing)`);
              console.warn("[process-swing][pass2][preassign-skipped]", {
                club_id: clubId,
                table_id: assignment.table_id,
                table_name: tableName,
                assignment_id: assignment.id,
                reason: "race_lost",
                detail: result_outcome?.detail,
              });
              break retry;
            }

            case "dealer_unavailable": {
              // PATCH D: add to local excludes for in-tick re-pick;
              // cycleExcludedIds (shared across tables) is deliberately NOT mutated
              // so other tables this tick can still try this dealer.
              localExcludes.add(nextDealer.id);
              console.log(
                `[Pass 2] ↩️ ${tableName}: ${nextDealer.full_name} unavailable — ` +
                `retry ${attempt}/3 (detail=${result_outcome?.detail ?? "none"})`,
              );
              console.warn("[process-swing][pass2][preassign-retry]", {
                club_id: clubId,
                table_id: assignment.table_id,
                table_name: tableName,
                assignment_id: assignment.id,
                reason: "dealer_unavailable",
                dealer_name: nextDealer.full_name,
                attempt,
                detail: result_outcome?.detail,
              });
              break; // break switch only; retry loop continues to next attempt
            }

            default: {
              result.errors.push({
                table_id: assignment.table_id,
                error: `Unknown outcome: ${outcome}`,
              });
              console.error(`[Pass 2] ❌ ${tableName}: unknown outcome "${outcome}"`);
              break retry;
            }
          }
        } // end retry loop

        if (!succeeded) {
          result.skipped_count++;
        }
      } catch (error: any) {
        if (isCandidateSnapshotFailure(error)) throw error;
        result.errors.push({
          table_id: assignment.table_id,
          error: error.message,
        });
        console.error(`[Pass 2] ❌ Error for table ${assignment.table_id}:`, error.message);
      }
    }

    // ════════════════════════════════════════════════════════
    // STEP 3: Summary
    // ════════════════════════════════════════════════════════

    console.log(
      `[Pass 2] ✅ Complete: ${result.pre_assigned_count} pre-assigned, ` +
      `${result.skipped_count} skipped, ${result.errors.length} errors`
    );

    return result;
  } catch (error: any) {
    if (isCandidateSnapshotFailure(error)) throw error;
    console.error("[Pass 2] ❌ Fatal error:", error.message);
    result.errors.push({ table_id: "", error: error instanceof Error ? error.message : String(error) });
    return result;
  }
}
