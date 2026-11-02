import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({rpc:vi.fn(),actor:'owner-a',toastError:vi.fn()}));
vi.mock('sonner',()=>({toast:{error:h.toastError,success:vi.fn()}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:h.actor}})}));
import {BagTagTab} from './BagTagTab';
const state=(tour:string,day:number,name:string)=>({tournament_id:tour,day_number:day,day:{status:'open',version:0,signed_off:false},days:[1,2],bags:[],
 players:[{player_id:'player-a',player_name:name,chip_count:1000,table_name:'TEST Table',seat_number:1}],
 reconciliation:{players:[],total_expected_value:1000,total_counted_value:0,total_variance_value:-1000,all_zero:false}});
const receipt=(args:Record<string,unknown>,result:Record<string,unknown>)=>({status:'committed',actor_id:args.p_expected_actor,request_id:args.p_request_id,
 intent:{tournament_id:args.p_tournament_id,day_number:args.p_day_number,operation:args.p_operation,payload:args.p_payload},result});
beforeEach(()=>{sessionStorage.clear();h.actor='owner-a';h.rpc.mockReset();h.toastError.mockReset();});
it('retains an uncertain request across reload and only reads its exact receipt',async()=>{
 h.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='get_bag_tag_state')return {data:state('tour-a',1,'RECEIPT TEST'),error:null};
  if(name==='chip_ops_bag_intent_v1'&&args.p_action==='read')return {data:receipt(args,{status:'ok'}),error:null};
  return {data:null,error:{message:'TEST503'}};
 });
 const first=render(<BagTagTab tournamentId="tour-a" clubId="club-a"/>);
 await screen.findByText('RECEIPT TEST');fireEvent.click(screen.getByRole('button',{name:'Niêm'}));
 await screen.findByText(/Chưa xác minh kết quả yêu cầu đóng bao/);
 const writes=h.rpc.mock.calls.filter(([name,args])=>name==='chip_ops_bag_intent_v1'&&args.p_action==='write');
 expect(writes).toHaveLength(1);const original=writes[0][1];
 first.unmount();render(<BagTagTab tournamentId="tour-a" clubId="club-a"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Kiểm tra kết quả'}));
 await waitFor(()=>expect(screen.queryByText(/Chưa xác minh kết quả yêu cầu đóng bao/)).toBeNull());
 const read=h.rpc.mock.calls.find(([name,args])=>name==='chip_ops_bag_intent_v1'&&args.p_action==='read');
 expect(read?.[1]).toEqual({...original,p_action:'read'});
 expect(h.rpc.mock.calls.filter(([name,args])=>name==='chip_ops_bag_intent_v1'&&args.p_action==='write')).toHaveLength(1);
});
it('does not write when the durable journal cannot be saved',async()=>{
 h.rpc.mockResolvedValue({data:state('tour-a',1,'STORAGE TEST'),error:null});
 const fail=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
 try{
  render(<BagTagTab tournamentId="tour-a" clubId="club-a"/>);await screen.findByText('STORAGE TEST');
  fireEvent.click(screen.getByRole('button',{name:'Niêm'}));
  await screen.findByText(/Không đọc hoặc lưu được yêu cầu đóng bao/);
  expect(h.rpc.mock.calls.every(([name])=>name==='get_bag_tag_state')).toBe(true);
 }finally{fail.mockRestore();}
});
it('explains the active-hand blocker from a bound terminal receipt',async()=>{
 h.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='get_bag_tag_state'
  ?{data:state('tour-a',1,'ACTIVE HAND TEST'),error:null}
  :{data:receipt(args,{error:'HAND_IN_PROGRESS'}),error:null});
 render(<BagTagTab tournamentId="tour-a" clubId="club-a"/>);await screen.findByText('ACTIVE HAND TEST');
 fireEvent.click(screen.getByRole('button',{name:'Niêm'}));
 await waitFor(()=>expect(h.toastError).toHaveBeenCalledWith('Còn hand đang chơi. Hoàn tất hoặc hủy hand đúng quy trình trước khi niêm bao/chốt ngày.'));
 expect(sessionStorage.length).toBe(0);
 expect(await screen.findByRole('button',{name:'Niêm'})).toBeEnabled();
});
it.each([{status:'unknown'},{status:'committed',result:null},{status:'committed',result:{}}])('keeps the request for an unverified receipt %j',async(reply)=>{
 h.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='get_bag_tag_state'
  ?{data:state('tour-a',1,'UNKNOWN TEST'),error:null}
  :args.p_action==='read'?{data:reply,error:null}:{data:null,error:{message:'TEST503'}});
 render(<BagTagTab tournamentId="tour-a" clubId="club-a"/>);await screen.findByText('UNKNOWN TEST');
 fireEvent.click(screen.getByRole('button',{name:'Niêm'}));
 const read=await screen.findByRole('button',{name:'Kiểm tra kết quả'});
 await waitFor(()=>expect(read).not.toBeDisabled());fireEvent.click(read);
 await waitFor(()=>expect(read).not.toBeDisabled());
 expect(screen.getByText(/Chưa xác minh kết quả yêu cầu đóng bao/)).toBeInTheDocument();
 expect(sessionStorage.length).toBe(1);
 expect(screen.queryByRole('button',{name:'Niêm'})).toBeNull();
});
it('serializes double-click and cancels the same durable request, never a fresh write',async()=>{
 let finish!:(value:unknown)=>void;
 h.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  if(name==='get_bag_tag_state')return Promise.resolve({data:state('tour-a',1,'DOUBLE TEST'),error:null});
  if(args.p_action==='write')return new Promise(resolve=>{finish=resolve;});
  return Promise.resolve({data:receipt(args,{status:'cancelled',error:'REQUEST_CANCELLED'}),error:null});
 });
 render(<BagTagTab tournamentId="tour-a" clubId="club-a"/>);await screen.findByText('DOUBLE TEST');
 const button=screen.getByRole('button',{name:'Niêm'});
 act(()=>{fireEvent.click(button);fireEvent.click(button);});
 expect(h.rpc.mock.calls.filter(([name])=>name==='chip_ops_bag_intent_v1')).toHaveLength(1);
 await act(async()=>finish({data:null,error:{message:'TEST503'}}));
 fireEvent.click(screen.getByRole('button',{name:'Hủy nếu chưa thực hiện'}));
 await screen.findByText('DOUBLE TEST');
 const calls=h.rpc.mock.calls.filter(([name])=>name==='chip_ops_bag_intent_v1');
 expect(calls).toHaveLength(2);expect(calls[1][1]).toEqual({...calls[0][1],p_action:'cancel'});
 expect(sessionStorage.length).toBe(0);
});
it.each(['actor','request','day','payload'])('does not clear a receipt bound to the wrong %s',async(kind)=>{
 h.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='get_bag_tag_state')return {data:state('tour-a',1,'BINDING TEST'),error:null};
  if(args.p_action==='write')return {data:null,error:{message:'TEST503'}};
  const wrong=receipt(args,{status:'ok'});
  if(kind==='actor')wrong.actor_id='another-owner';
  if(kind==='request')wrong.request_id='another-request';
  if(kind==='day')wrong.intent.day_number=99;
  if(kind==='payload')wrong.intent.payload={seal:false};
  return {data:wrong,error:null};
 });
 render(<BagTagTab tournamentId="tour-a" clubId="club-a"/>);await screen.findByText('BINDING TEST');
 fireEvent.click(screen.getByRole('button',{name:'Niêm'}));
 const check=await screen.findByRole('button',{name:'Kiểm tra kết quả'});await waitFor(()=>expect(check).not.toBeDisabled());
 await act(async()=>fireEvent.click(check));
 expect(sessionStorage.length).toBe(1);
 expect(screen.getByText(/Chưa xác minh kết quả yêu cầu đóng bao/)).toBeInTheDocument();
});
it.each(['1.5','9007199254740993'])('does not submit an unrepresentable chip count %s',async(value)=>{
 h.rpc.mockImplementation(async(name:string)=>({data:name==='get_bag_tag_state'?state('tour-a',1,'COUNT TEST'):{status:'ok'},error:null}));
 render(<BagTagTab tournamentId="tour-a" clubId="club-a"/>);
 await screen.findByText('COUNT TEST');
 fireEvent.change(screen.getByRole('spinbutton'),{target:{value}});
 expect(screen.getByText('Số chip không hợp lệ.')).toBeInTheDocument();
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Niêm'})));
 expect(h.rpc.mock.calls.filter(([name])=>name==='chip_ops_record_bag')).toHaveLength(0);
 expect(h.toastError).toHaveBeenCalledWith('Số chip không hợp lệ.');
});
it('does not describe a mutation transport failure as a missing deployment',async()=>{
 h.rpc.mockImplementation(async(name:string)=>name==='get_bag_tag_state'?{data:state('tour-a',1,'NETWORK TEST'),error:null}:{data:null,error:{message:'TEST503'}});
 render(<BagTagTab tournamentId="tour-a" clubId="club-a"/>);
 await screen.findByText('NETWORK TEST');fireEvent.click(screen.getByRole('button',{name:'Niêm'}));
 await waitFor(()=>expect(h.toastError).toHaveBeenCalled());
 expect(h.toastError.mock.calls.at(-1)?.[0]).toContain('Không kết nối được máy chủ chip');
 expect(h.toastError.mock.calls.at(-1)?.[0]).not.toContain('chưa bật');
});
it.each([{data:null,error:{message:'TEST503'}},{data:null,error:null}])('does not present an unavailable read as an empty open day (%j)',async(reply)=>{
 h.rpc.mockResolvedValue(reply);render(<BagTagTab tournamentId="tour-a" clubId="club-a"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Không xác minh được dữ liệu đóng bao');
 expect(screen.queryByText('Không có người chơi đang hoạt động.')).toBeNull();
 expect(screen.queryByText('Đang mở')).toBeNull();
 expect(screen.queryByRole('button',{name:/Khoá có chênh/})).toBeNull();
 h.rpc.mockResolvedValue({data:state('tour-a',1,'VERIFIED'),error:null});
 fireEvent.click(screen.getByRole('button',{name:'Tải lại'}));
 expect(await screen.findByText('VERIFIED')).toBeInTheDocument();
 expect(h.rpc.mock.calls.every(([name])=>name==='get_bag_tag_state')).toBe(true);
});
it('ignores a late day1 response after day2 is verified',async()=>{
 let old!:(value:unknown)=>void;
 h.rpc.mockImplementationOnce(()=>new Promise(resolve=>{old=resolve;})).mockResolvedValue({data:state('tour-a',2,'DAY2'),error:null});
 render(<BagTagTab tournamentId="tour-a" clubId="club-a"/>);
 await waitFor(()=>expect(h.rpc).toHaveBeenCalledTimes(1));
 fireEvent.click(screen.getByRole('button',{name:'Ngày mới'}));
 expect(await screen.findByText('DAY2')).toBeInTheDocument();
 await act(async()=>old({data:state('tour-a',1,'LATE DAY1'),error:null}));
 expect(screen.queryByText('LATE DAY1')).toBeNull();expect(screen.getByText('DAY2')).toBeInTheDocument();
});
it('does not retain an old tour during a new tour read',async()=>{
 h.rpc.mockResolvedValueOnce({data:state('tour-a',1,'PRIVATE A'),error:null});
 const {rerender}=render(<BagTagTab tournamentId="tour-a" clubId="club-a"/>);
 expect(await screen.findByText('PRIVATE A')).toBeInTheDocument();
 h.rpc.mockImplementation(()=>new Promise(()=>{}));rerender(<BagTagTab tournamentId="tour-b" clubId="club-b"/>);
 expect(screen.queryByText('PRIVATE A')).toBeNull();
 expect(screen.queryByText('Đang mở')).toBeNull();
});
