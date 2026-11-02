import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
const h=vi.hoisted(()=>({rpc:vi.fn(),refresh:vi.fn(),state:'ready',data:null as unknown}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>client}));
vi.mock('@/hooks/useTournamentRedrawTv',()=>({useTournamentRedrawTv:()=>({state:h.state,data:h.data,refresh:h.refresh})}));
const client={rpc:h.rpc};
import {MultiDayD2ContinuePanel} from './MultiDayD2ContinuePanel';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
beforeEach(()=>{sessionStorage.clear();h.rpc.mockReset();h.refresh.mockReset();h.state='ready';h.data={kind:'initial_d2',batchId:id(1),redrawRevision:2};vi.stubGlobal('crypto',{randomUUID:()=>id(4)});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('D2 Continue intent (modeled transport)',()=>{
 it('ignores an old completion after A to B to A and preserves the original journal',async()=>{
  let resolve!:(value:unknown)=>void;
  h.rpc.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  const onContinued=vi.fn();
  const view=render(<MultiDayD2ContinuePanel actorId={id(2)} tournamentId={id(3)} onContinued={onContinued}/>);
  fireEvent.click(screen.getByRole('button',{name:'Tiếp tục D2 sau xếp ghế'}));
  const key=`vinpoker:d2-continue:v1:${id(2)}:${id(3)}`,original=sessionStorage.getItem(key);
  h.data=null;h.state='empty';
  view.rerender(<MultiDayD2ContinuePanel actorId={id(5)} tournamentId={id(3)} onContinued={onContinued}/>);
  view.rerender(<MultiDayD2ContinuePanel actorId={id(2)} tournamentId={id(3)} onContinued={onContinued}/>);
  resolve({data:{ok:true,batch_id:id(1),redraw_revision:3,clock_resumed:false},error:null});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Thử lại đúng yêu cầu Continue'})).toBeTruthy());
  expect(sessionStorage.getItem(key)).toBe(original);expect(onContinued).not.toHaveBeenCalled();
  expect(screen.queryByText(/Đã kết thúc hiển thị/)).toBeNull();
 });
 it('does not replay the previous actor intent after an actor switch',async()=>{
  h.rpc.mockRejectedValue(new Error('lost'));
  const view=render(<MultiDayD2ContinuePanel actorId={id(2)} tournamentId={id(3)}/>);
  fireEvent.click(screen.getByRole('button',{name:'Tiếp tục D2 sau xếp ghế'}));
  await screen.findByRole('alert');
  h.data=null;h.state='empty';
  view.rerender(<MultiDayD2ContinuePanel actorId={id(5)} tournamentId={id(3)}/>);
  expect(screen.queryByRole('button',{name:'Thử lại đúng yêu cầu Continue'})).toBeNull();
  expect(sessionStorage.getItem(`vinpoker:d2-continue:v1:${id(2)}:${id(3)}`)).not.toBeNull();
  expect(sessionStorage.getItem(`vinpoker:d2-continue:v1:${id(5)}:${id(3)}`)).toBeNull();
 });
 it('notifies the parent only after a verified Continue receipt',async()=>{
  const onContinued=vi.fn();
  h.rpc.mockResolvedValueOnce({data:{ok:true},error:null}).mockResolvedValueOnce({data:{ok:true,batch_id:id(1),redraw_revision:3,clock_resumed:false},error:null});
  render(<MultiDayD2ContinuePanel actorId={id(2)} tournamentId={id(3)} onContinued={onContinued}/>);
  fireEvent.click(screen.getByRole('button',{name:'Tiếp tục D2 sau xếp ghế'}));
  await screen.findByRole('alert');expect(onContinued).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Thử lại đúng yêu cầu Continue'}));
  await waitFor(()=>expect(onContinued).toHaveBeenCalledTimes(1));
  expect(sessionStorage.length).toBe(0);
 });
 it('replays the same request after lost response/reload even when public hold is now empty',async()=>{
  h.rpc.mockRejectedValueOnce(new Error('lost after modeled commit')).mockResolvedValue({data:{ok:true,batch_id:id(1),redraw_revision:3,clock_resumed:false},error:null});
  const first=render(<MultiDayD2ContinuePanel actorId={id(2)} tournamentId={id(3)}/>);
  const button=screen.getByRole('button',{name:'Tiếp tục D2 sau xếp ghế'});fireEvent.click(button);fireEvent.click(button);
  await screen.findByRole('alert');expect(h.rpc).toHaveBeenCalledTimes(1);first.unmount();h.data=null;h.state='empty';
  render(<MultiDayD2ContinuePanel actorId={id(2)} tournamentId={id(3)}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Thử lại đúng yêu cầu Continue'}));
  await screen.findByText(/Đã kết thúc hiển thị xếp ghế D2/);
  expect(h.rpc).toHaveBeenCalledTimes(2);expect(h.rpc.mock.calls[0]).toEqual(h.rpc.mock.calls[1]);expect(sessionStorage.length).toBe(0);
 });
 it('rejects generic ok and keeps durable intent unresolved',async()=>{
  h.rpc.mockResolvedValue({data:{ok:true},error:null});render(<MultiDayD2ContinuePanel actorId={id(2)} tournamentId={id(3)}/>);
  fireEvent.click(screen.getByRole('button',{name:'Tiếp tục D2 sau xếp ghế'}));await screen.findByRole('alert');
  expect(sessionStorage.length).toBe(1);expect(screen.queryByText(/Đã kết thúc hiển thị/)).toBeNull();
 });
 it('never starts a new Continue from stale snapshot',async()=>{
  h.state='stale';render(<MultiDayD2ContinuePanel actorId={id(2)} tournamentId={id(3)}/>);
  expect(screen.getByRole('button',{name:'Tiếp tục D2 sau xếp ghế'})).toHaveProperty('disabled',true);
  await waitFor(()=>expect(h.rpc).not.toHaveBeenCalled());expect(screen.getByRole('alert')).toBeTruthy();
 });
});
