// Static inventory coherence/candidate regression, never runtime or permission proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
assert.ok(process.argv[2],'Pass a generated --dependencies JSON snapshot');
const graph=JSON.parse(readFileSync(process.argv[2],'utf8'));
const nodes=new Map(graph.nodes.map(n=>[n.source,n]));
const wanted={
 'src/lib/tournamentCreate.ts':['create_tournament_with_levels_v1','create_tournament_event_with_flights_v2','get_tournament_create_receipt_v1','get_tournament_event_create_receipt_v1'],
 'src/lib/tournamentEdit.ts':['get_tournament_edit_context_v1','edit_tournament_with_levels_v1','get_tournament_edit_receipt_v1'],
};
for(const [source,names] of Object.entries(wanted))for(const name of names)assert.ok(nodes.get(source)?.apiCandidates.some(c=>c.method==='rpc'&&c.target===name),'Missing callback/literal-branch RPC candidate '+source+' :: '+name);
let edges=0,assets=0;
for(const node of graph.nodes){
 assert.equal(createHash('sha256').update(readFileSync(node.source,'utf8')).digest('hex'),node.sha256,'Stale source '+node.source);
 assert.equal(node.coverage,'RUNTIME_UNVERIFIED');
 for(const edge of node.imports){assert.ok(nodes.has(edge.source),'Unresolved import '+node.source+' -> '+edge.source);edges++;}
 for(const asset of node.assets){assert.equal(createHash('sha256').update(readFileSync(asset.source)).digest('hex'),asset.sha256);assets++;}
}
for(const root of graph.roots){assert.equal(root.coverage,'RUNTIME_UNVERIFIED');for(const source of root.dependencySources)assert.ok(nodes.has(source));}
const ops=graph.roots.find(r=>r.source==='src/pages/ops/OpsTournaments.tsx');for(const source of ['src/ops/floor/useOpsTournamentCreate.ts','src/ops/floor/useOpsTournamentEdit.ts','src/lib/tournamentCreate.ts','src/lib/tournamentEdit.ts'])assert.ok(ops.dependencySources.includes(source));
assert.equal(graph.unresolved.length,0);assert.equal(graph.summary.sources,nodes.size);assert.equal(graph.summary.importEdges,edges);
const apiCandidates=graph.nodes.reduce((sum,n)=>sum+n.apiCandidates.length,0),candidatesWithoutLiteralTarget=graph.nodes.reduce((sum,n)=>sum+n.apiCandidates.filter(c=>c.target===null).length,0);assert.equal(graph.summary.apiCandidates,apiCandidates);assert.ok(nodes.get('src/ops/floor/useOpsTournamentCreate.ts').apiCandidates.some(c=>c.method==='rpc'&&c.target===null),'Computed RPC names must remain unresolved candidates');
console.log(JSON.stringify({kind:'STATIC_SOURCE_COHERENCE_ONLY_NOT_ROUTE_ACCEPTANCE',nodes:nodes.size,edges,assets,roots:graph.roots.length,canonicalCallbackTargetsVerified:7,apiCandidates,candidatesWithoutLiteralTarget,unresolvedRouteRoots:0}));
