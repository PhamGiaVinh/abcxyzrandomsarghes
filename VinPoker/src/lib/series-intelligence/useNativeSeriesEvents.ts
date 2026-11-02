import { startLiveReportRefresh } from "@/lib/liveReportRefresh";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { sessionReadEpoch } from '@/lib/sessionReadEpoch';
// Series Intelligence — native data probe (Phase 2).
// Reads the club owner's own series events via the owner-scoped, STABLE
// `get_club_series_events` RPC (the server enforces ownership — no client-side
// club aggregation), maps each row through the pure adapter, and returns an
// inventory summary. READ-ONLY: only `.rpc` is used for a STABLE read — no
// insert/update/delete/upsert, no writes.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  mapRpcRowToEvent,
  summarizeInventory,
  type ClubSeriesEventRow,
  type InventorySummary,
  type SeriesEvent,
} from "./nativeData";

export type NativeProbeStatus = "loading" | "ready" | "unavailable";

export interface NativeSeriesData {
  status: NativeProbeStatus;
  events: SeriesEvent[];
  summary: InventorySummary | null;
  reason: string | null;
}

/** Optional server-side filters. The RPC args are optional strings — never pass null. */
export interface NativeSeriesQuery {
  clubId?: string;
  from?: string;
  to?: string;
}

export function useNativeSeriesEvents(query?: NativeSeriesQuery): NativeSeriesData {
  const { user, session, loading: authLoading } = useAuth();
  const [state, setState] = useState<NativeSeriesData & { scope?: string }>({
    status: "loading",
    events: [],
    summary: null,
    reason: null,
  });

  const clubId = query?.clubId;
  const from = query?.from;
  const to = query?.to;
  const epoch = sessionReadEpoch(session);
  const scope = JSON.stringify([user?.id, epoch, authLoading, clubId, from, to]);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    if (!user) {
      setState({ scope, status: "unavailable", events: [], summary: null, reason: "Chưa đăng nhập." });
      return;
    }

    const stop = startLiveReportRefresh(async () => {
      try {
        // Build args conditionally — the generated RPC args are optional strings
        // (p_club_id?/p_from?/p_to?); do NOT pass explicit null.
        const args: { p_club_id?: string; p_from?: string; p_to?: string } = {};
        if (clubId) args.p_club_id = clubId;
        if (from) args.p_from = from;
        if (to) args.p_to = to;

        // Owner-scoped, STABLE read RPC. Ownership is enforced server-side; we never
        // merge across clubs on the client — each row keeps its own club_id.
        const { data, error } = await observeTrackerContextRead(supabase.rpc("get_club_series_events", args));
        if (error) throw error;

        if (!Array.isArray(data)) throw new Error("SERIES_EVENTS_PAYLOAD_INVALID");
        const seen = new Set<string>();
        const valid = data.every(value => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
          const row = value as unknown as Record<string, unknown>;
          if (typeof row.event_id !== 'string' || !row.event_id.trim() || seen.has(row.event_id)
            || typeof row.club_id !== 'string' || !row.club_id.trim() || (clubId && row.club_id !== clubId)
            || !(row.event_name === null || typeof row.event_name === 'string')
            || !(row.event_date === null || (typeof row.event_date === 'string' && Number.isFinite(Date.parse(row.event_date))))) return false;
          if (['buy_in','fee','service_fee','gtd','prize_pool_actual'].some(key =>
            row[key] !== null && (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || Number(row[key]) < 0))) return false;
          if (['total_entries','unique_entries','reentries'].some(key =>
            row[key] !== null && (!Number.isSafeInteger(row[key]) || Number(row[key]) < 0))) return false;
          seen.add(row.event_id);
          return true;
        });
        if (!valid) throw new Error('SERIES_EVENTS_PAYLOAD_INVALID');
        const rows = data as ClubSeriesEventRow[];
        const events = rows.map(mapRpcRowToEvent);
        if (!cancelled)
          setState({ scope, status: "ready", events, summary: summarizeInventory(events), reason: null });
      } catch (e) {
        // Transport and invalid source payloads are both unavailable, never zero totals.
        const reason = e instanceof Error ? e.message : "Không đọc được dữ liệu.";
        if (!cancelled) setState({ scope, status: "unavailable", events: [], summary: null, reason });
      }
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, [user, epoch, authLoading, clubId, from, to, scope]);

  return state.scope === scope && !authLoading ? state : { status: "loading", events: [], summary: null, reason: null };
}
