import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Worker} from 'node:worker_threads';
import {fixture} from './ai_fixture.mjs';
import '../data/ai-worker-client.js';
const componentFiles=[...fs.readFileSync('data/index.html','utf8').matchAll(/<script src="\.\/(components\/[^"]+)"/g)].map(match=>match[1]);
function workerFactory(){const thread=new Worker(new URL('./ai_worker_host.mjs',import.meta.url));const adapter={postMessage:m=>thread.postMessage(m),terminate:()=>thread.terminate()};thread.on('message',data=>adapter.onmessage?.({data}));thread.on('error',error=>adapter.onerror?.(error));return adapter;}
test('64 and 256 real Rapier worlds train one shared policy and release policy tensors',async()=>{
 const {nodes,task}=fixture();task.episodeSeconds=2;const client=GhostLearningWorker.create({workerFactory});
 try{
  await client.request('init',{nodes,task,componentFiles,backend:'cpu'});const initial=(await client.request('inspect')).tensors;await client.request('create',{seed:42});
  for(const environmentCount of [64,256]){
   let frame=null;const before=(await client.request('inspect')).policy.completedUpdates;
   const outcome=await client.request('train',{stageId:'nearby',updates:1,rolloutSteps:16,environmentCount,warm:true,progressive:false},(event,data)=>{if(event==='frame')frame=data;});
   assert.equal(outcome.steps,environmentCount*16);assert.equal(outcome.samplesPerUpdate,environmentCount*16);assert.equal(outcome.policy.completedUpdates,before+1);assert.equal(frame.replicas.length,environmentCount);
   const record=await client.request('save');assert.equal(record.training.lastCompletedUpdate.environmentCount,environmentCount);
  }
  await client.request('discard');assert.equal((await client.request('inspect')).tensors,initial);
 }finally{client.dispose();}
});
