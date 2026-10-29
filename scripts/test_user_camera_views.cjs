const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../data/app.js'), 'utf8');
const buttons = ['u1', 'u2', 'u3'].map(slot => ({ dataset: { userView: slot }, attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }, addEventListener(event, fn) { this.click = fn; } }));
const view = { yaw: 1, pitch: 0.2, roll: 0.3, zoom: 2, panX: 10, panY: 20, panZ: 30, perspective: true };
const messages = [];
const context = {
  servoPreview: { ...view, nodes: [], selected: null, showGrid: false },
  performance: { now: () => 0 }, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
  document: { querySelectorAll: () => buttons, getElementById: () => ({ disabled: false }) },
  updatePreviewProjectionButton() {}, savePreviewCamera() {}, drawServoPreview() { context.updateUserCameraButtons(); }, setText(id, value) { messages.push(value); }
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function cancelPreviewCameraFocus('), source.indexOf('function panPreviewFloor(')), context);
vm.runInContext(source.slice(source.indexOf('function currentUserCameraView('), source.indexOf('function initializeServoPreview(')), context);
context.initializeUserCameraViews({ camera: { views: { u2: view } } });
context.servoPreview.zoom = 1;
buttons[1].click({ shiftKey: false });
assert.equal(context.servoPreview.zoom, 1, 'Recall begins at the current view');
context.updatePreviewCameraFocus(350);
context.updateUserCameraButtons();
for (const key of Object.keys(view)) assert.equal(context.servoPreview[key], view[key]);
assert.equal(buttons[1].attrs['aria-pressed'], 'true');
assert.equal(context.servoPreview.showGrid, false);
context.servoPreview.panY = 99;
buttons[2].click({ shiftKey: true });
assert.equal(context.servoPreview.userViews.u3.panY, 99);
context.servoPreview.panY = 0;
buttons[2].click({ shiftKey: false });
context.updatePreviewCameraFocus(350);
assert.equal(context.servoPreview.panY, 99);
buttons[0].click({ shiftKey: false });
assert(messages.at(-1).includes('no saved view'));
const persisted = JSON.parse(JSON.stringify({ camera: { views: context.servoPreview.userViews } }));
context.initializeUserCameraViews(persisted);
assert.equal(context.servoPreview.userViews.u3.panY, 99);
console.log('User camera views passed: U2 recall, Shift-click storage, U3 recall, active indicator, empty slot and config reload.');
