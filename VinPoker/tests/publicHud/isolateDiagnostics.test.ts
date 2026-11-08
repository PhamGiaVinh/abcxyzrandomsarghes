import {it,expect,vi} from 'vitest';
import {createIsolateDiagnostics} from '../../supabase/functions/public-player-hud/isolateDiagnostics';
it('is silent unless explicitly enabled',()=>{
 const emit=vi.fn(),d=createIsolateDiagnostics(false,emit);d.begin()();d.shutdown('CPUTime');expect(emit).not.toHaveBeenCalled();
});
it('counts active requests and completes each once without request data',()=>{
 let now=10;const emit=vi.fn(),d=createIsolateDiagnostics(true,emit,()=>now);
 const first=d.begin();d.begin();first();first();now=35;d.shutdown('CPUTime');
 expect(emit).toHaveBeenCalledWith({kind:'PUBLIC_HUD_ISOLATE_SHUTDOWN',reason:'CPUTime',ageMs:25,received:2,completed:1,active:1});
});
it('never emits arbitrary shutdown text and telemetry failure cannot fail a read',()=>{
 const emit=vi.fn(),d=createIsolateDiagnostics(true,emit);d.shutdown('private request text');
 expect(emit.mock.calls[0][0].reason).toBe('unknown');expect(JSON.stringify(emit.mock.calls)).not.toContain('private request text');
 expect(()=>createIsolateDiagnostics(true,()=>{throw Error('observer');}).shutdown('EarlyDrop')).not.toThrow();
});

it('normalizes every pinned runtime string and legacy object reason without widening the allowlist',()=>{
 const emit=vi.fn(),d=createIsolateDiagnostics(true,emit);
 for(const [raw,expected] of [['cpu','CPUTime'],['memory','Memory'],['wall_clock','WallClockTime'],['early_drop','EarlyDrop'],['termination','TerminationRequested']]){
  d.shutdown(raw);expect(emit.mock.calls.at(-1)[0].reason).toBe(expected);
  d.shutdown({reason:raw});expect(emit.mock.calls.at(-1)[0].reason).toBe(expected);
 }
 d.shutdown({reason:'private-value'});expect(emit.mock.calls.at(-1)[0].reason).toBe('unknown');expect(JSON.stringify(emit.mock.calls)).not.toContain('private-value');
});
