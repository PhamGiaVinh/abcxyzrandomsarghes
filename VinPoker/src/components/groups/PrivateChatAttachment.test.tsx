import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({actor:'actor-a' as string|null,session:'session-a',loading:false,sign:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:h.actor?{id:h.actor}:null,session:{access_token:h.session},loading:h.loading})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{storage:{from:(bucket:string)=>({createSignedUrl:(path:string,seconds:number)=>h.sign(bucket,path,seconds)})}}}));
vi.mock('./MessageAttachment',()=>({MessageAttachment:({url,onLoadError}:{url:string;onLoadError?:()=>void})=><img alt="TEST resolved attachment" src={url} onError={onLoadError}/> }));
import {PrivateChatAttachment} from './PrivateChatAttachment';
import {privateChatAttachmentReference} from '@/lib/chatAttachment';
const owner='a364de8e-06b1-4428-a20d-ac614ec406e5',chat='a0000000-0000-4000-8000-000000000001',path=`${owner}/dm/${chat}/asset.png`;
const props={reference:privateChatAttachmentReference(path),scope:{kind:'dm' as const,id:chat},type:'image'};
function deferred(){let resolve!:(v:unknown)=>void;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
beforeEach(()=>{h.actor='actor-a';h.session='session-a';h.loading=false;h.sign.mockReset().mockResolvedValue({data:{signedUrl:'https://test.invalid/signed-A'},error:null});Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});Object.defineProperty(navigator,'onLine',{configurable:true,value:true});});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('private attachment signed read lifetime',()=>{
 it('signs the exact object for60seconds without storing the URL',async()=>{
  const write=vi.spyOn(Storage.prototype,'setItem');
  try{
  render(<PrivateChatAttachment {...props}/>);
  expect(await screen.findByAltText('TEST resolved attachment')).toHaveAttribute('src','https://test.invalid/signed-A');
  expect(h.sign).toHaveBeenCalledWith('chat-private-v1',path,60);
  expect(write).not.toHaveBeenCalled();
  }finally{write.mockRestore();}
 });
 it('shows an explicit retry when signed image bytes fail instead of leaving a broken image',async()=>{
  render(<PrivateChatAttachment {...props}/>);
  fireEvent.error(await screen.findByAltText('TEST resolved attachment'));
  expect(screen.queryByAltText('TEST resolved attachment')).toBeNull();expect(screen.getByRole('alert')).toHaveTextContent('Không xác minh');
  fireEvent.click(screen.getByRole('button',{name:'Thử mở tệp riêng'}));
  await screen.findByAltText('TEST resolved attachment');expect(h.sign).toHaveBeenCalledTimes(2);
 });
 it.each(['actor','session'] as const)('clears prior bearer URL immediately when %s changes and ignores late old response',async change=>{
  const old=deferred();h.sign.mockReturnValueOnce(old.promise);
  const view=render(<PrivateChatAttachment {...props}/>);
  await waitFor(()=>expect(h.sign).toHaveBeenCalledTimes(1));
  if(change==='actor')h.actor='actor-b';else h.session='session-b';
  h.sign.mockResolvedValueOnce({data:{signedUrl:'https://test.invalid/new-scope'},error:null});view.rerender(<PrivateChatAttachment {...props}/>);
  expect(screen.queryByAltText('TEST resolved attachment')).toBeNull();
  await screen.findByAltText('TEST resolved attachment');
  await act(async()=>old.resolve({data:{signedUrl:'https://test.invalid/late-old'},error:null}));
  expect(screen.getByAltText('TEST resolved attachment')).toHaveAttribute('src','https://test.invalid/new-scope');
 });
 it('clears an already displayed URL on logout without another signing call',async()=>{
  const view=render(<PrivateChatAttachment {...props}/>);await screen.findByAltText('TEST resolved attachment');
  h.actor=null;view.rerender(<PrivateChatAttachment {...props}/>);
  expect(screen.queryByAltText('TEST resolved attachment')).toBeNull();expect(h.sign).toHaveBeenCalledTimes(1);
 });
 it('does not sign another conversation reference or while Auth is loading',()=>{
  const view=render(<PrivateChatAttachment {...props} scope={{kind:'groups',id:chat}}/>);
  expect(screen.getByRole('alert')).toHaveTextContent('không thuộc');expect(h.sign).not.toHaveBeenCalled();
  h.loading=true;view.rerender(<PrivateChatAttachment {...props}/>);expect(h.sign).not.toHaveBeenCalled();
 });
 it('ends a hung read and ignores its late signed URL after deliberate retry',async()=>{
  vi.useFakeTimers();const old=deferred();h.sign.mockReturnValueOnce(old.promise);
  render(<PrivateChatAttachment {...props}/>);
  await act(async()=>vi.advanceTimersByTimeAsync(20000));
  expect(screen.getByRole('alert')).toHaveTextContent('Không xác minh');
  fireEvent.click(screen.getByRole('button',{name:'Thử mở tệp riêng'}));await act(async()=>vi.advanceTimersByTimeAsync(1));
  expect(screen.getByAltText('TEST resolved attachment')).toHaveAttribute('src','https://test.invalid/signed-A');
  await act(async()=>old.resolve({data:{signedUrl:'https://test.invalid/late'},error:null}));
  expect(screen.getByAltText('TEST resolved attachment')).toHaveAttribute('src','https://test.invalid/signed-A');
 });
 it('expires a hidden-tab URL without renewal and refreshes on return',async()=>{
  vi.useFakeTimers();render(<PrivateChatAttachment {...props}/>);await act(async()=>vi.advanceTimersByTimeAsync(1));
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
  await act(async()=>vi.advanceTimersByTimeAsync(60000));
  expect(screen.queryByAltText('TEST resolved attachment')).toBeNull();expect(h.sign).toHaveBeenCalledTimes(1);
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
  fireEvent(document,new Event('visibilitychange'));await act(async()=>vi.advanceTimersByTimeAsync(1));
  expect(h.sign).toHaveBeenCalledTimes(2);expect(screen.getByAltText('TEST resolved attachment')).toBeInTheDocument();
 });
 it('does not keep an expired URL while foreground renewal hangs',async()=>{
  vi.useFakeTimers();render(<PrivateChatAttachment {...props}/>);await act(async()=>vi.advanceTimersByTimeAsync(1));
  h.sign.mockReturnValueOnce(new Promise(()=>{}));
  await act(async()=>vi.advanceTimersByTimeAsync(60000));
  expect(h.sign).toHaveBeenCalledTimes(2);expect(screen.queryByAltText('TEST resolved attachment')).toBeNull();
 });
 it.each([{data:null,error:{message:'denied'}},{data:{signedUrl:'javascript:alert(1)'},error:null}])('fails closed for an unverified signed read %j',async response=>{
  h.sign.mockResolvedValueOnce(response);render(<PrivateChatAttachment {...props}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Không xác minh');expect(screen.queryByAltText('TEST resolved attachment')).toBeNull();
 });
 it('keeps an explicit legacy HTTPS asset separate from private signing',()=>{
  render(<PrivateChatAttachment {...props} reference="https://test.invalid/legacy.png"/>);
  expect(screen.getByAltText('TEST resolved attachment')).toHaveAttribute('src','https://test.invalid/legacy.png');expect(h.sign).not.toHaveBeenCalled();
 });
});
