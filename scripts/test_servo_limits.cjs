const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('data/app.js', 'utf8');
const context = { sequencePlaying: false };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function servoCommandLimits('), source.indexOf('async function performServoRequest(')), context);
const servo = { minAngle: 30, maxAngle: 120, outputEnabled: true };
for (const [angle, expected] of [[0,30],[180,120],[90,90]]) {
 assert.equal(context.clampServoCommand(servo, angle), expected);
 assert.equal(context.prepareServoRequest(servo, {angle: String(angle)}).angle, String(expected));
}
assert.equal(context.prepareServoRequest({...servo,outputEnabled:false},{angle:'90'}).angle, undefined);
assert.equal(context.clampServoCommand({...servo,continuous:true},90),90);
assert.equal(context.clampServoCommand({...servo,continuous:true},180),180);
assert.equal(context.clampServoCommand({minAngle:75,maxAngle:75},0),75);
assert.equal(context.clampServoCommand({maxAngle:270},250),180);
assert.throws(()=>context.clampServoCommand({minAngle:130,maxAngle:120},90));
console.log('Servo limits passed: lower/upper bounds, queued command preparation, output-off, continuous neutral, fixed angle and legacy wide ranges.');
