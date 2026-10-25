/* Pure shipping validation and a same-origin backend adapter. No Correios secrets. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PresenceShipping = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const ORIGIN_CEP = '53110000';
  function normalizeCEP(value) {
    if (typeof value !== 'string' || !/^\d{5}-?\d{3}$/.test(value.trim())) return null;
    const cep = value.trim().replace('-', '');
    return /^(\d)\1{7}$/.test(cep) ? null : cep;
  }
  const formatCEP = value => { const cep = normalizeCEP(value); return cep ? cep.slice(0, 5) + '-' + cep.slice(5) : ''; };
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100000;
  function shipment(entries, packaging) {
    const fail = reason => ({ reliable: false, reason });
    if (!entries.length) return fail('Adicione produtos ao carrinho antes de calcular o frete.');
    for (const entry of entries) {
      const data = entry.product.shipping;
      if (!data || data.eligible !== true) return fail('O envio destes produtos precisa de confirmação da Presence.');
      if (![data.weightGrams, data.lengthCm, data.widthCm, data.heightCm].every(positive)) return fail('Os pesos e medidas da embalagem precisam de confirmação da Presence.');
      if (!Number.isSafeInteger(data.weightGrams) || !Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > 99) return fail('Os dados do envio precisam de confirmação da Presence.');
    }
    if (packaging?.strategy !== 'approved-recipes') return fail('A embalagem final deste pedido precisa de confirmação da Presence.');
    const quantities = {};
    for (const entry of entries) quantities[entry.product.id] = (quantities[entry.product.id] || 0) + entry.quantity;
    // Owners approve exact combinations in one measured outer package. Dimensions
    // come from that package, never the sum of each item's three dimensions.
    const recipe = (packaging.recipes || []).find(recipe => recipe.items &&
      Object.keys(recipe.items).length === Object.keys(quantities).length &&
      Object.keys(quantities).every(id => recipe.items[id] === quantities[id]));
    if (!recipe || ![recipe.lengthCm, recipe.widthCm, recipe.heightCm].every(positive) || !Number.isSafeInteger(recipe.tareGrams) || recipe.tareGrams < 0) return fail('Não há uma embalagem validada para esta combinação. Solicite a cotação final.');
    // Each item's configured dimensions must fit the approved box. Exact packability
    // is verified physically by the owner when approving a recipe.
    const outer = [recipe.lengthCm, recipe.widthCm, recipe.heightCm].sort((a, b) => a - b);
    if (entries.some(entry => [entry.product.shipping.lengthCm, entry.product.shipping.widthCm, entry.product.shipping.heightCm].sort((a, b) => a - b).some((value, i) => value > outer[i]))) return fail('As medidas dos produtos não cabem na embalagem configurada. Solicite confirmação.');
    const weightGrams = entries.reduce((sum, entry) => sum + entry.product.shipping.weightGrams * entry.quantity, recipe.tareGrams);
    if (!Number.isSafeInteger(weightGrams) || weightGrams <= 0 || weightGrams > 100000) return fail('O peso final do envio precisa de confirmação.');
    return { reliable: true, package: { weightGrams, lengthCm: recipe.lengthCm, widthCm: recipe.widthCm, heightCm: recipe.heightCm } };
  }
  function fingerprint(order, cep, config) {
    return JSON.stringify({ origin: ORIGIN_CEP, destination: normalizeCEP(cep),
      items: order.entries.map(e => [e.id, e.quantity, e.variant, e.note, e.unit, e.product.shipping]),
      // A shipping waiver changes neither the parcel nor its merchandise value.
      // Exclude it to avoid invalidating the quote that makes it eligible.
      total: order.total, coupon: order.coupon?.valid && order.coupon.type !== 'shipping' ? order.coupon.code : '',
      packaging: config.packaging, services: config.enabledServices, endpoint: config.endpoint });
  }
  function validateResponse(data, request, services, now = Date.now()) {
    if (!data || data.source !== 'correios' || data.originCEP !== ORIGIN_CEP || data.destinationCEP !== request.destinationCEP ||
      data.fingerprint !== request.fingerprint || typeof data.quoteId !== 'string' || !data.quoteId || data.quoteId.length > 200 ||
      !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= now || Date.parse(data.expiresAt) > now + 3600000 || !Array.isArray(data.options) || !data.options.length || data.options.length > 20) throw new Error('INVALID_RESPONSE');
    const ids = new Set();
    const options = data.options.map(option => {
      if (!option || !services.includes(option.serviceCode) || ids.has(option.serviceCode) || typeof option.name !== 'string' || !option.name.trim() || option.name.length > 100 ||
        !Number.isSafeInteger(option.priceCents) || option.priceCents < 0 || option.priceCents > 100000000 ||
        (option.deliveryDays != null && (!Number.isInteger(option.deliveryDays) || option.deliveryDays < 1 || option.deliveryDays > 365))) throw new Error('INVALID_RESPONSE');
      ids.add(option.serviceCode);
      return { serviceCode: option.serviceCode, name: option.name.trim(), priceCents: option.priceCents, deliveryDays: option.deliveryDays ?? null };
    });
    return { quoteId: data.quoteId, expiresAt: Date.parse(data.expiresAt), options };
  }
  async function requestQuote(request, config, signal) {
    if (typeof config.endpoint !== 'string' || !config.endpoint) throw new Error('NOT_CONFIGURED');
    const endpoint = new URL(config.endpoint, location.origin);
    if (endpoint.origin !== location.origin || !/^https?:$/.test(endpoint.protocol) || endpoint.username || endpoint.password || !config.enabledServices.length) throw new Error('NOT_CONFIGURED');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(Math.max(config.timeoutMs || 8000, 50), 15000));
    try {
      const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'AUTH' : response.status === 400 || response.status === 422 ? 'DESTINATION' : response.status === 404 || response.status === 503 ? 'UNAVAILABLE' : 'API');
      return validateResponse(await response.json(), request, config.enabledServices);
    } catch (error) {
      if (timedOut) throw new Error('TIMEOUT');
      throw error;
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); }
  }
  const errorMessage = error => ({ AUTH: 'A consulta de frete está temporariamente indisponível.', DESTINATION: 'O serviço não atendeu este CEP. Confira o destino ou peça uma cotação.', UNAVAILABLE: 'Não há serviço disponível para este envio no momento.', TIMEOUT: 'A consulta demorou mais que o esperado. Tente novamente ou peça uma cotação.', INVALID_RESPONSE: 'Não foi possível confirmar os valores retornados.', NOT_CONFIGURED: 'A cotação automática ainda não está disponível.' }[error.message] || 'Não foi possível consultar o frete agora. Tente novamente ou peça uma cotação.');
  function quoteLines(state, money) {
    const selected = state?.selected;
    return [`Origem: ${formatCEP(ORIGIN_CEP)}`, `CEP de destino: ${formatCEP(state?.destination || '') || 'a informar'}`,
      ...(selected ? [`Frete: ${selected.name} (${selected.serviceCode}) — ${money(selected.priceCents)}`,
        ...(state.shippingDiscount > 0 ? [`Desconto no frete: ${money(state.shippingDiscount)}`, `Frete a pagar: ${money(Math.max(0, selected.priceCents - state.shippingDiscount))}`] : []),
        `Prazo estimado: ${selected.deliveryDays == null ? 'a confirmar' : selected.deliveryDays + ' dias úteis'}`, `Total estimado com frete: ${money(state.productTotal + Math.max(0, selected.priceCents - (state.shippingDiscount || 0)))}`, 'Estimativa de frete sujeita à validade da cotação e confirmação da Presence.'] : ['Frete a consultar. Entrega/frete não incluídos no total dos produtos.', 'O valor do frete e o total final ainda precisam de confirmação.'])];
  }
  return { ORIGIN_CEP, normalizeCEP, formatCEP, shipment, fingerprint, validateResponse, requestQuote, errorMessage, quoteLines };
});
