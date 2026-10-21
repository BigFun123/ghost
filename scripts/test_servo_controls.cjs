const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function element() {
  return {
    children: [], attributes: {}, value: '0', disabled: false,
    classList: { toggle() {} },
    append(...items) { this.children.push(...items); },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener() {}, querySelector() { return element(); },
    querySelectorAll() { return []; },
    get firstElementChild() { return this.children[0]; },
    get lastElementChild() { return this.children.at(-1); }
  };
}
const elements = new Map();
const context = vm.createContext({
  console, URLSearchParams, setTimeout, clearTimeout,
  document: {
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    querySelector: element, createElement: element,
    createTextNode(text) { return { textContent: text }; }
  }
});
const source = fs.readFileSync(require('node:path').join(__dirname, '../data/app.js'), 'utf8');
vm.runInContext(source.replace(/start\(\);\s*$/, ''), context);
vm.runInContext('initializeServoControls([{name:"One"}, {name:"Two"}, {name:"Three"}]); servoControls.forEach(c => c.ready = true);', context);
const controls = vm.runInContext('servoControls', context);
const evaluate = code => vm.runInContext(code, context);
const requests = [];
let release;
context.fetch = async (url, options) => {
  const command = Object.fromEntries(options.body);
  requests.push(command);
  if (requests.length === 1) await new Promise(resolve => { release = resolve; });
  return { ok: true, text: async () => 'OK' };
};

(async () => {
  const c = controls[2];
  c.slider.value = '37';
  evaluate('servoControls[2].reversed = true; syncReverse(servoControls[2]);');
  assert.equal(c.scale.firstElementChild.textContent, '0°');
  assert.equal(c.scale.lastElementChild.textContent, '180°');
  assert.equal(c.slider.value, '37');
  assert.equal(evaluate('captureSequenceStep(1000).angles[2]'), 37);
  assert.equal(requests.length, 0, 'Reversing must not move the servo');

  const first = evaluate('requestServo(servoControls[2], {angle:"80"})');
  await Promise.resolve();
  assert.equal(requests.length, 1);
  evaluate('servoControls[2].pendingCommand = {angle:"140"};');
  const off = evaluate('setServoPower(servoControls[2], false)');
  const later = evaluate('requestServo(servoControls[2], {angle:"180"})');
  assert.equal(c.pendingCommand, null);
  assert.equal(evaluate('isEligible(servoControls[2])'), false);
  assert.equal(requests.length, 1, 'Power-off must wait for the in-flight command');
  release();
  await Promise.all([first, off, later]);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].outputEnabled, '0');
  assert.equal(requests[1].channel, '3');
  assert.equal(controls[0].outputEnabled, true);
  assert.equal(controls[1].outputEnabled, true);

  const step = { angles: [20,30,40], servoStates: [12,12,12], durationMs: 1000 };
  context.step = step;
  await evaluate('applySequenceStep(step)');
  const offServoCommands = requests.filter(r => r.channel === '3').slice(2);
  assert(offServoCommands.every(r => r.angle === undefined && r.outputEnabled !== '1'));
  await evaluate('setServoPower(servoControls[2], true)');
  await evaluate('sendAngle(servoControls[2], 60)');
  assert.equal(requests.at(-2).outputEnabled, '1');
  assert.equal(requests.at(-1).angle, '60');
  assert.equal(c.outputEnabled, true);
  context.fetch = async () => ({ ok: false, status: 500, text: async () => 'Failure' });
  await evaluate('setServoPower(servoControls[2], false)');
  assert.equal(c.outputEnabled, true, 'Failed power requests must restore displayed state');
  assert.equal(c.powerPending, false);
  console.log('PASS: reversed scale, sequence angle preservation, serialized power-off, queued/in-flight motion, per-servo isolation, playback while off, power-on, and failure recovery.');
})().catch(error => { console.error(error); process.exitCode = 1; });
