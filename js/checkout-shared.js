/* No private credentials or customer addresses are persisted in the browser. */
window.PresenceCheckout = (() => {
  const money = value => (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const date = value => new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  async function api(path, { method = 'GET', body, token, key } = {}) {
    let response;
    try { response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Presence-Request': '1', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) }); }
    catch (_) { throw new Error('Não foi possível conectar. Confira a conexão e tente novamente.'); }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir. Tente novamente.');
    return data;
  }
  function items(values) { return `<ul class="commerce-items">${values.map(item => `<li><strong>${escape(item.name)}</strong> · ${item.quantity} un.<small>${escape(item.variant)}${item.note ? ' · ' + escape(item.note) : ''}</small>${item.subtotal == null ? '' : money(item.subtotal)}</li>`).join('')}</ul>`; }
  function totals(order) { return `<dl class="commerce-totals"><dt>Subtotal dos produtos</dt><dd>${money(order.subtotal)}</dd><dt>Desconto ${escape(order.coupon || '')}</dt><dd>− ${money(order.discount)}</dd><dt>Frete cotado</dt><dd>${money(order.shippingCost)}</dd><dt>Desconto no frete</dt><dd>− ${money(order.shippingDiscount)}</dd><dt class="grand">Total registrado</dt><dd class="grand">${money(order.total)}</dd></dl>`; }
  function shippingInfo(order) { return `<p>${escape(order.shipping.service)}<br>Produção antes do envio: ${order.shipping.productionDays == null ? 'a confirmar' : order.shipping.productionDays + ' dias úteis'}.<br>Entrega após postagem: ${order.shipping.deliveryDays == null ? 'a confirmar' : order.shipping.deliveryDays + ' dias úteis (estimativa)'}.<br><span class="commerce-note">Os prazos são estimativas, não garantias. Feriados e ocorrências da transportadora podem alterar a entrega.</span></p>`; }
  return { money, escape, date, api, items, totals, shippingInfo };
})();
