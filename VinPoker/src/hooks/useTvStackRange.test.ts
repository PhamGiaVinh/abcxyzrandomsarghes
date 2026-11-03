import { expect,it,vi } from 'vitest';
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
import { verifiedStackRange } from './useTvStackRange';
const snapshot:any={ok:true,access:'public',tournamentId:'t',sections:{ranking:{freshness:{state:'current'},items:[{chips:10000},{chips:30000}]}}};
it('requires a complete, current, conserved public stack projection',()=>{
  expect(verifiedStackRange(snapshot,'t',2,40000)).toEqual({largest:30000,smallest:10000});
  expect(verifiedStackRange(snapshot,'other',2,40000)).toBeNull();
  expect(verifiedStackRange(snapshot,'t',3,40000)).toBeNull();
  expect(verifiedStackRange(snapshot,'t',2,41000)).toBeNull();
  expect(verifiedStackRange({...snapshot,access:'revoked'},'t',2,40000)).toBeNull();
  expect(verifiedStackRange({...snapshot,sections:{ranking:{...snapshot.sections.ranking,freshness:{state:'stale'}}}},'t',2,40000)).toBeNull();
});
