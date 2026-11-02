import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({actor:'actor-a' as string|null,session:null as {access_token:string}|null,compress:vi.fn(),upload:vi.fn(),update:vi.fn(),eq:vi.fn(),
 error:vi.fn(),success:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:h.actor?{id:h.actor}:null,session:h.session})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/lib/compressImage',()=>({compressImage:h.compress}));
vi.mock('sonner',()=>({toast:{error:h.error,success:h.success}}));
function client(){return {storage:{from:()=>({upload:h.upload,getPublicUrl:()=>({data:{publicUrl:'https://test.invalid/avatar.jpg'}})})},
 from:()=>({update:h.update})};}
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:client}));
import {AvatarUploader} from './AvatarUploader';
const file=new File(['test'],'avatar.jpg',{type:'image/jpeg'});
function choose(container:HTMLElement){fireEvent.change(container.querySelector('input[type=file]')!,{target:{files:[file]}});}
beforeEach(()=>{h.actor='actor-a';h.session=null;h.compress.mockReset().mockResolvedValue(file);h.upload.mockReset().mockResolvedValue({error:null});
 h.eq.mockReset().mockResolvedValue({error:null});h.update.mockReset().mockReturnValue({eq:h.eq});h.error.mockReset();h.success.mockReset();});
afterEach(cleanup);
it('does not upload an old selected file when actor changes during compression',async()=>{
 let finish!:(file:File)=>void;h.compress.mockImplementation(()=>new Promise(r=>{finish=r;}));const onUploaded=vi.fn();
 const view=render(<AvatarUploader onUploaded={onUploaded}/>);choose(view.container);
 h.actor='actor-b';view.rerender(<AvatarUploader onUploaded={onUploaded}/>);
 await act(async()=>{finish(file);});
 expect(h.upload).not.toHaveBeenCalled();expect(h.update).not.toHaveBeenCalled();expect(onUploaded).not.toHaveBeenCalled();
});
it('does not update a profile or callback after actor replacement while upload was pending',async()=>{
 let finish!:(value:{error:null})=>void;h.upload.mockImplementation(()=>new Promise(r=>{finish=r;}));const onUploaded=vi.fn();
 const view=render(<AvatarUploader onUploaded={onUploaded}/>);choose(view.container);
 await waitFor(()=>expect(h.upload).toHaveBeenCalledOnce());h.actor='actor-b';view.rerender(<AvatarUploader onUploaded={onUploaded}/>);
 await act(async()=>{finish({error:null});});
 expect(h.update).not.toHaveBeenCalled();expect(onUploaded).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
});
it.each(['compression','storage','profile'])('recovers the button and reports thrown %s errors without success',async stage=>{
 const error=Error('Synthetic '+stage+' failure');
 if(stage==='compression')h.compress.mockRejectedValue(error);else if(stage==='storage')h.upload.mockRejectedValue(error);else h.eq.mockRejectedValue(error);
 const onUploaded=vi.fn(),view=render(<AvatarUploader onUploaded={onUploaded}/>);choose(view.container);
 await waitFor(()=>expect(h.error).toHaveBeenCalledWith(error.message));
 expect(screen.getByRole('button',{name:'account.avatarHint'})).toBeEnabled();
 expect(onUploaded).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
});
it('sends only one upload/profile update for a duplicate change event',async()=>{
 const onUploaded=vi.fn(),view=render(<AvatarUploader onUploaded={onUploaded}/>);choose(view.container);choose(view.container);
 await waitFor(()=>expect(onUploaded).toHaveBeenCalledOnce());
 expect(h.upload).toHaveBeenCalledOnce();expect(h.update).toHaveBeenCalledOnce();expect(h.eq).toHaveBeenCalledWith('user_id','actor-a');
 expect(h.success).toHaveBeenCalledWith('account.avatarUpdated');
});
it('suppresses callbacks after logout while profile update was already in flight',async()=>{
 let finish!:(value:{error:null})=>void;h.eq.mockImplementation(()=>new Promise(r=>{finish=r;}));const onUploaded=vi.fn();
 const view=render(<AvatarUploader onUploaded={onUploaded}/>);choose(view.container);await waitFor(()=>expect(h.eq).toHaveBeenCalledOnce());
 h.actor=null;view.rerender(<AvatarUploader onUploaded={onUploaded}/>);await act(async()=>finish({error:null}));
 expect(onUploaded).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'account.avatarHint'})).toBeDisabled();
});
it('invalidates an old upload on same-actor session replacement',async()=>{
 h.session={access_token:'local-test-session-a'};let finish!:(file:File)=>void;
 h.compress.mockImplementation(()=>new Promise(r=>{finish=r;}));const onUploaded=vi.fn();
 const view=render(<AvatarUploader onUploaded={onUploaded}/>);choose(view.container);
 h.session={access_token:'local-test-session-b'};view.rerender(<AvatarUploader onUploaded={onUploaded}/>);
 await act(async()=>finish(file));expect(h.upload).not.toHaveBeenCalled();expect(onUploaded).not.toHaveBeenCalled();
});
