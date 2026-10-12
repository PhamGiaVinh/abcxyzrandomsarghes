import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), auth: {
  isClubOwner: true, isChipMaster: false, user: { id: "owner-a" },
  loading: false, rolesLoading: false, authError: null as string | null, rolesError: null as string | null,
} }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: h }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("./DashboardTab", () => ({ DashboardTab: () => null }));
vi.mock("./BankAuditTab", () => ({ BankAuditTab: () => null }));
vi.mock("./BagTagTab", () => ({ BagTagTab: () => null }));
import { ChipOpsManager } from "./ChipOpsManager";

beforeEach(() => {
  h.auth = { isClubOwner: true, isChipMaster: false, user: { id: "owner-a" }, loading: false, rolesLoading: false, authError: null, rolesError: null };
  h.rpc.mockClear();
  h.from.mockClear();
  h.from.mockImplementation((table: string) => {
    const result = { data: table === "tournaments" ? [{ id: "tour-a", name: "TEST", club_id: "club-a" }] : [], error: null };
    const query: Record<string, unknown> = {};
    for (const method of ["select", "order", "limit", "eq", "in", "maybeSingle"]) query[method] = () => query;
    query.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
    return query;
  });
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory" ? { denominations: [] } : name === "get_chip_bank" ? { coupling_enabled: false } : name === "get_color_up_history" ? { operations: [] } : {}, error: null }));
});

it("does not report missing permission while roles are loading", async () => {
  h.auth.isClubOwner = false;
  h.auth.rolesLoading = true;
  render(<MemoryRouter><ChipOpsManager /></MemoryRouter>);
  expect(screen.queryByText("Bạn không có quyền truy cập Chip Ops.")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Đang xác minh quyền Chip Ops");
  await act(async () => {});
});

it("shows an authority read error rather than denied permission", async () => {
  h.auth.isClubOwner = false;
  h.auth.rolesError = "Không tải được quyền";
  render(<MemoryRouter><ChipOpsManager /></MemoryRouter>);
  expect(screen.queryByText("Bạn không có quyền truy cập Chip Ops.")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Chưa xác minh được quyền Chip Ops");
  await act(async () => {});
});

it("still denies verified users without Chip Ops permission", async () => {
  h.auth.isClubOwner = false;
  render(<MemoryRouter><ChipOpsManager /></MemoryRouter>);
  expect(screen.getByText("Bạn không có quyền truy cập Chip Ops.")).toBeInTheDocument();
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  await act(async () => {});
});

it("opens the workspace only after pending roles resolve to an authorized owner", async () => {
  h.auth.isClubOwner = false;
  h.auth.rolesLoading = true;
  const view = render(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  h.auth = { ...h.auth, rolesLoading: false, isClubOwner: true };
  view.rerender(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  await screen.findByRole("tab", { name: "Setup stack" });
  expect(screen.queryByText("Bạn không có quyền truy cập Chip Ops.")).not.toBeInTheDocument();
  await act(async () => {});
});

it("does not expose actions on authority failure even if a previous owner flag remains", async () => {
  h.auth.rolesError = "temporary backend error";
  render(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  await act(async () => {});
});

it("waits for authentication before showing a previous owner workspace", async () => {
  h.auth.loading = true;
  render(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  expect(screen.getByRole("status")).toHaveTextContent("Đang xác minh quyền Chip Ops");
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  await act(async () => {});
});

it("shows authentication failure as unverified rather than denied", async () => {
  h.auth.isClubOwner = false;
  h.auth.authError = "temporary authentication failure";
  render(<MemoryRouter><ChipOpsManager /></MemoryRouter>);
  expect(screen.getByRole("alert")).toHaveTextContent("Chưa xác minh được quyền Chip Ops");
  expect(screen.queryByText("Bạn không có quyền truy cập Chip Ops.")).not.toBeInTheDocument();
  await act(async () => {});
});

it("opens the existing setup tab from the real empty Color-Up view without mutating chips", async () => {
  render(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  fireEvent.mouseDown(await screen.findByRole("tab", { name: "Color-Up" }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole("button", { name: "Mở Setup stack" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "Setup stack" })).toHaveAttribute("aria-selected", "true"));
  expect(h.rpc.mock.calls.every(([name]) => name.startsWith("get_"))).toBe(true);
});

it("shows selected-tour inventory denial instead of an empty setup workspace", async () => {
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory" ? { error: "Forbidden" } : {}, error: null }));
  render(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent("Không đọc được dữ liệu chip");
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  expect(h.rpc.mock.calls.some(([name]) => name === "get_issued_chip_inventory")).toBe(false);
});

it("does not report bank coupling OFF when its read is forbidden", async () => {
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory" ? { denominations: [] } : { error: "Forbidden" }, error: null }));
  render(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent("Không đọc được dữ liệu chip");
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
});

it("retries a failed read without falling back to issued inventory or any mutation", async () => {
  let failed = true;
  h.rpc.mockImplementation(async (name: string) => name === "get_current_chip_inventory"
    ? { data: failed ? null : { denominations: [] }, error: failed ? { code: "503", message: "unavailable" } : null }
    : { data: { coupling_enabled: false }, error: null });
  render(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  await screen.findByRole("alert");
  expect(h.rpc.mock.calls.some(([name]) => name === "get_issued_chip_inventory")).toBe(false);
  failed = false;
  fireEvent.click(screen.getByRole("button", { name: "Thử tải lại" }));
  await screen.findByRole("tab", { name: "Setup stack" });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(h.rpc.mock.calls.every(([name]) => name.startsWith("get_"))).toBe(true);
});

it("discards an old actor's late inventory denial after the new actor loads", async () => {
  let resolveOld!: (value: unknown) => void;
  const old = new Promise(resolve => { resolveOld = resolve; });
  let first = true;
  h.rpc.mockImplementation(async (name: string) => {
    if (name === "get_current_chip_inventory") {
      if (first) { first = false; return old; }
      return { data: { denominations: [] }, error: null };
    }
    return { data: { coupling_enabled: false }, error: null };
  });
  const view = render(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  await waitFor(() => expect(first).toBe(false));
  h.auth = { ...h.auth, user: { id: "owner-b" } };
  view.rerender(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  await screen.findByRole("tab", { name: "Setup stack" });
  await act(async () => { resolveOld({ data: { error: "Forbidden" }, error: null }); await old; });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Setup stack" })).toBeInTheDocument();
});

it("does not leave an inaccessible selected tournament on an endless skeleton", async () => {
  render(<MemoryRouter initialEntries={["/chip-ops?t=not-in-scope"]}><ChipOpsManager /></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent("Không đọc được dữ liệu chip");
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
});

it("does not treat failed chip-set metadata as an absent binding", async () => {
  const original = h.from.getMockImplementation()!;
  h.from.mockImplementation((table: string) => {
    const query = original(table);
    if (table === "tournament_chip_set") query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "503" } }).then(resolve);
    return query;
  });
  render(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent("Không đọc được dữ liệu chip");
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
});

it.each([false, true])("exposes a failed tour-list read without a selected tour (rejected=%s)", async (rejected) => {
  const original = h.from.getMockImplementation()!;
  h.from.mockImplementation((table: string) => {
    const query = original(table);
    if (table === "tournaments") query.then = (resolve: (value: unknown) => unknown) => rejected
      ? Promise.reject(new Error("fetch failed"))
      : Promise.resolve({ data: null, error: { code: "503" } }).then(resolve);
    return query;
  });
  render(<MemoryRouter><ChipOpsManager /></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent("Không đọc được dữ liệu chip");
  expect(screen.getByRole("button", { name: "Thử tải lại" })).toBeInTheDocument();
  expect(screen.queryByText("Chọn một giải đấu để xem tổng quan và cài đặt chip.")).not.toBeInTheDocument();
});

it("requires a fresh snapshot after actor A to B to A", async () => {
  let resolveA!: (value: unknown) => void;
  const pendingA = new Promise(resolve => { resolveA = resolve; });
  let phase = "first-a";
  h.rpc.mockImplementation(async (name: string) => name === "get_current_chip_inventory"
    ? phase === "second-a" ? pendingA : { data: { denominations: [] }, error: null }
    : { data: { coupling_enabled: false }, error: null });
  const view = render(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  await screen.findByRole("tab", { name: "Setup stack" });
  h.auth = { ...h.auth, user: { id: "owner-b" } };
  view.rerender(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  await screen.findByRole("tab", { name: "Setup stack" });
  phase = "second-a";
  h.auth = { ...h.auth, user: { id: "owner-a" } };
  view.rerender(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  await act(async () => { resolveA({ data: { denominations: [] }, error: null }); await pendingA; });
  await screen.findByRole("tab", { name: "Setup stack" });
});
