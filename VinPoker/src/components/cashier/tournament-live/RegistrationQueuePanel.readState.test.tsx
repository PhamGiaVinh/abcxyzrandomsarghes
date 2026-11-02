import { act,cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RegistrationQueuePanel } from "./RegistrationQueuePanel";

const fixture = vi.hoisted(() => ({ actor: "actorA",session:{access_token:'tokenA'}, failure: "",entryPlayer:'player',receiptEntry:null as string|null,reads:[] as string[],nullTable:'',entryStatus:null as string|null, pending: null as Promise<unknown> | null }));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{movePlayer:true,registrationExtensions:true}}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: fixture.actor ? { id: fixture.actor } : null,session:fixture.session }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) query[method] = () => query;
  query.then = (done: (value: unknown) => unknown) => {
    fixture.reads.push(table);
    if (fixture.pending) return fixture.pending.then(done);
    const rows = table === "tournament_registrations" ? [{ id: "reg", reference_code: "ref", status: fixture.entryStatus?'confirmed':"pending", player_id: "player", committed_at: "2026-10-14", total_pay: 0 }]
      :table==='tournament_entries'&&fixture.entryStatus?[{id:'entry',registration_id:'reg',player_id:fixture.entryPlayer,status:fixture.entryStatus,current_stack:0}]
      :table==='seat_draw_receipts'&&fixture.receiptEntry?[{entry_id:fixture.receiptEntry,registration_id:'reg',receipt_code:'receipt',status:'issued',table_number:7,seat_number:1,display_name:'TEST'}]:[];
    return Promise.resolve({ data: fixture.failure === table||fixture.nullTable===table ? null : rows, error: fixture.failure === table ? { message: "503" } : null }).then(done);
  };
  return query;
} } }));
vi.mock("./SeatDrawDialog", () => ({ SeatDrawDialog: ({ open }: { open: boolean }) => open ? <div role="dialog">Draw TEST</div> : null }));
vi.mock("./MovePlayerDialog", () => ({ MovePlayerDialog: () => null }));
vi.mock("@/components/tournament/seat/SeatReceiptDialog", () => ({ SeatReceiptDialog: () => null }));
vi.mock("@/components/cashier/registrations/CancelRegistrationDialog", () => ({ CancelRegistrationDialog: () => null }));
vi.mock("@/components/cashier/registrations/VoidRegistrationDialog", () => ({ VoidRegistrationDialog: () => null }));
afterEach(() => { cleanup();vi.useRealTimers();vi.restoreAllMocks(); fixture.actor = "actorA";fixture.session={access_token:'tokenA'}; fixture.failure = ""; fixture.pending = null;fixture.entryStatus=null;fixture.nullTable='';fixture.reads=[];fixture.entryPlayer='player';fixture.receiptEntry=null; });
const props = { tournamentId: "tourA", tournamentName: "TEST", tournamentDate: null, refreshTrigger: 0 };
it.each(['completed','finished','cancelled'])('does not offer new seat draws for a %s tour',async tournamentStatus=>{
 render(<RegistrationQueuePanel {...props} tournamentStatus={tournamentStatus}/>);await screen.findByText('ref');
 expect(screen.getByRole('button',{name:/Bốc thăm tất cả/})).toBeDisabled();
 expect(screen.queryByRole('button',{name:'Bốc thăm chỗ'})).toBeNull();
});
it('retires an open draw when the same tour completes',async()=>{
 const view=render(<RegistrationQueuePanel {...props} tournamentStatus="live"/>);await screen.findByText('ref');
 fireEvent.click(screen.getByRole('button',{name:'Bốc thăm chỗ'}));expect(screen.getByRole('dialog')).toBeInTheDocument();
 view.rerender(<RegistrationQueuePanel {...props} tournamentStatus="completed"/>);
 expect(screen.queryByRole('dialog')).toBeNull();await screen.findByText('ref');
 expect(screen.getByRole('button',{name:/Bốc thăm tất cả/})).toBeDisabled();
});
it('keeps historical receipt and refund request available without offering a closed-tour seat move',async()=>{
 fixture.entryStatus='registered';fixture.receiptEntry='entry';
 render(<RegistrationQueuePanel {...props} tournamentStatus="completed"/>);await screen.findByText('ref');
 expect(screen.getByRole('button',{name:'Xem phiếu'})).toBeEnabled();
 expect(screen.getByRole('button',{name:'Yêu cầu hoàn tiền'})).toBeEnabled();
 expect(screen.queryByRole('button',{name:'Chuyển ghế'})).toBeNull();
 expect(screen.getByText('Đã xác nhận đăng ký')).toBeInTheDocument();
 expect(screen.queryByText('🪑 Đã có ghế')).toBeNull();
});
it('invalidates open draw intent when the same actor receives a different session',async()=>{
 const view=render(<RegistrationQueuePanel {...props}/>);await screen.findByText('ref');
 fireEvent.click(screen.getByRole('button',{name:'Bốc thăm chỗ'}));expect(screen.getByRole('dialog')).toBeInTheDocument();
 fixture.session={access_token:'tokenB'};fixture.pending=new Promise(()=>{});view.rerender(<RegistrationQueuePanel {...props}/>);
 expect(screen.queryByRole('dialog')).toBeNull();expect(screen.queryByText('ref')).toBeNull();
});
it.each(['player','receipt'])('does not offer actions from a mismatched registration %s identity',async(kind)=>{
 fixture.entryStatus='registered';
 if(kind==='player')fixture.entryPlayer='other-player';else fixture.receiptEntry='other-entry';
 render(<RegistrationQueuePanel {...props}/>);await screen.findByRole('alert');
 expect(screen.queryByRole('button',{name:'Chuyển ghế'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Xem phiếu'})).toBeNull();
});
it('does not overlap queue read groups when another refresh arrives before the first finishes',async()=>{
 let finish!:(value:unknown)=>void;fixture.pending=new Promise(resolve=>{finish=resolve;});
 const view=render(<RegistrationQueuePanel {...props}/>);
 await waitFor(()=>expect(fixture.reads).toHaveLength(3));
 view.rerender(<RegistrationQueuePanel {...props} refreshTrigger={1}/>);
 await act(async()=>{await Promise.resolve();await Promise.resolve();});
 expect(fixture.reads).toHaveLength(3);
 await act(async()=>{finish({data:[],error:null});await Promise.resolve();});
 expect(screen.getByText('Chưa có đăng ký nào cho giải này.')).toBeInTheDocument();
});
it('bounds a hanging queue read and allows manual recovery',async()=>{
 fixture.pending=new Promise(()=>{});vi.useFakeTimers();render(<RegistrationQueuePanel {...props}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
 expect(screen.getByRole('alert')).toBeInTheDocument();
 fixture.pending=null;fireEvent.click(screen.getByRole('button',{name:'Tải lại hàng chờ'}));
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByText('ref')).toBeInTheDocument();
});
it.each(['tournament_registrations','tournament_entries','seat_draw_receipts','profiles'])('rejects missing %s data even when transport reports no error',async(table)=>{
 fixture.nullTable=table;render(<RegistrationQueuePanel {...props}/>);
 await screen.findByRole('alert');
 expect(screen.queryByText('Chưa có đăng ký nào cho giải này.')).toBeNull();
 expect(screen.getByRole('button',{name:/Bốc thăm tất cả/})).toBeDisabled();
});
it('labels a busted entry honestly and does not offer moving or refunding it as seated',async()=>{
 fixture.entryStatus='busted';render(<RegistrationQueuePanel {...props}/>);await screen.findByText('ref');
 expect(screen.getByText('Đã bust')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Chuyển ghế'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Yêu cầu hoàn tiền'})).toBeNull();
});
it('keeps the existing move action for a registered entry',async()=>{
 fixture.entryStatus='registered';fixture.receiptEntry='entry';render(<RegistrationQueuePanel {...props}/>);await screen.findByText('ref');
 expect(screen.getByRole('button',{name:'Chuyển ghế'})).toBeEnabled();
 expect(screen.getByRole('button',{name:'Xem phiếu'})).toBeEnabled();
 expect(screen.queryByText('Đã bust')).toBeNull();
});

it("shows a read error instead of an empty queue and disables bulk actions", async () => {
  fixture.failure = "tournament_entries";
  render(<RegistrationQueuePanel {...props} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được đầy đủ");
  expect(screen.queryByText("Chưa có đăng ký nào cho giải này.")).toBeNull();
  expect(screen.getByRole("button", { name: /Bốc thăm tất cả/ })).toBeDisabled();
});

for (const change of ["actor", "tournament"]) it(`removes previous rows immediately when ${change} changes`, async () => {
  const rendered = render(<RegistrationQueuePanel {...props} />);
  await screen.findByText("ref");
  fixture.pending = new Promise(() => {});
  if (change === "actor") fixture.actor = "actorB";
  rendered.rerender(<RegistrationQueuePanel {...props} tournamentId={change === "tournament" ? "tourB" : "tourA"} />);
  expect(screen.queryByText("ref")).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: /Bốc thăm tất cả/ })).toBeDisabled());
});

it("logout unmounts rows and mutation dialogs", async () => {
  const rendered = render(<RegistrationQueuePanel {...props} />);
  await screen.findByText("ref"); fixture.actor = "";
  rendered.rerender(<RegistrationQueuePanel {...props} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Đăng nhập");
  expect(screen.queryByText("ref")).toBeNull();
});

it("failed refresh closes a previously opened draw intent and keeps last-good rows stale", async () => {
  const rendered = render(<RegistrationQueuePanel {...props} />);
  await screen.findByText("ref");
  fireEvent.click(screen.getByRole("button", { name: "Bốc thăm chỗ" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fixture.failure = "seat_draw_receipts";
  rendered.rerender(<RegistrationQueuePanel {...props} refreshTrigger={1} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("chưa được xác minh lại");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("ref")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Bốc thăm chỗ" })).toBeDisabled();
});

for (const paused of ['hidden','offline'] as const) it(`pauses queue polling while ${paused} and resumes on the next healthy interval`,async()=>{
 vi.useFakeTimers();
 const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
 const online=vi.spyOn(navigator,'onLine','get').mockReturnValue(true);
 render(<RegistrationQueuePanel {...props}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 expect(screen.getByText('ref')).toBeInTheDocument();
 const initial=fixture.reads.length;
 if(paused==='hidden')visibility.mockReturnValue('hidden');else online.mockReturnValue(false);
 await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});
 expect(fixture.reads).toHaveLength(initial);
 visibility.mockReturnValue('visible');online.mockReturnValue(true);
 await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
 expect(fixture.reads.length).toBe(initial+4);
 expect(screen.getByText('ref')).toBeInTheDocument();
});

it.each([null,'entry'])('shows bagged qualifiers read-only with historical receipt %s',async(receipt)=>{
 fixture.entryStatus='bagged';fixture.receiptEntry=receipt;
 render(<RegistrationQueuePanel {...props}/>);await screen.findByText('ref');
 expect(screen.getByText('Đã bag')).toBeInTheDocument();
 expect(screen.queryByText('🪑 Đã có ghế')).toBeNull();
 expect(screen.queryByRole('button',{name:'Chuyển ghế'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Yêu cầu hoàn tiền'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Bốc thăm chỗ'})).toBeNull();
 if(receipt)expect(screen.getByRole('button',{name:'Xem phiếu'})).toBeEnabled();
});
