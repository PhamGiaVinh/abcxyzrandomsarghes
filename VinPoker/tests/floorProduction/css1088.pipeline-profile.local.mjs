import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
assert.equal(process.env.VINPOKER_CSS1088_LOCAL,'1');assert.equal(process.cwd().replaceAll('\\','/'),'D:/wt/vinpoker-ops-local-integration/VinPoker');
const mode=process.argv[2];assert.ok(['baseline','tailwind','autoprefixer','source-only'].includes(mode));
const base='D:/Quy trình/output/reports/css1088-'+mode+'-local-20261027';assert.equal(existsSync(base+'.json'),false);
const start=performance.now(),cpu=process.cpuUsage();const req=createRequire(resolve('node_modules_complete_942/package.json'));
const postcss=req('postcss'),tailwind=req('tailwindcss'),autoprefixer=req('autoprefixer');
const modulesMs=performance.now()-start;
const inputPath=mode==='autoprefixer'?'D:/Quy trình/output/reports/css1088-tailwind-local-20261027.css':'src/index.css';
const input=readFileSync(inputPath,'utf8');
let sourceConfig;if(mode==='source-only'){const load=req('tailwindcss/loadConfig');sourceConfig=load(resolve('tailwind.config.ts'));sourceConfig={...sourceConfig,content:[...sourceConfig.content,'!./src/**/*.test.{ts,tsx}','!./src/**/*.spec.{ts,tsx}']};}
const plugins=mode==='source-only'?[tailwind(sourceConfig),autoprefixer()]:mode==='baseline'?[tailwind(resolve('tailwind.config.ts')),autoprefixer()]:mode==='tailwind'?[tailwind(resolve('tailwind.config.ts'))]:[autoprefixer()];
const at=performance.now();const result=await postcss(plugins).process(input,{from:resolve('src/index.css'),map:false});
const processMs=performance.now()-at;writeFileSync(base+'.css',result.css);const state={kind:'ISOLATED_SINGLE_CSS_PIPELINE_NOT_VITE_NAVIGATION_OR_FULL_BUILD',mode,modulesMs,processMs,totalMs:performance.now()-start,cpu:process.cpuUsage(cpu),rss:process.memoryUsage().rss,inputBytes:Buffer.byteLength(input),outputBytes:Buffer.byteLength(result.css),sha256:createHash('sha256').update(result.css).digest('hex'),warnings:result.warnings().map(w=>w.text),versions:{postcss:req('postcss/package.json').version,tailwind:req('tailwindcss/package.json').version,autoprefixer:req('autoprefixer/package.json').version}};writeFileSync(base+'.json',JSON.stringify(state,null,2)+'\n');console.log(JSON.stringify(state));
