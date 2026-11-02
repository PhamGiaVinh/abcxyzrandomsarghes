// Local browser-only SDK resolution. Product config and server engine boundaries remain intact.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {defineConfig,mergeConfig} from 'vite';
import base from '../../vite.config';
const sdk=process.env.VINPOKER_EXISTING_GENAI;
if(!sdk)throw new Error('VINPOKER_EXISTING_GENAI must name the existing SDK');
const metadata=JSON.parse(readFileSync(path.join(sdk,'package.json'),'utf8'));
if(metadata.name!=='@google/genai'||metadata.version!=='2.19.0')throw new Error('Existing SDK version differs');
export default defineConfig(env=>mergeConfig(typeof base==='function'?base(env):base,{
 resolve:{alias:{'@google/genai':path.join(sdk,'dist/web/index.mjs')}},
}));
