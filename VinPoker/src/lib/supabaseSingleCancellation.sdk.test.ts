// Actual installed SDK, intercepted HTTP, and the repository's standard jsdom setup.
import { expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const client = (fetcher: typeof fetch) => createClient<Database>("http://127.0.0.1:54339", "LOCAL_TEST_ONLY", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: fetcher },
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});

it("keeps a single-row read lazy and forwards cancellation through the installed SDK", async () => {
  const controller = new AbortController();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json([{ value: false }]));
  const query = client(fetcher).from("app_settings").select("value")
    .eq("key", "dealer_feature_tables_enabled").abortSignal(controller.signal).maybeSingle();
  expect(fetcher).not.toHaveBeenCalled();
  const result = await query;
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(String(url)).toContain("/rest/v1/app_settings?");
  expect(new URL(String(url)).searchParams.get("key")).toBe("eq.dealer_feature_tables_enabled");
  expect(init?.signal).toBe(controller.signal);
  expect(result.error).toBeNull();
  expect(result.data).toEqual({ value: false });
});

it("distinguishes a verified missing row from a denied read", async () => {
  const missing = await client(vi.fn<typeof fetch>().mockResolvedValue(json([])))
    .from("app_settings").select("value").abortSignal(new AbortController().signal).maybeSingle();
  expect(missing.data).toBeNull(); expect(missing.error).toBeNull();
  const denied = await client(vi.fn<typeof fetch>().mockResolvedValue(json({ code: "42501", message: "denied" }, 403)))
    .from("app_settings").select("value").abortSignal(new AbortController().signal).maybeSingle();
  expect(denied.data).toBeNull(); expect(denied.error?.code).toBe("42501");
});

it("does not convert an aborted read into a successful empty response", async () => {
  const controller = new AbortController(); controller.abort();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    expect(init?.signal).toBe(controller.signal);
    expect(init?.signal?.aborted).toBe(true);
    throw new DOMException("Local test cancelled", "AbortError");
  });
  const result = await client(fetcher).from("app_settings").select("value")
    .abortSignal(controller.signal).maybeSingle();
  expect(result.data).toBeNull(); expect(result.error).not.toBeNull(); expect(result.status).toBe(0);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("preserves the unarchive PATCH payload and compare-and-set filters", async () => {
  const id = "11111111-1111-4111-8111-111111111111", previous = "2026-10-18T00:00:00Z";
  const controller = new AbortController();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ id, archived_at: null }));
  const result = await client(fetcher).from("booking_chats").update({ archived_at: null })
    .eq("id", id).eq("archived_at", previous).select("id,archived_at")
    .abortSignal(controller.signal).maybeSingle();
  const [url, init] = fetcher.mock.calls[0];
  const params = new URL(String(url)).searchParams;
  expect(init?.method).toBe("PATCH"); expect(JSON.parse(String(init?.body))).toEqual({ archived_at: null });
  expect(params.get("id")).toBe(`eq.${id}`); expect(params.get("archived_at")).toBe(`eq.${previous}`);
  expect(init?.signal).toBe(controller.signal); expect(result.data).toEqual({ id, archived_at: null });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
