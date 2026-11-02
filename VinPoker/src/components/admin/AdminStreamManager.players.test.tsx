import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
const h=vi.hoisted(()=>({actor:'actor' as string|null,read:vi.fn(),signals:[] as AbortSignal[],write:vi.fn(),update:vi.fn(),success:vi.fn(),error:vi.fn(),compress:vi.fn(),upload:vi.fn(),publicUrl:vi.fn()}));
vi.mock('@/lib/compressImage',()=>({compressImage:h.compress}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:h.actor?{id:h.actor}:null})}));
vi.mock('sonner',()=>({toast:{success:h.success,error:h.error}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>{
 let writing=false;
 const rows=table==='tournaments'?[{id:'tour',name:'TEST tour',club_id:'club',current_players:7}]:table==='clubs'?[{id:'club',name:'TEST club'}]:[{id:'stream',tournament_id:'tour',platform:'youtube',stream_url:'https://youtube.com/watch?v=abcdefghijk',is_live:true,scheduled_at:'2026-10-24T10:15:22.123Z'}];
 const q={select:()=>q,order:()=>q,limit:()=>q,eq:()=>q,abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return q;},update:(payload:unknown)=>{writing=true;h.update(payload);return q;},then:(resolve:(value:unknown)=>unknown,reject?:(reason:unknown)=>unknown)=>(writing?h.write():h.read(table,rows)).then(resolve,reject)};
 return q;
},storage:{from:()=>({upload:h.upload,getPublicUrl:h.publicUrl})}}}));
import {AdminStreamManager} from './AdminStreamManager';
beforeEach(()=>{vi.clearAllMocks();h.actor='actor';h.signals=[];h.read.mockImplementation((_table,rows)=>Promise.resolve({data:rows,error:null}));h.write.mockResolvedValue({data:[{id:'tour'}],error:null});
 h.compress.mockImplementation(async(file:File)=>file);h.upload.mockResolvedValue({error:null});h.publicUrl.mockReturnValue({data:{publicUrl:'https://test.invalid/thumb.png'}});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
it.each(['account-change','draft-reset'])('does not upload or attach a thumbnail after its scope exits: %s',async(kind)=>{
 let finish!:(file:File)=>void;h.compress.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const view=render(<AdminStreamManager/>);await screen.findByRole('button',{name:/7 người chơi/});
 const file=new File(['TEST'],'test.png',{type:'image/png'});
 fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[file]}});
 await waitFor(()=>expect(finish).toBeDefined());
 if(kind==='account-change'){h.actor='another';view.rerender(<AdminStreamManager/>);}
 else fireEvent.click(screen.getByRole('button',{name:'Hủy'}));
 await act(async()=>finish(file));
 expect(h.upload).not.toHaveBeenCalled();expect(screen.queryByAltText('thumb')).not.toBeInTheDocument();
});
it('single-flights thumbnail selection while compression is pending',async()=>{
 h.compress.mockReturnValue(new Promise(()=>{}));const view=render(<AdminStreamManager/>);
 await screen.findByRole('button',{name:/7 người chơi/});
 const input=view.container.querySelector('input[type="file"]')!;
 const file=new File(['TEST'],'test.png',{type:'image/png'});
 fireEvent.change(input,{target:{files:[file]}});fireEvent.change(input,{target:{files:[file]}});
 expect(h.compress).toHaveBeenCalledTimes(1);
});
it.each(['compression','upload-throw','upload-error'])('releases the thumbnail picker on a failed stage and allows an explicit retry: %s',async(stage)=>{
 if(stage==='compression')h.compress.mockRejectedValueOnce(new Error('compression failure'));
 if(stage==='upload-throw')h.upload.mockRejectedValueOnce(new Error('transport failure'));
 if(stage==='upload-error')h.upload.mockResolvedValueOnce({error:{message:'private provider detail'}});
 const view=render(<AdminStreamManager/>);await screen.findByRole('button',{name:/7 người chơi/});
 const file=new File(['TEST'],'test.png',{type:'image/png'});
 fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[file]}});
 await waitFor(()=>expect(h.error).toHaveBeenCalledWith('Không tải được ảnh thumbnail. Hãy thử lại.'));
 expect(screen.getByRole('button',{name:'Chọn ảnh thumbnail'})).toBeEnabled();
 expect(screen.queryByAltText('thumb')).not.toBeInTheDocument();
 fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[file]}});
 expect(await screen.findByAltText('thumb')).toHaveAttribute('src','https://test.invalid/thumb.png');
});
it('does not show the old upload error after an account change',async()=>{
 let finish!:(value:unknown)=>void;h.upload.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const view=render(<AdminStreamManager/>);await screen.findByRole('button',{name:/7 người chơi/});
 fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[new File(['TEST'],'test.png',{type:'image/png'})]}});
 await waitFor(()=>expect(finish).toBeDefined());h.actor='another';view.rerender(<AdminStreamManager/>);
 await act(async()=>finish({error:{message:'old account error'}}));
 expect(h.error).not.toHaveBeenCalled();expect(h.publicUrl).not.toHaveBeenCalled();
});
it.each(['12abc','1.5','1e2','9007199254740992','2147483648','-1',''])('rejects non-integer player input %j without writing',async(value)=>{
 vi.stubGlobal('prompt',()=>value);render(<AdminStreamManager/>);
 const button=await screen.findByRole('button',{name:/7 người chơi/});
 await act(async()=>{fireEvent.click(button);});
 expect(h.update).not.toHaveBeenCalled();expect(h.error).toHaveBeenCalledWith('Số không hợp lệ');
});
it('does not claim success for an RLS-filtered zero-row update',async()=>{
 h.write.mockResolvedValueOnce({data:[],error:null});vi.stubGlobal('prompt',()=> '12');
 render(<AdminStreamManager/>);fireEvent.click(await screen.findByRole('button',{name:/7 người chơi/}));
 await waitFor(()=>expect(h.error).toHaveBeenCalled());expect(h.success).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:/7 người chơi/})).toBeTruthy();
});
it('shows success only after receiving the exact updated tournament',async()=>{
 vi.stubGlobal('prompt',()=> '12');render(<AdminStreamManager/>);
 fireEvent.click(await screen.findByRole('button',{name:/7 người chơi/}));
 await screen.findByRole('button',{name:/12 người chơi/});expect(h.success).toHaveBeenCalledWith('Đã cập nhật số người chơi');
});
it('rejects proof for a different tournament',async()=>{
 h.write.mockResolvedValueOnce({data:[{id:'other'}],error:null});vi.stubGlobal('prompt',()=> '12');
 render(<AdminStreamManager/>);fireEvent.click(await screen.findByRole('button',{name:/7 người chơi/}));
 await waitFor(()=>expect(h.error).toHaveBeenCalled());expect(h.success).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:/7 người chơi/})).toBeTruthy();
});
it('does not claim success when the update response is lost',async()=>{
 h.write.mockRejectedValueOnce(new Error('response lost'));vi.stubGlobal('prompt',()=> '12');
 render(<AdminStreamManager/>);fireEvent.click(await screen.findByRole('button',{name:/7 người chơi/}));
 await waitFor(()=>expect(h.error).toHaveBeenCalledWith(expect.stringContaining('Chưa xác minh')));
 expect(h.success).not.toHaveBeenCalled();expect(h.write).toHaveBeenCalledTimes(1);
});

const openScheduledStream=async()=>{
 const view=render(<AdminStreamManager/>);
 await screen.findByRole('button',{name:/7 người chơi/});
 const edit=Array.from(view.container.querySelectorAll('button')).find(button=>button.querySelector('.lucide-pencil'));
 expect(edit).toBeTruthy();fireEvent.click(edit!);
 const dialog=await screen.findByRole('dialog');
 return dialog.querySelector('input[type="datetime-local"]') as HTMLInputElement;
};
it('does not save an edited stream while its selected thumbnail is still uploading',async()=>{
 h.upload.mockReturnValue(new Promise(()=>{}));await openScheduledStream();
 const dialog=screen.getByRole('dialog');
 fireEvent.change(dialog.querySelector('input[type="file"]')!,{target:{files:[new File(['TEST'],'test.png',{type:'image/png'})]}});
 await waitFor(()=>expect(h.upload).toHaveBeenCalledOnce());
 expect(screen.getByRole('button',{name:'Lưu'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Lưu'}));expect(h.update).not.toHaveBeenCalled();
});
it('opens a saved stream instant as local wall time rather than UTC in datetime-local',async()=>{
 const input=await openScheduledStream();
 const instant=new Date('2026-10-24T10:15:22.123Z');
 const pad=(n:number)=>String(n).padStart(2,'0');
 expect(input.value).toBe(`${instant.getFullYear()}-${pad(instant.getMonth()+1)}-${pad(instant.getDate())}T${pad(instant.getHours())}:${pad(instant.getMinutes())}`);
});
it('preserves the exact saved instant including seconds when only opening and saving',async()=>{
 h.write.mockResolvedValueOnce({data:[{id:'stream'}],error:null});
 await openScheduledStream();fireEvent.click(screen.getByRole('button',{name:'Lưu'}));
 await waitFor(()=>expect(h.update).toHaveBeenCalled());
 expect(h.update).toHaveBeenCalledWith(expect.objectContaining({scheduled_at:'2026-10-24T10:15:22.123Z'}));
});
it('interprets an explicitly changed schedule in the same local timezone as its input',async()=>{
 h.write.mockResolvedValueOnce({data:[{id:'stream'}],error:null});
 const input=await openScheduledStream();fireEvent.change(input,{target:{value:'2026-10-25T11:30'}});
 fireEvent.click(screen.getByRole('button',{name:'Lưu'}));
 await waitFor(()=>expect(h.update).toHaveBeenCalled());
 expect(h.update).toHaveBeenCalledWith(expect.objectContaining({scheduled_at:new Date('2026-10-25T11:30').toISOString()}));
});

it('does not represent a failed stream read as an empty list and can explicitly retry',async()=>{
 h.read.mockImplementation((table,rows)=>Promise.resolve(table==='tournament_streams'?{data:null,error:{message:'503'}}:{data:rows,error:null}));
 render(<AdminStreamManager/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được');
 expect(screen.queryByText('Chưa có stream nào.')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Lưu Stream'})).toBeDisabled();
 h.read.mockImplementation((_table,rows)=>Promise.resolve({data:rows,error:null}));
 fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));
 await screen.findByRole('button',{name:/7 người chơi/});
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('does not enable writes while the initial context is still loading',()=>{
 h.read.mockReturnValue(new Promise(()=>{}));render(<AdminStreamManager/>);
 expect(screen.getByRole('button',{name:'Lưu Stream'})).toBeDisabled();
});
it('bounds a hung read and aborts all three scoped requests',async()=>{
 vi.useFakeTimers();h.read.mockReturnValue(new Promise(()=>{}));render(<AdminStreamManager/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(20001);});
 expect(screen.getByRole('alert')).toHaveTextContent('Không tải được');
 expect(h.signals).toHaveLength(3);expect(h.signals.every(signal=>signal.aborted)).toBe(true);
 expect(screen.getByRole('button',{name:'Lưu Stream'})).toBeDisabled();
});
it('removes the old account data immediately and aborts its reads on logout',async()=>{
 const view=render(<AdminStreamManager/>);await screen.findByRole('button',{name:/7 người chơi/});
 h.actor='another';h.read.mockReturnValue(new Promise(()=>{}));view.rerender(<AdminStreamManager/>);
 expect(screen.queryByRole('button',{name:/7 người chơi/})).not.toBeInTheDocument();
 h.actor=null;view.rerender(<AdminStreamManager/>);
 expect(screen.queryByText('TEST tour')).not.toBeInTheDocument();
 expect(screen.getByRole('alert')).toHaveTextContent('Đăng nhập');
});
it('does not accept a late response after the read deadline',async()=>{
 vi.useFakeTimers();
 let finish!: (value:unknown)=>void;
 h.read.mockReturnValue(new Promise(resolve=>{finish=resolve;}));render(<AdminStreamManager/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(20001);});
 expect(screen.getByRole('alert')).toBeInTheDocument();
 await act(async()=>{finish({data:[],error:null});});
 expect(screen.getByRole('alert')).toBeInTheDocument();
 expect(screen.queryByText('Chưa có stream nào.')).not.toBeInTheDocument();
});
it('treats a malformed successful read as unavailable, not empty',async()=>{
 h.read.mockImplementation((table,rows)=>Promise.resolve({data:table==='clubs'?null:rows,error:null}));
 render(<AdminStreamManager/>);expect(await screen.findByRole('alert')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Lưu Stream'})).toBeDisabled();
 expect(screen.queryByText('Chưa có stream nào.')).not.toBeInTheDocument();
});
