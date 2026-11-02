import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FloorRedrawDialogV1 } from "./FloorRedrawDialogV1";
import { floorRedrawJournalKey } from '@/lib/floorRedrawIntent';

const auth = vi.hoisted(()=>({user:{id:'10000000-0000-4000-8000-000000000001'},session:{access_token:'test-session'}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>auth}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseBackendScope:()=> 'http://127.0.0.1:54329'}));
beforeEach(()=>{vi.restoreAllMocks();sessionStorage.clear();auth.user.id='10000000-0000-4000-8000-000000000001';auth.session={access_token:'test-session'};});

it('reload after unknown apply must read the saved intent, never offer a fresh preview',async()=>{
  const tour='10000000-0000-4000-8000-000000000002',batch='10000000-0000-4000-8000-000000000003';
  const plan={batchId:batch,status:'planned',targetMaxSeats:9,targetTableCount:1,playerCount:1,movedCount:1,moves:[{entryId:'10000000-0000-4000-8000-000000000004',playerName:'Reload Player',fromTableNumber:30,fromSeatNumber:1,toTableNumber:30,toSeatNumber:1}]};
  const client={getTournamentTableInventory:vi.fn().mockResolvedValue({ok:true,data:[{gameTableId:'10000000-0000-4000-8000-000000000005',tableNumber:30,maxSeats:9,availabilityStatus:'current_tournament'}]}),
    planTournamentRedraw:vi.fn().mockResolvedValue({ok:true,data:plan}),
    applyTournamentRedraw:vi.fn().mockResolvedValue({ok:false,error:'NETWORK_ERROR'}),
    getRedrawIntent:vi.fn().mockImplementation(async(i:{operation:string})=>({ok:true,data:{status:'found',operation:i.operation,plan:{...plan,status:i.operation==='apply'?'applied':'planned'}}})),
    getActiveTournamentRedraw:vi.fn(),continueTournamentRedraw:vi.fn()};
  const ui=()=> <FloorRedrawDialogV1 open onOpenChange={vi.fn()} tournamentId={tour} tables={[{seats:[{}]}] as never} client={client as never} onApplied={vi.fn()}/>;
  const view=render(ui());
  await waitFor(()=>expect(screen.getByRole('button',{name:'Save preview'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Save preview'}));
  fireEvent.click(await screen.findByRole('button',{name:'Confirm redraw'}));
  await waitFor(()=>expect(client.applyTournamentRedraw).toHaveBeenCalledTimes(1));
  view.unmount();render(ui());
  await waitFor(()=>expect(client.getRedrawIntent).toHaveBeenCalled());
  expect(await screen.findByRole('button',{name:'Continue'})).toBeEnabled();
  expect(screen.queryByRole('button',{name:'Save preview'})).not.toBeInTheDocument();
  expect(client.planTournamentRedraw).toHaveBeenCalledTimes(1);
  expect(client.applyTournamentRedraw).toHaveBeenCalledTimes(1);
});

const tour='20000000-0000-4000-8000-000000000001',batch='20000000-0000-4000-8000-000000000002',physical='20000000-0000-4000-8000-000000000003';
function fixture() {
  const plan={batchId:batch,status:'planned',targetMaxSeats:9,targetTableCount:1,playerCount:1,movedCount:1,
    moves:[{entryId:'20000000-0000-4000-8000-000000000004',playerName:'Journal Player',fromTableNumber:30,fromSeatNumber:1,toTableNumber:30,toSeatNumber:2}]};
  const client={
    getTournamentTableInventory:vi.fn().mockResolvedValue({ok:true,data:[{gameTableId:physical,tableNumber:30,maxSeats:9,availabilityStatus:'current_tournament'}]}),
    planTournamentRedraw:vi.fn().mockResolvedValue({ok:true,data:plan}),
    applyTournamentRedraw:vi.fn().mockResolvedValue({ok:true,data:{...plan,status:'applied'}}),
    getActiveTournamentRedraw:vi.fn().mockResolvedValue({ok:true,data:{batchId:batch,redrawRevision:7}}),
    continueTournamentRedraw:vi.fn().mockResolvedValue({ok:true,data:{clockResumed:false}}),
    getRedrawIntent:vi.fn().mockImplementation(async(i:{operation:string})=>({ok:true,data:i.operation==='continue'
      ?{status:'found',operation:'continue',clockResumed:false}
      :{status:'found',operation:i.operation,plan:{...plan,status:i.operation==='apply'?'applied':'planned'}}})),
  };
  const onApplied=vi.fn();
  const ui=(tournamentId=tour)=><FloorRedrawDialogV1 open onOpenChange={vi.fn()} tournamentId={tournamentId} tables={[{seats:[{}]}] as never} client={client as never} onApplied={onApplied}/>;
  return {client,onApplied,ui};
}
async function preview() {
  await waitFor(()=>expect(screen.getByRole('button',{name:'Save preview'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Save preview'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Confirm redraw'})).toBeEnabled());
}
async function applyPreview() {
  await preview();fireEvent.click(screen.getByRole('button',{name:'Confirm redraw'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Continue'})).toBeEnabled());
}
describe('redraw journal reload and scope fences',()=>{
  it('keeps an unknown preview disabled after reload; explicit retry uses the original key/payload',async()=>{
    const {client,ui}=fixture();
    client.planTournamentRedraw.mockResolvedValueOnce({ok:false,error:'NETWORK_ERROR'} as never);
    client.getRedrawIntent.mockResolvedValue({ok:true,data:{status:'unknown'}});
    const view=render(ui());
    await waitFor(()=>expect(screen.getByRole('button',{name:'Save preview'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'Save preview'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Thử lại đúng yêu cầu redraw'})).toBeEnabled());
    const original=client.planTournamentRedraw.mock.calls[0];
    view.unmount();render(ui());
    await waitFor(()=>expect(client.getRedrawIntent).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button',{name:'Save preview'})).toBeDisabled();
    expect(client.planTournamentRedraw).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'Thử lại đúng yêu cầu redraw'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Confirm redraw'})).toBeEnabled());
    expect(client.planTournamentRedraw.mock.calls[1]).toEqual(original);
  });
  it('recovers Continue after reload even when public TV no longer has an active batch',async()=>{
    const {client,ui}=fixture();
    client.continueTournamentRedraw.mockResolvedValueOnce({ok:false,error:'NETWORK_ERROR'} as never);
    const view=render(ui());await applyPreview();
    fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Thử lại đúng yêu cầu redraw'})).toBeEnabled());
    const sent=client.continueTournamentRedraw.mock.calls[0][0];
    view.unmount();client.getActiveTournamentRedraw.mockResolvedValue({ok:true,data:null} as never);render(ui());
    expect(await screen.findByText('Redraw finished. The clock remains paused because it was already paused or changed during the display.')).toBeInTheDocument();
    expect(client.getRedrawIntent).toHaveBeenCalledWith(expect.objectContaining({...sent,operation:'continue',actorId:auth.user.id,tournamentId:tour}));
    expect(client.continueTournamentRedraw).toHaveBeenCalledTimes(1);
    expect(client.getActiveTournamentRedraw).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0);
  });
  it('unknown Continue retries the persisted revision and key rather than re-reading a new revision',async()=>{
    const {client,ui}=fixture();
    client.continueTournamentRedraw.mockResolvedValueOnce({ok:false,error:'NETWORK_ERROR'} as never);
    const view=render(ui());await applyPreview();fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Thử lại đúng yêu cầu redraw'})).toBeEnabled());
    const sent=client.continueTournamentRedraw.mock.calls[0];
    const originalReader=client.getRedrawIntent.getMockImplementation()!;
    client.getRedrawIntent.mockImplementation(async(i:{operation:string})=>i.operation==='continue'?{ok:true,data:{status:'unknown'}} as never:originalReader(i));
    view.unmount();render(ui());
    await waitFor(()=>expect(screen.getByRole('button',{name:'Thử lại đúng yêu cầu redraw'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'Thử lại đúng yêu cầu redraw'}));
    expect(await screen.findByText('Redraw finished. The clock remains paused because it was already paused or changed during the display.')).toBeInTheDocument();
    expect(client.continueTournamentRedraw.mock.calls[1]).toEqual(sent);
    expect(client.getActiveTournamentRedraw).toHaveBeenCalledTimes(1);
  });
  it.each(['corrupt',''])('corrupt journal blocks writes without deleting the evidence (%j)',async(corrupt)=>{
    const {client,ui}=fixture(),key=floorRedrawJournalKey({actorId:auth.user.id,tournamentId:tour,backendScope:'http://127.0.0.1:54329'});
    sessionStorage.setItem(key,corrupt);render(ui());
    expect(await screen.findByRole('alert')).toHaveTextContent('Không đọc được intent redraw');
    expect(screen.getByRole('button',{name:'Save preview'})).toBeDisabled();
    expect(client.planTournamentRedraw).not.toHaveBeenCalled();expect(sessionStorage.getItem(key)).toBe(corrupt);
  });
  it('storage full prevents the first mutation, not just recovery',async()=>{
    const {client,ui}=fixture();render(ui());
    await waitFor(()=>expect(screen.getByRole('button',{name:'Save preview'})).toBeEnabled());
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota');});
    fireEvent.click(screen.getByRole('button',{name:'Save preview'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('quota');
    expect(client.planTournamentRedraw).not.toHaveBeenCalled();
  });
  it('an apply completion from the old actor cannot update the new workspace or clear the journal',async()=>{
    const {client,onApplied,ui}=fixture();let complete!:(value:unknown)=>void;
    client.applyTournamentRedraw.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}) as never);
    const view=render(ui());await preview();fireEvent.click(screen.getByRole('button',{name:'Confirm redraw'}));
    await waitFor(()=>expect(client.applyTournamentRedraw).toHaveBeenCalledTimes(1));
    const stored=sessionStorage.getItem(sessionStorage.key(0)!);
    auth.user.id='20000000-0000-4000-8000-000000000006';view.rerender(ui());
    await waitFor(()=>expect(screen.getByRole('button',{name:'Save preview'})).toBeEnabled());
    await act(async()=>complete({ok:true,data:{batchId:batch,status:'applied'}}));
    expect(onApplied).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Continue'})).not.toBeInTheDocument();
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(stored);
  });
  it('a stale storage snapshot cannot be used to send apply from another workspace',async()=>{
    const {client,ui}=fixture();render(ui());await preview();
    const key=sessionStorage.key(0)!;sessionStorage.setItem(key,'replaced elsewhere');
    fireEvent.click(screen.getByRole('button',{name:'Confirm redraw'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('REDRAW_JOURNAL_CHANGED');
    expect(client.applyTournamentRedraw).not.toHaveBeenCalled();expect(sessionStorage.getItem(key)).toBe('replaced elsewhere');
  });
  it('changing tournament retires the pending plan completion',async()=>{
    const {client,onApplied,ui}=fixture();let complete!:(value:unknown)=>void;
    client.planTournamentRedraw.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}) as never);
    const view=render(ui());
    await waitFor(()=>expect(screen.getByRole('button',{name:'Save preview'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'Save preview'}));
    await waitFor(()=>expect(client.planTournamentRedraw).toHaveBeenCalledTimes(1));
    view.rerender(ui('20000000-0000-4000-8000-000000000099'));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Save preview'})).toBeEnabled());
    await act(async()=>complete({ok:true,data:{batchId:batch,status:'planned'}}));
    expect(screen.queryByRole('button',{name:'Confirm redraw'})).not.toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
  });
  it('a new auth session recovers read-only rather than keeping an actionable stale preview',async()=>{
    const {client,ui}=fixture(),view=render(ui());await preview();
    auth.session={access_token:'replacement-session'};view.rerender(ui());
    await waitFor(()=>expect(client.getRedrawIntent).toHaveBeenCalledTimes(1));
    expect(client.applyTournamentRedraw).not.toHaveBeenCalled();
    expect(client.planTournamentRedraw).toHaveBeenCalledTimes(1);
  });
  it('storage reads denied fail closed before inventory or mutation',async()=>{
    const {client,ui}=fixture();vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('denied');});
    render(ui());expect(await screen.findByRole('alert')).toHaveTextContent('Không đọc được intent redraw');
    expect(screen.getByRole('button',{name:'Save preview'})).toBeDisabled();
    expect(client.planTournamentRedraw).not.toHaveBeenCalled();expect(client.getTournamentTableInventory).not.toHaveBeenCalled();
  });
});

describe("Floor redraw Continue flow", () => {
  it("retains the same apply request when the first response is lost", async () => {
    const plan={batchId:"10000000-0000-4000-8000-000000000003",status:"planned",targetMaxSeats:9,targetTableCount:1,playerCount:1,movedCount:1,
      moves:[{entryId:"entry-1",playerName:"Player One",fromTableNumber:17,fromSeatNumber:1,toTableNumber:17,toSeatNumber:1}]};
    const client={
      getTournamentTableInventory:vi.fn().mockResolvedValue({ok:true,data:[{gameTableId:"10000000-0000-4000-8000-000000000005",tableNumber:17,maxSeats:9,availabilityStatus:"current_tournament"}]}),
      planTournamentRedraw:vi.fn().mockResolvedValue({ok:true,data:plan}),
      applyTournamentRedraw:vi.fn().mockResolvedValueOnce({ok:false,error:"NETWORK_ERROR"}).mockResolvedValue({ok:true,data:{...plan,status:"applied"}}),
      getActiveTournamentRedraw:vi.fn(),continueTournamentRedraw:vi.fn(),
      getRedrawIntent:vi.fn().mockResolvedValue({ok:true,data:{status:'found',operation:'plan',plan}}),
    };
    render(<FloorRedrawDialogV1 open onOpenChange={vi.fn()} tournamentId="10000000-0000-4000-8000-000000000002" tables={[{seats:[{}]}] as never} client={client as never} onApplied={vi.fn()}/>);
    await waitFor(()=>expect(screen.getByRole("button",{name:"Save preview"})).toBeEnabled());
    await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Save preview"}));});
    await act(async()=>{
      const confirm=screen.getByRole("button",{name:"Confirm redraw"});
      fireEvent.click(confirm);fireEvent.click(confirm);
    });
    await waitFor(()=>expect(client.applyTournamentRedraw).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(screen.getByRole("button",{name:"Thử lại đúng yêu cầu redraw"})).toBeEnabled());
    await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Thử lại đúng yêu cầu redraw"}));});
    await waitFor(()=>expect(client.applyTournamentRedraw).toHaveBeenCalledTimes(2));
    expect(client.applyTournamentRedraw.mock.calls[1][0]).toEqual(client.applyTournamentRedraw.mock.calls[0][0]);
  });
  it("reads the active server revision and continues the same immutable batch", async () => {
    const client = {
      getTournamentTableInventory: vi.fn().mockResolvedValue({ ok: true, data: [{
        gameTableId: "10000000-0000-4000-8000-000000000005",
        tableNumber: 17,
        tableName: "Table 17",
        operationalStatus: "available",
        availabilityStatus: "current_tournament",
        tableSessionId: "session-1",
        controlMode: "manual",
        controlEpoch: 1,
        revision: 2,
        tournamentTableId: "assignment-1",
        maxSeats: 9,
      }] }),
      planTournamentRedraw: vi.fn().mockResolvedValue({ ok: true, data: {
        batchId: "10000000-0000-4000-8000-000000000003",
        status: "planned",
        targetMaxSeats: 9,
        targetTableCount: 1,
        playerCount: 1,
        movedCount: 1,
        moves: [{ entryId: "entry-1", playerName: "Player One", fromTableNumber: 17, fromSeatNumber: 1, toTableNumber: 17, toSeatNumber: 1 }],
      } }),
      applyTournamentRedraw: vi.fn().mockResolvedValue({ ok: true, data: {
        batchId: "10000000-0000-4000-8000-000000000003",
        status: "applied",
        targetMaxSeats: 9,
        targetTableCount: 1,
        playerCount: 1,
        movedCount: 1,
        moves: [{ entryId: "entry-1", playerName: "Player One", fromTableNumber: 17, fromSeatNumber: 1, toTableNumber: 17, toSeatNumber: 1 }],
      } }),
      getActiveTournamentRedraw: vi.fn().mockResolvedValue({ ok: true, data: { batchId: "10000000-0000-4000-8000-000000000003", redrawRevision: 1 } }),
      continueTournamentRedraw: vi.fn().mockResolvedValue({ ok: true, data: { clockResumed: true } }),
    };
    const onApplied = vi.fn();

    render(
      <FloorRedrawDialogV1
        open
        onOpenChange={vi.fn()}
        tournamentId="10000000-0000-4000-8000-000000000002"
        tables={[{
          tournamentId: "tournament-1",
          tournamentTableId: "assignment-1",
          gameTableId: "physical-1",
          tableNumber: 17,
          tableName: "Table 17",
          tableSessionId: "session-1",
          sessionRevision: 2,
          controlMode: "manual",
          controlEpoch: 1,
          maxSeats: 9,
          tournamentTableStatus: "active",
          sessionClosedAt: null,
          activeDealerAssignmentId: null,
          seatLocks: [],
          seats: [{ seatNumber: 1, entryId: "entry-1", playerId: "player-1", displayName: "Player One", entryNo: 1, chipCount: 30000, isActive: true, integrityStatus: "valid" }],
        }]}
        client={client as never}
        onApplied={onApplied}
      />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Save preview" })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save preview" })); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm redraw" })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm redraw" })); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Continue" })); });

    await waitFor(() => expect(client.continueTournamentRedraw).toHaveBeenCalledWith(expect.objectContaining({
      batchId: "10000000-0000-4000-8000-000000000003",
      expectedRedrawRevision: 1,
      requestId: expect.any(String),
    })));
    expect(client.getActiveTournamentRedraw).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000002");
    expect(await screen.findByText("Redraw finished. The tournament clock is running again.")).toBeTruthy();
    expect(onApplied).toHaveBeenCalledTimes(2);
  });
});
