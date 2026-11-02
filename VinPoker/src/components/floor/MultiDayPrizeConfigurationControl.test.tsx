import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MultiDayPrizeConfigurationControl,type PrizeConfigurationProposal} from './MultiDayPrizeConfigurationControl';
import {parsePrizeConfigurationIntent,persistPrizeConfigurationIntent,readPrizeConfigurationIntent} from '@/ops/floor/multiDayPrizeConfigurationIntent';
const actorId='10000000-0000-4000-8000-000000000001',eventId='10000000-0000-4000-8000-000000000002';
const requestId='10000000-0000-4000-8000-000000000003',backendScope='http://127.0.0.1:54329',hash='a'.repeat(32);
const intent=()=>parsePrizeConfigurationIntent({actorId,eventId,backendScope,args:{p_event_id:eventId,p_rows:[{position:1,amount:110000}],
 p_expected_configuration_revision:hash,p_expected_rules_version:hash,p_expected_funding_revision:hash,
 p_expected_qualification_revision:hash,p_expected_payout_input_hash:hash,p_request_id:requestId,p_reason:'Owner TEST'}},actorId,eventId,backendScope);
const receipt=()=>({ok:true,state:'CONFIGURED',idempotent:true,eventId,requestId,configurationRevision:'b'.repeat(32),
 previousConfigurationRevision:hash,payoutInputHash:hash,requiredShortfallVnd:160000,
 fundingExecution:'NOT_PERFORMED',paymentExecution:'NOT_PERFORMED',obligationFinalization:'NOT_PERFORMED',
 requestPayload:{event:eventId,rows:intent().args.p_rows,configuration:hash,rules:hash,funding:hash,qualification:hash,proposal:hash,reason:'Owner TEST'}});
const props=()=>({actorId,eventId,backendScope,ownerEnabled:true,held:false,proposal:null,onHeld:vi.fn(),onSaved:vi.fn(),rpc:vi.fn()});
const proposal=():PrizeConfigurationProposal=>({rows:intent().args.p_rows.map(row=>({position:row.position,amount:row.amount})),preview:{state:'REQUIRED_SHORTFALL',
 rulesVersion:hash,fundingRevision:hash,qualificationRevision:hash,payoutInputHash:hash,configurationRevision:hash,
 directPoolVnd:0,transferPoolVnd:0,feesVnd:0,recordedOverlayVnd:0,requiredShortfallVnd:110000,
 paidPlayerVnd:0,unpaidObligationVnd:110000,clubRetainedTieVnd:0,unallocatedPoolVnd:0,
 obligations:[{playerId:actorId,participationId:eventId,rank:1,rankAwardVnd:110000,participationFloorVnd:110000,
  nonselectedBagMinCashVnd:0,totalVnd:110000,paidVnd:0,unpaidVnd:110000}],sourceSnapshot:{},
 previewOnly:true,configurationPersistence:'NOT_PERFORMED',paymentExecution:'NOT_PERFORMED',itmPlaces:1}});
beforeEach(()=>sessionStorage.clear());afterEach(cleanup);
it('does not expose a save action when backend contract probing fails',async()=>{
 const p=props();p.rpc.mockRejectedValue({code:'42883',message:'Contract absent'});
 render(<MultiDayPrizeConfigurationControl {...p}/>);
 expect(p.rpc).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'Kiểm tra quyền và backend lưu bảng thưởng'}))
  .toHaveClass('h-auto','max-w-full','whitespace-normal');
 fireEvent.click(screen.getByRole('button',{name:'Kiểm tra quyền và backend lưu bảng thưởng'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Contract absent');
 expect(screen.queryByRole('button',{name:'Lưu bảng thưởng Main Event'})).not.toBeInTheDocument();
 expect(sessionStorage.length).toBe(0);
});
it('keeps a recovered unknown request across NOT_FOUND and disables duplicate lookup clicks',async()=>{
 persistPrizeConfigurationIntent(sessionStorage,intent());const p=props();let resolve!:(value:unknown)=>void;
 p.rpc.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 render(<MultiDayPrizeConfigurationControl {...p}/>);
 const lookup=screen.getByRole('button',{name:'Kiểm tra kết quả lưu'});fireEvent.click(lookup);fireEvent.click(lookup);
 expect(p.rpc).toHaveBeenCalledOnce();
 resolve({ok:true,state:'NOT_FOUND',eventId,requestId});
 await screen.findByText(/Chưa tìm thấy receipt/);
 expect(readPrizeConfigurationIntent(sessionStorage,actorId,eventId,backendScope)).toEqual(intent());
 expect(p.onSaved).not.toHaveBeenCalled();expect(p.onHeld).toHaveBeenCalledWith(true);
});
it('recovers and retries the exact retained request even with no current proposal',async()=>{
 persistPrizeConfigurationIntent(sessionStorage,intent());const p=props();p.rpc.mockResolvedValue(receipt());
 render(<MultiDayPrizeConfigurationControl {...p}/>);
 fireEvent.click(screen.getByRole('button',{name:'Thử lại đúng yêu cầu đang chờ'}));
 await waitFor(()=>expect(p.onSaved).toHaveBeenCalledOnce());
 expect(p.rpc).toHaveBeenCalledWith('multi_day_save_prize_configuration_v1',intent().args);
 expect(readPrizeConfigurationIntent(sessionStorage,actorId,eventId,backendScope)).toBeNull();
 expect(await screen.findByText(/Đã lưu cấu hình bảng thưởng/)).toBeInTheDocument();
});
it('holds malformed retained journals without sending any request',async()=>{
 const i=intent();persistPrizeConfigurationIntent(sessionStorage,i);
 const p=props();render(<MultiDayPrizeConfigurationControl {...p} backendScope="http://127.0.0.1:54330"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Không xác minh');
 expect(p.onHeld).toHaveBeenCalledWith(true);expect(p.rpc).not.toHaveBeenCalled();
 expect(readPrizeConfigurationIntent(sessionStorage,actorId,eventId,backendScope)).toEqual(i);
});
it('requires explicit confirmation and reason, persists before save, then retains a lost response',async()=>{
 const p=props();p.rpc.mockImplementation(async(name,args)=>{
  if(name==='multi_day_prize_configuration_receipt_v1')return {ok:true,state:'NOT_FOUND',eventId,requestId:args.p_request_id};
  const retained=readPrizeConfigurationIntent(sessionStorage,actorId,eventId,backendScope);
  expect(retained?.args).toEqual(args);throw Error('response lost after commit');
 });
 render(<MultiDayPrizeConfigurationControl {...p} proposal={proposal()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Kiểm tra quyền và backend lưu bảng thưởng'}));
 const save=await screen.findByRole('button',{name:'Lưu bảng thưởng Main Event'});expect(save).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Lý do lưu cấu hình'),{target:{value:'Owner TEST'}});
 expect(save).toBeDisabled();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(save);fireEvent.click(save);
 expect(await screen.findByRole('alert')).toHaveTextContent('response lost');
 expect(p.rpc.mock.calls.filter(([name])=>name==='multi_day_save_prize_configuration_v1')).toHaveLength(1);
 expect(readPrizeConfigurationIntent(sessionStorage,actorId,eventId,backendScope)?.args.p_rows).toEqual(intent().args.p_rows);
 expect(screen.getByRole('button',{name:'Kiểm tra kết quả lưu'})).toBeInTheDocument();expect(p.onSaved).not.toHaveBeenCalled();
});
