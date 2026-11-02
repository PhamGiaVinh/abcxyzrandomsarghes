// Execute the actual create/read Edge source and shared validation/CORS/retry/log
// under Node. Only the unused poker-engine modules and Deno host are modeled.
// Callers supply either modeled SDK clients (unit) or the real SDK (native HTTP).
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {z} from 'zod';
const ts=createRequire(import.meta.url)('typescript');
export function loadCreateAction(createClient,logs=[],url='http://local.invalid'){
 const cache=new Map();let handler;
 const files={
  '../_shared/validate.ts':'supabase/functions/_shared/validate.ts',
  '../_shared/cors.ts':'supabase/functions/_shared/cors.ts',
  '../_shared/retry.ts':'supabase/functions/_shared/retry.ts',
  './log.ts':'supabase/functions/online-poker-action/log.ts',
  action:'supabase/functions/online-poker-action/index.ts',
 };
 const require=name=>{
  if(name==='npm:zod@3.25.76')return {z};
  if(name==='npm:@supabase/supabase-js@2.105.4')return {createClient};
  if(['../_shared/pokerEngine/index.ts','../_shared/pokerAdapter/index.ts'].includes(name))return {};
  if(cache.has(name))return cache.get(name);
  if(!(name in files))throw Error('unqualified handler dependency');
  const exports={};cache.set(name,exports);
  runInNewContext(ts.transpileModule(readFileSync(files[name],'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
   exports,require,Request,Response,fetch,crypto:webcrypto,performance,setTimeout,clearTimeout,
   Deno:{env:{get:key=>({SUPABASE_URL:url,SUPABASE_ANON_KEY:'ANON_TEST',SUPABASE_SERVICE_ROLE_KEY:'SERVICE_TEST'})[key]},serve:fn=>{handler=fn;}},
   console:{log:(...v)=>logs.push(v),error:(...v)=>logs.push(v)},
  });return exports;
 };
 require('action');if(typeof handler!=='function')throw Error('missing actual handler');
 return handler;
}
