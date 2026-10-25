const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID, scryptSync, createHmac } = require('node:crypto');
const { openStore } = require('../server/store.cjs');
const { createCommerce, customerInput, hash } = require('../server/commerce.cjs');
const { mercadoPago, signatureValid } = require('../server/providers.cjs');
const shipping = require('../js/shipping');
const customer = { name: 'Cliente Teste', email: 'cliente@example.test', phone: '81999999999', address: { cep: '53110-000', street: 'Rua de teste', number: '10', complement: '', neighborhood: 'Centro', city: 'Olinda', state: 'PE' } };
const catalog = [
  { id: 'book', name: 'Livro de teste', price: 60, available: true, is_combo: false },
  { id: 'combo', name: 'Combo de teste', price: 10.05, available: true, is_combo: true },
  { id: 'custom', name: 'Personalizado de teste', price: 20, available: true, personalizable: true, variants: ['Azul'] },
];
const lines = [{ id: 'book', quantity: 1 }];
async function fixture(t, options = {}) {
  const store = openStore(':memory:');
  const salt = 'ab'.repeat(16), password = 'test-password-long-enough';
  const env = { PUBLIC_BASE_URL: 'http://localhost', ORDER_ACCESS_SECRET: 'x'.repeat(32), ADMIN_PASSWORD_HASH: salt + ':' + scryptSync(password, salt, 64).toString('hex'), MP_WEBHOOK_SECRET: 'test-webhook-secret', MP_MODE: 'sandbox', ...options.env };
  let providerPayment, preferenceCalls = 0, paymentCalls = 0;
  const provider = options.provider || { configured: true,
    preference: async () => { preferenceCalls++; await new Promise(resolve => setTimeout(resolve, 5)); return { id: 'pref-test', url: 'https://www.mercadopago.com.br/test-only' }; },
    payment: async id => { paymentCalls++; return { ...providerPayment, id }; },
    refund: async () => { providerPayment.status = 'refunded'; providerPayment.date_last_updated = new Date(Date.now() + 1000).toISOString(); },
    cancel: async () => { providerPayment.status = 'cancelled'; providerPayment.date_last_updated = new Date(Date.now() + 1000).toISOString(); },
  };
  let clock = Date.now();
  // Existing checkout/provider mechanics are legacy-only, never enabled by the deployed entry point.
  const app = createCommerce({ store, env, catalog, provider, salesChannel: options.salesChannel || 'registered-orders', ...(options.shippingProvider ? { shippingProvider: options.shippingProvider } : {}), now: () => clock });
  const server = http.createServer((req, res) => app.handle(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.db.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  let cookie;
  async function request(path, body, { auth, key, origin = new URL(env.PUBLIC_BASE_URL).origin, useCookie = false, headers = {}, method } = {}) {
    const result = await fetch(base + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Presence-Request': '1', Origin: origin, ...(auth ? { Authorization: 'Bearer ' + auth } : {}), ...(key ? { 'Idempotency-Key': key } : {}), ...(useCookie && cookie ? { Cookie: cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await result.json(); return { status: result.status, data, headers: result.headers };
  }
  async function login() { const result = await request('/api/admin/login', { password }); assert.equal(result.status, 200); cookie = result.headers.get('set-cookie').split(';')[0]; return result; }
  async function quote(cart = lines, cep = '53110000', priceCents = 1500) {
    const result = await request('/api/shipping/quotes', { lines: cart, destinationCEP: cep }); assert.equal(result.status, 201);
    await login();
    const approval = await request('/api/admin/quotes/' + result.data.id, { service: 'Serviço de teste autorizado', priceCents, deliveryDays: 5, productionDays: 2, evidence: 'Fixture de teste isolada, não é cotação comercial' }, { useCookie: true }); assert.equal(approval.status, 200);
    return { lines: cart, destinationCEP: cep, quoteId: result.data.id, quoteToken: result.data.token, coupon: '' };
  }
  async function order(extra = {}) {
    const input = await quote(extra.lines || lines);
    const review = await request('/api/checkout/review', { ...input, coupon: extra.coupon || '' }); assert.equal(review.status, 200);
    const payload = { ...input, ...extra, reviewHash: review.data.reviewHash, customer };
    const key = randomUUID();
    const created = await request('/api/orders', payload, { key }); assert.equal(created.status, 201, JSON.stringify(created.data));
    const saved = store.get('SELECT * FROM orders WHERE reference=?', created.data.reference);
    providerPayment = { id: '123', external_reference: saved.id, transaction_amount: saved.total / 100, currency_id: 'BRL', live_mode: false, status: 'pending', date_last_updated: new Date(clock).toISOString() };
    return { result: created.data, payload, key, saved };
  }
  return { request, login, quote, order, app, store, env, password, provider,
    get preferenceCalls() { return preferenceCalls; }, get paymentCalls() { return paymentCalls; },
    setPayment(data) { providerPayment = { ...providerPayment, ...data }; }, advance(ms) { clock += ms; },
    webhookHeaders(id = '123', secret = env.MP_WEBHOOK_SECRET, requestId = 'request-test') {
      const ts = Math.floor(clock / 1000).toString();
      const signature = createHmac('sha256', secret).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');
      return { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${signature}` };
    }
  };
}
test('CEP syntax rejects placeholders and malformed values', () => {
  for (const value of ['00000000','11111-111','5311000','abc',null]) assert.equal(shipping.normalizeCEP(value), null);
  assert.equal(shipping.normalizeCEP('53110-000'), '53110000');
});
test('required customer data and UF are validated on server', () => {
  assert.equal(customerInput(customer).address.cep, '53110000');
  for (const input of [{}, { ...customer, email: 'invalid' }, { ...customer, phone: '1' }, { ...customer, address: { ...customer.address, state: 'XX' } }, { ...customer, name: '' }]) assert.throws(() => customerInput(input));
});
test('manual quotes remain unknown until authenticated approval', async t => {
  const f = await fixture(t);
  const invalid = await f.request('/api/shipping/quotes', { lines, destinationCEP: '00000000' }); assert.equal(invalid.status, 422);
  const q = await f.request('/api/shipping/quotes', { lines, destinationCEP: '53110000' }); assert.equal(q.status, 201);
  const input = { lines, destinationCEP: '53110000', quoteId: q.data.id, quoteToken: q.data.token };
  assert.equal((await f.request('/api/checkout/review', input)).status, 409);
  assert.equal((await f.request('/api/admin/quotes/' + q.data.id, {})).status, 401);
  const pending = await f.request('/api/shipping/quotes/' + q.data.id, null, { auth: q.data.token });
  assert.equal(pending.data.priceCents, null); assert.equal(pending.data.status, 'pending');
  assert.equal((await f.request('/api/shipping/quotes/' + q.data.id)).status, 404);
});
test('approved quotes bind items, quantities, variants, personalization, destination, current prices and expiration', async t => {
  const f = await fixture(t);
  const input = await f.quote([{ id: 'custom', quantity: 1, variant: 'Azul', note: 'Maria' }]);
  assert.equal((await f.request('/api/checkout/review', input)).status, 200);
  for (const change of [ { destinationCEP: '01001000' }, { quoteToken: 'wrong' }, { lines: [{ ...input.lines[0], quantity: 2 }] }, { lines: [{ ...input.lines[0], note: 'Ana' }] } ]) assert.equal((await f.request('/api/checkout/review', { ...input, ...change })).status, 409);
  f.advance(3600001); assert.equal((await f.request('/api/checkout/review', input)).status, 409);
});
test('authoritative coupon totals, mixed carts, rounding and DEV rejection', async t => {
  const f = await fixture(t);
  const input = await f.quote([{ id: 'book', quantity: 1 }, { id: 'combo', quantity: 3 }]);
  const combo = await f.request('/api/checkout/review', { ...input, coupon: 'PRESENCA10', total: 1, discount: 999999 });
  assert.equal(combo.data.subtotal, 9015); assert.equal(combo.data.discount, 302); assert.equal(combo.data.total, 10213);
  const welcome = await f.request('/api/checkout/review', { ...input, coupon: 'BEMVINDO5' }); assert.equal(welcome.data.discount, 631);
  const freight = await f.request('/api/checkout/review', { ...input, coupon: 'FRETEGRATIS' }); assert.equal(freight.data.shippingDiscount, 1500); assert.equal(freight.data.discount, 0); assert.equal(freight.data.total, 9015);
  assert.equal((await f.request('/api/checkout/review', { ...input, coupon: 'DEV' })).status, 422);
  const ordinary = await f.quote(); assert.equal((await f.request('/api/checkout/review', { ...ordinary, coupon: 'PRESENCA10' })).status, 422);
  const small = await f.quote([{ id: 'combo', quantity: 1 }]); assert.equal((await f.request('/api/checkout/review', { ...small, coupon: 'BEMVINDO5' })).status, 422);
});
test('browser cannot supply an authoritative price, shipping value or invalid variant', async t => {
  const f = await fixture(t), input = await f.quote();
  const r = await f.request('/api/checkout/review', { ...input, total: 1, priceCents: 1, shippingCost: 0, package: { weightGrams: 1 } });
  assert.equal(r.data.total, 7500);
  for (const changed of [[{ id: 'missing', quantity: 1 }], [{ id: 'book', quantity: 0 }], [{ id: 'custom', quantity: 1, variant: 'fake' }], [lines[0], lines[0]]]) assert.equal((await f.request('/api/checkout/review', { ...input, lines: changed })).status, 422);
});
test('order snapshot, non-guessable access and duplicate submissions', async t => {
  const f = await fixture(t), o = await f.order();
  const duplicate = await f.request('/api/orders', o.payload, { key: o.key }); assert.equal(duplicate.status, 200); assert.equal(duplicate.data.reference, o.result.reference); assert.equal(duplicate.data.token, o.result.token);
  const parallel = await Promise.all([f.request('/api/orders', o.payload, { key: o.key }), f.request('/api/orders', o.payload, { key: o.key })]); assert.ok(parallel.every(r => r.status === 200));
  assert.equal(f.store.get('SELECT count(*) AS n FROM orders').n, 1);
  assert.equal((await f.request('/api/orders', { ...o.payload, coupon: 'BEMVINDO5' }, { key: o.key })).status, 409);
  assert.equal((await f.request('/api/orders', o.payload, { key: randomUUID() })).status, 409);
  assert.match(o.result.reference, /^PRE-[A-F0-9]{24}$/);
  assert.equal((await f.request('/api/orders/' + o.result.reference)).status, 404);
  const valid = await f.request('/api/orders/' + o.result.reference, null, { auth: o.result.token });
  assert.equal(valid.status, 200); assert.equal(valid.data.customer, undefined); assert.equal(valid.data.items[0].unit, 6000);
  f.advance(31 * 86400000); assert.equal((await f.request('/api/orders/' + o.result.reference, null, { auth: o.result.token })).status, 404);
});
test('order creation rejects missing fields, stale review and mismatched CEP', async t => {
  const f = await fixture(t), input = await f.quote(), review = await f.request('/api/checkout/review', input);
  const payload = { ...input, reviewHash: review.data.reviewHash, customer };
  for (const change of [{ customer: {} }, { reviewHash: 'wrong' }, { customer: { ...customer, address: { ...customer.address, cep: '01001000' } } }]) assert.ok([409,422].includes((await f.request('/api/orders', { ...payload, ...change }, { key: randomUUID() })).status));
  assert.equal(f.store.get('SELECT count(*) AS n FROM orders').n, 0);
});
test('payment double click reuses a single preference and never marks paid', async t => {
  const f = await fixture(t), o = await f.order(), path = '/api/orders/' + o.result.reference + '/payment';
  const results = await Promise.all([f.request(path, {}, { auth: o.result.token }), f.request(path, {}, { auth: o.result.token })]);
  assert.ok(results.every(r => r.status === 200)); assert.equal(f.preferenceCalls, 1);
  assert.equal(f.store.get('SELECT payment_status FROM orders').payment_status, 'pending');
});
test('unconfigured provider refuses payment without a fabricated success', async t => {
  const f = await fixture(t, { provider: mercadoPago({}) }), o = await f.order();
  const response = await f.request('/api/orders/' + o.result.reference + '/payment', {}, { auth: o.result.token });
  assert.equal(response.status, 503); assert.equal(f.store.get('SELECT payment_status FROM orders').payment_status, 'pending');
});
test('forged, expired and mismatched webhook notifications cannot change orders', async t => {
  const f = await fixture(t); await f.order();
  for (const [headers, id] of [[f.webhookHeaders('123','wrong'), '123'], [f.webhookHeaders('123'), '456'], [{}, '123']]) assert.equal((await f.request('/api/webhooks/mercadopago?data.id=123', { type: 'payment', data: { id } }, { headers })).status, 401);
  const headers = f.webhookHeaders(); f.advance(300001);
  assert.equal((await f.request('/api/webhooks/mercadopago?data.id=123', { type: 'payment', data: { id: '123' } }, { headers })).status, 401);
  assert.equal(f.paymentCalls, 0);
});
test('verified webhooks are idempotent and payment statuses stay separate', async t => {
  const f = await fixture(t), o = await f.order();
  for (const [index, status] of ['pending','in_process','rejected','cancelled','approved','refunded'].entries()) {
    f.setPayment({ status, date_last_updated: new Date(Date.now() + index * 1000).toISOString() });
    const headers = f.webhookHeaders('123', f.env.MP_WEBHOOK_SECRET, 'request-' + index);
    const path = '/api/webhooks/mercadopago?data.id=123', body = { type: 'payment', data: { id: '123' } };
    assert.equal((await f.request(path, body, { headers })).status, 200);
    const count = f.paymentCalls; assert.equal((await f.request(path, body, { headers })).status, 200); assert.equal(f.paymentCalls, count);
    assert.equal(f.store.get('SELECT payment_status FROM orders').payment_status, status);
  }
  assert.equal(f.store.get('SELECT fulfillment_status FROM orders').fulfillment_status, 'cancelled');
  f.setPayment({ status: 'approved', date_last_updated: new Date(Date.now() + 100000).toISOString() }); await f.app.syncPayment('123');
  assert.equal(f.store.get('SELECT fulfillment_status FROM orders').fulfillment_status, 'cancelled');
});
test('provider amount, currency, environment and stale state are checked', async t => {
  const f = await fixture(t); await f.order();
  for (const changes of [{ transaction_amount: 1 }, { currency_id: 'USD' }, { live_mode: true }]) {
    f.setPayment({ transaction_amount: 75, currency_id: 'BRL', live_mode: false, ...changes }); await assert.rejects(f.app.syncPayment('123'));
  }
  f.setPayment({ transaction_amount: 75, currency_id: 'BRL', live_mode: false, status: 'approved', date_last_updated: '2026-10-24T12:00:00Z' }); await f.app.syncPayment('123');
  f.setPayment({ status: 'pending', date_last_updated: '2026-10-23T12:00:00Z' }); await f.app.syncPayment('123');
  assert.equal(f.store.get('SELECT payment_status FROM orders').payment_status, 'approved');
});
test('retry with a new provider payment ID does not regress a paid order', async t => {
  const f = await fixture(t); await f.order();
  f.setPayment({ status: 'rejected' }); await f.app.syncPayment('123');
  f.setPayment({ status: 'approved' }); await f.app.syncPayment('124');
  f.setPayment({ status: 'pending' }); await f.app.syncPayment('125');
  assert.equal(f.store.get('SELECT payment_status FROM orders').payment_status, 'approved');
  assert.equal(f.store.get('SELECT count(*) n FROM payment_attempts').n, 3);
});
test('admin sessions, CSRF, validated fulfillment transitions and tracking allowlist', async t => {
  const f = await fixture(t), o = await f.order();
  const path = '/api/admin/orders/' + o.result.reference + '/status';
  assert.equal((await f.request(path, { status: 'shipped' })).status, 401);
  const login = await f.login(); assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await f.request(path, { status: 'preparing' }, { useCookie: true })).status, 409);
  assert.equal((await f.request(path, { status: 'preparing' }, { useCookie: true, origin: 'https://evil.test' })).status, 403);
  f.setPayment({ status: 'approved' }); await f.app.syncPayment('123');
  assert.equal((await f.request(path, { status: 'shipped' }, { useCookie: true })).status, 409);
  assert.equal((await f.request(path, { status: 'production' }, { useCookie: true })).status, 409);
  assert.equal((await f.request(path, { status: 'preparing' }, { useCookie: true })).status, 200);
  assert.equal((await f.request(path, { status: 'shipped', trackingCode: 'TESTONLY', trackingURL: 'https://evil.test' }, { useCookie: true })).status, 422);
  assert.equal((await f.request(path, { status: 'shipped', trackingCode: 'TESTONLY', trackingURL: 'https://rastreamento.correios.com.br/app/index.php' }, { useCookie: true })).status, 200);
  assert.equal((await f.request(path, { status: 'delivered' }, { useCookie: true })).status, 200);
  assert.equal((await f.request(path, { status: 'preparing' }, { useCookie: true })).status, 409);
  await f.request('/api/admin/logout', {}, { useCookie: true }); assert.equal((await f.request('/api/admin/orders', null, { useCookie: true })).status, 401);
});
test('refund comes from provider and cancellation remains terminal', async t => {
  const f = await fixture(t), o = await f.order();
  f.setPayment({ status: 'approved' }); await f.app.syncPayment('123'); await f.login();
  assert.equal((await f.request('/api/admin/orders/' + o.result.reference + '/cancel', {}, { useCookie: true })).status, 409);
  assert.equal((await f.request('/api/admin/orders/' + o.result.reference + '/refund', {}, { useCookie: true })).status, 200);
  assert.equal(f.store.get('SELECT payment_status FROM orders').payment_status, 'refunded');
  assert.equal(f.store.get('SELECT fulfillment_status FROM orders').fulfillment_status, 'cancelled');
});
test('public production configuration fails closed and DEV is rejected', async t => {
  const db = openStore(':memory:'); t.after(() => db.db.close());
  assert.throws(() => createCommerce({ store: db, env: { NODE_ENV: 'production' } }));
  const f = await fixture(t, { env: { NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://shop.example.test' } });
  const input = await f.quote();
  assert.equal((await f.request('/api/checkout/review', { ...input, coupon: 'DEV' })).status, 422);
  const login = await f.login(); assert.match(login.headers.get('set-cookie'), /Secure/);
  assert.equal(f.app.cart(lines).subtotal, 6000);
  const review = require('../js/commerce').summary(lines, catalog, 'DEV', require('../js/coupons'));
  assert.equal(review.coupon.valid, false);
});
test('provider official API structure, idempotency and sanitized errors', async () => {
  const env = { MP_ACCESS_TOKEN: 'TEST-secret', MP_WEBHOOK_SECRET: 'secret', MP_MODE: 'sandbox', PUBLIC_BASE_URL: 'https://shop.example.test' };
  let call;
  const mp = mercadoPago(env, async (url, options) => { call = { url, options }; return { ok: true, json: async () => ({ id: 'p1', sandbox_init_point: 'https://sandbox.mercadopago.com.br/checkout/test' }) }; });
  const result = await mp.preference({ id: 'internal', reference: 'public', total: 7500, customer: JSON.stringify(customer) }, { operation_key: 'key' });
  assert.match(result.url, /sandbox/); assert.equal(call.options.headers['X-Idempotency-Key'], 'key');
  const body = JSON.parse(call.options.body); assert.equal(body.items[0].unit_price, 75); assert.equal(body.external_reference, 'internal'); assert.equal(body.notification_url, env.PUBLIC_BASE_URL + '/api/webhooks/mercadopago');
  const failed = mercadoPago(env, async () => { throw Error('secret-provider-payload'); });
  await assert.rejects(failed.payment('123'), error => error.status === 502 && !error.message.includes('secret-provider'));
  assert.equal(mercadoPago({ ...env, MP_MODE: 'production' }).configured, false);
  assert.equal(signatureValid({}, '123', 'secret'), false);
});
test('quote endpoint rate limits abuse', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 10; i++) await f.request('/api/shipping/quotes', { lines, destinationCEP: '53110000' });
  assert.equal((await f.request('/api/shipping/quotes', { lines, destinationCEP: '53110000' })).status, 429);
});

test('shipping adapter uses authoritative measured outer package and actual provider custom values', async () => {
  const { melhorEnvio, parseCents } = require('../server/shipping.cjs');
  assert.equal(parseCents('12.34'), 1234); assert.equal(parseCents('-1'), null); assert.equal(parseCents('1.234'), null);
  const env = { ME_MODE: 'sandbox', ME_TOKEN: 'test-only-token', ME_USER_AGENT: 'Fixture (test@example.test)', ME_SERVICES: '1,2', SHIPPING_PACKAGING_JSON: JSON.stringify({ strategy: 'approved-recipes', recipes: [{ items: { book: 2, combo: 1 }, tareGrams: 50, lengthCm: 25, widthCm: 20, heightCm: 10 }] }) };
  const products = catalog.map(p => ({ ...p, productionDays: 3, shipping: { eligible: true, weightGrams: 100, lengthCm: 10, widthCm: 8, heightCm: 2 } }));
  const order = require('../js/commerce').summary([{ id: 'book', quantity: 2 }, { id: 'combo', quantity: 1 }], products, '', []);
  let sent;
  const provider = melhorEnvio(env, async (url, options) => { sent = { url, options }; return { ok: true, json: async () => [
    { id: 1, name: 'Teste', company: { name: 'Transportadora de teste' }, custom_price: '12.34', price: '0.01', custom_delivery_time: 5 },
    { id: 2, error: 'unavailable' }, { id: 3, name: 'Not authorized', company: { name: 'Fake' }, custom_price: '1.00', custom_delivery_time: 1 },
  ] }; });
  const result = await provider.quote(order, '01001000'); assert.equal(result.options.length, 1); assert.equal(result.options[0].priceCents, 1234); assert.equal(result.source, 'melhorenvio-sandbox');
  const payload = JSON.parse(sent.options.body); assert.equal(payload.from.postal_code, '53110000'); assert.equal(payload.volumes[0].weight, .35); assert.equal(payload.volumes[0].length, 25); assert.equal(payload.volumes[0].insurance, 130.05);
  assert.equal(result.options[0].productionDays, 3); assert.equal(sent.options.headers.Authorization, 'Bearer test-only-token');
  const missing = melhorEnvio({}); assert.equal(missing.configured, false); assert.equal((await missing.quote(order, '01001000')).options.length, 0);
  const failed = melhorEnvio(env, async () => { throw Error('private-provider-error'); }); const fallback = await failed.quote(order, '01001000'); assert.equal(fallback.options.length, 0); assert.ok(!fallback.reason.includes('private-provider'));
  const invalid = { ...order, entries: order.entries.map(e => ({ ...e, quantity: 3 })) }; assert.equal((await provider.quote(invalid, '01001000')).options.length, 0);
  assert.equal(melhorEnvio({ ...env, NODE_ENV: 'production' }).configured, false);
});
test('partially refunded payments are not presented as fully paid or payable again', async t => {
  const f = await fixture(t), o = await f.order();
  f.setPayment({ status: 'approved', transaction_amount_refunded: 10 }); await f.app.syncPayment('123');
  assert.equal(f.store.get('SELECT payment_status FROM orders').payment_status, 'partially_refunded');
  assert.equal((await f.request('/api/orders/' + o.result.reference + '/payment', {}, { auth: o.result.token })).status, 409);
});
test('automatic quote selection changes authoritative totals and rejects stale review', async t => {
  const f = await fixture(t, { shippingProvider: { configured: true, quote: async () => ({ source: 'melhorenvio', package: { weightGrams: 100, lengthCm: 20, widthCm: 15, heightCm: 5 }, options: [
    { code: '1', name: 'Fixture A', priceCents: 1234, deliveryDays: 5, productionDays: 0 },
    { code: '2', name: 'Fixture B', priceCents: 2345, deliveryDays: 2, productionDays: 0 },
  ] }) } });
  const quote = await f.request('/api/shipping/quotes', { lines, destinationCEP: '53110000' }); assert.equal(quote.data.status, 'approved');
  const input = { lines, destinationCEP: '53110000', quoteId: quote.data.id, quoteToken: quote.data.token };
  const first = await f.request('/api/checkout/review', input); assert.equal(first.data.total, 7234);
  assert.equal((await f.request('/api/shipping/quotes/' + quote.data.id, { serviceCode: '2' }, { auth: quote.data.token })).status, 200);
  const updated = await f.request('/api/checkout/review', input); assert.equal(updated.data.total, 8345);
  assert.equal((await f.request('/api/orders', { ...input, reviewHash: first.data.reviewHash, customer }, { key: randomUUID() })).status, 409);
  assert.equal((await f.request('/api/shipping/quotes/' + quote.data.id, { serviceCode: 'fake', priceCents: 0 }, { auth: quote.data.token })).status, 409);
});
test('expired checkout renews only after reconciliation with no pending or paid attempts', async t => {
  const f = await fixture(t), o = await f.order();
  f.provider.search = async () => ({ results: [], paging: { total: 0 } });
  let index = 0;
  f.provider.preference = async () => ({ id: 'expiry-test-' + ++index, url: 'https://www.mercadopago.com.br/test-expiry-' + index });
  const path = '/api/orders/' + o.result.reference + '/payment';
  assert.equal((await f.request(path, {}, { auth: o.result.token })).status, 200);
  f.advance(86400001);
  const renewed = await f.request(path, {}, { auth: o.result.token }); assert.equal(renewed.status, 200); assert.equal(index, 2);
  f.setPayment({ status: 'pending' }); await f.app.syncPayment('123'); f.advance(86400001);
  assert.equal((await f.request(path, {}, { auth: o.result.token })).status, 409); assert.equal(index, 2);
});
test('SQLite migrations are repeatable and data survives closing and reopening', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-commerce-test-'));
  const filename = path.join(directory, 'test.sqlite');
  let store;
  try {
    store = openStore(filename); store.run('INSERT INTO admin_sessions(token_hash,expires_at) VALUES(?,?)', hash('fixture-only'), Date.now() + 60000); store.db.close();
    store = openStore(filename); assert.equal(store.get('SELECT count(*) n FROM schema_migrations').n, 3); assert.equal(store.get('SELECT count(*) n FROM admin_sessions').n, 1); store.db.close(); store = null;
  } finally {
    if (store) { try { store.db.close(); } catch (_) {} }
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(filename + suffix, { force: true });
    fs.rmdirSync(directory);
  }
});

test('WhatsApp-only deployed policy rejects public order creation and payment even with a configured provider', async t => {
  const f = await fixture(t, { salesChannel: 'whatsapp' });
  const health = await f.request('/api/health');
  assert.equal(health.data.salesChannel, 'whatsapp'); assert.equal(health.data.paymentConfigured, false);
  for (const path of ['/api/orders', '/api/checkout/review', '/api/orders/PRE-NOT-AN-ORDER/payment']) {
    const result = await f.request(path, { customer, lines, total: 1 }, { key: randomUUID() });
    assert.equal(result.status, 410); assert.match(result.data.error, /WhatsApp/);
  }
  assert.equal(f.preferenceCalls, 0); assert.equal(f.paymentCalls, 0);
  assert.equal(f.store.get('SELECT count(*) n FROM orders').n, 0);
});
