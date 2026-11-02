import {expect,it} from 'vitest';
import {deriveLiveStreet} from '../../src/lib/tracker-poker/liveDisplay';
// Actual181 viewer said showdown on a three-card all-in runout with revealed
// AA/KK. Early public reveal closes betting, not the remaining board streets.
it.each([[0,'preflop'],[3,'flop'],[4,'turn']] as const)('keeps board street during live all-in reveal: %s', (cards,street)=>{
 expect(deriveLiveStreet(1,cards,true,true)).toBe(street);
});
it('allows showdown after the full board is available',()=>expect(deriveLiveStreet(1,5,true,true)).toBe('showdown'));
it('preserves completed revealed-hand presentation',()=>expect(deriveLiveStreet(1,3,true,false)).toBe('showdown'));
it('preserves unrevealed board street and missing-hand state',()=>{
 expect(deriveLiveStreet(1,3,false,true)).toBe('flop');expect(deriveLiveStreet(null,0,false,false)).toBeNull();
});
