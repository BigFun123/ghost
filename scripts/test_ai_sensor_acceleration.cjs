const {test}=require('node:test');const assert=require('node:assert/strict');const sensor=require('../data/simulated-sensor');
function rotate(point,angles){let [x,y,z]=point;const [a,b,c]=angles;[y,z]=[y*Math.cos(a)-z*Math.sin(a),y*Math.sin(a)+z*Math.cos(a)];[x,z]=[x*Math.cos(b)+z*Math.sin(b),-x*Math.sin(b)+z*Math.cos(b)];return [x*Math.cos(c)-y*Math.sin(c),x*Math.sin(c)+y*Math.cos(c),z];}
test('compiled sensor matches reference across moving rigid meshes, cylinders, targets, floor and range limits',()=>{
 const nodes=[{objectType:'Sensor',name:'sensor'},{objectType:'Mesh',name:'mesh'},{objectType:'Target',name:'target'},{objectType:'Target',name:'other'}];let draws=0;
 const registry={draw(node,p){draws++;if(node.objectType==='Mesh'){p.box([0,0,0],[12,18,16],'',false);p.cylinder([15,2,0],5,20,'',true);}}};
 const prepared=sensor.prepareScene({nodes,registry}),compiledDraws=draws;
 for(let i=0;i<500;i++){
  const angle=i*.073,poses=[{origin:[Math.sin(angle)*8,10+Math.cos(angle)*7,0],rotation:[Math.sin(angle)*.8,angle*.2,0]}, {origin:[Math.sin(angle)*20,12,30],rotation:[angle,angle*.7,angle*.3]}, {origin:[Math.sin(angle)*30,8,40],rotation:[0,0,0]}, {origin:[0,20,60],rotation:[0,0,0]}];
  const worldPoint=(items,index,point,shaft=false)=>rotate(point,poses[index].rotation.map((v,a)=>v+(shaft&&a===1?.4:0))).map((v,a)=>v+poses[index].origin[a]);
  const limit=i%3===0?20:2000,a=sensor.read({nodes,index:0,worldPoint,registry,limit}),b=prepared.read({index:0,worldPoint,limit});
  assert.equal(b.valid,a.valid,'valid at '+i);assert.deepEqual(b.hit,a.hit,'hit at '+i);assert.equal(b.reason,a.reason);if(a.valid)assert(Math.abs(a.distanceMm-b.distanceMm)<1e-6,'range at '+i);
 }
 assert(draws>compiledDraws);const before=draws;prepared.read({index:0,worldPoint:(items,index,p)=>p.map((v,a)=>v+(a===1?10:0))});assert.equal(draws,before,'prepared reads do not rebuild geometry');
});
test('compiled sensing keeps blocking surface ties and excludes the sensor body',()=>{
 const nodes=[{objectType:'Sensor',name:'sensor'},{objectType:'Mesh',name:'blocker'},{objectType:'Target',name:'target'}],registry={draw(node,p){if(node.objectType==='Mesh')p.box([0,0,0],[20,20,10],'',false);else if(node.objectType==='Sensor')p.box([0,0,0],[100,100,100],'',false);}};
 const worldPoint=(items,index,p)=>p.map((v,a)=>v+(a===1?(index===2?12:10):0)+(a===2&&index?25:0)),prepared=sensor.prepareScene({nodes,registry});
 const expected=sensor.read({nodes,index:0,registry,worldPoint}),actual=prepared.read({index:0,worldPoint});assert.deepEqual(actual.hit,expected.hit);assert.equal(actual.hit.index,1);assert(Math.abs(actual.distanceMm-expected.distanceMm)<1e-8);
});
test('custom non-rigid transforms fall back to the reference sensor model',()=>{const nodes=[{objectType:'Sensor'},{objectType:'Mesh'}],registry={draw(node,p){p.box([0,0,0],[10,10,10],'',false);}},worldPoint=(items,index,p)=>p.map((v,a)=>v*2+(a===1?20:0)+(a===2&&index?30:0)),prepared=sensor.prepareScene({nodes,registry});assert.deepEqual(prepared.read({index:0,worldPoint}),sensor.read({nodes,index:0,worldPoint,registry}));});
