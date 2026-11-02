import {render,screen} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';

const state=vi.hoisted(()=>({links:[] as unknown[]}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'owner'},loading:false,isAdmin:true,roles:[]})}));
vi.mock('@/hooks/useDealerSwing',()=>({useActiveTables:()=>({data:[]})}));
vi.mock('@/hooks/useTournaments',()=>({
 useTournaments:()=>({isLoading:false,data:[{
  id:'tour-a',club_id:'club-a',name:'Canonical TEST',status:'live',
  swing_duration_minutes:30,warn_at_minutes:5,crit_at_minutes:2,
  tournament_tables:state.links,
 }]}),
 useTournamentConfigTableInventory:()=>({data:[],isSuccess:true,isFetching:false}),
 useCreateTournament:()=>({isPending:false,mutateAsync:vi.fn()}),
 useUpdateTournament:()=>({isPending:false,mutateAsync:vi.fn()}),
 useDeleteTournament:()=>({isPending:false,mutateAsync:vi.fn()}),
}));
import TournamentConfigPage from './TournamentConfigPage';

beforeEach(()=>{state.links=[];});
function show(){
 return render(<MemoryRouter initialEntries={['/clubs/club-a/config']}>
  <Routes><Route path='/clubs/:clubId/config' element={<TournamentConfigPage/>}/></Routes>
 </MemoryRouter>);
}
it('renders a Floor-created canonical table with no legacy table ID',()=>{
 state.links=[{id:'logical-a',table_id:null,game_table_id:'physical-a',
  table_session_id:'session-a',status:'active',game_tables:null,
  canonical_game_table:{id:'physical-a',table_name:'Canonical Table A'}}];
 show();
 expect(screen.getByText('Canonical Table A')).toBeInTheDocument();
});
it('retains the legacy table label',()=>{
 state.links=[{table_id:'legacy-a',game_tables:{id:'legacy-a',table_name:'Legacy Table A'}}];
 show();
 expect(screen.getByText('Legacy Table A')).toBeInTheDocument();
});
it('does not present a contradictory physical identity as a valid table',()=>{
 state.links=[{id:'logical-a',table_id:'old-physical',game_table_id:'new-physical',
  canonical_game_table:{id:'new-physical',table_name:'Wrongly accepted table'}}];
 show();
 expect(screen.queryByText('Wrongly accepted table')).not.toBeInTheDocument();
 expect(screen.getByText('Cần sửa dữ liệu')).toBeInTheDocument();
});
it('renders a repair state when both physical identities are missing',()=>{
 state.links=[{id:'logical-a',table_id:null,game_table_id:null,game_tables:null}];
 show();
 expect(screen.getByText('Cần sửa dữ liệu')).toBeInTheDocument();
});
it('does not display a joined table from a different identity',()=>{
 state.links=[{id:'logical-a',table_id:null,game_table_id:'physical-a',
  canonical_game_table:{id:'physical-b',table_name:'Foreign joined table'}}];
 show();
 expect(screen.queryByText('Foreign joined table')).not.toBeInTheDocument();
 expect(screen.getByText('Cần sửa dữ liệu')).toBeInTheDocument();
});
