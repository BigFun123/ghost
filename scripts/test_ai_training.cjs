const {test}=require('node:test'),assert=require('node:assert/strict');
const runner=require('../data/ai-training');
const evaluation=require('../data/ai-evaluation');
function mocks(){
  let disposed=0,step=0,updates=0;
  const frame=()=>({observation:{policyVector:[step]},reward:1,terminated:step%3===0&&step>0,truncated:false,info:{reason:'success',episodeReward:3}});
  const agent={act:()=>({action:0,value:2,logProbability:-1}),value:()=>4,async update(rows){assert(rows.some(row=>row.terminated&&row.nextValue===0));updates++;return {cancelled:false,loss:1};}};
  const createEnvironment=()=>({reset:()=>{step=0;return frame();},step:()=>{step++;return frame();},snapshot:()=>({}),dispose(){disposed++;}});
  const makeCase=index=>({seed:index,task:{episodeSeconds:1},resetOptions:{}});
  return {agent,createEnvironment,makeCase,stats:()=>({disposed,updates})};
}
test('training collects normalized vectors and disposes completed/unfinished worlds',async()=>{
  const fixture=mocks();const result=await runner.train({...fixture,updates:2,rolloutSteps:16,yieldControl:async()=>{}});
  assert.equal(result.steps,32);assert.equal(result.updates,2);assert.equal(fixture.stats().updates,2);assert(fixture.stats().disposed>=10);
});
test('cancellation discards incomplete rollouts and releases world state',async()=>{
  const fixture=mocks();let cancelled=false;
  const result=await runner.train({...fixture,updates:3,rolloutSteps:16,shouldStop:()=>cancelled,yieldControl:async()=>{cancelled=fixture.stats().disposed>0;}});
  assert.equal(result.cancelled,true);assert.equal(fixture.stats().updates,0);assert(fixture.stats().disposed>0);
});
test('warm-start aid changes reset poses only, and ordinary evaluation cases stay unchanged',()=>{
  const scenario={seed:11,task:{joints:[{min:0,max:180},{min:0,max:180}],solution:{angles:[30,90]}},resetOptions:{jitterDegrees:5}};
  const before=JSON.stringify(scenario),warm=runner.prepareCase(scenario,true);
  assert.equal(JSON.stringify(scenario),before);assert(warm.resetOptions.initialAngles.every((angle,i)=>Math.abs(angle-[30,90][i])<=.25));
  assert.deepEqual(runner.prepareCase(scenario,false),scenario);assert(!runner.prepareCase(scenario,false).resetOptions.initialAngles);
});

test('frozen evaluation measures actual joint travel, false-return segments and wrong-surface holds',async()=>{
  let index=0,disposed=0;
  const samples=[[10,20,'floor'],[12,19,'floor'],[11,21,'target'],[11,20,'floor']];
  const frame=()=>({observation:{jointAnglesDegrees:samples[index].slice(0,2),sensor:{valid:true},policyVector:Array(29).fill(index)},
    truncated:index===3,terminated:false,info:{hit:samples[index][2]==='target'?{kind:'component',index:7}:{kind:'floor'},reason:'time-limit',simulationSeconds:index*.05,episodeReward:-.3}});
  const outcome=await runner.evaluate({agent:{act(vector,deterministic){assert.equal(vector.length,29);assert.equal(deterministic,true);return {action:index===2?2:0};}},count:1,
    makeCase:()=>({id:'held-out',seed:10001,task:{episodeSeconds:1,targetIndex:7,targetWorld:[0,20,50]},resetOptions:{}}),yieldControl:async()=>{},
    createEnvironment:()=>({reset:()=>frame(),step(){index++;return frame();},snapshot:()=>({}),dispose(){disposed++;}})});
  const episode=outcome.episodes[0];assert.equal(episode.jointTravelDegrees,7);assert.equal(episode.falseTargetDetections,2);assert.equal(episode.falseHoldAttempts,1);assert.equal(disposed,1);
  assert.deepEqual(episode.actionCounts,[2,0,1,0,0]);
  const summary=evaluation.summarize(outcome.episodes);assert.equal(summary.meanJointTravelDegrees,7);assert.equal(summary.timeoutRate,1);assert.equal(summary.falseLockAttempts,null);
});

test('diagnostic gaps remain unknown and cancelled evaluation excludes unfinished episodes',async()=>{
  const initial={observation:{jointAnglesDegrees:[0,0],sensor:{valid:false}},info:{hit:null}};
  const metrics=evaluation.createMetrics(7,initial);metrics.step(1,{observation:{jointAnglesDegrees:[NaN,0],sensor:{valid:false}},info:{hit:null}});
  assert.equal(metrics.snapshot().jointTravelDegrees,null);
  const tickMetrics=evaluation.createMetrics(7,initial);
  tickMetrics.step(0,{...initial,info:{hit:null,episodeJointTravelDegrees:2.5}});
  assert.equal(tickMetrics.snapshot().jointTravelDegrees,2.5,'Use physical tick travel even when endpoints match');
  let cancelled=false,disposed=0;
  const outcome=await runner.evaluate({agent:{act:()=>({action:0})},count:2,makeCase:()=>({task:{episodeSeconds:1,targetIndex:7},resetOptions:{}}),
    createEnvironment:()=>({reset:()=>({...initial,observation:{...initial.observation,policyVector:[0]}}),step:()=>({...initial}),snapshot:()=>({}),dispose(){disposed++;}}),
    onFrame:()=>{cancelled=true;},shouldStop:()=>cancelled,yieldControl:async()=>{}});
  assert(outcome.cancelled);assert.equal(outcome.episodes.length,0);assert.equal(disposed,1);assert.equal(evaluation.summarize([]).meanJointTravelDegrees,null);
});
