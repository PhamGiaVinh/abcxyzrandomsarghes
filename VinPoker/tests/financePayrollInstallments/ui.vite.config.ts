import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react-swc';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const state=fileURLToPath(new URL('./ui.fixture-state.ts',import.meta.url));
export default defineConfig({root,envDir:false,cacheDir:join(tmpdir(),'vinpoker-finance-pt-details-vite'),plugins:[react()],resolve:{alias:[
  {find:'@/hooks/useAuth',replacement:state},
  {find:'@/integrations/supabase/client',replacement:state},
  {find:'@',replacement:fileURLToPath(new URL('../../src',import.meta.url))},
]},server:{host:'127.0.0.1',port:23861,strictPort:true}});
