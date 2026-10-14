import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), flags: { tvLayoutEditorV1: true } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.rpc } }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: state.flags }));
import { rpcGetTvDisplayState } from "./displayRpc";
beforeEach(() => { vi.clearAllMocks(); state.rpc.mockResolvedValue({ data: { status: "invalid" }, error: null }); });
describe("paired TV participation RPC", () => {
  it("returns malformed assigned aggregates as a read error, not success", async () => {
    state.rpc.mockResolvedValue({ data: { status: "paired", tournament: { id: "tour", average_stack: 20000 } }, error: null });
    const result = await rpcGetTvDisplayState("test-only-token");
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
  it.each([true, false])("uses canonical v4 and preserves branding flag=%s", async (flag) => {
    state.flags.tvLayoutEditorV1 = flag;
    await rpcGetTvDisplayState("test-only-token");
    expect(state.rpc).toHaveBeenCalledWith("get_tv_display_state_v4", { p_display_token: "test-only-token", p_include_branding: flag });
  });
  it("retains backend error rather than retrying an older approximate reader", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "503" } });
    expect((await rpcGetTvDisplayState("test-only-token")).error).toBe("503");
    expect(state.rpc).toHaveBeenCalledOnce();
  });
  it("returns a rejected transport as a read error so polling can recover", async () => {
    state.rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const result = await rpcGetTvDisplayState("test-only-token");
    expect(result.data).toBeNull();
    expect(result.error).toBe("Failed to fetch");
    expect(state.rpc).toHaveBeenCalledOnce();
  });
});
