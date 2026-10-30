const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../data/ai-test-progress');
const run=(angles,reward,reason='time-limit',updates=1)=>({angles,seed:42,updates,episode:{reward,reason,seconds:reason==='success'?.5:10}});
test('progress compares matching poses and seeds, excluding stopped tests from scores',()=>{
  const history=create(),key=history.add(run([90,90],-1));
  history.add({angles:[90,90],seed:42,updates:2,cancelled:true});
  history.add(run([90,90],11,'success',3));history.add(run([30,90],5));
  assert.equal(history.groups().length,2);assert.equal(history.summary(key).completed,2);assert.equal(history.summary(key).stopped,1);
  assert.equal(history.summary(key).successes,1);assert.equal(history.summary(key).recent,2);assert.equal(history.summary(key).delta,12);
  history.add({...run([90,90],1),seed:43});assert.equal(history.groups().length,3);
});
test('history is bounded, copies input and output arrays, and clears between policy sessions',()=>{
  const history=create(3),input=run([90,90],1),key=history.add(input);input.angles[0]=0;
  assert.equal(history.series(key)[0].angles[0],90);const row=history.series(key)[0];row.angles[0]=0;assert.equal(history.series(key)[0].angles[0],90);
  for(let i=2;i<=5;i++)history.add(run([90,90],i));assert.deepEqual(history.series(key).map(row=>row.id),[3,4,5]);
  assert.equal(history.summary(key).delta,2);history.clear();assert.equal(history.groups().length,0);assert.equal(history.summary(key).delta,null);
});
test('rolling acquisition counts use only the latest five completed tests',()=>{
  const history=create();let key;for(let i=0;i<7;i++)key=history.add(run([90,90],i,i<2?'success':'time-limit'));
  history.add({angles:[90,90],seed:42,updates:8,cancelled:true});assert.equal(history.summary(key).recent,5);assert.equal(history.summary(key).successes,0);
  assert.throws(()=>history.add(run([90,90],NaN)),/finite result/);
});
