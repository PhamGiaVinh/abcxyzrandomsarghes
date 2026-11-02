import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({user:vi.fn(),compress:vi.fn(),upload:vi.fn(),change:vi.fn(),failure:vi.fn(),success:vi.fn(),busy:vi.fn(),actor:'TEST_ACTOR' as string|null,session:null as {access_token:string}|null}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:f.actor?{id:f.actor}:null,session:f.session})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('sonner',()=>({toast:{error:f.failure,success:f.success}}));
vi.mock('@/lib/compressImage',()=>({compressImage:f.compress}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>({
 auth:{getUser:f.user},storage:{from:()=>({upload:f.upload,getPublicUrl:()=>({data:{publicUrl:'https://test.invalid/versioned.png'}})})},
})}));
import {ProofUploader} from './ProofUploader';
beforeEach(()=>{vi.clearAllMocks();f.actor='TEST_ACTOR';f.session=null;f.compress.mockImplementation(async(file:File)=>file);f.user.mockResolvedValue({data:{user:{id:'TEST_ACTOR'}},error:null});f.upload.mockResolvedValue({error:null});});
function choose(container:HTMLElement){const input=container.querySelector('input[type=file]');if(!input)throw new Error('missing upload input');
 fireEvent.change(input,{target:{files:[new File(['TEST'],'test.png',{type:'image/png'})]}});}
describe('ProofUploader operation recovery',()=>{
 it('uses an explicit preview transport without changing the stored reference',()=>{
  render(<ProofUploader folder="tv/branding-logo" versioned value="https://canonical.test/asset.png"
   previewUrl="http://127.0.0.1:54329/asset.png" onChange={f.change}/>);
  expect(screen.getByRole('img',{name:'proof'})).toHaveAttribute('src','http://127.0.0.1:54329/asset.png');
  expect(f.change).not.toHaveBeenCalled();expect(f.upload).not.toHaveBeenCalled();
 });
 it('accepts a non-JPEG source when the codec actually returns JPEG bytes',async()=>{
  const jpeg=new File(['JPEG_CODEC_FIXTURE'],'asset.jpg',{type:'image/jpeg'});f.compress.mockResolvedValueOnce(jpeg);
  const view=render(<ProofUploader folder="tv/branding-background" versioned onChange={f.change}/>);
  fireEvent.change(view.container.querySelector('input[type=file]')!,{target:{files:[new File(['WEBP_CODEC_FIXTURE'],'asset.webp',{type:'image/webp'})]}});
  await waitFor(()=>expect(f.change).toHaveBeenCalledOnce());
  expect(f.upload).toHaveBeenCalledWith(expect.stringMatching(/\/tv\/branding-background\/v1\/[a-f0-9-]{36}\.jpg$/),jpeg,
   {cacheControl:'31536000',upsert:false,contentType:'image/jpeg'});expect(f.failure).not.toHaveBeenCalled();
 });
 it.each(['image/webp','image/gif','image/svg+xml','image/heic'])('does not mislabel unconverted %s as a versioned JPEG',async(type)=>{
  const view=render(<ProofUploader folder="tv/branding-logo" versioned onChange={f.change} onUploadingChange={f.busy}/>);
  const input=view.container.querySelector('input[type=file]')!;
  fireEvent.change(input,{target:{files:[new File(['TEST'],'asset',{type})]}});
  await waitFor(()=>expect(f.failure).toHaveBeenCalledWith('TV images must be PNG or JPEG. Convert this image and try again.'));
  expect(f.upload).not.toHaveBeenCalled();expect(f.change).not.toHaveBeenCalled();
  expect(f.busy.mock.calls).toEqual([[true],[false]]);expect(screen.getByRole('button')).toBeEnabled();
 });
 it('reports preview failure without clearing the stored asset reference',()=>{
  const view=render(<ProofUploader folder="tv/branding-logo" versioned value="https://test.invalid/first.png" onChange={f.change}/>);
  fireEvent.error(screen.getByRole('img',{name:'proof'}));
  expect(screen.getByRole('alert')).toHaveTextContent('proofUpload.previewUnavailable');
  expect(f.change).not.toHaveBeenCalled();
  view.rerender(<ProofUploader folder="tv/branding-logo" versioned value="https://test.invalid/second.png" onChange={f.change}/>);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.error(screen.getByRole('img',{name:'proof'}));expect(screen.getByRole('alert')).toBeInTheDocument();
  fireEvent.load(screen.getByRole('img',{name:'proof'}));expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(f.change).not.toHaveBeenCalled();
 });
 it('does not apply an old upload after the same actor receives a new session',async()=>{
  let finish!:(value:unknown)=>void;f.upload.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
  f.session={access_token:'local-test-session-A'};
  const view=render(<ProofUploader folder="results" onChange={f.change}/>);choose(view.container);
  await waitFor(()=>expect(f.upload).toHaveBeenCalledTimes(1));
  f.session={access_token:'local-test-session-B'};view.rerender(<ProofUploader folder="results" onChange={f.change}/>);
  await act(async()=>finish({error:null}));expect(f.change).not.toHaveBeenCalled();expect(f.success).not.toHaveBeenCalled();
 });
 it('does not upload when server Auth identity differs from the current form actor',async()=>{
  f.user.mockResolvedValueOnce({data:{user:{id:'OTHER_TEST_ACTOR'}},error:null});
  const view=render(<ProofUploader folder="results" onChange={f.change}/>);choose(view.container);
  await waitFor(()=>expect(f.failure).toHaveBeenCalledWith('Please sign in again before uploading.'));
  expect(f.upload).not.toHaveBeenCalled();expect(f.change).not.toHaveBeenCalled();
 });
 it('ignores a prior actor upload after an account switch in the same folder',async()=>{
  let finish!:(value:unknown)=>void;f.upload.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
  const view=render(<ProofUploader folder="results" onChange={f.change}/>);choose(view.container);
  await waitFor(()=>expect(f.upload).toHaveBeenCalledTimes(1));
  f.actor='OTHER_TEST_ACTOR';view.rerender(<ProofUploader folder="results" onChange={f.change}/>);
  await act(async()=>finish({error:null}));expect(f.change).not.toHaveBeenCalled();expect(f.success).not.toHaveBeenCalled();
 });
 it('does not start an old upload after the destination policy changes during auth',async()=>{
  let finish!:(value:unknown)=>void;f.user.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
  const view=render(<ProofUploader folder="tv/branding-logo" onChange={f.change}/>);choose(view.container);
  view.rerender(<ProofUploader folder="tv/branding-logo" versioned onChange={f.change}/>);
  await act(async()=>finish({data:{user:{id:'TEST_ACTOR'}},error:null}));
  expect(f.upload).not.toHaveBeenCalled();expect(f.change).not.toHaveBeenCalled();
  choose(view.container);await waitFor(()=>expect(f.change).toHaveBeenCalledTimes(1));
  expect(f.upload.mock.calls[0][0]).toContain('/tv/branding-logo/v1/');
 });
 it('does not attach a prior-folder upload to the next destination',async()=>{
  let finish!:(value:unknown)=>void;f.upload.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
  const view=render(<ProofUploader folder="tv/branding-logo" versioned onChange={f.change} onUploadingChange={f.busy}/>);choose(view.container);
  await waitFor(()=>expect(f.upload).toHaveBeenCalledTimes(1));
  view.rerender(<ProofUploader folder="tv/branding-background" versioned onChange={f.change} onUploadingChange={f.busy}/>);
  await act(async()=>finish({error:null}));
  expect(f.change).not.toHaveBeenCalled();expect(f.success).not.toHaveBeenCalled();
  choose(view.container);await waitFor(()=>expect(f.change).toHaveBeenCalledTimes(1));
  expect(f.upload.mock.calls[1][0]).toContain('/tv/branding-background/v1/');
 });
 it('releases the button after a thrown transport error and permits a deliberate retry',async()=>{
  f.upload.mockRejectedValueOnce(new Error('LOCAL upload transport error'));
  const view=render(<ProofUploader folder="tv/branding-logo" versioned onChange={f.change} onUploadingChange={f.busy}/>);choose(view.container);
  await waitFor(()=>expect(f.failure).toHaveBeenCalledWith('LOCAL upload transport error'));
  expect(f.busy.mock.calls).toEqual([[true],[false]]);
  expect(f.change).not.toHaveBeenCalled();expect(screen.getByRole('button')).toBeEnabled();
  choose(view.container);await waitFor(()=>expect(f.change).toHaveBeenCalledTimes(1));expect(f.upload).toHaveBeenCalledTimes(2);
 });
 it('serializes file events before the asynchronous auth check completes',async()=>{
  let finish!:(value:unknown)=>void;f.user.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
  const view=render(<ProofUploader folder="tv/branding-logo" versioned onChange={f.change}/>);
  choose(view.container);choose(view.container);
  await act(async()=>finish({data:{user:{id:'TEST_ACTOR'}},error:null}));
  await waitFor(()=>expect(f.change).toHaveBeenCalled());expect(f.user).toHaveBeenCalledTimes(1);expect(f.upload).toHaveBeenCalledTimes(1);
 });
 it('does not update a removed editor when upload finishes',async()=>{
  let finish!:(value:unknown)=>void;f.upload.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
  const view=render(<ProofUploader folder="tv/branding-logo" versioned onChange={f.change} onUploadingChange={f.busy}/>);choose(view.container);
  await waitFor(()=>expect(f.upload).toHaveBeenCalledTimes(1));view.unmount();
  expect(f.busy.mock.calls).toEqual([[true],[false]]);
  await act(async()=>finish({error:null}));expect(f.change).not.toHaveBeenCalled();expect(f.success).not.toHaveBeenCalled();
 });
 it('writes a unique versioned object without overwrite or deletion',async()=>{
  const view=render(<ProofUploader folder="tv/branding-logo" versioned onChange={f.change}/>);choose(view.container);
  await waitFor(()=>expect(f.change).toHaveBeenCalledTimes(1));
  expect(f.upload).toHaveBeenCalledWith(expect.stringMatching(/^TEST_ACTOR\/tv\/branding-logo\/v1\/[a-f0-9-]{36}\.png$/),
    expect.any(File),{cacheControl:'31536000',upsert:false,contentType:'image/png'});
 });
});
