import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react-swc';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const state=fileURLToPath(new URL('./http.preview-state.ts',import.meta.url));
export default defineConfig({root:fileURLToPath(new URL('../../',import.meta.url)),envDir:false,
  cacheDir:join(tmpdir(),'vinpoker-pt-read-release-http'),plugins:[react()],
  // Prebundle both actual test surfaces. Scanning every app/fixture HTML with
  // scoped Auth aliases imports unrelated AuthProviders and triggers reloads.
  optimizeDeps:{entries:['tests/financePayrollReadRelease/http.preview.html','tests/financePayrollReadRelease/http.employee.preview.html']},
  resolve:{alias:[
    {find:'@/lib/featureFlags',replacement:fileURLToPath(new URL('./http.feature-flags.ts',import.meta.url))},
    {find:'@/hooks/useAuth',replacement:state},
    {find:'@/hooks/dealer/useDealerLink',replacement:state},
    {find:'@/integrations/supabase/client',replacement:state},
    {find:'@',replacement:fileURLToPath(new URL('../../src',import.meta.url))},
  ]},server:{host:'127.0.0.1',port:23863,strictPort:true,proxy:{
    // Only read/status/nonpayment-proof RPCs. No cash/finalize REST route is proxied.
    '^/rest/v1/rpc/(get_pt_statement_installments_v1|get_part_time_payroll_statement_status_v1|get_my_pt_wage|get_my_dealer_payroll|list_my_pt_statements_v1)$':{
      target:'http://127.0.0.1:3012',rewrite:path=>path.replace('/rest/v1',''),
    },
  }}});
