// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {MediaClubSchedules} from './MediaClubSchedules';
import {seriesReorderJournalKey} from '@/lib/seriesReorder';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),update:vi.fn(),error:vi.fn(),success:vi.fn(),warning:vi.fn(),rows:[] as Array<{id:string;club_id:string;image_url:string;caption:null;position:number}>,actor:'ee920000-0000-4000-8000-000000000001',club:'ee920000-0000-4000-8000-000000000002'}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mocks.actor}})}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{clubSeriesSchedule:true}}));
vi.mock('sonner',()=>({toast:{error:mocks.error,success:mocks.success,warning:mocks.warning}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mocks.rpc,from:(table:string)=>table==='clubs'?{
 select:()=>({eq:()=>({order:async()=>({data:[{id:mocks.club,name:'Reorder TEST',region:'TEST',daily_schedule_image_url:null,weekly_schedule_image_url:null}],error:null})})}),
}:{select:()=>({in:()=>({order:async()=>({data:mocks.rows.map(x=>({...x})).sort((a,b)=>a.position-b.position),error:null})})}),update:mocks.update},
}}));
afterEach(cleanup);
beforeEach(()=>{
 vi.clearAllMocks();sessionStorage.clear();mocks.actor='ee920000-0000-4000-8000-000000000001';
 mocks.rows=[{id:'ee920000-0000-4000-8000-000000000003',club_id:mocks.club,image_url:'https://example.test/a.jpg',caption:null,position:0},{id:'ee920000-0000-4000-8000-000000000004',club_id:mocks.club,image_url:'https://example.test/b.jpg',caption:null,position:1}];
 mocks.rpc.mockImplementation(async(_name:string,r:{p_order:string[];p_request_id:string;p_club_id:string})=>{
  r.p_order.forEach((id,position)=>{mocks.rows.find(x=>x.id===id)!.position=position;});
  return {data:{ok:true,actor_id:mocks.actor,club_id:r.p_club_id,request_id:r.p_request_id,order:r.p_order},error:null};
 });
});
async function moveFirst(){
 render(<MediaClubSchedules/>);await screen.findByText('Reorder TEST');
 fireEvent.click(screen.getAllByRole('button',{name:'Tiến'})[0]);
 await waitFor(()=>expect(mocks.rpc).toHaveBeenCalled());
}
describe('series reorder canonical contract',()=>{
 it('synchronous double click submits only one writer',async()=>{
  let resolve!:(value:unknown)=>void;
  mocks.rpc.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  render(<MediaClubSchedules/>);await screen.findByText('Reorder TEST');
  const button=screen.getAllByRole('button',{name:'Tiến'})[0];
  fireEvent.click(button);fireEvent.click(button);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  const request=mocks.rpc.mock.calls[0][1];
  await act(async()=>resolve({data:{ok:true,actor_id:mocks.actor,club_id:request.p_club_id,request_id:request.p_request_id,order:request.p_order},error:null}));
 });
 it('ignores a previous-account completion without clearing its recovery journal',async()=>{
  let resolve!:(value:unknown)=>void;
  mocks.rpc.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const view=render(<MediaClubSchedules/>);await screen.findByText('Reorder TEST');
  fireEvent.click(screen.getAllByRole('button',{name:'Tiến'})[0]);
  const actor=mocks.actor,request=mocks.rpc.mock.calls[0][1];
  mocks.actor='ee920000-0000-4000-8000-000000000099';view.rerender(<MediaClubSchedules/>);
  await act(async()=>resolve({data:{ok:true,actor_id:actor,club_id:request.p_club_id,request_id:request.p_request_id,order:request.p_order},error:null}));
  await screen.findByText('Reorder TEST');
  expect(mocks.success).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(seriesReorderJournalKey(actor))).toBeTruthy();
 });
 it('submits one atomic intent, never individual position updates',async()=>{
  await moveFirst();await waitFor(()=>expect(mocks.success).toHaveBeenCalledOnce());
  expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(mocks.rpc.mock.calls[0][0]).toBe('reorder_club_series_images_v1');
  expect(mocks.update).not.toHaveBeenCalled();expect(mocks.rows.map(x=>x.position)).toEqual([1,0]);
  expect(sessionStorage.getItem(seriesReorderJournalKey(mocks.actor))).toBeNull();
 });
 it('shows a business rejection without pretending the order committed',async()=>{
  mocks.rpc.mockResolvedValue({data:{ok:false,error:'reorder_conflict'},error:null});await moveFirst();
  await waitFor(()=>expect(mocks.error).toHaveBeenCalled());expect(mocks.success).not.toHaveBeenCalled();
  expect(mocks.rows.map(x=>x.position)).toEqual([0,1]);expect(mocks.update).not.toHaveBeenCalled();
 });
 it('reconciles a lost response by receipt only with the identical payload',async()=>{
  mocks.rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));await moveFirst();
  await waitFor(()=>expect(mocks.success).toHaveBeenCalledOnce());
  expect(mocks.rpc.mock.calls.map(x=>x[0])).toEqual(['reorder_club_series_images_v1','get_club_series_reorder_receipt_v1']);
  expect(mocks.rpc.mock.calls[1][1]).toEqual(mocks.rpc.mock.calls[0][1]);
 });
 it('keeps an unknown request across remount and checks without a second writer',async()=>{
  mocks.rpc.mockRejectedValue(new TypeError('Failed to fetch'));await moveFirst();
  await waitFor(()=>expect(mocks.error).toHaveBeenCalled());
  const raw=sessionStorage.getItem(seriesReorderJournalKey(mocks.actor));expect(raw).toBeTruthy();
  cleanup();mocks.rpc.mockClear();render(<MediaClubSchedules/>);
  const check=await screen.findByRole('button',{name:'Check previous reorder'});fireEvent.click(check);
  await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledTimes(1));
  expect(mocks.rpc.mock.calls[0]).toEqual(['get_club_series_reorder_receipt_v1',JSON.parse(raw!)]);
 });
});
