import {fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {ReactNode} from 'react';
import type {FnbLinkPlayer} from '@/hooks/useFnbLinkTargets';
type LinkData={tables:{id:string;table_name:string}[];players:FnbLinkPlayer[];unavailable_player_count?:number;unavailable_table_count?:number};
const h=vi.hoisted(()=>({links:{data:{tables:[{id:'table-a',table_name:'TEST Table'}],players:[]} as LinkData,isLoading:false,isError:false,refetch:vi.fn()},submit:vi.fn(),menu:{isError:false,refetch:vi.fn()}}));
vi.mock('@/hooks/useFnbLinkTargets',()=>({useFnbLinkTargets:()=>h.links}));
vi.mock('@/hooks/useFnbMenu',()=>({useFnbMenu:()=>({data:{categories:[],items:[{id:'item-a',name:'TEST Tea',price_vnd:10000,is_active:true}]},isLoading:false,...h.menu})}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{fnbTableLink:true,fnbComp:false}}));
vi.mock('@/components/ui/select',()=>({
 Select:({children,value,onValueChange,disabled}:{children:ReactNode;value:string;onValueChange:(value:string)=>void;disabled?:boolean})=><select aria-label="TEST table picker" value={value} disabled={disabled} onChange={e=>onValueChange(e.target.value)}>{children}</select>,
 SelectTrigger:()=>null,SelectValue:()=>null,SelectContent:({children}:{children:ReactNode})=><>{children}</>,
 SelectItem:({children,value}:{children:ReactNode;value:string})=><option value={value}>{children}</option>,
}));
import {OrderEntryPanel} from './OrderEntryPanel';
describe('F&B order linked-target availability',()=>{
 beforeEach(()=>{h.links={data:{tables:[{id:'table-a',table_name:'TEST Table'}],players:[]},isLoading:false,isError:false,refetch:vi.fn()};h.submit.mockReset();h.menu.isError=false;h.menu.refetch.mockReset();});
 const view=()=> <OrderEntryPanel clubId="club-a" submitting={false} resetKey={0} onSubmit={h.submit}/>;
 it('retains cart but prevents creating when the menu snapshot fails',()=>{
  const {rerender}=render(view());fireEvent.click(screen.getByRole('button',{name:/TEST Tea/}));
  h.menu.isError=true;rerender(view());expect(screen.getByRole('alert')).toHaveTextContent('Không tải được thực đơn');
  expect(screen.queryByRole('button',{name:'Tạo đơn & thu tiền'})).not.toBeInTheDocument();expect(h.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Thử tải lại thực đơn'}));expect(h.menu.refetch).toHaveBeenCalledTimes(1);
  h.menu.isError=false;rerender(view());fireEvent.click(screen.getByRole('button',{name:'Tạo đơn & thu tiền'}));
  expect(h.submit).toHaveBeenCalledWith(expect.objectContaining({items:[expect.objectContaining({qty:1,unit_price_snapshot:10000})]}));
 });
 it('shows explicit retry for unavailable targets without forcing a walk-in order to wait',()=>{
  h.links.isError=true;
  render(view());
  expect(screen.getByRole('alert')).toHaveTextContent('Không xác minh được danh sách bàn/người chơi');
  fireEvent.click(screen.getByRole('button',{name:'Thử tải lại bàn/người chơi'}));
  expect(h.links.refetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:/TEST Tea/}));
  fireEvent.click(screen.getByRole('button',{name:'Tạo đơn & thu tiền'}));
  expect(h.submit).toHaveBeenCalledWith(expect.objectContaining({table_ref:null,player_ref:null}));
 });
 it('announces loading rather than treating targets as verified empty',()=>{
  h.links.isLoading=true;render(view());
  expect(screen.getByRole('status')).toHaveTextContent('Đang tải bàn/người chơi');
  expect(screen.getByRole('combobox')).toBeDisabled();
 });
 it('blocks a previously selected link after failed refresh, retaining cart until recovery',()=>{
  const {rerender}=render(view());
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'table-a'}});
  fireEvent.click(screen.getByRole('button',{name:/TEST Tea/}));
  h.links.isError=true;rerender(view());
  expect(screen.getByRole('button',{name:'Tạo đơn & thu tiền'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Tạo đơn & thu tiền'}));
  expect(h.submit).not.toHaveBeenCalled();
  h.links.isError=false;rerender(view());
  fireEvent.click(screen.getByRole('button',{name:'Tạo đơn & thu tiền'}));
  expect(h.submit).toHaveBeenCalledWith(expect.objectContaining({table_ref:'table-a',items:[expect.objectContaining({qty:1})]}));
 });
 it('requires a fresh choice if the selected table disappears on successful refresh',()=>{
  const {rerender}=render(view());
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'table-a'}});
  fireEvent.click(screen.getByRole('button',{name:/TEST Tea/}));
  h.links.data={tables:[],players:[]};rerender(view());
  expect(screen.getByRole('alert')).toHaveTextContent('không còn trong danh sách');
  expect(screen.getByRole('button',{name:'Tạo đơn & thu tiền'})).toBeDisabled();
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'__walkin__'}});
  fireEvent.click(screen.getByRole('button',{name:'Tạo đơn & thu tiền'}));
  expect(h.submit).toHaveBeenCalledWith(expect.objectContaining({table_ref:null}));
 });
 it('selects the displayed location rather than the first row for a repeated player',()=>{
  h.links.data.tables.push({id:'table-b',table_name:'TEST Table B'});
  h.links.data.players=[
   {player_id:'player-a',name:'TEST Player',table_id:'table-a',table_name:'TEST Table',seat_number:1},
   {player_id:'player-a',name:'TEST Player',table_id:'table-b',table_name:'TEST Table B',seat_number:2},
  ];
  render(view());
  const option=screen.getByRole('option',{name:'TEST Player · TEST Table B #2'}) as HTMLOptionElement;
  fireEvent.change(screen.getAllByRole('combobox')[1],{target:{value:option.value}});
  fireEvent.click(screen.getByRole('button',{name:/TEST Tea/}));
  fireEvent.click(screen.getByRole('button',{name:'Tạo đơn & thu tiền'}));
  expect(h.submit).toHaveBeenCalledWith(expect.objectContaining({table_ref:'table-b',player_ref:'player-a'}));
 });
 it('does not silently reuse a moved player selection after refresh',()=>{
  h.links.data.tables.push({id:'table-b',table_name:'TEST Table B'});
  h.links.data.players=[{player_id:'player-a',name:'TEST Player',table_id:'table-a',table_name:'TEST Table',seat_number:1}];
  const {rerender}=render(view());
  const option=screen.getByRole('option',{name:'TEST Player · TEST Table #1'}) as HTMLOptionElement;
  fireEvent.change(screen.getAllByRole('combobox')[1],{target:{value:option.value}});
  fireEvent.click(screen.getByRole('button',{name:/TEST Tea/}));
  h.links.data.players=[{player_id:'player-a',name:'TEST Player',table_id:'table-b',table_name:'TEST Table B',seat_number:2}];
  rerender(view());
  expect(screen.getByRole('button',{name:'Tạo đơn & thu tiền'})).toBeDisabled();
  expect(h.submit).not.toHaveBeenCalled();
 });
 it('marks indistinguishable legacy locations instead of choosing an arbitrary row',()=>{
  const p={player_id:'player-a',name:'TEST Player',table_id:'table-a',table_name:'TEST Table',seat_number:1};
  h.links.data.players=[p,{...p}];
  render(view());
  expect(screen.getByRole('alert')).toHaveTextContent('Không xác định duy nhất');
  expect(screen.queryAllByRole('option',{name:/TEST Player/})).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:/TEST Tea/}));
  fireEvent.click(screen.getByRole('button',{name:'Tạo đơn & thu tiền'}));
  expect(h.submit).toHaveBeenCalledWith(expect.objectContaining({table_ref:null,player_ref:null}));
 });
 it('does not link a player whose table is missing from the authorized table list',()=>{
  h.links.data.players=[{player_id:'player-a',name:'TEST Player',table_id:'missing-table',table_name:'Unavailable',seat_number:1}];
  render(view());
  expect(screen.getByRole('alert')).toHaveTextContent('Không xác định duy nhất');
  expect(screen.queryByRole('option',{name:/TEST Player/})).not.toBeInTheDocument();
 });
 it('clears the player link when the operator explicitly chooses another table',()=>{
  h.links.data.tables.push({id:'table-b',table_name:'TEST Table B'});
  h.links.data.players=[{player_id:'player-a',name:'TEST Player',table_id:'table-a',table_name:'TEST Table',seat_number:1}];
  render(view());
  const option=screen.getByRole('option',{name:'TEST Player · TEST Table #1'}) as HTMLOptionElement;
  fireEvent.change(screen.getAllByRole('combobox')[1],{target:{value:option.value}});
  fireEvent.change(screen.getAllByRole('combobox')[0],{target:{value:'table-b'}});
  fireEvent.click(screen.getByRole('button',{name:/TEST Tea/}));
  fireEvent.click(screen.getByRole('button',{name:'Tạo đơn & thu tiền'}));
  expect(h.submit).toHaveBeenCalledWith(expect.objectContaining({table_ref:'table-b',player_ref:null}));
 });
 it('does not carry a selection to a new entry/session at the same numbered seat',()=>{
  const p={player_id:'player-a',name:'TEST Player',table_id:'table-a',table_name:'TEST Table',seat_number:1,
   seat_id:'seat-old',entry_id:'entry-old',table_session_id:'session-old'};
  h.links.data.players=[p];
  const {rerender}=render(view());
  const option=screen.getByRole('option',{name:'TEST Player · TEST Table #1'}) as HTMLOptionElement;
  fireEvent.change(screen.getAllByRole('combobox')[1],{target:{value:option.value}});
  fireEvent.click(screen.getByRole('button',{name:/TEST Tea/}));
  h.links.data.players=[{...p,seat_id:'seat-new',entry_id:'entry-new',table_session_id:'session-new'}];
  rerender(view());
  expect(screen.getByRole('button',{name:'Tạo đơn & thu tiền'})).toBeDisabled();
  expect(h.submit).not.toHaveBeenCalled();
 });
 it('announces server-excluded seats and tables even when the verified lists are empty',()=>{
  h.links.data={tables:[],players:[],unavailable_player_count:4,unavailable_table_count:2};
  render(view());
  expect(screen.getAllByRole('alert')).toHaveLength(2);
  expect(screen.getByText(/Không xác định duy nhất bàn\/ghế của 4/)).toBeInTheDocument();
  expect(screen.getByText(/Có 2 bàn chưa xác minh/)).toBeInTheDocument();
 });
});
