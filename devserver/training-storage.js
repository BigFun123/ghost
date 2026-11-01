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
  const json = JSON.stringify(policy, null, 2) + '\n';
  if (Buffer.byteLength(json) > maxPolicyBytes) throw new Error('Policy exceeds 2 MB.');
  return json;
}

function savePolicy(directory, name, policy) {
  if (typeof name !== 'string') throw new Error('Invalid policy name.');
  name = name.trim().replace(/\.json$/i, '').trim();
  if (!/^[A-Za-z0-9_-][A-Za-z0-9 _-]{0,63}$/.test(name) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name)) throw new Error('Invalid policy name.');
  const json = validatePolicy(policy);
  const root = path.resolve(directory);
  fs.mkdirSync(root, { recursive: true });
  if (fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory()) throw new Error('Training storage must be a regular directory.');
  const filename=name+'.json',target=path.join(root,filename),temporary=path.join(root,'.policy-'+randomUUID()+'.tmp');
  let backup=null;
  try {
    const fd=fs.openSync(temporary,'wx');
    try { fs.writeFileSync(fd,json);fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if(fs.existsSync(target)){
      const stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Current policy must be a regular file.');
      const backups=path.join(root,'backups');fs.mkdirSync(backups,{recursive:true});
      if(fs.lstatSync(backups).isSymbolicLink()||!fs.statSync(backups).isDirectory())throw new Error('Policy backups must be a regular directory.');
      const backupName=name+'--'+new Date().toISOString().replace(/[:.]/g,'-')+'--'+randomUUID()+'.json';
      fs.copyFileSync(target,path.join(backups,backupName),fs.constants.COPYFILE_EXCL);backup='training/backups/'+backupName;
    }
    fs.renameSync(temporary,target);
  } finally { if(fs.existsSync(temporary))fs.unlinkSync(temporary); }
  return { filename, path:'training/'+filename, backup, bytes:Buffer.byteLength(json) };
}

function policyFile(directory, filename) {
  if(typeof filename!=='string'||! /^[A-Za-z0-9_-][A-Za-z0-9 _.-]{0,100}\.json$/.test(filename)||filename.includes('..'))throw new Error('Invalid policy filename.');
  const root=path.resolve(directory);
  if(fs.lstatSync(root).isSymbolicLink())throw new Error('Training storage must be a regular directory.');
  const target=path.join(root,filename),stat=fs.lstatSync(target);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxPolicyBytes)throw new Error('Invalid policy file.');
  return target;
}
function listPolicies(directory) {
  if(!fs.existsSync(directory))return [];
  if(fs.lstatSync(directory).isSymbolicLink())throw new Error('Training storage must be a regular directory.');
  return fs.readdirSync(directory).sort().flatMap(filename=>{try{policyFile(directory,filename);return [{filename}];}catch{return [];}});
}
function readPolicy(directory,filename) {
  const policy=JSON.parse(fs.readFileSync(policyFile(directory,filename),'utf8'));validatePolicy(policy);return policy;
}
module.exports = { savePolicy, listPolicies, readPolicy, maxPolicyBytes };
