const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadComponentRegistry } = require('../devserver/component-registry');
const context = {};
const registry = loadComponentRegistry(context);
const before = registry.types().length;
assert(registry.resolve({ objectType: 'Servo' }), 'Legacy servo defaults to the standard model');
assert.equal(registry.resolve({ objectType: 'Servo', model: 'unknown' }), undefined);
assert(!registry.choices().some(definition => definition.objectType === 'Robot'));
let draws = 0, overlays = 0;
registry.register({ objectType: 'Example component', defaults: { finish: 'silver' },
  getPhysics() { return { real: true, massGrams: 10 }; },
  draw({ box }) { draws++; box([0, 0, 0], [10, 20, 30], '#aabbcc', false); },
  drawOverlay() { overlays++; } });
assert.equal(registry.types().length, before + 1);
assert.equal(registry.choice('Example component').defaults.finish, 'silver');
assert.throws(() => registry.register({ objectType: 'Example component', draw() {} }), /Duplicate/);
assert.throws(() => registry.draw({ objectType: 'Unknown' }, {}), /Unknown/);
const source = fs.readFileSync(path.join(__dirname, '../data/app.js'), 'utf8');
vm.runInContext(source.slice(source.indexOf('function servoCommandLimits('), source.indexOf('function prepareServoRequest(')), context);
vm.runInContext(source.slice(source.indexOf('function rotateServoPoint('), source.indexOf('function previewWorldPoint(')), context);
vm.runInContext(source.slice(source.indexOf('function collectPreviewPhysicsShapes('), source.indexOf('function collectPreviewPhysicsNodes(')), context);
vm.runInContext(source.slice(source.indexOf('function configurationWithRobot('), source.indexOf('function initializeServoPreview(')), context);
const servo = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/robots/Walker/config.json'))).components.find(c => c.objectType === 'Servo');
const config = { components: [{ ...servo, parent: null }, { name: 'Example', objectType: 'Example component', parent: null }] };
const nodes = context.createRobotNodes(config);
context.servoPreview = { nodes: [nodes[1]] };
const shapes = context.collectPreviewPhysicsShapes();
assert.equal(shapes.length, 1);
assert.deepEqual(Array.from(shapes[0].dimensions), [10, 20, 30]);
assert.equal(draws, 1, 'Physics uses the registered draw function');
registry.draw({ objectType: 'Example component' }, { box() {} });
assert.equal(draws, 2, 'Visible geometry uses the same draw function');
registry.drawOverlays({ nodes: [{ objectType: 'Example component' }] });
assert.equal(overlays, 1);
assert(!/drawESP32|drawTD7120|drawMicro9g|drawUBracket|drawVL53L0X|hardwareComponentModels/.test(source),
  'Main app has no component draw dispatch or model-function references');
console.log('Component registry passed: registration, dynamic choices/validation, legacy models, shared render/physics draw and custom overlays.');
