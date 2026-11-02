import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,describe,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({reset:vi.fn(),error:vi.fn(),success:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{resetPasswordForEmail:mock.reset}}}));
vi.mock('sonner',()=>({toast:{error:mock.error,success:mock.success}}));
vi.mock('@/components/BackButton',()=>({BackButton:()=>null}));
import ForgotPassword from './ForgotPassword';
afterEach(()=>{cleanup();vi.clearAllMocks();});
describe('forgot password request intent',()=>{
 it('releases loading without claiming success after a thrown transport failure',async()=>{
  mock.reset.mockRejectedValue(new Error('TEST network failure'));
  render(<MemoryRouter><ForgotPassword/></MemoryRouter>);
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'first@example.test'}});
  fireEvent.click(screen.getByRole('button',{name:/Gửi liên kết/}));
  await waitFor(()=>expect(mock.error).toHaveBeenCalledWith(expect.stringMatching(/Chưa xác minh/)));
  expect(screen.getByRole('button',{name:/Gửi liên kết/})).toHaveProperty('disabled',false);
  expect(mock.reset).toHaveBeenCalledTimes(1);expect(mock.success).not.toHaveBeenCalled();
 });
 it('keeps confirmation bound to the submitted email while its request is pending',async()=>{
  let finish!:(value:unknown)=>void;mock.reset.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  render(<MemoryRouter><ForgotPassword/></MemoryRouter>);
  const email=screen.getByRole('textbox');
  fireEvent.change(email,{target:{value:'first@example.test'}});
  fireEvent.click(screen.getByRole('button',{name:/Gửi liên kết/}));
  expect(mock.reset).toHaveBeenCalledWith('first@example.test',expect.any(Object));
  expect(email).toHaveProperty('disabled',true);
  fireEvent.change(email,{target:{value:'second@example.test'}});
  await act(async()=>finish({error:null}));
  expect(screen.getByText('first@example.test')).toBeTruthy();
  expect(screen.queryByText('second@example.test')).toBeNull();
 });
 it('does not show a sent confirmation for a server error',async()=>{
  mock.reset.mockResolvedValue({error:{message:'TEST rate limit'}});
  render(<MemoryRouter><ForgotPassword/></MemoryRouter>);
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'first@example.test'}});
  fireEvent.click(screen.getByRole('button',{name:/Gửi liên kết/}));
  await waitFor(()=>expect(mock.error).toHaveBeenCalledWith('TEST rate limit'));
  expect(screen.getByRole('button',{name:/Gửi liên kết/})).toHaveProperty('disabled',false);
  expect(mock.success).not.toHaveBeenCalled();
 });
});
