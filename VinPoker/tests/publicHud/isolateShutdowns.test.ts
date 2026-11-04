import {it,expect} from 'vitest';
import {sanitizeIsolateShutdowns} from './scale.failures.mjs';
it('exports only allowlisted shutdown fields, never surrounding logs or extra fields',()=>{
 const value={kind:'PUBLIC_HUD_ISOLATE_SHUTDOWN',reason:'CPUTime',ageMs:20,received:3,completed:2,active:1,secret:'private'};
 const events=sanitizeIsolateShutdowns('private-log PUBLIC_HUD_ISOLATE_DIAGNOSTIC '+JSON.stringify(value)+'\nother-private-log');
 expect(events).toEqual([{reason:'CPUTime',ageMs:20,received:3,completed:2,active:1}]);expect(JSON.stringify(events)).not.toContain('private');
});
it('rejects malformed, negative, inconsistent and unapproved telemetry',()=>{
 const base={kind:'PUBLIC_HUD_ISOLATE_SHUTDOWN',reason:'EarlyDrop',ageMs:20,received:1,completed:1,active:0};
 for(const update of [{reason:'private'},{ageMs:-1},{active:1},{received:1.5},{kind:'private'}])expect(sanitizeIsolateShutdowns('PUBLIC_HUD_ISOLATE_DIAGNOSTIC '+JSON.stringify({...base,...update}))).toEqual([]);
});
