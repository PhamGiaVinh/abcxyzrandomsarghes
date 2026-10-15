// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {MediaClubSchedules} from './MediaClubSchedules';
const mocks=vi.hoisted(()=>({upload:vi.fn(),insert:vi.fn(),success:vi.fn(),error:vi.fn(),warning:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'ee920000-0000-4000-8000-000000000001'}})}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{clubSeriesSchedule:true}}));
vi.mock('@/lib/compressImage',()=>({compressImage:vi.fn(async(file:File)=>file)}));
vi.mock('sonner',()=>({toast:{success:mocks.success,error:mocks.error,warning:mocks.warning}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 storage:{from:()=>({upload:mocks.upload,getPublicUrl:(path:string)=>({data:{publicUrl:`https://example.test/${path}`}})})},
 from:(table:string)=>table==='clubs'?{select:()=>({eq:()=>({order:async()=>({data:[{id:'club-test',name:'Upload TEST',region:'TEST',daily_schedule_image_url:null,weekly_schedule_image_url:null}],error:null})})})}:{select:()=>({in:()=>({order:async()=>({data:[],error:null})})}),insert:mocks.insert},
}}));
afterEach(cleanup);
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();mocks.upload.mockResolvedValue({error:null});mocks.insert.mockResolvedValue({error:null});});
async function uploadTwo(){
 render(<MediaClubSchedules/>);
 const label=(await screen.findByText('Tải nhiều ảnh')).closest('label');
 const input=label?.querySelector('input');expect(input).toBeTruthy();
 fireEvent.change(input!,{target:{files:[new File(['a'],'a.jpg',{type:'image/jpeg'}),new File(['b'],'b.jpg',{type:'image/jpeg'})]}});
 await waitFor(()=>expect(screen.getByText('Tải nhiều ảnh').closest('label')?.querySelector('input')).not.toBeDisabled());
}
describe('series upload result matches actual publication',()=>{
 it('never reports success when every storage upload fails',async()=>{
  mocks.upload.mockResolvedValue({error:{message:'storage unavailable'}});await uploadTwo();
  expect(mocks.insert).not.toHaveBeenCalled();expect(mocks.success).not.toHaveBeenCalled();expect(mocks.error).toHaveBeenCalled();
 });
 it('never reports success when every database insert fails',async()=>{
  mocks.insert.mockResolvedValue({error:{message:'publication denied'}});await uploadTwo();
  expect(mocks.insert).toHaveBeenCalledTimes(2);expect(mocks.success).not.toHaveBeenCalled();expect(mocks.error).toHaveBeenCalled();
 });
 it('reports partial publication rather than full success',async()=>{
  mocks.insert.mockResolvedValueOnce({error:null}).mockResolvedValueOnce({error:{message:'publication denied'}});await uploadTwo();
  expect(mocks.success).not.toHaveBeenCalled();expect(mocks.warning).toHaveBeenCalled();
 });
 it('reports success only when both publications succeeded',async()=>{
  await uploadTwo();expect(mocks.insert).toHaveBeenCalledTimes(2);expect(mocks.success).toHaveBeenCalledOnce();expect(mocks.warning).not.toHaveBeenCalled();
 });
 it('contains rejected publication as unknown without retry or false success',async()=>{
  mocks.insert.mockRejectedValueOnce(new TypeError('Failed to fetch'));await uploadTwo();
  expect(mocks.insert).toHaveBeenCalledTimes(1);expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(mocks.success).not.toHaveBeenCalled();expect(mocks.error).toHaveBeenCalled();
 });
});
