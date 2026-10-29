const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('data/app.js', 'utf8');
const start = source.indexOf('    const control = {', source.indexOf('function initializeServoControls('));
const end = source.indexOf('\n    };', start) + '\n    };'.length;
const initialize = source.slice(start, end) + '\ncontrol;';
for (const initialMotionMode of [undefined, 'immediate', 'linear', 'smooth']) {
  const control = vm.runInNewContext(initialize, {
    configuration: { initialMotionMode }, channel: 1, ui: {}
  });
  assert.equal(control.smoothMode, true, 'Page/robot load starts in S mode even with saved ' + initialMotionMode);
  assert.equal(control.linearMode, false);
  assert.equal(control.outputEnabled, false, 'Startup mode does not enable outputs');
}
console.log('Mixer startup passed: S-curve for every saved initial mode, outputs remain off.');
