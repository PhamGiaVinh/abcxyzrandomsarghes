import {defineConfig} from 'vite';import {resolve,join} from 'node:path';import {tmpdir} from 'node:os';import react from '@vitejs/plugin-react-swc';
export default defineConfig({root:resolve('.'),envDir:false,cacheDir:join(tmpdir(),'pt-cash-drawer-fixture'),plugins:[react()],
 optimizeDeps:{entries:['tests/financePtCashDrawer/http.preview.html']},resolve:{alias:{'@':resolve('src')}},
 server:{host:'127.0.0.1',port:23868,strictPort:true,proxy:{'/rest/v1':{target:'http://127.0.0.1:3018',rewrite:path=>path.replace(/^\/rest\/v1/,'')}}}});
