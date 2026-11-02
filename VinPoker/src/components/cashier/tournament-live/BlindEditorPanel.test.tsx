import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
const h=vi.hoisted(()=>({read:vi.fn(),insert:vi.fn(),rpc:vi.fn(),error:vi.fn(),success:vi.fn(),flags:{blindEditorSave:true,blindTemplates:false}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>({insert:h.insert,select:()=>({eq:(_key:string,id:string)=>({order:()=>h.read(table,id),single:()=>h.read(table,id)})})}),rpc:h.rpc}}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:h.flags}));
vi.mock('sonner',()=>({toast:{error:h.error,success:h.success}}));
import {BlindEditorPanel} from './BlindEditorPanel';
const level=(bb:number)=>({small_blind:bb/2,big_blind:bb,ante:0,duration_minutes:20,is_break:false});
beforeEach(()=>{h.read.mockReset();h.insert.mockReset();h.rpc.mockReset();h.error.mockReset();h.success.mockReset();h.flags.blindTemplates=false;});
afterEach(()=>{cleanup();vi.useRealTimers();Reflect.deleteProperty(HTMLElement.prototype,'scrollIntoView');});
it.each(['completed','finished','cancelled'])('keeps %s blind structure readable without edits or saves',async status=>{
 h.flags.blindTemplates=true;
 h.read.mockImplementation((table:string)=>Promise.resolve({data:table==='tournaments'?{current_level:1,club_id:'club'}:table==='blind_structure_templates'?[]:[level(200)],error:null}));
 render(<BlindEditorPanel tournamentId="A" tournamentStatus={status}/>);
 expect(await screen.findByDisplayValue('200')).toBeDisabled();
 expect(screen.getByRole('button',{name:'Lưu'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Level'})).toBeDisabled();
 expect(screen.queryByRole('button',{name:'Lưu thành mẫu'})).toBeNull();
 expect(h.rpc).not.toHaveBeenCalled();expect(h.insert).not.toHaveBeenCalled();
});
it('retires an editable draft when the same tour completes',async()=>{
 h.read.mockImplementation((table:string)=>Promise.resolve({data:table==='tournaments'?{current_level:1,club_id:'club'}:[level(200)],error:null}));
 const view=render(<BlindEditorPanel tournamentId="A" tournamentStatus="live"/>);
 expect(await screen.findByDisplayValue('200')).toBeEnabled();
 view.rerender(<BlindEditorPanel tournamentId="A" tournamentStatus="completed"/>);
 expect(await screen.findByDisplayValue('200')).toBeDisabled();
 expect(screen.getByRole('button',{name:'Lưu'})).toBeDisabled();
 expect(h.rpc).not.toHaveBeenCalled();
});
it('does not announce a late save response after the tour completes',async()=>{
 h.read.mockImplementation((table:string)=>Promise.resolve({data:table==='tournaments'?{current_level:1,club_id:'club'}:[level(200)],error:null}));
 let finish!:(value:unknown)=>void;
 h.rpc.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(true);
 try{
  const view=render(<BlindEditorPanel tournamentId="A" tournamentStatus="live"/>);
  await screen.findByDisplayValue('200');fireEvent.click(screen.getByRole('button',{name:'Lưu'}));
  expect(h.rpc).toHaveBeenCalledTimes(1);
  view.rerender(<BlindEditorPanel tournamentId="A" tournamentStatus="completed"/>);
  await act(async()=>finish({data:{status:'success',levels_saved:1},error:null}));
  expect(h.success).not.toHaveBeenCalled();expect(h.rpc).toHaveBeenCalledTimes(1);
  expect(await screen.findByDisplayValue('200')).toBeDisabled();
 }finally{confirm.mockRestore();}
});
it.each([null,{bad:true},[{id:'other',club_id:'other-club',name:'Sai CLB',levels:[]}]])('does not treat malformed or cross-club template data as an empty success: %j',async(data)=>{
 h.flags.blindTemplates=true;
 h.read.mockImplementation((table:string)=>Promise.resolve({data:table==='tournaments'?{current_level:1,club_id:'club'}:table==='blind_structure_templates'?data:[level(200)],error:null}));
 render(<BlindEditorPanel tournamentId="A"/>);await screen.findByText('Không tải được danh sách mẫu blind.');
 expect(screen.getByDisplayValue('200')).toBeInTheDocument();expect(h.insert).not.toHaveBeenCalled();
});
it('settles a hanging template read and ignores its late response after timeout',async()=>{
 h.flags.blindTemplates=true;let resolve!:(value:unknown)=>void;
 const hanging=new Promise(r=>{resolve=r;});
 h.read.mockImplementation((table:string)=>table==='blind_structure_templates'?hanging:Promise.resolve({data:table==='tournaments'?{current_level:1,club_id:'club'}:[level(200)],error:null}));
 vi.useFakeTimers();render(<BlindEditorPanel tournamentId="A"/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 await act(async()=>{await vi.advanceTimersByTimeAsync(20001);});
 expect(screen.getByText('Không tải được danh sách mẫu blind.')).toBeInTheDocument();
 await act(async()=>{resolve({data:[],error:null});await Promise.resolve();});
 expect(screen.getByText('Không tải được danh sách mẫu blind.')).toBeInTheDocument();
 expect(h.rpc).not.toHaveBeenCalled();
});
it('shows template read failure and recovers without changing current blind rows',async()=>{
 h.flags.blindTemplates=true;
 let failed=true;
 h.read.mockImplementation((table:string)=>Promise.resolve(table==='blind_structure_templates'
  ?failed?{data:null,error:{message:'503'}}:{data:[],error:null}
  :{data:table==='tournaments'?{current_level:1,club_id:'club'}:[level(200)],error:null}));
 render(<BlindEditorPanel tournamentId="A"/>);await screen.findByDisplayValue('200');
 await screen.findByText('Không tải được danh sách mẫu blind.');
 failed=false;fireEvent.click(screen.getByRole('button',{name:'Tải lại mẫu blind'}));
 await waitFor(()=>expect(screen.queryByText('Không tải được danh sách mẫu blind.')).toBeNull());
 expect(screen.getByDisplayValue('200')).toBeInTheDocument();expect(h.rpc).not.toHaveBeenCalled();expect(h.insert).not.toHaveBeenCalled();
});
it('bounds a hanging template insert and does not submit again after the outcome becomes unknown',async()=>{
 h.flags.blindTemplates=true;
 h.read.mockImplementation((table:string)=>Promise.resolve({data:table==='tournaments'?{current_level:1,club_id:'club'}:table==='blind_structure_templates'?[]:[level(200)],error:null}));
 h.insert.mockReturnValue(new Promise(()=>{}));
 render(<BlindEditorPanel tournamentId="A"/>);await screen.findByDisplayValue('200');
 fireEvent.click(screen.getByRole('button',{name:'Lưu thành mẫu'}));
 fireEvent.change(screen.getByPlaceholderText("VD: Tour A, Turbo 15'…"),{target:{value:'Mẫu treo TEST'}});
 vi.useFakeTimers();
 const button=screen.getByRole('button',{name:'Lưu mẫu'});fireEvent.click(button);fireEvent.click(button);
 expect(h.insert).toHaveBeenCalledTimes(1);
 await act(async()=>{await vi.advanceTimersByTimeAsync(20001);});
 expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh được kết quả lưu mẫu');
 expect(screen.getByDisplayValue('Mẫu treo TEST')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Lưu mẫu'})).toBeDisabled();
 expect(h.success).not.toHaveBeenCalled();expect(h.insert).toHaveBeenCalledTimes(1);
});
it('reports unknown template save outcome and preserves the named draft on transport rejection',async()=>{
 h.flags.blindTemplates=true;
 h.read.mockImplementation((table:string)=>Promise.resolve({data:table==='tournaments'?{current_level:1,club_id:'club'}:table==='blind_structure_templates'?[]:[level(200)],error:null}));
 h.insert.mockRejectedValue(new Error('connection lost'));
 render(<BlindEditorPanel tournamentId="A"/>);await screen.findByDisplayValue('200');
 fireEvent.click(screen.getByRole('button',{name:'Lưu thành mẫu'}));
 fireEvent.change(screen.getByPlaceholderText("VD: Tour A, Turbo 15'…"),{target:{value:'Mẫu TEST'}});
 fireEvent.click(screen.getByRole('button',{name:'Lưu mẫu'}));
 await waitFor(()=>expect(h.error).toHaveBeenCalled());
 expect(h.success).not.toHaveBeenCalled();expect(screen.getByDisplayValue('Mẫu TEST')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Lưu mẫu'})).toBeDisabled();
 expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh được kết quả lưu mẫu');
 expect(h.insert).toHaveBeenCalledTimes(1);expect(h.rpc).not.toHaveBeenCalled();
});
it.each([null,[],[{...level(400),is_break:'false'}],[{...level(400),ante:-1}],[{...level(400),big_blind:0}]].map(levels=>({levels})))('keeps the current blind draft when a club template has no verified levels: %j',async({levels})=>{
 h.flags.blindTemplates=true;
 h.read.mockImplementation((table:string)=>Promise.resolve({data:table==='tournaments'?{current_level:1,club_id:'club'}
  :table==='blind_structure_templates'?[{id:'bad-template',club_id:'club',name:'Mẫu hỏng',levels}]:[level(200)],error:null}));
 render(<BlindEditorPanel tournamentId="A"/>);
 await screen.findByDisplayValue('200');
 Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});
 fireEvent.keyDown(screen.getByRole('combobox'),{key:'ArrowDown'});
 fireEvent.click(await screen.findByRole('option',{name:'Mẫu hỏng'}));
 expect(screen.getByDisplayValue('200')).toBeInTheDocument();
 expect(h.success).not.toHaveBeenCalled();
 expect(h.error).toHaveBeenCalled();
 expect(h.rpc).not.toHaveBeenCalled();
});
it('loads a valid club template including zero-valued break fields without saving the tournament',async()=>{
 h.flags.blindTemplates=true;
 h.read.mockImplementation((table:string)=>Promise.resolve({data:table==='tournaments'?{current_level:1,club_id:'club'}
  :table==='blind_structure_templates'?[{id:'valid-template',club_id:'club',name:'Mẫu hợp lệ',levels:[level(400),{small_blind:0,big_blind:0,ante:0,duration_minutes:0,is_break:true}]}]:[level(200)],error:null}));
 render(<BlindEditorPanel tournamentId="A"/>);await screen.findByDisplayValue('200');
 Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});
 fireEvent.keyDown(screen.getByRole('combobox'),{key:'ArrowDown'});
 fireEvent.click(await screen.findByRole('option',{name:'Mẫu hợp lệ'}));
 expect(screen.getByDisplayValue('400')).toBeInTheDocument();
 expect(h.success).toHaveBeenCalledWith('Đã tải mẫu "Mẫu hợp lệ"');
 expect(h.error).not.toHaveBeenCalled();expect(h.rpc).not.toHaveBeenCalled();
});
it('keeps a genuine empty structure distinct from a missing response',async()=>{
 h.read.mockImplementation((table:string)=>Promise.resolve({data:table==='tournaments'?{current_level:1,club_id:'club'}:[],error:null}));
 render(<BlindEditorPanel tournamentId="A"/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Lưu'})).toBeEnabled());
 expect(screen.queryByRole('alert')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Lưu'}));
 expect(h.error).toHaveBeenCalledWith('Chưa có level nào.');
 expect(h.rpc).not.toHaveBeenCalled();
});
it('loads valid zero-valued fields without losing their meaning',async()=>{
 h.read.mockImplementation((table:string)=>Promise.resolve({data:table==='tournaments'?{current_level:1,club_id:'club'}:[{small_blind:0,big_blind:1,ante:0,duration_minutes:0,is_break:false}],error:null}));
 h.rpc.mockResolvedValue({data:{status:'success',levels_saved:1},error:null});
 render(<BlindEditorPanel tournamentId="A"/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Lưu'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Lưu'}));
 await waitFor(()=>expect(h.success).toHaveBeenCalled());
 expect(h.rpc).toHaveBeenCalledWith('update_blind_structure',{p_tournament_id:'A',p_levels:[{level_number:1,small_blind:0,big_blind:1,ante:0,duration_minutes:0,is_break:false}]});
});
it.each([null,[{...level(200),small_blind:null}],[{...level(200),ante:'oops'}],[{...level(200),is_break:'false'}]])('rejects malformed blind read instead of coercing it into an editable draft: %j',async(data)=>{
 h.read.mockImplementation((table:string)=>Promise.resolve({data:table==='tournaments'?{current_level:1,club_id:'club'}:data,error:null}));
 render(<BlindEditorPanel tournamentId="A"/>);
 await screen.findByRole('alert');
 expect(screen.getByRole('button',{name:'Lưu'})).toBeDisabled();
 expect(screen.queryByDisplayValue('200')).toBeNull();
 expect(h.rpc).not.toHaveBeenCalled();
});
it('does not let a slow previous tournament overwrite current blind drafts',async()=>{
 let resolve!:(v:unknown)=>void;const slow=new Promise(r=>{resolve=r;});
 h.read.mockImplementation((table:string,id:string)=>table==='tournaments'?Promise.resolve({data:{current_level:1,club_id:'club'},error:null})
  :id==='A'?slow:Promise.resolve({data:[level(800)],error:null}));
 const view=render(<BlindEditorPanel tournamentId="A"/>);view.rerender(<BlindEditorPanel tournamentId="B"/>);
 await screen.findByDisplayValue('800');resolve({data:[level(200)],error:null});
 await waitFor(()=>expect(screen.queryByDisplayValue('200')).toBeNull());
 expect(screen.getByDisplayValue('800')).toBeTruthy();
});
it('does not present failed tournament context as an editable verified structure',async()=>{
 h.read.mockImplementation((table:string)=>Promise.resolve(table==='tournaments'?{data:null,error:{message:'503'}}:{data:[level(200)],error:null}));
 render(<BlindEditorPanel tournamentId="A"/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Lưu'})).toHaveProperty('disabled',true));
 await screen.findByRole('alert');expect(screen.queryByDisplayValue('200')).toBeNull();
 expect(h.rpc).not.toHaveBeenCalled();
});
it('recovers an explicit failed read without issuing a mutation',async()=>{
 h.read.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({data:{current_level:1,club_id:'club'},error:null});
 render(<BlindEditorPanel tournamentId="A"/>);await screen.findByRole('alert');
 h.read.mockImplementation((table:string)=>Promise.resolve({data:table==='tournaments'?{current_level:1,club_id:'club'}:[level(400)],error:null}));
 fireEvent.click(screen.getByRole('button',{name:'Tải lại cấu trúc blind'}));
 await screen.findByDisplayValue('400');expect(screen.queryByRole('alert')).toBeNull();
 expect(screen.getByRole('button',{name:'Lưu'})).toHaveProperty('disabled',false);expect(h.rpc).not.toHaveBeenCalled();
});
it.each([null,{ok:true},{status:'pending',levels_saved:1},{status:'success',levels_saved:0}])('does not announce malformed blind save as success: %j',async(data)=>{
 h.read.mockImplementation((table:string)=>Promise.resolve({data:table==='tournaments'?{current_level:1,club_id:'club'}:[level(200)],error:null}));
 h.rpc.mockResolvedValue({data,error:null});render(<BlindEditorPanel tournamentId="A"/>);
 await screen.findByDisplayValue('200');fireEvent.click(screen.getByRole('button',{name:'Lưu'}));
 await waitFor(()=>expect(h.error).toHaveBeenCalled());expect(h.success).not.toHaveBeenCalled();
});
it('accepts the exact legacy saved-count contract without sending twice',async()=>{
 h.read.mockImplementation((table:string)=>Promise.resolve({data:table==='tournaments'?{current_level:1,club_id:'club'}:[level(200)],error:null}));
 h.rpc.mockResolvedValue({data:{status:'success',levels_saved:1},error:null});render(<BlindEditorPanel tournamentId="A"/>);
 await screen.findByDisplayValue('200');const save=screen.getByRole('button',{name:'Lưu'});fireEvent.click(save);fireEvent.click(save);
 await waitFor(()=>expect(h.success).toHaveBeenCalledWith('Đã lưu 1 level'));expect(h.rpc).toHaveBeenCalledTimes(1);
});
