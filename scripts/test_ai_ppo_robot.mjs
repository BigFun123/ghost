import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './ai_fixture.mjs';
import '../data/ai-evaluation.js';
import tf from '../devserver/vendor/tensorflow-4.22.0/tf.min.js';
import '../data/ai-ppo.js';import '../data/ai-training.js';
test('PPO learns holding on a simplified real-Rapier fixed-target task',async()=>{
  await tf.setBackend('cpu');await tf.ready();const tensorsBefore=tf.memory().numTensors,args=fixture();
  const pose=args.task.solution.angles;args.task.joints.forEach((joint,i)=>{args.nodes[joint.index].angle=pose[i];});
  const ray=globalThis.GhostSensor.sensorRay(args.nodes,args.task.sensorIndex,args.worldPoint);
  // Deliberately close, easy holding benchmark; this does not qualify ordinary-start search.
  const task={...args.task,episodeSeconds:2,targetWorld:ray.origin.map((value,i)=>value+ray.direction[i]*30)};
  const makeCase=index=>({seed:index+1,task,resetOptions:{initialAngles:pose,jitterDegrees:0}});
  const createEnvironment=scenario=>globalThis.GhostLearningEnvironment.create({...args,task:scenario.task});
  const agent=globalThis.GhostPPO.create({tf,seed:7,settings:{learningRate:.001,epochs:4,batchSize:32}});
  try{
    const initialWorld=createEnvironment({task});let initial;
    try{initial=initialWorld.reset(1,{initialAngles:pose,jitterDegrees:0});}finally{initialWorld.dispose();}
    const beforeProbability=agent.predict(initial.observation.policyVector).probabilities[0];
    const before=await globalThis.GhostPPOTraining.evaluate({agent,count:1,makeCase,createEnvironment,yieldControl:async()=>{}});
    assert.equal(before.episodes[0].reason,'time-limit');
    const trained=await globalThis.GhostPPOTraining.train({agent,updates:16,rolloutSteps:64,makeCase,createEnvironment,yieldControl:async()=>{}});
    assert.equal(trained.updates,16);assert.equal(trained.steps,1024);
    const afterProbability=agent.predict(initial.observation.policyVector).probabilities[0];
    const optimizerSteps=agent.inspect().optimizerSteps;
    const after=await globalThis.GhostPPOTraining.evaluate({agent,count:1,makeCase,createEnvironment,yieldControl:async()=>{}});
    assert.equal(agent.inspect().optimizerSteps,optimizerSteps,'Evaluation must not update weights');
    console.log('Warm fixed-target hold:',{before:before.episodes[0].reward,after:after.episodes[0].reward,beforeProbability,afterProbability,trainingSuccesses:trained.successes});
    assert(afterProbability>beforeProbability+.2);
    assert.equal(after.episodes[0].reason,'success');assert.equal(after.episodes[0].seconds,.5);

  }finally{agent.dispose();}
  assert.equal(tf.memory().numTensors,tensorsBefore);
});
