const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function validateConfiguration(config) {
  if (!config || !Array.isArray(config.components) || !config.components.length || config.components.length > 60) throw new Error('Expected 1-60 components.');
  if (config.camera !== undefined) {
    const camera = config.camera;
    if (!camera || ['yaw', 'pitch', 'roll', 'zoom', 'panX', 'panY', 'panZ'].some(key => !Number.isFinite(camera[key])) ||
        Math.abs(camera.pitch) > Math.PI / 2 || camera.zoom < 0.2 || camera.zoom > 5 || typeof camera.perspective !== 'boolean') throw new Error('Invalid camera view settings.');
    if (camera.views !== undefined && (!camera.views || Array.isArray(camera.views) || typeof camera.views !== 'object' ||
        Object.entries(camera.views).some(([slot, view]) => !['u1', 'u2', 'u3'].includes(slot) || !view ||
          ['yaw', 'pitch', 'roll', 'zoom', 'panX', 'panY', 'panZ'].some(key => !Number.isFinite(view[key])) ||
          Math.abs(view.pitch) > Math.PI / 2 || view.zoom < 0.2 || view.zoom > 5 || typeof view.perspective !== 'boolean'))) throw new Error('Invalid saved camera view.');
    const webcam = camera.webcam;
    if (!webcam || (webcam.active !== undefined && typeof webcam.active !== 'boolean') || typeof webcam.deviceId !== 'string' || webcam.deviceId.length > 512 || !['cover', 'contain'].includes(webcam.fit) || typeof webcam.mirror !== 'boolean' ||
        !webcam.controls || Array.isArray(webcam.controls) || typeof webcam.controls !== 'object' || Object.keys(webcam.controls).length > 24 ||
        Object.entries(webcam.controls).some(([key, value]) => key.length > 31 || !(typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 64))) throw new Error('Invalid webcam settings.');
  }
  const names = new Map(), outputs = new Set();
  let servos = 0;
  for (const component of config.components) {
    if (!component || typeof component.name !== 'string' || !component.name.trim() || names.has(component.name)) throw new Error('Component names must be nonempty and unique.');
    names.set(component.name, component);
    const type = component.objectType ?? 'Servo';
    if (!['Servo', 'U Bracket Short', 'U Bracket Long', 'Null'].includes(type)) throw new Error('Unknown component type.');
    for (const field of ['position', 'rotation']) {
      if (component[field] !== undefined && !['x', 'y', 'z'].every(axis => Number.isFinite(component[field]?.[axis]))) throw new Error('Transforms require finite x, y and z.');
    }
    if (component.constraints !== undefined && (type !== 'Null' || !component.constraints || typeof component.constraints !== 'object' || Array.isArray(component.constraints) ||
        Object.entries(component.constraints).some(([axis, limit]) => !['x', 'y', 'z'].includes(axis) || !limit || typeof limit.enabled !== 'boolean' ||
          !Number.isFinite(limit.min) || !Number.isFinite(limit.max) || limit.min > limit.max))) throw new Error('Invalid Null axis constraints.');
    if (component.rotationConstraints !== undefined && (type !== 'Null' || !component.rotationConstraints || typeof component.rotationConstraints !== 'object' || Array.isArray(component.rotationConstraints) ||
        Object.entries(component.rotationConstraints).some(([axis, locked]) => !['x', 'y', 'z'].includes(axis) || typeof locked !== 'boolean'))) throw new Error('Invalid Null rotation constraints.');
    if (type !== 'Servo') continue;
    servos++;
    const address = Number(component.address), key = address + ':' + component.channel;
    if (!Number.isInteger(address) || address < 0x40 || address > 0x77 || !Number.isInteger(component.channel) || component.channel < 0 || component.channel > 15 || outputs.has(key)) throw new Error('Invalid or duplicate servo output.');
    outputs.add(key);
    if (component.name.length > 31 || !['standard', 'micro'].includes(component.model ?? 'standard') ||
        !['immediate', 'smooth'].includes(component.initialMotionMode ?? 'immediate') ||
        ['enabled', 'reversed', 'continuous'].some(flag => component[flag] !== undefined && typeof component[flag] !== 'boolean') ||
        !Number.isFinite(component.minAngle) || !Number.isFinite(component.maxAngle) || component.minAngle < 0 || component.minAngle > component.maxAngle) throw new Error('Invalid servo settings.');
    if (!Number.isInteger(component.startupAngle) || component.startupAngle < 0 || component.startupAngle > 180 ||
        !Number.isInteger(component.minPulseMicroseconds) || !Number.isInteger(component.maxPulseMicroseconds) ||
        component.minPulseMicroseconds < 500 || component.maxPulseMicroseconds > 2500 || component.minPulseMicroseconds >= component.maxPulseMicroseconds) throw new Error('Invalid servo angle or pulse range.');
  }
  if (servos < 1 || servos > 20) throw new Error('Expected 1-20 servos.');
  for (const component of config.components) {
    const seen = new Set([component.name]);
    for (let parent = component.parent; parent != null; parent = names.get(parent).parent) {
      if (typeof parent !== 'string' || !names.has(parent) || seen.has(parent)) throw new Error('Parents must exist and must not form cycles.');
      seen.add(parent);
    }
  }
}

function validateSequence(sequence, servoCount) {
  if (!sequence || typeof sequence.loop !== 'boolean' || (sequence.finish !== undefined && typeof sequence.finish !== 'boolean') || !Array.isArray(sequence.steps) || sequence.steps.length > 32) throw new Error('Expected a loop flag and at most 32 steps.');
  for (const step of sequence.steps) {
    if (step?.type === 'color') {
      if (!Array.isArray(step.rgb) || step.rgb.length !== 3 || step.rgb.some(value => !Number.isInteger(value) || value < 0 || value > 255) ||
          !Number.isInteger(step.durationMs) || step.durationMs < 100 || step.durationMs > 60000) throw new Error('Invalid RGB color step.');
      continue;
    }
    if (step?.type === 'sequence') {
      if (!/^[a-j]$/.test(step.slot)) throw new Error('Sequence call target must be a-j.');
      continue;
    }
    if (!step || !Array.isArray(step.angles) || step.angles.length !== servoCount ||
        step.angles.some(angle => !Number.isInteger(angle) || angle < 0 || angle > 180) ||
        !Number.isInteger(step.durationMs) || step.durationMs < 100 || step.durationMs > 60000 ||
        (step.servoStates !== undefined && (!Array.isArray(step.servoStates) || step.servoStates.length !== servoCount ||
          step.servoStates.some(state => !Number.isInteger(state) || state < 0 || state > 23)))) throw new Error('Invalid sequence step or servo count; reload after changing the config.');
  }
}

function writeJsonFile(file, value) {
  const temporary = file + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function createServer(dataDirectory = path.resolve(__dirname, '../data')) {
  const root = fs.realpathSync(dataDirectory);
  const configPath = path.join(root, 'config.json');
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
  return http.createServer(async (request, response) => {
    const send = (status, text, type = 'text/plain; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(text);
    };
    const host = '127.0.0.1:' + request.socket.localPort;
    if (request.headers.host !== host || (request.headers.origin && request.headers.origin !== 'http://' + host)) return send(403, 'Local same-origin requests only.');
    try {
      const url = new URL(request.url, 'http://' + host);
      if (request.method === 'GET' && url.pathname === '/api/devserver') return send(200, '{"localConfigServer":true}', mime['.json']);
      if ((url.pathname === '/api/sequence' || url.pathname.startsWith('/api/sequence/')) && (request.method === 'GET' || request.method === 'POST')) {
        const slot = url.pathname.startsWith('/api/sequence/') ? url.pathname.slice('/api/sequence/'.length) : url.searchParams.get('slot');
        if (slot !== null && !/^[a-j]$/.test(slot)) return send(400, 'Sequence slot must be a-j.');
        const sequencePath = path.join(root, slot === null ? 'sequence.json' : 'sequence_' + slot + '.json');
        const readPath = slot === 'a' && !fs.existsSync(sequencePath) ? path.join(root, 'sequence.json') : sequencePath;
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const servoCount = config.components.filter(component => (component.objectType ?? 'Servo') === 'Servo').length;
        if (request.method === 'GET') {
          const sequence = fs.existsSync(readPath) ? JSON.parse(fs.readFileSync(readPath, 'utf8')) : { loop: false, steps: [] };
          try { validateSequence(sequence, servoCount); } catch (error) { return send(409, error.message); }
          return send(200, JSON.stringify(sequence), mime['.json']);
        }
        if (!(request.headers['content-type'] || '').startsWith('application/json')) return send(415, 'Expected application/json.');
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 8192) return send(413, 'Sequence exceeds the 8192-byte controller limit.');
          chunks.push(chunk);
        }
        let sequence;
        try {
          sequence = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          validateSequence(sequence, servoCount);
        } catch (error) { return send(400, error.message); }
        writeJsonFile(sequencePath, sequence);
        return send(200, 'Saved data/' + path.basename(sequencePath) + ' on this PC.');
      }
      if (request.method === 'POST' && url.pathname === '/api/config/local') {
        if (!(request.headers['content-type'] || '').startsWith('application/json')) return send(415, 'Expected application/json.');
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 65536) { send(413, 'Request too large.'); return; }
          chunks.push(chunk);
        }
        let patch;
        try { patch = JSON.parse(Buffer.concat(chunks).toString('utf8')); validateConfiguration(patch.configuration); } catch (error) { return send(400, error.message); }
        const stored = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const names = stored.components.map(component => component.name);
        if (JSON.stringify(patch.originalNames) !== JSON.stringify(names)) return send(409, 'Config changed; reload the page.');
        if (Buffer.byteLength(JSON.stringify(patch.configuration)) > 24576) return send(413, 'Config exceeds the controller limit.');
        writeJsonFile(configPath, patch.configuration);
        return send(200, 'Saved data/config.json on this PC.');
      }
      if (url.pathname.startsWith('/api/')) return send(404, 'Only local config and sequence storage are supported.');
      if (request.method !== 'GET' && request.method !== 'HEAD') return send(405, 'Method not allowed.');
      const asset = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!asset.startsWith(root + path.sep) || !mime[path.extname(asset)]) return send(404, 'Not found.');
      let resolved;
      try { resolved = fs.realpathSync(asset); } catch { return send(404, 'Not found.'); }
      if (!resolved.startsWith(root + path.sep) || !fs.statSync(resolved).isFile()) return send(404, 'Not found.');
      send(200, request.method === 'HEAD' ? '' : fs.readFileSync(resolved), mime[path.extname(resolved)]);
    } catch (error) {
      console.error('Local server request failed:', error.message);
      if (!response.headersSent) send(500, 'Could not read or save the local file.');
    }
  });
}

if (require.main === module) {
  const port = Number(process.argv[2] || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be 1-65535.');
  const server = createServer();
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log('Open http://127.0.0.1:' + port + ' — saves config to data/config.json and sequence slots to data/sequence_a.json through data/sequence_j.json. Ctrl+C to stop.'));
}
module.exports = { createServer, validateConfiguration };
