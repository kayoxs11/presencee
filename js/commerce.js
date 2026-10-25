/* Pure cart/coupon calculations shared by the browser and tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    // Available to the loopback development server, never on the browser API.
    module.exports.createDevelopmentEngine = () => factory(true);
  }
  else root.PresenceCommerce = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (development = false) => {
  const MAX_QUANTITY = 99;
  const normalizeCode = code => typeof code === 'string' ? code.trim().toUpperCase().slice(0, 64) : '';
  function priceCents(product) {
    if (!product || !product.available || typeof product.price !== 'number' || !Number.isFinite(product.price) || product.price <= 0) return null;
    const cents = Math.round(product.price * 100);
    return Number.isSafeInteger(cents) && cents <= 100000000 && Math.abs(cents / 100 - product.price) < .0000001 ? cents : null;
  }
  const quantity = value => Number.isInteger(value) && value >= 1 && value <= MAX_QUANTITY;
  const lineKey = line => JSON.stringify([line.id, line.variant || '', line.note || '']);
  function clean(raw, catalog) {
    const lines = [], notices = new Set();
    if (!Array.isArray(raw)) return { lines, notices: ['O carrinho salvo era inválido e foi reiniciado.'] };
    if (raw.length > 100) notices.add('O carrinho salvo excedia o limite de 100 itens diferentes. Revise os itens restaurados.');
    for (const item of raw.slice(0, 100)) {
      if (!item || typeof item !== 'object' || !quantity(item.quantity)) { notices.add('Um item salvo inválido foi removido.'); continue; }
      const product = catalog.find(p => p.id === item.id), cents = priceCents(product);
      if (cents === null) { notices.add('Um produto indisponível ou sem preço confirmado foi removido do carrinho.'); continue; }
      const variants = product.variants || [];
      const variant = typeof item.variant === 'string' ? item.variant : '';
      if ((variants.length && !variants.includes(variant)) || (!variants.length && variant)) { notices.add('Uma opção indisponível foi removida do carrinho.'); continue; }
      if (item.note != null && (typeof item.note !== 'string' || item.note.length > 300)) { notices.add('Uma personalização inválida foi removida.'); continue; }
      const note = product.personalizable ? (item.note || '').trim() : '';
      const line = { id: product.id, variant, note, quantity: item.quantity, priceSeen: cents };
      if (Number.isInteger(item.priceSeen) && item.priceSeen !== cents) notices.add(`O preço de ${product.name} foi atualizado para o valor atual do catálogo. Revise o total.`);
      const existing = lines.find(l => lineKey(l) === lineKey(line));
      if (existing) existing.quantity = Math.min(MAX_QUANTITY, existing.quantity + line.quantity);
      else lines.push(line);
    }
    return { lines, notices: [...notices] };
  }
  function validShipping(context, now = Date.now()) {
    return !!context && typeof context.quoteId === 'string' && !!context.quoteId &&
      typeof context.serviceCode === 'string' && !!context.serviceCode &&
      typeof context.destinationCEP === 'string' && /^\d{8}$/.test(context.destinationCEP) &&
      Number.isFinite(context.expiresAt) && context.expiresAt > now &&
      Number.isSafeInteger(context.priceCents) && context.priceCents >= 0 && context.priceCents <= 100000000;
  }
  function restoreCart(serialized, catalog) {
    const empty = message => ({ lines: [], coupon: '', notices: message ? [message] : [] });
    if (serialized == null) return empty();
    let data;
    try { data = JSON.parse(serialized); } catch (_) { return empty('O carrinho salvo era inválido e foi reiniciado.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1 || !Array.isArray(data.lines)) return empty('O carrinho salvo era inválido e foi reiniciado.');
    const raw = data.lines.slice(0, 100);
    const valid = raw.filter(line => line && typeof line === 'object' && !Array.isArray(line) &&
      typeof line.id === 'string' && line.id.length > 0 && quantity(line.quantity) &&
      (line.variant == null || typeof line.variant === 'string') &&
      (line.note == null || typeof line.note === 'string'));
    const restored = clean(valid, catalog);
    if (valid.length !== raw.length) restored.notices.unshift('Um item salvo inválido foi removido. Revise a seleção recuperada.');
    if (data.lines.length > 100) restored.notices.push('O carrinho salvo excedia o limite de 100 itens diferentes. Revise os itens restaurados.');
    const couponValid = data.coupon == null || (typeof data.coupon === 'string' && data.coupon.length <= 64);
    if (!couponValid) restored.notices.push('O código de cupom salvo era inválido e foi removido.');
    return { ...restored, coupon: couponValid ? normalizeCode(data.coupon) : '' };
  }
  function validateCoupon(input, entries, rules, now = Date.now(), shippingContext = null) {
    const code = normalizeCode(input);
    const fail = message => ({ valid: false, code, discount: 0, shippingDiscount: 0, message });
    if (!code) return fail('Digite um código de cupom.');
    // The default/browser engine never authorizes DEV. Only the server-only
    // factory used behind the development server's policy can calculate it.
    if (code === 'DEV') {
      if (!development) return fail('O cupom DEV não está disponível nesta loja. Testes administrativos exigem autorização segura no servidor.');
      const subtotal = entries.reduce((sum, entry) => sum + entry.subtotal, 0);
      if (!subtotal) return fail('Adicione produtos com preço confirmado para testar o cupom DEV.');
      return { valid: true, code, type: 'percentage', discount: subtotal, shippingDiscount: 0,
        developmentOnly: true, message: 'DEV aplicado em desenvolvimento: 100% nos produtos. O frete permanece separado. Não é uma oferta válida na loja.' };
    }
    const rule = rules.find(r => r && normalizeCode(r.code) === code);
    if (!rule) return fail('Cupom não encontrado.');
    if (rule.active !== true) return fail('Este cupom está inativo.');
    if (rule.expiresAt && (!Number.isFinite(Date.parse(rule.expiresAt)) || now >= Date.parse(rule.expiresAt))) return fail('Este cupom expirou.');
    if (!['fixed', 'percentage', 'shipping'].includes(rule.type) || (rule.type !== 'shipping' && (!Number.isFinite(rule.value) || rule.value <= 0))) return fail('Este cupom não está disponível.');
    if (rule.type === 'fixed' && !Number.isSafeInteger(rule.value)) return fail('Este cupom não está disponível.');
    if (rule.type === 'percentage' && (rule.value > 100 || Math.abs(rule.value * 100 - Math.round(rule.value * 100)) > .000001)) return fail('Este cupom não está disponível.');
    for (const key of ['minSubtotalCents', 'maxDiscountCents', 'maxQuantity']) {
      if (rule[key] != null && (!Number.isSafeInteger(rule[key]) || rule[key] < 0)) return fail('Este cupom não está disponível.');
    }
    if (['productIds', 'categoryIds'].some(key => rule[key] != null && !Array.isArray(rule[key]))) return fail('Este cupom não está disponível.');
    if (rule.combosOnly != null && typeof rule.combosOnly !== 'boolean') return fail('Este cupom não está disponível.');
    // Catalog metadata only: names and persisted cart-line fields never qualify an item.
    const eligible = entries.filter(e => (!rule.combosOnly || e.product.is_combo === true) && (!rule.productIds || rule.productIds.includes(e.product.id)) && (!rule.categoryIds || rule.categoryIds.includes(e.product.cat)));
    const subtotal = eligible.reduce((sum, e) => sum + e.subtotal, 0);
    if (!subtotal && rule.combosOnly) return fail('Este cupom é válido somente para combos.');
    if (!subtotal) return fail('Este cupom não se aplica aos produtos do carrinho.');
    if (subtotal < (rule.minSubtotalCents || 0)) return fail(`O subtotal dos produtos elegíveis não atinge o mínimo de ${(rule.minSubtotalCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} deste cupom.`);
    if (rule.maxQuantity != null && eligible.reduce((sum, e) => sum + e.quantity, 0) > rule.maxQuantity) return fail('A quantidade elegível excede o limite deste cupom.');
    if (rule.type === 'shipping') {
      if (!validShipping(shippingContext, now)) return fail('Calcule ou confirme uma cotação de frete válida e selecione um serviço antes de aplicar este cupom. Se a consulta dos Correios estiver indisponível, solicite a cotação pelo WhatsApp.');
      return { valid: true, code, type: 'shipping', discount: 0, shippingDiscount: shippingContext.priceCents, message: 'Cupom aplicado: o frete do serviço selecionado será gratuito, sujeito à confirmação da Presence.' };
    }
    // Percentage values allow two decimals. Round half up once on eligible subtotal.
    let discount = rule.type === 'fixed' ? rule.value : Number((BigInt(subtotal) * BigInt(Math.round(rule.value * 100)) + 5000n) / 10000n);
    discount = Math.min(discount, subtotal, rule.maxDiscountCents ?? subtotal);
    return { valid: true, code, type: rule.type, discount, shippingDiscount: 0, message: 'Cupom aplicado aos produtos elegíveis.' };
  }
  function summary(lines, catalog, code, rules, now = Date.now(), shippingContext = null) {
    const restored = clean(lines, catalog);
    const entries = restored.lines.map(line => {
      const product = catalog.find(p => p.id === line.id), unit = priceCents(product);
      return { ...line, product, unit, subtotal: unit * line.quantity };
    });
    const subtotal = entries.reduce((sum, line) => sum + line.subtotal, 0);
    const coupon = code ? validateCoupon(code, entries, rules, now, shippingContext) : null;
    const discount = coupon?.valid ? coupon.discount : 0;
    const shippingCost = validShipping(shippingContext, now) ? shippingContext.priceCents : null;
    const shippingDiscount = coupon?.valid ? coupon.shippingDiscount : 0;
    const payableShipping = shippingCost == null ? null : Math.max(0, shippingCost - shippingDiscount);
    const total = Math.max(0, subtotal - discount);
    return { ...restored, entries, subtotal, coupon, discount, total, shippingCost, shippingDiscount, payableShipping,
      estimatedTotal: payableShipping == null ? null : total + payableShipping,
      count: entries.reduce((sum, l) => sum + l.quantity, 0) };
  }
  function message(order, money, shippingState) {
    return ['Olá! Gostaria de consultar esta seleção da Presence Papelaria:', '',
      ...order.entries.map((line, i) => `${i + 1}. ${line.product.name}\nQuantidade: ${line.quantity}${line.variant ? '\nOpção: ' + line.variant : ''}${line.note ? '\nPersonalização: ' + line.note : ''}\nUnitário: ${money(line.unit)} · Subtotal: ${money(line.subtotal)}`), '',
      `Subtotal dos produtos: ${money(order.subtotal)}`,
      ...(order.coupon?.valid ? [`Cupom: ${order.coupon.code}`] : []),
      `Desconto: ${money(order.discount)}`, `Total dos produtos: ${money(order.total)}`, '',
      ...(shippingState && typeof PresenceShipping !== 'undefined' ? PresenceShipping.quoteLines(shippingState, money) : ['Entrega/frete não incluídos. Valores e descontos sujeitos à confirmação da Presence.']),
      'Esta mensagem é uma solicitação de revisão. O pedido não está confirmado, pago ou reservado.',
      'Você precisa enviar a mensagem no WhatsApp. A loja confirmará disponibilidade, frete, valor final e instruções de pagamento na conversa.'
    ].join('\n');
  }
  return { MAX_QUANTITY, normalizeCode, priceCents, lineKey, clean, restoreCart, validShipping, validateCoupon, summary, message };
});
