import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
const h=vi.hoisted(()=>({ actor:'actor-a',token:'token-a',rpc:vi.fn(),nav:vi.fn(),success:vi.fn() }));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:h.actor},loading:false})}));
vi.mock('react-router-dom',async()=>({...await vi.importActual('react-router-dom'),useParams:()=>({token:h.token}),useNavigate:()=>h.nav}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('sonner',()=>({toast:{success:h.success,error:vi.fn()}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>h.rpc(...args)}}));
import GroupInvite from './GroupInvite';
import { persistGroupInviteIntent } from '@/lib/groupInviteIntent';
const group='33333333-3333-4333-8333-333333333333';
const preview={group_id:group,group_name:'PRIVATE GROUP A',avatar_url:null,is_public:false,member_count:2,valid:true,reason:'ok'};
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);sessionStorage.clear();h.actor='actor-a';h.token='token-a';h.rpc.mockReset().mockResolvedValue({data:[preview],error:null});h.nav.mockReset();h.success.mockReset();});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('reload resumes the same request after a lost response even when invite is now exhausted',async()=>{
 h.rpc.mockImplementation(async(name:string)=>name==='get_invite_preview'?{data:[preview],error:null}:{data:null,error:{message:'LOCAL LOST'}});
 const mounted=render(<MemoryRouter><GroupInvite/></MemoryRouter>);await screen.findByText('PRIVATE GROUP A');
 fireEvent.click(screen.getByRole('button',{name:'groupChat.invitePage.joinBtn'}));await screen.findByRole('alert');
 const sent=h.rpc.mock.calls.find(([name])=>name==='accept_group_invite_v2')![1];mounted.unmount();
 h.rpc.mockImplementation(async(name:string,args:{_request_id:string})=>name==='get_invite_preview'
  ?{data:[{...preview,valid:false,reason:'exhausted'}],error:null}
  :{data:{ok:true,outcome:'replayed',request_id:args._request_id,group_id:group},error:null});
 render(<MemoryRouter><GroupInvite/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'Kiểm tra lại yêu cầu đã gửi'}));
 await waitFor(()=>expect(h.nav).toHaveBeenCalledExactlyOnceWith(`/group/${group}`));
 expect(h.rpc.mock.calls.filter(([name])=>name==='accept_group_invite_v2')[1][1]).toEqual(sent);expect(sessionStorage.length).toBe(0);
});
it('a receipt for an ended membership never navigates or creates a new request',async()=>{
 const saved=await persistGroupInviteIntent(sessionStorage,h.actor,h.token,group);
 h.rpc.mockImplementation(async(name:string)=>name==='get_invite_preview'?{data:[{...preview,valid:false,reason:'exhausted'}],error:null}
  :{data:{ok:false,outcome:'no_longer_member',request_id:saved.requestId,group_id:group},error:null});
 render(<MemoryRouter><GroupInvite/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'Kiểm tra lại yêu cầu đã gửi'}));
 await screen.findByRole('alert');expect(screen.getByRole('button',{name:'Kiểm tra lại yêu cầu đã gửi'})).toBeDisabled();
 expect(h.nav).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(1);
});
it('storage failure blocks membership mutation before network I/O',async()=>{
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('LOCAL QUOTA');});
 render(<MemoryRouter><GroupInvite/></MemoryRouter>);await screen.findByText('PRIVATE GROUP A');fireEvent.click(screen.getByRole('button',{name:'groupChat.invitePage.joinBtn'}));
 await screen.findByRole('alert');expect(h.rpc.mock.calls.some(([name])=>name==='accept_group_invite_v2')).toBe(false);
});
it('does not show a late old-token preview in the current invite',async()=>{
 let resolve!:(value:unknown)=>void;h.rpc.mockReturnValueOnce(new Promise(done=>{resolve=done;}));
 const view=()=> <MemoryRouter><GroupInvite/></MemoryRouter>;const mounted=render(view());
 await waitFor(()=>expect(h.rpc).toHaveBeenCalled());h.token='token-b';h.rpc.mockResolvedValue({data:[{...preview,group_name:'CURRENT GROUP B'}],error:null});mounted.rerender(view());
 await screen.findByText('CURRENT GROUP B');await act(async()=>resolve({data:[preview],error:null}));expect(screen.queryByText('PRIVATE GROUP A')).toBeNull();
});
it('distinguishes a preview backend error from an invalid invitation',async()=>{
 h.rpc.mockResolvedValue({data:null,error:{message:'LOCAL 503'}});render(<MemoryRouter><GroupInvite/></MemoryRouter>);
 await screen.findByRole('alert');expect(screen.queryByText('groupChat.invitePage.invalid')).toBeNull();
});
it('never navigates or reports success for a null membership receipt',async()=>{
 h.rpc.mockImplementation(async(name:string)=>name==='get_invite_preview'?{data:[preview],error:null}:{data:null,error:null});
 render(<MemoryRouter><GroupInvite/></MemoryRouter>);await screen.findByText('PRIVATE GROUP A');fireEvent.click(screen.getByRole('button',{name:'groupChat.invitePage.joinBtn'}));
 await screen.findByRole('alert');expect(h.nav).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'Kiểm tra lại yêu cầu đã gửi'})).toBeEnabled();
});
it('retries only a failed preview read and verifies the exact joined group',async()=>{
 h.rpc.mockResolvedValueOnce({data:null,error:{message:'LOCAL 503'}});render(<MemoryRouter><GroupInvite/></MemoryRouter>);
 await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Thử tải lại lời mời'}));await screen.findByText('PRIVATE GROUP A');
 h.rpc.mockImplementation(async(_name:string,args:{_request_id:string})=>({data:{ok:true,outcome:'joined',request_id:args._request_id,group_id:group},error:null}));fireEvent.click(screen.getByRole('button',{name:'groupChat.invitePage.joinBtn'}));
 await waitFor(()=>expect(h.nav).toHaveBeenCalledExactlyOnceWith(`/group/${group}`));expect(h.success).toHaveBeenCalledTimes(1);
});
it('same-tick double click invokes once; unknown reply only resumes explicitly with the same ID',async()=>{
 let resolve!:(value:unknown)=>void;h.rpc.mockImplementation((name:string)=>name==='get_invite_preview'?Promise.resolve({data:[preview],error:null}):new Promise(done=>{resolve=done;}));
 render(<MemoryRouter><GroupInvite/></MemoryRouter>);await screen.findByText('PRIVATE GROUP A');const button=screen.getByRole('button',{name:'groupChat.invitePage.joinBtn'});
 act(()=>{button.dispatchEvent(new MouseEvent('click',{bubbles:true}));button.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
 await waitFor(()=>expect(h.rpc.mock.calls.filter(([name])=>name==='accept_group_invite_v2')).toHaveLength(1));
 const first=h.rpc.mock.calls.find(([name])=>name==='accept_group_invite_v2')![1];
 await act(async()=>resolve({data:null,error:{message:'LOCAL UNKNOWN'}}));await screen.findByRole('alert');
 expect(h.rpc.mock.calls.filter(([name])=>name==='accept_group_invite_v2')).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'Kiểm tra lại yêu cầu đã gửi'}));
 await waitFor(()=>expect(h.rpc.mock.calls.filter(([name])=>name==='accept_group_invite_v2')).toHaveLength(2));
 expect(h.rpc.mock.calls.filter(([name])=>name==='accept_group_invite_v2')[1][1]).toEqual(first);
 await act(async()=>resolve({data:null,error:{message:'LOCAL UNKNOWN'}}));
});
it('old actor join completion cannot navigate the next actor',async()=>{
 let resolve!:(value:unknown)=>void;h.rpc.mockImplementation((name:string)=>name==='get_invite_preview'?Promise.resolve({data:[preview],error:null}):new Promise(done=>{resolve=done;}));
 const view=()=> <MemoryRouter><GroupInvite/></MemoryRouter>;const mounted=render(view());await screen.findByText('PRIVATE GROUP A');
 fireEvent.click(screen.getByRole('button',{name:'groupChat.invitePage.joinBtn'}));await waitFor(()=>expect(h.rpc).toHaveBeenCalledWith('accept_group_invite_v2',expect.anything()));h.actor='actor-b';mounted.rerender(view());
 await act(async()=>resolve({data:group,error:null}));expect(h.nav).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
});
