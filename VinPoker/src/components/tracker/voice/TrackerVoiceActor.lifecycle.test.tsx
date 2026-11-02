import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import type {ComponentProps} from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {StandaloneHandInput} from '@/components/cashier/tournament-live/handinput/useStandaloneHandInput';
import {MockRealtimeTranscriptionProvider,type TrackerVoiceRuntimeContext} from '@/lib/trackerVoice';

const h=vi.hoisted(()=>({auth:{user:{id:'actor-a'} as {id:string}|null,loading:false},load:vi.fn(),
 provider:null as MockRealtimeTranscriptionProvider|null,runtime:null as TrackerVoiceRuntimeContext|null}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>h.auth}));
vi.mock('@/lib/trackerVoice',async original=>({...await original<typeof import('@/lib/trackerVoice')>(),loadTrackerVoiceRuntimeContext:(...args:unknown[])=>h.load(...args)}));
vi.mock('./TrackerVoicePanel',async original=>{
 const actual=await original<typeof import('./TrackerVoicePanel')>();
 return {...actual,TrackerVoicePanel:(props:ComponentProps<typeof actual.TrackerVoicePanel>)=>
  <actual.TrackerVoicePanel {...props} providerOverride={h.provider!} runtimeOverride={h.runtime!}/>};
});
import {TrackerVoicePanelGate} from './TrackerVoicePanelGate';

beforeEach(()=>{
 h.auth={user:{id:'actor-a'},loading:false};h.provider=new MockRealtimeTranscriptionProvider();
 h.runtime={ok:true,can_mint_session:true,read_only:false,correction_pending:false,
  config:{enabled:true,configured_mode:'shadow',provider_model:'gpt-live-transcribe',spoken_amount_unit:1,
   amount_unit_confirmed:false,provider_confidence_threshold:null,server_auto_allowed:false,correction_state:'ready'},
  active_hand:null};
 h.load.mockReset().mockResolvedValueOnce(h.runtime).mockImplementation(()=>new Promise(()=>{}));
});
afterEach(cleanup);

describe('actual Voice Gate + Panel provider lifetime',()=>{
 for(const change of ['actor','logout','loading'])it(`disconnects connected TEST provider during ${change}`,async()=>{
  const write=vi.fn();
  const hook={tournamentId:'tour-a',tournamentTableId:'table-a',tableId:'physical-a',handId:null,
   currentStreet:'preflop',workflowState:'setup_blinds',handStarted:false,showActionStep:false,isReadOnly:false,
   handleVoiceAction:write} as unknown as StandaloneHandInput;
  const disconnect=vi.spyOn(h.provider!,'disconnect');
  const connectProvider=vi.spyOn(h.provider!,'connect');
  const view=render(<TrackerVoicePanelGate hook={hook}/>);
  const connect=await screen.findByRole('button',{name:'Cho phép microphone'});
  fireEvent.click(connect);
  expect(await screen.findByText('Microphone đã kết nối')).toBeTruthy();
  expect(disconnect).not.toHaveBeenCalled();
  const oldHandlers=connectProvider.mock.calls[0][0];
  h.auth=change==='actor'?{user:{id:'actor-b'},loading:false}:change==='logout'?{user:null,loading:false}:{user:{id:'actor-a'},loading:true};
  view.rerender(<TrackerVoicePanelGate hook={hook}/>);
  await waitFor(()=>expect(disconnect).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('Microphone đã kết nối')).toBeNull();
  expect(()=>h.provider!.emit('seat three call',{final:true,id:'old-actor-after-disconnect'})).toThrow('mock_provider_not_connected');
  const readCount=h.load.mock.calls.length;
  await act(async()=>oldHandlers.onTranscript({transcript:'seat three call',isFinal:true,
   providerEventId:'queued-before-disconnect',capturedAt:new Date().toISOString()}));
  expect(h.load).toHaveBeenCalledTimes(readCount);
  expect(write).not.toHaveBeenCalled();
  expect(screen.queryByRole('button',{name:'Xác nhận action'})).toBeNull();
 });
});
