const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const data = path.resolve(__dirname, '../data');

function loadComponentRegistry(context = {}) {
  if (!vm.isContext(context)) vm.createContext(context);
  const html = fs.readFileSync(path.join(data, 'index.html'), 'utf8');
  for (const match of html.matchAll(/<script src="\.\/components\/([A-Za-z0-9_.-]+\.js)"[^>]*><\/script>/g)) {
    vm.runInContext(fs.readFileSync(path.join(data, 'components', match[1]), 'utf8'), context, { filename: match[1] });
  }
  vm.runInContext(fs.readFileSync(path.join(data, 'ai-rig.js'), 'utf8'), context, { filename: 'ai-rig.js' });
  return vm.runInContext('componentRegistry', context);
}

function writeCatalog() {
  const registry = loadComponentRegistry();
  const catalog = { objectTypes: registry.types(), models: {}, numericSettings: {} };
  for (const type of catalog.objectTypes) {
    const models = registry.models(type);
    if (models.length) catalog.models[type] = models;
    const definition = registry.resolve({ objectType: type });
    if (definition?.numericSettings) catalog.numericSettings[type] = definition.numericSettings;
  }
  fs.writeFileSync(path.join(data, 'components/catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
}

if (require.main === module) writeCatalog();
module.exports = { loadComponentRegistry, writeCatalog };
