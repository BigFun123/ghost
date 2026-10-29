const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadComponentRegistry } = require('../devserver/component-registry');

class Element {
  constructor() { this.children = []; this.listeners = {}; this.disabled = false; this.value = ''; }
  append(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  setAttribute() {}
  addEventListener(name, listener) { this.listeners[name] = listener; }
  reportValidity() { return true; }
  querySelectorAll() { return []; }
}

async function run() {
  const elements = Object.fromEntries(['shopForm', 'shopStatus', 'shopImagesStatus', 'shopSend', 'shopResult',
    'shopRobotName', 'shopReload', 'shopParts', 'shopPanel'].map(id => [id, new Element()]));
  const events = {};
  const requests = [];
  let failCatalog = false;
  const document = {
    getElementById: id => elements[id], createElement: () => new Element(),
    addEventListener: (name, listener) => { events[name] = listener; },
    dispatchEvent: event => events[event.type]?.(event)
  };
  const context = { document, URL, TextEncoder, AbortSignal, CustomEvent: class { constructor(type) { this.type = type; } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/api/shop')) {
        if (failCatalog) throw new Error('Offline');
        return { ok: true, json: async () => ({ products: [
          { id: 'servo-sg90', name: 'SG90', imageUrl: '/images/sg90.png' },
          { id: 'esp32-board', name: 'ESP32', imageUrl: 'javascript:alert(1)' }
        ] }) };
      }
      return { ok: true, json: async () => ({ ok: true, shopUrl: '/shop/?import=test' }) };
    }
  };
  vm.runInNewContext(fs.readFileSync('data/shop.js', 'utf8'), context);
  const robot = { name: 'Test robot', definition: { servoController: { name: 'PCA9685', shopProductId: 'PCA9685' }, components: [
    { objectType: 'Robot', shopProductId: 'esp32-board' },
    { objectType: 'Servo', model: 'micro', type: 'SG90', shopProductId: 'servo-sg90' },
    { objectType: 'Servo', model: 'standard', type: 'TD-7120MG', shopProductId: null },
    { objectType: 'Null', shopProductId: null }
  ] } };
  events['shop:robot']({ detail: robot });
  await new Promise(resolve => setImmediate(resolve));
  const cells = row => row.children.map(cell => cell.children[0]);
  assert.equal(elements.shopParts.children.length, 4, 'Includes board and PCA9685; excludes virtual nodes');
  const rows = elements.shopParts.children.map(cells);
  assert.equal(rows[1][4].value, 2, 'Groups matching product quantities');
  assert.equal(rows[1][1].children[0].src, 'https://epistemic.co.za/images/sg90.png');
  assert.equal(rows[0][1].children.length, 0, 'Rejects non-HTTPS image URLs');
  rows[1][1].children[0].listeners.error();
  assert.equal(rows[1][1].textContent, 'Image unavailable');
  rows[2][0].checked = false;
  rows[2][0].listeners.change();
  await elements.shopForm.listeners.submit({ preventDefault() {} });
  const payload = JSON.parse(requests.find(request => request.url.endsWith('/api/shop-init')).options.body);
  assert.deepEqual(payload.items, [{ id: 'esp32-board', quantity: 1 }, { id: 'servo-sg90', quantity: 2 }, { id: 'PCA9685', quantity: 1 }]);
  assert.equal(payload.robot.definition.components[1].shopProductId, 'servo-sg90');
  rows[1][3].value = 'esp32-board'; rows[1][3].listeners.input();
  assert.equal(robot.definition.components[1].shopProductId, 'esp32-board');
  assert.equal(robot.definition.components[2].shopProductId, 'esp32-board');
  assert.equal(rows[1][1].children.length, 0, 'Changing the ID refreshes the thumbnail');

  const registry = loadComponentRegistry();
  assert.equal(registry.resolve({ objectType: 'Servo', model: 'micro' }).defaults.shopProductId, 'servo-sg90');
  assert.equal(registry.resolve({ objectType: 'Servo' }).defaults.shopProductId, null, 'No substitute product for TD-7120MG');
  const ids = new Set(JSON.parse(fs.readFileSync('data/shop/epistemic.shop_items.json')).map(product => product.id));
  for (const folder of fs.readdirSync('data/robots')) {
    const config = JSON.parse(fs.readFileSync('data/robots/' + folder + '/config.json'));
    for (const component of config.components) {
      assert(Object.hasOwn(component, 'shopProductId'));
      assert(component.shopProductId === null || ids.has(component.shopProductId));
    }
  }
  // A separate initialization verifies catalogue failure leaves the parts usable.
  failCatalog = true;
  vm.runInNewContext(fs.readFileSync('data/shop.js', 'utf8'), context);
  events['shop:robot']({ detail: robot });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(elements.shopImagesStatus.textContent, /could not be loaded/);
  assert.equal(elements.shopSend.disabled, false);
  console.log('Shop checks passed: product mappings, grouping, thumbnails, URL safety, image failure, ID edits, import payload and catalogue failure.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
