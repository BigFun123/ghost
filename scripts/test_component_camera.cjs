const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadComponentRegistry } = require('../devserver/component-registry');
const { validateConfiguration } = require('../devserver/server');
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.classList = { toggle() {} }; }
  addEventListener(event, handler) { this[event] = handler; }
  append(...children) { children.forEach(child => { child.parent = this; this.children.push(child); }); }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector(tag) { return this.children.find(child => child.tag === tag); }
  getContext() { return { drawImage() {} }; }
}
const mixer = new Element('div'), sceneHost = new Element('div');
const context = { document: { createElement: tag => new Element(tag), querySelector: () => mixer, getElementById: () => sceneHost } };
vm.createContext(context);
const registry = loadComponentRegistry(context);
for (const file of ['data/3d-renderer.js', 'data/camera-renderer.js', 'data/component-panels.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
const app = fs.readFileSync('data/app.js', 'utf8');
vm.runInContext(app.slice(app.indexOf('function rotateServoPoint('), app.indexOf('function previewWorldPoint(')), context);
const type = 'OV7670 VGA Camera Module';
assert(registry.choice(type));
const config = JSON.parse(fs.readFileSync('data/robots/Walker/config.json', 'utf8'));
config.components.push({ name: 'Camera', objectType: type, parent: null, position: { x: 0, y: 100, z: 0 }, rotation: { x: 0, y: 0, z: 0 } });
validateConfiguration(config);
const nodes = [{ name: 'Camera', objectType: type, parent: null, position: [0, 100, 0], rotation: [0, 0, 0] }];
const camera = registry.resolve(nodes[0]).getCamera();
const square = (z, color = '#ff0000', index = 1) => ({ index, color, vertices: [[-10, 90, z], [10, 90, z], [10, 110, z], [-10, 110, z]] });
const scene = { nodes, index: 0, surfaces: [square(112)], worldPoint: context.servoWorldPoint };
let faces = context.componentCameraFaces(camera, scene, 240, 180);
assert.equal(faces.length, 1);
const points = faces[0].points;
assert(points[0][0] < 120 && points[1][0] > 120);
assert(points[0][1] > 90 && points[2][1] < 90, 'Image up follows local +Y');
assert.equal(context.componentCameraFaces(camera, { ...scene, surfaces: [square(-100), square(112, '#ffffff', 0)] }, 240, 180).length, 0, 'Behind-lens and own-body faces excluded');
const crossing = { index: 1, vertices: [[-10, 90, 10], [10, 90, 30], [10, 110, 30], [-10, 110, 10]] };
context.componentCameraFaces(camera, { ...scene, surfaces: [crossing] }, 240, 180).forEach(face => face.points.forEach(point => assert(point.every(Number.isFinite))));
nodes[0].rotation[1] = 180;
assert.equal(context.componentCameraFaces(camera, scene, 240, 180).length, 0, 'Camera rotation changes view');
nodes[0].rotation[1] = 0;
const image = { data: new Uint8ClampedArray(240 * 180 * 4) };
const ctx = { getImageData: () => image, putImageData() {} };
faces = context.componentCameraFaces(camera, { ...scene, surfaces: [square(62, '#00ff00'), square(112)] }, 240, 180);
context.renderPreviewFaces(ctx, faces, 240, 180, 1);
const pixel = (90 * 240 + 120) * 4;
assert.deepEqual(Array.from(image.data.slice(pixel, pixel + 3)), [0, 255, 0], 'Near face occludes farther face regardless of draw order');
let renders = 0;
context.renderComponentCamera = () => { renders++; };
const update = () => vm.runInContext('componentPanels.update(sceneContext)', context);
context.sceneContext = scene;
update(); update();
assert.equal(mixer.children.length, 1); assert.equal(sceneHost.children.length, 1);
assert.equal(renders, 2, 'Render once per camera per update, share frame with inset');
nodes[0].name = 'Renamed camera'; update();
assert.equal(mixer.children[0].querySelector('h2').textContent, 'OV7670');
assert.equal(mixer.children[0].querySelector('span').textContent, 'camera');
assert.equal(mixer.children[0].querySelector('h2').title, 'Renamed camera');
assert.equal(sceneHost.children[0].querySelector('h2').textContent, 'Renamed camera');
const cameraPanel = mixer.children[0];
const eye = cameraPanel.children.find(child => child.className === 'mix-button servo-power camera-power');
const settings = cameraPanel.children.find(child => child.className === 'servo-settings-button');
let opened;
scene.openSettings = node => { opened = node; };
update(); settings.click(); assert.equal(opened, nodes[0], 'Config opens the correct camera setup');
const renderedBeforeHide = renders;
eye.click(); update();
assert.equal(eye.attributes['aria-expanded'], 'false');
assert.equal(cameraPanel.querySelector('canvas').hidden, true);
assert.equal(sceneHost.children[0].hidden, true, 'Closing eye hides the scene inset too');
assert.equal(renders, renderedBeforeHide, 'Hidden cameras skip rendering');
eye.click(); update();
assert.equal(eye.attributes['aria-expanded'], 'true');
assert.equal(cameraPanel.querySelector('canvas').hidden, false);
assert.equal(sceneHost.children[0].hidden, false);
nodes.push({ ...nodes[0], name: 'Second camera' }); update();
assert.equal(mixer.children.length, 2);
nodes.splice(0, 1); update(); assert.equal(mixer.children.length, 1);
nodes.length = 0; update(); assert.equal(mixer.children.length, 0); assert.equal(sceneHost.children.length, 0);
console.log('Component camera passed: registration/config, projection, lens clipping, orientation, depth occlusion, multiple panels, rename and cleanup.');
