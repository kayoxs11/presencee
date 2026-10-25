/* Catalog and contact helpers come from app.js. No stored price is authoritative. */
(() => {
  const engine = PresenceCommerce, key = 'presence:cart:v1';
  const money = cents => brl(cents / 100);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const dialog = $('#cart-drawer');
  let lines = [], code = '', notices = [], order, returnFocus, closeTimer, toastTimer;
  // This transport is injected only by the explicit loopback development server.
  // Static/production HTML has no development adapter or successful DEV path.
  const development = globalThis.PresenceDevCoupons || null;
  let developmentQuote = null, developmentPending = null, developmentSequence = 0, developmentRequest, developmentExpiry;
  function developmentKey() { return development.fingerprint(lines) + ':' + order.subtotal; }
  function requestDevelopmentQuote() {
    const key = developmentKey();
    if (developmentPending === key) return;
    developmentRequest?.abort();
    clearTimeout(developmentExpiry);
    const controller = new AbortController(); developmentRequest = controller;
    const sequence = ++developmentSequence;
    developmentPending = key;
    development.validate(lines.map(line => ({ ...line })), controller.signal).then(result => {
      if (sequence !== developmentSequence || code !== 'DEV' || key !== developmentKey()) return;
      if (result.subtotal !== order.subtotal) throw new Error('O catálogo local mudou. Reinicie npm start e atualize a página antes de testar DEV.');
      developmentQuote = { key, ...result };
      developmentPending = null;
      developmentExpiry = setTimeout(() => render(), Math.max(1, result.expiresAt - Date.now() + 10));
      render();
    }).catch(error => {
      if (sequence !== developmentSequence || controller.signal.aborted || code !== 'DEV') return;
      developmentPending = null; developmentQuote = null; code = '';
      $('#coupon-feedback').textContent = error.message || 'Não foi possível validar DEV no servidor local.';
      $('#coupon-feedback').dataset.state = 'error';
      render();
    });
  }
  const shipping = PresenceShipping;
  const ship = { destination: '', fingerprint: '', quote: null, selected: null, busy: false, message: '' };
  let shippingRequest, shippingSequence = 0, shippingExpiry;
  function syncShipping() {
    const fingerprint = shipping.fingerprint(order, ship.destination, PRESENCE_SHIPPING);
    if (fingerprint !== ship.fingerprint || (ship.quote && ship.quote.expiresAt <= Date.now())) {
      const hadQuote = ship.quote || ship.busy;
      shippingRequest?.abort(); shippingSequence++;
      clearTimeout(shippingExpiry);
      ship.quote = null; ship.selected = null; ship.busy = false;
      ship.fingerprint = fingerprint;
      if (hadQuote) ship.message = 'A cotação anterior foi invalidada. Calcule novamente para este carrinho e CEP.';
    }
  }
  function shippingContext() {
    if (!ship.quote || !ship.selected || !ship.quote.options.includes(ship.selected) || !ship.destination) return null;
    return { quoteId: ship.quote.quoteId, expiresAt: ship.quote.expiresAt, destinationCEP: ship.destination,
      serviceCode: ship.selected.serviceCode, priceCents: ship.selected.priceCents };
  }
  function shippingState() { return { destination: ship.destination, selected: ship.selected, productTotal: order.total, shippingDiscount: order.shippingDiscount }; }
  function orderMessage(quotation = false) {
    return (quotation ? 'Olá! Gostaria de solicitar uma cotação de frete para este pedido:\n\n' : '') + engine.message(order, money, shippingState());
  }
  function updateCheckout() {
    const checkout = $('#cart-checkout');
    const pending = code === 'DEV' && development && !order.coupon?.valid;
    checkout.setAttribute('aria-disabled', String(!lines.length || !PHONE || pending));
    checkout.href = lines.length && PHONE && !pending ? wa(orderMessage()) : '#';
    $('#checkout-fallback').hidden = true;
  }
  function renderShipping() {
    // Revalidate discounts after quote selection, invalidation or expiration.
    calculate();
    renderPricing();
    $('#shipping-origin').textContent = shipping.formatCEP(shipping.ORIGIN_CEP);
    $('#shipping-calculate').disabled = ship.busy || !lines.length;
    $('#shipping-calculate').textContent = ship.busy ? 'Calculando…' : 'Calcular frete';
    $('#shipping-form').setAttribute('aria-busy', String(ship.busy));
    $('#shipping-feedback').textContent = ship.message;
    $('#shipping-options').innerHTML = ship.quote ? `<legend>Escolha o envio estimado</legend>${ship.quote.options.map(option => `<label class="shipping-option"><input type="radio" name="shipping-service" value="${escape(option.serviceCode)}" data-focus="shipping-${escape(option.serviceCode)}" ${ship.selected?.serviceCode === option.serviceCode ? 'checked' : ''}><span><strong>${escape(option.name)}</strong><small>${option.deliveryDays == null ? 'Prazo a confirmar' : option.deliveryDays + ' dias úteis (estimativa)'}</small></span><b>${money(option.priceCents)}</b></label>`).join('')}` : '';
    $('#shipping-options').hidden = !ship.quote;
    $('#shipping-cost').textContent = order.shippingCost == null ? 'A consultar' : money(order.shippingCost);
    $('#shipping-discount').textContent = '− ' + money(order.shippingDiscount);
    $('#shipping-payable').textContent = order.payableShipping == null ? 'A consultar' : money(order.payableShipping);
    $('#estimated-total').textContent = order.estimatedTotal == null ? 'A confirmar' : money(order.estimatedTotal);
    $('#shipping-quote-request').setAttribute('aria-disabled', String(!lines.length || !ship.destination || !PHONE));
    $('#shipping-quote-request').href = lines.length && ship.destination && PHONE ? wa(orderMessage(true)) : '#';
    $('#shipping-total-note').textContent = ship.selected ? 'Estimativa com frete. Valores sujeitos à validade da cotação e à confirmação da Presence.' : 'Frete a consultar. O total final será confirmado com a Presence.';
  }
  function showFullSummary(text) {
    $('#checkout-fallback').hidden = false;
    $('#order-message').value = text;
    $('#fallback-whatsapp').href = wa('Olá! Gostaria de enviar o resumo completo do meu pedido e consultar o frete.');
    $('#order-message').focus();
  }
  function restore(value) {
    const restored = engine.restoreCart(value, PRODUCTS);
    lines = restored.lines; notices = restored.notices; code = restored.coupon;
  }
  try { restore(localStorage.getItem(key)); } catch (_) { notices = ['O armazenamento está indisponível. O carrinho funciona nesta página.']; }
  function save() {
    try { localStorage.setItem(key, JSON.stringify({ version: 1, lines, coupon: code || null })); }
    catch (_) { if (!notices.some(n => n.includes('armazenamento'))) notices.push('O armazenamento está indisponível. O carrinho funciona nesta página.'); }
  }
  function calculate() {
    const now = Date.now();
    const devActive = code === 'DEV' && development;
    if (!devActive && (developmentPending || developmentQuote)) {
      developmentRequest?.abort(); developmentSequence++;
      developmentPending = null; developmentQuote = null; clearTimeout(developmentExpiry);
    }
    const summarize = () => {
      const result = engine.summary(lines, PRODUCTS, devActive ? '' : code, PRESENCE_COUPONS, now, shippingContext());
      if (devActive) {
        const key = development.fingerprint(result.lines) + ':' + result.subtotal;
        if (developmentQuote?.key === key && developmentQuote.expiresAt > now && developmentQuote.subtotal === result.subtotal) {
          result.discount = developmentQuote.discount;
          result.total = developmentQuote.total;
          result.estimatedTotal = result.payableShipping == null ? null : result.total + result.payableShipping;
          result.coupon = { valid: true, code: 'DEV', type: 'percentage', discount: result.discount, shippingDiscount: 0, developmentOnly: true, message: developmentQuote.message };
        } else {
          result.coupon = { valid: false, code: 'DEV', discount: 0, shippingDiscount: 0, message: 'Validando DEV no servidor local…' };
        }
      }
      return result;
    };
    order = summarize();
    // First bind/invalidate the quote against the current cart, then calculate
    // again so stale shipping can never authorize FRETEGRATIS.
    syncShipping();
    order = summarize();
    lines = order.lines;
    notices = [...new Set([...notices, ...order.notices])];
    if (devActive && !order.coupon.valid) {
      requestDevelopmentQuote();
    } else if (code && !order.coupon.valid) {
      $('#coupon-feedback').textContent = order.coupon.message + ' O desconto foi removido.';
      $('#coupon-feedback').dataset.state = 'error'; code = '';
    }
    return order;
  }
  function renderPricing() {
    $('#cart-subtotal').textContent = money(order.subtotal);
    $('#cart-discount').textContent = '− ' + money(order.discount);
    $('#cart-total').textContent = money(order.total);
    $('#applied-coupon').textContent = order.coupon?.valid ? order.coupon.code : '';
    $('#remove-coupon').hidden = !order.coupon?.valid;
    $('#coupon-apply').disabled = !lines.length || !!developmentPending;
    if (code === 'DEV' && development) {
      $('#coupon-feedback').textContent = order.coupon.message;
      if (order.coupon.valid) $('#coupon-feedback').dataset.state = 'success';
      else delete $('#coupon-feedback').dataset.state;
    }
  }
  function feedback(text) {
    clearTimeout(toastTimer);
    $('#cart-toast').textContent = text;
    $('#cart-toast').classList.add('show');
    toastTimer = setTimeout(() => $('#cart-toast').classList.remove('show'), 2800);
  }
  function render() {
    calculate(); save();
    const active = dialog.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    $('#cart-count').textContent = order.count;
    $('#cart-count').hidden = !order.count;
    $('#cart-open').setAttribute('aria-label', `Abrir carrinho, ${order.count} ${order.count === 1 ? 'item' : 'itens'}`);
    $('#cart-notice').textContent = notices.join(' ');
    $('#cart-lines').innerHTML = order.entries.length ? order.entries.map((line, i) => `<article class="cart-line">
      <div class="cart-image">${visual(line.product)}</div>
      <div class="cart-line-info"><h3><a href="#p-${escape(line.id)}" data-cart-product>${escape(line.product.name)}</a></h3>
      ${line.variant ? `<p>Opção: ${escape(line.variant)}</p>` : ''}${line.note ? `<p>Personalização: ${escape(line.note)}</p>` : ''}
      <p>${money(line.unit)} / unidade</p>
      <div class="cart-line-controls"><div class="qty"><button type="button" data-cart-delta="-1" data-index="${i}" data-focus="minus-${i}" aria-label="Diminuir quantidade de ${escape(line.product.name)}" ${line.quantity === 1 ? 'disabled' : ''}>−</button><label class="sr" for="cart-qty-${i}">Quantidade de ${escape(line.product.name)}</label><input id="cart-qty-${i}" data-cart-quantity="${i}" data-focus="qty-${i}" type="number" min="1" max="99" step="1" value="${line.quantity}"><button type="button" data-cart-delta="1" data-index="${i}" data-focus="plus-${i}" aria-label="Aumentar quantidade de ${escape(line.product.name)}" ${line.quantity === 99 ? 'disabled' : ''}>+</button></div><button class="link" type="button" data-cart-remove="${i}" data-focus="remove-${i}" aria-label="Remover ${escape(line.product.name)}">Remover</button></div>
      <strong class="line-total">${money(line.subtotal)}</strong></div></article>`).join('') : '<div class="cart-empty"><h3>Seu carrinho está aberto a novos detalhes.</h3><p>Explore a coleção e adicione produtos com preço confirmado.</p></div>';
    $('#cart-clear').disabled = !lines.length;
    $('#coupon-apply').disabled = !lines.length;
    $('#coupon-code').disabled = !lines.length;
    renderShipping(); updateCheckout();
    if (active) {
      const target = dialog.querySelector(`[data-focus="${active}"]:not(:disabled)`);
      (target || $('#cart-close')).focus({ preventScroll: true });
    }
  }
  function open() {
    clearTimeout(closeTimer);
    returnFocus = document.activeElement;
    render();
    dialog.classList.remove('closing');
    if (!dialog.open) dialog.showModal();
    $('#cart-open').setAttribute('aria-expanded', 'true');
    document.body.classList.add('cart-is-open');
    $('#cart-close').focus();
  }
  function close() {
    if (!dialog.open) return;
    dialog.classList.add('closing');
    const finish = () => { dialog.close(); dialog.classList.remove('closing'); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else closeTimer = setTimeout(finish, 160);
  }
  dialog.addEventListener('close', () => {
    clearTimeout(closeTimer);
    document.body.classList.remove('cart-is-open');
    $('#cart-open').setAttribute('aria-expanded', 'false');
    (returnFocus?.isConnected ? returnFocus : $('#cart-open')).focus({ preventScroll: true });
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => { if (event.target === dialog && event.clientX < dialog.getBoundingClientRect().left) close(); });
  $('#cart-open').addEventListener('click', open);
  $('#cart-close').addEventListener('click', close);
  $('#cart-continue').addEventListener('click', close);
  $('#cart-clear').addEventListener('click', () => { lines = []; render(); feedback('Carrinho esvaziado.'); });
  document.addEventListener('click', event => {
    const add = event.target.closest('[data-add-cart]');
    if (!add) return;
    const product = PRODUCTS.find(p => p.id === add.dataset.addCart);
    if (engine.priceCents(product) === null) { feedback('Este produto precisa de orçamento. Consulte o preço pelo WhatsApp.'); return; }
    const detail = add.id === 'detail-add-cart';
    const selectedQuantity = detail ? Number($('#dq')?.value || 1) : 1;
    if (!Number.isInteger(selectedQuantity) || selectedQuantity < 1 || selectedQuantity > 99) { feedback('Escolha uma quantidade de 1 a 99.'); $('#dq')?.focus(); return; }
    const variant = detail ? document.querySelector('input[name=v]:checked')?.value || '' : '';
    if ((product.variants || []).length && !detail) { location.hash = 'p-' + product.id; return; }
    const line = { id: product.id, quantity: selectedQuantity, variant, note: detail ? $('#dn')?.value.trim() || '' : '', priceSeen: engine.priceCents(product) };
    const existing = lines.find(l => engine.lineKey(l) === engine.lineKey(line));
    if (existing && existing.quantity + selectedQuantity > 99) { feedback('O limite é de 99 unidades por item.'); return; }
    if (!existing && lines.length >= 100) { feedback('Revise o carrinho antes de adicionar novos itens.'); return; }
    if (existing) existing.quantity += selectedQuantity; else lines.push(line);
    render(); feedback(`${product.name} adicionado ao carrinho.`);
    $('#cart-count').animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200 });
  });
  $('#cart-lines').addEventListener('click', event => {
    const button = event.target.closest('[data-cart-delta],[data-cart-remove],[data-cart-product]');
    if (!button) return;
    if (button.hasAttribute('data-cart-product')) { close(); return; }
    if (button.hasAttribute('data-cart-remove')) { lines.splice(Number(button.dataset.cartRemove), 1); render(); $('#cart-close').focus(); feedback('Item removido.'); return; }
    const line = lines[Number(button.dataset.index)];
    if (line) line.quantity = Math.max(1, Math.min(99, line.quantity + Number(button.dataset.cartDelta)));
    render();
  });
  $('#cart-lines').addEventListener('change', event => {
    if (!event.target.hasAttribute('data-cart-quantity')) return;
    const line = lines[Number(event.target.dataset.cartQuantity)], value = Number(event.target.value);
    if (line && Number.isInteger(value) && value >= 1 && value <= 99) line.quantity = value;
    else feedback('Escolha uma quantidade inteira de 1 a 99.');
    render();
  });
  $('#coupon-form').addEventListener('submit', event => {
    event.preventDefault(); calculate();
    if (engine.normalizeCode($('#coupon-code').value) === 'DEV' && development) {
      code = 'DEV'; developmentQuote = null; render(); return;
    }
    const result = engine.validateCoupon($('#coupon-code').value, order.entries, PRESENCE_COUPONS, Date.now(), shippingContext());
    $('#coupon-feedback').textContent = result.message;
    $('#coupon-feedback').dataset.state = result.valid ? 'success' : 'error';
    if (result.valid) { code = result.code; $('#coupon-code').value = code; render(); }
  });
  $('#remove-coupon').addEventListener('click', () => { code = ''; $('#coupon-code').value = ''; $('#coupon-feedback').textContent = 'Cupom removido.'; delete $('#coupon-feedback').dataset.state; render(); });
  $('#destination-cep').addEventListener('input', event => {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 8);
    event.target.value = digits.length > 5 ? digits.slice(0, 5) + '-' + digits.slice(5) : digits;
    ship.destination = shipping.normalizeCEP(event.target.value) || '';
    event.target.removeAttribute('aria-invalid');
    ship.message = '';
    calculate(); renderShipping(); updateCheckout();
  });
  $('#shipping-form').addEventListener('submit', async event => {
    event.preventDefault(); calculate();
    if (!ship.destination) {
      $('#destination-cep').setAttribute('aria-invalid', 'true');
      ship.message = 'Informe um CEP de destino válido com 8 dígitos.';
      renderShipping(); $('#destination-cep').focus(); return;
    }
    if (!order.entries.length) { ship.message = 'Adicione produtos ao carrinho antes de calcular o frete.'; renderShipping(); return; }
    const packed = shipping.shipment(order.entries, PRESENCE_SHIPPING.packaging);
    if (!packed.reliable || !PRESENCE_SHIPPING.endpoint) {
      ship.message = (!packed.reliable ? packed.reason + ' ' : '') + 'Frete a consultar. Solicite uma cotação pelo WhatsApp; não há tarifa automática confirmada.';
      renderShipping(); return;
    }
    shippingRequest?.abort();
    clearTimeout(shippingExpiry);
    const controller = new AbortController(); shippingRequest = controller;
    const sequence = ++shippingSequence, fingerprint = ship.fingerprint;
    ship.busy = true; ship.quote = null; ship.selected = null; ship.message = 'Consultando opções de envio…';
    renderShipping(); updateCheckout();
    try {
      const result = await shipping.requestQuote({ originCEP: shipping.ORIGIN_CEP, destinationCEP: ship.destination, fingerprint,
        items: order.entries.map(line => ({ id: line.id, quantity: line.quantity, variant: line.variant, note: line.note })),
        package: packed.package }, PRESENCE_SHIPPING, controller.signal);
      calculate();
      if (sequence !== shippingSequence || fingerprint !== ship.fingerprint || controller.signal.aborted) return;
      ship.quote = result; ship.selected = result.options[0];
      ship.message = 'Opções dos Correios consultadas. Valores e prazos são estimativas sujeitas à confirmação.';
      shippingExpiry = setTimeout(() => render(), Math.max(1, result.expiresAt - Date.now() + 10));
    } catch (error) {
      if (sequence !== shippingSequence || controller.signal.aborted) return;
      ship.message = shipping.errorMessage(error) + ' Frete a consultar.';
    } finally {
      if (sequence === shippingSequence) { ship.busy = false; renderShipping(); updateCheckout(); }
    }
  });
  $('#shipping-options').addEventListener('change', event => {
    const value = event.target.value;
    calculate();
    ship.selected = ship.quote?.options.find(option => option.serviceCode === value) || null;
    renderShipping(); updateCheckout();
    $('#shipping-options').querySelector('input:checked')?.focus();
  });
  $('#shipping-quote-request').addEventListener('click', event => {
    calculate(); renderShipping(); updateCheckout();
    if (!ship.destination || !lines.length || !PHONE) {
      event.preventDefault(); ship.message = 'Informe um CEP válido e adicione produtos para solicitar a cotação.';
      renderShipping(); $('#destination-cep').focus(); return;
    }
    const text = orderMessage(true);
    if (wa(text).length > 1800) { event.preventDefault(); showFullSummary(text); }
  });
  $('#cart-checkout').addEventListener('click', event => {
    const previous = JSON.stringify({ order, selectedShipping: ship.selected });
    render();
    if (code === 'DEV' && development && !order.coupon?.valid) { event.preventDefault(); feedback('Aguarde a validação local do cupom DEV.'); return; }
    if (!order.entries.length || !PHONE) { event.preventDefault(); feedback(PHONE ? 'Adicione um produto ao carrinho.' : 'Contato indisponível. Tente novamente mais tarde.'); return; }
    if (previous !== JSON.stringify({ order, selectedShipping: ship.selected })) { event.preventDefault(); feedback('O carrinho ou o frete foi atualizado. Revise o total antes de continuar.'); return; }
    if ($('#cart-checkout').href.length > 1800) {
      event.preventDefault();
      showFullSummary(orderMessage());
    }
  });
  $('#copy-order').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#order-message').value); $('#copy-feedback').textContent = 'Resumo completo copiado. Cole na conversa do WhatsApp.'; }
    catch (_) { $('#order-message').focus(); $('#order-message').select(); $('#copy-feedback').textContent = 'Selecione e copie o resumo acima para colar no WhatsApp.'; }
  });
  $('#download-order').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([$('#order-message').value], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'presence-resumo-do-pedido.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  addEventListener('storage', event => { if (event.key === key || event.key === null) { restore(event.newValue); render(); } });
  render();
})();
