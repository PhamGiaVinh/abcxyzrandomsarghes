import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createClient} from '@supabase/supabase-js';
import {expect,it,vi} from 'vitest';

const cases=[
 ['src/components/fnb/admin/MenuManager.tsx','callRpc'],
 ['src/pages/ops/OpsTournamentCockpit.tsx','call'],
 ['src/components/cashier/SatelliteTicketRedeemPanel.tsx','rpc'],
 ['src/components/cashier/tournament-live/SatelliteAwardPlanPanel.tsx','planRpc'],
] as const;
for(const [file,name] of cases)it(`retains SDK receiver in actual source initializer ${file}`,()=>{
 const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const initializers:ts.Expression[]=[];
 function visit(node:ts.Node){
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text===name&&node.initializer)initializers.push(node.initializer);
  ts.forEachChild(node,visit);
 }
 visit(source);expect(initializers).toHaveLength(1);
 const noNetwork=vi.fn(()=>{throw Error('RPC_RECEIVER_TEST_MUST_NOT_SEND_HTTP');});
 const client=createClient('http://127.0.0.1:54329','LOCAL_PUBLIC_TEST_NOT_SECRET',{
  auth:{storageKey:`rpc-receiver304-${name}`,autoRefreshToken:false,persistSession:false,detectSessionInUrl:false},global:{fetch:noNetwork},
 });
 const code=ts.transpileModule(`const actual = ${initializers[0].getText(source)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 // Execute just the initializer, not React, effects, credentials or a mutation.
 const actual=Function('supabase',`${code}\nreturn actual;`)(client) as (name:string,args:Record<string,unknown>)=>unknown;
 expect(()=>actual('local_receiver_probe',{})).not.toThrow();
 expect(noNetwork).not.toHaveBeenCalled();
});
