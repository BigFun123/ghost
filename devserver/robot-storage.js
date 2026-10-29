const fs = require('node:fs');
const path = require('node:path');

function validRobotName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/.test(name) &&
    name === name.trim() && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name);
}

function robotStorage(root, writeJson, validateSequence) {
  const manifestPath = path.join(root, 'robots.json');
  const directory = path.join(root, 'robots');
  const safeDirectory = name => {
    if (!validRobotName(name)) throw new Error('Robot name must be 1-40 letters, numbers, spaces, underscores or hyphens.');
    const folder = path.join(directory, name);
    if (fs.existsSync(folder) && fs.realpathSync(folder) !== folder) throw new Error('Robot folder must not be a link.');
    return folder;
  };
  if (!fs.existsSync(manifestPath)) {
    fs.mkdirSync(directory, { recursive: true });
    fs.mkdirSync(safeDirectory('Robot'), { recursive: true });
    const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    writeJson(path.join(directory, 'Robot', 'config.json'), config);
    const count = config.components.filter(c => (c.objectType ?? 'Servo') === 'Servo').length;
    for (const file of fs.readdirSync(root).filter(name => /^sequence(?:_[a-j])?\.json$/.test(name))) {
      try {
        const sequence = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
        validateSequence(sequence, count);
        writeJson(path.join(directory, 'Robot', file), sequence);
      }
      catch { /* Incompatible legacy sequences stay in their original backup location. */ }
    }
    writeJson(manifestPath, { active: 'Robot', robots: ['Robot'] });
  }
  const manifest = () => JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const configPath = name => path.join(safeDirectory(name), 'config.json');
  const select = name => {
    if (!fs.existsSync(configPath(name))) throw new Error('Robot folder does not contain config.json.');
    const saved = manifest();
    if (!saved.robots.includes(name)) saved.robots.push(name);
    saved.active = name;
    writeJson(manifestPath, saved);
  };
  const rename = (from, to) => {
    const source = safeDirectory(from), target = safeDirectory(to);
    if (from === to) return;
    if (!fs.existsSync(configPath(from))) throw new Error('Robot not found.');
    if (fs.existsSync(target)) throw new Error('A robot with that name already exists.');
    // Both resolved paths are constrained to the robots directory by safeDirectory.
    const saved = manifest();
    fs.renameSync(source, target);
    try {
      saved.robots = saved.robots.map(name => name === from ? to : name);
      if (saved.active === from) saved.active = to;
      writeJson(manifestPath, saved);
    } catch (error) { fs.renameSync(target, source); throw error; }
  };
  return { manifest, directory: safeDirectory, configPath, select, rename };
}

module.exports = { robotStorage, validRobotName };
