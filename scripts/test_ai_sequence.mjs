import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {Worker} from 'node:worker_threads';
import {fixture} from './ai_fixture.mjs';
import '../data/ai-rig.js';
import '../data/ai-ppo.js';
import '../data/ai-policy-file.js';
import '../data/ai-worker-client.js';
import tf from '../devserver/vendor/tensorflow-4.22.0/tf.min.js';
const source=fs.readFileSync('data/ai-sequence.js','utf8'),html=fs.readFileSync('data/index.html','utf8');
const componentFiles=[...html.matchAll(/<script src="\.\/(components\/[^"]+)"/g)].map(m=>m[1]);
function workerFactory(){const thread=new Worker(new URL('./ai_worker_host.mjs',import.meta.url));const worker={postMessage:data=>thread.postMessage(data),terminate:()=>thread.terminate()};thread.on('message',data=>worker.onmessage?.({data}));thread.on('error',error=>worker.onerror?.(error));return worker;}
async function setup({offline=true,stale=false,blocked=false}={}){
 const f=fixture();f.task.episodeSeconds=.25;f.task.holdSeconds=.1;
 await tf.setBackend('cpu');await tf.ready();const agent=GhostPPO.create({tf,seed:19}),record=GhostPolicyFile.save({agent,context:GhostPolicyFile.compatibility(f)});agent.dispose();
 const requests=[],commands=[],messages=[];let angles=f.task.joints.map(j=>j.startup),bound=false,release,entered;
 const enteredPromise=new Promise(resolve=>{entered=resolve;});
 const context={console,performance,setTimeout,clearTimeout,AbortController,AbortSignal,localConfigServer:true,GhostLearningTask,GhostRig,GhostLearningPolicy,GhostLearningEnvironment,GhostPhysics:{...GhostPhysics,load:async()=>f.RAPIER},GhostLearningWorker:{create:()=>GhostLearningWorker.create({workerFactory})},document:{querySelectorAll:()=>componentFiles.map(file=>({getAttribute:()=> './'+file}))},fetch:async url=>{requests.push(url);if(url.startsWith('/api/training/policy?'))return {ok:true,json:async()=>record};if(url==='/api/status')return {ok:true,json:async()=>({wifi:{connected:true},sensors:{vl53l0x:{ready:true,valid:false,distanceMm:null,sampleAgeMs:stale?999:0}},servos:f.task.joints.map((j,i)=>({name:j.name,ready:true,outputEnabled:true,angleDegrees:angles[i]}))})};throw new Error('Unexpected request '+url);}};
 vm.createContext(context);vm.runInContext(source,context);
 const adapter={nodes:f.nodes,configuration:JSON.parse(fs.readFileSync('data/robots/PanTilt/config.json','utf8')),registry:f.registry,worldPoint:f.worldPoint,offline,isCurrent:()=>true,canMove:()=>true,bindJoints:joints=>{assert.equal(joints.length,2);bound=true;},initialAngles:()=>angles,command:async next=>{assert(bound);commands.push([...next]);angles=[...next];if(blocked){entered();await new Promise(resolve=>{release=resolve;});}},snapshot:s=>assert(s.poses.length>0),status:text=>messages.push(text)};
 return {context,adapter,record,requests,commands,messages,enteredPromise,release:()=>release()};
}
test('AI sequence runs real frozen policy in isolated simulation from the current pose',async()=>{const f=await setup(),before=JSON.stringify(f.record);const outcome=await f.context.GhostSequenceAI.run('file:fixture.json',f.adapter);assert(['success','time-limit'].includes(outcome.reason));assert(f.commands.length>0);assert(f.requests.every(url=>url.startsWith('/api/training/')));assert.equal(JSON.stringify(f.record),before);assert.equal(f.context.GhostSequenceAI.running(),false);});
test('online AI uses physical status, remains bounded and makes no acquisition claim',async()=>{const f=await setup({offline:false});const result=await f.context.GhostSequenceAI.run('file:fixture.json',f.adapter);assert.match(result.reason,/physical-time-limit/);assert(f.requests.includes('/api/status'));assert(f.messages.some(text=>text.includes('target identity unverified')));for(const angles of f.commands)angles.forEach((angle,i)=>assert(angle>=f.record.compatibility.joints[i].min&&angle<=f.record.compatibility.joints[i].max));});
test('stale real sensor fails before issuing motion',async()=>{const f=await setup({offline:false,stale:true});await assert.rejects(f.context.GhostSequenceAI.run('file:fixture.json',f.adapter),/stale/);assert.equal(f.commands.length,0);assert.equal(f.context.GhostSequenceAI.running(),false);});
test('Stop cancels a policy during an in-flight command and prevents subsequent commands',async()=>{const f=await setup({blocked:true});const run=f.context.GhostSequenceAI.run('file:fixture.json',f.adapter);await f.enteredPromise;f.context.GhostSequenceAI.stop();f.release();await assert.rejects(run,/stopped/);assert.equal(f.commands.length,1);assert.equal(f.context.GhostSequenceAI.running(),false);});
