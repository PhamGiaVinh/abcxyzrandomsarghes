import {act,cleanup,fireEvent,render,renderHook,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const io=vi.hoisted(()=>({read:vi.fn(),rpc:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:null,session:null})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 from:(table:string)=>{
  if(table!=='app_settings')throw Error('Unexpected table '+table);
  let signal:AbortSignal|undefined;
  const b={select:()=>b,eq:()=>b,maybeSingle:()=>b,
   abortSignal:(nextSignal:AbortSignal)=>{signal=nextSignal;return b;},
   then:(resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown)=>Promise.resolve(io.read(signal)).then(resolve,reject)};
  return b;
 },rpc:io.rpc,
}}));
vi.mock('./FeatureTableManageDialog',()=>({FeatureTableManageDialog:()=>null}));
import {useFeatureEnforcementEnabled} from './featureTableMock';
import {FeatureTablePoolBox} from './FeatureTablePoolBox';
import {FeatureTableConfigDialog} from './FeatureTableConfigDialog';

type Packet={data:unknown;error:unknown};
function deferred(){let resolve!:(v:Packet)=>void;const promise=new Promise<Packet>(r=>resolve=r);return {promise,resolve};}
beforeEach(()=>{
 io.read.mockReset();io.rpc.mockReset();
 io.rpc.mockResolvedValue({data:{club_id:'11111111-1111-4111-8111-111111111111',as_of:'2026-10-25T00:00:00Z',tables:[]},error:null});
});
afterEach(()=>{cleanup();vi.useRealTimers();});

describe('feature enforcement flag read819 (mock transport, not database acceptance)',()=>{
 it.each([true,false])('accepts verified JSON boolean %s',async(value)=>{
  io.read.mockResolvedValue({data:{value},error:null});
  const {result}=renderHook(()=>useFeatureEnforcementEnabled());
  await waitFor(()=>expect(result.current.loading).toBe(false));expect(result.current.enabled).toBe(value);expect(result.current.error).toBeNull();
 });
 it('preserves backend OFF default only for a successful missing-row response',async()=>{
  io.read.mockResolvedValue({data:null,error:null});const {result}=renderHook(()=>useFeatureEnforcementEnabled());
  await waitFor(()=>expect(result.current.loading).toBe(false));expect(result.current.enabled).toBe(false);expect(result.current.error).toBeNull();
 });
 it.each([{data:null,error:{message:'503 backend unavailable'}},{data:{value:false},error:{message:'denied'}}])(
  'keeps read failure unknown rather than coercing it OFF %#',async(packet)=>{
   io.read.mockResolvedValue(packet);const {result}=renderHook(()=>useFeatureEnforcementEnabled());
   await waitFor(()=>expect(result.current.loading).toBe(false));expect(result.current.enabled).toBeNull();expect(result.current.error).toBeTruthy();
  });
 it.each([{},[],{value:'true'},{value:'false'},{value:null},{value:1}])('rejects unverified flag shapes %#',async(data)=>{
  io.read.mockResolvedValue({data,error:null});const {result}=renderHook(()=>useFeatureEnforcementEnabled());
  await waitFor(()=>expect(result.current.loading).toBe(false));expect(result.current.enabled).toBeNull();expect(result.current.error).toBeTruthy();
 });
 it('settles promise rejection with retryable unknown state',async()=>{
  io.read.mockRejectedValue(Error('connection lost'));const {result}=renderHook(()=>useFeatureEnforcementEnabled());
  await waitFor(()=>expect(result.current.loading).toBe(false));expect(result.current.enabled).toBeNull();expect(result.current.error).toBeTruthy();
 });
 it('bounds a stalled read even if the transport ignores abort',async()=>{
  vi.useFakeTimers();io.read.mockReturnValue(new Promise(()=>{}));const {result,unmount}=renderHook(()=>useFeatureEnforcementEnabled());
  await act(async()=>{await vi.advanceTimersByTimeAsync(15_001);});
  expect(result.current.loading).toBe(false);expect(result.current.enabled).toBeNull();expect(result.current.error).toBeTruthy();
  expect(io.read.mock.calls[0][0].aborted).toBe(true);unmount();expect(vi.getTimerCount()).toBe(0);
 });
 it('ignores an old response after an explicit new read',async()=>{
  const old=deferred();io.read.mockReturnValueOnce(old.promise).mockResolvedValue({data:{value:true},error:null});
  const {result}=renderHook(()=>useFeatureEnforcementEnabled());await act(async()=>{await result.current.refetch();});
  expect(result.current.enabled).toBe(true);await act(async()=>old.resolve({data:{value:false},error:null}));expect(result.current.enabled).toBe(true);
 });
 it('aborts its pending request and clears its deadline on unmount',async()=>{
  vi.useFakeTimers();const late=deferred();io.read.mockReturnValue(late.promise);
  const {unmount}=renderHook(()=>useFeatureEnforcementEnabled());await act(async()=>{});expect(io.read.mock.calls[0][0]).toBeDefined();
  unmount();expect(io.read.mock.calls[0][0].aborted).toBe(true);await act(async()=>late.resolve({data:{value:true},error:null}));expect(vi.getTimerCount()).toBe(0);
 });
});

describe('actual feature notices819',()=>{
 it('shows unknown and manual read recovery in the summary without an OFF claim',async()=>{
  io.read.mockResolvedValueOnce({data:null,error:{message:'503'}}).mockResolvedValue({data:{value:false},error:null});
  render(<FeatureTablePoolBox clubId="11111111-1111-4111-8111-111111111111" tables={[]} dealers={[]}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Không xác minh được');
  expect(screen.queryByText('enforcement đang TẮT')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Thử lại trạng thái bảo vệ'}));
  expect(await screen.findByText('enforcement đang TẮT')).toBeInTheDocument();expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(io.read).toHaveBeenCalledTimes(2);
 });
 it('does not claim OFF while the read is pending',async()=>{
  io.read.mockReturnValue(new Promise(()=>{}));render(<FeatureTablePoolBox clubId="11111111-1111-4111-8111-111111111111" tables={[]} dealers={[]}/>);
  await act(async()=>{});
  expect(screen.getByRole('status')).toHaveTextContent('Đang xác minh');expect(screen.queryByText('enforcement đang TẮT')).not.toBeInTheDocument();
 });
 it('also reports unknown in the actual config dialog without saving anything',async()=>{
  io.read.mockResolvedValue({data:null,error:{message:'permission denied'}});
  render(<FeatureTableConfigDialog open onOpenChange={()=>{}} tableId="table" tableName="TEST table" clubId="club" dealers={[]}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Không xác minh được');
  expect(screen.queryByText('enforcement đang TẮT')).not.toBeInTheDocument();expect(io.rpc).not.toHaveBeenCalled();
 });
});
