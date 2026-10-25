/* Served/injected only by the explicitly enabled, loopback development server. */
(() => {
  const fingerprint = lines => JSON.stringify(lines.map(line => [line.id, line.quantity, line.variant || '', line.note || '']));
  async function validate(lines, signal) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, 5000);
    try {
      const response = await fetch('/__dev__/coupons', {
        method: 'POST', credentials: 'same-origin', redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'X-Presence-Development': '1' },
        body: JSON.stringify({ code: 'DEV', lines: lines.map(({ id, quantity, variant, note }) => ({ id, quantity, variant, note })) }), signal: controller.signal
      });
      if (!response.ok) throw new Error('A validação local de DEV está indisponível. Use npm start fora do modo production.');
      const data = await response.json();
      if (data.environment !== 'development' || data.code !== 'DEV' || data.valid !== true ||
          data.fingerprint !== fingerprint(lines) || !Number.isSafeInteger(data.subtotal) || data.subtotal <= 0 ||
          data.discount !== data.subtotal || data.total !== 0 || data.shippingDiscount !== 0 ||
          !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now()) throw new Error('Não foi possível confirmar a validação local do cupom DEV.');
      return data;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  Object.defineProperty(globalThis, 'PresenceDevCoupons', { value: Object.freeze({ fingerprint, validate }), writable: false, configurable: false });
})();
