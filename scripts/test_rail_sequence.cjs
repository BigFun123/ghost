const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { loadComponentRegistry } = require('../devserver/component-registry');
class Element {
  constructor(tag) { this.tag = tag; this.children = []; }
  append(...children) { children.forEach(child => { child.parent = this; this.children.push(child); }); }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  setAttribute() {} addEventListener() {}
}
const host = new Element('div'), frames = new Map(); let next = 1;
const context = { document: { createElement: tag => new Element(tag), querySelector: () => host, getElementById: () => null },
  performance: { now: () => 0 }, requestAnimationFrame: fn => { const id = next++; frames.set(id, fn); return id; }, cancelAnimationFrame: id => frames.delete(id),
  servoControls: [], encodeServoState() {}, requestServoBatch: async () => {}, sequenceRunId: 1, setText() {} };
vm.createContext(context); const registry = loadComponentRegistry(context);
vm.runInContext(fs.readFileSync('data/component-panels.js', 'utf8'), context);
const node = { name: 'Rail', objectType: 'Stepper Linear Actuator', lengthMm: 500, positionMm: 123.4 };
context.scene = { nodes: [node], change() {} };
vm.runInContext('componentPanels.update(scene)', context);
const source = fs.readFileSync('data/app.js', 'utf8');
vm.runInContext(source.slice(source.indexOf('function captureSequenceStep('), source.indexOf('async function selectSequenceStep(')), context);
const step = context.captureSequenceStep(1000);
assert.equal(step.componentStates[0].positionMm, 123.4);
assert.equal(step.componentStates[0].name, 'Rail');
const saved = JSON.parse(JSON.stringify(step));
registry.validateSequenceStates(saved.componentStates);
registry.validateSequenceStates(undefined);
assert.throws(() => registry.validateSequenceStates([{ ...saved.componentStates[0], positionMm: -1 }]), /position/);
assert.throws(() => registry.validateSequenceStates([{ ...saved.componentStates[0], positionMm: '20' }]), /position/);
(async () => {
  node.positionMm = 0;
  await context.applySequenceStep(saved);
  const initialFrames = [...frames.values()]; frames.clear(); initialFrames.forEach(fn => fn(3000));
  assert.equal(node.positionMm, 123.4, 'Recorded fractional mm restored');
  await context.applySequenceStep({ angles: [], servoStates: [], durationMs: 1000 });
  assert.equal(node.positionMm, 123.4, 'Legacy servo-only steps leave rail unchanged');
  node.positionMm = 0;
  await context.applySequenceStep(saved, true, 2);
  assert.equal(frames.size, 1, 'Startup movement is animated');
  const ends = vm.runInContext('componentPanels.motionEnds()', context);
  assert(Math.abs(ends[0] - 123.4 / 75 * 1000 / 2) < 1e-8, 'Playback rate scales rail duration');
  vm.runInContext('componentPanels.stopSequence()', context);
  assert.equal(frames.size, 0, 'Stop cancels pending rail motion');
  context.requestServoBatch = async () => { context.sequenceRunId++; };
  await context.applySequenceStep(saved, true);
  assert.equal(frames.size, 0, 'An in-flight servo batch cannot restart stopped rail motion');
  console.log('Rail sequencer passed: capture/save round trip, fractional mm playback, legacy steps, validation, timing and Stop cancellation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
