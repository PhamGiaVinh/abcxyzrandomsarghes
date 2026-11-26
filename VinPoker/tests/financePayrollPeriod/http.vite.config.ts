import {defineConfig} from 'vite';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import react from '@vitejs/plugin-react-swc';
export default defineConfig({root:resolve('.'),envDir:false,cacheDir:join(tmpdir(),'payroll-period-fixture'),plugins:[react()],
 optimizeDeps:{entries:['tests/financePayrollPeriod/http.preview.html']},
 resolve:{alias:[
  ...['@/hooks/useAuth','@/integrations/supabase/client'].map(find=>({find,replacement:resolve('tests/financePayrollPeriod/http.fixture.tsx')})),
  {find:'@',replacement:resolve('src')},
 ]},
 server:{host:'127.0.0.1',port:23867,strictPort:true,proxy:{'/rest/v1':{target:'http://127.0.0.1:3017',rewrite:path=>path.replace(/^\/rest\/v1/,'')}}},
});
