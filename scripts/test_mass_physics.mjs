import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../data/physics.js';
const source=fs.readFileSync(new URL('../data/lib/rapier.js',import.meta.url),'utf8');
const {default:RAPIER}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
await RAPIER.init();
const axes=[[1,0,0],[0,1,0],[0,0,1]],pose={center:[0,150,0],axes};
const node=(index,massGrams,parent=null)=>({index,massGrams,parent,parentSide:'body',servo:false,body:pose,shaft:pose});
const box=(index,size,shaft=false)=>({index,shaft,kind:'box',offset:[0,0,0],dimensions:[size,10,10],axes});
const near=(value,expected)=>assert(Math.abs(value-expected)<1e-5,`${value} != ${expected}`);
function check(nodes,shapes,expected){const physics=GhostPhysics.create(RAPIER);try{physics.syncRobot(nodes,shapes,'mass fixture');physics.advance(1/60);const masses=[];physics.world.forEachRigidBody(body=>{if(body.isDynamic())masses.push(body.mass());});assert.equal(masses.length,expected.length);masses.sort((a,b)=>a-b);expected.sort((a,b)=>a-b);masses.forEach((value,i)=>near(value,expected[i]));}finally{physics.destroy();}}
check([node(0,100)],[box(0,10),box(0,30)],[.1]);
check([node(0,100),node(1,50,0)],[box(0,10),box(1,20)],[.15]);
check([node(0,30)],[],[.03]);
check([node(0,100),node(1,30,0)],[box(0,10)],[.13]);
const servo={...node(0,200),servo:true,fixedSide:'body',target:0,enabled:false};
check([servo],[box(0,10),box(0,30,true)],[.05,.15]);
check([node(0,undefined)],[box(0,10)],[.0008]);
console.log('Physics mass passed: grams to kilograms, compound shapes, welded components, Null payloads, servo split and legacy density.');
