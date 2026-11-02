import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";
import { useAuth } from "@/hooks/useAuth";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DealerRecord {
  id: string;
  club_id: string;
  full_name: string;
  tier: string;
  status: string;
  employment_type: string | null;
  hourly_rate_vnd: number | null;
  base_rate_vnd: number | null;
  monthly_salary_vnd: number | null;
  standard_hours_per_shift: number | null;
  ot_multiplier: number | null;
  joined_date: string | null;
  notes: string | null;
  phone: string | null;
  telegram_user_id: number | null;
  telegram_username: string | null;
  /** Auto-fill shift preference: som | muon | linh_hoat. null = flexible.
   *  Column added by migration 20261220000000 (owner-applied). */
  shift_preference: string | null;
}

export interface DealerScore {
  dealer_id: string;
  full_name: string;
  tier: string;
  club_id: string;
  employment_type: string | null;
  total_hours: number;
  total_swings: number;
  score: number;
}

// ── Polling hook ──────────────────────────────────────────────────────────────

function usePollingQuery<T>(
  queryFn: (signal: AbortSignal) => Promise<T[]>,
  deps: unknown[],
  intervalMs: number
): { data: T[]; loading: boolean; error: string | null; refetch: () => void } {
  const { user, session } = useAuth();
  const readEpoch = sessionReadEpoch(session);
  const scope = JSON.stringify([user?.id ?? null, readEpoch, ...deps]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [data, setData] = useState<T[]>([]);
  const [dataScope, setDataScope] = useState(scope);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const queryFnRef = useRef(queryFn);
  const generationRef = useRef(0);
  const flightRef = useRef<{scope:string;controller:AbortController}|null>(null);
  queryFnRef.current = queryFn;

  const fetch = useCallback(async () => {
    const requestedScope = currentScope.current;
    if(flightRef.current?.scope===requestedScope)return;
    const flight={scope:requestedScope,controller:new AbortController()};
    flightRef.current=flight;
    const gen = ++generationRef.current;
    try {
      const rows = await waitForManualPlayerResponse(queryFnRef.current(flight.controller.signal),15_000);
      if (gen === generationRef.current && requestedScope === currentScope.current) {
        setData(rows);
        setDataScope(requestedScope);
        setError(null);
      }
    } catch (e: unknown) {
      if (gen === generationRef.current && requestedScope === currentScope.current) {
        const message=e&&typeof e==='object'&&'message' in e&&typeof e.message==='string'?e.message:'Không tải được dữ liệu dealer.';
        setError(message==='MANUAL_PLAYER_OUTCOME_UNKNOWN'?'Quá thời gian tải dữ liệu dealer. Hãy thử lại.':message);
      }
    } finally {
      flight.controller.abort();
      if(flightRef.current===flight)flightRef.current=null;
      if (gen === generationRef.current && requestedScope === currentScope.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    setData([]); setLoading(true); setError(null);
    fetch();
    timerRef.current = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) void fetch();
    }, intervalMs);
    return () => {
      generationRef.current += 1;
      flightRef.current?.controller.abort();
      flightRef.current=null;
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, user?.id, readEpoch]);

  return { data: dataScope === scope ? data : [], loading, error, refetch: fetch };
}

// ── Exported hooks ────────────────────────────────────────────────────────────

export function useAllDealers(clubIds: string[]): {
  data: DealerRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  return usePollingQuery<DealerRecord>(
    async (signal) => {
      if (!clubIds.length) return [];
      const query = FEATURES.manualPayrollDeductions
        ? supabase.from("dealers").select("id, club_id, full_name, tier, status, employment_type, hourly_rate_vnd, base_rate_vnd, monthly_salary_vnd, standard_hours_per_shift, ot_multiplier, joined_date, notes, phone, telegram_user_id, telegram_username, shift_preference, manual_bhxh_vnd, manual_tax_vnd")
        : supabase.from("dealers").select("id, club_id, full_name, tier, status, employment_type, hourly_rate_vnd, base_rate_vnd, monthly_salary_vnd, standard_hours_per_shift, ot_multiplier, joined_date, notes, phone, telegram_user_id, telegram_username, shift_preference");
      const { data, error } = await query
        .in("club_id", clubIds)
        .is("deleted_at", null)
        .order("full_name").abortSignal(signal);
      if (error) throw error;
      return data ?? [];
    },
    [[...clubIds].sort().join(",")],
    30_000
  );
}

export function useDealerScores(clubId: string): {
  data: DealerScore[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  return usePollingQuery<DealerScore>(
    async (signal) => {
      if (!clubId) return [];
      const { data, error } = await supabase.rpc('get_dealer_scores_v1',{p_club_id:clubId}).abortSignal(signal);
      if (error) throw error;
      if(!Array.isArray(data))throw new Error('Không xác minh được dữ liệu score dealer.');
      const ids=new Set<string>();
      return data.map((value:unknown):DealerScore=>{
        if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Không xác minh được dữ liệu score dealer.');
        const row=value as Record<string,unknown>;
        if(typeof row.dealer_id!=='string'||!row.dealer_id||ids.has(row.dealer_id)||row.club_id!==clubId
          ||typeof row.full_name!=='string'||typeof row.tier!=='string'
          ||!(row.employment_type===null||typeof row.employment_type==='string')
          ||![row.total_hours,row.total_swings,row.score].every(n=>typeof n==='number'&&Number.isFinite(n)))
          throw new Error('Không xác minh được dữ liệu score dealer.');
        ids.add(row.dealer_id);
        return row as unknown as DealerScore;
      });
    },
    [clubId],
    60_000
  );
}
