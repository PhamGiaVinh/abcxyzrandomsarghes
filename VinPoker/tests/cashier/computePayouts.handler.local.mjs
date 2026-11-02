import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as engine from '../../supabase/functions/_shared/payoutEngine.ts';

// Execute the actual Edge source/engine. Only Auth/Data-API transport is modeled.
export function createComputePayoutsLocalHandler({service, caller}) {
  let source=readFileSync('supabase/functions/compute-payouts/index.ts','utf8');
  const tree=ts.createSourceFile('handler.ts',source,ts.ScriptTarget.Latest,true);
  for(const statement of [...tree.statements].reverse())if(ts.isImportDeclaration(statement))source=source.slice(0,statement.pos)+source.slice(statement.end);
  const javascript=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  let handler;
  runInNewContext(javascript,{...engine,serve:callback=>{handler=callback;},
    createClient:(url,key)=>{
      assert.equal(url,'http://127.0.0.1:54329');
      assert.ok(['LOCAL_SERVICE_MODEL','LOCAL_CALLER_MODEL'].includes(key));
      return key==='LOCAL_SERVICE_MODEL'?service:caller;
    },
    Deno:{env:{get:key=>({SUPABASE_URL:'http://127.0.0.1:54329',SUPABASE_ANON_KEY:'LOCAL_CALLER_MODEL',SUPABASE_SERVICE_ROLE_KEY:'LOCAL_SERVICE_MODEL'})[key]}},
    Response,Request,console});
  assert.equal(typeof handler,'function');
  return handler;
}
