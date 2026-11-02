import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({auth:{user:{id:'actor-a'},session:{access_token:'TEST-a'},loading:false},close:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>f.auth}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{closeReport:true}}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/components/cashier/tournament-live/CloseReportDialog',()=>({default:({tournamentId,onClosed}:{tournamentId:string;onClosed:()=>void})=><div role="dialog" aria-label="Báo cáo chốt giải">{tournamentId}<button onClick={()=>{f.close(tournamentId);onClosed();}}>Xác nhận qua báo cáo</button></div>}));
import {TournamentLifecycleControls} from './TournamentLifecycleControls';
const tour={id:'tour-a',club_id:'club-a',name:'TEST lifecycle',status:'registering'};
beforeEach(()=>{f.auth={user:{id:'actor-a'},session:{access_token:'TEST-a'},loading:false};f.close.mockClear();});
afterEach(cleanup);
it('observes status and directs clock operations to the exact scoped workspace, without a raw selector',()=>{
 render(<MemoryRouter><TournamentLifecycleControls tournament={tour} onChanged={vi.fn()}/></MemoryRouter>);
 expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Đồng hồ & bắt đầu giải'})).toHaveAttribute('href','/ops/floor/tournaments/tour-a/clock?club=club-a');
 expect(screen.getByText('tournamentLive.statusLabels.registering')).toBeInTheDocument();expect(f.close).not.toHaveBeenCalled();
});
it('opens the existing close report and refreshes only on its confirmed completion',async()=>{
 const changed=vi.fn();render(<MemoryRouter><TournamentLifecycleControls tournament={tour} onChanged={changed}/></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'Chốt giải'}));await screen.findByRole('dialog',{name:'Báo cáo chốt giải'});
 expect(f.close).not.toHaveBeenCalled();expect(changed).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Xác nhận qua báo cáo'}));expect(f.close).toHaveBeenCalledExactlyOnceWith('tour-a');expect(changed).toHaveBeenCalledOnce();
});
it('retires the open report across a replacement login session',async()=>{
 const view=render(<MemoryRouter><TournamentLifecycleControls tournament={tour} onChanged={vi.fn()}/></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'Chốt giải'}));await screen.findByRole('dialog');
 f.auth={...f.auth,session:{access_token:'TEST-replaced'}};
 view.rerender(<MemoryRouter><TournamentLifecycleControls tournament={tour} onChanged={vi.fn()}/></MemoryRouter>);
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(f.close).not.toHaveBeenCalled();
});
it('does not offer an unscoped operation when club context is absent',()=>{
 render(<MemoryRouter><TournamentLifecycleControls tournament={{...tour,club_id:null}} onChanged={vi.fn()}/></MemoryRouter>);
 expect(screen.queryByRole('link')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Chốt giải'})).toBeDisabled();
});
