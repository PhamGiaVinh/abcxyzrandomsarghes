import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,describe,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({getSession:vi.fn(),listeners:[] as Array<(event:string,session:unknown)=>void>}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getSession:mock.getSession,
 onAuthStateChange:(fn:(event:string,session:unknown)=>void)=>{mock.listeners.push(fn);return {data:{subscription:{unsubscribe:()=>{mock.listeners=mock.listeners.filter(x=>x!==fn);}}}};},
 updateUser:vi.fn(),signOut:vi.fn()}}}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/components/BackButton',()=>({BackButton:()=>null}));
import ResetPassword from './ResetPassword';
afterEach(()=>{cleanup();mock.getSession.mockReset();mock.listeners=[];});
describe('password reset session invalidation',()=>{
 it('clears the password draft when another session signs in',async()=>{
  mock.getSession.mockResolvedValue({data:{session:{user:{id:'A'}}}});
  const {container}=render(<MemoryRouter><ResetPassword/></MemoryRouter>);
  await waitFor(()=>expect(container.querySelectorAll('input[type=password]')).toHaveLength(2));
  for(const input of container.querySelectorAll('input'))fireEvent.change(input,{target:{value:'SyntheticDraft123'}});
  act(()=>mock.listeners.forEach(fn=>fn('SIGNED_IN',{user:{id:'B'}})));
  expect(Array.from(container.querySelectorAll('input')).map(input=>input.value)).toEqual(['','']);
 });
 it('permits a current recovery session after a failed initial session read',async()=>{
  mock.getSession.mockRejectedValue(new Error('TEST session unavailable'));
  const {container}=render(<MemoryRouter><ResetPassword/></MemoryRouter>);
  await act(async()=>{});
  expect(container.querySelectorAll('input[type=password]')).toHaveLength(0);
  act(()=>mock.listeners.forEach(fn=>fn('PASSWORD_RECOVERY',{user:{id:'A'}})));
  expect(container.querySelectorAll('input[type=password]')).toHaveLength(2);
 });
 it('removes password fields when the current session signs out',async()=>{
  mock.getSession.mockResolvedValue({data:{session:{user:{id:'A'}}}});
  const {container}=render(<MemoryRouter><ResetPassword/></MemoryRouter>);
  await waitFor(()=>expect(container.querySelectorAll('input[type=password]')).toHaveLength(2));
  act(()=>mock.listeners.forEach(fn=>fn('SIGNED_OUT',null)));
  expect(container.querySelectorAll('input[type=password]')).toHaveLength(0);
 });
 it('does not reopen the form from a session read predating sign-out',async()=>{
  let finish!:(value:unknown)=>void;
  mock.getSession.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  const {container}=render(<MemoryRouter><ResetPassword/></MemoryRouter>);
  act(()=>mock.listeners.forEach(fn=>fn('SIGNED_OUT',null)));
  await act(async()=>finish({data:{session:{user:{id:'A'}}}}));
  expect(container.querySelectorAll('input[type=password]')).toHaveLength(0);
  expect(screen.queryByRole('button',{name:'resetPassword.submitButton'})).toBeNull();
 });
});
