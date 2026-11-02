import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {ReactNode} from 'react';
const h=vi.hoisted(()=>({read:vi.fn(),rpc:vi.fn(),menuError:false,reload:vi.fn(),signals:[] as AbortSignal[]}));
vi.mock('@/hooks/useFnbMenu',()=>({useFnbMenu:()=>({data:{items:[{id:'item-a',name:'Item A'},{id:'item-b',name:'Item B'}],ingredients:[{id:'ing-a',name:'Ingredient A',stock_unit:'unit',is_active:true}]},isLoading:false,isError:h.menuError,refetch:h.reload})}));
vi.mock('sonner',()=>({toast:{error:vi.fn(),success:vi.fn()}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc,from:()=>{let id='';const q={select:()=>q,eq:(_key:string,value:string)=>{id=value;return q;},abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return q;},then:(resolve:(x:unknown)=>unknown,reject:(x:unknown)=>unknown)=>h.read(id).then(resolve,reject)};return q;}}}));
vi.mock('@/components/ui/select',()=>({Select:({children,value,onValueChange,disabled}:{children:ReactNode;value:string;onValueChange:(v:string)=>void;disabled?:boolean})=><select aria-label="TEST recipe picker" value={value} disabled={disabled} onChange={e=>onValueChange(e.target.value)}><option value=""/>{children}</select>,SelectTrigger:()=>null,SelectValue:()=>null,SelectContent:({children}:{children:ReactNode})=><>{children}</>,SelectItem:({children,value}:{children:ReactNode;value:string})=><option value={value}>{children}</option>}));
import {RecipeEditor} from './RecipeEditor';
beforeEach(()=>{h.menuError=false;h.signals=[];h.reload.mockReset();h.read.mockReset().mockResolvedValue({data:[],error:null});h.rpc.mockReset().mockResolvedValue({data:{ok:true},error:null});});
afterEach(()=>{cleanup();vi.useRealTimers();});
const choose=(id='item-a')=>fireEvent.change(screen.getAllByRole('combobox')[0],{target:{value:id}});
it.each([{data:null,error:{message:'offline'}},{data:null,error:null}])('does not offer an empty recipe or clear writer after a failed recipe read: %j',async(reply)=>{
 h.read.mockResolvedValue(reply);render(<RecipeEditor clubId="club-a"/>);choose();
 await screen.findByText(/Món này chưa có công thức|Không tải được công thức/);
 const save=screen.queryByRole('button',{name:'Lưu công thức'});if(save)fireEvent.click(save);
 expect(h.rpc).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('Không tải được công thức');
});
it('does not let an old item reply overwrite the selected recipe',async()=>{
 let finishA!:(x:unknown)=>void;h.read.mockImplementation((id:string)=>id==='item-a'?new Promise(r=>{finishA=r;}):Promise.resolve({data:[{ingredient_id:'ing-a',qty:2}],error:null}));render(<RecipeEditor clubId="club-a"/>);choose();await waitFor(()=>expect(h.read).toHaveBeenCalledWith('item-a'));choose('item-b');await screen.findByDisplayValue('2');
 await act(async()=>{finishA({data:[{ingredient_id:'ing-a',qty:99}],error:null});});expect(screen.getByDisplayValue('2')).toBeInTheDocument();expect(screen.queryByDisplayValue('99')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Lưu công thức'}));await waitFor(()=>expect(h.rpc).toHaveBeenCalledWith('fnb_set_recipe',{p_menu_item_id:'item-b',p_items:[{ingredient_id:'ing-a',qty:2}]}));
});
it('allows an explicitly verified empty recipe to retain existing clear semantics',async()=>{render(<RecipeEditor clubId="club-a"/>);choose();await screen.findByText(/Món này chưa có công thức/);fireEvent.click(screen.getByRole('button',{name:'Lưu công thức'}));await waitFor(()=>expect(h.rpc).toHaveBeenCalledWith('fnb_set_recipe',{p_menu_item_id:'item-a',p_items:[]}));});
it('bounds the recipe read and preserves error until explicit retry',async()=>{
 vi.useFakeTimers();let finish!:(x:unknown)=>void;h.read.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));render(<RecipeEditor clubId="club-a"/>);choose();await act(async()=>{});await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});expect(screen.getByRole('alert')).toHaveTextContent('Không tải được công thức');expect(h.signals[0].aborted).toBe(true);
 await act(async()=>{finish({data:[{ingredient_id:'ing-a',qty:99}],error:null});});expect(screen.queryByDisplayValue('99')).not.toBeInTheDocument();h.read.mockResolvedValue({data:[],error:null});fireEvent.click(screen.getByRole('button',{name:'Thử tải lại công thức'}));await act(async()=>{});expect(screen.getByText(/Món này chưa có công thức/)).toBeInTheDocument();
});
it('blocks the recipe writer while the catalogue is unavailable without clearing a draft',async()=>{
 h.read.mockResolvedValue({data:[{ingredient_id:'ing-a',qty:3}],error:null});const v=render(<RecipeEditor clubId="club-a"/>);choose();await screen.findByDisplayValue('3');h.menuError=true;v.rerender(<RecipeEditor clubId="club-a"/>);expect(screen.getByRole('alert')).toHaveTextContent('Không tải được thực đơn');expect(screen.queryByRole('button',{name:'Lưu công thức'})).not.toBeInTheDocument();expect(h.rpc).not.toHaveBeenCalled();h.menuError=false;v.rerender(<RecipeEditor clubId="club-a"/>);expect(screen.getByDisplayValue('3')).toBeInTheDocument();
});
