import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => {
  const rpc = vi.fn();
  return { rpc, client: { rpc }, actor:'actor' as string|null, session:null as {access_token:string}|null,backend:null as string|null };
});
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => h.client,useSupabaseBackendScope:()=>h.backend }));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:h.actor?{id:h.actor}:null,session:h.session})}));
// D2 has its own Auth/session and transport tests; this suite isolates the
// pre-existing qualification/payout controls rather than fabricating D2 commits.
vi.mock('./MultiDayInitialDrawPanel',()=>({MultiDayInitialDrawWorkspace:()=>null}));
import { MultiDayFloorEventPanel } from "./MultiDayFloorEventPanel";
import i18n from '@/i18n';
import {finalizationJournalKey} from '@/ops/floor/multiDayFinalizationIntent';

const eventId = "30000000-0000-0000-0000-00000000000a";
const playerId = "60000000-0000-0000-0000-000000000021";
const participationId = "f334cb4d-fc1c-4f55-8da7-e98780e74f60";
const read = {
  eventId,
  releaseEnabled: true, eventItmPercent: 10,
  capabilities: { canFinalizePayout: true, canRequestAdjustment: true, canApproveAdjustment: true },
  rules: { policy: "SUM_STACKS", itmPercent: 10, day2Percent: 20, minCashX: 1.5 },
  qualification: { sourceHash: "a".repeat(32), participationCount: 1, lockedAt: "now" },
  finalization: null,
  correctionRequests: [],
};
const qualification = { eventId,state: "LOCKED", sourceHash: "a".repeat(32), policy: "SUM_STACKS",
  flights: [{ flightId: "flight-one", status: "locked", dayStatus: "locked", validEntries: 33,
    itmTarget: 4, day2Target: 7, eligibleBags: [] }] };
const payout = { eventId,state: "READY", rulesVersion: "a".repeat(32), fundingRevision: "b".repeat(32),
  qualificationRevision: "c".repeat(32), payoutInputHash: "d".repeat(32),
  directPoolVnd: 1_000_000, transferPoolVnd: 6_000_000, feesVnd: 600_000,
  recordedOverlayVnd: 500_000, requiredShortfallVnd: 0, paidPlayerVnd: 100_000,
  unpaidObligationVnd: 900_000, clubRetainedTieVnd: 400, unallocatedPoolVnd: 6_499_600,
  obligations: [{ playerId, participationId, totalVnd: 1_000_000, paidVnd: 100_000, unpaidVnd: 900_000 }],
  sourceSnapshot: { payments: [{ id: "payment-id", playerId, amountVnd: 100_000 }] },
};
function canonicalRoster(){return {eventId,finalTournamentId:'90000000-0000-4000-8000-000000000001',
  qualificationHash:read.qualification.sourceHash,sourceHash:'b'.repeat(32),releaseEnabled:true,
  players:[{participationId,playerId,name:'Canonical participant TEST',stack:20000,seedRevision:0,state:'UNSEATED',blocker:null,entryId:null,seatId:null,
    sourceBags:[{bagId:'90000000-0000-4000-8000-000000000002',bagVersion:1,sourceEntryId:'90000000-0000-4000-8000-000000000003',flightId:'90000000-0000-4000-8000-000000000004',stack:20000}]}],tables:[]};}
function finalizedLabelReads(labels:()=>Promise<{data:unknown;error:unknown}>){
  const fallback=h.rpc.getMockImplementation()!;
  h.rpc.mockImplementation(async(name:string)=>name==='multi_day_floor_read_v1'?{data:{...read,finalization:{...payout,requestId:'original',finalizedAt:'now'}},error:null}
    :name==='multi_day_payout_postfinal_state_v1'?{data:{eventId,revision:'e'.repeat(32),paidPlayerVnd:100000,unpaidObligationVnd:900000,unallocatedPoolVnd:6499600},error:null}
    :name==='multi_day_final_roster_v1'?labels():fallback(name));
}

beforeEach(() => {
  sessionStorage.clear();
  h.actor='actor';h.session=null;h.backend=null;
  h.rpc.mockReset();
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "multi_day_floor_read_v1" ? read
    : name === "multi_day_qualification_preview_v1" ? qualification
      : name === "multi_day_payout_preview_v1" ? payout : { ok: true }, error: null }));
  vi.stubGlobal("crypto", { randomUUID: () => "10000000-0000-4000-8000-000000000001" });
});
afterEach(cleanup);

describe("verified Multi-day Floor panel", () => {
  it('exposes the individual Floor rank and obligation flow on the payout surface',async()=>{
    h.backend='http://127.0.0.1:54329';render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    expect(await screen.findByRole('heading',{name:'Hạng và nghĩa vụ cá nhân Main Event'})).toBeInTheDocument();
    await waitFor(()=>expect(screen.getByRole('button',{name:'Đọc lại hạng cá nhân'})).toBeEnabled());
    expect(h.rpc.mock.calls.some(([name])=>name==='confirm_multi_day_individual_ranks_v1'||name==='confirm_multi_day_individual_obligation_v1')).toBe(false);
  });
  it('holds whole-event writes while an individual result request is corrupt or unknown',async()=>{
    h.backend='http://127.0.0.1:54329';
    const key=`vinpoker:multiday-individual-results:v1:actor:${eventId}`;sessionStorage.setItem(key,'corrupt-retained-request');
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    await waitFor(()=>expect(screen.getByRole('button',{name:'Finalize obligations'})).toBeDisabled());
    expect(sessionStorage.getItem(key)).toBe('corrupt-retained-request');
  });
  it('holds event writes for an unverifiable retained configuration request after reload',async()=>{
    h.backend='http://127.0.0.1:54329';
    sessionStorage.setItem(`vinpoker:multiday-prize-configuration:v1:actor:${eventId}`,'corrupt-retained-request');
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    expect(await screen.findByText(/Payout configuration request is pending or unverified/)).toBeInTheDocument();
    await waitFor(()=>expect(screen.getByRole('button',{name:'Finalize obligations'})).toBeDisabled());
    expect(h.rpc.mock.calls.some(([name])=>name==='multi_day_finalize_payout_v1'||name==='multi_day_save_prize_configuration_v1')).toBe(false);
    expect(sessionStorage.getItem(`vinpoker:multiday-prize-configuration:v1:actor:${eventId}`)).toBe('corrupt-retained-request');
  });
  it('shows the server rank, canonical name and obligation before finalization without writing money',async()=>{
    const fallback=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async(name:string)=>name==='multi_day_final_roster_v1'
      ?{data:canonicalRoster(),error:null}:name==='multi_day_payout_preview_v1'
        ?{data:{...payout,obligations:[{...payout.obligations[0],rank:3}]},error:null}:fallback(name));
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    const table=await screen.findByRole('table',{name:'Final Day player payouts'});
    const row=await within(table).findByRole('row',{name:/Canonical participant TEST/});
    expect(within(row).getByText('#3')).toBeInTheDocument();
    expect(within(row).getByText('1,000,000 VND')).toBeInTheDocument();
    expect(row).toHaveTextContent('Paid 100,000 VND');
    expect(row).toHaveTextContent('Unpaid 900,000 VND');
    expect(h.rpc.mock.calls.some(([name])=>/^multi_day_(finalize|request|approve)|record_.*payment/.test(String(name)))).toBe(false);
  });

  it.each([0,-1,1.5,'3'])('rejects an invalid server payout rank %s instead of showing an invented place',async rank=>{
    const fallback=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async(name:string)=>name==='multi_day_payout_preview_v1'
      ?{data:{...payout,obligations:[{...payout.obligations[0],rank}]},error:null}:fallback(name));
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('unverified');
    expect(screen.queryByRole('table',{name:'Final Day player payouts'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Finalize obligations'})).not.toBeInTheDocument();
  });

  it('explains a missing rank payout table without presenting a ready or zero payout',async()=>{
    const fallback=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async(name:string)=>name==='multi_day_payout_preview_v1'
      ?{data:null,error:{message:'Command failed: local adapter ERROR: multi_day_payout_rank_amount_missing'}}:fallback(name));
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Final Day prize amounts are missing');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Command failed');
    expect(screen.queryByRole('button',{name:'Finalize obligations'})).not.toBeInTheDocument();
    expect(h.rpc.mock.calls.some(([name])=>name==='multi_day_finalize_payout_v1')).toBe(false);
    expect(screen.getByRole('button',{name:'Xem trước mức sàn Main Event'})).toBeEnabled();
  });

  it('exposes End Flight before bagging for an unended flight',async()=>{
    h.rpc.mockImplementation(async(name:string)=>({data:name==='multi_day_floor_read_v1'?{...read,qualification:null}
      :name==='multi_day_qualification_preview_v1'?{...qualification,state:'PLANNED',flights:[{...qualification.flights[0],flightId:'40000000-0000-4000-8000-000000000001',status:null,dayStatus:null}]}:payout,error:null}));
    render(<MultiDayFloorEventPanel eventId={eventId}/>);
    expect(await screen.findByRole('button',{name:'End Flight'})).toBeEnabled();
    expect(h.rpc.mock.calls.some(([name])=>name==='multi_day_end_flight_v1')).toBe(false);
  });
  it('disables a second flight while the first End Flight outcome is unknown',async()=>{
    const flights=['40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002'];
    h.rpc.mockImplementation(async(name:string)=>({data:name==='multi_day_floor_read_v1'?{...read,qualification:null}
      :name==='multi_day_qualification_preview_v1'?{...qualification,state:'PLANNED',flights:flights.map(flightId=>({...qualification.flights[0],flightId,status:null,dayStatus:null}))}:null,error:null}));
    render(<MultiDayFloorEventPanel eventId={eventId}/>);
    const first=within(await screen.findByRole('region',{name:`End Flight ${flights[0]}`}));
    fireEvent.change(first.getByLabelText('Day number'),{target:{value:'1'}});
    fireEvent.click(first.getByRole('button',{name:'End Flight'}));fireEvent.click(screen.getByRole('button',{name:'Confirm End Flight'}));
    await first.findByRole('alert');
    expect(within(screen.getByRole('region',{name:`End Flight ${flights[1]}`})).getByRole('button',{name:'End Flight'})).toBeDisabled();
  });
  it('labels the obligation from canonical participation evidence without changing its option value',async()=>{
    finalizedLabelReads(async()=>({data:canonicalRoster(),error:null}));
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    const option=await screen.findByRole('option',{name:/Canonical participant TEST/});
    expect(option).toHaveValue(participationId);
    expect(h.rpc.mock.calls.filter(([name])=>/^multi_day_(request|approve|finalize|set|lock)/.test(String(name)))).toHaveLength(0);
  });
  it.each(['wrong-event','wrong-qualification','wrong-player','duplicate','missing-name','unavailable'] as const)('does not mislabel an obligation for %s',async kind=>{
    const roster=canonicalRoster();
    if(kind==='wrong-event')roster.eventId='30000000-0000-0000-0000-00000000000b';
    if(kind==='wrong-qualification')roster.qualificationHash='f'.repeat(32);
    if(kind==='wrong-player')roster.players[0].playerId='60000000-0000-0000-0000-000000000022';
    if(kind==='duplicate')roster.players.push({...roster.players[0]});
    if(kind==='missing-name'){roster.players[0].name=null;roster.players[0].state='BLOCKED';roster.players[0].blocker='display_evidence_missing';}
    finalizedLabelReads(async()=>({data:roster,error:kind==='unavailable'?{message:'unavailable'}:null}));
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    await screen.findByText(/Participant names are unavailable/);
    const option=screen.getByRole('option',{name:`${playerId} · 1,000,000 VND`});expect(option).toHaveValue(participationId);
    expect(screen.queryByRole('option',{name:/Canonical participant TEST/})).toBeNull();
  });
  it('does not let a retired label read replace a newer same-event refresh',async()=>{
    let finish!:(value:{data:unknown;error:null})=>void,calls=0;
    finalizedLabelReads(()=>++calls===1?new Promise(resolve=>{finish=resolve;}):Promise.resolve({data:{...canonicalRoster(),players:[{...canonicalRoster().players[0],name:'Current participant TEST'}]},error:null}));
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    await screen.findByLabelText('Original obligation');
    fireEvent.click(screen.getByRole('button',{name:'Refresh source'}));
    await screen.findByRole('option',{name:/Current participant TEST/});
    await act(async()=>{finish({data:canonicalRoster(),error:null});});
    expect(screen.queryByRole('option',{name:/Canonical participant TEST/})).toBeNull();
    expect(screen.getByRole('option',{name:/Current participant TEST/})).toHaveValue(participationId);
  });
  it('keeps the selected participation when its verified display name arrives',async()=>{
    let finish!:(value:{data:unknown;error:null})=>void;
    finalizedLabelReads(()=>new Promise(resolve=>{finish=resolve;}));
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    const select=await screen.findByLabelText('Original obligation');fireEvent.change(select,{target:{value:participationId}});
    await act(async()=>{finish({data:canonicalRoster(),error:null});});
    expect(select).toHaveValue(participationId);expect(screen.getByRole('option',{name:/Canonical participant TEST/})).toHaveValue(participationId);
    expect(h.rpc.mock.calls.some(([name])=>name==='multi_day_request_payout_correction_v1')).toBe(false);
  });
  it('selects post-final payment records without rewriting or depending on the frozen payment snapshot',async()=>{
    const id='17d3392c-edb4-4e37-b16f-04e3c19d858a';
    h.rpc.mockImplementation(async(name:string)=>({data:name==='multi_day_floor_read_v1'
      ?{...read,finalization:{...payout,sourceSnapshot:{payments:[]},requestId:'original',finalizedAt:'now'}}
      :name==='multi_day_qualification_preview_v1'?qualification
      :{eventId,revision:'e'.repeat(32),paidPlayerVnd:200000,unpaidObligationVnd:800000,unallocatedPoolVnd:0,
        reversiblePayments:[{id,playerId,participationId,amountVnd:200000}]},error:null}));
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    fireEvent.change(await screen.findByLabelText('Correction type'),{target:{value:'PAYMENT_REVERSAL'}});
    fireEvent.change(screen.getByLabelText('Original obligation'),{target:{value:participationId}});
    const select=screen.getByLabelText('Original paid record');
    expect(select.querySelector(`option[value="${id}"]`)).not.toBeNull();
    fireEvent.change(select,{target:{value:id}});
    expect(screen.getByLabelText('Signed delta (VND; reversal is negative)')).toHaveValue(-200000);
    fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Correct TEST wrong payment'}});
    fireEvent.change(screen.getByLabelText('Evidence reference'),{target:{value:'local-test-evidence'}});
    expect(screen.getByRole('button',{name:'Request correction'})).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('Signed delta (VND; reversal is negative)'),{target:{value:'-100000'}});
    expect(screen.getByRole('button',{name:'Request correction'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Original obligation'),{target:{value:''}});
    expect(select).toHaveValue('');
    expect(select.querySelector(`option[value="${id}"]`)).toBeNull();
  });
  it('does not fall back to frozen payments when the current picker contract is missing',async()=>{
    h.rpc.mockImplementation(async(name:string)=>({data:name==='multi_day_floor_read_v1'
      ?{...read,finalization:{...payout,requestId:'original',finalizedAt:'now'}}
      :name==='multi_day_qualification_preview_v1'?qualification
      :{eventId,revision:'e'.repeat(32),paidPlayerVnd:100000,unpaidObligationVnd:900000,unallocatedPoolVnd:0},error:null}));
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    fireEvent.change(await screen.findByLabelText('Correction type'),{target:{value:'PAYMENT_REVERSAL'}});
    fireEvent.change(screen.getByLabelText('Original obligation'),{target:{value:participationId}});
    expect(screen.getByText(/Current paid records are unavailable/)).toBeInTheDocument();
    expect(screen.getByLabelText('Original paid record').querySelector('option[value="payment-id"]')).toBeNull();
    expect(screen.getByRole('button',{name:'Request correction'})).toBeDisabled();
  });
  it('distinguishes the immutable finalization snapshot from current corrected accounting',async()=>{
    h.rpc.mockImplementation(async(name:string)=>({data:name==='multi_day_floor_read_v1'
      ?{...read,finalization:{...payout,requestId:'original',finalizedAt:'now'}}
      :name==='multi_day_qualification_preview_v1'?qualification
      :{eventId,revision:'e'.repeat(32),paidPlayerVnd:100000,unpaidObligationVnd:899999,unallocatedPoolVnd:6499601},error:null}));
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    await screen.findByText('Original finalized snapshot (immutable)');
    expect(screen.getByText('Original unpaid obligations: 900,000 VND')).toBeTruthy();
    expect(screen.getByText(/Current accounting after payments and corrections/)).toHaveTextContent('899,999 VND');
    expect(screen.queryByText('Unpaid obligations: 900,000 VND',{exact:true})).toBeNull();
  });
  it('does not turn a blank minimum-cash input into an intentional zero',async()=>{
    h.rpc.mockResolvedValue({data:{...read,rules:null,qualification:null},error:null});
    render(<MultiDayFloorEventPanel eventId={eventId}/>);
    const input=await screen.findByLabelText('Minimum cash multiplier');
    fireEvent.change(screen.getByLabelText('Day2 % per flight'),{target:{value:'20'}});
    fireEvent.change(input,{target:{value:''}});
    expect(screen.getByRole('button',{name:'Lock rules'})).toBeDisabled();
    fireEvent.change(input,{target:{value:'0'}});
    expect(screen.getByRole('button',{name:'Lock rules'})).not.toBeDisabled();
  });
  it('retains frozen rules after response loss when reload now shows locked rules',async()=>{
    let locked=false,attempts=0;
    h.rpc.mockImplementation(async(name:string)=>{
      if(name==='multi_day_floor_read_v1')return {data:locked?read:{...read,rules:null,qualification:null},error:null};
      if(name==='multi_day_set_qualification_rules_v2'){
        locked=true;return ++attempts===1?{data:null,error:{message:'lost after commit'}}:{data:{ok:true,idempotent:true,itmPercent:10,day2Percent:20},error:null};
      }
      return {data:name==='multi_day_qualification_preview_v1'?qualification:payout,error:null};
    });
    const view=render(<MultiDayFloorEventPanel eventId={eventId}/>);
    fireEvent.change(await screen.findByLabelText('Bag selection policy'),{target:{value:'SUM_STACKS'}});
    fireEvent.change(screen.getByLabelText('Minimum cash multiplier'),{target:{value:'1.5'}});
    fireEvent.change(screen.getByLabelText('Day2 % per flight'),{target:{value:'20'}});
    fireEvent.click(screen.getByRole('button',{name:'Lock rules'}));await screen.findByRole('alert');
    view.unmount();render(<MultiDayFloorEventPanel eventId={eventId}/>);
    const retry=await screen.findByRole('button',{name:'Retry retained rules request'});
    await waitFor(()=>expect(retry).not.toBeDisabled());fireEvent.click(retry);
    await screen.findByText('Rules saved and frozen.');
    const calls=h.rpc.mock.calls.filter(([n])=>n==='multi_day_set_qualification_rules_v2');
    expect(calls).toHaveLength(2);expect(calls[1][1]).toEqual(calls[0][1]);expect(sessionStorage.length).toBe(0);
  });
  it('recovers correction payload and original revision after response loss and reload',async()=>{
    let reload=false,attempts=0;
    h.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
      if(name==='multi_day_floor_read_v1')return {data:{...read,finalization:{...payout,requestId:'original',finalizedAt:'now'}},error:null};
      if(name==='multi_day_qualification_preview_v1')return {data:qualification,error:null};
      if(name==='multi_day_payout_postfinal_state_v1')return {data:{eventId,revision:(reload?'f':'e').repeat(32),paidPlayerVnd:0,unpaidObligationVnd:100,unallocatedPoolVnd:0},error:null};
      if(name==='multi_day_request_payout_correction_v1')return ++attempts===1?{data:null,error:{message:'lost after commit'}}:
        {data:{ok:true,idempotent:true,requestId:args.p_request_id,state:'PENDING_APPROVAL'},error:null};
      return {data:payout,error:null};
    });
    const view=render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    fireEvent.change(await screen.findByLabelText('Original obligation'),{target:{value:participationId}});
    fireEvent.change(screen.getByLabelText('Signed delta (VND; reversal is negative)'),{target:{value:'-1'}});
    fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Correct TEST entitlement'}});
    fireEvent.change(screen.getByLabelText('Evidence reference'),{target:{value:'local-evidence-only'}});
    fireEvent.click(screen.getByRole('button',{name:'Request correction'}));await screen.findByRole('alert');
    view.unmount();reload=true;render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    const retry=await screen.findByRole('button',{name:'Retry retained correction request'});
    await waitFor(()=>expect(retry).not.toBeDisabled());fireEvent.click(retry);
    await screen.findByText('Correction requested. Owner approval is still required.');
    const calls=h.rpc.mock.calls.filter(([n])=>n==='multi_day_request_payout_correction_v1');
    expect(calls).toHaveLength(2);expect(calls[1][1]).toEqual(calls[0][1]);expect(calls[1][1].p_expected_revision).toBe('e'.repeat(32));
    expect(sessionStorage.length).toBe(0);
  });
  it('retains approval through reload when the server now lists it as approved',async()=>{
    const request='80000000-0000-4000-8000-000000000002';let reload=false,attempts=0;
    h.rpc.mockImplementation(async(name:string)=>{
      if(name==='multi_day_floor_read_v1')return {data:{...read,finalization:{...payout,requestId:'original',finalizedAt:'now'},
        correctionRequests:[{requestId:request,kind:'OBLIGATION_DELTA',deltaVnd:1,reason:'Correct TEST entitlement',state:reload?'APPROVED':'PENDING_APPROVAL'}]},error:null};
      if(name==='multi_day_qualification_preview_v1')return {data:qualification,error:null};
      if(name==='multi_day_payout_postfinal_state_v1')return {data:{eventId,revision:'e'.repeat(32),paidPlayerVnd:0,unpaidObligationVnd:100,unallocatedPoolVnd:0},error:null};
      if(name==='multi_day_approve_payout_correction_v1')return ++attempts===1?{data:null,error:{message:'lost after commit'}}:
        {data:{ok:true,idempotent:true,correctionId:request,revision:'f'.repeat(32)},error:null};
      return {data:payout,error:null};
    });
    const view=render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Approve'}));await screen.findByRole('alert');
    view.unmount();reload=true;render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    const retry=await screen.findByRole('button',{name:'Retry retained approval request'});
    await waitFor(()=>expect(retry).not.toBeDisabled());fireEvent.click(retry);
    await screen.findByText('Correction approved and reconciled; no payment executed.');
    const calls=h.rpc.mock.calls.filter(([n])=>n==='multi_day_approve_payout_correction_v1');
    expect(calls).toHaveLength(2);expect(calls[1][1]).toEqual(calls[0][1]);expect(sessionStorage.length).toBe(0);
  });
  it('recovers the original bag selection after reload even when qualification is already locked',async()=>{
    const bagId='80000000-0000-4000-8000-000000000001';let reload=false,attempts=0;
    const ready={...qualification,state:'READY',flights:[{...qualification.flights[0],validEntries:1,itmTarget:1,day2Target:1,eligibleBags:[{bagId,playerId,stack:20000,version:1}]}]};
    h.rpc.mockImplementation(async(name:string)=>{
      if(name==='multi_day_floor_read_v1')return {data:reload?read:{...read,qualification:null},error:null};
      if(name==='multi_day_qualification_preview_v1')return {data:reload?{...ready,state:'LOCKED',sourceHash:'e'.repeat(32)}:ready,error:null};
      if(name==='multi_day_lock_qualification_v1')return ++attempts===1?{data:null,error:{message:'response lost'}}:{data:{ok:true,idempotent:true,eventId,
        sourceHash:qualification.sourceHash,finalTournamentId:'70000000-0000-4000-8000-000000000001',selectionHash:'c'.repeat(32),participationCount:1,
        policy:'SUM_STACKS',fundingState:'NOT_VERIFIED',seatingState:'HELD',payoutFinalization:'HELD'},error:null};
      return {data:payout,error:null};
    });
    const view=render(<MultiDayFloorEventPanel eventId={eventId}/>);
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button',{name:'Lock qualification (1/1)'}));await screen.findByRole('alert');
    view.unmount();reload=true;const recoveredView=render(<MultiDayFloorEventPanel eventId={eventId}/>);
    const retry=await screen.findByRole('button',{name:'Retry retained qualification request'});
    await waitFor(()=>expect(retry).not.toBeDisabled());
    recoveredView.rerender(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    expect(screen.getByRole('button',{name:'Finalize obligations'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Retry retained qualification request'}));
    await screen.findByText('Qualification locked from sealed bags.');
    const calls=h.rpc.mock.calls.filter(([name])=>name==='multi_day_lock_qualification_v1');expect(calls).toHaveLength(2);
    expect(calls[1][1]).toEqual(calls[0][1]);expect(calls[1][1].p_bag_ids).toEqual([bagId]);expect(sessionStorage.length).toBe(0);
  });
  it('keeps an already unknown request after a retry rejection',async()=>{
    let attempts=0;
    h.rpc.mockImplementation(async(name:string)=>name==='multi_day_finalize_payout_v1'
      ?{data:null,error:++attempts===1?{message:'Failed to fetch'}:{code:'40001',message:'multi_day_payout_recalculate'}}
      :{data:name==='multi_day_floor_read_v1'?read:name==='multi_day_qualification_preview_v1'?qualification:payout,error:null});
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Finalize obligations'}));await screen.findByRole('alert');
    const retained=sessionStorage.getItem(finalizationJournalKey('actor',eventId));expect(retained).not.toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Retry retained finalization request'}));
    await waitFor(()=>expect(attempts).toBe(2));
    expect(sessionStorage.getItem(finalizationJournalKey('actor',eventId))).toBe(retained);
    expect(screen.getByRole('button',{name:'Finalize obligations'})).toBeDisabled();
  });
  it('allows a fresh preview after a definitive rejection of the first send, not an unknown response',async()=>{
    h.rpc.mockImplementation(async(name:string)=>name==='multi_day_finalize_payout_v1'
      ?{data:null,error:{code:'40001',message:'multi_day_payout_recalculate'}}
      :{data:name==='multi_day_floor_read_v1'?read:name==='multi_day_qualification_preview_v1'?qualification:payout,error:null});
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Finalize obligations'}));await screen.findByRole('alert');
    expect(sessionStorage.length).toBe(0);expect(screen.queryByRole('button',{name:'Retry retained finalization request'})).toBeNull();
    expect(screen.queryByRole('button',{name:'Finalize obligations'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Refresh source'}));
    expect(await screen.findByRole('button',{name:'Finalize obligations'})).not.toBeDisabled();
  });
  it('holds new writes when a retained journal is malformed',async()=>{
    sessionStorage.setItem(finalizationJournalKey('actor',eventId),'bad-json');
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    await screen.findByText(/Cannot verify retained finalization request/);
    expect(await screen.findByRole('button',{name:'Finalize obligations'})).toBeDisabled();
    expect(h.rpc.mock.calls.some(([name])=>name==='multi_day_finalize_payout_v1')).toBe(false);
  });
  it('recovers the frozen finalization request after reload instead of using new preview revisions',async()=>{
    let reload=false,attempts=0;
    h.rpc.mockImplementation(async(name:string)=>{
      if(name==='multi_day_floor_read_v1')return {data:read,error:null};
      if(name==='multi_day_qualification_preview_v1')return {data:qualification,error:null};
      if(name==='multi_day_payout_preview_v1')return {data:reload?{...payout,payoutInputHash:'e'.repeat(32)}:payout,error:null};
      if(name==='multi_day_final_roster_v1')return {data:canonicalRoster(),error:null};
      attempts++;return attempts===1?{data:null,error:{message:'response lost'}}:{data:{ok:true,idempotent:true,state:'FINALIZED_OBLIGATIONS',eventId,
        rulesVersion:payout.rulesVersion,fundingRevision:payout.fundingRevision,qualificationRevision:payout.qualificationRevision,
        payoutInputHash:payout.payoutInputHash,paymentExecution:'NOT_PERFORMED'},error:null};
    });
    const view=render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Finalize obligations'}));await screen.findByRole('alert');
    view.unmount();reload=true;
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    const retry=await screen.findByRole('button',{name:'Retry retained finalization request'});
    await waitFor(()=>expect(retry).not.toBeDisabled());fireEvent.click(retry);
    await screen.findByText('Payout obligations finalized. No payment was executed.');
    const calls=h.rpc.mock.calls.filter(([name])=>name==='multi_day_finalize_payout_v1');
    expect(calls).toHaveLength(2);expect(calls[1][1]).toEqual(calls[0][1]);
    expect(sessionStorage.length).toBe(0);
  });
  it.each([{...read,releaseEnabled:'true'},{...read,eventItmPercent:null},{...read,eventId:'another-event'},{...read,capabilities:{...read.capabilities,canFinalizePayout:'yes'}}])('rejects an invalid authoritative event read (%j)',async invalid=>{
    h.rpc.mockImplementation(async(name:string)=>({data:name==='multi_day_floor_read_v1'?invalid:name==='multi_day_qualification_preview_v1'?qualification:payout,error:null}));
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    expect((await screen.findByRole('alert')).textContent).toContain('unverified');
    expect(screen.queryByRole('button',{name:'Finalize obligations'})).toBeNull();
    expect(screen.queryByText(/Package: Enabled/)).toBeNull();
  });
  it('does not enable finalization from a payout preview with a null financial total',async()=>{
    h.rpc.mockImplementation(async(name:string)=>({data:name==='multi_day_floor_read_v1'?read:name==='multi_day_qualification_preview_v1'?qualification:{...payout,directPoolVnd:null},error:null}));
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    expect((await screen.findByRole('alert')).textContent).toContain('unverified');
    expect(screen.queryByRole('button',{name:'Finalize obligations'})).toBeNull();
  });
  it('keeps unfinished results as a payout waiting state, not a technical error',async()=>{
    h.rpc.mockImplementation(async(name:string)=>name==='multi_day_payout_preview_v1'
      ?{data:null,error:{message:'multi_day_payout_results_not_ready'}}
      :{data:name==='multi_day_floor_read_v1'?read:qualification,error:null});
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    await screen.findByText('Payout preview is not ready. Finish results and reconcile funding, then refresh source.');
    await waitFor(()=>expect(h.rpc).toHaveBeenCalledWith('multi_day_payout_preview_v1',{p_event_id:eventId}));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button',{name:'Finalize obligations'})).toBeNull();
  });
  it('does not hide a real payout read failure behind the waiting state',async()=>{
    h.rpc.mockImplementation(async(name:string)=>name==='multi_day_payout_preview_v1'
      ?{data:null,error:{message:'Failed to fetch'}}
      :{data:name==='multi_day_floor_read_v1'?read:qualification,error:null});
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    expect((await screen.findByRole('alert')).textContent).toContain('Failed to fetch');
  });
  it('invalidates pending reads after actor change and hides event data on logout',async()=>{
    let finishOld!:(value:unknown)=>void;
    h.rpc.mockImplementation(async(name:string)=>{
      if(name==='multi_day_floor_read_v1'&&h.actor==='actor')return new Promise(resolve=>{finishOld=resolve;});
      return {data:name==='multi_day_floor_read_v1'?{...read,rules:null,qualification:null,eventItmPercent:25}:qualification,error:null};
    });
    const view=render(<MultiDayFloorEventPanel eventId={eventId}/>);
    h.actor='other';view.rerender(<MultiDayFloorEventPanel eventId={eventId}/>);
    await screen.findByText(/ITM: 25%/);
    await act(async()=>finishOld({data:read,error:null}));
    expect(screen.queryByText(/Policy: SUM_STACKS/)).toBeNull();
    h.actor=null;view.rerender(<MultiDayFloorEventPanel eventId={eventId}/>);
    expect(screen.queryByText(/ITM: 25%/)).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/Sign in/);
  });
  it('does not announce finalized obligations for an ok-only RPC response',async()=>{
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Finalize obligations'}));
    await screen.findByRole('alert');
    expect(screen.queryByText('Payout obligations finalized. No payment was executed.')).toBeNull();
  });
  it('does not restore the previous event after its delayed read completes',async()=>{
    let finishOld!:(value:unknown)=>void;
    const next='30000000-0000-0000-0000-00000000000b';
    h.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
      if(name==='multi_day_floor_read_v1')return args.p_event_id===eventId
        ?new Promise(resolve=>{finishOld=resolve;}):{data:{...read,eventId:next,rules:null,qualification:null,eventItmPercent:25},error:null};
      return {data:qualification,error:null};
    });
    const view=render(<MultiDayFloorEventPanel eventId={eventId}/>);
    view.rerender(<MultiDayFloorEventPanel eventId={next}/>);
    await screen.findByText(/ITM: 25%/);
    await act(async()=>finishOld({data:read,error:null}));
    expect(screen.queryByText(/Policy: SUM_STACKS/)).toBeNull();
    expect(screen.getByText(/ITM: 25%/)).toBeTruthy();
  });

  it('does not leave finalized actions usable after source refresh fails',async()=>{
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
    await screen.findByRole('button',{name:'Finalize obligations'});
    h.rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fireEvent.click(screen.getByRole('button',{name:'Refresh source'}));
    await screen.findByRole('alert');
    const finalize=screen.queryByRole('button',{name:'Finalize obligations'});
    expect(finalize===null||finalize.hasAttribute('disabled')).toBe(true);
  });
  it("locks server rules before entries and uses the policy/min-cash RPC", async () => {
    let configured = false;
    h.rpc.mockImplementation(async (name: string) => {
      if (name === "multi_day_floor_read_v1") return { data: configured ? read : { ...read, rules: null, qualification: null }, error: null };
      if (name === "multi_day_set_qualification_rules_v2") { configured = true; return { data: { ok: true,idempotent:false,itmPercent:10,day2Percent:20 }, error: null }; }
      return { data: qualification, error: null };
    });
    render(<MultiDayFloorEventPanel eventId={eventId} />);
    fireEvent.change(await screen.findByLabelText("Bag selection policy"), { target: { value: "SUM_STACKS" } });
    fireEvent.change(screen.getByLabelText("Minimum cash multiplier"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("Day2 % per flight"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Lock rules" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("multi_day_set_qualification_rules_v2", {
      p_event_id: eventId, p_policy: "SUM_STACKS", p_min_cash_x: 1.5, p_day2_percent: 20,
    }));
    await screen.findByText(/Rules locked before the first registration/);
  });

  it("shows server flight target, source categories, fees and revisions without treating shortfall as overlay", async () => {
    const { rerender } = render(<MultiDayFloorEventPanel eventId={eventId} />);
    await screen.findByText(/Flight flight-o/);
    expect(screen.getByText(/33 valid entries → ITM 4 · Day2 target 7/)).toBeTruthy();
    expect(screen.getByText(/ITM: 10% · Day2: 20% per flight/)).toBeTruthy();
    rerender(<MultiDayFloorEventPanel eventId={eventId} surface="payout" />);
    expect(screen.getByText(/Redeemed ticket transfers: 6,000,000 VND/)).toBeTruthy();
    expect(screen.getByText(/Fees \(outside pool\): 600,000 VND/)).toBeTruthy();
    expect(screen.getByText(/Recorded overlay: 500,000 VND/)).toBeTruthy();
    expect(screen.getByText(/Required shortfall \(not funded\): 0 VND/)).toBeTruthy();
    expect(screen.getByText(/Funding revision: b+/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finalize obligations" }).hasAttribute("disabled")).toBe(false);
    await screen.findByText(/Participant names are unavailable/);
  });

  it("holds Finalize for a required shortfall and exposes stale-source refresh", async () => {
    h.rpc.mockImplementation(async (name: string) => ({ data: name === "multi_day_floor_read_v1" ? read
      : name === "multi_day_qualification_preview_v1" ? qualification
        : name === "multi_day_payout_preview_v1" ? { ...payout, state: "REQUIRED_SHORTFALL", directPoolVnd:980400,transferPoolVnd:0,recordedOverlayVnd:0,unallocatedPoolVnd:0,requiredShortfallVnd: 20_000 } : null, error: null }));
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout" />);
    await screen.findByText(/Required shortfall \(not funded\): 20,000 VND/);
    expect(screen.getByRole("button", { name: "Finalize obligations" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows TD/Floor owner-only labels without exposing payout mutations", async () => {
    const floorRead = { ...read, capabilities: {
      canFinalizePayout: false, canRequestAdjustment: false, canApproveAdjustment: false,
    } };
    h.rpc.mockImplementation(async (name: string) => ({ data: name === "multi_day_floor_read_v1" ? floorRead
      : name === "multi_day_qualification_preview_v1" ? qualification
        : name === "multi_day_payout_preview_v1" ? payout : null, error: null }));
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout" />);
    await screen.findByText(/Owner-only Finalize obligations/);
    expect(screen.queryByRole("button", { name: "Finalize obligations" })).toBeNull();
    expect(h.rpc).not.toHaveBeenCalledWith("multi_day_finalize_payout_v1", expect.anything());
    cleanup();
    h.rpc.mockImplementation(async (name: string) => ({ data: name === "multi_day_floor_read_v1"
      ? { ...floorRead, finalization: { ...payout, requestId: "original", finalizedAt: "now" },
        correctionRequests: [{ requestId: "pending", kind: "OBLIGATION_DELTA", deltaVnd: 1, reason: "Review", state: "PENDING_APPROVAL" }] }
      : name === "multi_day_qualification_preview_v1" ? qualification
        : { eventId,revision: "e".repeat(32), paidPlayerVnd: 0, unpaidObligationVnd: 1, unallocatedPoolVnd: 0 }, error: null }));
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout" />);
    await screen.findByText(/Owner-only Approve/);
    expect(screen.getByText(/Owner-only correction request/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Request correction" })).toBeNull();
  });

  it("retries Finalize with the same request id after an uncertain error", async () => {
    let attempts = 0;
    h.rpc.mockImplementation(async (name: string) => {
      if (name === "multi_day_floor_read_v1") return { data: read, error: null };
      if (name === "multi_day_qualification_preview_v1") return { data: qualification, error: null };
      if (name === "multi_day_payout_preview_v1") return { data: payout, error: null };
      if (name === "multi_day_finalize_payout_v1") {
        attempts += 1;
        return attempts === 1 ? { data: null, error: { message: "network unavailable" } }
          : { data: { ok: true,state:'FINALIZED_OBLIGATIONS',eventId,
            rulesVersion:payout.rulesVersion,fundingRevision:payout.fundingRevision,
            qualificationRevision:payout.qualificationRevision,payoutInputHash:payout.payoutInputHash,
            paymentExecution:'NOT_PERFORMED',idempotent:false }, error: null };
      }
      return { data: null, error: null };
    });
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout" />);
    fireEvent.click(await screen.findByRole("button", { name: "Finalize obligations" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry retained finalization request" }));
    await waitFor(() => expect(h.rpc.mock.calls.filter(([name]) => name === "multi_day_finalize_payout_v1")).toHaveLength(2));
    const calls = h.rpc.mock.calls.filter(([name]) => name === "multi_day_finalize_payout_v1");
    expect(calls[0][1].p_request_id).toBe(calls[1][1].p_request_id);
  });

  it("shows approved corrections as read-only and reports club denial", async () => {
    h.rpc.mockImplementation(async (name: string) => name === "multi_day_floor_read_v1"
      ? { data: { ...read, finalization: { ...payout, requestId: "original", finalizedAt: "now" },
        correctionRequests: [{ requestId: "correction", kind: "OBLIGATION_DELTA", deltaVnd: -1, reason: "Correct entitlement", state: "APPROVED" }] }, error: null }
      : name === "multi_day_qualification_preview_v1" ? { data: qualification, error: null }
        : name === "multi_day_payout_preview_v1" ? { data: payout, error: null }
          : { data: { eventId,revision: "e".repeat(32), paidPlayerVnd: 100_000, unpaidObligationVnd: 900_000, unallocatedPoolVnd: 6_499_600 }, error: null });
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout" />);
    await screen.findByText(/Correct entitlement/);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    cleanup();
    h.rpc.mockResolvedValue({ data: null, error: { message: "multi_day_floor_actor_denied", code: "42501" } });
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout" />);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toMatch(/TD\/Floor or owner access denied/);
    cleanup();
    h.rpc.mockResolvedValue({ data: null, error: { message: "multi_day_package_release_off", code: "42501" } });
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout" />);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toMatch(/package is off for this club/);
  });
});

it('holds finalization when the server payout summary disagrees with its obligation rows',async()=>{
 const fallback=h.rpc.getMockImplementation()!;h.rpc.mockImplementation((name:string,...args:unknown[])=>name==='multi_day_payout_preview_v1'?Promise.resolve({data:{...payout,unpaidObligationVnd:payout.unpaidObligationVnd+1},error:null}):fallback(name,...args));
 render(<MultiDayFloorEventPanel eventId={eventId} surface="payout"/>);
 await screen.findByRole('alert');expect(screen.getByRole('alert')).toHaveTextContent('unverified');expect(screen.queryByRole('button',{name:'Finalize obligations'})).toBeNull();
 expect(h.rpc.mock.calls.some(([name])=>name==='multi_day_finalize_payout_v1')).toBe(false);
});


it.each([true,false])('keeps locked-flight table release available after qualification only with package enabled=%s',async releaseEnabled=>{
  const flightId='40000000-0000-4000-8000-000000000001';
  h.actor='675fe35e-60a8-4452-bb90-e79486d54da6';
  const context={flightId,eventId,releaseEnabled,state:'locked',rosterHash:'a'.repeat(32),dayVersion:1,
    tables:[{tournamentTableId:'40000000-0000-4000-8000-000000000002',tableSessionId:'40000000-0000-4000-8000-000000000003',
      revision:2,name:'Qualified flight table TEST',playerCount:1,baggedTotal:20000,state:'open'}]};
  h.rpc.mockImplementation(async(name:string)=>({error:null,data:name==='multi_day_floor_read_v1'?{...read,releaseEnabled}
    :name==='multi_day_qualification_preview_v1'?{...qualification,flights:[{...qualification.flights[0],flightId}]}
    :name==='get_bagged_flight_tables_v1'?context:name==='multi_day_payout_preview_v1'?payout:{ok:true}}));
  render(<MultiDayFloorEventPanel eventId={eventId}/>);
  const release=await screen.findByRole('button',{name:i18n.t('baggedFlightRelease.release')});
  expect(screen.queryByRole('button',{name:'End Flight'})).not.toBeInTheDocument();
  if(releaseEnabled){expect(release).toBeEnabled();fireEvent.click(release);expect(screen.getByRole('alertdialog')).toHaveTextContent('Qualified flight table TEST');}
  else expect(release).toBeDisabled();
  expect(h.rpc.mock.calls.some(([name])=>name==='release_bagged_flight_table_v1'||name==='multi_day_end_flight_v1')).toBe(false);
});
