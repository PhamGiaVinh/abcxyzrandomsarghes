import { expect,it,vi } from 'vitest';
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
import { verifiedStackRange, loadTvStackRange } from './useTvStackRange';
const snapshot:any={ok:true,access:'public',tournamentId:'t',sections:{ranking:{freshness:{state:'current'},items:[{chips:10000},{chips:30000}]}}};
it('requires a complete, current, conserved public stack projection',()=>{
  expect(verifiedStackRange(snapshot,'t',2,40000)).toEqual({largest:30000,smallest:10000});
  expect(verifiedStackRange(snapshot,'other',2,40000)).toBeNull();
  expect(verifiedStackRange(snapshot,'t',3,40000)).toBeNull();
  expect(verifiedStackRange(snapshot,'t',2,41000)).toBeNull();
  expect(verifiedStackRange({...snapshot,access:'revoked'},'t',2,40000)).toBeNull();
  expect(verifiedStackRange({...snapshot,sections:{ranking:{...snapshot.sections.ranking,freshness:{state:'stale'}}}},'t',2,40000)).toBeNull();
});

const withTables = { ...snapshot, sections: { ...snapshot.sections,
  tables: { freshness: { state: 'current' }, catalog: [{ tableId: 'a' }, { tableId: 'b' }] } } };

it.each(['waiting', 'inactive', 'closed'])('hides ranking before a real hand (%s)', async (state) => {
  const rpc = vi.fn(async (name, args) => ({ error: null, data: name.includes('snapshot') ? withTables
    : { access: 'public', tableId: args.p_tournament_table_id, state, hand: null } }));
  expect(await loadTvStackRange(rpc, 't', 2, 40000)).toBeNull();
});

it.each(['live', 'last_completed'])('uses tournament ranking when the second table has a %s hand', async (state) => {
  const rpc = vi.fn(async (name, args) => ({ error: null, data: name.includes('snapshot') ? withTables
    : { access: 'public', tableId: args.p_tournament_table_id,
      state: args.p_tournament_table_id === 'b' ? state : 'waiting',
      hand: args.p_tournament_table_id === 'b' ? { id: 'hand' } : null } }));
  expect(await loadTvStackRange(rpc, 't', 2, 40000)).toEqual({ largest: 30000, smallest: 10000 });
});

it('rejects a ranking invalidated during the hand read', async () => {
  const rpc = vi.fn().mockResolvedValueOnce({ data: withTables, error: null })
    .mockResolvedValueOnce({ data: { access: 'public', tableId: 'a', state: 'live', hand: { id: 'h' } }, error: null })
    .mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
  expect(await loadTvStackRange(rpc, 't', 2, 40000)).toBeNull();
});
