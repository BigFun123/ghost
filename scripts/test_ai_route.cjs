const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createServer } = require('../devserver/server');
test('local host serves the pinned runtime outside controller filesystem assets', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-ai-route-'));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({components:[]}));
  const server = createServer(root);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base='http://127.0.0.1:'+server.address().port;
    const response=await fetch(base+'/vendor/tensorflow-4.22.0/tf.min.js');
    assert.equal(response.status,200); assert.match(response.headers.get('content-type'),/javascript/);
    const expected=fs.readFileSync(path.resolve(__dirname,'../devserver/vendor/tensorflow-4.22.0/tf.min.js'));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected);
    assert.equal((await fetch(base+'/vendor/tensorflow-4.22.0/LICENSE')).status,404);
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
});
