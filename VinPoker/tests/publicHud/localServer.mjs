// Read-only local browser UAT. No production deployment or service key.
// Run from VinPoker with existing VITE_SUPABASE_* publishable environment values.
import {createServer} from 'vite';
import {build} from 'esbuild';
import {createClient} from '@supabase/supabase-js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'vinpoker-hud-browser-'));
const file=path.join(directory,'handler.mjs');
await build({entryPoints:['supabase/functions/public-player-hud/handler.ts'],bundle:true,platform:'node',format:'esm',outfile:file,logLevel:'silent'});
const {readPublicPlayerHud,readPublicPlayerHudManifest}=await import(pathToFileURL(file));
const client=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const server=await createServer({server:{host:'127.0.0.1',port:5191,strictPort:true},plugins:[{
  name:'local-public-hud-transport',enforce:'pre',
  transform(code,id){
    if(!id.replaceAll('\\','/').endsWith('/src/lib/publicPlayerHud.ts'))return;
    return `async function localPublicHudInvoke(options){const response=await fetch('/__test/public-player-hud',{method:'POST',body:JSON.stringify(options.body),signal:options.signal});return {data:await response.json(),error:response.ok?null:new Error('local_public_hud_unavailable')};}\n`+code.replaceAll("supabase.functions.invoke('public-player-hud',",'localPublicHudInvoke(');
  },
  configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
    const url=new URL(req.url??'/','http://127.0.0.1:5191');
    if(url.pathname==='/__test/public-player-hud'){
      if(req.method!=='POST'){res.statusCode=405;res.end();return;}
      try{let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw Error('large');}const input=JSON.parse(body);
        const result=input.mode==='manifest'?await readPublicPlayerHudManifest(client,input.tournament_id,input.player_id,input.as_of):await readPublicPlayerHud(client,input.tournament_id,input.player_id,{mode:input.mode,after:input.after,asOf:input.as_of});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));}
      catch{res.statusCode=400;res.setHeader('Content-Type','application/json');res.end('{"error":"PUBLIC_HUD_UNAVAILABLE"}');}return;
    }
    if(url.pathname==='/__test/public-hud'){
      const html=await vite.transformIndexHtml(req.url,`<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/publicHud/Preview.tsx"></script></body></html>`);
      res.setHeader('Content-Type','text/html');res.end(html);return;
    }next();
  });},
}]});
await server.listen();console.log('Local read-only HUD UAT: http://127.0.0.1:5191/__test/public-hud');
