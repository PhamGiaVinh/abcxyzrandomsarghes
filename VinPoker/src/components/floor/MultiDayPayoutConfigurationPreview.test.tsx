import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({client:{rpc:vi.fn()}}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>h.client}));
import {MultiDayPayoutConfigurationPreview} from './MultiDayPayoutConfigurationPreview';
const eventId='30000000-0000-4000-8000-000000000001',hash='a'.repeat(32);
const uuid=(n:number)=>`90000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const players=Array.from({length:3},(_,i)=>({participationId:uuid(i+1),playerId:uuid(i+11),name:`Canonical TEST player ${i+1}`,
 stack:20000,seedRevision:0,state:'UNSEATED',blocker:null,entryId:null,seatId:null,
 sourceBags:[{bagId:uuid(i+21),bagVersion:1,sourceEntryId:uuid(i+31),flightId:uuid(41),stack:20000}]}));
const props={eventId,qualificationHash:hash,rankedPlaces:2,buyInVnd:100000};
function response(args:{p_event_id:string;p_proposed_rows:Array<{position:number;amount:number}>}){
 const obligations=players.map((p,i)=>{
  const award=args.p_proposed_rows.find(r=>r.position===i+1)?.amount??0;
  const extra=i===0?10000:0,total=Math.max(award,100000)+extra;
  return {playerId:p.playerId,participationId:p.participationId,rank:i+1,rankAwardVnd:award,
   participationFloorVnd:100000,nonselectedBagMinCashVnd:extra,totalVnd:total,paidVnd:0,unpaidVnd:total};
 });
 const total=obligations.reduce((n,row)=>n+row.totalVnd,0);
 return {eventId:args.p_event_id,state:total>250000?'REQUIRED_SHORTFALL':'READY',rulesVersion:hash,fundingRevision:hash,
  qualificationRevision:hash,payoutInputHash:hash,configurationRevision:hash,directPoolVnd:250000,transferPoolVnd:0,feesVnd:0,recordedOverlayVnd:0,
  requiredShortfallVnd:Math.max(total-250000,0),paidPlayerVnd:0,unpaidObligationVnd:total,clubRetainedTieVnd:0,
  unallocatedPoolVnd:Math.max(250000-total,0),obligations,sourceSnapshot:{},previewOnly:true,
  configurationPersistence:'NOT_PERFORMED',paymentExecution:'NOT_PERFORMED',itmPlaces:2};
}
beforeEach(()=>{h.client.rpc.mockReset().mockImplementation(async(name,args)=>({data:name==='multi_day_final_roster_v1'
 ?{eventId:args.p_event_id,finalTournamentId:uuid(50),qualificationHash:hash,sourceHash:hash,releaseEnabled:true,players,tables:[]}
 :response(args),error:null}));});
afterEach(cleanup);
function liveResponse(args:{p_event_id:string;p_proposed_rows:Array<{position:number;amount:number}>}){
 const prizePositions=args.p_proposed_rows.map(row=>({position:row.position,amountVnd:row.amount}));
 const required=prizePositions.reduce((sum,row)=>sum+Math.max(row.amountVnd,100000),0)+110000;
 return {eventId:args.p_event_id,finalTournamentId:uuid(50),state:'LIVE_PRIZE_CONFIGURATION_PROPOSAL',planningOnly:true,
  rulesVersion:hash,fundingRevision:hash,qualificationRevision:hash,payoutInputHash:hash,configurationRevision:hash,
  previewOnly:true,configurationPersistence:'NOT_PERFORMED',paymentExecution:'NOT_PERFORMED',
  directPoolVnd:250000,transferPoolVnd:0,feesVnd:0,recordedOverlayVnd:0,requiredShortfallVnd:Math.max(required-250000,0),itmPlaces:2,
  prizePositions,planningBudget:{eventId:args.p_event_id,field:3,eventFloorVnd:100000,fundedVnd:250000,
   requiredTotalVnd:required,requiredShortfallVnd:Math.max(required-250000,0),
   nonselectedMinCash:[{id:uuid(70),participationId:players[0].participationId,amountVnd:10000}]}};
}
it('shows live planned prizes without inventing ranked recipients, preserving the server floor and bag reserve',async()=>{
 h.client.rpc.mockImplementation(async(_name,args)=>({data:liveResponse(args),error:null}));
 render(<MultiDayPayoutConfigurationPreview {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'Xem trước mức sàn Main Event'}));
 await screen.findByRole('table',{name:'Bảng thưởng dự kiến trước khi chốt hạng'});
 expect(screen.getByLabelText(/Quỹ dự kiến riêng/)).toHaveValue(140000);
 expect(screen.queryByRole('table',{name:'Người nhận trong đề xuất chưa lưu'})).not.toBeInTheDocument();
 expect(screen.queryByText(players[0].name)).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText(/Quỹ dự kiến riêng/),{target:{value:'400000'}});
 fireEvent.click(screen.getByRole('button',{name:'Xem trước mẫu payout'}));
 await waitFor(()=>expect(screen.getByRole('table')).toHaveTextContent('300.000đ'));
 expect(screen.getAllByRole('status').some(node=>node.textContent?.includes('thiếu quỹ 260.000đ'))).toBe(true);
 expect(h.client.rpc.mock.calls.map(([name])=>name)).toEqual(['multi_day_payout_configuration_preview_v1','multi_day_payout_configuration_preview_v1']);
});
it('rejects a live proposal whose funding summary omits a participation floor or separate bag cash',async()=>{
 h.client.rpc.mockImplementation(async(_name,args)=>{const data=liveResponse(args);return {data:{...data,
  planningBudget:{...data.planningBudget,requiredTotalVnd:300000,requiredShortfallVnd:50000},requiredShortfallVnd:50000},error:null};});
 render(<MultiDayPayoutConfigurationPreview {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'Xem trước mức sàn Main Event'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('unverified');
 expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
it('reads only after an explicit click, showing exact names, floors and unfunded proposal without a write action',async()=>{
 render(<MultiDayPayoutConfigurationPreview {...props}/>);
 expect(h.client.rpc).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Xem trước mức sàn Main Event'}));
 const table=await screen.findByRole('table',{name:'Người nhận trong đề xuất chưa lưu'});
 expect(await within(table).findByText(players[0].name)).toBeInTheDocument();
 expect(screen.getByLabelText(/Quỹ dự kiến riêng/)).toHaveValue(140000);
 expect(h.client.rpc.mock.calls[0]).toEqual(['multi_day_payout_configuration_preview_v1',{p_event_id:eventId,p_proposed_rows:[{position:1,amount:0},{position:2,amount:0}]}]);
 expect(h.client.rpc.mock.calls.map(([name])=>name)).toEqual(['multi_day_payout_configuration_preview_v1','multi_day_final_roster_v1']);
 expect(screen.queryByRole('button',{name:/Finalize|Ghi nhận|Lưu bảng/})).not.toBeInTheDocument();
});
it.each(['DAILY','INTL','MULTI','TRITON'])('previews %s without silently reducing the locked paid places or treating budget as funding',async preset=>{
 render(<MultiDayPayoutConfigurationPreview {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'Xem trước mức sàn Main Event'}));
 await screen.findByText(players[0].name);
 fireEvent.change(screen.getByLabelText('Mẫu payout'),{target:{value:preset}});
 fireEvent.click(screen.getByRole('button',{name:'Xem trước mẫu payout'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('không tự giảm số suất');
 expect(h.client.rpc.mock.calls.filter(([name])=>name==='multi_day_payout_configuration_preview_v1')).toHaveLength(1);
 fireEvent.change(screen.getByLabelText(/Quỹ dự kiến riêng/),{target:{value:'400000'}});
 fireEvent.click(screen.getByRole('button',{name:'Xem trước mẫu payout'}));
 await waitFor(()=>expect(screen.getByRole('table')).toHaveTextContent('310.000đ'));
 expect(screen.getByRole('status')).toHaveTextContent('thiếu quỹ 260.000đ');
 const calls=h.client.rpc.mock.calls.filter(([name])=>name==='multi_day_payout_configuration_preview_v1');
 expect(calls[1][1].p_proposed_rows).toHaveLength(2);
 expect(calls[1][1].p_proposed_rows.reduce((n:number,row:{amount:number})=>n+row.amount,0)).toBe(400000);
 expect(h.client.rpc.mock.calls.every(([name])=>['multi_day_payout_configuration_preview_v1','multi_day_final_roster_v1'].includes(name))).toBe(true);
});
it('coalesces a double click and discards a response after changing the event scope',async()=>{
 let finish!:(v:unknown)=>void;
 h.client.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const view=render(<MultiDayPayoutConfigurationPreview {...props}/>);
 const button=screen.getByRole('button',{name:'Xem trước mức sàn Main Event'});
 fireEvent.click(button);fireEvent.click(button);
 expect(h.client.rpc).toHaveBeenCalledTimes(1);
 view.rerender(<MultiDayPayoutConfigurationPreview {...props} eventId={uuid(60)}/>);
 await act(async()=>{finish({data:response({p_event_id:eventId,p_proposed_rows:[]}),error:null});});
 expect(screen.queryByRole('table')).not.toBeInTheDocument();
 expect(h.client.rpc).toHaveBeenCalledTimes(1);
});
it('does not display an unverified or persisted response as a read-only proposal',async()=>{
 h.client.rpc.mockResolvedValueOnce({data:{...response({p_event_id:eventId,p_proposed_rows:[]}),previewOnly:false},error:null});
 render(<MultiDayPayoutConfigurationPreview {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'Xem trước mức sàn Main Event'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('unverified');
 expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
it.each(['wrong-event','wrong-total','duplicate-player','bad-configuration-revision'] as const)('rejects %s in the server proposal',async kind=>{
 const data=response({p_event_id:eventId,p_proposed_rows:[]});
 if(kind==='wrong-event')data.eventId=uuid(70);
 if(kind==='wrong-total')data.unpaidObligationVnd++;
 if(kind==='duplicate-player')data.obligations[1].playerId=data.obligations[0].playerId;
 if(kind==='bad-configuration-revision')data.configurationRevision='not-a-revision';
 h.client.rpc.mockResolvedValueOnce({data,error:null});
 render(<MultiDayPayoutConfigurationPreview {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'Xem trước mức sàn Main Event'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('unverified');
 expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
it('does not attach names from a different qualification snapshot',async()=>{
 const fallback=h.client.rpc.getMockImplementation()!;
 h.client.rpc.mockImplementation(async(name,args)=>name==='multi_day_final_roster_v1'
  ?{data:{eventId,finalTournamentId:uuid(50),qualificationHash:'b'.repeat(32),sourceHash:hash,releaseEnabled:true,players,tables:[]},error:null}:fallback(name,args));
 render(<MultiDayPayoutConfigurationPreview {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'Xem trước mức sàn Main Event'}));
 expect(await screen.findByText(/Chưa xác minh được tên một số người/)).toBeInTheDocument();
 expect(screen.queryByText(players[0].name)).not.toBeInTheDocument();
 expect(screen.getByRole('table')).toHaveTextContent(players[0].playerId);
});
