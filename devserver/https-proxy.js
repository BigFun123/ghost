const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

// Keep all requests on the HTTPS origin, including commands and saved settings.
function createProxy(tls, target = 'http://ghost-controller.local') {
  const upstream = new URL(target);
  if (upstream.protocol !== 'http:') throw new Error('Controller target must use HTTP.');
  return https.createServer(tls, (request, response) => {
    const headers = { ...request.headers, host: upstream.host };
    delete headers.origin;
    delete headers.referer;
    const forwarded = http.request({
      hostname: upstream.hostname,
      port: upstream.port || 80,
      path: request.url,
      method: request.method,
      headers,
    }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers);
      incoming.pipe(response);
      incoming.on('error', () => response.destroy());
    });
    forwarded.setTimeout(15000, () => forwarded.destroy(new Error('Controller request timed out')));
    forwarded.on('error', () => {
      if (response.headersSent) return response.destroy();
      response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Controller unavailable. Check its Wi-Fi connection and ghost-controller.local.');
    });
    request.on('aborted', () => forwarded.destroy());
    request.pipe(forwarded);
  });
}

if (require.main === module) {
  const certificates = path.resolve(__dirname, '../.local-https');
  const server = createProxy({
    cert: fs.readFileSync(path.join(certificates, 'controller.pem')),
    key: fs.readFileSync(path.join(certificates, 'controller-key.pem')),
  }, process.argv[2] || 'http://ghost-controller.local');
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(8443, '127.0.0.1', () => {
    console.log('Open https://localhost:8443 — live controller with webcam access.');
  });
}

module.exports = { createProxy };
