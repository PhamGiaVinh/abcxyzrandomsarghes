import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import PlayerHistoryDialog from './PlayerHistoryDialog';
const h=vi.hoisted(()=>({reads:[] as {player:string;signal?:AbortSignal;resolve:(x:unknown)=>void}[]}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{
 let player='',signal:AbortSignal|undefined;
 const q={select:()=>q,eq:(key:string,value:string)=>{if(key==='player_id')player=value;return q;},order:()=>q,
 abortSignal:(value:AbortSignal)=>{signal=value;return q;},
 then:(resolve:(x:unknown)=>unknown,reject:(x:unknown)=>unknown)=>new Promise(done=>h.reads.push({player,signal,resolve:done})).then(resolve,reject)};return q;
}}}));
const row=(player='a',name='Tour A')=>({id:'result-'+player,player_id:player,verified_by_admin:true,tournament_name:name,event_date:'2026-10-20',position:1,buy_in:100,prize:200});
const props={playerId:'a',playerName:'Player A',open:true,onOpenChange:vi.fn()};
describe('PlayerHistoryDialog read integrity',()=>{
 beforeEach(()=>{h.reads=[];});afterEach(()=>{cleanup();vi.useRealTimers();});
 it('shows a read error instead of verified empty and supports explicit retry',async()=>{
  render(<PlayerHistoryDialog {...props}/>);await waitFor(()=>expect(h.reads).toHaveLength(1));
  await act(async()=>h.reads[0].resolve({data:null,error:{message:'offline'}}));
  expect(screen.getByRole('alert')).toHaveTextContent('playerHistory.loadError');
  expect(screen.queryByText('playerHistory.noVerifiedResults')).not.toBeInTheDocument();
  expect(screen.queryByText('playerHistory.totalCashout')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'playerHistory.retry'}));await waitFor(()=>expect(h.reads).toHaveLength(2));
  await act(async()=>h.reads[1].resolve({data:[row()],error:null}));expect(screen.getAllByText('Tour A')).toHaveLength(2);
 });
 it('hides prior totals immediately when another player is selected',async()=>{
  const view=render(<PlayerHistoryDialog {...props}/>);await waitFor(()=>expect(h.reads).toHaveLength(1));
  await act(async()=>h.reads[0].resolve({data:[row()],error:null}));
  view.rerender(<PlayerHistoryDialog {...props} playerId="b" playerName="Player B"/>);
  expect(screen.queryByText('Tour A')).not.toBeInTheDocument();expect(screen.queryByText('playerHistory.totalCashout')).not.toBeInTheDocument();
 });
 it('ignores a late player A response after player B has loaded',async()=>{
  const view=render(<PlayerHistoryDialog {...props}/>);await waitFor(()=>expect(h.reads).toHaveLength(1));
  view.rerender(<PlayerHistoryDialog {...props} playerId="b" playerName="Player B"/>);await waitFor(()=>expect(h.reads).toHaveLength(2));
  expect(h.reads[0].signal?.aborted).toBe(true);
  await act(async()=>h.reads[1].resolve({data:[row('b','Tour B')],error:null}));
  await act(async()=>h.reads[0].resolve({data:[row()],error:null}));
  expect(screen.getAllByText('Tour B')).toHaveLength(2);expect(screen.queryByText('Tour A')).not.toBeInTheDocument();
 });
 it('settles a hung read after ten seconds and aborts its transport',async()=>{
  vi.useFakeTimers();render(<PlayerHistoryDialog {...props}/>);await act(async()=>{await Promise.resolve();});
  await act(async()=>{await vi.advanceTimersByTimeAsync(10_000);});expect(screen.getByRole('alert')).toBeInTheDocument();expect(h.reads[0].signal?.aborted).toBe(true);
  await act(async()=>h.reads[0].resolve({data:[row()],error:null}));
  expect(screen.getByRole('alert')).toBeInTheDocument();expect(screen.queryByText('Tour A')).not.toBeInTheDocument();expect(h.reads).toHaveLength(1);
 });
 it('starts a fresh read when the same player dialog is closed and reopened',async()=>{
  const view=render(<PlayerHistoryDialog {...props}/>);await waitFor(()=>expect(h.reads).toHaveLength(1));
  view.rerender(<PlayerHistoryDialog {...props} open={false}/>);expect(h.reads[0].signal?.aborted).toBe(true);
  view.rerender(<PlayerHistoryDialog {...props}/>);await waitFor(()=>expect(h.reads).toHaveLength(2));
  await act(async()=>h.reads[1].resolve({data:[row('a','Current result')],error:null}));
  await act(async()=>h.reads[0].resolve({data:[row('a','Old result')],error:null}));
  expect(screen.queryByText('Old result')).not.toBeInTheDocument();expect(screen.getAllByText('Current result')).toHaveLength(2);
 });
 it.each([null,[null],[row('b')]])('rejects unverified or wrong-player payload %j',async(data)=>{
  render(<PlayerHistoryDialog {...props}/>);await waitFor(()=>expect(h.reads).toHaveLength(1));
  await act(async()=>h.reads[0].resolve({data,error:null}));expect(screen.getByRole('alert')).toBeInTheDocument();
 });
 it('accepts a verified empty list',async()=>{
  render(<PlayerHistoryDialog {...props}/>);await waitFor(()=>expect(h.reads).toHaveLength(1));
  await act(async()=>h.reads[0].resolve({data:[],error:null}));expect(screen.getByText('playerHistory.noVerifiedResults')).toBeInTheDocument();
 });
});
