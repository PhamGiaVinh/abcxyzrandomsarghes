import {render,screen,fireEvent} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import viLocale from '@/i18n/locales/vi.json';
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:null})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
vi.mock('@/components/FomoPrice',()=>({FomoPrice:()=>null}));
vi.mock('@/components/LiveStateEditor',()=>({LiveStateEditor:()=>null}));
vi.mock('@/components/cashier/tournament-live/BlindEditorPanel',()=>({BlindEditorPanel:()=>null}));
vi.mock('@/components/cashier/tournament-live/BlindDraftBuilder',()=>({BlindDraftBuilder:()=>null}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{}}));
import {TournamentCard} from './TournamentManagerShared';

describe('Floor tournament card status display',()=>{
 it('renders registration-open status and preserves the original writer choices',()=>{
  const setStatus=vi.fn();const start=vi.fn();
  render(<TournamentCard tour={{id:'tour-test',name:'TEST registration open',status:'registration_open',
   start_time:'2026-10-14T10:00:00Z',starting_stack:20000,buy_in:0}}
   multiClub={false} reload={vi.fn()} onDelete={vi.fn()} onSetStatus={setStatus} onStart={start}/>);
  const selector=screen.getByRole('combobox');
  expect(selector).toHaveTextContent('Đang đăng ký');
  expect(setStatus).not.toHaveBeenCalled();expect(start).not.toHaveBeenCalled();
  fireEvent.keyDown(selector,{key:'ArrowDown'});
  expect(screen.getAllByRole('option')).toHaveLength(4);
  expect(screen.queryByRole('option',{name:'Đang đăng ký'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('option',{name:viLocale.clubAdmin.live}));
  expect(setStatus).toHaveBeenCalledExactlyOnceWith('tour-test','live');
  expect(start).not.toHaveBeenCalled();
 });
});
