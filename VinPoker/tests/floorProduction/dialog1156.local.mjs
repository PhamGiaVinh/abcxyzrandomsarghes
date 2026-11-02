// Browser control diagnostic only; no DB, credentials or product state.
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
assert.equal(process.env.VINPOKER_DIALOG1156_LOCAL,'1');
const server=createServer((req,res)=>{
 if(req.method!=='GET'||req.url!=='/'){res.writeHead(404);return res.end();}
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
 res.end('<!doctype html><html><head><title>Local native dialog diagnostic1156</title></head><body><h1>Local native dialog TEST</h1><p>No database or product writes.</p><button onclick="document.getElementById(\'result\').textContent=confirm(\'Confirm local UI diagnostic only?\')?\'Accepted\':\'Cancelled\'">Open TEST confirm</button><p id="result">Not started</p></body></html>');
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(5210,'127.0.0.1',resolve);});
console.log('DIALOG1156_NO_DB_DIAGNOSTIC_READY');
try{await new Promise(resolve=>process.stdin.on('data',chunk=>{assert.equal(String(chunk).trim(),'stop');process.stdin.pause();resolve();}));}
finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
