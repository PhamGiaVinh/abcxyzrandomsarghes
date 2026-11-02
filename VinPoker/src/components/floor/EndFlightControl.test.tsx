import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {EndFlightControl} from './EndFlightControl';
import {eventJournalKey,persistEventJournal} from '@/ops/floor/multiDayEventJournal';
const h=vi.hoisted(()=>{const rpc=vi.fn();return {rpc,client:{rpc}};});
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>h.client}));
const actorId='actor',eventId='event',flightId='40000000-0000-4000-8000-000000000001';
const props={actorId,eventId,flightId,ended:false,canStart:true,blocked:false,onPendingChange:vi.fn(),onEnded:vi.fn()};
const receipt={ok:true,status:'bagging',rosterCount:8,rosterHash:'a'.repeat(32),idempotent:false};
const open=()=>{fireEvent.change(screen.getByLabelText('Day number'),{target:{value:'1'}});fireEvent.click(screen.getByRole('button',{name:'End Flight'}));};
beforeEach(()=>{sessionStorage.clear();h.rpc.mockReset();props.onPendingChange.mockClear();props.onEnded.mockClear();});
afterEach(cleanup);
it('requires an explicit positive day and confirmation, never writes on opening',()=>{
 render(<EndFlightControl {...props}/>);fireEvent.click(screen.getByRole('button',{name:'End Flight'}));
 expect(screen.getByRole('button',{name:'Confirm End Flight'})).toBeDisabled();expect(h.rpc).not.toHaveBeenCalled();
});
it('synchronously fences duplicate confirmation and accepts a validated receipt',async()=>{
 let finish!:(v:unknown)=>void;h.rpc.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 render(<EndFlightControl {...props}/>);open();const confirm=screen.getByRole('button',{name:'Confirm End Flight'});
 fireEvent.click(confirm);fireEvent.click(confirm);expect(h.rpc).toHaveBeenCalledTimes(1);
 const args=h.rpc.mock.calls[0][1];expect(args.p_flight_tournament_id).toBe(flightId);expect(args.p_day_number).toBe(1);
 expect(sessionStorage.getItem(eventJournalKey('end-flight',actorId,eventId))).toContain(args.p_request_id);
 await act(async()=>finish({data:receipt,error:null}));expect(props.onEnded).toHaveBeenCalledTimes(1);
 expect(sessionStorage.getItem(eventJournalKey('end-flight',actorId,eventId))).toBeNull();
});
it.each([null,{...receipt,rosterCount:0},{...receipt,rosterHash:'wrong'},{...receipt,idempotent:undefined}])('retains malformed/unknown receipt through remount: %j',async data=>{
 h.rpc.mockResolvedValueOnce({data,error:null}).mockResolvedValueOnce({data:{...receipt,idempotent:true},error:null});
 const first=render(<EndFlightControl {...props}/>);open();fireEvent.click(screen.getByRole('button',{name:'Confirm End Flight'}));
 await screen.findByRole('alert');const args=h.rpc.mock.calls[0][1];expect(props.onEnded).not.toHaveBeenCalled();first.unmount();
 render(<EndFlightControl {...props} ended canStart={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'Verify retained End Flight request'}));
 await waitFor(()=>expect(props.onEnded).toHaveBeenCalledTimes(1));expect(h.rpc.mock.calls[1][1]).toEqual(args);
 expect(h.rpc.mock.calls[1][1].p_request_id).toBe(args.p_request_id);
});
it('retains a blocked active-hand intent and explains how to recover',async()=>{
 h.rpc.mockResolvedValue({data:null,error:{message:'multi_day_end_flight_not_ready'}});
 render(<EndFlightControl {...props}/>);open();fireEvent.click(screen.getByRole('button',{name:'Confirm End Flight'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Finish active hands');
 expect(sessionStorage.getItem(eventJournalKey('end-flight',actorId,eventId))).not.toBeNull();
});
it('does not clear an old scope journal or refresh a new scope on late completion',async()=>{
 let finish!:(v:unknown)=>void;h.rpc.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 const first=render(<EndFlightControl key="old" {...props}/>);open();fireEvent.click(screen.getByRole('button',{name:'Confirm End Flight'}));
 first.rerender(<EndFlightControl key="new" {...props} actorId="other"/>);
 await act(async()=>finish({data:receipt,error:null}));expect(props.onEnded).not.toHaveBeenCalled();
 expect(sessionStorage.getItem(eventJournalKey('end-flight',actorId,eventId))).not.toBeNull();
});
it('blocks other event write journals synchronously while End Flight is unknown',async()=>{
 h.rpc.mockResolvedValue({data:null,error:{message:'network'}});render(<EndFlightControl {...props}/>);open();
 fireEvent.click(screen.getByRole('button',{name:'Confirm End Flight'}));await screen.findByRole('alert');
 expect(()=>persistEventJournal(sessionStorage,'qualify',actorId,eventId,'{}')).toThrow('PENDING');
});
