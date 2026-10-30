const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('data/app.js', 'utf8');
const html = fs.readFileSync('data/index.html', 'utf8');
const button = { attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }, addEventListener(event, fn) { this[event] = fn; } };
const reboot = {};
let refreshes = 0, stops = 0;
const control = { timer: null, pendingCommand: { angle: 180 }, commandedMotion: {} };
const context = { document: { getElementById: id => id === 'previewOffline' ? button : reboot },
  offlineSimulation: false, controllerRebooting: false, sensorTelemetry: {}, commandModeRevision: 0,
  servoControls: [control], servoPreview: null, clearTimeout, GhostLearning: { stopEnvironment() { stops++; } },
  setText() {}, stopSweep() {}, stopSequence() {}, updateServoPositionTrail() {}, syncServoPower() {},
  syncMasterPower() {}, setServoPlaybackLock() {}, updateSequencerControls() {}, drawServoPreview() {}, refresh() { refreshes++; } };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('document.getElementById("previewOffline").addEventListener("click"'), source.indexOf('function simulateServoRequest(')), context);
button.click();
assert.equal(context.offlineSimulation, true);
assert.equal(button.attrs['aria-pressed'], 'true');
assert.equal(control.pendingCommand, null);
assert.equal(control.commandedMotion, null);
assert.equal(context.sensorTelemetry, null);
assert.equal(context.commandModeRevision, 1);
assert.equal(refreshes, 0);
button.click();
assert.equal(context.offlineSimulation, false);
assert.equal(button.attrs['aria-pressed'], 'false');
assert.equal(context.commandModeRevision, 2);
assert.equal(refreshes, 1);
assert.equal(stops, 2);
context.setOfflineSimulation(false);
assert.equal(context.commandModeRevision, 2, 'same-mode sync does not restart commands');
const header = html.slice(html.indexOf('<header class="app-header">'), html.indexOf('</header>'));
assert.match(header, /<button id="previewOffline"[^>]*aria-pressed="false"/);
assert.equal((html.match(/id="previewOffline"/g) || []).length, 1);
console.log('Offline header toggle passed: placement, pressed state, both transitions and pending motion cancellation.');
