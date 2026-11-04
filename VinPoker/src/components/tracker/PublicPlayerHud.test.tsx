import {act,render,screen,waitFor,cleanup,fireEvent} from '@testing-library/react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {PublicPlayerHud} from './PublicPlayerHud';
const load=vi.hoisted(()=>vi.fn());
const history=vi.hoisted(()=>vi.fn());
const access=vi.hoisted(()=>({callback:null as null|((reason:'verify'|'revoked')=>void)}));
const paid=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/preparedPublicPlayerHud',()=>({loadPreparedPublicPlayerHud:(...args:unknown[])=>load(...args),loadPublicHudHistoryPage:(...args:unknown[])=>history(...args),observePublicHudRevocation:(_tour:string,ready:(reason:'verify'|'revoked')=>void)=>{access.callback=ready;return()=>{};}}));
vi.mock('@/components/PublicPaidWinnings',()=>({PublicPaidWinnings:()=> {paid();return <section>Cashier reader</section>;}}));
beforeEach(()=>{vi.spyOn(Math,'random').mockReturnValue(0);history.mockReset();history.mockResolvedValue({hands:[],nextCursor:null});});
afterEach(()=>{cleanup();load.mockReset();paid.mockReset();vi.restoreAllMocks();});
it('uses cached verified winnings without mounting the cashier history reader',async()=>{
 load.mockResolvedValue({...result('a'),totalWinnings:500});
 render(<PublicPlayerHud tournamentId="t" playerId="a" onClose={()=>{}}/>);
 expect(await screen.findByText('500 ₫')).toBeInTheDocument();expect(paid).not.toHaveBeenCalled();
 expect(screen.getByRole('link',{name:'Xem hồ sơ người chơi'})).toHaveAttribute('href','/player/a');
});
it('clears known invalidated data while replacement history is still loading',async()=>{
 load.mockResolvedValueOnce({...result('a'),accessSnapshot:'1:2:'});
 let finish!:(value:unknown)=>void;
 load.mockImplementationOnce((_t,_p,_signal,_frozen,onChanged)=>{onChanged();return new Promise(resolve=>{finish=resolve;});});
 render(<PublicPlayerHud tournamentId="t" playerId="a" onClose={()=>{}}/>);await screen.findByText('TEST a');
 act(()=>access.callback!('verify'));await waitFor(()=>expect(load).toHaveBeenCalledTimes(2));
 expect(screen.queryByText('TEST a')).not.toBeInTheDocument();
 finish({...result('a'),name:'AFTER REVALIDATION',accessChanged:true});await screen.findByText('AFTER REVALIDATION');
});
it('clears a revoked HUD immediately before its jittered access check',async()=>{
 const random=vi.spyOn(Math,'random').mockReturnValue(0);
 try{
  load.mockResolvedValue(result('a'));
  render(<PublicPlayerHud tournamentId="t" playerId="a" onClose={()=>{}}/>);await screen.findByText('TEST a');
  load.mockResolvedValue({...result('a'),name:'REVALIDATED'});
  act(()=>access.callback!('revoked'));
  expect(screen.queryByText('TEST a')).not.toBeInTheDocument();expect(load).toHaveBeenCalledTimes(1);
  await screen.findByText('REVALIDATED');expect(load).toHaveBeenCalledTimes(2);
 }finally{random.mockRestore();}
});
it('coalesces repeated revocations and rejects the active old generation before one fresh recheck',async()=>{
 load.mockResolvedValueOnce(result('a'));render(<PublicPlayerHud tournamentId="t" playerId="a" onClose={()=>{}}/>);await screen.findByText('TEST a');
 let finish!:(value:unknown)=>void;
 load.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue({...result('a'),name:'FRESH ACCESS'});
 act(()=>access.callback!('verify'));await waitFor(()=>expect(load).toHaveBeenCalledTimes(2));
 const oldSignal=load.mock.calls[1][2] as AbortSignal;
 act(()=>{access.callback!('revoked');access.callback!('revoked');access.callback!('verify');});
 expect(screen.queryByText('TEST a')).not.toBeInTheDocument();expect(load).toHaveBeenCalledTimes(2);expect(oldSignal.aborted).toBe(false);
 await act(async()=>{finish({...result('a'),name:'STALE PRIVATE FRAME'});});
 expect(screen.queryByText('STALE PRIVATE FRAME')).not.toBeInTheDocument();
 await screen.findByText('FRESH ACCESS');expect(load).toHaveBeenCalledTimes(3);
});
it('keeps opened counters on reconnect and replaces them only after access revocation',async()=>{
 load.mockResolvedValue({...result('a'),accessSnapshot:'1:2:',accessChanged:false});
 render(<PublicPlayerHud tournamentId="t" playerId="a" onClose={()=>{}}/>);await screen.findByText('TEST a');
 load.mockResolvedValue({...result('a'),name:'NEW SNAPSHOT',accessSnapshot:'1:2:',accessChanged:false});
 access.callback!('verify');await waitFor(()=>expect(load).toHaveBeenCalledTimes(2));
 expect(screen.getByText('TEST a')).toBeInTheDocument();expect(screen.queryByText('NEW SNAPSHOT')).not.toBeInTheDocument();
 load.mockResolvedValue({...result('a'),name:'NEW SNAPSHOT',accessSnapshot:'1:3:',accessChanged:true});
 access.callback!('verify');await screen.findByText('NEW SNAPSHOT');
});
const metric={percentage:null,numerator:0,denominator:0,sampleSize:0,metricVersion:'test'};
const result=(id:string)=>({tournamentId:'t',playerId:id,name:`TEST ${id}`,avatarUrl:null,sampledTournamentHands:0,truncated:false,handHistory:[],totalWinnings:null,recentResults:[],analytics:{handsObserved:0,metrics:Object.fromEntries(['vpip','pfr','ats','threeBet','flopCbet','flopFoldCbet','flopCallCbet','flopRaiseCbet','turnCbet','turnFoldCbet','turnCallCbet','turnRaiseCbet','wtsd','wsd','riverAggression'].map(k=>[k,metric]))}});
it('shows unknown values rather than fake 0% for a new player',async()=>{
  load.mockResolvedValue(result('a'));render(<PublicPlayerHud tournamentId="t" playerId="a" onClose={()=>{}}/>);
  await screen.findByText('TEST a');expect(screen.queryByText('0%')).not.toBeInTheDocument();expect(screen.getByText('VPIP')).toBeInTheDocument();expect(screen.getByText('ATS')).toBeInTheDocument();
});
it('does not flash the previous player or accept a late response after changing seats',async()=>{
  let finish:(value:unknown)=>void;load.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue(result('b'));
  const view=render(<PublicPlayerHud tournamentId="t" playerId="a" onClose={()=>{}}/>);
  await waitFor(()=>expect(load).toHaveBeenCalledTimes(1));
  view.rerender(<PublicPlayerHud tournamentId="t" playerId="b" onClose={()=>{}}/>);
  await screen.findByText('TEST b');finish(result('a'));await waitFor(()=>expect(screen.queryByText('TEST a')).not.toBeInTheDocument());
});

it('opens Vietnamese metric help with the actual opportunities and switches explanation',async()=>{
  const data=result('a');data.analytics.handsObserved=40;
  data.analytics.metrics.vpip={...metric,percentage:30,numerator:12,denominator:40,sampleSize:40};
  load.mockResolvedValue(data);render(<PublicPlayerHud tournamentId="t" playerId="a" onClose={()=>{}}/>);
  await screen.findByText('TEST a');
  fireEvent.click(screen.getByRole('button',{name:'Giải thích VPIP'}));
  await screen.findByRole('dialog',{name:'Giải thích chỉ số HUD'});
  expect(screen.getByText('12 / 40 × 100 = 30%')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'FLOP · RCB'}));
  await screen.findByRole('heading',{name:'Flop — Raise to Continuation Bet'});
  expect(screen.getByText(/Dấu — không có nghĩa là 0%/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Close'}));
  await screen.findByRole('button',{name:'Giải thích VPIP'});
  expect(screen.getByText('TEST a')).toBeInTheDocument();
});

it('shows metrics only after the complete prepared snapshot arrives',async()=>{
 let resolve!:(value:unknown)=>void;
 const data=result('a');data.analytics.metrics.vpip={...metric,percentage:99,numerator:99,denominator:100,sampleSize:100};
 load.mockImplementation(()=>new Promise(done=>{resolve=done;}));
 render(<PublicPlayerHud tournamentId="t" playerId="a" onClose={()=>{}}/>);
 await screen.findByText('Đang tải thống kê người chơi…');
 expect(screen.queryByText('99%')).not.toBeInTheDocument();
 resolve(data);await screen.findByText('99%');
 expect(screen.queryByText('Đang tải thống kê người chơi…')).not.toBeInTheDocument();
});
it('shows frozen metrics while tour history is pending and keeps them on a history failure',async()=>{
 let reject!:(error:Error)=>void;history.mockImplementation(()=>new Promise((_resolve,fail)=>{reject=fail;}));
 load.mockResolvedValue({...result('a'),totalWinnings:500});
 render(<PublicPlayerHud tournamentId="t" playerId="a" onClose={()=>{}}/>);
 await screen.findByText('500 ₫');await screen.findByText('Đang tải lịch sử tour…');
 await act(async()=>reject(Error('history unavailable')));
 await screen.findByText(/Không tải được lịch sử tour/);expect(screen.getByText('500 ₫')).toBeInTheDocument();
 history.mockResolvedValue({hands:[],nextCursor:null});fireEvent.click(screen.getByRole('button',{name:'Thử lại lịch sử'}));
 await waitFor(()=>expect(screen.queryByText(/Không tải được lịch sử tour/)).not.toBeInTheDocument());
 expect(load).toHaveBeenCalledTimes(1);expect(history).toHaveBeenCalledTimes(2);
});
it('aborts late history on player change without changing the next player snapshot',async()=>{
 let finish!:(value:unknown)=>void;history.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 load.mockImplementation((_t,p)=>Promise.resolve(result(p)));
 const view=render(<PublicPlayerHud tournamentId="t" playerId="a" onClose={()=>{}}/>);
 await screen.findByText('TEST a');await waitFor(()=>expect(history).toHaveBeenCalledTimes(1));const signal=history.mock.calls[0][2] as AbortSignal;
 view.rerender(<PublicPlayerHud tournamentId="t" playerId="b" onClose={()=>{}}/>);await screen.findByText('TEST b');expect(signal.aborted).toBe(true);
 await act(async()=>finish({hands:[],nextCursor:{handId:'old',playedAt:null}}));
 expect(screen.queryByRole('button',{name:'Xem thêm 50 hand trong tour'})).not.toBeInTheDocument();
});
it('clears aggregate data when the independent history read proves access was withdrawn',async()=>{
 let reject!:(error:Error)=>void;history.mockImplementation(()=>new Promise((_resolve,fail)=>{reject=fail;}));
 load.mockResolvedValue({...result('a'),totalWinnings:500});
 render(<PublicPlayerHud tournamentId="t" playerId="a" onClose={()=>{}}/>);await screen.findByText('500 ₫');
 await waitFor(()=>expect(history).toHaveBeenCalledTimes(1));await act(async()=>reject(Error('PUBLIC_HUD_ACCESS_REVOKED')));
 await screen.findByText(/Không tải đủ thống kê công khai/);expect(screen.queryByText('500 ₫')).not.toBeInTheDocument();
});
it('aborts pending independent history immediately on an access revocation event',async()=>{
 history.mockImplementation(()=>new Promise(()=>{}));load.mockResolvedValue(result('a'));
 render(<PublicPlayerHud tournamentId="t" playerId="a" onClose={()=>{}}/>);await screen.findByText('TEST a');
 await waitFor(()=>expect(history).toHaveBeenCalledTimes(1));const signal=history.mock.calls[0][2] as AbortSignal;
 act(()=>access.callback!('revoked'));expect(signal.aborted).toBe(true);expect(screen.queryByText('TEST a')).not.toBeInTheDocument();
});
it('shows no partial statistics if the prepared read fails',async()=>{
 load.mockRejectedValue(new Error('read failed'));
 render(<PublicPlayerHud tournamentId="t" playerId="a" onClose={()=>{}}/>);
  await screen.findByRole('alert');expect(screen.queryByText('TEST a')).not.toBeInTheDocument();expect(screen.queryByText('0%')).not.toBeInTheDocument();
});
