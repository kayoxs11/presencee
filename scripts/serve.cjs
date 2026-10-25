/* Storefront and same-origin commerce backend. DEV remains loopback-only. */
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = Number(process.argv.slice(2).find(argument => !argument.startsWith('--')) || 8010);
const development = process.argv.includes('--dev') && ['', 'development', 'test'].includes(process.env.NODE_ENV || '');
const commerce = require('../js/commerce');
const devEngine = commerce.createDevelopmentEngine();
const { PRODUCTS } = require('../js/catalog');
const { openStore } = require('../server/store.cjs');
const { createCommerce } = require('../server/commerce.cjs');
const store = openStore(process.env.DATABASE_PATH || path.join(root, 'data', `commerce-${port}.sqlite`));
const application = createCommerce({ store, env: { ...process.env, PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${port}` } });
function localRequest(request) {
  try {
    const host = new URL('http://' + request.headers.host);
    return ['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress) &&
      ['localhost', '127.0.0.1'].includes(host.hostname) && Number(host.port || 80) === port;
  } catch (_) { return false; }
}
function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(data));
}
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer(async (request, response) => {
  try {
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (await application.handle(request, response)) return;
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/__dev__/coupons') {
      if (!development || !localRequest(request)) { json(response, 403, { error: 'DEV_DISABLED' }); return; }
      if (request.method !== 'POST') { json(response, 405, { error: 'METHOD' }); return; }
      if (request.headers.origin !== 'http://' + request.headers.host || request.headers['x-presence-development'] !== '1' ||
          (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') ||
          !/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) { json(response, 403, { error: 'ORIGIN' }); return; }
      let body = '', bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 65536) { json(response, 413, { error: 'TOO_LARGE' }); return; }
        body += chunk;
      }
      let input;
      try { input = JSON.parse(body); } catch (_) { json(response, 400, { error: 'INVALID_JSON' }); return; }
      if (!input || commerce.normalizeCode(input.code) !== 'DEV' || !Array.isArray(input.lines) || !input.lines.length || input.lines.length > 100) { json(response, 422, { error: 'INVALID_CART' }); return; }
      const order = devEngine.summary(input.lines, PRODUCTS, 'DEV', []);
      // Reject stale/unpriced/invalid lines instead of silently dropping part of a test cart.
      if (!order.coupon?.valid || order.notices.length || order.lines.length !== input.lines.length) { json(response, 422, { error: 'INVALID_CART' }); return; }
      json(response, 200, { environment: 'development', valid: true, code: 'DEV',
        fingerprint: JSON.stringify(order.lines.map(line => [line.id, line.quantity, line.variant, line.note])),
        subtotal: order.subtotal, discount: order.discount, total: order.total, shippingDiscount: 0,
        expiresAt: Date.now() + 60000, message: order.coupon.message });
      return;
    }
    if (pathname === '/__dev__/coupons.js') {
      if (!development || !localRequest(request) || request.method !== 'GET') { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(await fs.readFile(path.join(__dirname, 'dev-coupons-client.js'))); return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    let name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (name === '/') name = '/index.html';
    if (!['/index.html', '/checkout.html', '/tracking.html', '/admin.html'].includes(name) && !/^\/(css|js|assets)\/[\w./-]+$/.test(name)) throw new Error('Not public');
    const file = path.resolve(root, '.' + name);
    if (!file.startsWith(root + path.sep) || name.split('/').some(segment => segment.startsWith('.'))) throw new Error('Not public');
    let data = await fs.readFile(file);
    if (name === '/index.html' && development && localRequest(request)) {
      data = Buffer.from(data.toString('utf8').replace('<script src="js/cart.js" defer></script>', '<script src="/__dev__/coupons.js" defer></script>\n<script src="js/cart.js" defer></script>'));
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch (_) { response.writeHead(404); response.end('Not found'); }
});
server.listen(port, process.env.HOST || '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
