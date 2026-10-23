const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const path = require('node:path');
const { createServer } = require('./server');

test('serves local assets and saves only valid same-origin config requests', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lamp-devserver-'));
  const configuration = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/config.json'), 'utf8'));
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify(configuration));
  fs.writeFileSync(path.join(directory, 'index.html'), '<h1>Local setup</h1>');
  const server = createServer(directory);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (value, headers = {}) => fetch(base + '/api/config/local', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value)
  });
  try {
    assert.equal(server.address().address, '127.0.0.1');
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await (await fetch(base + '/api/devserver')).json()).localConfigServer, true);
    assert.equal((await fetch(base + '/api/servo', { method: 'POST' })).status, 404);
    const originalNames = configuration.components.map(component => component.name);
    configuration.components.push({ name: 'Null local test', objectType: 'Null', parent: null, position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 } });
    const patch = { configuration, originalNames };
    assert.equal((await post(patch, { Origin: 'https://example.com' })).status, 403);
    const badHostStatus = await new Promise((resolve, reject) => {
      const request = http.get(base + '/api/devserver', { headers: { Host: 'example.com' } }, response => {
        response.resume(); resolve(response.statusCode);
      });
      request.on('error', reject);
    });
    assert.equal(badHostStatus, 403);
    assert.equal((await post(patch)).status, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8')), configuration);
    assert(!fs.existsSync(path.join(directory, 'config.json.tmp')));
    assert.equal((await post(patch)).status, 409);
    const saved = fs.readFileSync(path.join(directory, 'config.json'), 'utf8');
    patch.originalNames = configuration.components.map(component => component.name);
    configuration.components.at(-1).parent = 'Null local test';
    assert.equal((await post(patch)).status, 400);
    assert.equal(fs.readFileSync(path.join(directory, 'config.json'), 'utf8'), saved);
    assert.equal((await fetch(base + '/%2e%2e%2finclude/WifiCredentials.h')).status, 404);
    assert.equal((await fetch(base + '/api/config/local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
    assert.equal((await fetch(base + '/api/config/local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(65537) })).status, 413);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('persists local sequences, reloads them, and rejects invalid updates', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lamp-sequence-'));
  const configuration = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/config.json'), 'utf8'));
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify(configuration));
  const count = configuration.components.filter(component => (component.objectType ?? 'Servo') === 'Servo').length;
  let server;
  async function open() {
    server = createServer(directory);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return 'http://127.0.0.1:' + server.address().port + '/api/sequence';
  }
  const post = (url, sequence, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(sequence) });
  try {
    let url = await open();
    assert.deepEqual(await (await fetch(url)).json(), { loop: false, steps: [] });
    const sequence = { loop: true, finish: true, steps: [30, 90].map(angle => ({ angles: Array(count).fill(angle), servoStates: Array(count).fill(16), durationMs: 1000 })) };
    assert.equal((await post(url, sequence, { Origin: 'https://example.com' })).status, 403);
    assert.equal((await post(url, sequence)).status, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'sequence.json'), 'utf8')), sequence);
    await new Promise(resolve => server.close(resolve));
    url = await open();
    assert.deepEqual(await (await fetch(url)).json(), sequence);
    const before = fs.readFileSync(path.join(directory, 'sequence.json'), 'utf8');
    for (const invalid of [
      { loop: false, finish: "yes", steps: [] },
      { loop: false, steps: [{ angles: [], durationMs: 1000 }] },
      { loop: false, steps: [{ angles: Array(count).fill(181), durationMs: 1000 }] },
      { loop: false, steps: [{ angles: Array(count).fill(90), durationMs: 1 }] },
      { loop: false, steps: [{ angles: Array(count).fill(90), servoStates: Array(count).fill(24), durationMs: 1000 }] }
    ]) assert.equal((await post(url, invalid)).status, 400);
    assert.equal(fs.readFileSync(path.join(directory, 'sequence.json'), 'utf8'), before);
    sequence.steps.reverse();
    assert.equal((await post(url, sequence)).status, 200);
    assert.deepEqual(await (await fetch(url)).json(), sequence);
    assert.equal((await post(url, { loop: false, steps: [] })).status, 200);
    assert.deepEqual(await (await fetch(url)).json(), { loop: false, steps: [] });
    assert(!fs.existsSync(path.join(directory, 'sequence.json.tmp')));
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


test('sequence slots stay isolated and preserve robot configuration and legacy sequence', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lamp-slots-'));
  const config = fs.readFileSync(path.resolve(__dirname, '../data/config.json'), 'utf8');
  const legacy = { loop: true, steps: [] };
  fs.writeFileSync(path.join(directory, 'config.json'), config);
  fs.writeFileSync(path.join(directory, 'sequence.json'), JSON.stringify(legacy));
  const server = createServer(directory);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/sequence/';
  try {
    assert.deepEqual(await (await fetch(base + 'a')).json(), legacy);
    for (const slot of 'abcdefghij') {
      const saved = { loop: slot === 'b', finish: slot === 'j', steps: slot === 'j' ? [{ type: 'sequence', slot: 'b' }] : [] };
      const response = await fetch(base + slot, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saved) });
      assert.equal(response.status, 200);
      assert.deepEqual(await (await fetch(base + slot)).json(), saved);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'sequence_' + slot + '.json'), 'utf8')), saved);
    }
    assert.deepEqual(await (await fetch(base + 'a')).json(), { loop: false, finish: false, steps: [] });
    for (const slot of ['k', '', '../config', 'aa', 'A']) {
      assert.equal((await fetch(base + encodeURIComponent(slot))).status, 400);
      assert.equal((await fetch(base + encodeURIComponent(slot), { method: 'POST', body: '{}' })).status, 400);
    }
    assert.equal(fs.readFileSync(path.join(directory, 'config.json'), 'utf8'), config);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'sequence.json'), 'utf8')), legacy);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
