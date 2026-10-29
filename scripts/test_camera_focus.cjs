const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('data/app.js', 'utf8');
let frames = new Map(), nextFrame = 1, saves = 0;
const nodes = [{ world: [100, 20, -40] }, { world: [-30, 80, 60] }];
const context = {
  servoPreview: { nodes, selected: 0, panX: 0, panY: 0, panZ: 0, yaw: .6, pitch: .4, zoom: 2 },
  performance: { now: () => 0 },
  previewWorldPoint: (list, index) => [...list[index].world],
  requestAnimationFrame: callback => { const id = nextFrame++; frames.set(id, callback); return id; },
  cancelAnimationFrame: id => frames.delete(id),
  savePreviewCamera: () => saves++, drawServoPreview() {}
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function cancelPreviewCameraFocus('), source.indexOf('function panPreviewFloor(')), context);
const view = context.servoPreview;
const position = () => [view.panX, view.panY, view.panZ];
context.updatePreviewCameraFocus(0);
assert.deepEqual(position(), [0, 0, 0]);
context.updatePreviewCameraFocus(175);
assert.deepEqual(position(), [50, 10, -20]);
assert.equal(frames.size, 1);
view.selected = 1;
context.updatePreviewCameraFocus(175);
assert.deepEqual(position(), [50, 10, -20]);
context.updatePreviewCameraFocus(525);
assert.deepEqual(position(), nodes[1].world);
assert.equal(frames.size, 0);
assert.equal(saves, 1);
assert.deepEqual([view.yaw, view.pitch, view.zoom], [.6, .4, 2]);
view.panX += 10;
context.updatePreviewCameraFocus(600);
assert.equal(view.panX, -20, 'same selection preserves manual pan');
nodes[1].world = [40, 60, 80];
context.cancelPreviewCameraFocus(true);
assert.deepEqual(position(), nodes[1].world, 'orbit uses current world position');
view.selected = 0;
context.updatePreviewCameraFocus(700);
view.selected = 'add';
context.updatePreviewCameraFocus(750);
assert.equal(frames.size, 0, 'non-component selection cancels animation');
assert.equal(view.focusTransition, null);
assert.ok(source.includes('cancelPreviewCameraFocus(event.button === 0)'));
context.updatePreviewProjectionButton = () => {};
view.selected = null;
view.yaw = Math.PI * 1.9;
view.panX = 0;
context.animatePreviewCamera({ yaw: 0, panX: 100, zoom: 3, perspective: true });
assert.equal(view.panX, 0, 'Preset does not snap');
context.updatePreviewCameraFocus(175);
assert.equal(view.panX, 50);
assert(Math.abs(view.yaw - Math.PI * 1.95) < 1e-10, 'Yaw takes shortest path across wrap');
assert.equal(view.zoom, 2.5);
context.animatePreviewCamera({ panX: -50 });
assert.equal(view.panX, 50, 'A new button starts from the displayed position');
context.updatePreviewCameraFocus(350);
assert.equal(view.panX, -50);
assert.equal(view.viewTransition, null);
assert.equal(frames.size, 0);
context.animatePreviewCamera({ yaw: 0, perspective: true });
context.updatePreviewCameraFocus(350);
assert.equal(view.yaw, 0);
assert.equal(view.perspective, true);
context.animatePreviewCamera({ panX: 100 });
context.updatePreviewCameraFocus(175);
const interrupted = view.panX;
context.cancelPreviewCameraFocus();
context.updatePreviewCameraFocus(350);
assert.equal(view.panX, interrupted, 'Manual cancellation retains displayed pose');
console.log('Camera focus passed: easing, rapid selection, world pivot, pan, cancellation and unchanged angle/zoom.');
