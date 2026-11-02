import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const stageA = readFileSync(resolve(root, "supabase/migrations/20270128000002_tv_display_config_guarded_rpc_v1.sql"), "utf8").replace(/\r\n/g, "\n");
const stageB = readFileSync(resolve(root, "supabase/migrations/20270128000003_tv_display_direct_update_revoke_v1.sql"), "utf8").replace(/\r\n/g, "\n");
const adminClient = readFileSync(resolve(root, "src/lib/tv/displayAdminRpc.ts"), "utf8");
const legacyPairing = readFileSync(resolve(root, "supabase/migrations/20260818000001_tv_displays_pairing.sql"), "utf8").replace(/\r\n/g, "\n");

describe("TV display management authority", () => {
  it("reproduces the legacy cross-club assignment gap before the Stage A fix", () => {
    expect(legacyPairing).toContain("WITH CHECK (\n        public.has_role(auth.uid(), 'super_admin')\n        OR club_id IN");
    expect(legacyPairing).not.toContain("t.club_id = v_display.club_id");
    expect(legacyPairing).toContain("WHERE t.id = v_display.assigned_tournament_id");
  });

  it("locks the display and derives actor and club server-side", () => {
    expect(stageA).toContain("v_actor uuid := auth.uid()");
    expect(stageA).toContain("WHERE id = p_display_id\n  FOR UPDATE");
    expect(stageA).toContain("v_display.club_id");
    expect(stageA).not.toContain("p_club_id");
    expect(stageA).toContain("public.is_club_owner(v_actor, v_display.club_id)");
    expect(stageA).toContain("public.is_club_floor(v_actor, v_display.club_id)");
  });

  it("allows only a nondeleted same-club tournament", () => {
    expect(stageA).toContain("t.id = p_assigned_tournament_id");
    expect(stageA).toContain("t.club_id = v_display.club_id");
    expect(stageA).toContain("t.deleted_at IS NULL");
    expect(stageA).toContain("tv_display_tournament_unavailable");
  });

  it("fails a mismatched legacy token row closed before reading tournament state", () => {
    const readerStart = stageA.indexOf("FUNCTION public.get_tv_display_state_v3");
    const reader = stageA.slice(readerStart);
    expect(reader).toContain("FOR SHARE");
    expect(reader).toContain("t.club_id = v_display.club_id");
    expect(reader).toContain("t.deleted_at IS NULL");
    expect(reader.indexOf("RETURN jsonb_build_object('status', 'invalid')"))
      .toBeLessThan(reader.indexOf("v_payload := public.get_tv_display_state"));
    expect(stageA).not.toContain("REVOKE ALL ON FUNCTION public.get_tv_display_state(text)");
  });

  it("keeps the event-branding scope separate from tournament clock state", () => {
    expect(stageA).toContain("public.get_tv_tournament_branding_v1(v_display.assigned_tournament_id)");
    expect(stageA).not.toContain("UPDATE public.tournament_events");
    expect(stageA).not.toContain("UPDATE public.tournament_clock");
  });

  it("uses the canonical valid client fallback without rewriting stored layouts", () => {
    expect(stageA).toContain("'brand_x',13,'brand_y',10,'brand_scale',70,'logo_scale',80");
    expect(stageA).toContain("'text_blocks','[]'::jsonb");
    expect(stageA).not.toMatch(/UPDATE public\.tv_tournament_layouts/i);
  });

  it("moves the client to the guarded RPC and consumes its canonical row", () => {
    expect(adminClient).toContain('sb.rpc("save_tv_display_config_v1"');
    expect(adminClient).toContain("!isDisplayRow(data)");
    expect(adminClient).toContain("data.id !== row.id");
    expect(adminClient).toContain("data.club_id !== row.club_id");
    expect(adminClient).toContain('data.status !== "paired"');
    expect(adminClient).not.toContain('.from("tv_displays").update');
  });

  it("makes Stage B an explicit direct-update revoke with no live execution machinery", () => {
    expect(stageB).toContain("DROP POLICY IF EXISTS tv_displays_staff_update");
    expect(stageB).toContain("REVOKE UPDATE ON TABLE public.tv_displays FROM authenticated");
    expect(stageB).toContain("REVOKE ALL ON FUNCTION public.get_tv_display_state(text)");
    expect(stageB).toContain("only after every public display caller is proven to use guarded V3");
    expect(stageB).not.toMatch(/GRANT UPDATE/i);
    expect(stageB).not.toMatch(/status\s*=|display_token\s*=|club_id\s*=/i);
  });

  it("encodes the required authorization matrix", () => {
    expect(stageA).toContain("IF v_actor IS NULL THEN"); // outsider + service role without user identity
    expect(stageA).toContain("tv_display_forbidden"); // authenticated operator from another club
    expect(stageA).toContain("public.is_club_owner(v_actor, v_display.club_id)");
    expect(stageA).toContain("public.is_club_floor(v_actor, v_display.club_id)");
    expect(stageA).toContain("GRANT EXECUTE ON FUNCTION public.get_tv_display_state_v3(text) TO anon, authenticated");
    expect(stageA).toContain("REVOKE ALL ON FUNCTION public.save_tv_display_config_v1(uuid,uuid,text,text,text,text)\n  FROM PUBLIC, anon, authenticated");
  });
});
