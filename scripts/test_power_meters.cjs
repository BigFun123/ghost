const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadComponentRegistry } = require('../devserver/component-registry');
const context = { performance: { now: () => 0 } };
vm.createContext(context);
const registry = loadComponentRegistry(context);
vm.runInContext(fs.readFileSync('data/power-meters.js', 'utf8'), context);
const state = { ready: true, powered: true, angle: 90, minPowerWatts: 0.1, maxPowerWatts: 1 };
const estimate = (changes = {}, now = 0, previous) => context.estimateServoPowerDemand({ ...state, ...changes }, now, previous);
assert.equal(estimate().percent, 10);
assert.equal(estimate({ powered: false }).percent, 0);
assert.equal(estimate({ ready: false }).percent, 0);
const linear = { at: 0, start: 0, target: 180, duration: 1000, smooth: false };
assert.equal(estimate({ motion: linear }, 500).percent, 100);
assert.equal(estimate({ motion: { ...linear, duration: 4000 } }, 500).percent, 32.5);
const smooth = { ...linear, duration: 1500, smooth: true };
assert.equal(estimate({ motion: smooth }, 0).percent, 10);
assert.equal(estimate({ motion: smooth }, 750).percent, 100);
assert.equal(estimate({ motion: smooth }, 1500).percent, 10);
assert.equal(estimate({ continuous: true, angle: 90 }).percent, 10);
assert.equal(estimate({ continuous: true, angle: 0 }).percent, 100);
assert.equal(estimate({ continuous: true, angle: 180 }).percent, 100);
const jump = estimate({ angle: 180 }, 100, estimate({ angle: 0 }));
assert.equal(jump.percent, 100);
assert(estimate({ angle: 180 }, 600, jump).percent < 15, 'Transient demand decays after an immediate move');
assert.equal(estimate({ angle: 180 }, 10000, estimate({ angle: 0 })).percent, 10, 'A suspended tab does not invent speed');
assert.equal(estimate({ powered: false }, 101, jump).percent, 0, 'Power off clears activity immediately');

function element() {
  return { children: [], attributes: {}, classList: { toggle(key, value) { this[key] = value; } },
    setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; },
    replaceChildren() { this.children = []; }, append(child) { this.children.push(child); } };
}
let destroyed = false;
Object.assign(context, { document: { createElement: element }, setInterval: () => 1, clearInterval() { destroyed = true; } });
const master = element();
const controls = [0, 1].map(index => ({ name: 'Servo ' + index, meter: element() }));
let channels = controls.map((control, index) => ({ ...state, control, powered: index === 0, continuous: true, angle: 180 }));
const meters = context.createServoPowerMeters({ master, read: () => channels });
assert.equal(master.children.length, 10);
assert.equal(controls[0].meter.children.filter(segment => segment.classList.lit).length, 10);
assert.equal(controls[1].meter.children.filter(segment => segment.classList.lit).length, 0);
assert.equal(master.attributes['aria-valuenow'], '50', 'Combined demand averages all configured outputs');
channels = channels.map(channel => ({ ...channel, powered: false }));
meters.update(100);
assert.equal(master.attributes['aria-valuenow'], '0');
meters.destroy();
assert(destroyed);
channels = controls.map((control, index) => ({ ...state, control, powered: index === 0,
  continuous: true, angle: 180, component: { minPowerWatts: 1, maxPowerWatts: 10 } }));
const system = context.createServoPowerMeters({ master, read: () => channels,
  readComponents: () => [{ objectType: 'Robot', enabled: true, minPowerWatts: 2, maxPowerWatts: 4 }] });
assert.match(controls[0].meter.title, /10\.00 W estimated/);
assert.match(controls[1].meter.title, /0\.00 W estimated/);
assert.match(master.title, /12\.00 W estimated/);
assert.equal(master.attributes['aria-valuenow'], '50', 'Total includes controller baseline and all maximum ranges');
assert.deepEqual(Array.from(system.readMetrics(), trace => trace.value), [10, 0, 2], 'Metrics share the exact servo and controller estimates used by meters');
assert(system.readMetrics().every(trace => trace.category === 'power' && trace.unit === 'W'));
channels[0].angle = 90;
system.update(10000);
assert.match(controls[0].meter.title, /1\.00 W estimated/, 'Stationary servo uses its configured minimum');
assert.match(master.title, /3\.00 W estimated/);
channels[0].component.minPowerWatts = null;
system.update(10100);
assert.equal(system.readMetrics()[0].value, 0.192, 'Uncalibrated components use model estimates in the graph');
// Missing calibration uses the same model hooks in the meter and graph.
system.update(10200);
assert.equal(system.readMetrics()[0].value, 0.192, 'Missing calibration uses the servo model default');
assert.match(system.readMetrics()[0].name, /model estimate/);
assert.match(controls[0].meter.title, /provisional model defaults/);
for (const [voltage, idle, running, peak] of [[4.8, 0.192, 1.008, 10.08], [8.4, 0.336, 2.184, 27.72]]) {
  const power = registry.getPower({ objectType: 'Servo', powerVoltageVolts: voltage });
  assert(Math.abs(power.min - idle) < 1e-9);
  assert(Math.abs(power.running - running) < 1e-9);
  assert(Math.abs(power.max - peak) < 1e-9);
}
const custom = registry.getPower({ objectType: 'Robot', powerVoltageVolts: 5, idleCurrentAmps: 0.1, runningCurrentAmps: 0.2, peakCurrentAmps: 0.4 });
assert.equal(custom.min, 0.5); assert.equal(custom.running, 1); assert.equal(custom.max, 2);
assert.equal(registry.getPower({ objectType: 'Robot' }).max, 1);
assert.equal(registry.getPower({ objectType: 'Box 50 mm' }).max, 0);
assert.equal(registry.getPower({ objectType: 'Servo', model: 'micro' }).min, 0.1);
assert.equal(registry.getPower({ objectType: 'Servo', minPowerWatts: 0, maxPowerWatts: 0 }).max, 0, 'Explicit zero overrides defaults');
assert.equal(registry.getPower({ objectType: 'Robot', minPowerWatts: 2, maxPowerWatts: 8 }).source, 'config');
for (const definition of [...registry.choices(), registry.resolve({ objectType: 'Robot' })]) {
  assert.equal(typeof definition.getPower, 'function', 'Every component model provides its own getPower hook');
  const range = definition.getPower();
  assert(range.min >= 0 && range.max >= range.min);
}
system.destroy();
let tick, clock = 0;
context.performance.now = () => clock;
context.setInterval = fn => { tick = fn; return 2; };
const td = { objectType: 'Servo', name: 'TD-7120MG' };
const tdControl = { name: td.name, meter: element() };
let tdState = { ready: true, powered: true, angle: 0, component: td, control: tdControl,
  motion: { at: 0, start: 0, target: 180, duration: 1500, smooth: true } };
const animated = context.createServoPowerMeters({ master, read: () => [tdState] });
const lit = () => tdControl.meter.children.filter(segment => segment.classList.lit).length;
assert.equal(lit(), 2, 'TD-7120MG idle is visible on the running-power scale');
clock = 750; tick();
assert.equal(lit(), 10, 'The actual timer lights the full meter at normal running power');
assert.equal(master.attributes['aria-valuenow'], '100', 'Master uses the same running-power scale');
assert.match(tdControl.meter.title, /Configured peak: 10\.08 W/);
assert(Math.abs(animated.readMetrics()[0].value - 1.008) < 1e-9, 'Graph retains the correct watt estimate');
tdState = { ...tdState, powered: false }; clock = 850; tick();
assert.equal(lit(), 0, 'Power off clears the meter on the next tick');
animated.destroy();
console.log('Power meters passed: idle/off, linear/S-curve/continuous motion, immediate moves, suspension, ten segments and combined demand.');
