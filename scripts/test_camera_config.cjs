const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../data/app.js'), 'utf8');
const view = { yaw: 0.5, pitch: 0.2, roll: 0.1, zoom: 1.7, panX: 10, panY: 20, panZ: 30, perspective: true, showGrid: false };
const original = { components: [{ name: 'Servo', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }] };
const context = {
  servoPreview: { ...view, configuration: original, nodes: [{ name: 'Servo', parent: null, position: [0, 0, 0], rotation: [0, 0, 0] }] },
  webcamStream: null, selectedWebcamDevice: 'selected-camera', savedWebcamControls: { zoom: 2, focusMode: 'continuous' },
  webcamVideo: { style: { objectFit: 'contain', transform: 'scaleX(-1)' } },
  localStorage: { getItem: () => JSON.stringify({ ...view, yaw: -1 }), setItem() {} },
  clampPreviewPitch: pitch => Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch))
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function loadPreviewCamera('), source.indexOf('function initializeServoPreview(')), context);
vm.runInContext(source.slice(source.indexOf('function previewConfigurationSnapshot('), source.indexOf('function downloadPreviewConfiguration(')), context);
const saved = context.previewConfigurationSnapshot();
assert.deepEqual(JSON.parse(JSON.stringify(saved.camera)), { ...view, views: {}, webcam: { active: false, deviceId: 'selected-camera', fit: 'contain', mirror: true, controls: { zoom: 2, focusMode: 'continuous' } } });
assert.equal(original.camera, undefined);
context.webcamStream = { getVideoTracks: () => [] };
context.webcamVideo.hidden = false;
assert.equal(context.previewConfigurationSnapshot().camera.webcam.active, true);
context.webcamVideo.hidden = true;
assert.equal(context.previewConfigurationSnapshot().camera.webcam.active, false);
assert.equal(context.loadPreviewCamera(saved).yaw, view.yaw);
assert.equal(context.loadPreviewCamera({}).yaw, -1);
assert.equal(context.loadPreviewCamera(saved).roll, view.roll);
assert.equal(context.loadPreviewCamera(saved).showGrid, false);
assert.equal(context.loadPreviewCamera({}).showGrid, false);
console.log('Camera config passed: view and webcam snapshot, saved config takes priority over browser cache, legacy config fallback.');
