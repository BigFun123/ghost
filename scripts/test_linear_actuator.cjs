const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { loadComponentRegistry } = require('../devserver/component-registry');
const { validateConfiguration } = require('../devserver/server');
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.value = ''; }
  append(...children) { this.children.push(...children); }
  setAttribute() {}
  addEventListener(event, handler) { this[event] = handler; }
}
const context = { document: { createElement: tag => new Element(tag) } };
vm.createContext(context);
const registry = loadComponentRegistry(context), type = 'Stepper Linear Actuator';
const definition = registry.choice(type);
assert.equal(definition.defaults.lengthMm, 300);
const node = { name: 'Rail', objectType: type, ...definition.defaults };
let changes = 0;
const panel = definition.createPanel({ node, change() { changes++; } });
assert.equal(panel.control.mode, 'smooth', 'Rail starts in S-curve mode');
panel.control.mode = 'immediate';
panel.update({ node });
panel.setPower(true);
panel.update({ node });
const settingsHost = new Element('div');
definition.renderSettings({ node, host: settingsHost, editing: true, change() { changes++; } });
const length = settingsHost.children[0].children[1].children[0];
const slider = panel.element.children[2].children[0].children[0];
const output = panel.element.children[2].children[1];
assert.equal(slider.max, 300);
slider.value = '240.5'; slider.input(); panel.update({ node });
assert.equal(node.positionMm, 240.5); assert.equal(output.textContent, '240.5 mm');
length.value = '100'; length.change(); panel.update({ node });
assert.equal(node.positionMm, 100); assert.equal(slider.max, 100);
length.value = '0'; length.change(); assert.equal(node.lengthMm, 100);
slider.value = '-5'; slider.input(); assert.equal(node.positionMm, 0);
const boxes = [];
registry.draw(node, { box(offset, dimensions) { boxes.push({ offset, dimensions }); }, label() {} });
assert(boxes.some(box => box.dimensions[0] === 42 && box.offset[0] < 0), 'Attached motor geometry');
const body = boxes.find(box => box.dimensions[0] === 40);
assert.equal(body.offset[0], 0);
node.positionMm = 50;
const moved = [];
registry.draw(node, { box(offset, dimensions) { if (dimensions[0] === 40) moved.push(offset); }, label() {} });
assert.equal(moved[0][0], 50);
assert(!registry.hasCapability(node, 'actuator'), 'Linear mixer does not consume servo channels');
const config = JSON.parse(fs.readFileSync('data/robots/Walker/config.json', 'utf8'));
config.components.push({ ...node, parent: null });
validateConfiguration(config);
const source = fs.readFileSync('data/app.js', 'utf8');
vm.runInContext(source.slice(source.indexOf('function configurationWithRobot('), source.indexOf('function initializeServoPreview(')), context);
const reloaded = context.createRobotNodes(config).at(-1);
assert.equal(reloaded.lengthMm, 100); assert.equal(reloaded.positionMm, 50);
Object.assign(context, { servoPreview: { configuration: config, nodes: context.createRobotNodes(config) },
  webcamStream: null, webcamVideo: { hidden: true, style: {} }, selectedWebcamDevice: '', savedWebcamControls: {} });
vm.runInContext(source.slice(source.indexOf('function previewConfigurationSnapshot('), source.indexOf('function updateRobotFolderControls(')), context);
context.servoPreview.nodes.at(-1).lengthMm = 450;
context.servoPreview.nodes.at(-1).positionMm = 123.4;
const snapshot = context.previewConfigurationSnapshot();
assert.equal(snapshot.components.at(-1).lengthMm, 450);
assert.equal(snapshot.components.at(-1).positionMm, 123.4);
assert.equal(context.createRobotNodes(snapshot).at(-1).positionMm, 123.4);
config.components.at(-1).positionMm = 101;
assert.throws(() => validateConfiguration(config), /travel/);
assert.throws(() => context.createRobotNodes(config), /travel/);
assert(changes >= 3);
vm.runInContext(source.slice(source.indexOf('function rotateServoPoint('), source.indexOf('function drawPreviewConstraintGuides(')), context);
vm.runInContext(source.slice(source.indexOf('function collectPreviewPhysicsNodes('), source.indexOf('function syncPreviewPhysics(')), context);
const nodes = [
  { ...node, parent: null, positionMm: 0, position: [10, 100, 20], rotation: [0, 0, 0] },
  { objectType: 'Box 50 mm', parent: 1, position: [5, 25, 0], rotation: [0, 0, 0] },
  { objectType: 'Target', parent: 2, position: [0, 0, 10], rotation: [0, 0, 0] }
];
context.servoPreview = { nodes };
const point = index => Array.from(context.servoWorldPoint(nodes, index, [0, 0, 0]));
assert.deepEqual(point(1), [15, 152.5, 20], 'Child offset is relative to carriage top');
nodes[0].positionMm = 80;
assert.deepEqual(point(1), [95, 152.5, 20]);
assert.deepEqual(point(2), [95, 152.5, 30], 'Descendants follow carriage once');
let physics = context.collectPreviewPhysicsNodes();
assert.deepEqual(Array.from(physics[1].body.center), point(1), 'Physics starts at the same moving mount');
assert.equal(physics[1].parentSide, 'body');
nodes[0].rotation = [0, 90, 0];
const rotated = point(1);
assert(Math.abs(rotated[0] - 10) < 1e-8 && Math.abs(rotated[2] + 65) < 1e-8, 'Travel follows the rotated rail axis');
context.previewPhysicsEnabled = true;
context.previewPhysics = { point(index, local) {
  return context.servoWorldPoint(nodes, index, local);
} };
assert.deepEqual(Array.from(context.previewWorldPoint(nodes, 2, [0, 0, 0])), point(2), 'Virtual descendant follows physics placement');
let frames = new Map(), nextFrame = 1, soloActive = false;
context.performance = { now: () => 0 };
context.requestAnimationFrame = fn => { const id = nextFrame++; frames.set(id, fn); return id; };
context.cancelAnimationFrame = id => frames.delete(id);
const controlled = { name: 'Controlled rail', objectType: type, lengthMm: 300, positionMm: 100 };
const controlsPanel = definition.createPanel({ node: controlled, change() {}, mixer: { hasSolo: () => soloActive, changed() {} } });
assert.equal(controlsPanel.control.mode, 'smooth');
controlsPanel.control.mode = 'immediate';
const controlsSlider = controlsPanel.element.children[2].children[0].children[0];
const clear = controlsPanel.element.children[3];
const [mute, solo, mode, speed, reverse, power] = controlsPanel.element.children[4].children;
const update = () => controlsPanel.update({ node: controlled });
update(); assert.equal(controlsSlider.disabled, false, 'Starts powered on');
power.click(); update(); assert.equal(controlsSlider.disabled, true);
controlsSlider.value = '200'; controlsSlider.input(); assert.equal(controlled.positionMm, 100);
power.click(); update(); assert.equal(controlsSlider.disabled, false);
clear.click(); assert.equal(controlled.positionMm, 0, 'C clears to zero');
reverse.click(); assert.equal(controlsPanel.control.reversed, true);
mute.click(); update(); assert.equal(controlsSlider.disabled, true);
mute.click(); soloActive = true; update(); assert.equal(controlsSlider.disabled, true, 'Other solo suppresses this strip');
solo.click(); update(); assert.equal(controlsSlider.disabled, false, 'Solo strip remains eligible');
soloActive = false;
mode.click(); assert.equal(controlsPanel.control.mode, 'smooth');
mode.click(); assert.equal(controlsPanel.control.mode, 'linear');
controlsSlider.value = '150'; controlsSlider.input();
const advance = time => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(time)); };
advance(1000); assert.equal(controlled.positionMm, 75, 'Medium linear mode is 75 mm/s');
power.click(); update(); assert.equal(frames.size, 0, 'Power off cancels queued animation');
advance(2000); assert.equal(controlled.positionMm, 75, 'Cancelled motion cannot resume');
power.click(); controlsSlider.value = '150'; controlsSlider.input();
mute.click(); assert.equal(frames.size, 0, 'Mute cancels queued animation');
mute.click(); speed.click(); assert.equal(controlsPanel.control.speed, 'H');
controlsSlider.value = '200'; controlsSlider.input(); controlsPanel.dispose();
assert.equal(frames.size, 0, 'Removing panel cancels pending motion');
controlsPanel.resetMotionMode();
assert.equal(controlsPanel.control.mode, 'smooth', 'Sequencer Clear restores S-curve');
console.log('Linear actuator passed: defaults, mm controls, bounds, carriage/motor geometry, no servo channel, validation and reload.');
