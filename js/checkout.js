/* Prepares the same WhatsApp inquiry as the cart; never creates an order or payment. */
(() => {
  const { items, money } = PresenceCheckout;
  const { PRODUCTS, CONFIG } = PresenceCatalog;
  const engine = PresenceCommerce, key = 'presence:cart:v1';
  const $ = selector => document.querySelector(selector);
  let cart, storageNotice = '';
  function restore(value) { cart = engine.restoreCart(value, PRODUCTS); }
  try { restore(localStorage.getItem(key)); }
  catch (_) { restore(null); storageNotice = 'O armazenamento está indisponível. Volte ao catálogo para revisar sua seleção.'; }
  let phone = String(CONFIG.whatsappRaw || '').replace(/\D/g, '');
  if (phone.startsWith('55') && phone.length >= 12) phone = phone.slice(2);
  phone = /^[1-9]\d9\d{8}$/.test(phone) ? '55' + phone : null;
  const wa = text => 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);
  let message = '', longMessage = false;
  function render() {
    const order = engine.summary(cart.lines, PRODUCTS, cart.coupon, PRESENCE_COUPONS);
    const notices = [...cart.notices, ...order.notices, storageNotice];
    if (cart.coupon && !order.coupon?.valid) notices.push(order.coupon?.message || 'Cupom indisponível.');
    const rawCEP = $('#checkout-cep').value.trim();
    const destination = PresenceShipping.normalizeCEP(rawCEP);
    if (rawCEP && !destination) notices.push('Informe um CEP válido com 8 dígitos ou deixe o campo em branco.');
    $('#checkout-message').textContent = [...new Set(notices.filter(Boolean))].join(' ');
    $('#checkout-items').innerHTML = order.entries.length ? items(order.entries.map(e => ({ ...e, name: e.product.name }))) : '<p>Seu carrinho está vazio. Volte ao catálogo para escolher seus produtos.</p>';
    $('#review-result').replaceChildren();
    if (order.entries.length) {
      const totals = document.createElement('p');
      totals.textContent = 'Subtotal dos produtos: ' + money(order.subtotal) + '. Desconto estimado: ' + money(order.discount) + (order.coupon?.valid ? ' (' + order.coupon.code + ')' : '') + '. Total dos produtos: ' + money(order.total) + '. Frete: a consultar. Total final: a confirmar pelo WhatsApp.';
      $('#review-result').append(totals);
    }
    message = engine.message(order, money, { destination: destination || '', selected: null, productTotal: order.total, shippingDiscount: 0 });
    const note = $('#checkout-note').value.trim();
    if (note) message += '\nObservações para a loja: ' + note;
    $('#order-message').value = order.entries.length ? message : '';
    const enabled = !!order.entries.length && !!phone && (!rawCEP || !!destination);
    longMessage = enabled && wa(message).length > 1800;
    $('#checkout-whatsapp').setAttribute('aria-disabled', String(!enabled));
    $('#checkout-whatsapp').href = enabled ? wa(longMessage ? 'Olá! Gostaria de enviar minha seleção completa para consultar disponibilidade, frete e valor final.' : message) : '#';
    $('#message-instructions').textContent = longMessage ? 'A mensagem é longa para um link. Copie ou baixe o texto completo acima, abra o WhatsApp e cole ou anexe o resumo. Você precisa enviá-lo na conversa.' : 'Depois de abrir o WhatsApp, revise e envie a mensagem. A loja dará continuidade ao atendimento.';
    $('#copy-order').disabled = $('#download-order').disabled = !order.entries.length;
    if (!phone && order.entries.length) $('#checkout-message').textContent += ' O contato está indisponível. Tente novamente mais tarde.';
  }
  $('#checkout-cep').addEventListener('input', render);
  $('#checkout-note').addEventListener('input', render);
  $('#checkout-whatsapp').addEventListener('click', event => {
    render();
    if ($('#checkout-whatsapp').getAttribute('aria-disabled') === 'true') event.preventDefault();
    if (longMessage) { $('#order-message').focus(); $('#order-message').select(); }
  });
  $('#copy-order').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(message); $('#copy-feedback').textContent = 'Mensagem copiada. Cole e envie na conversa do WhatsApp.'; }
    catch (_) { $('#order-message').focus(); $('#order-message').select(); $('#copy-feedback').textContent = 'Selecione e copie a mensagem acima para colar e enviar no WhatsApp.'; }
  });
  $('#download-order').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([message], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'presence-selecao-whatsapp.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  addEventListener('storage', event => { if (event.key === key || event.key === null) { restore(event.newValue); $('#copy-feedback').textContent = 'A seleção foi atualizada em outra aba. Revise a mensagem novamente.'; render(); } });
  render();
})();
