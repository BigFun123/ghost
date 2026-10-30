const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../data/ai-acquisition');
const scenario={seed:11,task:{joints:[{min:0,max:180,startup:90},{min:0,max:180,startup:90}],solution:{angles:[30,60]}},resetOptions:{jitterDegrees:5}};
test('progressive starts bridge toward ordinary starts without mutating cases',()=>{
  const model=create(),before=JSON.stringify(scenario),near=model.prepare(scenario);
  assert(near.resetOptions.initialAngles.every((angle,i)=>Math.abs(angle-scenario.task.solution.angles[i])<=.25));
  for(let i=0;i<9;i++)model.record(true);assert.equal(model.status().level,0);
  model.record(true);assert.equal(model.status().level,1);
  const bridge=model.prepare(scenario);assert(bridge.resetOptions.initialAngles[0]>near.resetOptions.initialAngles[0]+3);
  assert.deepEqual(model.prepare(scenario),bridge);assert.equal(JSON.stringify(scenario),before);
  while(model.status().level<5)for(let i=0;i<10;i++)model.record(true);
  const full=model.prepare(scenario);assert(!full.resetOptions.initialAngles);assert.deepEqual(full.resetOptions,scenario.resetOptions);
  for(let i=0;i<20;i++)model.record(false);assert.equal(model.status().level,4);
});
test('isolated lucky successes do not advance the curriculum',()=>{
  const model=create();for(let i=0;i<40;i++)model.record(i%4===0);assert.equal(model.status().level,0);
});
