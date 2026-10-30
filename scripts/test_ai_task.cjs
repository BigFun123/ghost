const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {loadComponentRegistry}=require('../devserver/component-registry');
require('../data/simulated-sensor');
const task=require('../data/ai-task');
function fixture() {
  const context={GhostSensor:require('../data/simulated-sensor')},registry=loadComponentRegistry(context),source=fs.readFileSync('data/app.js','utf8');
  vm.runInContext(source.slice(source.indexOf('function rotateServoPoint('),source.indexOf('function previewWorldPoint(')),context);
  vm.runInContext(source.slice(source.indexOf('function previewRayDistance('),source.indexOf('function setPreviewLedColor(')),context);
  const configuration=JSON.parse(fs.readFileSync('data/robots/PanTilt/config.json','utf8'));
  const nodes=configuration.components.map(c=>({...c,parent:c.parent===null?null:configuration.components.findIndex(x=>x.name===c.parent)+1,position:['x','y','z'].map(axis=>c.position[axis]),rotation:['x','y','z'].map(axis=>c.rotation[axis]),angle:c.startupAngle??90}));
  const sensorIndex=nodes.findIndex(n=>n.objectType.startsWith('VL53L0X')),targetIndex=nodes.findIndex(n=>n.objectType==='Target');
  const chain=task.ancestry(nodes,sensorIndex).filter(i=>nodes[i].objectType==='Servo');
  const args={nodes,configuration,sensorIndex,targetIndex,panIndex:chain[1],tiltIndex:chain[0],worldPoint:context.servoWorldPoint,registry,rayDistance:context.previewRayDistance};
  function place(distance=200) {
    nodes[args.panIndex].angle=30;nodes[args.tiltIndex].angle=90;
    const o=args.worldPoint(nodes,sensorIndex,[0,2,3.1]),f=args.worldPoint(nodes,sensorIndex,[0,2,4.1]);
    nodes[targetIndex].parent=null;nodes[targetIndex].position=o.map((v,i)=>v+(f[i]-v)*distance);
  }
  return {args,place};
}
test('visible pan-tilt target validates without changing scene state',()=>{
  const {args,place}=fixture();place();const before=JSON.stringify(args.nodes);
  const result=task.validate(args);
  assert.equal(JSON.stringify(args.nodes),before);assert.equal(result.fixedBase,true);
  assert.equal(result.holdSeconds,0.5);assert.equal(result.episodeSeconds,10);
  assert(Math.abs(result.solution.distanceMm-195)<0.1);
  result.solution.angles.forEach((angle,i)=>assert(angle>=result.joints[i].min&&angle<=result.joints[i].max));
});

test('unreachable target names the limiting joint without changing rig settings',()=>{
  const {args}=fixture();
  args.nodes[args.targetIndex].parent=null;args.nodes[args.targetIndex].position=[60,5,0];
  args.nodes[args.tiltIndex].maxAngle=115;
  const before=JSON.stringify({nodes:args.nodes,configuration:args.configuration});
  assert.throws(()=>task.validate(args),error=>error.message.includes(args.nodes[args.tiltIndex].name)&&/needs about 137\./.test(error.message)&&/allowed 0–115/.test(error.message)&&/Limits were not changed/.test(error.message));
  assert.equal(JSON.stringify({nodes:args.nodes,configuration:args.configuration}),before);
});
test('rejects floor intersection, moving target, invalid limits and incorrect joint selections',()=>{
  const {args,place}=fixture();
  args.nodes[args.targetIndex].position[1]=0;assert.throws(()=>task.validate(args),/Raise the target/);
  place();args.nodes[args.targetIndex].parent=args.tiltIndex+1;assert.throws(()=>task.validate(args),/moving joint/);
  place();assert.throws(()=>task.validate({...args,panIndex:args.tiltIndex,tiltIndex:args.panIndex}),/outer servo/);
  args.nodes[args.panIndex].continuous=true;assert.throws(()=>task.validate(args),/positional servo/);
  args.nodes[args.panIndex].continuous=false;args.nodes[args.panIndex].minAngle=100;args.nodes[args.panIndex].maxAngle=50;
  assert.throws(()=>task.validate(args),/invalid angle limits/);
});
test('rejects out-of-range and occluded targets',()=>{
  const {args,place}=fixture();place(3000);assert.throws(()=>task.validate(args),/2000 mm/);
  place(); const p=[...args.nodes[args.targetIndex].position];
  args.nodes.push({name:'Occluder',objectType:'Box 50 mm',parent:null,position:p,rotation:[0,0,0]});
  assert.throws(()=>task.validate(args),/occluded/);
});
test('rejects invalid episode timing and cyclic parent chains',()=>{
  const {args,place}=fixture();place();assert.throws(()=>task.validate({...args,holdSeconds:11,episodeSeconds:10}),/hold time/);
  args.nodes[args.panIndex].parent=args.sensorIndex+1;assert.throws(()=>task.validate(args),/cyclic/);
});
