import {defineConfig} from 'vite';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import react from '@vitejs/plugin-react-swc';
export default defineConfig({
 root:resolve('.'),envDir:false,cacheDir:join(tmpdir(),'vinpoker-bank-scope-fixture'),plugins:[react()],
 optimizeDeps:{entries:['tests/financeBankScope/http.preview.html']},
 resolve:{alias:[
  {find:'@/hooks/useAuth',replacement:resolve('tests/financeBankScope/http.fixture.tsx')},
  {find:'@/integrations/supabase/client',replacement:resolve('tests/financeBankScope/http.fixture.tsx')},
  {find:'@/lib/compressImage',replacement:resolve('tests/financeBankScope/http.fixture.tsx')},
  {find:'sonner',replacement:resolve('tests/financeBankScope/http.fixture.tsx')},
  {find:'@',replacement:resolve('src')},
 ]},
 server:{host:'127.0.0.1',port:23865,strictPort:true,proxy:{'/rest/v1/platform_bank_accounts':{target:'http://127.0.0.1:3014',rewrite:path=>path.replace(/^\/rest\/v1/,'')}}},
});
