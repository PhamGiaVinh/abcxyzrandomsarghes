import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PublishedScheduleState =
  | "published"
  | "confirmed"
  | "waiting"
  | "in_pool"
  | "closed";

export interface PublishedScheduleAssignment {
  id: string;
  dealerId: string;
  dealerName: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  arrivalAt: string | null;
  payrollStartAt: string | null;
  state: PublishedScheduleState;
  late: boolean;
}

export interface PublishedScheduleDay {
  runId: string;
  publishedAt: string | null;
  assignments: PublishedScheduleAssignment[];
}

interface PublishedScheduleResult {
  daysByDate: Record<string, PublishedScheduleDay>;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function usePublishedDealerSchedule(
  clubId: string | null,
  dates: string[],
): PublishedScheduleResult {
  const [daysByDate, setDaysByDate] = useState<Record<string, PublishedScheduleDay>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const generationRef = useRef(0);
  const dateKey = useMemo(() => [...dates].sort().join(","), [dates]);

  useEffect(() => {
    const generation = ++generationRef.current;
    const controller = new AbortController();

    if (!clubId || dates.length === 0) {
      setDaysByDate({});
      setLoading(false);
      setError(null);
      return () => controller.abort();
    }

    setDaysByDate({});
    setLoading(true);
    setError(null);
    const deadline = setTimeout(() => {
      if (generation !== generationRef.current || controller.signal.aborted) return;
      setDaysByDate({});
      setLoading(false);
      setError("Hết thời gian tải lịch đã phát hành. Vui lòng tải lại.");
      controller.abort();
    }, 10_000);

    void (async () => {
      try {
        const runsRes = await supabase
          .from("dealer_schedule_runs")
          .select("id, work_date, published_at")
          .eq("club_id", clubId)
          .eq("status", "published")
          .in("work_date", dates)
          .order("published_at", { ascending: false })
          .abortSignal(controller.signal);
        if (runsRes.error) throw runsRes.error;

        const runByDate = new Map<string, { id: string; publishedAt: string | null }>();
        for (const row of runsRes.data ?? []) {
          if (!runByDate.has(row.work_date)) {
            runByDate.set(row.work_date, { id: row.id, publishedAt: row.published_at ?? null });
          }
        }

        const next: Record<string, PublishedScheduleDay> = {};
        for (const [workDate, run] of runByDate) {
          next[workDate] = { runId: run.id, publishedAt: run.publishedAt, assignments: [] };
        }

        const runIds = [...runByDate.values()].map((run) => run.id);
        if (runIds.length === 0) {
          if (generation === generationRef.current && !controller.signal.aborted) setDaysByDate(next);
          return;
        }

        const assignmentsRes = await supabase
          .from("dealer_shift_assignments")
          .select("id, run_id, dealer_id, work_date, scheduled_start_at, scheduled_end_at, status, checked_in_at")
          .eq("club_id", clubId)
          .in("run_id", runIds)
          .in("status", ["published", "confirmed", "checked_in", "closed"])
          .order("scheduled_start_at", { ascending: true })
          .abortSignal(controller.signal);
        if (assignmentsRes.error) throw assignmentsRes.error;

        const assignments = assignmentsRes.data ?? [];
        if (assignments.length === 0) {
          if (generation === generationRef.current && !controller.signal.aborted) setDaysByDate(next);
          return;
        }

        const dealerIds = [...new Set(assignments.map((row) => row.dealer_id))];
        const assignmentIds = assignments.map((row) => row.id);

        const [dealersRes, attendanceRes, lateEventsRes] = await Promise.all([
          supabase
            .from("dealers")
            .select("id, full_name")
            .eq("club_id", clubId)
            .in("id", dealerIds)
            .abortSignal(controller.signal),
          supabase
            .from("dealer_attendance")
            .select("dealer_id, shift_date, check_in_time")
            .eq("status", "checked_in")
            .in("dealer_id", dealerIds)
            .abortSignal(controller.signal),
          supabase
            .from("dealer_shift_events")
            .select("assignment_id")
            .eq("club_id", clubId)
            .eq("event_type", "late")
            .in("assignment_id", assignmentIds)
            .abortSignal(controller.signal),
        ]);
        if (dealersRes.error) throw dealersRes.error;
        if (attendanceRes.error) throw attendanceRes.error;

        const dealerNames = new Map<string, string>(
          (dealersRes.data ?? []).map((row) => [row.id, row.full_name ?? "Dealer"]),
        );
        const payrollStarts = new Map<string, string>();
        for (const row of attendanceRes.data ?? []) {
          if (typeof row.check_in_time !== "string") continue;
          const key = JSON.stringify([row.dealer_id, row.shift_date]);
          if (payrollStarts.has(key)) throw new Error("Không xác minh được ca: dealer có nhiều lượt check-in đang mở trong cùng ngày vận hành.");
          payrollStarts.set(key, row.check_in_time);
        }
        // Late is shown only when the persisted event is readable. Never infer a
        // status badge solely from the clock.
        const lateAssignmentIds = new Set<string>(
          lateEventsRes.error
            ? []
            : (lateEventsRes.data ?? []).flatMap((row) => row.assignment_id ? [row.assignment_id] : []),
        );

        for (const row of assignments) {
          const day = next[row.work_date];
          if (!day || day.runId !== row.run_id) continue;

          // A dealer's current attendance is not evidence for tomorrow's plan or
          // another operating day. Keep the persisted arrival marker authoritative.
          const payrollStartAt = row.status === "checked_in"
            ? payrollStarts.get(JSON.stringify([row.dealer_id, row.work_date])) ?? null : null;
          let state: PublishedScheduleState;
          if (row.status === "checked_in") state = payrollStartAt ? "in_pool" : "waiting";
          else if (row.status === "confirmed") state = "confirmed";
          else if (row.status === "closed") state = "closed";
          else state = "published";

          day.assignments.push({
            id: row.id,
            dealerId: row.dealer_id,
            dealerName: dealerNames.get(row.dealer_id) ?? "Dealer",
            scheduledStartAt: row.scheduled_start_at,
            scheduledEndAt: row.scheduled_end_at,
            arrivalAt: row.checked_in_at ?? null,
            payrollStartAt,
            state,
            late: lateAssignmentIds.has(row.id),
          });
        }

        if (generation === generationRef.current && !controller.signal.aborted) setDaysByDate(next);
      } catch (caught) {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        setDaysByDate({});
        setError((caught as Error)?.message || "Không tải được lịch đã phát hành.");
      } finally {
        clearTimeout(deadline);
        if (generation === generationRef.current && !controller.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      clearTimeout(deadline);
      controller.abort();
      generationRef.current += 1;
    };
    // dates is represented by the stable sorted key to avoid refetch loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, dateKey, nonce]);

  return { daysByDate, loading, error, refetch: () => setNonce((value) => value + 1) };
}
