import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {onlineCreateJournalKey,readOnlineCreateJournal} from '@/lib/onlinePoker/createJournal';
const h=vi.hoisted(()=>({create:vi.fn(),read:vi.fn(),legacy:vi.fn(),auth:{user:{id:'63aa8ee6-e9ad-420e-9b71-d4e6b3fe0d43'},session:{access_token:'LOCAL_A'}}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>h.auth}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{onlinePoker:true}}));
vi.mock('@/lib/onlinePoker/useOnlinePoker',()=>({useLobby:()=>({tables:[],loading:false,error:null,createTable:h.legacy,refresh:vi.fn()})}));
vi.mock('@/lib/onlinePoker/client',()=>({onlinePokerClient:{createOpenTableWithRequest:h.create,getCreateReceipt:h.read}}));
// Exercise the real page and controller; only dialog input and remote IO are modeled.
vi.mock('@/components/poker/CreateTableDialog',()=>({CreateTableDialog:({open,onCreate}:{open:boolean;onCreate:(p:unknown)=>void})=>open?<button onClick={()=>onCreate({name:'TEST',sb:'25',bb:'50',buyin:'5000',maxSeats:9})}>Submit TEST</button>:null}));
import OnlinePoker from './OnlinePoker';
const backend='http://127.0.0.1:54329',actor='63aa8ee6-e9ad-420e-9b71-d4e6b3fe0d43';
const receipt=(key:string)=>({outcome:'ok',request_id:key,replayed:false,table_id:'e217f4bd-d708-4ea5-93c3-f64371a8afff',seat_no:1});
function Location(){return <output aria-label="location">{useLocation().pathname}</output>;}
const Page=()=> <MemoryRouter initialEntries={['/poker']}><OnlinePoker/><Location/></MemoryRouter>;
beforeEach(()=>{
 localStorage.clear();vi.clearAllMocks();vi.stubEnv('VITE_SUPABASE_URL',backend);
 h.auth={user:{id:actor},session:{access_token:'LOCAL_A'}};
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn(async(_key:string,work:()=>unknown)=>work())}});
 h.create.mockRejectedValue(Error('LOCAL_LOST_RESPONSE'));h.read.mockRejectedValue(Error('LOCAL503'));
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllEnvs();});
async function submit(){fireEvent.click(screen.getByRole('button',{name:'Tạo bàn mới'}));fireEvent.click(screen.getByRole('button',{name:'Submit TEST'}));}
it('keeps unknown intent over remount, disables fresh create, and resolves by read without another write',async()=>{
 const first=render(<Page/>);await submit();
 await waitFor(()=>expect(h.create).toHaveBeenCalledTimes(1));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Kiểm tra receipt'})).toBeEnabled());
 const frozen=readOnlineCreateJournal(localStorage,actor,backend).intent!;
 expect(frozen).not.toBeNull();expect(h.legacy).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'Tạo bàn mới'})).toBeDisabled();first.unmount();
 h.create.mockClear();h.read.mockClear();h.read.mockImplementation(async(_p:unknown,key:string)=>({state:'resolved',receipt:receipt(key)}));
 render(<Page/>);expect(h.create).not.toHaveBeenCalled();expect(h.read).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Kiểm tra receipt'}));
 await waitFor(()=>expect(screen.getByLabelText('location')).toHaveTextContent(`/poker/table/${receipt(frozen.requestId).table_id}`));
 expect(h.create).not.toHaveBeenCalled();expect(h.read.mock.calls[0][2]).toBe(actor);
 expect(readOnlineCreateJournal(localStorage,actor,backend).intent).toBeNull();
});
it('drops an in-flight completion on same-object credential replacement without losing its journal',async()=>{
 let finish!:(v:unknown)=>void;h.create.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const page=render(<Page/>);await submit();await waitFor(()=>expect(h.create).toHaveBeenCalledTimes(1));
 const key=h.create.mock.calls[0][1];h.auth.session.access_token='LOCAL_REPLACED';page.rerender(<Page/>);
 await act(async()=>{finish(receipt(key));});
 expect(h.read).not.toHaveBeenCalled();expect(screen.getByLabelText('location')).toHaveTextContent('/poker');
 expect(readOnlineCreateJournal(localStorage,actor,backend).intent?.requestId).toBe(key);
 expect(screen.getByRole('button',{name:'Kiểm tra receipt'})).toBeEnabled();
});
it('does not display another account journal or settle its late request',async()=>{
 let finish!:(v:unknown)=>void;h.create.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const page=render(<Page/>);await submit();await waitFor(()=>expect(h.create).toHaveBeenCalledTimes(1));
 const key=h.create.mock.calls[0][1];h.auth={user:{id:'143bf437-a03e-40c3-83b7-b363dc64b198'},session:{access_token:'LOCAL_B'}};page.rerender(<Page/>);
 await act(async()=>{finish(receipt(key));});
 expect(h.read).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Kiểm tra receipt'})).not.toBeInTheDocument();
 expect(localStorage.getItem(onlineCreateJournalKey(actor,backend))).not.toBeNull();
});
