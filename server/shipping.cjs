const shipping = require('../js/shipping');
function parseCents(value) {
  if (typeof value !== 'string' || !/^\d{1,7}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= 100000000 ? cents : null;
}
function melhorEnvio(env, fetcher = fetch) {
  let packaging, services;
  try { packaging = JSON.parse(env.SHIPPING_PACKAGING_JSON || '{}'); services = (env.ME_SERVICES || '').split(',').filter(code => /^\d{1,5}$/.test(code)); } catch (_) { packaging = {}; services = []; }
  const configured = !!env.ME_TOKEN && !!env.ME_USER_AGENT && services.length > 0 && services.length <= 20 &&
    ['sandbox','production'].includes(env.ME_MODE) && (env.NODE_ENV !== 'production' || env.ME_MODE === 'production');
  return { configured, async quote(order, destination) {
    if (!configured) return { options: [], reason: 'Cotação automática não configurada. A equipe pode consultar o frete manualmente.' };
    const packed = shipping.shipment(order.entries, packaging);
    if (!packed.reliable) return { options: [], reason: packed.reason };
    // Production times are actual owner configuration, not inferred from personalization.
    if (order.entries.some(e => !Number.isInteger(e.product.productionDays) || e.product.productionDays < 0 || e.product.productionDays > 365)) return { options: [], reason: 'O prazo de produção precisa ser confirmado pela loja.' };
    const productionDays = Math.max(...order.entries.map(e => e.product.productionDays));
    const p = packed.package;
    const base = env.ME_MODE === 'sandbox' ? 'https://sandbox.melhorenvio.com.br' : 'https://www.melhorenvio.com.br';
    try {
      const response = await fetcher(base + '/api/v2/me/shipment/calculate', {
        method: 'POST', signal: AbortSignal.timeout(8000),
        headers: { Authorization: 'Bearer ' + env.ME_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': env.ME_USER_AGENT },
        body: JSON.stringify({ from: { postal_code: shipping.ORIGIN_CEP }, to: { postal_code: destination },
          volumes: [{ width: p.widthCm, height: p.heightCm, length: p.lengthCm, weight: p.weightGrams / 1000, insurance: order.subtotal / 100 }],
          services: services.join(','), options: { receipt: false, own_hand: false } })
      });
      if (!response.ok) throw Error('provider');
      const data = await response.json();
      if (!Array.isArray(data)) throw Error('response');
      const seen = new Set();
      const options = data.flatMap(service => {
        const code = String(service.id), priceCents = parseCents(service.custom_price);
        const deliveryDays = service.custom_delivery_time;
        if (service.error || !services.includes(code) || seen.has(code) || priceCents == null || !Number.isInteger(deliveryDays) || deliveryDays < 0 || deliveryDays > 365 || typeof service.name !== 'string' || !service.name || typeof service.company?.name !== 'string' || !service.company.name) return [];
        seen.add(code);
        return [{ code, name: (service.company.name + ' · ' + service.name).slice(0, 160), priceCents, deliveryDays, productionDays }];
      });
      return { options, package: packed.package, source: env.ME_MODE === 'sandbox' ? 'melhorenvio-sandbox' : 'melhorenvio', reason: options.length ? '' : 'Nenhum serviço autorizado atendeu a este envio. Solicite a cotação manual.' };
    } catch (_) { return { options: [], reason: 'A consulta à transportadora está indisponível. A equipe pode realizar uma cotação manual.' }; }
  } };
}
module.exports = { melhorEnvio, parseCents };
