import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { listClubDisplays, updateDisplay, type TvDisplayRow } from "./displayAdminRpc";

const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.rpc, from: state.from } }));

describe.skipIf(process.env.VINPOKER_TV1240_LOCAL !== "1" && process.env.VINPOKER_TV1241_LOCAL !== "1" && process.env.VINPOKER_TV1243_LOCAL !== "1")("native TV config client receipt", () => {
  it("accepts the actual RPC row while preserving all persisted data after rollback", async () => {
    const read1243 = process.env.VINPOKER_TV1243_LOCAL === "1";
    const http = process.env.VINPOKER_TV1241_LOCAL === "1" || read1243;
    const report = `D:/Quy trình/output/reports/tv${read1243 ? 1243 : http ? 1241 : 1240}-native-client-receipt-local-20261028.json`;
    expect(existsSync(report)).toBe(false);
    const guard = `DO $$ BEGIN
      ASSERT current_database()='vinpoker_ranking860_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
      ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
      ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
      ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
      ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.save_tv_display_config_v1(uuid,uuid,text,text,text,text)'::regprocedure)='bf18eb8bb0c7d5a668351e4f26649ce5';
    END $$;`;
    const sql = (query: string): string => execFileSync("wsl", ["-d", "PokerVision-P16-4C-Eval", "--", "env",
      "PGHOST=127.0.0.1", "PGPORT=55441", "PGUSER=postgres", "PGDATABASE=vinpoker_ranking860_local",
      "psql", "-w", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
    { input: query, encoding: "utf8", timeout: 20000, maxBuffer: 3000000, stdio: ["pipe", "pipe", "pipe"] }).trim();
    const tables = ["tv_displays", "tournaments", "tournament_entries", "tournament_seats", "chip_bag",
      "tournament_hands", "cashier_buyin_movements", "tournament_prize_payments"];
    const expression = "md5(jsonb_build_array(" + tables.map((table) =>
      `(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${table} x)`).join(",") + ")::text)";
    const fingerprint = () => sql(`BEGIN READ ONLY;${guard}SELECT ${expression};ROLLBACK;`);
    const before = fingerprint();
    const evidence: Record<string, unknown> = { kind: http
      ? "ACTUAL_HELPER_SDK_HTTP_NATIVE_RPC_MODELED_AUTH_NOT_BROWSER_OR_COMMIT"
      : "ACTUAL_HELPER_NATIVE_RPC_MODELED_SDK_NOT_HTTP_BROWSER_OR_COMMIT", before };
    let server: Server | undefined;
    let httpRequests = 0;
    let nativeClient: SupabaseClient | undefined;
    try {
      // Tokens stay in process memory; never include a row or SDK arguments in reports/assertion output.
      const row: TvDisplayRow = JSON.parse(sql(`BEGIN READ ONLY;${guard}
        SELECT to_jsonb(d) FROM public.tv_displays d WHERE id='ca1f1e29-0d57-4e59-b7e5-309f7928f3da';ROLLBACK;`));
      const invokeNative = async (name: string, args: Record<string, unknown>) => {
        expect(name).toBe("save_tv_display_config_v1");
        expect(args.p_display_id === row.id && args.p_assigned_tournament_id === null
          && args.p_layout === row.layout && args.p_announcement === row.announcement
          && args.p_name === row.name && args.p_zone === row.zone).toBe(true);
        const receipt = sql(`BEGIN;${guard}SET LOCAL statement_timeout='10s';
          SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
          SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
          SET LOCAL ROLE authenticated;
          SELECT public.save_tv_display_config_v1(id,NULL,layout,announcement,name,zone)
          FROM public.tv_displays WHERE id='ca1f1e29-0d57-4e59-b7e5-309f7928f3da';ROLLBACK;`);
        return { data: JSON.parse(receipt), error: null };
      };
      if (http) {
        server = createServer(async (request, response) => {
          try {
            if (read1243 && request.method === "GET" && request.url?.startsWith("/rest/v1/tv_displays?")) {
              const url = new URL(request.url, "http://127.0.0.1");
              if (url.searchParams.get("club_id") !== "eq." + row.club_id) throw new Error("LOCAL_CLUB_MISMATCH");
              const rows = sql(`BEGIN READ ONLY;${guard}
                SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
                SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
                SET LOCAL ROLE authenticated;
                SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]') FROM public.tv_displays d
                WHERE id='ca1f1e29-0d57-4e59-b7e5-309f7928f3da';ROLLBACK;`);
              httpRequests++;
              response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
              response.end(rows); return;
            }
            if (request.method !== "POST" || request.url !== "/rest/v1/rpc/save_tv_display_config_v1") {
              response.writeHead(403); response.end(); return;
            }
            let body = "";
            for await (const part of request) {
              body += part;
              if (body.length > 4096) throw new Error("LOCAL_REQUEST_LIMIT");
            }
            httpRequests++;
            const result = await invokeNative("save_tv_display_config_v1", JSON.parse(body));
            response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
            response.end(JSON.stringify(result.data));
          } catch {
            evidence.httpError = true;
            response.writeHead(500, { "Content-Type": "application/json" });
            response.end('{"message":"LOCAL_NATIVE_RECEIPT_ERROR"}');
          }
        });
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("LOCAL_LISTENER_MISSING");
        const client = createClient(`http://127.0.0.1:${address.port}`, "sb_publishable_LOCAL_TEST_ONLY", {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        nativeClient = client;
        state.rpc.mockImplementationOnce((name: string, args: Record<string, unknown>) => client.rpc(name, args));
        evidence.transport = "Supabase SDK HTTP localhost; existing native actor claims modeled by adapter";
      } else {
        state.rpc.mockImplementationOnce(invokeNative);
      }
      const result = await updateDisplay(row, { assigned_tournament_id: null });
      expect(result.error === null).toBe(true);
      expect(result.data?.id === row.id && result.data.assigned_tournament_id === null).toBe(true);
      evidence.acceptedCanonicalRow = true;
      evidence.rpcCalls = state.rpc.mock.calls.length;
      if (read1243 && nativeClient) {
        state.from.mockImplementation((table: string) => nativeClient!.from(table));
        const list = await listClubDisplays(row.club_id!);
        expect(list.error === null && list.data.length === 1 && list.data[0]?.id === row.id).toBe(true);
        evidence.acceptedNativeList = true;
      }
      if (http) {
        evidence.httpRequests = httpRequests;
        expect(evidence.httpRequests).toBe(read1243 ? 2 : 1);
        expect(evidence.httpError).toBeUndefined();
      }
    } finally {
      if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
      const after = fingerprint();
      evidence.after = after;
      evidence.unchanged = before === after;
      writeFileSync(report, JSON.stringify(evidence, null, 2));
      expect(after).toBe(before);
    }
  });
});
