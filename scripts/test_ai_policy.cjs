const {test}=require('node:test'),assert=require('node:assert/strict');
const {actions,createEncoder}=require('../data/ai-policy');
const joints=[{min:30,max:150},{min:0,max:180}];
const frame={jointAnglesDegrees:[90,90],jointVelocitiesDegreesPerSecond:[0,0],sensor:{valid:true,distanceMm:1000}};
test('policy has a fixed finite 29-value schema and reset clears history/action',()=>{
  const encoder=createEncoder(joints),first=encoder.encode(frame,null,true);
  assert.equal(first.length,29);assert(first.every(Number.isFinite));assert.deepEqual(first.slice(-5),[0,0,0,0,0]);
  encoder.encode({...frame,jointAnglesDegrees:[150,180]},2);
  assert.deepEqual(encoder.encode(frame,null,true),first);
  assert.equal(encoder.schema.historyLength,4);assert.equal(actions.length,5);
});
test('angle and velocity normalization clamp, readings distinguish missing from maximum range',()=>{
  const encoder=createEncoder(joints);
  const extreme={jointAnglesDegrees:[-50,999],jointVelocitiesDegreesPerSecond:[-1000,1000],sensor:{valid:true,distanceMm:2000}};
  const valid=encoder.encode(extreme,4,true);assert.deepEqual(valid.slice(0,6),[-1,1,-1,1,1,1]);
  const missing=encoder.encode({...extreme,sensor:{valid:false,distanceMm:null}},0,true);assert.deepEqual(missing.slice(0,6),[-1,1,-1,1,1,0]);
});
test('history advances once per action without target identity and resets deterministically',()=>{
  const a=createEncoder(joints),b=createEncoder(joints);a.encode(frame,null,true);b.encode({...frame,hit:{index:99},targetWorld:[9,8,7]},null,true);
  const next={...frame,jointAnglesDegrees:[150,180],sensor:{valid:true,distanceMm:50}};
  const one=a.encode(next,1),two=b.encode({...next,hit:{index:100}},1);assert.deepEqual(one,two);
  assert.deepEqual(one.slice(0,6),[0,0,0,0,.5,1]);assert.deepEqual(one.slice(18,24),[1,1,0,0,.025,1]);assert.deepEqual(one.slice(-5),[0,1,0,0,0]);
  assert.throws(()=>a.encode({...frame,jointAnglesDegrees:[NaN,0]}),/finite/);assert.throws(()=>a.encode(frame,5),/action/);
});
