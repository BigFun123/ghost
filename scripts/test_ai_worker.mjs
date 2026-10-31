import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Worker} from 'node:worker_threads';
import {fixture} from './ai_fixture.mjs';
import '../data/ai-worker-client.js';
const componentFiles=[...fs.readFileSync('data/index.html','utf8').matchAll(/<script src="\.\/(components\/[^"]+)"/g)].map(match=>match[1]);
function workerFactory(){
  const thread=new Worker(new URL('./ai_worker_host.mjs',import.meta.url));
  const adapter={postMessage:message=>thread.postMessage(message),terminate:()=>thread.terminate()};
  thread.on('message',data=>adapter.onmessage?.({data}));thread.on('error',error=>adapter.onerror?.(error));return adapter;
}
test('real worker trains, pauses, stops, round-trips policies and rejects incompatible data without losing weights',async()=>{
  const {nodes,task}=fixture();task.episodeSeconds=1;
  const surfaces=[];
  const client=GhostLearningWorker.create({workerFactory,onWeights:data=>surfaces.push(data)});
  try{
    const runtimeLogs=[];
    const runtime=await client.request('init',{nodes,task,componentFiles,backend:'auto'},(event,data)=>{if(event==='log')runtimeLogs.push(data);});
    assert.equal(runtime.execution,'Web Worker');assert.equal(runtime.backend,'cpu');assert(runtimeLogs.some(message=>message.includes('webgl unavailable')));
    const initialTensors=(await client.request('inspect')).tensors;
    await client.request('create',{seed:17});const vector=Array(29).fill(.1);
    const initialSurface=surfaces.at(-1);assert.deepEqual(initialSurface.matrices.map(m=>m.shape),[[29,64],[64,64],[64,5],[64,1]]);
    const before=await client.request('predict',{vector});
    let frames=0,parallelFrame=null;
    await client.request('train',{stageId:'nearby',updates:1,rolloutSteps:16,environmentCount:16,warm:true,progressive:true},(event,data)=>{if(event==='frame'){frames++;parallelFrame=data;}});assert(frames>0);assert.equal(parallelFrame.replicas.length,16);assert.equal(parallelFrame.environmentCount,16);
    const trainedSurface=surfaces.at(-1);assert.equal(trainedSurface.updates,1);assert.notDeepEqual(trainedSurface.matrices[0].values,initialSurface.matrices[0].values);
    const surfaceCount=surfaces.length;
    const after=await client.request('predict',{vector});assert.notDeepEqual(after,before);
    const optimizerSteps=(await client.request('inspect')).policy.optimizerSteps;
    let testFrames=0;
    const tested=await client.request('test',{seed:42,angles:task.joints.map(joint=>joint.startup)},(event,frame)=>{if(event==='frame'){testFrames++;assert(frame.phase==='reset'?frame.action===null:Number.isInteger(frame.action));}});
    assert.equal(surfaces.length,surfaceCount,'Frozen tests do not emit changing weights');
    assert.equal(tested.episodes.length,1);assert(testFrames>0);assert.deepEqual(await client.request('predict',{vector}),after);
    assert.equal((await client.request('inspect')).policy.optimizerSteps,optimizerSteps);
    await assert.rejects(client.request('test',{seed:42,angles:[-999,90]}),/joint limits/);
    let stopTest;
    const stoppedTest=await client.request('test',{seed:43,angles:task.joints.map(joint=>joint.startup)},event=>{if(event==='frame'&&!stopTest)stopTest=client.request('stop');});
    await stopTest;assert(stoppedTest.cancelled);assert.equal(stoppedTest.episodes.length,0);
    assert.deepEqual(await client.request('predict',{vector}),after);
    const record=JSON.parse(JSON.stringify(await client.request('save')));
    assert.deepEqual(trainedSurface.matrices.map(({shape,values})=>({shape,values})),record.network.weights.filter(w=>w.shape.length===2),'Surface contains the actual saved policy kernels');assert.equal(record.training.lastCompletedUpdate.progressive,true);assert.equal(record.training.lastCompletedUpdate.curriculum.level,0);
    const evaluation=await client.request('evaluate',{stageId:'nearby',count:1});
    const withEvaluation=await client.request('save');assert.equal(withEvaluation.evaluation.episodes.length,1);assert(Number.isFinite(withEvaluation.evaluation.summary.falseHoldAttempts));assert(withEvaluation.evaluation.comparisonComplete);assert.deepEqual(withEvaluation.evaluation.baseline.episodes.map(episode=>episode.seed),evaluation.episodes.map(episode=>episode.seed));
    const monitorEvents=[];
    const monitored=await client.request('monitor',{stageId:'nearby'},(event,data)=>{if(event==='convergence')monitorEvents.push(data);});
    assert.equal(monitored.episodes.length,50);assert.equal(new Set(monitored.episodes.map(e=>e.seed)).size,50);
    assert(monitored.episodes.every(e=>e.seed>=200003));assert.equal(monitored.convergence.windows,1);
    assert.deepEqual(await client.request('predict',{vector}),after,'Monitoring leaves weights unchanged');
    assert.equal((await client.request('inspect')).policy.optimizerSteps,optimizerSteps);
    const repeated=await client.request('monitor',{stageId:'nearby'});assert.equal(repeated.convergence.windows,1,'same checkpoint cannot inflate stability evidence');
    const monitoredRecord=await client.request('save');assert.equal(monitoredRecord.training.monitoring.rows.length,1);
    await assert.rejects(client.request('qualify',{stageId:'nearby'}),/Pass monitoring/);
    await client.request('restore-best');assert.deepEqual(await client.request('predict',{vector}),after);
    const restoredBest=await client.request('save');assert.equal(restoredBest.training.monitoring.rows[0].complete,false,'restored history is archival');
    let progressEvents=0;
    const run=client.request('train',{stageId:'nearby',updates:100,rolloutSteps:64,warm:true},()=>progressEvents++);
    assert.equal((await client.request('pause')).paused,true);
    const pausedEvents=progressEvents;await new Promise(resolve=>setTimeout(resolve,80));assert.equal(progressEvents,pausedEvents);
    await assert.rejects(client.request('load',{record}),/Stop training/);
    await client.request('resume');await client.request('stop');assert.equal((await run).cancelled,true);
    assert.equal((await client.request('save')).evaluation,null);
    await client.request('discard');assert.equal(surfaces.at(-1),null);assert.equal((await client.request('inspect')).tensors,initialTensors);
    await client.request('load',{record});assert.deepEqual(await client.request('predict',{vector}),after);
    assert.deepEqual(withEvaluation.evaluation.baseline.episodes[0].targetWorld,evaluation.episodes[0].targetWorld);assert.deepEqual(withEvaluation.evaluation.baseline.episodes[0].initialJointAnglesDegrees,evaluation.episodes[0].initialJointAnglesDegrees);
    const reloadedEvaluation=await client.request('evaluate',{stageId:'nearby',count:1});assert.deepEqual(reloadedEvaluation.episodes,evaluation.episodes);
    assert.equal((await client.request('inspect')).policy.optimizerSteps,0);
    await client.request('load',{record:withEvaluation});assert.deepEqual((await client.request('save')).evaluation.episodes,evaluation.episodes);
    let stopRequest;
    const partial=await client.request('evaluate',{stageId:'nearby',count:1},event=>{if(event==='phase')stopRequest=client.request('stop');});
    await stopRequest;assert(partial.cancelled);assert.equal(partial.comparisonComplete,false);assert.equal(partial.episodes.length,1);assert.equal(partial.baseline.episodes.length,0);
    assert.deepEqual(await client.request('predict',{vector}),after,'Paired evaluation never changes weights');
    for(const mutate of [r=>r.version++,r=>r.compatibility.observation.version=1,r=>r.compatibility.rewardVersion=1,r=>r.compatibility.observation.size++,r=>r.compatibility.joints[0].max--,r=>r.network.weights[0].values[0]=1e100,r=>r.network.weights[0].shape[0]++]){
      const invalid=structuredClone(record);mutate(invalid);const tensors=(await client.request('inspect')).tensors;
      await assert.rejects(client.request('load',{record:invalid}));assert.deepEqual(await client.request('predict',{vector}),after);
      assert.equal((await client.request('inspect')).tensors,tensors);
    }
    await client.request('discard');assert.equal((await client.request('inspect')).tensors,initialTensors);
  }finally{client.dispose();}
});
test('terminating a worker rejects pending runs and ignores late messages',async()=>{
  let transport,events=0,terminated=0;
  const client=GhostLearningWorker.create({workerFactory:()=>transport={postMessage(){},terminate(){terminated++;}}});
  const pending=client.request('train',{},()=>events++),rejection=assert.rejects(pending,/stopped/);
  client.dispose();client.dispose();transport.onmessage({data:{id:1,event:'frame',data:{}}});await rejection;
  assert.equal(events,0);assert.equal(terminated,1);await assert.rejects(client.request('init'),/stopped/);
});

test('target-only changes retain predictions and optimizer, permit tests, and invalidate old evidence',async()=>{
 const {nodes,task}=fixture();task.episodeSeconds=1;const client=GhostLearningWorker.create({workerFactory});
 try{
  await client.request('init',{nodes,task,componentFiles,backend:'cpu'});await client.request('create',{seed:42});await client.request('train',{stageId:'nearby',updates:1,rolloutSteps:16,warm:true});
  const vector=Array(29).fill(.1),before=await client.request('predict',{vector}),original=await client.request('save'),optimizer=(await client.request('inspect')).policy.optimizerSteps;
  const nextNodes=structuredClone(nodes),targetIndex=nodes.findIndex((node,index)=>node.objectType==='Target'&&index!==task.targetIndex);assert(targetIndex>=0);nextNodes[task.targetIndex].position=[500,100,500];nextNodes[targetIndex].position=[...task.targetWorld];const nextTask={...task,targetIndex};
  const changed=await client.request('retarget',{nodes:nextNodes,task:nextTask});assert(changed.targetChanged);assert.equal(changed.optimizerSteps,optimizer);assert.deepEqual(await client.request('predict',{vector}),before);assert.equal((await client.request('save')).evaluation,null);assert.match(changed.convergence.status,/Stale/);
  const tested=await client.request('test',{seed:42,angles:task.joints.map(j=>j.startup)});assert.equal(tested.episodes.length,1);assert.equal(tested.policy.completedUpdates,original.training.completedUpdates);
  const wrong=structuredClone(nextTask);wrong.joints[0].max--;await assert.rejects(client.request('retarget',{nodes:nextNodes,task:wrong}),/rig or policy format changed/);assert.deepEqual(await client.request('predict',{vector}),before);
  const loaded=await client.request('load',{record:original});assert(loaded.targetChanged);assert.equal(loaded.optimizerSteps,0);assert.deepEqual(await client.request('predict',{vector}),before);assert.equal((await client.request('save')).evaluation,null);
 }finally{client.dispose();}
});
