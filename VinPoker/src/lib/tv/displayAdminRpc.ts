import { supabase } from "@/integrations/supabase/client";

// Operator-side helpers for the TV Displays dashboard panel (PR C3).
// The tv_displays table + tv_* RPCs (migration 20260818000001) postdate the
// generated supabase/types.ts, so reads/writes go through one local cast here
// until the types file is regenerated. Kept separate from PR C2's displayRpc.ts
// (the anon TV side) so the two PRs touch disjoint files.
type UntypedClient = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  channel: (name: string) => any;
  removeChannel: (channel: unknown) => void;
};

const sb = supabase as unknown as UntypedClient;

export type TvDisplayLayout = "clock" | "break_screen" | "announcement" | "payouts" | "multi_board";
export type TvDisplayStatusRow = "unpaired" | "paired" | "revoked";

export interface TvDisplayRow {
  id: string;
  club_id: string | null;
  display_number: number | null;
  name: string | null;
  zone: string | null;
  display_token: string;
  assigned_tournament_id: string | null;
  layout: TvDisplayLayout;
  announcement: string | null;
  theme: string;
  status: TvDisplayStatusRow;
  last_seen_at: string | null;
  paired_at: string | null;
  created_at: string;
}

function isDisplayRow(value: unknown): value is TvDisplayRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && row.id.length > 0
    && (row.club_id === null || typeof row.club_id === "string")
    && (row.display_number === null || (typeof row.display_number === "number" && Number.isFinite(row.display_number)))
    && typeof row.display_token === "string" && row.display_token.length > 0
    && typeof row.theme === "string" && typeof row.created_at === "string"
    && ["unpaired", "paired", "revoked"].includes(row.status as string)
    && ["clock", "break_screen", "announcement", "payouts", "multi_board"].includes(row.layout as string)
    && ["name", "zone", "assigned_tournament_id", "announcement", "last_seen_at", "paired_at"]
      .every((key) => row[key] === null || typeof row[key] === "string");
}

const ROW_COLUMNS =
  "id, club_id, display_number, name, zone, display_token, assigned_tournament_id, layout, announcement, theme, status, last_seen_at, paired_at, created_at";

/** All paired/revoked displays for a club (RLS: staff + club-scoped). */
export async function listClubDisplays(
  clubId: string,
): Promise<{ data: TvDisplayRow[]; error: string | null }> {
  const { data, error } = await sb
    .from("tv_displays")
    .select(ROW_COLUMNS)
    .eq("club_id", clubId)
    .neq("status", "unpaired")
    .order("display_number", { ascending: true });
  if (error) return { data: [], error: error.message };
  if (!Array.isArray(data) || !data.every(isDisplayRow)) {
    return { data: [], error: "Không xác minh được danh sách TV. Vui lòng tải lại." };
  }
  return { data, error: null };
}

export async function claimDisplay(
  pairCode: string,
  clubId: string,
  name: string,
  zone: string,
): Promise<{ error: string | null; payloadError: string | null }> {
  const { data, error } = await sb.rpc("tv_claim_display", {
    p_pair_code: pairCode,
    p_club_id: clubId,
    p_name: name,
    p_zone: zone,
  });
  const payloadError = (data as { error?: string } | null)?.error ?? null;
  return { error: error?.message ?? null, payloadError };
}

export async function revokeDisplay(
  displayId: string,
): Promise<{ error: string | null; payloadError: string | null }> {
  const { data, error } = await sb.rpc("tv_revoke_display", { p_display_id: displayId });
  const payloadError = (data as { error?: string } | null)?.error ?? null;
  return { error: error?.message ?? null, payloadError };
}

/**
 * Save the complete reviewed configuration through the server-authoritative
 * boundary. The RPC returns the canonical row after validation and locking.
 */
export async function updateDisplay(
  row: TvDisplayRow,
  patch: Partial<
    Pick<TvDisplayRow, "assigned_tournament_id" | "layout" | "announcement" | "name" | "zone">
  >,
): Promise<{ data: TvDisplayRow | null; error: string | null }> {
  const next = { ...row, ...patch };
  const { data, error } = await sb.rpc("save_tv_display_config_v1", {
    p_display_id: row.id,
    p_assigned_tournament_id: next.assigned_tournament_id,
    p_layout: next.layout,
    p_announcement: next.announcement,
    p_name: next.name,
    p_zone: next.zone,
  });
  if (error) return { data: null, error: error.message };
  if (!isDisplayRow(data) || data.id !== row.id || data.club_id !== row.club_id || data.status !== "paired") {
    return { data: null, error: "Không xác minh được cấu hình TV đã lưu. Vui lòng tải lại để kiểm tra." };
  }
  return { data, error: null };
}


/**
 * Notify a TV to refetch immediately after a dashboard change. Broadcast needs
 * no RLS; the 30s poll on the TV is the guaranteed fallback if this is missed.
 */
export async function pingDisplay(displayId: string): Promise<void> {
  const channel = sb.channel(`tv-display:${displayId}`);
  await new Promise<void>((resolve) => {
    channel.subscribe((status: string) => {
      if (status === "SUBSCRIBED") {
        channel
          .send({ type: "broadcast", event: "config", payload: { at: Date.now() } })
          .finally(() => {
            sb.removeChannel(channel);
            resolve();
          });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        sb.removeChannel(channel);
        resolve();
      }
    });
  });
}

const ONLINE_THRESHOLD_MS = 90_000;

export function isDisplayOnline(lastSeenAt: string | null, nowMs: number): boolean {
  if (!lastSeenAt) return false;
  return nowMs - new Date(lastSeenAt).getTime() < ONLINE_THRESHOLD_MS;
}

export function displayLabel(row: Pick<TvDisplayRow, "name" | "display_number">): string {
  if (row.name && row.name.trim()) return row.name;
  if (row.display_number != null) return `TV ${row.display_number}`;
  return "TV";
}
