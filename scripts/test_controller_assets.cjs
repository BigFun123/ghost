const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'data/index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'src/WebStatusServer.cpp'), 'utf8');
const routes = server.slice(server.indexOf('server_.on("/",'), server.indexOf('server_.on("/config.json",'));
const scripts = [...html.matchAll(/<script src="\.\/([^"]+)"/g)].map(match => match[1]);
for (const file of [...scripts, 'ai-worker.js', 'ai-policy-file.js']) {
  assert.ok(fs.existsSync(path.join(root, 'data', file)), 'Missing filesystem asset: ' + file);
  if (!file.startsWith('components/')) assert.ok(routes.includes('"/' + file + '"'), 'Missing controller route: ' + file);
}
assert.ok(scripts.indexOf('ai-rig.js') < scripts.indexOf('app.js'), 'Rig must load before app');
console.log('Controller script assets and rig load order passed.');
