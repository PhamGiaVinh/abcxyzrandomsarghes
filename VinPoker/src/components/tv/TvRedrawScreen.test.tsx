import {afterEach,describe,expect,it} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {TvRedrawScreen} from './TvRedrawScreen';
import type {TournamentRedrawTvBatch} from '@/hooks/useTournamentRedrawTv';
afterEach(cleanup);
const batch:TournamentRedrawTvBatch={batchId:'test',redrawRevision:2,tournamentName:'D2 TEST',targetMaxSeats:9,
 appliedAt:new Date().toISOString(),moves:[{ordinal:1,playerName:'Người TEST',fromTableNumber:7,fromSeatNumber:3,toTableNumber:8,toSeatNumber:2}]};
describe('TV redraw source semantics',()=>{
 it('labels initial D2 instead of fabricating old table and seat',()=>{
  render(<TvRedrawScreen tournamentName="D2 TEST" batch={{...batch,kind:'initial_d2',moves:[{...batch.moves[0],fromTableNumber:null,fromSeatNumber:null}]}}/>);
  expect(screen.getByText('D2 · Initial seating')).toBeTruthy();
  expect(screen.queryByText(/Table 7 · Seat 3/)).toBeNull();
  expect(screen.getByText('Seat 2')).toBeTruthy();
 });
 it('preserves ordinary old-to-new redraw presentation',()=>{
  render(<TvRedrawScreen tournamentName="D2 TEST" batch={batch}/>);
  expect(screen.getByText('Table 7 · Seat 3')).toBeTruthy();
  expect(screen.queryByText('D2 · Initial seating')).toBeNull();
 });
});
