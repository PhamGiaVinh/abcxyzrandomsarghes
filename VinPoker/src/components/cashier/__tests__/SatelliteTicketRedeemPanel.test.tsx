import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(),actor:'cashier-one' as string|null,session:{access_token:'TEST satellite session one'} }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc, from: h.from } }));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:h.actor?{id:h.actor}:null,session:h.session})}));
import { SatelliteTicketRedeemPanel } from "../SatelliteTicketRedeemPanel";

const code = "fa000000-0000-4000-8000-000000000001";
const code2 = "fa000000-0000-4000-8000-000000000005";
const winner = "fa000000-0000-4000-8000-000000000002";
const bearer = "fa000000-0000-4000-8000-000000000003";
const firstRequestId = "fa000000-0000-4000-8000-000000000004";
const secondRequestId = "fa000000-0000-4000-8000-000000000006";
const thirdRequestId = "fa000000-0000-4000-8000-000000000007";
let uuidIndex = 0;
let verificationCount = 0;
let loseNextRedeemResponse = false;
beforeAll(() => {
  globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView ||= () => {};
  Element.prototype.hasPointerCapture ||= () => false;
  Element.prototype.releasePointerCapture ||= () => {};
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true,
    value: () => [firstRequestId, secondRequestId, thirdRequestId][uuidIndex++] });
});
beforeEach(() => {
  h.actor='cashier-one';h.session={access_token:'TEST satellite session one'};
  uuidIndex = 0; verificationCount = 0; loseNextRedeemResponse = false;
  h.rpc.mockReset(); h.from.mockReset();
  h.rpc.mockImplementation(async (name: string) => {
    if (name === "satellite_verify_ticket_v1") {
      verificationCount += 1;
      return { data: { ok: true,
      ticketId: `ticket-${verificationCount}`, status: "issued", serial: verificationCount, winnerPlayerId: winner,
      targetTournamentId: "target", targetEntryPriceVnd: "6600000",
      targetBuyInVnd: "6000000", targetFeeVnd: "600000" }, error: null };
    }
    if (name === "satellite_redeem_ticket_v1") {
      if (loseNextRedeemResponse) {
        loseNextRedeemResponse = false;
        // Model a committed server transaction whose response was lost in transit.
        return { data: null, error: { message: "response lost after server commit" } };
      }
      return { data: { ok: true }, error: null };
    }
    if (name === "satellite_get_redemption_receipt_v1") return { data: {
      ok: true, status: "redeemed", ticketId: "fa000000-0000-4000-8000-000000000010", winnerPlayerId: winner,
      redeemedForPlayerId: bearer, registrationId: "fa000000-0000-4000-8000-000000000011", entryId: "fa000000-0000-4000-8000-000000000012",
      receiptId: "fa000000-0000-4000-8000-000000000013", receiptCode: "R-1", buyInVnd: "6000000", feeVnd: "600000",
    }, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });
  h.from.mockImplementation((name: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "ilike", "eq", "order"]) chain[method] = vi.fn(() => chain);
    chain.limit = vi.fn(async () => ({ data: name === "profiles"
      ? [{ user_id: bearer, display_name: "Bearer" }] : [], error: null }));
    return chain;
  });
});
afterEach(cleanup);

describe("Satellite cashier ticket", () => {
  it('does not start an old redemption receipt lookup after the actor has changed',async()=>{
    const original=h.rpc.getMockImplementation()!;
    let release!:(value:unknown)=>void;
    h.rpc.mockImplementation((name:string,...args:unknown[])=>name==='satellite_redeem_ticket_v1'
      ?new Promise(resolve=>{release=resolve;}):original(name,...args));
    const view=render(<SatelliteTicketRedeemPanel/>);
    fireEvent.change(screen.getByLabelText('Private ticket code'),{target:{value:code}});
    fireEvent.click(screen.getByRole('button',{name:'Verify ticket'}));
    await screen.findByText(/Ticket #1 · issued/);
    fireEvent.change(screen.getByLabelText('Find actual bearer'),{target:{value:'Be'}});
    fireEvent.click(screen.getByRole('button',{name:'Search'}));
    fireEvent.keyDown(await screen.findByRole('combobox',{name:'Actual bearer'}),{key:'ArrowDown'});
    fireEvent.click(await screen.findByRole('option',{name:/Bearer/}));
    fireEvent.click(screen.getByRole('button',{name:'Redeem for selected bearer'}));
    h.actor='cashier-two';view.rerender(<SatelliteTicketRedeemPanel/>);
    await act(async()=>release({data:{ok:true},error:null}));
    expect(h.rpc.mock.calls.filter(([name])=>name==='satellite_redeem_ticket_v1')).toHaveLength(1);
    expect(h.rpc.mock.calls.filter(([name])=>name==='satellite_get_redemption_receipt_v1')).toHaveLength(0);
    expect(screen.queryByText(/Server receipt/)).toBeNull();
  });
  it.each(['actor','session','logout'])('removes private ticket and recovery context after %s changes',async(kind)=>{
    const view=render(<SatelliteTicketRedeemPanel/>);
    fireEvent.change(screen.getByLabelText('Private ticket code'),{target:{value:code}});
    fireEvent.change(screen.getByLabelText(/Request ID/),{target:{value:firstRequestId}});
    fireEvent.click(screen.getByRole('button',{name:'Verify ticket'}));
    await screen.findByText(/Ticket #1 · issued/);
    if(kind==='actor')h.actor='cashier-two';
    else if(kind==='session')h.session={access_token:'TEST satellite session two'};
    else h.actor=null;
    view.rerender(<SatelliteTicketRedeemPanel/>);
    expect(screen.queryByText(/Ticket #1 · issued/)).toBeNull();
    if(kind==='logout')expect(screen.queryByLabelText('Private ticket code')).toBeNull();
    else{
      expect((screen.getByLabelText('Private ticket code') as HTMLInputElement).value).toBe('');
      expect((screen.getByLabelText(/Request ID/) as HTMLInputElement).value).toBe('');
    }
  });
  it.each(['success','failure','return-to-original-code'])('ignores %s verification after the ticket input has changed',async(kind)=>{
    const original=h.rpc.getMockImplementation()!;
    const response=await original('satellite_verify_ticket_v1');
    let release!:(value:unknown)=>void;
    h.rpc.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    render(<SatelliteTicketRedeemPanel/>);
    fireEvent.change(screen.getByLabelText('Private ticket code'),{target:{value:code}});
    fireEvent.click(screen.getByRole('button',{name:'Verify ticket'}));
    fireEvent.change(screen.getByLabelText('Private ticket code'),{target:{value:code2}});
    if(kind==='return-to-original-code')fireEvent.change(screen.getByLabelText('Private ticket code'),{target:{value:code}});
    await act(async()=>release(kind==='failure'?{data:null,error:{message:'old ticket read failed'}}:response));
    expect(screen.queryByText(/Ticket #1 · issued/)).toBeNull();
    expect(screen.queryByLabelText('Find actual bearer')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button',{name:'Verify ticket'})).toBeEnabled();
    fireEvent.click(screen.getByRole('button',{name:'Verify ticket'}));
    expect(await screen.findByText(/Ticket #2 · issued/)).toBeTruthy();
    expect(h.rpc).toHaveBeenLastCalledWith('satellite_verify_ticket_v1',{p_code:kind==='return-to-original-code'?code:code2});
  });
  it.each([null,{ok:false,error:'satellite_receipt_not_found'},{ok:true},
    {ok:true,status:'unknown',ticketId:'ticket'}])('retains the request and private code when receipt recovery is unverified: %j',async(packet)=>{
    const original=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async(name:string,...args:unknown[])=>name==='satellite_get_redemption_receipt_v1'
      ?{data:packet,error:null}:original(name,...args));
    render(<SatelliteTicketRedeemPanel/>);
    fireEvent.change(screen.getByLabelText('Private ticket code'),{target:{value:code}});
    fireEvent.change(screen.getByLabelText(/Request ID/),{target:{value:firstRequestId}});
    fireEvent.click(screen.getByRole('button',{name:'Reload receipt'}));
    expect(await screen.findByRole('alert')).toHaveTextContent(/receipt/i);
    expect((screen.getByLabelText(/Request ID/) as HTMLInputElement).value).toBe(firstRequestId);
    expect((screen.getByLabelText('Private ticket code') as HTMLInputElement).value).toBe(code);
    expect(screen.queryByText(/Server receipt/)).toBeNull();
    expect(screen.getByRole('button',{name:'Reload receipt'})).toBeEnabled();
  });
  it('keeps an unverified redemption request recoverable instead of advancing to another key',async()=>{
    const original=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async(name:string,...args:unknown[])=>name==='satellite_get_redemption_receipt_v1'
      ?{data:{ok:false,error:'not_ready'},error:null}:original(name,...args));
    render(<SatelliteTicketRedeemPanel/>);
    fireEvent.change(screen.getByLabelText('Private ticket code'),{target:{value:code}});
    fireEvent.click(screen.getByRole('button',{name:'Verify ticket'}));
    await screen.findByText(/Ticket #1 · issued/);
    fireEvent.change(screen.getByLabelText('Find actual bearer'),{target:{value:'Be'}});
    fireEvent.click(screen.getByRole('button',{name:'Search'}));
    fireEvent.keyDown(await screen.findByRole('combobox',{name:'Actual bearer'}),{key:'ArrowDown'});
    fireEvent.click(await screen.findByRole('option',{name:/Bearer/}));
    fireEvent.click(screen.getByRole('button',{name:'Redeem for selected bearer'}));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Cannot verify the server receipt/);
    expect((screen.getByLabelText(/Request ID/) as HTMLInputElement).value).toBe(firstRequestId);
    expect((screen.getByLabelText('Private ticket code') as HTMLInputElement).value).toBe(code);
    expect(screen.queryByText(/Server receipt/)).toBeNull();
    expect(h.rpc.mock.calls.filter(([name])=>name==='satellite_redeem_ticket_v1')).toHaveLength(1);
  });
  it('ends loading and preserves recovery context when receipt transport throws',async()=>{
    h.rpc.mockRejectedValueOnce(new Error('receipt connection lost'));
    render(<SatelliteTicketRedeemPanel/>);
    fireEvent.change(screen.getByLabelText('Private ticket code'),{target:{value:code}});
    fireEvent.change(screen.getByLabelText(/Request ID/),{target:{value:firstRequestId}});
    fireEvent.click(screen.getByRole('button',{name:'Reload receipt'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('receipt connection lost');
    expect(screen.getByRole('button',{name:'Reload receipt'})).toBeEnabled();
    expect((screen.getByLabelText(/Request ID/) as HTMLInputElement).value).toBe(firstRequestId);
    expect((screen.getByLabelText('Private ticket code') as HTMLInputElement).value).toBe(code);
  });
  it("verifies privately, selects a bearer distinct from winner, and reloads server receipt", async () => {
    render(<SatelliteTicketRedeemPanel />);
    fireEvent.change(screen.getByLabelText("Private ticket code"), { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: "Verify ticket" }));
    expect(await screen.findByText(/Ticket #1 · issued/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Find actual bearer"), { target: { value: "Be" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.keyDown(await screen.findByRole("combobox", { name: "Actual bearer" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: /Bearer/ }));
    expect(await screen.findByText(new RegExp(`Bearer: ${bearer}`))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Redeem for selected bearer" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("satellite_redeem_ticket_v1", {
      p_current_code: code, p_request_id: firstRequestId,
      p_redeemed_for_player_id: bearer, p_source_entry_id: null,
    }));
    expect(await screen.findByText(/Server receipt · redeemed/)).toBeTruthy();
    expect(screen.getByText(/6000000 VND buy-in \+ 600000 VND fees/)).toBeTruthy();
    expect((screen.getByLabelText("Private ticket code") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Reload receipt" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("satellite_get_redemption_receipt_v1", {
      p_request_id: firstRequestId,
    }));
  });
  it("uses a fresh request ID for the next ticket after a completed redeem", async () => {
    render(<SatelliteTicketRedeemPanel />);
    const enterAndVerify = async (ticketCode: string) => {
      fireEvent.change(screen.getByLabelText("Private ticket code"), { target: { value: ticketCode } });
      fireEvent.click(screen.getByRole("button", { name: "Verify ticket" }));
      await screen.findByText(new RegExp(`Ticket #${verificationCount} · issued`));
    };
    await enterAndVerify(code);
    fireEvent.change(screen.getByLabelText("Find actual bearer"), { target: { value: "Be" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.keyDown(await screen.findByRole("combobox", { name: "Actual bearer" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: /Bearer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Redeem for selected bearer" }));
    await screen.findByText(/Server receipt · redeemed/);
    expect((screen.getByLabelText(/Request ID/) as HTMLInputElement).value).toBe(secondRequestId);

    await enterAndVerify(code2);
    fireEvent.click(screen.getByRole("button", { name: "Redeem for selected bearer" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("satellite_redeem_ticket_v1", {
      p_current_code: code2, p_request_id: secondRequestId,
      p_redeemed_for_player_id: bearer, p_source_entry_id: null,
    }));
    expect(h.rpc.mock.calls.filter(([name]) => name === "satellite_redeem_ticket_v1")
      .map(([, args]) => args.p_request_id)).toEqual([firstRequestId, secondRequestId]);
    expect((screen.getByLabelText(/Request ID/) as HTMLInputElement).value).toBe(thirdRequestId);
  });
  it("rotates the active request ID after recovering a committed lost-response receipt", async () => {
    render(<SatelliteTicketRedeemPanel />);
    const enterAndVerify = async (ticketCode: string, ticketNumber: number) => {
      fireEvent.change(screen.getByLabelText("Private ticket code"), { target: { value: ticketCode } });
      fireEvent.click(screen.getByRole("button", { name: "Verify ticket" }));
      await screen.findByText(new RegExp(`Ticket #${ticketNumber} · issued`));
    };
    const chooseCashierBearer = async () => {
      fireEvent.change(screen.getByLabelText("Find actual bearer"), { target: { value: "Be" } });
      fireEvent.click(screen.getByRole("button", { name: "Search" }));
      fireEvent.keyDown(await screen.findByRole("combobox", { name: "Actual bearer" }), { key: "ArrowDown" });
      fireEvent.click(await screen.findByRole("option", { name: /Bearer/ }));
      await screen.findByText(new RegExp(`Bearer: ${bearer}`));
    };

    await enterAndVerify(code, 1);
    await chooseCashierBearer();
    loseNextRedeemResponse = true;
    fireEvent.click(screen.getByRole("button", { name: "Redeem for selected bearer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("response lost after server commit");
    expect((screen.getByLabelText(/Request ID/) as HTMLInputElement).value).toBe(firstRequestId);

    fireEvent.click(screen.getByRole("button", { name: "Reload receipt" }));
    expect(await screen.findByText(/Server receipt · redeemed/)).toBeTruthy();
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("satellite_get_redemption_receipt_v1", {
      p_request_id: firstRequestId,
    }));
    await waitFor(() => expect((screen.getByLabelText(/Request ID/) as HTMLInputElement).value)
      .toBe(secondRequestId));
    expect(screen.queryByRole("button", { name: "Redeem for selected bearer" })).toBeNull();

    await enterAndVerify(code2, 2);
    await chooseCashierBearer();
    fireEvent.click(screen.getByRole("button", { name: "Redeem for selected bearer" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("satellite_redeem_ticket_v1", {
      p_current_code: code2, p_request_id: secondRequestId,
      p_redeemed_for_player_id: bearer, p_source_entry_id: null,
    }));
    expect(h.rpc.mock.calls.filter(([name]) => name === "satellite_redeem_ticket_v1")
      .map(([, args]) => args.p_request_id)).toEqual([firstRequestId, secondRequestId]);
  });
  it("does not offer Redeem for a reversed ticket", async () => {
    h.rpc.mockResolvedValueOnce({ data: { ok: true, ticketId: "ticket", status: "reversed",
      serial: 1, winnerPlayerId: winner, targetEntryPriceVnd: "6600000",
      targetBuyInVnd: "6000000", targetFeeVnd: "600000" }, error: null });
    render(<SatelliteTicketRedeemPanel />);
    fireEvent.change(screen.getByLabelText("Private ticket code"), { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: "Verify ticket" }));
    expect(await screen.findByText(/cannot be redeemed again/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Redeem for selected bearer" })).toBeNull();
  });
});
