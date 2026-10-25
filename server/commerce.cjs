const crypto = require('node:crypto');
const commerce = require('../js/commerce');
const shipping = require('../js/shipping');
const defaultCatalog = require('../js/catalog').PRODUCTS;
const rules = require('../js/coupons');
const { mercadoPago, signatureValid } = require('./providers.cjs');
const { melhorEnvio } = require('./shipping.cjs');
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const labels = { received: 'Pedido recebido', production: 'Em produção', preparing: 'Preparando envio', shipped: 'Enviado', delivered: 'Entregue', cancelled: 'Cancelado', pending: 'Aguardando confirmação do pagamento', approved: 'Pagamento confirmado', rejected: 'Pagamento recusado', refunded: 'Pagamento reembolsado', partially_refunded: 'Pagamento parcialmente reembolsado — fale com a loja', in_process: 'Pagamento em análise', in_mediation: 'Pagamento em mediação', charged_back: 'Pagamento contestado', authorized: 'Pagamento autorizado, aguardando captura' };
function text(value, field, max = 160, optional = false) {
  if (optional && (value == null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f]/.test(value)) fail(422, `Confira o campo ${field}.`);
  return value.trim();
}
function customerInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !input.address || typeof input.address !== 'object' || Array.isArray(input.address)) fail(422, 'Preencha seus dados e endereço completos.');
  const address = input.address || {};
  const email = text(input.email, 'e-mail', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(422, 'Informe um e-mail válido.');
  const phone = text(input.phone, 'telefone', 30).replace(/\D/g, '');
  if (!/^\d{10,13}$/.test(phone)) fail(422, 'Informe um telefone com DDD.');
  const cep = shipping.normalizeCEP(address.cep);
  if (!cep) fail(422, 'Informe um CEP válido com 8 dígitos.');
  const state = text(address.state, 'UF', 2).toUpperCase();
  if (!'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(state)) fail(422, 'Informe uma UF válida.');
  return { name: text(input.name, 'nome', 120), email, phone, address: { cep, street: text(address.street, 'rua'), number: text(address.number, 'número', 20), complement: text(address.complement, 'complemento', 120, true), neighborhood: text(address.neighborhood, 'bairro'), city: text(address.city, 'cidade'), state } };
}
function createCommerce({ store, env = process.env, catalog = defaultCatalog, provider = mercadoPago(env), shippingProvider = melhorEnvio(env), now = () => Date.now(), salesChannel = 'whatsapp' }) {
  const production = env.NODE_ENV === 'production';
  const base = env.PUBLIC_BASE_URL || 'http://127.0.0.1:8010';
  if (production && (!/^https:\/\//.test(base) || !env.ADMIN_PASSWORD_HASH || (env.ORDER_ACCESS_SECRET || '').length < 32)) throw new Error('Configure PUBLIC_BASE_URL HTTPS, ADMIN_PASSWORD_HASH e ORDER_ACCESS_SECRET (mínimo 32 caracteres).');
  const accessSecret = env.ORDER_ACCESS_SECRET || crypto.randomBytes(32).toString('hex');
  const orderToken = id => crypto.createHmac('sha256', accessSecret).update('order:' + id).digest('base64url');
  const locks = new Map(), limits = new Map();
  function limit(key, max = 60) {
    const time = now();
    if (limits.size > 10000) for (const [k, entry] of limits) if (entry.until < time) limits.delete(k);
    let entry = limits.get(key);
    if (!entry || entry.until < time) { entry = { count: 0, until: time + 60000 }; limits.set(key, entry); }
    if (++entry.count > max) fail(429, 'Muitas tentativas. Aguarde um minuto.');
  }
  async function locked(key, fn) {
    if (locks.has(key)) return locks.get(key);
    const pending = Promise.resolve().then(fn); locks.set(key, pending);
    try { return await pending; } finally { locks.delete(key); }
  }
  function cart(input) {
    if (!Array.isArray(input) || !input.length || input.length > 100) fail(422, 'Adicione de 1 a 100 itens ao carrinho.');
    const result = commerce.summary(input, catalog, '', rules);
    if (result.notices.length || result.lines.length !== input.length || result.count > 500 || result.subtotal > 100000000) fail(422, 'O carrinho mudou ou contém itens inválidos. Revise os produtos, opções e quantidades.');
    return result;
  }
  const fingerprint = (order, destination) => hash(JSON.stringify({ destination, items: order.entries.map(e => [e.id, e.quantity, e.variant, e.note, e.unit, e.product.shipping]) }));
  function quoteFor(input, order) {
    if (typeof input.quoteId !== 'string' || typeof input.quoteToken !== 'string') fail(409, 'Solicite uma cotação válida para este carrinho e CEP.');
    const quote = store.get('SELECT * FROM shipping_quotes WHERE id=?', input.quoteId);
    if (!quote || quote.token_hash !== hash(input.quoteToken || '') || quote.status !== 'approved' || quote.expires_at <= now() || quote.fingerprint !== fingerprint(order, shipping.normalizeCEP(input.destinationCEP))) fail(409, 'Solicite uma cotação válida para este carrinho e CEP.');
    return quote;
  }
  function review(input) {
    const order = cart(input.lines), quote = quoteFor(input, order);
    if (quote.source === 'melhorenvio-sandbox' && env.MP_MODE === 'production') fail(409, 'Uma cotação de teste não pode ser usada com pagamento real. Solicite outra cotação.');
    const context = { quoteId: quote.id, destinationCEP: quote.destination, serviceCode: quote.service, expiresAt: quote.expires_at, priceCents: quote.price_cents };
    const result = commerce.summary(order.lines, catalog, input.coupon, rules, now(), context);
    if (input.coupon && !result.coupon?.valid) fail(422, result.coupon?.message || 'Cupom inválido.');
    if (!Number.isSafeInteger(result.estimatedTotal) || result.estimatedTotal <= 0) fail(422, 'Total inválido.');
    return { items: result.entries.map(e => ({ id: e.id, name: e.product.name, quantity: e.quantity, variant: e.variant, note: e.note, unit: e.unit, subtotal: e.subtotal, personalized: !!e.product.personalizable })),
      subtotal: result.subtotal, discount: result.discount, shippingCost: result.shippingCost, shippingDiscount: result.shippingDiscount, total: result.estimatedTotal,
      coupon: result.coupon?.code || '', quoteId: quote.id, shipping: { service: quote.service, deliveryDays: quote.delivery_days, productionDays: quote.production_days, destinationCEP: quote.destination, expiresAt: quote.expires_at, source: quote.source, package: quote.package ? JSON.parse(quote.package) : null } };
  }
  function history(id, kind, status, actor) {
    store.run('INSERT INTO order_history(order_id,kind,status,actor,created_at) VALUES(?,?,?,?,?)', id, kind, status, actor, now());
  }
  function fullOrder(order, admin = false) {
    const result = { reference: order.reference, createdAt: order.created_at, updatedAt: order.updated_at, paymentStatus: order.payment_status, fulfillmentStatus: order.fulfillment_status,
      subtotal: order.subtotal, discount: order.discount, shippingCost: order.shipping_cost, shippingDiscount: order.shipping_discount, total: order.total, coupon: order.coupon,
      shipping: JSON.parse(order.shipping), trackingCode: order.tracking_code, trackingURL: order.tracking_url,
      items: store.all('SELECT snapshot FROM order_items WHERE order_id=? ORDER BY position', order.id).map(row => JSON.parse(row.snapshot)),
      history: store.all('SELECT kind,status,created_at FROM order_history WHERE order_id=? ORDER BY id', order.id), labels,
      accessExpiresAt: order.access_expires };
    if (admin) Object.assign(result, { id: order.id, customer: JSON.parse(order.customer), payment: store.get('SELECT provider_id,status,preference_id FROM payments WHERE order_id=?', order.id), paymentAttempts: store.all('SELECT provider_id,status,provider_updated FROM payment_attempts WHERE order_id=? ORDER BY provider_updated', order.id) });
    return result;
  }
  function publicOrder(reference, authorization) {
    const order = store.get('SELECT * FROM orders WHERE reference=?', reference);
    const credential = String(authorization || '').replace(/^Bearer /, '');
    if (!order || order.token_hash !== hash(credential) || order.access_expires <= now()) fail(404, 'Pedido não encontrado ou acesso expirado. Confira sua referência e chave de acesso ou entre em contato com a loja.');
    return order;
  }
  function admin(req) {
    const cookie = /(?:^|; )presence_admin=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
    if (!cookie || !store.get('SELECT token_hash FROM admin_sessions WHERE token_hash=? AND expires_at>?', hash(cookie), now())) fail(401, 'Entre como administrador.');
  }
  function checkPassword(password) {
    const [salt, digest] = (env.ADMIN_PASSWORD_HASH || '').split(':');
    if (!/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(digest || '') || typeof password !== 'string' || password.length > 200) return false;
    return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), crypto.scryptSync(password, salt, 64));
  }
  async function syncPayment(id) {
    if (!/^\d{1,30}$/.test(String(id))) fail(400, 'Identificador de pagamento inválido.');
    const payment = await provider.payment(String(id));
    const order = store.get('SELECT * FROM orders WHERE id=?', payment.external_reference || '');
    if (!order || String(payment.id) !== String(id)) fail(422, 'Pagamento não corresponde a um pedido.');
    if (payment.currency_id !== 'BRL' || !Number.isFinite(payment.transaction_amount) || Math.abs(payment.transaction_amount * 100 - order.total) > .001 || typeof payment.live_mode !== 'boolean' || payment.live_mode !== (env.MP_MODE === 'production')) fail(422, 'Pagamento não corresponde ao valor ou ambiente do pedido.');
    if (!Object.hasOwn(labels, payment.status) || !['pending','approved','rejected','cancelled','refunded','in_process','in_mediation','charged_back','authorized'].includes(payment.status)) fail(422, 'Estado de pagamento desconhecido.');
    const updated = Date.parse(payment.date_last_updated);
    if (!Number.isFinite(updated)) fail(502, 'Atualização do pagamento inválida.');
    const refunded = payment.transaction_amount_refunded ?? 0;
    if (!Number.isFinite(refunded) || refunded < 0 || refunded * 100 > order.total + .001) fail(502, 'Valor de reembolso inválido.');
    const paymentState = payment.status === 'approved' && refunded > 0 ? 'partially_refunded' : payment.status;
    store.transaction(() => {
      const saved = store.get('SELECT * FROM payment_attempts WHERE provider_id=?', String(id));
      if (saved && (saved.order_id !== order.id || updated < saved.provider_updated)) return;
      store.run('INSERT INTO payment_attempts(provider_id,order_id,status,provider_updated,refund_key) VALUES(?,?,?,?,?) ON CONFLICT(provider_id) DO UPDATE SET status=excluded.status,provider_updated=excluded.provider_updated', String(id), order.id, paymentState, updated, crypto.randomUUID());
      const attempts = store.all('SELECT * FROM payment_attempts WHERE order_id=? ORDER BY provider_updated DESC', order.id);
      const active = attempts.find(p => ['approved','partially_refunded'].includes(p.status)) || attempts.find(p => ['refunded','charged_back'].includes(p.status)) || attempts[0];
      store.run('UPDATE payments SET provider_id=?,status=?,provider_updated=? WHERE order_id=?', active.provider_id, active.status, active.provider_updated, order.id);
      if (order.payment_status !== active.status) {
        store.run('UPDATE orders SET payment_status=?,updated_at=? WHERE id=?', active.status, now(), order.id);
        history(order.id, 'payment', active.status, 'mercadopago');
      }
      // Cancellation never reactivates fulfillment, even after a delayed approval.
      if (['refunded','charged_back'].includes(active.status) && order.fulfillment_status !== 'cancelled') {
        store.run("UPDATE orders SET fulfillment_status='cancelled',updated_at=? WHERE id=?", now(), order.id);
        history(order.id, 'fulfillment', 'cancelled', 'mercadopago');
      }
    });
    return payment;
  }
  async function reconcile(order) {
    if (provider.search) {
      const result = await provider.search(order.id);
      if (!Array.isArray(result.results) || result.paging?.total > 100) fail(502, 'Conciliação requer revisão manual no provedor.');
      for (const payment of result.results) await syncPayment(String(payment.id));
    } else {
      const saved = store.get('SELECT provider_id FROM payments WHERE order_id=?', order.id);
      if (saved.provider_id) await syncPayment(saved.provider_id);
    }
  }
  async function body(req) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'Envie dados no formato JSON.');
    let data = '', size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 65536) fail(413, 'Dados excedem o tamanho permitido.'); data += chunk; }
    try { const parsed = JSON.parse(data); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw Error(); return parsed; } catch (_) { fail(400, 'Dados inválidos.'); }
  }
  function send(res, status, data, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers }); res.end(JSON.stringify(data));
  }
  async function handle(req, res) {
    const url = new URL(req.url, base), route = url.pathname;
    if (!route.startsWith('/api/')) return false;
    try {
      const ip = req.socket.remoteAddress; // Never trust arbitrary X-Forwarded-For.
      limit(ip, route.includes('webhooks') ? 300 : 120);
      if (route === '/api/health' && req.method === 'GET') { send(res, 200, { ok: true, salesChannel, paymentConfigured: salesChannel !== 'whatsapp' && provider.configured, shipping: shippingProvider.configured ? 'melhorenvio' : 'manual', originCEP: shipping.ORIGIN_CEP }); return true; }
      const webhook = route === '/api/webhooks/mercadopago';
      if (!['GET','HEAD'].includes(req.method) && !webhook) {
        if (req.headers.origin !== new URL(base).origin || req.headers['x-presence-request'] !== '1') fail(403, 'Origem da solicitação inválida.');
      }
      // The deployed server uses WhatsApp sales only, regardless of provider credentials.
      // The legacy branch remains covered in isolated tests for existing database records.
      if (salesChannel === 'whatsapp' && req.method === 'POST' &&
          (['/api/orders', '/api/checkout/review'].includes(route) || /^\/api\/orders\/[^/]+\/payment$/.test(route))) {
        fail(410, 'As vendas são combinadas pelo WhatsApp. Este site não registra novos pedidos nem recebe pagamentos. Envie sua seleção e aguarde a confirmação da loja.');
      }
      if (route === '/api/checkout/cart' && req.method === 'POST') {
        const result = cart((await body(req)).lines);
        send(res, 200, { subtotal: result.subtotal, items: result.entries.map(e => ({ id: e.id, name: e.product.name, quantity: e.quantity, variant: e.variant, note: e.note, unit: e.unit, subtotal: e.subtotal })) }); return true;
      }
      if (webhook && req.method === 'POST') {
        const input = await body(req), id = url.searchParams.get('data.id');
        if (!signatureValid(req.headers, id, env.MP_WEBHOOK_SECRET, now()) || String(input.data?.id) !== id || input.type !== 'payment') fail(401, 'Notificação inválida.');
        const event = hash(`${id}:${req.headers['x-request-id']}:${req.headers['x-signature']}`);
        if (!store.get('SELECT id FROM webhook_events WHERE id=?', event)) {
          await locked('webhook:' + id, () => syncPayment(id));
          store.run('INSERT OR IGNORE INTO webhook_events(id,payment_id,processed_at) VALUES(?,?,?)', event, id, now());
        }
        send(res, 200, { received: true }); return true;
      }
      if (route === '/api/admin/login' && req.method === 'POST') {
        limit('login:' + ip, 5);
        const input = await body(req);
        if (!checkPassword(input.password)) fail(401, 'Credenciais inválidas.');
        const session = token();
        store.run('DELETE FROM admin_sessions WHERE expires_at<=?', now());
        store.run('INSERT INTO admin_sessions(token_hash,expires_at) VALUES(?,?)', hash(session), now() + 28800000);
        send(res, 200, { ok: true }, { 'Set-Cookie': `presence_admin=${session}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=28800${production ? '; Secure' : ''}` }); return true;
      }
      if (route.startsWith('/api/admin/')) {
        admin(req);
        if (route === '/api/admin/logout' && req.method === 'POST') {
          const cookie = /presence_admin=([^;]+)/.exec(req.headers.cookie || '')?.[1];
          store.run('DELETE FROM admin_sessions WHERE token_hash=?', hash(cookie));
          send(res, 200, { ok: true }, { 'Set-Cookie': 'presence_admin=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0' }); return true;
        }
        if (route === '/api/admin/quotes' && req.method === 'GET') {
          send(res, 200, { quotes: store.all('SELECT id,destination,items,status,created_at,expires_at FROM shipping_quotes WHERE expires_at>? ORDER BY created_at DESC LIMIT 100', now()).map(q => ({ ...q, items: JSON.parse(q.items) })) }); return true;
        }
        const quoteId = /^\/api\/admin\/quotes\/([\w-]+)$/.exec(route)?.[1];
        if (quoteId && req.method === 'POST') {
          const input = await body(req), quote = store.get('SELECT * FROM shipping_quotes WHERE id=?', quoteId);
          if (!quote || quote.status !== 'pending' || quote.expires_at <= now()) fail(409, 'Cotação indisponível.');
          if (!Number.isSafeInteger(input.priceCents) || input.priceCents < 0 || input.priceCents > 10000000 || !Number.isInteger(input.deliveryDays) || input.deliveryDays < 1 || input.deliveryDays > 365 || !Number.isInteger(input.productionDays) || input.productionDays < 0 || input.productionDays > 365) fail(422, 'Informe preço em centavos, prazo de entrega e produção válidos.');
          const service = text(input.service, 'serviço'), evidence = text(input.evidence, 'comprovante/origem da cotação', 500);
          store.run("UPDATE shipping_quotes SET status='approved',service=?,price_cents=?,delivery_days=?,production_days=?,evidence=?,expires_at=? WHERE id=?", service, input.priceCents, input.deliveryDays, input.productionDays, evidence, now() + 3600000, quoteId);
          send(res, 200, { ok: true }); return true;
        }
        if (route === '/api/admin/orders' && req.method === 'GET') {
          const from = url.searchParams.get('from'), to = url.searchParams.get('to');
          const rows = store.all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 1000');
          const q = (url.searchParams.get('q') || '').toLowerCase();
          send(res, 200, { orders: rows.filter(o => (!q || (o.reference + o.customer).toLowerCase().includes(q)) && (!url.searchParams.get('payment') || o.payment_status === url.searchParams.get('payment')) && (!url.searchParams.get('status') || o.fulfillment_status === url.searchParams.get('status')) && (!from || o.created_at >= Date.parse(from)) && (!to || o.created_at < Date.parse(to) + 86400000)).slice(0, 100).map(o => ({ reference: o.reference, customer: JSON.parse(o.customer).name, total: o.total, paymentStatus: o.payment_status, fulfillmentStatus: o.fulfillment_status, createdAt: o.created_at })) }); return true;
        }
        const match = /^\/api\/admin\/orders\/([\w-]+)(?:\/(status|refund|cancel|sync|access))?$/.exec(route);
        if (match) {
          const order = store.get('SELECT * FROM orders WHERE reference=?', match[1]);
          if (!order) fail(404, 'Pedido não encontrado.');
          if (req.method === 'GET' && !match[2]) { send(res, 200, fullOrder(order, true)); return true; }
          if (req.method === 'POST') {
            const input = await body(req);
            const action = match[2];
            if (action === 'access') {
              // Staff must verify customer identity before supplying a renewed link.
              store.run('UPDATE orders SET access_expires=? WHERE id=?', now() + 30 * 86400000, order.id);
              history(order.id, 'access', 'renewed', 'admin');
              send(res, 200, { reference: order.reference, token: orderToken(order.id) }); return true;
            }
            if (['refund','cancel','sync'].includes(action)) {
              await locked('payment:' + order.id, async () => {
                if (provider.configured) await reconcile(order);
                const payment = store.get('SELECT * FROM payments WHERE order_id=?', order.id);
                if (action === 'sync') {
                  if (!provider.configured) fail(503, 'Configure o Mercado Pago para consultar pagamentos.');
                } else if (payment.provider_id) {
                  const current = await syncPayment(payment.provider_id);
                  const attempt = store.get('SELECT * FROM payment_attempts WHERE provider_id=?', payment.provider_id);
                  if (action === 'refund' && current.status === 'approved') await provider.refund(payment.provider_id, attempt.refund_key);
                  else if (action === 'cancel' && ['pending','in_process','authorized'].includes(current.status)) await provider.cancel(payment.provider_id, payment.refund_key);
                  else if (!['refunded','cancelled','rejected'].includes(current.status)) fail(409, 'Ação incompatível com o pagamento. Reembolse pagamentos aprovados.');
                  await syncPayment(payment.provider_id);
                } else if (payment.preference_id) {
                  fail(409, 'Existe checkout no provedor. Identifique/cancele o pagamento no Mercado Pago e aguarde o webhook antes de cancelar.');
                } else if (action === 'refund') fail(409, 'Não há pagamento para reembolsar.');
                const fresh = store.get('SELECT * FROM orders WHERE id=?', order.id);
                if ((action !== 'sync' && !['approved','in_process','authorized','pending'].includes(fresh.payment_status)) || (action === 'cancel' && !payment.preference_id && !payment.provider_id)) {
                  if (fresh.fulfillment_status !== 'cancelled') store.transaction(() => {
                    store.run("UPDATE orders SET fulfillment_status='cancelled',updated_at=? WHERE id=?", now(), order.id); history(order.id, 'fulfillment', 'cancelled', 'admin');
                  });
                }
              });
              send(res, 200, fullOrder(store.get('SELECT * FROM orders WHERE id=?', order.id), true)); return true;
            }
            if (action === 'status') {
              const transitions = { received: ['production','preparing'], production: ['preparing'], preparing: ['shipped'], shipped: ['delivered'], delivered: [], cancelled: [] };
              const fresh = store.get('SELECT * FROM orders WHERE id=?', order.id);
              const trackingOnly = input.status === fresh.fulfillment_status && ['shipped','delivered'].includes(input.status);
              if (fresh.payment_status !== 'approved' || (!trackingOnly && !transitions[fresh.fulfillment_status]?.includes(input.status))) fail(409, 'Transição inválida. Confirme o pagamento e respeite as etapas do pedido.');
              if (input.status === 'production' && !store.all('SELECT snapshot FROM order_items WHERE order_id=?', order.id).some(i => JSON.parse(i.snapshot).personalized)) fail(409, 'Este pedido não requer produção personalizada.');
              let code = fresh.tracking_code, trackingURL = fresh.tracking_url;
              if (input.status === 'shipped' || trackingOnly) {
                code = text(input.trackingCode, 'código de rastreio', 80);
                trackingURL = text(input.trackingURL, 'URL oficial de rastreio', 500);
                let target; try { target = new URL(trackingURL); } catch (_) { fail(422, 'Informe a URL oficial da transportadora.'); }
                const allowed = ['rastreamento.correios.com.br', ...(env.TRACKING_HOSTS || '').split(',').filter(Boolean)];
                if (target.protocol !== 'https:' || !allowed.includes(target.hostname) || target.username || target.password || target.port) fail(422, 'URL de transportadora não autorizada. Configure o domínio oficial no servidor.');
              }
              store.transaction(() => {
                store.run('UPDATE orders SET fulfillment_status=?,tracking_code=?,tracking_url=?,updated_at=? WHERE id=?', input.status, code, trackingURL, now(), order.id);
                history(order.id, trackingOnly ? 'tracking' : 'fulfillment', input.status, 'admin');
              });
              send(res, 200, fullOrder(store.get('SELECT * FROM orders WHERE id=?', order.id), true)); return true;
            }
          }
        }
        fail(404, 'Recurso não encontrado.');
      }
      if (route === '/api/shipping/quotes' && req.method === 'POST') {
        limit('quote:' + ip, 10);
        const input = await body(req), order = cart(input.lines), destination = shipping.normalizeCEP(input.destinationCEP);
        if (!destination) fail(422, 'Informe um CEP válido com 8 dígitos.');
        const id = crypto.randomUUID(), secret = token();
        store.run('INSERT INTO shipping_quotes(id,token_hash,fingerprint,destination,items,expires_at,created_at) VALUES(?,?,?,?,?,?,?)', id, hash(secret), fingerprint(order, destination), destination, JSON.stringify(order.entries.map(e => ({ id: e.id, name: e.product.name, quantity: e.quantity, variant: e.variant, note: e.note, shipping: e.product.shipping }))), now() + 7 * 86400000, now());
        const result = await shippingProvider.quote(order, destination);
        if (result.options.length) {
          const selected = result.options[0];
          store.run("UPDATE shipping_quotes SET status='approved',source=?,options=?,package=?,service=?,price_cents=?,delivery_days=?,production_days=?,expires_at=? WHERE id=?", result.source, JSON.stringify(result.options), JSON.stringify(result.package), selected.name, selected.priceCents, selected.deliveryDays, selected.productionDays, now() + 15 * 60000, id);
          send(res, 201, { id, token: secret, status: 'approved', message: result.source === 'melhorenvio-sandbox' ? 'Cotação de TESTE no sandbox. Não representa frete comercial.' : 'Opções consultadas no Melhor Envio. Selecione o serviço e revise o pedido.' });
        } else send(res, 201, { id, token: secret, status: 'pending', message: `${result.reason} Cotação solicitada. A equipe verificará embalagem, restrições, preço e prazo reais antes de liberar o checkout.` });
        return true;
      }
      const quoteId = /^\/api\/shipping\/quotes\/([\w-]+)$/.exec(route)?.[1];
      if (quoteId && ['GET','POST'].includes(req.method)) {
        const quote = store.get('SELECT * FROM shipping_quotes WHERE id=?', quoteId);
        if (!quote || quote.token_hash !== hash(String(req.headers.authorization || '').replace(/^Bearer /, '')) || quote.expires_at <= now()) fail(404, 'Cotação não encontrada ou expirada.');
        if (req.method === 'POST') {
          const input = await body(req), selected = JSON.parse(quote.options).find(o => o.code === input.serviceCode);
          if (!selected || store.get('SELECT id FROM orders WHERE quote_id=?', quoteId)) fail(409, 'Serviço indisponível ou cotação já utilizada.');
          store.run('UPDATE shipping_quotes SET service=?,price_cents=?,delivery_days=?,production_days=? WHERE id=?', selected.name, selected.priceCents, selected.deliveryDays, selected.productionDays, quoteId);
          Object.assign(quote, { service: selected.name, price_cents: selected.priceCents, delivery_days: selected.deliveryDays, production_days: selected.productionDays });
        }
        send(res, 200, { id: quote.id, status: quote.status, source: quote.source, options: JSON.parse(quote.options), service: quote.service, priceCents: quote.price_cents, deliveryDays: quote.delivery_days, productionDays: quote.production_days, expiresAt: quote.expires_at }); return true;
      }
      if (route === '/api/checkout/review' && req.method === 'POST') { const result = review(await body(req)); send(res, 200, { ...result, reviewHash: hash(JSON.stringify(result)) }); return true; }
      if (route === '/api/orders' && req.method === 'POST') {
        limit('order:' + ip, 10);
        const input = await body(req), key = req.headers['idempotency-key'];
        if (!/^[\w-]{20,100}$/.test(key || '')) fail(422, 'Chave de envio inválida. Recarregue o checkout.');
        const customer = customerInput(input.customer), requestHash = hash(JSON.stringify(input));
        const existing = store.get('SELECT * FROM orders WHERE idempotency_hash=?', hash(key));
        if (existing) {
          if (existing.request_hash !== requestHash) fail(409, 'Este envio já foi usado com outros dados.');
          send(res, 200, { ...fullOrder(existing), token: orderToken(existing.id) }); return true;
        }
        const reviewed = review(input);
        if (reviewed.shipping.destinationCEP !== customer.address.cep) fail(409, 'O CEP do endereço deve corresponder à cotação.');
        if (input.reviewHash !== hash(JSON.stringify(reviewed))) fail(409, 'Revise os valores atualizados antes de confirmar.');
        const id = crypto.randomUUID(), reference = 'PRE-' + crypto.randomBytes(12).toString('hex').toUpperCase();
        store.transaction(() => {
          if (store.get('SELECT id FROM orders WHERE quote_id=?', reviewed.quoteId)) fail(409, 'Esta cotação já foi usada em um pedido.');
          store.run('INSERT INTO orders(id,reference,token_hash,access_expires,idempotency_hash,request_hash,quote_id,customer,subtotal,discount,shipping_cost,shipping_discount,total,coupon,shipping,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, reference, hash(orderToken(id)), now() + 30 * 86400000, hash(key), requestHash, reviewed.quoteId, JSON.stringify(customer), reviewed.subtotal, reviewed.discount, reviewed.shippingCost, reviewed.shippingDiscount, reviewed.total, reviewed.coupon, JSON.stringify(reviewed.shipping), now(), now());
          reviewed.items.forEach((item, position) => store.run('INSERT INTO order_items(order_id,position,snapshot) VALUES(?,?,?)', id, position, JSON.stringify(item)));
          store.run('INSERT INTO payments(order_id,operation_key,refund_key) VALUES(?,?,?)', id, crypto.randomUUID(), crypto.randomUUID());
          history(id, 'fulfillment', 'received', 'customer'); history(id, 'payment', 'pending', 'server');
        });
        send(res, 201, { ...fullOrder(store.get('SELECT * FROM orders WHERE id=?', id)), token: orderToken(id) }); return true;
      }
      const orderMatch = /^\/api\/orders\/([\w-]+)(?:\/(payment))?$/.exec(route);
      if (orderMatch) {
        const order = publicOrder(orderMatch[1], req.headers.authorization);
        if (req.method === 'GET' && !orderMatch[2]) { send(res, 200, fullOrder(order)); return true; }
        if (req.method === 'POST' && orderMatch[2] === 'payment') {
          await body(req);
          const result = await locked('payment:' + order.id, async () => {
            if (provider.configured) await reconcile(order);
            const fresh = store.get('SELECT * FROM orders WHERE id=?', order.id);
            if (fresh.fulfillment_status === 'cancelled' || ['approved','refunded','charged_back','partially_refunded'].includes(fresh.payment_status)) fail(409, 'Este pedido não permite um novo pagamento.');
            if (!provider.configured) fail(503, 'Pagamento indisponível. A loja precisa configurar o Mercado Pago. Seu pedido não foi pago.');
            const saved = store.get('SELECT * FROM payments WHERE order_id=?', order.id);
            // A single durable preference is reused for retries; never create another charge on a double click.
            if (saved.checkout_url && saved.preference_expires > now()) return { url: saved.checkout_url };
            if (saved.preference_id) {
              if (!provider.search || !saved.preference_expires || saved.preference_expires > now()) fail(409, 'A equipe precisa verificar o checkout anterior antes de retomar o pagamento.');
              if (store.all('SELECT status FROM payment_attempts WHERE order_id=?', order.id).some(p => ['pending','in_process','authorized','in_mediation'].includes(p.status))) fail(409, 'Há um pagamento em análise ou pendente. A equipe precisa conciliá-lo antes de criar outro checkout.');
              saved.operation_key = crypto.randomUUID();
              store.run('UPDATE payments SET operation_key=? WHERE order_id=?', saved.operation_key, order.id);
            }
            const preference = await provider.preference(fresh, saved);
            store.run('UPDATE payments SET preference_id=?,checkout_url=?,preference_expires=? WHERE order_id=?', preference.id, preference.url, preference.expiresAt || now() + 86400000, order.id);
            return { url: preference.url };
          });
          send(res, 200, result); return true;
        }
      }
      fail(404, 'Recurso não encontrado.');
    } catch (error) {
      send(res, error.status || 500, { error: error.status ? error.message : 'Não foi possível concluir. Tente novamente ou fale com a loja.' });
    }
    return true;
  }
  // Add an opaque version of the authoritative review for explicit customer confirmation.
  const originalReview = review;
  return { handle, review: input => { const result = originalReview(input); return { ...result, reviewHash: hash(JSON.stringify(result)) }; }, syncPayment, cart, store };
}
module.exports = { createCommerce, customerInput, hash, labels };
