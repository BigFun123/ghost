// Node adapter for exercising the actual classic browser worker in a separate thread.
import {parentPort} from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../data/',import.meta.url));
globalThis.self=globalThis;
globalThis.require=createRequire(import.meta.url);
globalThis.postMessage=data=>parentPort.postMessage(data);
globalThis.importScripts=(...urls)=>{
  for(const url of urls){
    const filename=url.startsWith('./vendor/')?fileURLToPath(new URL('../devserver/'+url.slice(2),import.meta.url)):path.resolve(root,url);
    vm.runInThisContext(fs.readFileSync(filename,'utf8'),{filename,importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});
  }
};
importScripts('./ai-worker.js');
parentPort.on('message',data=>globalThis.onmessage({data}));
