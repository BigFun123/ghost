import fs from 'node:fs';
import vm from 'node:vm';
import registryLoader from '../devserver/component-registry.js';
import '../data/physics.js';
import '../data/simulated-sensor.js';
import '../data/ai-task.js';
import '../data/ai-policy.js';
import '../data/ai-reward.js';
import '../data/ai-environment.js';
const source=fs.readFileSync(new URL('../data/lib/rapier.js',import.meta.url),'utf8');
const {default:RAPIER}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
await RAPIER.init();
export function fixture() {
  const context={},registry=registryLoader.loadComponentRegistry(context),app=fs.readFileSync('data/app.js','utf8');
  vm.runInContext(app.slice(app.indexOf('function rotateServoPoint('),app.indexOf('function previewWorldPoint(')),context);
  vm.runInContext(app.slice(app.indexOf('function collectPreviewPhysicsShapes('),app.indexOf('function syncPreviewPhysics(')),context);
  const configuration=JSON.parse(fs.readFileSync('data/robots/PanTilt/config.json','utf8'));
  const nodes=configuration.components.map(c=>({...c,parent:c.parent===null?null:configuration.components.findIndex(x=>x.name===c.parent)+1,position:['x','y','z'].map(axis=>c.position[axis]),rotation:['x','y','z'].map(axis=>c.rotation[axis]),angle:c.startupAngle??90,spinAngle:90,enabled:true,outputEnabled:true}));
  const sensorIndex=nodes.findIndex(n=>n.objectType.startsWith('VL53L0X')),targetIndex=nodes.findIndex(n=>n.objectType==='Target');
  const chain=globalThis.GhostLearningTask.ancestry(nodes,sensorIndex).filter(i=>nodes[i].objectType==='Servo');
  nodes[chain[1]].angle=30;nodes[chain[0]].angle=90;
  const origin=context.servoWorldPoint(nodes,sensorIndex,[0,2,3.1]),forward=context.servoWorldPoint(nodes,sensorIndex,[0,2,4.1]);
  nodes[targetIndex].parent=null;nodes[targetIndex].position=origin.map((value,i)=>value+(forward[i]-value)*200);
  const task=globalThis.GhostLearningTask.validate({nodes,configuration,sensorIndex,targetIndex,panIndex:chain[1],tiltIndex:chain[0],registry,worldPoint:context.servoWorldPoint});
  return {nodes,task,registry,worldPoint:context.servoWorldPoint,rotatePoint:context.rotateServoPoint,physicsNodes:context.collectPreviewPhysicsNodes,physicsShapes:context.collectPreviewPhysicsShapes,RAPIER};
}
