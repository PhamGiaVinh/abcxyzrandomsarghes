import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const inventory=JSON.parse(process.argv[2]?readFileSync(process.argv[2],'utf8'):execFileSync(process.execPath,['tests/localRouteInventory.mjs','--dependencies'],{encoding:'utf8',maxBuffer:4e6,env:{...process.env,NODE_OPTIONS:'--max-old-space-size=192 --max-semi-space-size=4'}}));
assert.equal(inventory.kind,'STATIC_ROUTE_IMPORT_REACHABILITY_NOT_CALL_GRAPH_OR_ACCEPTANCE');
assert.equal(inventory.unresolved.length,0);
assert.equal(new Set(inventory.nodes.map(n=>n.source)).size,inventory.nodes.length);
const declarations=new Set([
 ...inventory.routeDeclarationsDetail.map(r=>r.file+':'+r.line+':'+r.path),
 ...inventory.entryDispatches.map(r=>r.file+':'+r.line+':'+r.path+':pathname_dispatch'),
]);
for(const root of inventory.roots)for(const id of root.routeIds)assert.ok(declarations.has(id),'route source identity must be preserved');
assert.ok(inventory.roots.find(r=>r.source==='src/pages/NotFound.tsx').routeIds.every(id=>id.startsWith('src/App.tsx:')),'same wildcard path in Ops must not contaminate App route roots');
const nodes=new Map(inventory.nodes.map(n=>[n.source,n]));
for(const node of inventory.nodes){
 assert.ok(node.source.startsWith('src/')&&!node.source.includes('..'));
 assert.equal(node.coverage,'RUNTIME_UNVERIFIED');
 assert.equal(node.sha256,createHash('sha256').update(readFileSync(node.source)).digest('hex'),node.source);
 assert.ok(/\.tsx?$/.test(node.source),'binary imports must not be parsed as TypeScript');
 for(const asset of node.assets)assert.equal(asset.sha256,createHash('sha256').update(readFileSync(asset.source)).digest('hex'),asset.source);
 for(const edge of node.imports)assert.ok(nodes.has(edge.source),`${node.source} unresolved local import ${edge.source}`);
}
const inbox=inventory.roots.find(r=>r.source==='src/pages/Notifications.tsx');
assert.ok(inbox.routes.includes('/notifications'));
assert.ok(inbox.dependencySources.includes('src/hooks/useNotifications.tsx'),'child hook cannot disappear from route inventory');
assert.ok(nodes.get('src/hooks/useNotifications.tsx').apiCandidates.some(c=>c.method==='from'&&c.target==='notifications'));
const chip=inventory.roots.find(r=>r.source==='src/ops/chip-ops/OpsChipOpsWorkspace.tsx');
assert.ok(chip.routes.includes('/ops/chip-ops'));
assert.ok(chip.dependencySources.includes('src/ops/chip-ops/chipOpsReadAdapter.ts'));
assert.ok(nodes.get('src/ops/chip-ops/chipOpsReadAdapter.ts').apiCandidates.some(c=>c.method==='rpc'&&c.target==='get_issued_chip_inventory'));
const floor=inventory.roots.find(r=>r.source==='src/ops/floor/FloorTournamentWorkspace.tsx');
for(const section of ['tables','players','clock','payout','screens'])assert.ok(floor.routes.includes('/ops/floor/tournaments/:id/'+section));
assert.ok(floor.dependencySources.includes('src/components/floor/MultiDayInitialDrawPanel.tsx'));
assert.ok(nodes.get('src/components/floor/MultiDayInitialDrawPanel.tsx').apiCandidates.some(c=>c.method==='rpc'));
assert.ok(inventory.nodes.some(n=>n.imports.some(i=>i.kind==='dynamic')),'lazy dependency reachability must not be empty');
console.log('ROUTE900_IMPORT_REACHABILITY_HASH_AND_CRITICAL_CONSUMER_CHECKS_PASS',JSON.stringify(inventory.summary));
