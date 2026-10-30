import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './ai_fixture.mjs';
import '../data/ai-baseline.js';
import '../data/ai-curriculum.js';
import '../data/ai-evaluation.js';
const raster=globalThis.GhostRasterBaseline,curriculum=globalThis.GhostLearningCurriculum,evaluation=globalThis.GhostBaselineEvaluation;
const joints=[{min:0,max:4},{min:0,max:4}];
test('raster uses bounded actions, sweeps rows and never needs target metadata',()=>{
  const controller=raster.create({joints,holdSeconds:.5}),angles=[2,2],visited=[];
  for(let i=0;i<60;i++){
    const observation={jointAnglesDegrees:[...angles],sensor:{valid:false,distanceMm:null}};
    Object.defineProperty(observation,'targetWorld',{get(){throw new Error('Privileged input accessed');}});
    const action=controller.act(observation);assert(action>=0&&action<=4);
    if(action){const joint=action<=2?0:1;angles[joint]+=action%2===1?-2:2;}
    visited.push([...angles]);angles.forEach((angle,index)=>assert(angle>=joints[index].min&&angle<=joints[index].max));
    if(controller.status().exhausted)break;
  }
  for(const row of [0,2,4])for(const pan of [0,2,4])assert(visited.some(point=>point[0]===pan&&point[1]===row));
  assert.equal(controller.status().exhausted,true);
});
test('range-only return triggers a bounded hold attempt then resumes searching',()=>{
  const controller=raster.create({joints,holdSeconds:.1}),observation={jointAnglesDegrees:[2,2],sensor:{valid:true,distanceMm:120}};
  assert.equal(controller.act(observation),0);assert.equal(controller.status().event,'lock-start');
  let moved=false;for(let i=0;i<10;i++)if(controller.act(observation)!==0)moved=true;
  assert(moved);assert.equal(controller.status().lockAttempts,1);
});
test('curriculum seeds and generated targets are reproducible, split and visible',()=>{
  const args=fixture(),before=JSON.stringify(args.nodes);
  const options={nodes:args.nodes,task:args.task,registry:args.registry,worldPoint:args.worldPoint,split:'evaluation',index:0};
  const a=curriculum.makeCase({...options,stageId:'random-target'}),b=curriculum.makeCase({...options,stageId:'random-target'});
  assert.deepEqual(a,b);assert.equal(JSON.stringify(args.nodes),before);assert(a.task.targetWorld[1]>=5);
  assert.notDeepEqual(a.task.targetWorld,curriculum.makeCase({...options,stageId:'random-target',index:1}).task.targetWorld);
  assert(!curriculum.seeds.training.some(seed=>curriculum.seeds.evaluation.includes(seed)));
  const nodes=JSON.parse(JSON.stringify(args.nodes));nodes[args.task.targetIndex].parent=null;nodes[args.task.targetIndex].position=[...a.task.targetWorld];
  args.task.joints.forEach((joint,i)=>{nodes[joint.index].angle=a.task.solution.angles[i];});
  const sample=globalThis.GhostSensor.read({nodes,index:args.task.sensorIndex,worldPoint:args.worldPoint,registry:args.registry});
  assert.equal(sample.hit.index,args.task.targetIndex);assert(sample.distanceMm>40&&sample.distanceMm<500);
  const fixed=curriculum.makeCase({...options,stageId:'nearby'});assert.deepEqual(fixed.task.targetWorld,args.task.targetWorld);assert.equal(fixed.resetOptions.jitterDegrees,5);
});
test('real Rapier baseline can acquire a visible initial return without target coordinates',async()=>{
  const args=fixture();let frames=0;
  const result=await evaluation.run({count:1,yieldControl:async()=>{},
    makeCase:index=>({...curriculum.makeCase({...args,stageId:'nearby',split:'evaluation',index}),resetOptions:{initialAngles:args.task.solution.angles,jitterDegrees:0}}),
    createEnvironment:scenario=>globalThis.GhostLearningEnvironment.create({...args,task:scenario.task}),onFrame:()=>frames++});
  assert.equal(result.summary.successes,1);assert.equal(result.summary.medianAcquisitionSeconds,.5);assert.equal(result.summary.falseLockAttempts,0);assert(frames>1);
});
test('cancellation disposes the active world and excludes unfinished episodes',async()=>{
  let cancelled=false,disposed=0,stepCount=0;
  const scenario={id:'test',seed:1,task:{joints,holdSeconds:.5,episodeSeconds:10,targetIndex:7,targetWorld:[0,20,50]},resetOptions:{}};
  const frame={observation:{jointAnglesDegrees:[2,2],sensor:{valid:false}},info:{hit:null,physicsTicks:0,simulationSeconds:0}};
  const result=await evaluation.run({count:3,makeCase:()=>scenario,shouldStop:()=>cancelled,yieldControl:async()=>{if(stepCount)cancelled=true;},
    createEnvironment:()=>({reset:()=>frame,snapshot:()=>({}),step:()=>{stepCount++;return frame;},dispose(){disposed++;}})});
  assert.equal(result.cancelled,true);assert.equal(disposed,1);assert.equal(result.summary.episodes,0);assert.equal(result.summary.medianAcquisitionSeconds,null);
});

test('evaluation counts false locks and reports successful-only median with timeouts',async()=>{
  let disposed=0;
  const scenario={id:'mock',seed:10001,task:{joints,holdSeconds:.5,episodeSeconds:1,targetIndex:7,targetWorld:[0,20,50]},resetOptions:{}};
  const initial={observation:{jointAnglesDegrees:[2,2],sensor:{valid:true,distanceMm:120}},info:{hit:{kind:'floor'}}};
  const result=await evaluation.run({count:1,makeCase:()=>scenario,yieldControl:async()=>{},createEnvironment:()=>({reset:()=>initial,snapshot:()=>({}),
    step:()=>({...initial,truncated:true,info:{...initial.info,reason:'time-limit',simulationSeconds:1,episodeReward:-.5}}),dispose(){disposed++;}})});
  assert.equal(result.summary.successRate,0);assert.equal(result.summary.timeouts,1);assert.equal(result.summary.medianAcquisitionSeconds,null);assert.equal(result.summary.falseLockAttempts,1);assert.equal(disposed,1);
  assert.equal(evaluation.summarize([{reason:'success',seconds:1,reward:2,falseLockAttempts:0},{reason:'success',seconds:3,reward:4,falseLockAttempts:0},{reason:'time-limit',seconds:10,reward:-1,falseLockAttempts:2}]).medianAcquisitionSeconds,2);
});

// Regression: a 90-degree configured startup must not become raster homing on PPO reset.
test('PPO nearby evaluation publishes the configured startup before actions; raster homes afterward',async()=>{
  await import('../data/ai-training.js');
  const args=fixture();assert.equal(args.task.joints[0].startup,90);
  const scenario=curriculum.makeCase({...args,stageId:'nearby',split:'evaluation',index:0});
  const frames=[];let cancelled=false;
  await globalThis.GhostPPOTraining.evaluate({agent:{act:()=>({action:0})},count:1,makeCase:()=>scenario,
    createEnvironment:()=>globalThis.GhostLearningEnvironment.create(args),yieldControl:async()=>{},shouldStop:()=>cancelled,
    onFrame:frame=>{frames.push(frame);if(frame.phase==='first-action')cancelled=true;}});
  assert.equal(frames[0].phase,'reset');assert.equal(frames[0].action,null);assert.equal(frames[0].result.info.simulationSeconds,0);
  assert(frames[0].result.info.commands[0]>=85&&frames[0].result.info.commands[0]<=95);
  assert(Math.abs(frames[0].result.observation.jointAnglesDegrees[0]-frames[0].result.info.commands[0])<.5);
  assert.equal(frames[1].phase,'first-action');assert.equal(frames[1].action,0);
  assert.equal(frames[1].result.info.commands[0],frames[0].result.info.commands[0],'Hold does not home to zero');
  const controller=globalThis.GhostRasterBaseline.create({joints:args.task.joints,holdSeconds:args.task.holdSeconds});
  assert.equal(controller.status().phase,'pan-home');
});
