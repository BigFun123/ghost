const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const context = { componentRegistry: { register() {} }, document: { createElement: () => ({ classList: { toggle() {} }, setAttribute() {}, addEventListener(event, fn) { this[event] = fn; }, append(...children) { this.children = children; } }) } };
vm.createContext(context);
vm.runInContext(fs.readFileSync('data/components/VL53L0X.js', 'utf8'), context);
let settingsOpened = 0;
const panel = context.createVL53L0XPanel({ openSettings: () => settingsOpened++ });
const value = panel.element.children[2], caption = panel.element.children[3];
const scene = { node: { name: 'Front distance' }, nodes: [], index: 0, surfaces: [], offline: true,
 worldPoint: (_, i, point) => point, rayDistance: () => 123.45 };
panel.update(scene); assert.equal(value.textContent, '123.5 mm');
panel.update({ ...scene, rayDistance: () => null }); assert.equal(value.textContent, 'No hit');
const live = { ...scene, offline: false, telemetryAgeMs: 0, sensors: { vl53l0x: { ready: true, valid: true, distanceMm: 456 } } };
panel.update(live); assert.equal(value.textContent, '456 mm'); assert.match(caption.textContent, /Physical/);
panel.update({ ...live, telemetryAgeMs: 3001 }); assert.equal(value.textContent, 'Stale reading');
panel.update({ ...live, sensors: null }); assert.equal(value.textContent, 'Waiting for sensor');
for (const distanceMm of [null, NaN]) { panel.update({ ...live, sensors: { vl53l0x: { ready: true, valid: true, distanceMm } } }); assert.equal(value.textContent, 'Invalid reading'); }
panel.update({ ...live, sensors: { vl53l0x: { ready: false } } }); assert.equal(value.textContent, 'Unavailable');
panel.update(scene); assert.equal(value.textContent, '123.5 mm'); assert.match(caption.textContent, /Simulated/);
console.log('Distance panel passed: offline ray, no hit, physical readings, missing/invalid/stale data, mode switching.');

const [draw] = panel.element.children[4].children;
const config = panel.element.children[7], clear = panel.element.children[8];
config.click(); assert.equal(settingsOpened, 1);
assert.equal(panel.element.children[4].children.length, 1);
draw.click();
for (let i = 0; i < 2005; i++) panel.update({ ...live, sensors: { vl53l0x: { ready: true, valid: true, distanceMm: i } } });
const scan = context.vl53l0xScan(scene.node);
assert.equal(scan.points.length, 2000);
assert.equal(scan.points[0][2], 8.1);
assert.equal(scan.points.at(-1)[2], 2007.1);
draw.click(); panel.update(live); assert.equal(scan.points.length, 2000);
clear.click(); assert.equal(scan.points.length, 0);
console.log('Scan capture passed: world endpoints, 2000-point FIFO, pause and clear.');
