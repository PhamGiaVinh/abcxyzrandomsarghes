import {render,screen,waitFor,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PublicPlayerHud} from './PublicPlayerHud';
const load=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/publicPlayerHud',()=>({loadPublicPlayerHud:(...args:unknown[])=>load(...args)}));
afterEach(()=>{cleanup();load.mockReset();});
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
