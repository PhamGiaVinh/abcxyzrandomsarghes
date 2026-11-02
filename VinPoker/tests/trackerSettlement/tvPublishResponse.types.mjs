// Small real TypeScript probe for the actual TV RPC/observer call, not a full
// component/project typecheck. No emit, installs, cache or source writes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import ts from 'typescript';
const path=resolve('src/components/cashier/tournament-live/TvBrandingEditor.tsx');
const file=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let rpcType;const calls=[];
function visit(node){
 if(ts.isTypeAliasDeclaration(node)&&node.name.text==='UntypedRpc')rpcType=node.getText(file);
 if(ts.isCallExpression(node)&&node.expression.getText(file)==='waitForManualPlayerResponse')calls.push(node.getText(file));
 ts.forEachChild(node,visit);
}
visit(file);assert.ok(rpcType);assert.equal(calls.length,1,'review probe if TV has more observer calls');
const virtual=resolve('.tv-publish-response.virtual.ts');
const source=`import {waitForManualPlayerResponse} from './src/lib/floorManualPlayerIntent';
${rpcType}
declare const rpc:UntypedRpc;
const tournamentId='test',revision=7,submitted={brandName:'TEST',logoUrl:null as string|null,backgroundUrl:null as string|null,layout:{} as unknown};
async function probe(){const {data,error}=await ${calls[0]};return {data,error};}`;
const options={noEmit:true,skipLibCheck:true,strict:false,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,
 moduleResolution:ts.ModuleResolutionKind.Bundler,types:[],lib:['lib.es2022.d.ts','lib.dom.d.ts']};
const host=ts.createCompilerHost(options),original=host.getSourceFile.bind(host);
host.getSourceFile=(name,version,...rest)=>resolve(name)===virtual?ts.createSourceFile(virtual,source,version,true):original(name,version,...rest);
const program=ts.createProgram([virtual],options,host);
const errors=ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error);
for(const diagnostic of errors)console.error(`TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText,' ')}`);
assert.equal(errors.length,0,'actual TV RPC/response observer type contract failed');
console.log('TV_PUBLISH_RESPONSE_FOCUSED_TYPE_CONTRACT_PASS');
