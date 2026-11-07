import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function instrumentCheckoutTelegramForTest(source){
 if(source.includes('VINPOKER_CHECKOUT_HTTP_TEST_ADAPTER')||source.split('Deno.serve(async (req) => {').length!==2
  ||!source.includes('if (core.idempotent || recovered) return'))throw Error('Checkout test instrumentation preimage changed');
 // Endpoint routing only; production handler/helper/auth/DB code is retained.
 // Unknown tokens,credentials or request forms fail closed. Other requests use
 // the original fetch and remain subject to the existing outbound firewall.
 return `// VINPOKER_CHECKOUT_HTTP_TEST_ADAPTER: never deploy this temporary copy.
if(Deno.env.get('VINPOKER_ISOLATED_TELEGRAM')!=='cashier-current-only'||Deno.env.get('TELEGRAM_BOT_TOKEN')!=='LOCAL_TEST_ONLY_INVALID_TOKEN')throw Error('Isolated Telegram adapter scope denied');
const fixtureOriginalFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(url.origin!=='https://api.telegram.org')return fixtureOriginalFetch(input,init);
 if(typeof input!=='string'||url.href!=='https://api.telegram.org/botLOCAL_TEST_ONLY_INVALID_TOKEN/sendMessage'||init?.method!=='POST'||typeof init?.body!=='string')throw Error('Unexpected Telegram request denied');
 const headers=new Headers(init.headers);if(headers.has('Authorization')||headers.has('apikey'))throw Error('Credential forwarding denied');
 return fixtureOriginalFetch('http://telegram-test-sink:8788/sendMessage',init);
};
`+source;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==3)throw Error('Explicit temporary checkout index required');
 const file=process.argv[2];if(!/^\/tmp\/cashier-e2e-[A-Za-z0-9]+\/supabase\/functions\/checkout-dealer\/index\.ts$/.test(file))throw Error('Owned temporary fixture required');
 writeFileSync(file,instrumentCheckoutTelegramForTest(readFileSync(file,'utf8')));
}
