import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h=vi.hoisted(()=>({
  tour:'b1150000-0000-4000-8000-000000000001',club:'b1150000-0000-4000-8000-000000000002',
  player:'b1150000-0000-4000-8000-000000000003',chat:'b1150000-0000-4000-8000-000000000004',
  auth:{user:{id:'owner'},session:{access_token:'TEST-booking-session'},loading:false,isAdmin:false},
  nav:vi.fn(),write:vi.fn(),read:vi.fn(),chatTour:'',registrationError:false,
  registrations:[] as Record<string,unknown>[],tourReply:null as null|Promise<unknown>,
  closeReply:null as null|{data:unknown;error:unknown},
  archivedAt:null as string|null,compress:vi.fn(),upload:vi.fn(),
  mutationFilters:vi.fn(),messageReply:null as null|{data:unknown;error:unknown},
  receptionist:true,chatMissing:false,rpc:vi.fn(),
}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>h.auth}));
vi.mock('react-router-dom',()=>({useNavigate:()=>h.nav,useParams:()=>({tournamentId:h.tour}),
  useSearchParams:()=>[new URLSearchParams(h.receptionist?{asReceptionist:h.chat}:{})],Navigate:()=>null,
  Link:({to,children,...props}:{to:string;children:React.ReactNode})=><a href={to} {...props}>{children}</a>}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/lib/notifySound',()=>({playNotifySound:vi.fn()}));
vi.mock('@/lib/compressImage',()=>({compressImage:(...args:unknown[])=>h.compress(...args)}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
  from:(table:string)=>{
    const filters:Record<string,unknown>={};let mutation=false;
    const answer=()=>{
      if(mutation){h.mutationFilters(table,{...filters});return Promise.resolve(h.closeReply??{data:null,error:null});}
      h.read(table,{...filters});
      if(table==='tournaments')return h.tourReply??Promise.resolve({data:{id:h.tour,club_id:h.club,name:'TEST Booking',club:{id:h.club,name:'TEST Club',owner_id:'owner'}},error:null});
      if(table==='booking_chats')return Promise.resolve({data:h.chatMissing?null:{id:h.chat,tournament_id:h.chatTour||h.tour,club_id:h.club,player_id:h.player,status:'open',payment_confirmed:true,archived_at:h.archivedAt},error:null});
      if(table==='tournament_registrations')return Promise.resolve({data:h.registrationError?null:h.registrations,error:h.registrationError?{message:'network unavailable'}:null});
      if(table==='profiles')return Promise.resolve({data:null,error:null});
      return Promise.resolve({data:[],error:null});
    };
    const q={select:()=>q,eq:(key:string,value:unknown)=>{filters[key]=value;return q;},order:()=>q,in:()=>q,
      maybeSingle:answer,single:answer,abortSignal:()=>q,
      insert:(value:unknown)=>{mutation=true;h.write(table,'insert',value);return q;},
      update:(value:unknown)=>{mutation=true;h.write(table,'update',value);return q;},
      then:(resolve:(value:unknown)=>unknown,reject?:(error:unknown)=>unknown)=>
        (mutation?Promise.resolve(table==='chat_messages'?(h.messageReply??{data:[],error:null}):{data:[],error:null}):answer()).then(resolve,reject)};
    return q;
  },channel:()=>{const channel={on:()=>channel,subscribe:()=>channel};return channel;},removeChannel:vi.fn(),
  storage:{from:()=>({upload:(...args:unknown[])=>h.upload(...args),getPublicUrl:()=>({data:{publicUrl:'http://127.0.0.1/TEST-only-image.png'}})})},
  rpc:(...args:unknown[])=>{const result=Promise.resolve(h.rpc(...args));return Object.assign(result,{abortSignal:()=>result});},
}}));
import BookingChat from './BookingChat';
const reg=(id:string,reference:string)=>({id,reference_code:reference,player_id:h.player,tournament_id:h.tour,club_id:h.club,status:'pending',committed_at:'2026-10-20T01:00:00Z'});
beforeEach(()=>{HTMLElement.prototype.scrollTo=vi.fn();h.nav.mockClear();h.write.mockClear();h.read.mockClear();h.chatTour='';h.registrationError=false;h.tourReply=null;h.closeReply=null;
  h.archivedAt=null;h.compress.mockReset();h.compress.mockImplementation(async(file:File)=>file);h.upload.mockReset();h.upload.mockResolvedValue({error:null});
  h.mutationFilters.mockClear();h.messageReply=null;
  h.receptionist=true;h.chatMissing=false;h.rpc.mockReset();
  h.auth={user:{id:'owner'},session:{access_token:'TEST-booking-session'},loading:false,isAdmin:false};
  h.registrations=[reg('b1150000-0000-4000-8000-000000000011','TEST-BULLET-1'),reg('b1150000-0000-4000-8000-000000000012','TEST-BULLET-2')];});
afterEach(cleanup);
describe('BookingChat canonical registration routing',()=>{
  it('lists each participation with an exact Cashier target, without confirming money or increasing player count',async()=>{
    render(<BookingChat/>);
    const links=await screen.findAllByRole('link',{name:/Mở Cashier/});
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href',expect.stringContaining('bookingRegistration=b1150000-0000-4000-8000-000000000011'));
    expect(links[1]).toHaveAttribute('href',expect.stringContaining('bookingRegistration=b1150000-0000-4000-8000-000000000012'));
    expect(links[0]).toHaveAttribute('href',expect.stringContaining('/ops/cashier/tour?'));
    expect(screen.queryByRole('button',{name:'bookingChat.syncPaid'})).toBeNull();
    expect(screen.queryByText('bookingChat.paid')).toBeNull();
    expect(h.read).toHaveBeenCalledWith('tournament_registrations',expect.objectContaining({tournament_id:h.tour,player_id:h.player,club_id:h.club}));
    expect(h.write.mock.calls.filter(([table,,payload])=>table!=='booking_chats'||Object.keys(payload).some(k=>k!=='club_last_read_at'))).toEqual([]);
  });
  it('does not accept a chat from a different route tournament or issue a read marker',async()=>{
    h.chatTour='another-tour';render(<BookingChat/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không xác minh được cuộc trò chuyện');
    expect(h.write).not.toHaveBeenCalled();expect(screen.queryByRole('link',{name:/Mở Cashier/})).toBeNull();
  });
  it('reports failed canonical read instead of no registration or paid legacy marker',async()=>{
    h.registrationError=true;render(<BookingChat/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được đăng ký');
    expect(screen.queryByRole('link',{name:/Mở Cashier/})).toBeNull();
    expect(screen.queryByText('bookingChat.paid')).toBeNull();
  });
  it('rejects a returned registration with the wrong player instead of building a payment target',async()=>{
    h.registrations=[{...h.registrations[0],player_id:'another-player'}];render(<BookingChat/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được đăng ký');
    expect(screen.queryByRole('link',{name:/Mở Cashier/})).toBeNull();
  });
  it('drops an old setup after the same actor receives a replacement session',async()=>{
    let resolve!:(value:unknown)=>void;h.tourReply=new Promise(r=>{resolve=r;});
    const view=render(<BookingChat/>);await waitFor(()=>expect(h.read).toHaveBeenCalled());
    h.auth={...h.auth,session:{access_token:'TEST-replacement'}};h.tourReply=Promise.resolve({data:null,error:{message:'read failed'}});
    view.rerender(<BookingChat/>);await screen.findByRole('alert');
    await act(async()=>{resolve({data:{id:h.tour,club_id:h.club,name:'OLD-PRIVATE-TOUR',club:{id:h.club,owner_id:'owner'}},error:null});});
    expect(screen.queryByText('OLD-PRIVATE-TOUR')).toBeNull();expect(h.write).not.toHaveBeenCalled();
  });
  it('does not retry or claim a zero-row close succeeded, and never rejects a registration',async()=>{
    render(<BookingChat/>);const close=await screen.findByRole('button',{name:'Đóng chat (không hủy đăng ký)'});
    act(()=>{fireEvent.click(close);fireEvent.click(close);});
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa xác minh được việc đóng chat');
    expect(close).toBeDisabled();
    const closes=h.write.mock.calls.filter(([,operation,payload])=>operation==='update'&&payload.status==='closed');
    expect(closes).toHaveLength(1);
    expect(h.write.mock.calls.some(([table])=>['stack_registrations','tournament_registrations','tournaments','chat_messages'].includes(table))).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'Kiểm tra trạng thái chat'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Đóng chat (không hủy đăng ký)'})).toBeEnabled());
    expect(h.write.mock.calls.filter(([,operation,payload])=>operation==='update'&&payload.status==='closed')).toHaveLength(1);
  });
  it('closes only the conversation after an exact matching acknowledgement',async()=>{
    h.closeReply={data:{id:h.chat,status:'closed'},error:null};render(<BookingChat/>);
    fireEvent.click(await screen.findByRole('button',{name:'Đóng chat (không hủy đăng ký)'}));
    await screen.findByText('bookingChat.closed');
    expect(screen.queryByRole('button',{name:'Đóng chat (không hủy đăng ký)'})).toBeNull();
    expect(h.write.mock.calls.some(([table])=>['stack_registrations','tournament_registrations','tournaments','chat_messages'].includes(table))).toBe(false);
  });
  it('does not upload an old-scope image after compression resolves in a replacement session',async()=>{
    let resolve!:(file:File)=>void;h.compress.mockImplementation(()=>new Promise(r=>{resolve=r;}));
    const view=render(<BookingChat/>);await screen.findAllByRole('link',{name:/Mở Cashier/});
    const file=new File(['TEST'],'test.png',{type:'image/png'});
    fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[file]}});
    await waitFor(()=>expect(h.compress).toHaveBeenCalledOnce());
    h.auth={...h.auth,session:{access_token:'TEST-replacement-image'}};view.rerender(<BookingChat/>);
    await act(async()=>resolve(file));
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.write.mock.calls.filter(([table])=>table==='chat_messages')).toHaveLength(0);
  });
  it('does not publish an image message from a previous session after Storage replies late',async()=>{
    let resolve!:(value:unknown)=>void;h.upload.mockImplementation(()=>new Promise(r=>{resolve=r;}));
    const view=render(<BookingChat/>);await screen.findAllByRole('link',{name:/Mở Cashier/});
    fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[new File(['TEST'],'test.png',{type:'image/png'})]}});
    await waitFor(()=>expect(h.upload).toHaveBeenCalledOnce());
    h.auth={...h.auth,session:{access_token:'TEST-replacement-upload'}};view.rerender(<BookingChat/>);
    await act(async()=>resolve({error:null}));
    expect(h.write.mock.calls.filter(([table])=>table==='chat_messages')).toHaveLength(0);
  });
  it('does not submit the same text twice when Enter fires twice before React rerenders',async()=>{
    render(<BookingChat/>);const input=await screen.findByPlaceholderText('bookingChat.typeMsg');
    fireEvent.change(input,{target:{value:'TEST exactly one message'}});
    act(()=>{fireEvent.keyDown(input,{key:'Enter'});fireEvent.keyDown(input,{key:'Enter'});});
    await waitFor(()=>expect(h.write.mock.calls.filter(([table])=>table==='chat_messages')).toHaveLength(1));
  });
  it('keeps archived state and reports an unverified zero-row unarchive instead of success',async()=>{
    h.archivedAt='2026-10-18T00:00:00Z';render(<BookingChat/>);
    fireEvent.click(await screen.findByRole('button',{name:'bookingChat.unarchive'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa xác minh được việc khôi phục chat');
    expect(screen.getByRole('button',{name:'bookingChat.unarchive'})).toBeDisabled();
  });
  it('unarchives once only after matching acknowledgement, with exact original archived timestamp and scope',async()=>{
    h.archivedAt='2026-10-18T00:00:00Z';h.closeReply={data:{id:h.chat,archived_at:null},error:null};render(<BookingChat/>);
    const button=await screen.findByRole('button',{name:'bookingChat.unarchive'});
    act(()=>{fireEvent.click(button);fireEvent.click(button);});
    await waitFor(()=>expect(screen.queryByRole('button',{name:'bookingChat.unarchive'})).toBeNull());
    expect(h.write.mock.calls.filter(([,operation,payload])=>operation==='update'&&Object.prototype.hasOwnProperty.call(payload,'archived_at'))).toHaveLength(1);
    expect(h.mutationFilters).toHaveBeenCalledWith('booking_chats',{id:h.chat,tournament_id:h.tour,club_id:h.club,archived_at:h.archivedAt});
  });
  it('keeps a failed message draft and releases busy state without auto resending',async()=>{
    h.messageReply={data:null,error:{message:'503 private diagnostics'}};render(<BookingChat/>);
    const input=await screen.findByPlaceholderText('bookingChat.typeMsg');fireEvent.change(input,{target:{value:'TEST retain my draft'}});
    fireEvent.click(screen.getByRole('button',{name:'Gửi tin nhắn'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa xác minh được tin nhắn');
    expect(input).toHaveValue('TEST retain my draft');expect(input).toBeEnabled();
    expect(screen.queryByText(/503 private diagnostics/)).toBeNull();
    expect(h.write.mock.calls.filter(([table])=>table==='chat_messages')).toHaveLength(1);
  });
  it('recovers from a compression rejection without uploading or publishing a message',async()=>{
    h.compress.mockRejectedValue(new Error('TEST compression failure'));const view=render(<BookingChat/>);
    await screen.findAllByRole('link',{name:/Mở Cashier/});
    fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[new File(['TEST'],'test.png',{type:'image/png'})]}});
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa xác minh được ảnh');
    expect(screen.getByTitle('bookingChat.photoTip')).toBeEnabled();
    expect(h.upload).not.toHaveBeenCalled();expect(h.write.mock.calls.some(([table])=>table==='chat_messages')).toBe(false);
  });
  it('creates player chat through server-owned atomic welcome, never client-authored bot messages',async()=>{
    h.receptionist=false;h.chatMissing=true;h.auth={...h.auth,user:{id:h.player}};
    h.rpc.mockResolvedValue({data:{ok:true,created:true,chat:{id:h.chat,tournament_id:h.tour,club_id:h.club,player_id:h.player,status:'open'}},error:null});
    render(<BookingChat/>);await screen.findByRole('link',{name:'Mở tour và đăng ký chuẩn'});
    expect(h.rpc).toHaveBeenCalledWith('ensure_booking_chat_v1',{p_tournament_id:h.tour});
    expect(h.write.mock.calls.some(([table,operation])=>operation==='insert'&&['booking_chats','chat_messages'].includes(table))).toBe(false);
  });
});
