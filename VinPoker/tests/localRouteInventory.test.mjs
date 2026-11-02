import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const inventory=JSON.parse(execFileSync(process.execPath,['tests/localRouteInventory.mjs','--actions'],{encoding:'utf8',maxBuffer:4e6}));
const failures=[];const check=(value,message)=>{if(!value)failures.push(message);};
check(inventory.pages.some(p=>p.source==='src/pages/NotFound.tsx'),'explicit .tsx lazy import must resolve');
const floor=inventory.pages.find(p=>p.source==='src/ops/floor/FloorTournamentWorkspace.tsx');
check(floor,'inline FloorTournamentRoute must expose the actual workspace source');
for(const section of ['tables','players','clock','payout','screens'])check(floor?.routes.includes('/ops/floor/tournaments/:id/'+section),'missing inline workspace section '+section);
check(!inventory.unresolved.some(r=>r.component==='Navigate'),'framework redirects must be classified separately, not as missing source');
check(inventory.inlineRoutes?.some(r=>r.component==='TournamentRootRedirect'),'inline redirect evidence must remain visible');
check(inventory.pages.find(p=>p.source==='src/pages/SetupDavinci.tsx')?.directCalls.some(call=>call.method==='signUp'),'bootstrap auth account creation is a side-effect surface, not zero API calls');
check(inventory.entryDispatches?.some(r=>r.path==='/center-point-poker-masters'&&r.file==='src/main.tsx'&&r.source==='src/pages/CenterPointPokerMastersApp.tsx'),'main pathname dispatch must not disappear from route coverage');
check(inventory.pages.find(p=>p.source==='src/pages/CenterPointPokerMastersApp.tsx')?.routes.includes('/center-point-poker-masters'),'entry-dispatched page must participate in source/action inventory');
check(inventory.entryDispatches?.some(r=>r.path==='/__dev/payout-native'&&r.condition.includes('import.meta.env.DEV')&&r.source==='src/dev/PayoutNativePreview.tsx'),'DEV early-return path and gate must stay explicit');
check(inventory.entryDispatches?.some(r=>r.path==='/__dev/series-market'&&r.resolvedCondition.includes('import.meta.env.DEV')),'constant-derived pathname dispatch must retain its DEV condition');
assert.deepEqual(failures,[]);
console.log('LOCAL_ROUTE_INVENTORY_EXPLICIT_EXTENSION_INLINE_WORKSPACE_REDIRECT_CLASSIFICATION_PASS',JSON.stringify(inventory.summary));
