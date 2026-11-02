import {cleanup,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {LobbyState} from '@/lib/onlinePoker/useOnlinePoker';
const h=vi.hoisted(()=>({state:null as LobbyState|null}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'TEST_ONLY'}})}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{onlinePoker:true}}));
vi.mock('@/lib/onlinePoker/useOnlinePoker',()=>({useLobby:()=>h.state}));
// Read-state tests do not model create transport; actual controller is covered
// by OnlinePoker.createIntent.test.tsx with valid actor/backend and storage.
vi.mock('@/hooks/useOnlineCreateIntent',()=>({useOnlineCreateIntent:()=>({pending:null,blocked:false,busy:false,message:null,readOnlyRecovery:false,submit:vi.fn(),recover:vi.fn(),retry:vi.fn()})}));
vi.mock('@/components/poker/CreateTableDialog',()=>({CreateTableDialog:()=>null}));
import OnlinePoker from './OnlinePoker';
beforeEach(()=>{h.state={tables:[],loading:false,error:null,refresh:vi.fn()};});
afterEach(cleanup);
it('does not call an unavailable lobby empty or offer creating the first table',()=>{
 h.state!.error='LOCAL_SEAT_READ_UNAVAILABLE';
 render(<MemoryRouter><OnlinePoker/></MemoryRouter>);
 expect(screen.getByText(/LOCAL_SEAT_READ_UNAVAILABLE/)).toBeInTheDocument();
 expect(screen.queryByText('Chưa có bàn nào đang mở.')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Tạo bàn đầu tiên'})).not.toBeInTheDocument();
 expect(screen.getByText('Chưa xác minh số bàn và người chơi')).toBeInTheDocument();
});
it('shows empty only after a successful verified read',()=>{
 render(<MemoryRouter><OnlinePoker/></MemoryRouter>);
 expect(screen.getByText('Chưa có bàn nào đang mở.')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Tạo bàn đầu tiên'})).toBeInTheDocument();
});
