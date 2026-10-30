const {test}=require('node:test'),assert=require('node:assert/strict');
const tf=require('../devserver/vendor/tensorflow-4.22.0/tf.min.js');
const ppo=require('../data/ai-ppo');
test('GAE bootstraps time limits and rollout boundaries but does not cross episode resets',()=>{
  const result=ppo.advantages([{reward:1,value:2,nextValue:3,terminated:false,truncated:true},{reward:100,value:0,nextValue:0,terminated:true,truncated:false}],{gamma:.9,lambda:.8});
  assert(Math.abs(result.raw[0]-1.7)<1e-9);assert.equal(result.raw[1],100);
  assert.equal(ppo.advantages([{reward:1,value:2,nextValue:999,terminated:true}]).returns[0],1);
  assert.equal(ppo.advantages([{reward:1,value:2,nextValue:3}],{gamma:.9,lambda:1}).returns[0],3.7);
  assert.equal(ppo.clippedSurrogate(1.5,2),2.4);assert.equal(ppo.clippedSurrogate(.5,-2),-1.6);
});
test('categorical PPO learns a preferred action, keeps finite losses and releases all tensors',async()=>{
  await tf.setBackend('cpu');await tf.ready();const baseline=tf.memory().numTensors;
  const agent=ppo.create({tf,inputSize:2,actionCount:3,seed:7,settings:{learningRate:.003,epochs:4,batchSize:32}});
  const vector=[1,0],before=agent.predict(vector).probabilities[0];let stableCount=null;
  try{
    for(let update=0;update<18;update++){
      const rows=[];for(let i=0;i<64;i++){const sample=agent.act(vector);rows.push({observation:vector,action:sample.action,logProbability:sample.logProbability,value:sample.value,reward:sample.action===0?1:0,nextValue:0,terminated:true,truncated:false});}
      const metrics=await agent.update(rows);assert(Number.isFinite(metrics.loss));assert(metrics.clippedGradientNorm<=.500001);
      const tensors=tf.memory().numTensors;if(update===1)stableCount=tensors;if(update>1)assert.equal(tensors,stableCount,'Repeated updates must not leak tensors');
    }
    const after=agent.predict(vector).probabilities[0];console.log('Bandit preferred-action probability',before,'->',after);assert(after>.85&&after>before+.4);
    assert.equal(agent.act(vector,true).action,0);assert.throws(()=>agent.act([NaN,0]),/schema/);
  }finally{agent.dispose();agent.dispose();}
  assert.equal(tf.memory().numTensors,baseline);assert.throws(()=>agent.act(vector),/disposed/);
});

test('cancelled PPO update applies no gradients and leaks no tensors',async()=>{
  await tf.setBackend('cpu');await tf.ready();const baseline=tf.memory().numTensors,agent=ppo.create({tf,inputSize:2,actionCount:3});
  try{
    const vector=[1,0],before=agent.predict(vector).probabilities,sample=agent.act(vector);
    const outcome=await agent.update([{observation:vector,...sample,reward:1,nextValue:0,terminated:true}],{shouldStop:()=>true});
    assert.equal(outcome.cancelled,true);assert.equal(agent.inspect().optimizerSteps,0);assert.deepEqual(agent.predict(vector).probabilities,before);
  }finally{agent.dispose();}assert.equal(tf.memory().numTensors,baseline);
});
