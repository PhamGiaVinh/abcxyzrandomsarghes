import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

const mock = vi.hoisted(() => ({
  userId: "cashier-a",
  clubs: [{ id: "club-a", name: "Club A" }] as Array<{ id: string; name: string }>,
  scopeError: null as { message: string } | null,
  clubError: null as { message: string } | null,
  scopeRequest: null as ((userId: string) => Promise<{ data: string[] | null; error: { message: string } | null }>) | null,
  countRequest: null as ((table: string) => Promise<MockQueryResult>) | null,
  clubRequest: null as (() => Promise<MockQueryResult>) | null,
  ptEnabled: false,
  ownedIds: [] as string[],
  globalAdmin: false,
  cachedAdmin: false,
}));

type MockQueryResult = { data: unknown[]; count: number | null; error: { message: string } | null };
type MockQuery = {
  select: () => MockQuery;
  in: () => MockQuery;
  eq: () => MockQuery;
  gte: () => MockQuery;
  limit: () => Promise<MockQueryResult>;
  abortSignal: (signal: AbortSignal) => MockQuery;
  then: <TResult1 = MockQueryResult, TResult2 = never>(
    onfulfilled?: ((value: MockQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => PromiseLike<TResult1 | TResult2>;
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: mock.userId }, loading: false, isAdmin: mock.cachedAdmin, isCashier: true }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: () => "Không tải được thống kê. Hãy làm mới để thử lại." }),
}));
vi.mock("@/lib/featureFlags", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/featureFlags")>(),
  OPS_TOUR_CASHIER_ENABLED: true,
  FEATURES: { ...(await importOriginal<typeof import('@/lib/featureFlags')>()).FEATURES,
    get salaryTabV2() { return mock.ptEnabled; } },
}));
vi.mock('@/components/cashier/DealerPtWageTab', () => ({ default: ({ clubIds, ownerClubIds, finalizeStatements }: {
  clubIds: string[]; ownerClubIds: string[]; finalizeStatements: boolean;
}) => <div data-testid="pt-workbench" data-clubs={clubIds.join(',')} data-owner-clubs={ownerClubIds.join(',')}
  data-statements={String(finalizeStatements)}>PT statement workbench</div> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: { _user_id: string }) => {
      const promise = name === 'get_my_ops_global_capability'
        ? Promise.resolve({ data: [{ is_super_admin: mock.globalAdmin }], error: null })
        : mock.scopeRequest ? mock.scopeRequest(args!._user_id)
        : Promise.resolve({ data: mock.clubs.map(club => club.id), error: mock.scopeError });
      return Object.assign(promise, { abortSignal: () => promise });
    },
    from: (table: string) => {
      let result: MockQueryResult = { data: [], count: 0, error: null };
      if (table === "clubs") result = { data: mock.clubs.map(club => ({ ...club, owner_id: mock.ownedIds.includes(club.id) ? mock.userId : null })), count: 0, error: mock.clubError };
      const query = {} as MockQuery;
      query.select = () => query;
      query.in = () => query;
      query.eq = () => query;
      query.gte = () => query;
      query.limit = () => Promise.resolve({ data: mock.ownedIds.map(id => ({ id })), count: 0, error: null });
      query.abortSignal = () => query;
      query.then = (onfulfilled, onrejected) => (table === 'clubs' && mock.clubRequest ? mock.clubRequest() : table !== "clubs" && mock.countRequest
        ? mock.countRequest(table)
        : Promise.resolve(result)).then(onfulfilled, onrejected);
      return { select: () => query };
    },
  },
}));
vi.mock("@/components/DocumentRedirect", () => ({
  DocumentRedirect: ({ to, preserveCurrentLocation }: { to: string; preserveCurrentLocation: boolean }) => (
    <div data-testid="document-redirect" data-preserve={String(preserveCurrentLocation)}>{to}</div>
  ),
}));

import CashierDashboard from "./CashierDashboard";
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Cashier tour entry", () => {
  beforeEach(() => {
    mock.userId = "cashier-a";
    mock.clubs = [{ id: "club-a", name: "Club A" }];
    mock.scopeError = null;
    mock.clubError = null;
    mock.scopeRequest = null;
    mock.countRequest = null;
    mock.clubRequest = null;
    mock.ptEnabled = false;
    mock.ownedIds = [];mock.globalAdmin = false;mock.cachedAdmin = false;
  });

  it('removes a revoked club from the open Cashier header and child workspace', async () => {
    vi.useFakeTimers();mock.ptEnabled = true;mock.clubs = [{id:'club-a',name:'Club A'},{id:'club-b',name:'Club B'}];
    await act(async () => { render(<MemoryRouter initialEntries={['/cashier?tab=pt_wages']}><CashierDashboard /></MemoryRouter>); });
    expect(screen.getByTestId('pt-workbench')).toHaveAttribute('data-clubs','club-a,club-b');
    mock.clubs = [{id:'club-b',name:'Club B'}];
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByText(/Phụ trách: Club B/)).toBeInTheDocument();
    expect(screen.queryByText(/Phụ trách: Club A/)).not.toBeInTheDocument();
    expect(screen.getByTestId('pt-workbench')).toHaveAttribute('data-clubs','club-b');
  });

  it('withdraws owner-only rollout controls even when cashier club IDs do not change', async () => {
    vi.useFakeTimers();mock.ownedIds=['club-a'];
    await act(async () => { render(<MemoryRouter initialEntries={['/cashier?tab=pt_wages']}><CashierDashboard /></MemoryRouter>); });
    expect(screen.getByRole('button',{name:'Lương PT'})).toBeInTheDocument();
    mock.ownedIds=[];
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByRole('button',{name:'Lương PT'})).not.toBeInTheDocument();
    expect(screen.queryByTestId('pt-workbench')).not.toBeInTheDocument();
    expect(screen.getByText(/Phụ trách: Club A/)).toBeInTheDocument();
  });

  it('does not keep cached global Admin affordances after canonical scope has been revoked', async () => {
    vi.useFakeTimers();mock.cachedAdmin=true;mock.globalAdmin=true;mock.clubs=[];
    await act(async () => { render(<MemoryRouter><CashierDashboard /></MemoryRouter>); });
    expect(screen.getByText(/Toàn quyền \(Admin\)/)).toBeInTheDocument();
    mock.globalAdmin=false;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByText(/Toàn quyền \(Admin\)/)).not.toBeInTheDocument();
    expect(screen.getByText('Bạn chưa được phân công CLB nào')).toBeInTheDocument();
  });

  it('removes child controls on a failed background scope read rather than treating it as no clubs', async () => {
    vi.useFakeTimers();mock.ptEnabled=true;
    await act(async () => { render(<MemoryRouter initialEntries={['/cashier?tab=pt_wages']}><CashierDashboard /></MemoryRouter>); });
    expect(screen.getByTestId('pt-workbench')).toBeInTheDocument();mock.scopeError={message:'offline'};
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh được quyền CLB');
    expect(screen.queryByTestId('pt-workbench')).not.toBeInTheDocument();
    expect(screen.queryByText('Bạn chưa được phân công CLB nào')).not.toBeInTheDocument();
  });

  it('disposes A as soon as new membership is known while B metadata is still pending', async () => {
    vi.useFakeTimers();mock.ptEnabled=true;mock.clubs=[{id:'club-a',name:'Club A'},{id:'club-b',name:'Club B'}];
    await act(async()=>{render(<MemoryRouter initialEntries={['/cashier?tab=pt_wages']}><CashierDashboard/></MemoryRouter>);});
    let finish!:(value:MockQueryResult)=>void;const pending=new Promise<MockQueryResult>(resolve=>{finish=resolve;});
    mock.clubs=[{id:'club-b',name:'Club B'}];mock.clubRequest=()=>pending;
    await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
    expect(screen.queryByTestId('pt-workbench')).not.toBeInTheDocument();
    await act(async()=>finish({data:[],count:null,error:{message:'B unavailable'}}));
    expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh được quyền CLB');
  });

  it('bounds a hung permission refresh and ignores its late result', async () => {
    vi.useFakeTimers();mock.ptEnabled=true;
    await act(async()=>{render(<MemoryRouter initialEntries={['/cashier?tab=pt_wages']}><CashierDashboard/></MemoryRouter>);});
    let finish!:(value:{data:string[];error:null})=>void;const pending=new Promise<{data:string[];error:null}>(resolve=>{finish=resolve;});
    mock.scopeRequest=()=>pending;
    await act(async()=>{await vi.advanceTimersByTimeAsync(15001);});
    expect(screen.getByRole('alert')).toHaveTextContent('Không kết nối được để xác minh quyền CLB');
    expect(screen.queryByTestId('pt-workbench')).not.toBeInTheDocument();
    await act(async()=>finish({data:['club-a'],error:null}));
    expect(screen.getByRole('alert')).toBeInTheDocument();expect(screen.queryByTestId('pt-workbench')).not.toBeInTheDocument();
  });

  it('opens the real PT statement destination only with the salary rollout and verified cashier clubs', async () => {
    mock.ptEnabled = true;
    render(<MemoryRouter initialEntries={['/cashier?tab=pt_wages']}><CashierDashboard /></MemoryRouter>);
    const panel = await screen.findByTestId('pt-workbench');
    expect(panel).toHaveAttribute('data-clubs', 'club-a');
    expect(panel).toHaveAttribute('data-owner-clubs', '');
    expect(panel).toHaveAttribute('data-statements', 'true');
    expect(screen.getByRole('button', { name: 'Lương PT' })).toBeInTheDocument();
  });

  it('does not mount PT statement writes for a hidden rollout or an unverified club scope', async () => {
    const view = render(<MemoryRouter initialEntries={['/cashier?tab=pt_wages']}><CashierDashboard /></MemoryRouter>);
    await screen.findByText('Tính năng này chưa được mở cho tài khoản của bạn.');
    expect(screen.queryByTestId('pt-workbench')).not.toBeInTheDocument(); view.unmount();
    mock.ptEnabled = true; mock.scopeError = { message: 'offline' };
    render(<MemoryRouter initialEntries={['/cashier?tab=pt_wages']}><CashierDashboard /></MemoryRouter>);
    await screen.findByRole('alert');
    expect(screen.queryByTestId('pt-workbench')).not.toBeInTheDocument();
  });

  it("does not present an unavailable overview count as confirmed zero", async () => {
    mock.countRequest = async (table) => table === "staking_purchases"
      ? { data: [], count: null, error: { message: "503 backend unavailable" } }
      : { data: [], count: 0, error: null };
    render(<MemoryRouter initialEntries={["/cashier"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được thống kê");
    expect(screen.queryByRole("button", { name: "Active Deals 0" })).not.toBeInTheDocument();
  });

  it("does not let a late overview refresh replace a newer refresh", async () => {
    mock.countRequest = async () => ({ data: [], count: 5, error: null });
    await act(async () => {
      render(<MemoryRouter initialEntries={["/cashier"]}><Routes>
        <Route path="/cashier" element={<CashierDashboard />} />
      </Routes></MemoryRouter>);
    });
    expect(screen.getByRole("button", { name: "Active Deals 5" })).toBeInTheDocument();
    let resolveOld!: (result: MockQueryResult) => void;
    const oldRead = new Promise<MockQueryResult>((resolve) => { resolveOld = resolve; });
    mock.countRequest = () => oldRead;
    fireEvent.click(screen.getByRole("button", { name: "Làm mới" }));
    await act(async () => { await Promise.resolve(); });
    mock.countRequest = async () => ({ data: [], count: 2, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Làm mới" }));
    expect(await screen.findByRole("button", { name: "Active Deals 2" })).toBeInTheDocument();
    await act(async () => { resolveOld({ data: [], count: 9, error: null }); });
    expect(screen.getByRole("button", { name: "Active Deals 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Active Deals 9" })).not.toBeInTheDocument();
  });

  it("allows a confirmed zero after retrying a failed overview read", async () => {
    mock.countRequest = async () => ({ data: [], count: null, error: { message: "Failed to fetch" } });
    render(<MemoryRouter initialEntries={["/cashier"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    mock.countRequest = async () => ({ data: [], count: 0, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Làm mới" }));
    expect(await screen.findByRole("button", { name: "Active Deals 0" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("treats a missing count without an error as unavailable, not zero", async () => {
    mock.countRequest = async () => ({ data: [], count: null, error: null });
    render(<MemoryRouter initialEntries={["/cashier"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Active Deals 0" })).not.toBeInTheDocument();
  });

  it("discards the old account's count response after an account switch", async () => {
    let resolveOld!: (result: MockQueryResult) => void;
    const oldRead = new Promise<MockQueryResult>((resolve) => { resolveOld = resolve; });
    mock.countRequest = () => mock.userId === "cashier-a" ? oldRead
      : Promise.resolve({ data: [], count: 3, error: null });
    const view = render(<MemoryRouter initialEntries={["/cashier"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByText("Cashier CLB")).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    mock.userId = "cashier-b";
    mock.clubs = [{ id: "club-b", name: "Club B" }];
    view.rerender(<MemoryRouter initialEntries={["/cashier"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByRole("button", { name: "Active Deals 3" })).toBeInTheDocument();
    await act(async () => { resolveOld({ data: [], count: 9, error: null }); });
    expect(screen.getByRole("button", { name: "Active Deals 3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Active Deals 9" })).not.toBeInTheDocument();
  });

  it("sends a saved legacy buy-in link to the scoped tour counter", async () => {
    render(<MemoryRouter initialEntries={["/cashier?tab=offline_buyin"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByText("/ops/cashier/tour?club=club-a")).toBeInTheDocument();
    expect(screen.getByTestId("document-redirect")).toHaveAttribute("data-preserve", "false");
  });

  it("asks a multi-club cashier to select a workspace instead of guessing a club", async () => {
    mock.clubs = [{ id: "club-a", name: "Club A" }, { id: "club-b", name: "Club B" }];
    render(<MemoryRouter initialEntries={["/cashier?tab=offline_buyin"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByText("/ops")).toBeInTheDocument();
    expect(screen.getByTestId("document-redirect")).toHaveAttribute("data-preserve", "false");
  });

  it("shows a retryable verification error instead of claiming the cashier has no club", async () => {
    mock.scopeError = { message: "Failed to fetch" };
    render(<MemoryRouter initialEntries={["/cashier"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
    </Routes></MemoryRouter>);

    expect(await screen.findByText("Chưa xác minh được quyền CLB")).toBeInTheDocument();
    expect(screen.queryByText("Bạn chưa được phân công CLB nào")).not.toBeInTheDocument();

    mock.scopeError = null;
    fireEvent.click(screen.getByRole("button", { name: "Thử tải lại" }));
    expect(await screen.findByText("Cashier CLB")).toBeInTheDocument();
  });

  it("shows an error when authorized club IDs cannot be resolved to club rows", async () => {
    mock.clubError = { message: "Failed to fetch" };
    render(<MemoryRouter initialEntries={["/cashier"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
    </Routes></MemoryRouter>);

    expect(await screen.findByText("Đã xác nhận quyền CLB nhưng không tải được danh sách. Vui lòng thử lại.")).toBeInTheDocument();
    expect(screen.queryByText("Bạn chưa được phân công CLB nào")).not.toBeInTheDocument();
  });

  it("shows the unassigned state only after a successful empty scope response", async () => {
    mock.clubs = [];
    render(<MemoryRouter initialEntries={["/cashier"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
    </Routes></MemoryRouter>);

    expect(await screen.findByText("Bạn chưa được phân công CLB nào")).toBeInTheDocument();
    expect(screen.queryByText("Chưa xác minh được quyền CLB")).not.toBeInTheDocument();
  });

  it("does not let an older account response replace the current account's club scope", async () => {
    let resolveOldScope!: (value: { data: string[]; error: null }) => void;
    mock.userId = "cashier-old";
    mock.clubs = [{ id: "club-b", name: "Club B" }];
    mock.scopeRequest = (userId) => userId === "cashier-old"
      ? new Promise((resolve) => { resolveOldScope = resolve; })
      : Promise.resolve({ data: ["club-b"], error: null });

    const view = render(<MemoryRouter initialEntries={["/cashier"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
    </Routes></MemoryRouter>);

    mock.userId = "cashier-new";
    view.rerender(<MemoryRouter initialEntries={["/cashier"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
    </Routes></MemoryRouter>);

    expect(await screen.findByText(/Phụ trách: Club B/)).toBeInTheDocument();
    await act(async () => { resolveOldScope({ data: ["club-a"], error: null }); });
    expect(screen.queryByText(/Phụ trách: Club A/)).not.toBeInTheDocument();
  });
});

it("keeps secondary cashier tasks collapsed until requested",async()=>{
 render(<MemoryRouter initialEntries={["/cashier"]}><CashierDashboard/></MemoryRouter>);
 await screen.findByRole("button",{name:"Buy-in theo tour"});
 const toggle=screen.getByText("Thêm tác vụ");
 const detail=toggle.closest("details")!;
 expect(detail).not.toHaveAttribute("open");
 expect(detail.textContent).toContain("Đăng ký giải");
 expect(detail.textContent).toContain("Thành viên");
 fireEvent.click(toggle);
 expect(detail).toHaveAttribute("open");
});
