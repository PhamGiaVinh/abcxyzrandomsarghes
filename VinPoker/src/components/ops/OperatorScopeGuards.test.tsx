import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({error:null as string|null,verified:true,refresh:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor'},loading:false,isAdmin:false})}));
vi.mock('@/hooks/useOperatorClubs',()=>({useOperatorClubs:()=>({user:{id:'actor'},loading:false,clubs:[],operatorClubIds:h.verified?['club']:[],dealerClubIds:[],hasCashierAccess:h.verified,error:h.error,scopeVerified:h.verified,refresh:h.refresh})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/components/cashier/TournamentLivePanel',()=>({default:()=> <p>Floor operations</p>}));
import FloorDashboard from '@/pages/FloorDashboard';
import OpsCashierAccess from './OpsCashierAccess';
afterEach(cleanup);
beforeEach(()=>{h.error=null;h.verified=true;h.refresh.mockClear();});
it.each(['floor','cashier'])('%s shows unknown/retry rather than false permission denial',kind=>{
 h.error='Không tải được phạm vi CLB';h.verified=false;
 render(<MemoryRouter>{kind==='floor'?<FloorDashboard/>:<OpsCashierAccess><p>Cashier operations</p></OpsCashierAccess>}</MemoryRouter>);
 expect(screen.getByRole('alert')).toHaveTextContent(h.error);
 expect(screen.queryByText(/Bạn chưa được phân công|Không có quyền Cashier/)).toBeNull();
 expect(screen.queryByText(/operations/)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));expect(h.refresh).toHaveBeenCalledTimes(1);
});
it.each(['floor','cashier'])('%s keeps verified capability when only optional club names fail',kind=>{
 h.error='Không tải được tên CLB';
 render(<MemoryRouter>{kind==='floor'?<FloorDashboard/>:<OpsCashierAccess><p>Cashier operations</p></OpsCashierAccess>}</MemoryRouter>);
 expect(screen.getByText(kind==='floor'?'Floor operations':'Cashier operations')).toBeTruthy();
});
