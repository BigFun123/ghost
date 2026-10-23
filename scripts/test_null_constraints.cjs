const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../data/app.js'), 'utf8');
const all = node => [node, ...(node.children || []).flatMap(all)];
const element = (tag, cls, text) => ({ tag, className: cls, textContent: text, children: [], events: {},
  append(...children) { this.children.push(...children); }, addEventListener(event, fn) { this.events[event] = fn; },
  setAttribute(name, value) { this[name] = value; } });
const messages = [];
const context = { makeElement: element, previewPhysics: null, previewPhysicsEnabled: false,
  setText(id, value) { messages.push(value); }, drawServoPreview() {} };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function renderNullConstraints('), source.indexOf('function initializePreviewPlacementControls(')), context);
const node = {}, host = element('div');
context.renderNullConstraints(node, host);
const inputs = all(host).filter(x => x.tag === 'input');
assert.equal(inputs.filter(x => x.type === 'checkbox').length, 6);
assert.equal(inputs.filter(x => x.type === 'number').length, 6);
const [enabled, min, max] = inputs.slice(3, 6);
assert.equal(min.disabled, true);
enabled.checked = true; enabled.events.change();
assert.equal(node.constraints.y.enabled, true); assert.equal(min.disabled, false);
min.value = '-10'; max.value = '10'; min.events.change();
assert.equal(node.constraints.y.min, -10); assert.equal(node.constraints.y.max, 10);
min.value = '20'; min.events.change();
assert.equal(node.constraints.y.min, -10);
assert(messages.at(-1).includes('minimum'));
enabled.checked = false; enabled.events.change(); assert.equal(node.constraints.y.enabled, false);
const rotations = inputs.filter(input => input.type === 'checkbox').slice(3);
rotations[0].checked = true; rotations[0].events.change();
rotations[2].checked = true; rotations[2].events.change();
assert.equal(node.rotationConstraints.x, true); assert.equal(node.rotationConstraints.z, true);
console.log('Null constraint UI passed: three axis toggles, bounds, invalid-range rejection and release.');
