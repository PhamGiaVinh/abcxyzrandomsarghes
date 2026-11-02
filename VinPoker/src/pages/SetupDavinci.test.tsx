import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({signIn:vi.fn(),signUp:vi.fn(),roles:vi.fn(),navigate:vi.fn()}));
vi.mock('react-router-dom',()=>({useNavigate:()=>f.navigate}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{signInWithPassword:f.signIn,signUp:f.signUp},from:()=>({select:()=>({eq:f.roles})})}}));
import SetupDavinci from './SetupDavinci';
const start=()=>{const view=render(<SetupDavinci/>);fireEvent.change(screen.getByPlaceholderText('At least 6 characters'),{target:{value:'LOCAL_TEST_PASSWORD'}});fireEvent.click(screen.getByRole('button',{name:/Run Bootstrap|Sign in and verify/}));return view;};
beforeEach(()=>{vi.clearAllMocks();f.signIn.mockResolvedValue({data:{user:{id:'LOCAL_TEST_USER'}},error:null});f.signUp.mockResolvedValue({data:{user:null,session:null},error:{message:'TEST_CREATE'}});f.roles.mockResolvedValue({data:[{role:'super_admin'}],error:null});});
describe('bootstrap explicit intent and role availability',()=>{
 it('keeps double clicks and cross-action clicks to one pending auth request',async()=>{
  let finish!:(value:unknown)=>void;f.signIn.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  render(<SetupDavinci/>);fireEvent.change(screen.getByLabelText('Password'),{target:{value:'LOCAL_TEST_PASSWORD'}});
  const signIn=screen.getByRole('button',{name:'Sign in and verify'}),create=screen.getByRole('button',{name:'Create account'});
  act(()=>{fireEvent.click(signIn);fireEvent.click(signIn);fireEvent.click(create);});
  expect(f.signIn).toHaveBeenCalledTimes(1);expect(f.signUp).not.toHaveBeenCalled();expect(create).toBeDisabled();
  await act(async()=>{finish({data:{user:null},error:{status:503}});});expect(screen.getByRole('button',{name:'Sign in and verify'})).toBeEnabled();
 });
 it('releases busy and reports a rejected transport without creating an account',async()=>{
  f.signIn.mockRejectedValue(new Error('LOCAL_PRIVATE_FAILURE'));start();
  await screen.findByText(/Unable to complete the request/);expect(screen.getByRole('button',{name:'Sign in and verify'})).toBeEnabled();expect(f.signUp).not.toHaveBeenCalled();
  expect(screen.queryByText('LOCAL_PRIVATE_FAILURE')).not.toBeInTheDocument();
 });
 it.each([null,{},[{role:17}]].map(data=>({data})))('does not infer missing permission from malformed role data: $data',async({data})=>{
  f.roles.mockResolvedValue({data,error:null});start();await screen.findByText(/Unable to verify roles/);expect(f.navigate).not.toHaveBeenCalled();
 });
 it('recognizes a confirmed empty role array without creating or granting anything',async()=>{
  f.roles.mockResolvedValue({data:[],error:null});start();await screen.findByText(/does not have the Super Admin role/);expect(f.signUp).not.toHaveBeenCalled();expect(f.navigate).not.toHaveBeenCalled();
 });
 it('navigates only after the role read confirms administrator access',async()=>{
  start();await waitFor(()=>expect(f.navigate).toHaveBeenCalledWith('/admin'));expect(f.signUp).not.toHaveBeenCalled();
 });
 it('ignores a late verified role response after the page unmounts',async()=>{
  let finish!:(value:unknown)=>void;f.roles.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const view=start();
  await waitFor(()=>expect(f.roles).toHaveBeenCalledTimes(1));view.unmount();
  await act(async()=>{finish({data:[{role:'super_admin'}],error:null});});expect(f.navigate).not.toHaveBeenCalled();
 });
 it.each([{status:503,code:'unexpected_failure'},{status:400,code:'invalid_credentials'}])('never creates an account because sign-in failed: $code',async(error)=>{
  f.signIn.mockResolvedValue({data:{user:null},error});start();
  await waitFor(()=>expect(screen.getByRole('button',{name:/Run Bootstrap|Sign in and verify/})).toBeEnabled());
  expect(f.signUp).not.toHaveBeenCalled();expect(f.roles).not.toHaveBeenCalled();expect(f.navigate).not.toHaveBeenCalled();
 });
 it('does not label a failed role read as a confirmed missing Super Admin role',async()=>{
  f.roles.mockResolvedValue({data:null,error:{message:'TEST_BACKEND_503'}});start();
  await screen.findByText(/Unable to verify roles/);expect(screen.queryByText(/does not have the Super Admin role/)).not.toBeInTheDocument();expect(f.navigate).not.toHaveBeenCalled();
 });
 it('requires an explicit create action and does not claim an unconfirmed account is an admin',async()=>{
  f.signUp.mockResolvedValue({data:{user:{id:'LOCAL_NEW_USER'},session:null},error:null});render(<SetupDavinci/>);
  fireEvent.change(screen.getByPlaceholderText('At least 6 characters'),{target:{value:'LOCAL_TEST_PASSWORD'}});
  fireEvent.click(screen.getByRole('button',{name:'Create account'}));
  await screen.findByText(/Check your email/);expect(f.signUp).toHaveBeenCalledTimes(1);expect(f.signIn).not.toHaveBeenCalled();expect(f.roles).not.toHaveBeenCalled();expect(f.navigate).not.toHaveBeenCalled();
  expect(screen.queryByText(/Database trigger grants Super Admin automatically/)).not.toBeInTheDocument();
 });
});
