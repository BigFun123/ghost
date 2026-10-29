const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { loadComponentRegistry } = require('../devserver/component-registry');
const context = {};
const registry = loadComponentRegistry(context);
const source = fs.readFileSync('data/app.js', 'utf8');
vm.runInContext(source.slice(source.indexOf('function rotateServoPoint('), source.indexOf('function previewWorldPoint(')), context);
vm.runInContext(source.slice(source.indexOf('function collectPreviewPhysicsNodes('), source.indexOf('function syncPreviewPhysics(')), context);
const nodes = [
 {objectType:'Servo', parent:null, angle:90, position:[0,0,0], rotation:[0,0,0]},
 {objectType:'Servo', parent:1, angle:90, position:[0,30,0], rotation:[0,0,0]},
 {objectType:'VL53L0X V2 Time of Flight Sensor', parent:2, position:[-10,0,0], rotation:[0,-90,0]}
];
context.servoPreview={nodes};
const origin=()=>context.servoWorldPoint(nodes,2,[0,2,3.1]);
const endpoint=()=>context.servoWorldPoint(nodes,2,[0,2,103.1]);
const before=origin(), beam=endpoint();nodes[1].angle=180;
assert.notDeepEqual(origin(),before);assert.notDeepEqual(endpoint(),beam);
assert.equal(registry.attachment(nodes,2).parentSide,'shaft');
assert.equal(context.collectPreviewPhysicsNodes()[2].parentSide,'shaft');
nodes[0].objectType='U Bracket Long';
assert.equal(registry.attachment(nodes,1).fixedSide,'shaft');
assert.equal(registry.attachment(nodes,2).parentSide,'body');
const inverted=origin();nodes[1].angle=90;assert.notDeepEqual(origin(),inverted);
console.log('ToF attachment passed: nested servo rotation, beam endpoint, physics mount and inverted servo mounting.');
// Explicit body/shaft mounts override the legacy automatic mounting rules.
nodes.push({objectType:'Servo Shaft',parent:2,position:[0,0,0],rotation:[0,0,0]});
const fixedOrigin=origin(); nodes[1].angle=160;
assert.deepEqual(origin(),fixedOrigin,'body attachment must remain fixed');
nodes[2].parent=4;
const movingOrigin=origin(); nodes[1].angle=110;
assert.notDeepEqual(origin(),movingOrigin,'shaft attachment must rotate');
const physics=context.collectPreviewPhysicsNodes();
assert.equal(physics.length,3,'shaft must not add mass or a collider');
assert.equal(physics[2].parent,1);
assert.equal(physics[2].parentSide,'shaft');
assert.equal(registry.attachment(nodes,1).fixedSide,'body');
console.log('Explicit body and shaft attachment checks passed.');
const callbacks={};
context.document={getElementById:id=>({value:registry.choices().find(d=>d.objectType==='Servo').choice ?? 'Servo',addEventListener:(_,fn)=>callbacks[id]=fn})};
Object.assign(context,{initializePreviewPlacementControls(){},setText(){},drawServoPreview(){},refreshAddedComponent(){}});
vm.runInContext(source.slice(source.indexOf('function servoCommandLimits('),source.indexOf('function prepareServoRequest(')),context);
vm.runInContext(source.slice(source.indexOf('function configurationWithRobot('),source.indexOf('function initializeServoPreview(')),context);
const configuration={components:[]};
context.servoPreview={editing:true,configuration,nodes:[],servoNodes:[],savedNames:[]};
vm.runInContext(source.slice(source.indexOf('document.getElementById("previewAdd").addEventListener('),source.indexOf('function nudgePreviewServo(')),context);
callbacks.previewAdd();
assert.equal(configuration.components.length,2);
assert.equal(context.servoPreview.servoNodes.length,1);
assert.equal(configuration.components[1].parent,configuration.components[0].name);
require('../devserver/server').validateConfiguration(JSON.parse(JSON.stringify(configuration)));
assert.equal(context.createRobotNodes(configuration)[1].objectType,'Servo Shaft');
callbacks.previewRemove();
assert.equal(configuration.components.length,0);
assert.equal(context.servoPreview.nodes.length,0);
console.log('Servo pair creation, config validation/reload and removal passed.');
