import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({data:{categories:[],items:[],ingredients:[]} as unknown,isError:false,isLoading:false,isFetching:false,refetch:vi.fn(),rpc:vi.fn()}));
vi.mock('@/hooks/useFnbMenu',()=>({useFnbMenu:()=>h}));
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:vi.fn()})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc,storage:{from:vi.fn()}}}));
vi.mock('sonner',()=>({toast:{error:vi.fn(),success:vi.fn()}}));
vi.mock('./FnbGuestMenuPreviewDialog',()=>({FnbGuestMenuPreviewDialog:()=>null}));
import {CategoryManager} from './CategoryManager';
import {MenuManager} from './MenuManager';
import {IngredientManager} from './IngredientManager';
const cases=[['category',()=> <CategoryManager clubId="club-test"/>,'Thêm danh mục','Tên danh mục *'],['menu',()=> <MenuManager clubId="club-test" clubName="TEST"/>,'Thêm món','Tên món *'],['ingredient',()=> <IngredientManager clubId="club-test"/>,'Thêm nguyên liệu','Tên nguyên liệu *']] as const;
beforeEach(()=>{h.data={categories:[],items:[],ingredients:[]};h.isError=false;h.isLoading=false;h.refetch.mockReset();h.rpc.mockReset().mockResolvedValue({data:{ok:true},error:null});});
afterEach(cleanup);
it.each(cases)('blocks new %s actions until catalogue read is verified',(_name,view,add)=>{
 h.isError=true;h.data=undefined;const v=render(view());expect(screen.getByRole('button',{name:add})).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('Không tải được thực đơn');fireEvent.click(screen.getByRole('button',{name:'Thử tải lại thực đơn'}));expect(h.refetch).toHaveBeenCalledTimes(1);expect(h.rpc).not.toHaveBeenCalled();h.data={categories:[],items:[],ingredients:[]};h.isError=false;v.rerender(view());expect(screen.getByRole('button',{name:add})).toBeEnabled();
});
for(const state of ['error','loading'] as const)it.each(cases)(`preserves open %s draft but blocks save during ${state}`,(_name,view,add,label)=>{
 const v=render(view());fireEvent.click(screen.getByRole('button',{name:add}));fireEvent.change(screen.getByLabelText(label),{target:{value:'Unsent draft TEST'}});if(state==='error')h.isError=true;else h.isLoading=true;v.rerender(view());expect(screen.getByRole('button',{name:'Lưu'})).toBeDisabled();expect(screen.getByLabelText(label)).toHaveValue('Unsent draft TEST');if(_name==='menu')expect(screen.getByRole('button',{name:'Tải ảnh lên'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Lưu'}));expect(h.rpc).not.toHaveBeenCalled();const retry=screen.getByRole('button',{name:'Thử tải lại thực đơn'});if(state==='loading')expect(retry).toBeDisabled();else{fireEvent.click(retry);expect(h.refetch).toHaveBeenCalledTimes(1);}h.isError=false;h.isLoading=false;v.rerender(view());expect(screen.getByRole('button',{name:'Lưu'})).toBeEnabled();if(_name==='menu')expect(screen.getByRole('button',{name:'Tải ảnh lên'})).toBeEnabled();expect(screen.getByLabelText(label)).toHaveValue('Unsent draft TEST');
});

it.each(['','-100','5000.75','9007199254740992','1e309'])('does not coerce an invalid menu price into a different monetary intent: %s',async(price)=>{
 render(<MenuManager clubId="club-test" clubName="TEST"/>);fireEvent.click(screen.getByRole('button',{name:'Thêm món'}));fireEvent.change(screen.getByLabelText('Tên món *'),{target:{value:'Price intent TEST'}});fireEvent.change(screen.getByLabelText('Giá bán (₫) *'),{target:{value:price}});fireEvent.click(screen.getByRole('button',{name:'Lưu'}));await act(async()=>{});expect(h.rpc).not.toHaveBeenCalled();expect(screen.getByLabelText('Tên món *')).toHaveValue('Price intent TEST');
});
it.each([0,5000])('preserves an explicit valid integer price %s',async(price)=>{
 render(<MenuManager clubId="club-test" clubName="TEST"/>);fireEvent.click(screen.getByRole('button',{name:'Thêm món'}));fireEvent.change(screen.getByLabelText('Tên món *'),{target:{value:'Valid price TEST'}});fireEvent.change(screen.getByLabelText('Giá bán (₫) *'),{target:{value:String(price)}});fireEvent.click(screen.getByRole('button',{name:'Lưu'}));await act(async()=>{});expect(h.rpc).toHaveBeenCalledWith('fnb_upsert_menu_item',expect.objectContaining({p_price_vnd:price}));
});
