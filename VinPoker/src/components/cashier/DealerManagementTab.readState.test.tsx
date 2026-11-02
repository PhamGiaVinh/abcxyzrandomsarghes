import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({actor:'actor-a',session:{access_token:'synthetic-a'},dealerError:null as string|null,scoreError:null as string|null,reloadDealers:vi.fn(),reloadScores:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:state.actor},session:state.session})}));
vi.mock('@/hooks/useDealerManagement',()=>({
 useAllDealers:()=>({data:[],loading:false,error:state.dealerError,refetch:state.reloadDealers}),
 useDealerScores:()=>({data:[],loading:false,error:state.scoreError,refetch:state.reloadScores}),
}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:vi.fn()}}));
vi.mock('./AddDealerDialog',()=>({default:({open}:{open:boolean})=>open?<div role="dialog" aria-label="Add TEST dealer"/>:null}));
vi.mock('./DealerAdjustDialog',()=>({default:()=>null}));
vi.mock('./BulkDealerImportDialog',()=>({BulkDealerImportDialog:()=>null}));
vi.mock('./BulkSalaryDialog',()=>({BulkSalaryDialog:()=>null}));
vi.mock('./BulkShiftPreferenceDialog',()=>({BulkShiftPreferenceDialog:()=>null}));
vi.mock('./BulkEditDialog',()=>({BulkEditDialog:()=>null}));
import DealerManagementTab from './DealerManagementTab';
beforeEach(()=>{state.actor='actor-a';state.session={access_token:'synthetic-a'};state.dealerError=null;state.scoreError=null;vi.clearAllMocks();});
afterEach(cleanup);
describe('Dealer management authoritative read state',()=>{
 it('retains an open form on same-session rerender with reordered club props',()=>{
  const view=render(<DealerManagementTab clubIds={['club-a','club-b']} clubFilter="club-a"/>);
  fireEvent.click(screen.getByRole('button',{name:'Thêm dealer'}));
  view.rerender(<DealerManagementTab clubIds={['club-b','club-a']} clubFilter="club-a"/>);
  expect(screen.getByRole('dialog',{name:'Add TEST dealer'})).toBeInTheDocument();
 });
 it.each(['session','actor','club'] as const)('discards an open add form after %s changes',kind=>{
  const view=render(<DealerManagementTab clubIds={['club-a']} clubFilter="club-a"/>);
  fireEvent.click(screen.getByRole('button',{name:'Thêm dealer'}));
  expect(screen.getByRole('dialog',{name:'Add TEST dealer'})).toBeInTheDocument();
  if(kind==='session')state.session={access_token:'synthetic-b'};
  if(kind==='actor')state.actor='actor-b';
  view.rerender(<DealerManagementTab clubIds={[kind==='club'?'club-b':'club-a']} clubFilter={kind==='club'?'club-b':'club-a'}/>);
  expect(screen.queryByRole('dialog')).toBeNull();
 });
 it.each(['dealerError','scoreError'] as const)('does not turn %s into an empty verified workspace',key=>{
  state[key]='503 TEST';render(<DealerManagementTab clubIds={['club-a']} clubFilter="club-a"/>);
  expect(screen.getByRole('alert')).toHaveTextContent('Không xác minh');
  expect(screen.queryByText('Không có dealer')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Thử tải lại dữ liệu dealer'}));
  expect(state.reloadDealers).toHaveBeenCalledOnce();expect(state.reloadScores).toHaveBeenCalledOnce();
 });
 it('keeps a successfully verified empty response distinct',()=>{
  render(<DealerManagementTab clubIds={['club-a']} clubFilter="club-a"/>);
  expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByText('Không có dealer')).toBeTruthy();
 });
});
