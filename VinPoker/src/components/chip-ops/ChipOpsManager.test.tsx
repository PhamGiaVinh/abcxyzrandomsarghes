import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({ signals: [] as AbortSignal[], rpcSignals: [] as {name: unknown; signal: AbortSignal}[], rpc: vi.fn(), from: vi.fn(), tourIs: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn(), auth: {
  isClubOwner: true, isChipMaster: false, user: { id: "owner-a" },
  loading: false, rolesLoading: false, authError: null as string | null, rolesError: null as string | null,
} }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {...h,rpc:(...args:unknown[])=>{
  const request=Object.assign(Promise.resolve(h.rpc(...args)),{abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);h.rpcSignals.push({name:args[0],signal});return request;}});
  return request;
}} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: h.toastSuccess } }));
vi.mock("./DashboardTab", () => ({ DashboardTab: () => null }));
vi.mock("./BankAuditTab", () => ({ BankAuditTab: () => null }));
vi.mock("./BagTagTab", () => ({ BagTagTab: () => null }));
import { ChipOpsManager } from "./ChipOpsManager";
afterEach(()=>vi.useRealTimers());
const setupActor='11111111-1111-4111-8111-111111111111',setupTour='22222222-2222-4222-8222-222222222222',setupClub='33333333-3333-4333-8333-333333333333';
function realSetupScope(){
  h.auth.user={id:setupActor};const original=h.from.getMockImplementation()!;
  h.from.mockImplementation((table:string)=>{const q=original(table);
    if(table==='tournaments')q.then=(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:[{id:setupTour,name:'TEST',club_id:setupClub}],error:null}).then(resolve);
    return q;});
}
it('uses one atomic create/bind request, never the legacy pair',async()=>{
  realSetupScope();const original=h.rpc.getMockImplementation()!;
  h.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>name==='chip_ops_create_and_bind_set_v1'
    ?Promise.resolve({data:{status:'ok',outcome:'created_bound',actor_id:setupActor,request_id:args.p_request_id,tournament_id:setupTour,
      club_id:setupClub,set_name:'TEST atomic',chip_set_id:'44444444-4444-4444-8444-444444444444',error:null},error:null}):original(name,args));
  render(<MemoryRouter initialEntries={['/chip-ops?t='+setupTour]}><ChipOpsManager/></MemoryRouter>);
  fireEvent.mouseDown(await screen.findByRole('tab',{name:'Setup stack'}),{button:0,ctrlKey:false});
  fireEvent.change(await screen.findByPlaceholderText('VD: Bộ chip giải A'),{target:{value:'TEST atomic'}});
  fireEvent.click(screen.getByRole('button',{name:'Tạo & gán'}));await act(async()=>{});
  expect(h.rpc.mock.calls.map(([name])=>name)).not.toContain('chip_ops_create_chip_set');
  expect(h.rpc.mock.calls.filter(([name])=>name==='chip_ops_create_and_bind_set_v1')).toHaveLength(1);
});

it.each(['same','different'])('serializes two same-tick denomination delete clicks (%s row) before React disables the buttons',async(row)=>{
  realSetupScope();
  const originalFrom=h.from.getMockImplementation()!,originalRpc=h.rpc.getMockImplementation()!;
  h.from.mockImplementation((table:string)=>{
    const q=originalFrom(table);
    const rows:Record<string,unknown>={tournament_chip_set:{chip_set_id:'77777777-7777-4777-8777-777777777777'},chip_set:[{id:'77777777-7777-4777-8777-777777777777',name:'TEST set'}],
      chip_set_denomination:[{id:'44444444-4444-4444-8444-444444444444',value:100,color:'#1e88e5',label:null,display_order:0},
        {id:'55555555-5555-4555-8555-555555555555',value:500,color:'#1e88e5',label:null,display_order:1}]};
    if(table in rows)q.then=(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:rows[table],error:null}).then(resolve);
    return q;
  });
  let finish!:(v:unknown)=>void;
  h.rpc.mockImplementation((name:string,...args:unknown[])=>name==='chip_ops_apply_setup_metadata_v1'
    ?new Promise(resolve=>{finish=resolve;}):originalRpc(name,...args));
  render(<MemoryRouter initialEntries={['/chip-ops?t='+setupTour]}><ChipOpsManager/></MemoryRouter>);
  fireEvent.mouseDown(await screen.findByRole('tab',{name:'Setup stack'}),{button:0,ctrlKey:false});
  const [button,other]=await screen.findAllByRole('button',{name:'Xoá'});
  await waitFor(()=>expect(button).toBeEnabled());
  act(()=>{fireEvent.click(button);fireEvent.click(row==='same'?button:other);});
  const calls=h.rpc.mock.calls.filter(([name])=>name==='chip_ops_apply_setup_metadata_v1');
  const args=calls[0][1];
  await act(async()=>finish({data:{status:'ok',outcome:'applied',actor_id:setupActor,club_id:setupClub,tournament_id:setupTour,request_id:args.p_request_id,payload:args.p_payload,error:null,result:{status:'ok',denomination_id:args.p_payload.denomination_id}},error:null}));
  expect(calls).toHaveLength(1);
});

it.each(['delete-first','save-first'])('serializes denomination deletion and template save in one Setup workspace (%s)',async(order)=>{
  realSetupScope();const originalFrom=h.from.getMockImplementation()!,originalRpc=h.rpc.getMockImplementation()!;
  h.from.mockImplementation((table:string)=>{
    const q=originalFrom(table),rows:Record<string,unknown>={tournament_chip_set:{chip_set_id:'77777777-7777-4777-8777-777777777777'},chip_set:[{id:'77777777-7777-4777-8777-777777777777',name:'TEST set'}],
      chip_set_denomination:[{id:'44444444-4444-4444-8444-444444444444',value:100,color:'#1e88e5',label:null,display_order:0}]};
    if(table in rows)q.then=(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:rows[table],error:null}).then(resolve);
    return q;
  });
  const pending:Array<()=>void>=[];
  h.rpc.mockImplementation((name:string,...args:unknown[])=>name.startsWith('chip_ops_')
    ?new Promise(resolve=>{pending.push(()=>resolve({data:null,error:{code:'503'}}));}):originalRpc(name,...args));
  render(<MemoryRouter initialEntries={['/chip-ops?t='+setupTour]}><ChipOpsManager/></MemoryRouter>);
  fireEvent.mouseDown(await screen.findByRole('tab',{name:'Setup stack'}),{button:0,ctrlKey:false});
  fireEvent.change(await screen.findByPlaceholderText('VD: 30K mix'),{target:{value:'TEST template'}});
  fireEvent.change(screen.getByPlaceholderText('VD: 30000'),{target:{value:'100'}});
  fireEvent.change(screen.getByPlaceholderText('0'),{target:{value:'1'}});
  const remove=screen.getByRole('button',{name:'Xoá'}),save=screen.getByRole('button',{name:'Lưu mẫu'});
  await waitFor(()=>{expect(remove).toBeEnabled();expect(save).toBeEnabled();});
  act(()=>{fireEvent.click(order==='delete-first'?remove:save);fireEvent.click(order==='delete-first'?save:remove);});
  const names=h.rpc.mock.calls.map(([name])=>name).filter(name=>name.startsWith('chip_ops_'));
  await act(async()=>{pending.forEach(finish=>finish());});
  expect(names).toEqual([order==='delete-first'?'chip_ops_apply_setup_metadata_v1':'chip_ops_save_stack_template_v2']);
});

it.each(['success','transport','business'].flatMap(outcome=>['actor','roundtrip','unmount'].map(change=>({outcome,change}))))
('suppresses an old denomination completion after scope invalidation ($outcome/$change)',async({outcome,change})=>{
  realSetupScope();const originalFrom=h.from.getMockImplementation()!,originalRpc=h.rpc.getMockImplementation()!;
  h.from.mockImplementation((table:string)=>{
    const q=originalFrom(table),rows:Record<string,unknown>={tournament_chip_set:{chip_set_id:'77777777-7777-4777-8777-777777777777'},chip_set:[{id:'77777777-7777-4777-8777-777777777777',name:'TEST set'}],
      chip_set_denomination:[{id:'44444444-4444-4444-8444-444444444444',value:100,color:'#1e88e5',label:null,display_order:0}]};
    if(table in rows)q.then=(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:rows[table],error:null}).then(resolve);
    return q;
  });
  let finish!:(v:unknown)=>void;
  h.rpc.mockImplementation((name:string,...args:unknown[])=>name==='chip_ops_apply_setup_metadata_v1'
    ?new Promise(resolve=>{finish=resolve;}):originalRpc(name,...args));
  const view=render(<MemoryRouter initialEntries={['/chip-ops?t='+setupTour]}><ChipOpsManager/></MemoryRouter>);
  fireEvent.mouseDown(await screen.findByRole('tab',{name:'Setup stack'}),{button:0,ctrlKey:false});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Xoá'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Xoá'}));
  const args=h.rpc.mock.calls.find(([name])=>name==='chip_ops_apply_setup_metadata_v1')![1];
  const priorReceipt={status:'ok',outcome:'applied',actor_id:setupActor,club_id:setupClub,tournament_id:setupTour,request_id:args.p_request_id,payload:args.p_payload,error:null,result:{status:'ok',denomination_id:args.p_payload.denomination_id}};
  if(change==='unmount')view.unmount();
  else {
    h.auth.user={id:'66666666-6666-4666-8666-666666666666'};
    view.rerender(<MemoryRouter initialEntries={['/chip-ops?t='+setupTour]}><ChipOpsManager/></MemoryRouter>);
    if(change==='roundtrip'){
      h.auth.user={id:setupActor};
      view.rerender(<MemoryRouter initialEntries={['/chip-ops?t='+setupTour]}><ChipOpsManager/></MemoryRouter>);
    }
  }
  await act(async()=>{});h.toastSuccess.mockClear();h.toastError.mockClear();
  await act(async()=>finish(outcome==='success'?{data:priorReceipt,error:null}
    :outcome==='transport'?{data:null,error:{code:'503'}}:{data:{...priorReceipt,status:'rejected',outcome:'rejected',error:'Forbidden',result:null},error:null}));
  expect(h.toastSuccess).not.toHaveBeenCalled();expect(h.toastError).not.toHaveBeenCalled();
});

it('bounds a hung bank read and rejects its late result after explicit retry',async()=>{
  vi.useFakeTimers();let finishOld!:(v:unknown)=>void;let first=true;
  const original=h.rpc.getMockImplementation()!;
  h.rpc.mockImplementation((name:string,...args:unknown[])=>{
    if(name==='get_chip_bank'&&first){first=false;return new Promise(resolve=>{finishOld=resolve;});}
    return original(name,...args);
  });
  render(<MemoryRouter initialEntries={['/chip-ops?t=tour-a']}><ChipOpsManager/></MemoryRouter>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  expect(first).toBe(false);
  await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
  expect(screen.getByRole('alert')).toHaveTextContent('Không đọc được dữ liệu chip');
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();expect(h.rpcSignals.find(r=>r.name==='get_chip_bank')?.signal.aborted).toBe(true);
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Thử tải lại'}));});
  expect(screen.getByRole('tab',{name:'Setup stack'})).toBeInTheDocument();
  await act(async()=>{finishOld({data:{error:'Forbidden'},error:null});});
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(h.rpc.mock.calls.every(([name])=>name.startsWith('get_'))).toBe(true);
});

it('bounds the initial tournament-list read instead of an endless skeleton',async()=>{
  vi.useFakeTimers();const original=h.from.getMockImplementation()!;
  h.from.mockImplementation((table:string)=>{const query=original(table);
    if(table==='tournaments')query.then=()=>new Promise(()=>{});return query;});
  render(<MemoryRouter initialEntries={['/chip-ops?t=tour-a']}><ChipOpsManager/></MemoryRouter>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
  expect(screen.getByRole('alert')).toHaveTextContent('Không đọc được dữ liệu chip');
  expect(h.signals.some(s=>s.aborted)).toBe(true);expect(h.rpc).not.toHaveBeenCalled();
});

it("starts independent inventory, bank and template reads while binding is pending", async () => {
  let resolveBinding!: (value: unknown) => void;
  const pending = new Promise(resolve => { resolveBinding = resolve; });
  const original = h.from.getMockImplementation()!;
  h.from.mockImplementation((table: string) => {
    const query = original(table);
    if (table === "tournament_chip_set") query.then = (resolve: (value: unknown) => unknown) => pending.then(resolve);
    return query;
  });
  render(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  try {
    await waitFor(() => {
      expect(h.rpc).toHaveBeenCalledWith("get_current_chip_inventory", { p_tournament_id: "tour-a" });
      expect(h.rpc).toHaveBeenCalledWith("get_chip_bank", { p_club_id: "club-a" });
      expect(h.from).toHaveBeenCalledWith("stack_template");
    });
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  } finally {
    await act(async () => { resolveBinding({ data: null, error: null }); await pending; });
  }
  await screen.findByRole("tab", { name: "Setup stack" });
});

it("does not serialize bank reads behind template lines or publish a partial workspace", async () => {
  let resolveLines!: (value: unknown) => void;
  const pending = new Promise(resolve => { resolveLines = resolve; });
  const original = h.from.getMockImplementation()!;
  const rows: Record<string, unknown> = {
    tournament_chip_set: { chip_set_id: "set-a" },
    chip_set: [{ id: "set-a", name: "TEST set" }],
    chip_set_denomination: [{ id: "denom-a", value: 100, color: "#1e88e5", label: null, display_order: 0 }],
    stack_template: [{ id: "template-a", name: "TEST stack", stack_value: 100 }],
  };
  h.from.mockImplementation((table: string) => {
    const query = original(table);
    if (table in rows) query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows[table], error: null }).then(resolve);
    if (table === "stack_template_line") query.then = (resolve: (value: unknown) => unknown) => pending.then(resolve);
    return query;
  });
  render(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  try {
    await waitFor(() => {
      expect(h.from).toHaveBeenCalledWith("stack_template_line");
      expect(h.rpc).toHaveBeenCalledWith("get_chip_bank", { p_club_id: "club-a" });
    });
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  } finally {
    await act(async () => { resolveLines({ data: [{ stack_template_id: "template-a", denomination_id: "denom-a", count: 1 }], error: null }); await pending; });
  }
  await screen.findByRole("tab", { name: "Setup stack" });
});

beforeEach(() => {
  sessionStorage.clear();
  h.signals=[];
  h.rpcSignals=[];
  h.auth = { isClubOwner: true, isChipMaster: false, user: { id: "owner-a" }, loading: false, rolesLoading: false, authError: null, rolesError: null };
  h.rpc.mockClear();
  h.toastError.mockClear();
  h.toastSuccess.mockClear();
  h.from.mockClear();
  h.tourIs.mockClear();
  h.from.mockImplementation((table: string) => {
    const result = { data: table === "tournaments" ? [{ id: "tour-a", name: "TEST", club_id: "club-a" }] : [], error: null };
    const query: Record<string, unknown> = {};
    query.abortSignal=(signal:AbortSignal)=>{h.signals.push(signal);return query;};
    for (const method of ["select", "order", "limit", "eq", "in", "maybeSingle"]) query[method] = () => query;
    query.is = (...args: unknown[]) => { if (table === "tournaments") h.tourIs(...args); return query; };
    query.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
    return query;
  });
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory" ? { denominations: [] } : name === "get_chip_bank" ? { coupling_enabled: false } : name === "get_color_up_history" ? { operations: [] } : {}, error: null }));
});

it("excludes soft-deleted tournaments before publishing the Chip Ops picker", async () => {
  render(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  await screen.findByRole("tab", { name: "Setup stack" });
  expect(h.tourIs).toHaveBeenCalledWith("deleted_at", null);
  expect(h.rpc.mock.calls.every(([name]) => name.startsWith("get_"))).toBe(true);
});

it("does not load a soft-deleted tour from a bookmarked chip workspace", async () => {
  const original = h.from.getMockImplementation()!;
  h.from.mockImplementation((table: string) => {
    const query = original(table);
    if (table === "tournaments") {
      let liveToursOnly = false;
      query.is = (column: string, value: unknown) => {
        liveToursOnly = column === "deleted_at" && value === null;
        return query;
      };
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
        data: liveToursOnly ? [] : [{ id: "deleted-tour", name: "Deleted tour", club_id: "club-a" }], error: null,
      }).then(resolve);
    }
    return query;
  });
  render(<MemoryRouter initialEntries={["/chip-ops?t=deleted-tour"]}><ChipOpsManager /></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent("Không đọc được dữ liệu chip");
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  expect(h.rpc).not.toHaveBeenCalled();
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

it.each([null,-1,0.5,'',false])('blocks the whole chip workspace on malformed current inventory count (%j)',async(count)=>{
 h.rpc.mockImplementation(async(name:string)=>({data:name==='get_current_chip_inventory'
  ?{denominations:[{denomination_id:'low',value:100,color:null,current_count:count,issued_count_total:1}]}
  :{coupling_enabled:false},error:null}));
 render(<MemoryRouter initialEntries={['/chip-ops?t=tour-a']}><ChipOpsManager/></MemoryRouter>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Không đọc được dữ liệu chip');
 expect(screen.queryByRole('tab')).not.toBeInTheDocument();
 expect(h.rpc.mock.calls.every(([name])=>name.startsWith('get_'))).toBe(true);
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

it("retains only the missing-current-RPC inventory fallback with concurrent reads", async () => {
  h.rpc.mockImplementation(async (name: string) => name === "get_current_chip_inventory"
    ? { data: null, error: { code: "PGRST202" } }
    : { data: name === "get_issued_chip_inventory" ? { denominations: [] } : { coupling_enabled: false }, error: null });
  render(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  await screen.findByRole("tab", { name: "Setup stack" });
  expect(h.rpc.mock.calls.filter(([name]) => name === "get_issued_chip_inventory")).toHaveLength(1);
  expect(h.rpc.mock.calls.every(([name]) => name.startsWith("get_"))).toBe(true);
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
  const oldInventorySignal=h.rpcSignals.find(r=>r.name==='get_current_chip_inventory')?.signal;
  expect(oldInventorySignal?.aborted).toBe(false);
  h.auth = { ...h.auth, user: { id: "owner-b" } };
  view.rerender(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  await screen.findByRole("tab", { name: "Setup stack" });
  expect(oldInventorySignal?.aborted).toBe(true);
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
    if (table === "tournaments") query.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => (rejected
      ? Promise.reject(new Error("fetch failed"))
      : Promise.resolve({ data: null, error: { code: "503" } })).then(resolve,reject);
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

it.each([
  [{ code: "503" }, false, "Không kết nối được máy chủ chip"],
  [{ code: "42501" }, false, "Không xác minh được quyền thao tác chip"],
  [{ code: "PGRST202" }, false, "Chức năng chip chưa sẵn sàng trên máy chủ"],
  [new TypeError("Failed to fetch"), true, "Không kết nối được máy chủ chip"],
])("classifies Setup mutation failures without claiming success (%s)", async (error, rejected, message) => {
  realSetupScope();
  const original = h.rpc.getMockImplementation()!;
  h.rpc.mockImplementation((name: string, ...args: unknown[]) => name === "chip_ops_create_and_bind_set_v1"
    ? rejected ? Promise.reject(error) : Promise.resolve({ data: null, error })
    : original(name, ...args));
  render(<MemoryRouter initialEntries={["/chip-ops?t="+setupTour]}><ChipOpsManager /></MemoryRouter>);
  fireEvent.mouseDown(await screen.findByRole("tab", { name: "Setup stack" }), { button: 0, ctrlKey: false });
  fireEvent.change(await screen.findByPlaceholderText("VD: Bộ chip giải A"), { target: { value: "TEST set" } });
  fireEvent.click(screen.getByRole("button", { name: "Tạo & gán" }));
  await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(expect.stringContaining(message)));
  expect(h.toastSuccess).not.toHaveBeenCalled();
  expect(h.rpc.mock.calls.filter(([name]) => name === "chip_ops_create_and_bind_set_v1")).toHaveLength(1);
  expect(h.rpc.mock.calls.some(([name]) => name === "chip_ops_bind_tournament_chip_set")).toBe(false);
  expect(screen.getByRole("button", { name: "Gửi lại nguyên yêu cầu" })).toBeEnabled();
});

it.each([null,{}, {status:'unknown'}, {status:'ok',chip_set_id:'wrong-set',action:'bound'}])('does not confirm create-and-bind without a canonical binding receipt (%j)',async(packet)=>{
  realSetupScope();
  const original=h.rpc.getMockImplementation()!;
  h.rpc.mockImplementation((name:string,...args:unknown[])=>name==='chip_ops_create_and_bind_set_v1'
    ?Promise.resolve({data:packet,error:null}):original(name,...args));
  render(<MemoryRouter initialEntries={['/chip-ops?t='+setupTour]}><ChipOpsManager/></MemoryRouter>);
  fireEvent.mouseDown(await screen.findByRole('tab',{name:'Setup stack'}),{button:0,ctrlKey:false});
  fireEvent.change(await screen.findByPlaceholderText('VD: Bộ chip giải A'),{target:{value:'TEST set'}});
  fireEvent.click(screen.getByRole('button',{name:'Tạo & gán'}));
  await waitFor(()=>expect(h.rpc.mock.calls.some(([name])=>name==='chip_ops_create_and_bind_set_v1')).toBe(true));
  await act(async()=>{});
  expect(h.toastSuccess).not.toHaveBeenCalled();
  expect(h.toastError).toHaveBeenCalledWith(expect.stringContaining('Chưa xác minh'));
});

it.each(['created_bound','cancelled','rejected'])('handles a canonical atomic create/bind outcome (%s)',async(outcome)=>{
  realSetupScope();
  const original=h.rpc.getMockImplementation()!;const set='11111111-1111-4111-8111-111111111111';
  h.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>name==='chip_ops_create_and_bind_set_v1'
    ?Promise.resolve({data:{status:outcome==='rejected'?'rejected':'ok',outcome,chip_set_id:outcome==='created_bound'?set:null,
      actor_id:setupActor,club_id:setupClub,tournament_id:setupTour,request_id:args.p_request_id,set_name:'TEST set',error:outcome==='rejected'?'NAME_EXISTS':null},error:null}):original(name,args));
  render(<MemoryRouter initialEntries={['/chip-ops?t='+setupTour]}><ChipOpsManager/></MemoryRouter>);
  fireEvent.mouseDown(await screen.findByRole('tab',{name:'Setup stack'}),{button:0,ctrlKey:false});
  fireEvent.change(await screen.findByPlaceholderText('VD: Bộ chip giải A'),{target:{value:'TEST set'}});
  fireEvent.click(screen.getByRole('button',{name:'Tạo & gán'}));
  await waitFor(()=>expect(outcome==='rejected'?h.toastError:h.toastSuccess).toHaveBeenCalled());
  if(outcome==='created_bound')expect(h.toastSuccess).toHaveBeenCalledWith('Đã tạo & gán bộ chip.');
  if(outcome==='cancelled')expect(h.toastSuccess).toHaveBeenCalledWith('Đã hủy yêu cầu chưa thực hiện.');
  if(outcome==='rejected')expect(h.toastSuccess).not.toHaveBeenCalled();
  expect(h.rpc.mock.calls.filter(([name])=>name==='chip_ops_create_and_bind_set_v1')).toHaveLength(1);
  expect(h.rpc.mock.calls.some(([name])=>name==='chip_ops_bind_tournament_chip_set')).toBe(false);
});
