const { loadComponentRegistry } = require('../devserver/component-registry');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../data/app.js'), 'utf8');
const context = { GhostSensor: require('../data/simulated-sensor'), previewPhysicsEnabled: false, previewPhysics: null };
vm.createContext(context);
  loadComponentRegistry(context);
for (const [start, end] of [
  ['function rotateServoPoint(', 'function drawPreviewConstraintGuides('],
  ['function previewRayDistance(', 'function drawServoPreview(']
]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
const ray = context.previewRayDistance;
assert.equal(ray([0, 100, 0], [0, -1, 0], [], 0), 100, 'Floor is solid without any scene meshes');
assert.equal(ray([0, 100, 0], [0, 1, 0], [], 0), null);
assert.equal(ray([0, 100, 0], [0, 0, 1], [], 0), null);
assert.equal(ray([0, -1, 0], [0, 1, 0], [], 0), 0, 'Below-floor origin is inside solid ground');
assert.equal(ray([0, 0, 0], [0, -1, 0], [], 0), 0);
assert.equal(ray([0, 2500, 0], [0, -1, 0], [], 0), null, 'Display ray is limited to 2000 mm');
const surface = { index: 1, vertices: [[-10, 50, -10], [10, 50, -10], [10, 50, 10], [-10, 50, 10]] };
assert.equal(ray([0, 100, 0], [0, -1, 0], [surface], 0), 50, 'Nearest scene surface blocks the beam');
assert.equal(ray([0, 100, 0], [0, -1, 0], [surface], 1), 100, 'Ignore the sensor itself');
assert.equal(ray([20, 100, 0], [0, -1, 0], [surface], 0), 100, 'A missed surface leaves the floor hit');
assert.equal(ray([0, 100, 0], [0, -1, 0], [{ ...surface, index: null }], 0), 50, 'Physics props also block the beam');
const nodes = [
  { objectType: 'Robot', parent: null, position: [0, 100, 0], rotation: [90, 0, 0] },
  { objectType: 'VL53L0X V2 Time of Flight Sensor', parent: 1, position: [0, 0, 0], rotation: [0, 0, 0] }
];
const labels = [], lines = [], dashes = [];
const ctx = { save() {}, restore() {}, setLineDash(value) { dashes.push(value); }, beginPath() {}, arc() {}, fill() {},
  strokeText() {}, fillText(text) { labels.push(text); } };
vm.runInContext('componentRegistry', context).drawOverlays({ ctx, nodes, offline: true, surfaces: [], project: point => point,
  line: (start, end) => lines.push({ start, end }), worldPoint: context.previewWorldPoint,
  measureSensor: index => context.GhostSensor.read({nodes,index,worldPoint:context.previewWorldPoint,scene:{surfaces:[],spheres:[]}}), state: { ledRgb: [0, 0, 0] }, ratio: 1 });
assert.equal(labels[0], '96.9 mm (sim)', 'Distance starts at the optical face and follows the parent rotation');
assert(Math.abs(lines[0].end[1]) < 0.000001);
assert(dashes[0].length === 2 && dashes[1].length === 0, 'Beam is dotted and dash style is reset');
console.log('Distance sensor passed: floor, range, self exclusion, nearest scene/physics surfaces, parent transforms, dotted beam and label.');
const registry=vm.runInContext('componentRegistry', context);
function liveOverlay(sensor,telemetryAgeMs=0) {
  labels.length=0;lines.length=0;
  registry.drawOverlays({ctx,nodes,state:{ledRgb:[0,0,0]},ratio:1,project:point=>point,line:(start,end)=>lines.push({start,end}),
    worldPoint:context.previewWorldPoint,offline:false,sensors:sensor?{vl53l0x:sensor}:null,telemetryAgeMs,
    measureSensor(){throw new Error('Live overlay must not sample simulated distance');}});
}
liveOverlay({ready:true,valid:true,distanceMm:456});
assert.equal(labels[0],'456.0 mm (VL53L0X)');
assert.ok(Math.abs(lines[0].end[1]-(96.9-456))<1e-8,'beam uses physical distance even past a simulated surface');
nodes[1].distanceMultiplier=1.25;
liveOverlay({ready:true,valid:true,distanceMm:456});
assert.equal(labels[0],'570.0 mm (VL53L0X)');
assert.ok(Math.abs(lines[0].end[1]-(96.9-570))<1e-8,'beam uses calibrated distance');
assert.equal(registry.settings({objectType:nodes[1].objectType}).distanceMultiplier,1);
assert.equal(registry.settings(JSON.parse(JSON.stringify(nodes[1]))).distanceMultiplier,1.25);
for(const distanceMultiplier of [0,-1,NaN,Infinity,1001]) assert.throws(()=>registry.settings({...nodes[1],distanceMultiplier}));
for(const [sensor,age,label] of [[null,0,'Waiting for sensor'],[{ready:false},0,'Sensor unavailable'],
  [{ready:true,valid:true,distanceMm:456},3001,'Stale reading'],
  [{ready:true,valid:false,distanceMm:456},0,'Invalid reading'],
  [{ready:true,valid:true,distanceMm:NaN},0,'Invalid reading']]) {
  liveOverlay(sensor,age);assert.equal(labels[0],label);assert.equal(lines.length,0,'unusable live reading must not draw a simulated beam');
}
console.log('Live overlay passed: physical beam and label, no simulation fallback, missing/unavailable/stale/invalid telemetry.');
