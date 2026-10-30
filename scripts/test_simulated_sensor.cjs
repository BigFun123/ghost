const {test}=require('node:test');
const assert=require('node:assert/strict');
const sensor=require('../data/simulated-sensor');
function fixture() {
  const nodes=[{name:'Sensor',objectType:'VL53L0X V2 Time of Flight Sensor',position:[0,50,0]},{name:'Goal',objectType:'Target',position:[0,52,100]}];
  const worldPoint=(items,index,point)=>point.map((value,axis)=>value+items[index].position[axis]);
  // No DOM, renderer or Rapier collider is required for Target sensing.
  const registry={draw(node,{box}) {if(node.objectType==='Box')box([0,0,0],[20,20,20]);}};
  const read=()=>sensor.read({nodes,index:0,worldPoint,registry});
  return {nodes,worldPoint,registry,read};
}
test('DOM-free target range includes identity, and policy observation strips identity',()=>{
  const {read}=fixture();const value=read();
  assert.equal(value.valid,true);assert.equal(value.hit.name,'Goal');assert.equal(value.hit.index,1);
  assert(Math.abs(value.distanceMm-91.9)<1e-8);assert(Math.abs(value.point[2]-95)<1e-8);
  assert.deepEqual(sensor.observation(value),{valid:true,distanceMm:value.distanceMm});
  assert(!('hit' in sensor.observation(value)));
});
test('nearer component hides target, sensor geometry is excluded',()=>{
  const {nodes,registry,read}=fixture();
  nodes.push({name:'Blocker',objectType:'Box',position:[0,52,50]});
  assert.equal(read().hit.name,'Blocker');assert(Math.abs(read().distanceMm-36.9)<1e-8);
  // Put a box around the optical origin: only the sensor itself is excluded.
  registry.draw=(node,{box})=>{if(node.objectType==='VL53L0X V2 Time of Flight Sensor')box([0,2,3],[20,20,20]);};
  assert.equal(read().hit.name,'Goal');
});
test('target miss, range boundary and ray orientation are respected',()=>{
  const {nodes,read,worldPoint,registry}=fixture();
  nodes[1].position=[20,52,100];assert.equal(read().valid,false);
  nodes[1].position=[0,52,2008.1];assert(Math.abs(read().distanceMm-2000)<1e-8);
  nodes[1].position=[0,52,2008.2];assert.deepEqual(sensor.observation(read()),{valid:false,distanceMm:null});
  nodes[1].position=[100,52,0];
  const rotated=(items,index,point)=>index===0?[point[2],50+point[1],-point[0]]:worldPoint(items,index,point);
  assert.equal(sensor.read({nodes,index:0,worldPoint:rotated,registry}).hit.name,'Goal');
});
test('floor, prop and invalid rays have distinct outcomes',()=>{
  let reading=sensor.raycast({origin:[0,50,0],direction:[0,-2,0]});
  assert.equal(reading.hit.kind,'floor');assert.equal(reading.distanceMm,50);
  reading=sensor.raycast({origin:[0,-1,0],direction:[0,1,0]});assert.equal(reading.distanceMm,0);
  assert.equal(sensor.raycast({origin:[0,50,0],direction:[0,0,0]}).reason,'invalid-ray');
  assert.equal(sensor.raycast({origin:[NaN,50,0],direction:[0,0,1]}).valid,false);
  const {nodes,worldPoint,registry}=fixture();
  const vertices=Array.from({length:8},(_,bits)=>[-5+(bits&1)*10,47+((bits>>1)&1)*10,40+((bits>>2)&1)*10]);
  const scene=sensor.buildScene({nodes,worldPoint,registry,props:[{vertices}]});
  reading=sensor.read({nodes,index:0,worldPoint,scene});assert.equal(reading.hit.kind,'prop');assert(Math.abs(reading.distanceMm-36.9)<1e-8);
});
test('nearest return does not depend on scene order or rendering',()=>{
  const {nodes,worldPoint,registry}=fixture();
  const before=JSON.stringify(nodes);
  nodes.push({name:'Behind',objectType:'Box',position:[0,52,150]});
  const scene=sensor.buildScene({nodes,worldPoint,registry});scene.surfaces.reverse();
  assert.equal(sensor.read({nodes,index:0,worldPoint,scene}).hit.name,'Goal');
  nodes.pop();assert.equal(JSON.stringify(nodes),before);
  // Touching floor beats target at exactly the same distance.
  const hit=sensor.raycast({origin:[0,10,0],direction:[0,-1,0],spheres:[{center:[0,-5,0],radius:5,index:1}]});
  assert.equal(hit.hit.kind,'floor');
});
