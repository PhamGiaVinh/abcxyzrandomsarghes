import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/components/cashier/tournament-live/LiveFelt',async importOriginal=>({...await importOriginal<typeof import('@/components/cashier/tournament-live/LiveFelt')>(),
  LiveFelt:({showdownPresentation,replayRunoutPresentation}:{showdownPresentation?:{winners:{playerName:string}[]};replayRunoutPresentation?:{phase:string}|null})=>
  <p data-testid="preview-result">{replayRunoutPresentation?.phase??'none'}:{showdownPresentation?.winners.map(w=>w.playerName).join(',')}</p>}));
vi.mock('@/components/cashier/tournament-live/ReplayScrubber',()=>({ReplayScrubber:({onSelectedPotIndexChange,onRunoutPresentation}:{onSelectedPotIndexChange?:(n:number)=>void;onRunoutPresentation?:(v:null)=>void})=>
  <button onClick={()=>{onRunoutPresentation?.(null);onSelectedPotIndexChange?.(1);}}>Review side pot TEST</button>}));
vi.mock('@/lib/tracker-poker/useTrackerRunoutSounds',()=>({useTrackerRunoutSounds:()=>{}}));
import LiveFeltPreview from './LiveFeltPreview';
afterEach(cleanup);
it('mirrors real viewer static fallback and selected-pot callback after playback',()=>{
  render(<MemoryRouter initialEntries={['/__dev/livefelt?fixture=verified-sidepots&play=1&autoplay=0']}><LiveFeltPreview/></MemoryRouter>);
  expect(screen.getByTestId('preview-result')).toHaveTextContent(/^static:/);
  fireEvent.click(screen.getByRole('button',{name:'Review side pot TEST'}));
  expect(screen.getByTestId('preview-result')).toHaveTextContent('Phil Ivey');
  expect(screen.getByTestId('preview-result')).not.toHaveTextContent('Tom Dwan');
});
