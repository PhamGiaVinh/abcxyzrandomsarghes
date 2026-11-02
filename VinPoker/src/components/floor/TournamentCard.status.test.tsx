import {render,screen,fireEvent} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:null})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
vi.mock('@/components/FomoPrice',()=>({FomoPrice:()=>null}));
vi.mock('@/components/LiveStateEditor',()=>({LiveStateEditor:()=>null}));
vi.mock('@/components/cashier/tournament-live/BlindEditorPanel',()=>({BlindEditorPanel:()=>null}));
vi.mock('@/components/cashier/tournament-live/BlindDraftBuilder',()=>({BlindDraftBuilder:()=>null}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{}}));
import {TournamentCard} from './TournamentManagerShared';

describe('Floor tournament card status display',()=>{
 for(const status of ['completed','cancelled','finished'])it(`does not offer a raw restart for terminal status ${status}`,()=>{
  render(<TournamentCard tour={{id:'closed-tour',name:'TEST closed',status,start_time:'2026-10-14T10:00:00Z',starting_stack:20000,buy_in:0}}
   multiClub={false} reload={vi.fn()} onDelete={vi.fn()} onStart={vi.fn()}/>);
  expect(screen.queryByRole('button',{name:'Bắt đầu giải (chạy đồng hồ + lên live)'})).not.toBeInTheDocument();
 });
 it('renders registration-open as an observed status, not a direct status writer',()=>{
  const start=vi.fn();
  render(<TournamentCard tour={{id:'tour-test',name:'TEST registration open',status:'registration_open',
   start_time:'2026-10-14T10:00:00Z',starting_stack:20000,buy_in:0}}
   multiClub={false} reload={vi.fn()} onDelete={vi.fn()} onStart={start}/>);
  expect(screen.getByText('Đang đăng ký')).toBeInTheDocument();expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Bắt đầu giải (chạy đồng hồ + lên live)'}));
  expect(start).toHaveBeenCalledExactlyOnceWith('tour-test');
 });
});
