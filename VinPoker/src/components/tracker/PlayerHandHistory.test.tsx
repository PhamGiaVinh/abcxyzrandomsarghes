import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {PlayerHandHistory} from './PlayerHandHistory';
import type {PublicPlayerHand} from '@/lib/publicPlayerHud';
afterEach(cleanup);
const T='12ea401a-9790-4c3f-8aed-818cd1d5eddd';
const hand=(id:string,table:string|null,stack:number|null):PublicPlayerHand=>({handId:id,tableId:table,tableSessionId:null,handNumber:1,playedAt:null,endingStack:stack,netDelta:stack===null?null:0});
it('opens the exact hand and table even when hand numbers repeat across tables',()=>{
  render(<PlayerHandHistory tournamentId={T} hands={[hand('first','table-a',100),hand('second','table-b',0)]}/>);
  const dots=screen.getAllByRole('link',{name:/^Replay hand/});
  expect(dots).toHaveLength(2);
  for(const [i,h] of [['first','table-a'],['second','table-b']].entries()) {
    const url=new URL(dots[i].getAttribute('href')!,'https://vinpoker.vercel.app');
    expect(url.pathname).toBe(`/live/${T}`);expect(url.searchParams.get('handId')).toBe(h[0]);
    expect(url.searchParams.get('tableId')).toBe(h[1]);expect(url.searchParams.get('tab')).toBe('hands');
    expect(url.searchParams.has('handNumber')).toBe(false);
  }
});
it('keeps missing proof blank while still providing its existing replay',()=>{
  const {container}=render(<PlayerHandHistory tournamentId={T} hands={[hand('a','table',10),hand('b','table',null),hand('c','table',20)]}/>);
  expect(screen.getAllByRole('link',{name:/^Replay hand/})).toHaveLength(2);
  expect(screen.getAllByRole('link',{name:/^Mở replay hand/})).toHaveLength(3);
  expect(screen.getByText('Stack chưa xác minh')).toBeInTheDocument();
  expect(container.querySelector('path')?.getAttribute('d')?.match(/M/g)).toHaveLength(2);
});
it('uses stable hand identity without guessing a missing legacy table',()=>{
  render(<PlayerHandHistory tournamentId={T} hands={[hand('a',null,100)]}/>);
  const url=new URL(screen.getByRole('link',{name:/^Replay hand/}).getAttribute('href')!,'https://vinpoker.vercel.app');
  expect(url.searchParams.get('handId')).toBe('a');expect(url.searchParams.has('tableId')).toBe(false);
});
it('explains an empty player history',()=>{
  render(<PlayerHandHistory tournamentId={T} hands={[]}/>);
  expect(screen.getByText(/Chưa có hand hoàn tất/)).toBeInTheDocument();expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('plots ten verified hands flat for unchanged stacks and up/down for chip changes',()=>{
  const stacks=[100,100,100,130,110,110,150,140,140,160];
  render(<PlayerHandHistory tournamentId={T} hands={stacks.map((stack,i)=>({...hand(`hand-${i+1}`,'table',stack),handNumber:i+1}))}/>);
  const dots=screen.getAllByRole('link',{name:/^Replay hand/});
  const top=(i:number)=>Number.parseFloat(dots[i].style.top);
  expect(top(0)).toBe(top(1));expect(top(1)).toBe(top(2));
  expect(top(3)).toBeLessThan(top(2));expect(top(4)).toBeGreaterThan(top(3));
  expect(top(4)).toBe(top(5));expect(top(9)).toBeLessThan(top(8));
  expect(dots[1].querySelector('span')).toHaveClass('text-yellow-400');
  expect(dots[3].querySelector('span')).toHaveClass('text-emerald-400');
  expect(dots[4].querySelector('span')).toHaveClass('text-red-400');
  expect(screen.getByText('↗ Tăng chip')).toBeInTheDocument();
  expect(screen.getByText(/fold vẫn có thể mất chip/)).toBeInTheDocument();
});
