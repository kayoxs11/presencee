(() => {
  const { api, items, totals, shippingInfo, escape, money, date } = PresenceCheckout;
  const $ = selector => document.querySelector(selector);
  async function run(fn) {
    $('#admin-message').textContent = '';
    try { await fn(); } catch (error) { $('#admin-message').textContent = error.message; }
  }
  async function quotes() {
    const result = await api('/api/admin/quotes');
    $('#admin-quotes').innerHTML = result.quotes.length ? result.quotes.map(quote => `<article class="order-card"><h3>${escape(quote.id)}</h3><p>CEP: ${escape(quote.destination)} · ${date(quote.created_at)} · ${quote.status === 'approved' ? 'Aprovada' : 'Aguardando cotação'}</p>${items(quote.items)}${quote.status === 'pending' ? `<details><summary>Registrar cotação verificada</summary><form data-quote="${escape(quote.id)}"><label>Serviço da transportadora<input name="service" required maxlength="160"></label><div class="field-grid"><label>Preço em centavos<input type="number" name="priceCents" min="0" max="10000000" step="1" required></label><label>Prazo estimado de entrega (dias úteis após envio)<input type="number" name="deliveryDays" min="1" max="365" step="1" required></label><label>Produção antes do envio (dias úteis)<input type="number" name="productionDays" min="0" max="365" step="1" required></label></div><label>Origem / comprovante real da cotação e embalagem verificada<textarea name="evidence" required maxlength="500"></textarea></label><button class="btn">Aprovar cotação por 1 hora</button></form></details>` : ''}</article>`).join('') : '<p>Nenhuma cotação ativa.</p>';
  }
  async function orders() {
    const params = new URLSearchParams(new FormData($('#admin-filter')));
    const result = await api('/api/admin/orders?' + params);
    $('#admin-orders').innerHTML = result.orders.length ? result.orders.map(order => `<article class="order-card"><button type="button" data-order="${escape(order.reference)}">${escape(order.reference)}</button><p>${escape(order.customer)} · ${money(order.total)}<br>${escape(order.paymentStatus)} / ${escape(order.fulfillmentStatus)} · ${date(order.createdAt)}</p></article>`).join('') : '<p>Nenhum pedido encontrado. A busca exibe até 100 resultados entre os 1.000 pedidos mais recentes.</p>';
  }
  async function detail(reference) {
    const order = await api('/api/admin/orders/' + encodeURIComponent(reference));
    $('#admin-detail').hidden = false;
    const address = order.customer.address;
    const transitions = { received: ['production','preparing'], production: ['preparing'], preparing: ['shipped'], shipped: ['shipped','delivered'], delivered: ['delivered'], cancelled: [] };
    $('#admin-detail').innerHTML = `<h2>${escape(order.reference)}</h2><p>${escape(order.labels[order.fulfillmentStatus])}<br>${escape(order.labels[order.paymentStatus])}</p><p>${escape(order.customer.name)}<br>${escape(order.customer.email)} · ${escape(order.customer.phone)}<br>${escape(address.street)}, ${escape(address.number)} ${escape(address.complement)}<br>${escape(address.neighborhood)} · ${escape(address.city)}/${escape(address.state)} · ${escape(address.cep)}</p>${items(order.items)}${shippingInfo(order)}${totals(order)}<p class="commerce-note">Mercado Pago · Pagamento: ${escape(order.payment?.provider_id || 'Ainda não identificado')} · Preferência: ${escape(order.payment?.preference_id || 'Não criada')}</p>${order.paymentAttempts?.length ? `<h3>Tentativas de pagamento</h3><ul>${order.paymentAttempts.map(p => `<li>${escape(p.provider_id)} · ${escape(order.labels[p.status] || p.status)}</li>`).join('')}</ul>${order.paymentAttempts.filter(p => ['approved','partially_refunded'].includes(p.status)).length > 1 ? '<p>Há mais de um pagamento aprovado. Concilie e reembolse a cobrança excedente no provedor antes de continuar.</p>' : ''}` : ''}<form id="order-status"><label>Próxima etapa<select name="status" required><option value="">Selecione</option>${(transitions[order.fulfillmentStatus] || []).filter(value => value !== 'production' || order.items.some(item => item.personalized)).map(value => `<option value="${value}">${escape(order.labels[value])}${value === order.fulfillmentStatus ? ' (atualizar rastreio)' : ''}</option>`).join('')}</select></label><label>Código real de rastreio<input name="trackingCode" value="${escape(order.trackingCode || '')}" maxlength="80"></label><label>URL oficial da transportadora<input name="trackingURL" type="url" value="${escape(order.trackingURL || '')}" maxlength="500"></label><button class="btn">Salvar etapa</button></form><div><button class="btn ghost" data-action="sync">Consultar pagamento no provedor</button><button class="btn ghost" data-action="access">Renovar acesso do cliente verificado</button></div><details><summary>Cancelamento e reembolso</summary><p>Confirme no provedor o estado atual. Reembolso é integral e deve ser usado apenas quando autorizado pela política da loja. Um checkout já aberto deve ser conciliado no Mercado Pago antes do cancelamento.</p><label>Digite a referência do pedido para confirmar<input id="confirm-reference" autocomplete="off"></label><button class="btn ghost" data-action="cancel">Cancelar pedido / pagamento pendente</button><button class="btn ghost" data-action="refund">Solicitar reembolso integral</button></details><p id="admin-action-message" role="status" class="access-key" hidden></p><h3>Histórico</h3><ol class="timeline">${order.history.map(entry => `<li>${escape(entry.kind)} · ${escape(order.labels[entry.status] || entry.status)}<time>${date(entry.created_at)}</time></li>`).join('')}</ol>`;
    $('#order-status').addEventListener('submit', event => {
      event.preventDefault(); run(async () => {
        await api('/api/admin/orders/' + reference + '/status', { method: 'POST', body: Object.fromEntries(new FormData(event.target)) }); await detail(reference); await orders();
      });
    });
    $('#admin-detail').querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => run(async () => {
      const action = button.dataset.action;
      if (['refund','cancel'].includes(action) && $('#confirm-reference').value !== reference) throw new Error('Digite a referência completa do pedido antes de confirmar esta ação.');
      button.disabled = true;
      try {
        const result = await api('/api/admin/orders/' + reference + '/' + action, { method: 'POST', body: {} });
        if (action === 'access') {
          $('#admin-action-message').hidden = false; $('#admin-action-message').textContent = location.origin + '/tracking.html#' + new URLSearchParams(result);
        } else { await detail(reference); await orders(); }
      } finally { button.disabled = false; }
    })));
  }
  async function workspace() {
    await quotes(); await orders(); $('#admin-workspace').hidden = false; $('#admin-login-panel').hidden = true;
  }
  $('#admin-login').addEventListener('submit', event => {
    event.preventDefault(); run(async () => {
      const button = event.submitter; button.disabled = true;
      try { await api('/api/admin/login', { method: 'POST', body: Object.fromEntries(new FormData(event.target)) }); event.target.reset(); await workspace(); } finally { button.disabled = false; }
    });
  });
  $('#admin-logout').addEventListener('click', () => run(async () => { await api('/api/admin/logout', { method: 'POST', body: {} }); location.reload(); }));
  $('#admin-filter').addEventListener('submit', event => { event.preventDefault(); run(orders); });
  $('#load-quotes').addEventListener('click', () => run(quotes));
  $('#admin-orders').addEventListener('click', event => { const button = event.target.closest('[data-order]'); if (button) run(() => detail(button.dataset.order)); });
  $('#admin-quotes').addEventListener('submit', event => {
    const form = event.target.closest('[data-quote]'); if (!form) return;
    event.preventDefault(); run(async () => {
      const data = Object.fromEntries(new FormData(form));
      for (const key of ['priceCents','deliveryDays','productionDays']) data[key] = Number(data[key]);
      event.submitter.disabled = true;
      try { await api('/api/admin/quotes/' + form.dataset.quote, { method: 'POST', body: data }); await quotes(); } finally { event.submitter.disabled = false; }
    });
  });
  // Existing session can continue, but never cache addresses in local/session storage.
  workspace().catch(() => {});
})();
