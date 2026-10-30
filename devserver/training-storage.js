// Local policy artifacts live outside data/ and are never part of a controller upload.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const maxPolicyBytes = 2 * 1024 * 1024;

function validatePolicy(policy) {
  if (policy?.format !== 'ghost-ppo-policy' || policy.version !== 1 || policy.tensorflowVersion !== '4.22.0' ||
      !policy.compatibility || typeof policy.compatibility !== 'object' || Array.isArray(policy.compatibility) ||
      policy.network?.schema?.inputSize !== 29 || policy.network.schema.actionCount !== 5 ||
      !Array.isArray(policy.network.weights) || policy.network.weights.length !== 8 || !policy.network.settings) {
    throw new Error('Expected a version 1 GHOST PPO policy with compatibility data and weights.');
  }
  const shapes = [[29,64],[64],[64,64],[64],[64,5],[5],[64,1],[1]];
  policy.network.weights.forEach((weight, index) => {
    if (JSON.stringify(weight?.shape) !== JSON.stringify(shapes[index]) || !Array.isArray(weight.values) ||
        weight.values.length !== shapes[index].reduce((a,b) => a*b, 1) ||
        !weight.values.every(value => typeof value === 'number' && Number.isFinite(Math.fround(value)))) {
      throw new Error('Invalid policy weights.');
    }
  });
  const json = JSON.stringify(policy) + '\n';
  if (Buffer.byteLength(json) > maxPolicyBytes) throw new Error('Policy exceeds 2 MB.');
  return json;
}

function savePolicy(directory, name, policy) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new Error('Invalid policy name.');
  const json = validatePolicy(policy);
  const root = path.resolve(directory);
  fs.mkdirSync(root, { recursive: true });
  if (fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory()) throw new Error('Training storage must be a regular directory.');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = name + '-ppo-' + stamp + '-' + randomUUID().slice(0,8) + '.json';
  const target = path.join(root, filename);
  const fd = fs.openSync(target, 'wx');
  try { fs.writeFileSync(fd, json); }
  catch (error) { fs.closeSync(fd); fs.unlinkSync(target); throw error; }
  fs.closeSync(fd);
  return { filename, path: 'training/' + filename, bytes: Buffer.byteLength(json) };
}

module.exports = { savePolicy, maxPolicyBytes };
