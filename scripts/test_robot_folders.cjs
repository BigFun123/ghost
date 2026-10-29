const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../devserver/server');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'robot-folders-'));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/robots/Walker/config.json')));
const servo = fixture.components.find(c => (c.objectType ?? 'Servo') === 'Servo');
const first = { ...fixture, camera: undefined, components: [{ ...servo, name: 'One', parent: null }] };
const second = { ...first, components: [...first.components, { ...servo, name: 'Two', channel: 15, parent: null }] };
const sequence = count => ({ loop: false, finish: false, steps: [{ angles: Array(count).fill(90), servoStates: Array(count).fill(48), durationMs: 1000 }] });
fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify(first));
fs.writeFileSync(path.join(directory, 'sequence_a.json'), JSON.stringify(sequence(2)));
const server = createServer(directory);

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (url, body) => fetch(base + url, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  assert.equal((await (await request('/api/robots')).json()).active, 'Robot');
  const missing = await request('/config.json?robot=PanTilt');
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /PanTilt.*no saved config/);
  assert.equal((await request('/api/robots')).status, 200, 'Server remains usable after missing config');
  assert.equal((await (await request('/api/sequence/a?robot=Robot')).json()).steps.length, 0,
    'Incompatible legacy sequence stays outside the migrated folder');
  assert.equal(fs.existsSync(path.join(directory, 'sequence_a.json')), true);
  const emptyRobot = { ...first, components: [{ name: 'Robot', objectType: 'Robot', parent: null,
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }] };
  assert.equal((await request('/api/config/local', { robot: 'Empty Robot', configuration: emptyRobot, originalNames: null })).status, 200);
  assert.deepEqual((await (await request('/config.json')).json()).components, emptyRobot.components);
  assert.equal((await request('/api/robot/select', { name: 'Robot' })).status, 200);
  assert.equal((await request('/api/sequence/a?robot=Robot', sequence(1))).status, 200);
  assert.equal((await request('/api/config/local', { robot: 'Walker', configuration: second, originalNames: null })).status, 200);
  assert.equal((await (await request('/api/robots')).json()).active, 'Walker');
  assert.equal((await (await request('/config.json')).json()).components.length, 2);
  assert.equal((await (await request('/api/sequence/a?robot=Walker')).json()).steps.length, 0);
  assert.equal((await request('/api/sequence/a?robot=Walker', sequence(2))).status, 200);
  assert.equal((await request('/api/sequence/b?robot=Robot', sequence(2))).status, 400,
    'Each robot validates against its own config');
  const legacy = sequence(1); legacy.steps[0].servoStates = [20];
  assert.equal((await request('/api/sequence/b?robot=Robot', legacy)).status, 200, 'Legacy smooth sequence states remain valid');
  const invalid = sequence(1); invalid.steps[0].servoStates = [36];
  assert.equal((await request('/api/sequence/b?robot=Robot', invalid)).status, 400, 'Reject conflicting smooth and linear bits');
  assert.equal((await request('/api/robot/select', { name: 'Robot' })).status, 200);
  assert.equal((await (await request('/config.json')).json()).components.length, 1);
  assert.equal((await (await request('/api/sequence/a')).json()).steps[0].angles.length, 1);
  assert.equal((await (await request('/api/sequence/a?robot=Walker')).json()).steps[0].angles.length, 2);
  assert.equal((await request('/api/config/local', { robot: 'Walker', configuration: first, originalNames: null })).status, 409);
  for (const name of ['../escape', 'CON', 'bad/name', 'Trailing ', 'a'.repeat(41)]) {
    assert.equal((await request('/api/config/local', { robot: name, configuration: first, originalNames: null })).status, 400);
  }
  assert.equal((await request('/api/robot/rename', { from: 'Walker', to: 'Walker Renamed' })).status, 200);
  assert.equal(fs.existsSync(path.join(directory, 'robots', 'Walker')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'robots', 'Walker Renamed', 'sequence_a.json'))).steps[0].angles.length, 2);
  assert.equal((await request('/api/robot/rename', { from: 'Walker Renamed', to: 'Robot' })).status, 400, 'Rename cannot overwrite another robot');
  assert.equal((await request('/api/robot/rename', { from: 'Robot', to: '../escape' })).status, 400);
  server.close();
  const restarted = createServer(directory);
  restarted.close();
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'robots.json'))).active, 'Robot');
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'robots', 'Walker Renamed', 'config.json'))).components.length, 2);
  console.log('Robot folders passed: migration, isolation across different servo counts, selection/restart, duplicate names, path validation.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  server.close();
  const removeTestDirectory = folder => {
    assert(path.resolve(folder).startsWith(path.resolve(directory) + path.sep) || path.resolve(folder) === path.resolve(directory));
    for (const name of fs.readdirSync(folder)) {
      const file = path.join(folder, name);
      if (fs.statSync(file).isDirectory()) removeTestDirectory(file);
      else fs.unlinkSync(file);
    }
    fs.rmdirSync(folder);
  };
  removeTestDirectory(directory);
});
