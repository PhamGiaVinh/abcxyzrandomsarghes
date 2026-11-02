// Opt-in local test runtime only. Never changes product resolution or installs
// into the shared node_modules junction. Requires the exact existing SDK version.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {mergeConfig} from 'vitest/config';
import base from '../../vitest.config';

const sdk=process.env.VINPOKER_EXISTING_GENAI;
if(!sdk)throw new Error('VINPOKER_EXISTING_GENAI must name an already-installed SDK directory');
const metadata=JSON.parse(readFileSync(path.join(sdk,'package.json'),'utf8'));
if(metadata.name!=='@google/genai'||metadata.version!=='2.19.0')throw new Error('Existing SDK differs from reviewed package.json version');
export default mergeConfig(base,{resolve:{alias:{'@google/genai':path.join(sdk,'dist/web/index.mjs')}}});
