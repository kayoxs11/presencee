const { createHmac, timingSafeEqual } = require('node:crypto');
function signatureValid(headers, id, secret, now = Date.now()) {
  if (!secret || !id || !headers['x-request-id']) return false;
  const fields = Object.fromEntries(String(headers['x-signature'] || '').split(',').map(s => s.trim().split('=')));
  if (!/^\d+$/.test(fields.ts || '') || !/^[a-f0-9]{64}$/.test(fields.v1 || '')) return false;
  const timestamp = Number(fields.ts) * (fields.ts.length <= 10 ? 1000 : 1);
  if (Math.abs(now - timestamp) > 300000) return false;
  const expected = createHmac('sha256', secret).update(`id:${String(id).toLowerCase()};request-id:${headers['x-request-id']};ts:${fields.ts};`).digest();
  return timingSafeEqual(expected, Buffer.from(fields.v1, 'hex'));
}
function mercadoPago(env, fetcher = fetch) {
  const configured = !!env.MP_ACCESS_TOKEN && !!env.MP_WEBHOOK_SECRET && ['sandbox', 'production'].includes(env.MP_MODE) &&
    (env.MP_MODE !== 'production' || env.NODE_ENV === 'production') && /^https:\/\//.test(env.PUBLIC_BASE_URL || '');
  async function request(route, method = 'GET', body, key) {
    if (!configured) throw Object.assign(new Error('Pagamento indisponível. A loja precisa configurar o Mercado Pago.'), { status: 503 });
    let response;
    try {
      response = await fetcher('https://api.mercadopago.com' + route, {
        method, signal: AbortSignal.timeout(12000),
        headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json', ...(key ? { 'X-Idempotency-Key': key } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      if (!response.ok) throw new Error('provider');
      return await response.json();
    } catch (_) { throw Object.assign(new Error('O Mercado Pago não respondeu. Tente novamente; o pedido foi preservado.'), { status: 502 }); }
  }
  return { configured,
    async preference(order, payment) {
      const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
      const expiresAt = Date.now() + 86400000;
      const result = await request('/checkout/preferences', 'POST', {
        external_reference: order.id,
        items: [{ id: order.reference, title: `Pedido Presença ${order.reference}`, quantity: 1, currency_id: 'BRL', unit_price: order.total / 100 }],
        payer: { email: JSON.parse(order.customer).email },
        back_urls: { success: base + '/tracking.html', pending: base + '/tracking.html', failure: base + '/tracking.html' },
        notification_url: base + '/api/webhooks/mercadopago',
        expires: true, expiration_date_from: new Date().toISOString(), expiration_date_to: new Date(expiresAt).toISOString(),
        metadata: { order_id: order.id },
      }, payment.operation_key);
      const url = env.MP_MODE === 'sandbox' ? result.sandbox_init_point : result.init_point;
      if (!result.id || !/^https:\/\/[\w.-]*mercadopago\.(com|com\.br)\//.test(url || '')) throw Object.assign(new Error('Resposta de pagamento inválida.'), { status: 502 });
      return { id: result.id, url, expiresAt };
    },
    payment: id => request('/v1/payments/' + encodeURIComponent(id)),
    search: id => request('/v1/payments/search?sort=date_created&criteria=desc&limit=100&external_reference=' + encodeURIComponent(id)),
    refund: (id, key) => request('/v1/payments/' + encodeURIComponent(id) + '/refunds', 'POST', {}, key),
    cancel: (id, key) => request('/v1/payments/' + encodeURIComponent(id), 'PUT', { status: 'cancelled' }, key),
  };
}
module.exports = { mercadoPago, signatureValid };
