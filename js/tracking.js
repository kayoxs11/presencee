(() => {
  const { api, items, totals, shippingInfo, escape, date } = PresenceCheckout;
  const $ = selector => document.querySelector(selector);
  let access;
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has('token')) {
    $('#tracking-reference').value = fragment.get('reference') || '';
    $('#tracking-token').value = fragment.get('token') || '';
    // Keep capability out of browser history, referrers and storage.
    history.replaceState(null, '', location.pathname);
  }
  async function load() {
    const result = await api('/api/orders/' + encodeURIComponent(access.reference), { token: access.token });
    $('#tracking-message').textContent = '';
    $('#tracking-result').hidden = false;
    const link = location.origin + '/tracking.html#' + new URLSearchParams(access);
    $('#tracking-result').innerHTML = `<h2>${escape(result.reference)}</h2><p>Pedido em ${date(result.createdAt)}</p><p><strong>${escape(result.labels[result.fulfillmentStatus])}</strong><br>${escape(result.labels[result.paymentStatus])}</p>${result.fulfillmentStatus === 'cancelled' ? '<p>Este pedido está cancelado. Se houver pagamento em análise ou confirmado, fale com a loja para acompanhar a conciliação ou o reembolso.</p>' : ''}${['pending','in_process','authorized'].includes(result.paymentStatus) ? '<p>O pagamento ainda não está confirmado no registro deste pedido. Combine as instruções e confirme a situação com a loja pelo WhatsApp.</p>' : ''}<h3>Histórico do pedido</h3><ol class="timeline">${result.history.filter(entry => ['payment','fulfillment'].includes(entry.kind)).map(entry => `<li>${escape(result.labels[entry.status] || entry.status)}<time>${date(entry.created_at)}</time></li>`).join('')}</ol>${shippingInfo(result)}${result.trackingCode ? `<p>Código de rastreio: <strong>${escape(result.trackingCode)}</strong><br><a href="${escape(result.trackingURL)}" target="_blank" rel="noopener noreferrer">Acompanhar na transportadora</a></p>` : '<p>O rastreio aparecerá após o envio ser registrado pela equipe.</p>'}${items(result.items)}${totals(result)}<p class="commerce-note">O site não recebe pagamentos. Combine disponibilidade, frete, valor final e instruções de pagamento com a loja pelo WhatsApp. Este resumo consulta um registro existente.</p><button type="button" class="btn ghost" id="refresh-order">Atualizar situação</button><p class="commerce-message" id="payment-message" role="status"></p><details><summary>Guardar meu acesso ao pedido</summary><p>O link permite consultar seu resumo até ${date(result.accessExpiresAt)}. Guarde em um local privado. Se expirar, a loja poderá renovar após verificar sua identidade.</p><p class="access-key">${escape(link)}</p><a download="meu-pedido-presenca.txt" id="download-access">Baixar referência e chave de acesso</a></details>`;
    $('#download-access').href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(`Pedido: ${access.reference}\nChave: ${access.token}\nAcesso: ${link}`);
    $('#refresh-order').addEventListener('click', () => run(load));

  }
  async function run(fn) { try { await fn(); } catch (error) { $('#tracking-message').textContent = error.message; $('#tracking-result').hidden = true; } }
  $('#tracking-form').addEventListener('submit', event => {
    event.preventDefault(); access = { reference: $('#tracking-reference').value.trim(), token: $('#tracking-token').value.trim() }; run(load);
  });
  if ($('#tracking-reference').value && $('#tracking-token').value) { access = { reference: $('#tracking-reference').value, token: $('#tracking-token').value }; run(load); }
  addEventListener('hashchange', () => {
    const fragment = new URLSearchParams(location.hash.slice(1));
    if (!fragment.has('token') || !fragment.has('reference')) return;
    access = { reference: fragment.get('reference'), token: fragment.get('token') };
    $('#tracking-reference').value = access.reference; $('#tracking-token').value = access.token;
    history.replaceState(null, '', location.pathname); run(load);
  });
})();
