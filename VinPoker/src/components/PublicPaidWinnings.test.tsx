import {act,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc}}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
import {PublicPaidWinnings} from './PublicPaidWinnings';
const paid=(playerId:string,totalWinnings:number)=>({data:{playerId,totalWinnings,complete:true,scope:'cashier-confirmed'},error:null});
beforeEach(()=>mock.rpc.mockReset());
describe('public paid winnings',()=>{
 it('freezes HUD winnings until the window is reopened',async()=>{
  mock.rpc.mockReturnValue({abortSignal:async()=>paid('a',2000000)});
  const view=render(<PublicPaidWinnings playerId="a" live={false}/>);
  expect(await screen.findByText('2.000.000 ₫')).toBeInTheDocument();
  vi.useFakeTimers();
  try{await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});expect(mock.rpc).toHaveBeenCalledTimes(1);}
  finally{vi.useRealTimers();view.unmount();}
  mock.rpc.mockReturnValue({abortSignal:async()=>paid('a',3000000)});
  const reopened=render(<PublicPaidWinnings playerId="a" live={false}/>);
  expect(await screen.findByText('3.000.000 ₫')).toBeInTheDocument();expect(mock.rpc).toHaveBeenCalledTimes(2);reopened.unmount();
 });
 it('reads actual paid winnings and fails closed on a mismatched player',async()=>{
  mock.rpc.mockReturnValue({abortSignal:async()=>paid('a',2000000)});
  const view=render(<PublicPaidWinnings playerId="a"/>);
  expect(await screen.findByText('2.000.000 ₫')).toBeInTheDocument();
  expect(mock.rpc).toHaveBeenCalledWith('get_public_player_paid_winnings_v1',{p_player_id:'a'});
  view.rerender(<PublicPaidWinnings playerId="b"/>);
  expect(screen.queryByText('2.000.000 ₫')).not.toBeInTheDocument();
  expect(await screen.findByText('playerFinance.unavailable')).toBeInTheDocument();
 });
 it('ignores a late old-player response after selection changes',async()=>{
  let finish!:(value:unknown)=>void;
  mock.rpc.mockReturnValueOnce({abortSignal:()=>new Promise(resolve=>{finish=resolve;})})
   .mockReturnValue({abortSignal:async()=>paid('b',10000)});
  const view=render(<PublicPaidWinnings playerId="a"/>);
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledTimes(1));
  view.rerender(<PublicPaidWinnings playerId="b"/>);
  expect(await screen.findByText('10.000 ₫')).toBeInTheDocument();
  finish(paid('a',2000000));
  await waitFor(()=>expect(screen.queryByText('2.000.000 ₫')).not.toBeInTheDocument());
 });
});
