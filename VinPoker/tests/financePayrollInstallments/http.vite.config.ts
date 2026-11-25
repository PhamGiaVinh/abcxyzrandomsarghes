import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react-swc';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const state=fileURLToPath(new URL('./http.preview-state.ts',import.meta.url));
export default defineConfig({root:fileURLToPath(new URL('../../',import.meta.url)),envDir:false,
  cacheDir:join(tmpdir(),'vinpoker-pt-http-browser'),plugins:[react()],resolve:{alias:[
    {find:'@/hooks/useAuth',replacement:state},
    {find:'@/integrations/supabase/client',replacement:state},
    {find:'@',replacement:fileURLToPath(new URL('../../src',import.meta.url))},
  ]},server:{host:'127.0.0.1',port:23862,strictPort:true,proxy:{
    // The browser can only read this one RPC. No mutation/other REST route is proxied.
    '^/rest/v1/rpc/get_pt_statement_installments_v1$':{
      target:'http://127.0.0.1:3010',rewrite:path=>path.replace('/rest/v1',''),
    },
  }}});
