import assert from 'node:assert/strict';
import fs from 'node:fs';
import loader from '../devserver/component-registry.js';
import '../data/physics.js';
const source=fs.readFileSync(new URL('../data/lib/rapier.js',import.meta.url),'utf8');
const {default:RAPIER}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
await RAPIER.init();
const registry=loader.loadComponentRegistry();
const axes=[[1,0,0],[0,1,0],[0,0,1]];
const pose=center=>({center,axes});
const mount=pose([0,200,0]);
const nodes=[
 {index:0,parent:null,null:true,servo:false,body:mount,shaft:mount,constraints:{x:{enabled:true,min:0,max:0},y:{enabled:true,min:0,max:0},z:{enabled:true,min:0,max:0}},rotationConstraints:{x:true,y:true,z:true}},
 {index:1,parent:0,parentSide:'body',servo:true,fixedSide:'body',body:mount,shaft:mount,target:0,enabled:true,massGrams:200},
 {index:2,parent:1,parentSide:'shaft',servo:false,body:mount,shaft:mount,massGrams:100},
 {index:3,parent:null,servo:false,body:pose([0,175,-40]),shaft:pose([0,175,-40]),massGrams:50}
];
const shapes=[{index:1,shaft:false,kind:'box',offset:[0,0,0],dimensions:[10,10,10],axes}];
function model(type,index){registry.draw({objectType:type},{purpose:'physics',box:(offset,dimensions)=>shapes.push({index,shaft:false,kind:'box',offset:Array.from(offset),dimensions:Array.from(dimensions),axes}),cylinder:(offset,radius,height)=>shapes.push({index,shaft:false,kind:'cylinder',offset:Array.from(offset),radius,height,axes}),label(){}});}
model('U Bracket Long',2);model('Aluminium Extrusion 20x20x100 mm',3);
const physics=GhostPhysics.create(RAPIER);
try{
 physics.world.gravity={x:0,y:0,z:0};
 physics.syncRobot(nodes,shapes,'arm and extrusion');
 for(let i=0;i<30;i++){physics.syncRobot(nodes,shapes,'arm and extrusion');physics.advance(1/60);}
 const initial=physics.point(3,[0,0,0]);
 nodes[1].target=Math.PI/2;
 for(let i=0;i<180;i++){physics.syncRobot(nodes,shapes,'arm and extrusion');physics.advance(1/60);}
 const final=physics.point(3,[0,0,0]);
 const moved=Math.hypot(...final.map((value,i)=>value-initial[i]));
 assert(moved>10,`servo-driven long bracket must push detached extrusion; moved ${moved} mm`);
 console.log(`Scene collisions passed: servo-driven actual U Bracket Long moves actual detached extrusion ${moved.toFixed(1)} mm.`);
}finally{physics.destroy();}
