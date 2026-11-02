/**
 * featureTableStore (filename kept as featureTableMock.ts for import stability) —
 * Dealer Swing Feature/Final table dealer-pool store.
 *
 * Patch 6: now RPC-BACKED (was an in-memory mock in Patch 1). The same getProfile /
 * useFeatureTableVersion / pure-derivation API surface is preserved so consumers
 * (badge, border, box, dialog) barely change; only the data source moved from a local
 * Map to the live Patch-3 RPCs:
 *   - READ:  get_table_dealer_rules(p_club_id)  → hydrateFromRules() fills the cache
 *            (P1-B: NEVER select dealer_table_profiles/_pool_members directly — RLS blocks floor)
 *   - WRITE: save_table_dealer_profile_v2 (one actor-bound atomic receipt).
 * The enforcement kill-switch app_settings('dealer_feature_tables_enabled') is read separately
 * (useFeatureEnforcementEnabled) for the honest "config saved but enforcement OFF" banner.
 *
 * Mirrors ADR-012: base mode (normal|feature) + a separate is_final flag; "special" =
 * feature OR final; FINAL takes precedence over FEATURE for the badge/border (DR-8a).
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import {z} from 'zod';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import {dealerFeatureArgs,type DealerFeatureIntent} from '@/lib/dealerFeatureProfileIntent';

export type DealerTableMode = "normal" | "feature";

export interface FeatureTablePoolMember {
  dealerId: string;
  name: string;
  isPrimary: boolean;
}

export interface FeatureTableProfile {
  tableMode: DealerTableMode;
  isFinal: boolean;
  allowOverride: boolean;
  pool: FeatureTablePoolMember[];
}

const EMPTY: FeatureTableProfile = {
  tableMode: "normal",
  isFinal: false,
  allowOverride: false,
  pool: [],
};

const store = new Map<string, FeatureTableProfile>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  listeners.forEach((l) => l());
}

export function getProfile(tableId: string): FeatureTableProfile {
  return store.get(tableId) ?? EMPTY;
}

/** Local cache write (kept for optimistic use). Patch 6 writes go through saveProfileToDb. */
export function setProfile(tableId: string, p: FeatureTableProfile): void {
  const isDefault = p.tableMode === "normal" && !p.isFinal && !p.allowOverride && p.pool.length === 0;
  if (isDefault) store.delete(tableId);
  else store.set(tableId, p);
  emit();
}

export function isSpecial(p: FeatureTableProfile): boolean {
  return p.tableMode === "feature" || p.isFinal;
}

export function modeLabel(p: FeatureTableProfile): string {
  return p.isFinal ? "Final" : p.tableMode === "feature" ? "Tâm điểm" : "Thường";
}

/** Filter category for the right-rail box + future grid filter. */
export type FeatureFilter = "all" | "normal" | "feature" | "final";
export function matchesFilter(p: FeatureTableProfile, f: FeatureFilter): boolean {
  switch (f) {
    case "all": return true;
    case "final": return p.isFinal;
    case "feature": return p.tableMode === "feature" && !p.isFinal;
    case "normal": return !isSpecial(p);
  }
}

export interface FeatureBadgeStyle {
  key: "final" | "feature";
  label: string;
  /** badge pill classes */
  badgeClass: string;
  /** card border + glow accent */
  borderClass: string;
}

/** FINAL precedence over FEATURE (ADR-012 DR-8a). Returns null for normal tables. */
export function featureBadgeFor(p: FeatureTableProfile): FeatureBadgeStyle | null {
  if (p.isFinal) {
    return {
      key: "final",
      label: "Final",
      badgeClass: "border-amber-400/40 bg-amber-400/10 text-amber-400",
      borderClass: "border-amber-400/60 shadow-[0_0_22px_hsl(var(--warning)/0.18)]",
    };
  }
  if (p.tableMode === "feature") {
    return {
      key: "feature",
      label: "Tâm điểm",
      badgeClass: "border-success/40 bg-success/10 text-success",
      borderClass: "border-success/55 shadow-[0_0_22px_hsl(var(--success)/0.16)]",
    };
  }
  return null;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function getVersion(): number { return version; }

/** Re-render hook: bumps when any profile changes. */
export function useFeatureTableVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch 6 — RPC wiring (P1-B: reads ONLY via get_table_dealer_rules)
// ─────────────────────────────────────────────────────────────────────────────

/** Shape of one table from get_table_dealer_rules.tables[] (see migration 20261105000000). */
interface RulesTable {
  table_id: string;
  table_mode: string;
  is_final: boolean;
  allow_override: boolean;
  display_label: string | null;
  pool: { dealer_id: string; name: string; priority: number; is_primary: boolean }[];
}
interface RulesResult {
  club_id: string;
  as_of: string;
  tables: RulesTable[];
}

/** Replace the cache from a get_table_dealer_rules result. Tables without a profile row are
 *  absent → getProfile() returns EMPTY (= normal), matching the DB. */
export function hydrateFromRules(rules: RulesResult | null): void {
  store.clear();
  for (const t of rules?.tables ?? []) {
    store.set(t.table_id, {
      tableMode: t.table_mode === "feature" ? "feature" : "normal",
      isFinal: !!t.is_final,
      allowOverride: !!t.allow_override,
      pool: (t.pool ?? []).map((pm) => ({ dealerId: pm.dealer_id, name: pm.name, isPrimary: !!pm.is_primary })),
    });
  }
  emit();
}

let rulesReadGeneration = 0;

/** Load only the current panel's response into the shared cache. */
export function useFeatureTableRules(clubId: string | null | undefined): {
  loading: boolean; error: string | null; refetch: () => Promise<void>;
} {
  const context = useMemo(() => ({ clubId }), [clubId]);
  const currentContext = useRef(context);
  currentContext.current = context;
  const mounted = useRef(false);
  const sequence = useRef(0);
  const [state, setState] = useState({ context, loading: false, error: null as string | null });
  const refetch = useCallback(async () => {
    if (!clubId || !mounted.current || currentContext.current !== context) return;
    const request = ++sequence.current;
    const isCurrent = () => mounted.current && currentContext.current === context && sequence.current === request;
    setState({ context, loading: true, error: null });
    try {
      await fetchAndHydrate(clubId, isCurrent);
      if (isCurrent()) setState({ context, loading: false, error: null });
    } catch (e) {
      if (isCurrent()) setState({ context, loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  }, [clubId, context]);
  useEffect(() => {
    mounted.current = true;
    void refetch();
    return () => { mounted.current = false; sequence.current += 1; };
  }, [refetch]);
  return { loading: state.context === context ? state.loading : !!clubId,
    error: state.context === context ? state.error : null, refetch };
}
const profileRpc=supabase.rpc.bind(supabase) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
export async function saveProfileToDb(intent:DealerFeatureIntent){
 const r=await waitForManualPlayerResponse(Promise.resolve(profileRpc('save_table_dealer_profile_v2',dealerFeatureArgs(intent))));
 if(r.error)throw r.error;return r.data;
}
export async function readProfileSaveReceipt(intent:DealerFeatureIntent){
 const r=await waitForManualPlayerResponse(Promise.resolve(profileRpc('get_table_dealer_profile_receipt_v2',{p_club_id:intent.clubId,p_request_id:intent.requestId,p_expected_actor:intent.actorId})));
 if(r.error)throw r.error;return r.data;
}
export async function cancelProfileSave(intent:DealerFeatureIntent){
 const r=await waitForManualPlayerResponse(Promise.resolve(profileRpc('cancel_table_dealer_profile_v2',dealerFeatureArgs(intent))));
 if(r.error)throw r.error;return r.data;
}
const Rule=z.object({table_id:z.string().uuid(),table_mode:z.enum(['normal','feature']),is_final:z.boolean(),allow_override:z.boolean(),
 display_label:z.string().nullable(),pool:z.array(z.object({dealer_id:z.string().uuid(),name:z.string(),priority:z.number().int(),is_primary:z.boolean()}))});
const RuleRead=z.object({club_id:z.string().uuid(),as_of:z.string(),tables:z.array(Rule).refine(t=>new Set(t.map(r=>r.table_id)).size===t.length)});
async function fetchAndHydrate(clubId: string, isCurrent: () => boolean): Promise<void> {
 const generation = ++rulesReadGeneration;
 const r = await waitForManualPlayerResponse(Promise.resolve(profileRpc('get_table_dealer_rules', { p_club_id: clubId })));
 if (r.error) throw r.error;
 const data = RuleRead.parse(r.data);
 if (data.club_id !== clubId || !isCurrent() || generation !== rulesReadGeneration) {
   throw Error('DEALER_PROFILE_READ_SCOPE_INVALID');
 }
 hydrateFromRules({ club_id: data.club_id, as_of: data.as_of, tables: data.tables.map(t => ({
   table_id: t.table_id, table_mode: t.table_mode, is_final: t.is_final,
   allow_override: t.allow_override, display_label: t.display_label,
   pool: t.pool.map(p => ({ dealer_id: p.dealer_id, name: p.name, priority: p.priority, is_primary: p.is_primary })),
 })) });
}

/** A dialog loads its own verified snapshot; an old credential cannot hydrate the shared cache. */
export async function loadFeatureTableProfile(clubId:string,tableId:string,isCurrent:()=>boolean):Promise<FeatureTableProfile>{
 await fetchAndHydrate(clubId, isCurrent);
 return getProfile(tableId);
}
/** Display-only read of the server enforcement switch. The database enables
 *  enforcement only for JSON boolean true; a successful missing row means OFF.
 *  Failed/malformed reads remain unknown and never decide assignment authority. */
export function useFeatureEnforcementEnabled(): {
  enabled: boolean | null; loading: boolean; error: string | null; refetch: () => Promise<void>;
} {
  const [state, setState] = useState<{ enabled: boolean | null; loading: boolean; error: string | null }>({
    enabled: null, loading: true, error: null,
  });
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const refetch = useCallback(async () => {
    const current = ++generation.current;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState({ enabled: null, loading: true, error: null });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel = () => {};
    const stopped = new Promise<never>((_, reject) => {
      cancel = () => reject(new Error("feature_enforcement_read_cancelled"));
      controller.signal.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => controller.abort(), 15_000);
    });
    try {
      const packet = await Promise.race([Promise.resolve(supabase.from("app_settings")
        .select("value").eq("key", "dealer_feature_tables_enabled").abortSignal(controller.signal).maybeSingle()), stopped]);
      if (packet.error) throw packet.error;
      const data: unknown = packet.data;
      let enabled: boolean;
      if (data === null) enabled = false;
      else if (data && typeof data === "object" && !Array.isArray(data) && typeof (data as { value?: unknown }).value === "boolean") {
        enabled = (data as { value: boolean }).value;
      } else throw new Error("feature_enforcement_invalid_response");
      if (current === generation.current) setState({ enabled, loading: false, error: null });
    } catch {
      if (current === generation.current) setState({ enabled: null, loading: false,
        error: "Không xác minh được trạng thái bảo vệ bàn. Hãy thử lại." });
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", cancel);
      if (active.current === controller) active.current = null;
    }
  }, []);
  useEffect(() => {
    void refetch();
    return () => { generation.current += 1; active.current?.abort(); active.current = null; };
  }, [refetch]);
  return { ...state, refetch };
}
