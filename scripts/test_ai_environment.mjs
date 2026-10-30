import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './ai_fixture.mjs';

test('corrective aiming is rewarded above staying still and moving away',()=>{
  const args=fixture(),scores=[];
  for(const action of [0,1,2]){
    const env=GhostLearningEnvironment.create(args);
    try{env.reset(1,{initialAngles:[90,90],jitterDegrees:0});scores.push(env.step(action).reward);}finally{env.dispose();}
  }
  assert(scores[1]>0);assert(scores[1]>scores[0]);assert(scores[0]>scores[2]);
});

test('rotated shaft-fixed mounts report actuator angles and respond to bounded actions',()=>{
  const args=fixture(),env=globalThis.GhostLearningEnvironment.create(args);
  try{
    let result=env.reset(42,{initialAngles:[90,90],jitterDegrees:0});
    result.observation.jointAnglesDegrees.forEach(angle=>assert(Math.abs(angle-90)<1,'Mount rotation must not add an angle offset'));
    for(let i=0;i<10;i++)result=env.step(3);
    assert.equal(result.info.commands[1],70);assert(Math.abs(result.observation.jointAnglesDegrees[1]-70)<1);
    for(let i=0;i<10;i++)result=env.step(2);
    assert.equal(result.info.commands[0],110);assert(Math.abs(result.observation.jointAnglesDegrees[0]-110)<1);
  }finally{env.dispose();}
});
test('real Rapier resets and fixed actions are reproducible and isolated',()=>{
  const args=fixture(),before=JSON.stringify(args.nodes),env=globalThis.GhostLearningEnvironment.create(args);
  try {
    function run(seed){const initial=env.reset(seed);const frames=[initial];for(const action of [0,1,2,3,4,2,2,0])frames.push(env.step(action));return frames;}
    const first=run(42),base=env.snapshot().baseWorld;
    assert.equal(first[0].info.episodeJointTravelDegrees,0,'Reset settling is excluded');
    for(let i=1;i<first.length;i++){
      const endpointTravel=first[i].observation.jointAnglesDegrees.reduce((sum,angle,j)=>sum+Math.abs(angle-first[i-1].observation.jointAnglesDegrees[j]),0);
      assert(first[i].info.episodeJointTravelDegrees-first[i-1].info.episodeJointTravelDegrees>=endpointTravel-1e-9,'120 Hz travel includes motion between action samples');
    }
    assert.deepEqual(run(42),first);
    assert.notDeepEqual(run(43)[0].observation,first[0].observation);
    assert.equal(first.at(-1).info.physicsTicks,48);
    assert.equal(JSON.stringify(args.nodes),before);
    base.forEach((value,i)=>assert(Math.abs(value-args.nodes[args.task.rootIndex].position[i])<0.01));
    const saved=env.snapshot();assert.deepEqual(saved.targetWorld,args.task.targetWorld);
    assert(!('hit' in first[0].observation.sensor));
    assert.equal(first[0].observation.policyVector.length,29);
    assert(first.every(result=>result.observation.policyVector.every(Number.isFinite)));
    const snapshot=env.snapshot();snapshot.poses[0].body.origin[0]=99999;snapshot.nodes[0].position[0]=99999;
    assert.notEqual(env.snapshot().poses[0].body.origin[0],99999);
    assert.notEqual(env.snapshot().nodes[0].position[0],99999);
  } finally{env.dispose();env.dispose();}
  assert.throws(()=>env.step(0),/disposed/);
});
test('target hold terminates on simulated ticks; timeout truncates and requires reset',()=>{
  const args=fixture();const env=globalThis.GhostLearningEnvironment.create(args);
  try {
    env.reset(0,{initialAngles:args.task.solution.angles,jitterDegrees:0});
    let result;for(let i=0;i<200;i++){result=env.step(0);if(result.terminated||result.truncated)break;}
    assert.equal(result.info.reason,'success');assert.equal(result.info.physicsTicks,60);
    assert.equal(result.terminated,true);assert.equal(result.truncated,false);
    assert.throws(()=>env.step(0),/Reset/);
    assert.throws(()=>env.reset(0,{initialAngles:[999,90]}),/limits/);
  }finally{env.dispose();}
  const short=globalThis.GhostLearningEnvironment.create({...args,task:{...args.task,episodeSeconds:0.1,holdSeconds:0.5}});
  try{short.reset(0,{initialAngles:[90,90]});let result;for(let i=0;i<2;i++)result=short.step(0);assert.equal(result.truncated,true);assert.equal(result.info.physicsTicks,12);}finally{short.dispose();}
});

test('separate worlds do not share state, commands clamp at limits and dispose independently',()=>{
  const args=fixture(),a=globalThis.GhostLearningEnvironment.create(args),b=globalThis.GhostLearningEnvironment.create(args);
  try {
    const initial=b.reset(9,{initialAngles:[90,90]});a.reset(9,{initialAngles:[90,90]});
    for(let i=0;i<8;i++)a.step(2);
    assert.equal(b.snapshot().physicsTicks,0);assert.equal(b.reset(9,{initialAngles:[90,90]}).observation.sensor.valid,initial.observation.sensor.valid);
    assert(a.snapshot().nodes[args.task.joints[0].index].angle>90,'commands must reach the simulation motor target');
    a.reset(0,{initialAngles:[180,90]});const result=a.step(2);assert.equal(result.info.commands[0],180);
    assert.throws(()=>a.step(5),/Action/);assert.throws(()=>a.reset(NaN),/seed/);
    a.dispose();assert.doesNotThrow(()=>b.step(0));
  }finally{a.dispose();b.dispose();}
});

test('real physics acquisition outscores idle, oscillation and joint-limit pushing',()=>{
  const args=fixture(),env=globalThis.GhostLearningEnvironment.create(args);
  function run(initialAngles,actions){const initial=env.reset(0,{initialAngles,jitterDegrees:0});assert.equal(initial.reward,0);assert.equal(initial.info.episodeReward,0);let result;for(let i=0;i<200;i++){result=env.step(actions[i%actions.length]);assert(Number.isFinite(result.reward));if(result.terminated||result.truncated)break;}return result;}
  try{
    const success=run(args.task.solution.angles,[0]);
    const idle=run([90,90],[0]);
    const oscillation=run([90,90],[1,2,3,4]);
    const limits=run([180,90],[2]);
    let randomState=17;const randomActions=Array.from({length:200},()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return Math.floor(randomState/4294967296*5);});
    const random=run([90,90],randomActions);
    assert.equal(success.info.reason,'success');assert.equal(success.info.rewardTerms.success,10);
    assert.equal(success.info.episodeRewardTerms.detection,.25);
    for(const baseline of [idle,oscillation,limits,random])assert(success.info.episodeReward>baseline.info.episodeReward);
    assert(limits.info.episodeRewardTerms.limit<0);assert(oscillation.info.episodeRewardTerms.movement<idle.info.episodeRewardTerms.movement);
    assert.equal(success.observation.policyVector.length,29);assert(!('rewardTerms' in success.observation));
    console.log('Episode returns:',{acquired:success.info.episodeReward,idle:idle.info.episodeReward,oscillation:oscillation.info.episodeReward,limitPushing:limits.info.episodeReward,random:random.info.episodeReward});
  }finally{env.dispose();}
});
