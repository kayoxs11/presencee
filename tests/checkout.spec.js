const { test, expect } = require('@playwright/test');
const snapshot = {
  reference: 'PRE-TESTONLY123456789', createdAt: Date.parse('2026-10-24T12:00:00Z'), updatedAt: Date.parse('2026-10-24T12:00:00Z'),
  items: [{ id: 'book', name: 'Livro de teste', quantity: 1, unit: 6000, subtotal: 6000, variant: '', note: '' }],
  subtotal: 6000, discount: 0, shippingCost: 1500, shippingDiscount: 0, total: 7500, coupon: '',
  shipping: { service: 'Serviço de teste', deliveryDays: 5, productionDays: 0 },
  labels: require('../server/commerce.cjs').labels, accessExpiresAt: Date.parse('2026-11-24T12:00:00Z'),
};
for (const status of ['pending','approved','shipped','delivered','cancelled','refunded']) {
  test('tracking renders actual lifecycle: ' + status, async ({ page }) => {
    const payment = ['approved','shipped','delivered'].includes(status) ? 'approved' : status === 'refunded' ? 'refunded' : 'pending';
    const fulfillment = ['shipped','delivered','cancelled'].includes(status) ? status : status === 'refunded' ? 'cancelled' : 'received';
    const history = [{ kind: 'fulfillment', status: 'received', created_at: snapshot.createdAt }, { kind: 'payment', status: payment, created_at: snapshot.createdAt }];
    if (fulfillment !== 'received') history.push({ kind: 'fulfillment', status: fulfillment, created_at: snapshot.createdAt });
    await page.route('**/api/orders/*', route => route.fulfill({ json: { ...snapshot, paymentStatus: payment, fulfillmentStatus: fulfillment, history, ...(fulfillment === 'shipped' || fulfillment === 'delivered' ? { trackingCode: 'TESTONLY', trackingURL: 'https://rastreamento.correios.com.br/app/index.php' } : {}) } }));
    await page.goto('/tracking.html#reference=' + snapshot.reference + '&token=test-capability');
    await expect(page.locator('#tracking-result')).toBeVisible();
    await expect(page.locator('#tracking-result')).toContainText(snapshot.labels[payment]);
    await expect(page.locator('#tracking-result')).toContainText(snapshot.labels[fulfillment]);
    if (payment === 'pending') await expect(page.locator('.timeline')).not.toContainText('Pagamento confirmado');
    await expect(page.locator('#pay-order')).toHaveCount(0);
    await expect(page.locator('#tracking-result')).toContainText('O site n\u00e3o recebe pagamentos.');
    expect(new URL(page.url()).hash).toBe('');
    expect(await page.evaluate(() => localStorage.getItem('order'))).toBeNull();
  });
}

test('tracking explains registered-order access and never offers online payment', async ({ page }) => {
  const paymentCalls = [];
  page.on('request', r => { if (r.url().endsWith('/payment')) paymentCalls.push(r.url()); });
  await page.goto('/tracking.html');
  await expect(page.locator('main')).toContainText('não cria um registro');
  await page.locator('#tracking-reference').fill('wrong'); await page.locator('#tracking-token').fill('wrong'); await page.locator('#tracking-form button').click();
  await expect(page.locator('#tracking-message')).toContainText('não encontrado');
  await expect(page.locator('#tracking-result')).toBeHidden();
  expect(paymentCalls).toEqual([]);
});

const invalidCarts = [
  ['invalid JSON', '{bad'], ['null root', 'null'], ['array root', '[]'], ['scalar', '5'],
  ['missing fields', '{}'], ['missing version', '{"lines":[]}'], ['unsupported version', '{"version":2,"lines":[]}'],
  ['null lines', '{"version":1,"lines":null}'], ['object lines', '{"version":1,"lines":{}}'],
  ['null item', '{"version":1,"lines":[null]}'], ['array item', '{"version":1,"lines":[[]]}'],
  ...[0,-1,100,1.5,'2',null,true].map(quantity => ['quantity ' + JSON.stringify(quantity), JSON.stringify({ version: 1, lines: [{ id: 'biblia', quantity }] })]),
];
for (const [name, serialized] of invalidCarts) {
  test('saved selection recovers safely: ' + name, async ({ page }) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(value => localStorage.setItem('presence:cart:v1', value), serialized);
    await page.goto('/checkout.html');
    await expect(page.locator('#checkout-items')).toContainText('vazio');
    await expect(page.locator('#checkout-whatsapp')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('#order-message')).toHaveValue('');
    await expect(page.locator('#review-result')).toBeEmpty();
    expect(errors).toEqual([]);
  });
}

test('partial recovery preserves valid lines, ignores forged totals and rejects malformed coupon data', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('presence:cart:v1', JSON.stringify({
    version: 1, lines: [null, { id: 'biblia', quantity: 2, price: 0, priceSeen: 1 }, { id: 'biblia', quantity: 3, variant: {} }, { id: 'caneca', quantity: 1 }, { id: 'missing', quantity: 1 }],
    coupon: { code: 'DEV' }, total: 0, shippingCost: 0, customer: { name: 'untrusted' }, quote: { approved: true },
  })));
  await page.goto('/checkout.html');
  await expect(page.locator('.commerce-items li')).toHaveCount(1);
  await expect(page.locator('#review-result')).toContainText('120,00');
  await expect(page.locator('#review-result')).toContainText('Frete: a consultar');
  await expect(page.locator('#checkout-message')).toContainText('removido');
  await expect(page.locator('#checkout-message')).toContainText('cupom salvo era inválido');
  await expect(page.locator('#checkout-whatsapp')).toHaveAttribute('aria-disabled', 'false');
  expect(errors).toEqual([]);
});

test('WhatsApp review includes quantities, coupons and observations without calling order, payment or shipping APIs', async ({ page, context, request }) => {
  const apiCalls = [];
  page.on('request', r => { if (r.url().includes('/api/')) apiCalls.push(r.url()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('presence:cart:v1', JSON.stringify({ version: 1, lines: [{ id: 'biblia', quantity: 2 }], coupon: 'BEMVINDO5' })));
  await page.goto('http://127.0.0.1:8030/checkout.html');
  await page.locator('#checkout-cep').fill('53110-000'); await page.locator('#checkout-note').fill('Gostaria de combinar a retirada com a loja.');
  const message = await page.locator('#order-message').inputValue();
  for (const part of ['Bíblia','Quantidade: 2','BEMVINDO5','111,60','53110-000','retirada','não está confirmado','precisa enviar']) expect(message).toContain(part);
  await expect(page.locator('#review-result')).toContainText('Total final: a confirmar');
  await expect(page.locator('form')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const width of [320,1440]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/whatsapp-review-${width}.png`,fullPage:true});
  }
  await context.route('https://wa.me/**', route => route.fulfill({ contentType: 'text/html', body: '<p>WhatsApp de teste: nenhuma mensagem enviada.</p>' }));
  const popupPromise = page.waitForEvent('popup'); await page.locator('#checkout-whatsapp').click(); const popup = await popupPromise;
  await popup.waitForLoadState(); expect(new URL(popup.url()).searchParams.get('text')).toBe(message); await popup.close();
  expect(apiCalls).toEqual([]);
  await expect(page).toHaveURL(/checkout.html/);
  for (const path of ['/api/orders','/api/orders/PRE-UNKNOWN/payment']) {
    const response = await request.post('http://127.0.0.1:8030' + path, { headers: { Origin: 'http://127.0.0.1:8030', 'X-Presence-Request': '1' }, data: {} });
    expect(response.status()).toBe(410);
  }
});

test('review synchronizes valid and invalid cart updates from another tab without losing observations or focus', async ({ page, context }) => {
  await page.goto('/'); await page.locator('[data-add-cart="biblia"]').click();
  const review = await context.newPage();
  try {
    await review.goto('/checkout.html');
    await review.locator('#checkout-note').fill('Quero conversar com a loja.');
    await expect(review.locator('#checkout-note')).toBeFocused();
    await page.evaluate(() => localStorage.setItem('presence:cart:v1', JSON.stringify({ version: 1, lines: [{ id: 'biblia', quantity: 2 }] })));
    await expect(review.locator('#review-result')).toContainText('120,00');
    await expect(review.locator('#checkout-note')).toBeFocused();
    await expect(review.locator('#order-message')).toHaveValue(/Quero conversar/);
    await page.evaluate(() => localStorage.setItem('presence:cart:v1','null'));
    await expect(review.locator('#checkout-items')).toContainText('vazio');
    await expect(review.locator('#order-message')).toHaveValue('');
  } finally { await review.close(); }
});

test('empty review and blocked browser storage fail gracefully', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw Error('blocked'); } }));
  await page.goto('/checkout.html');
  await expect(page.locator('#checkout-message')).toContainText('armazenamento');
  await expect(page.locator('#checkout-whatsapp')).toHaveAttribute('aria-disabled','true');
  expect(errors).toEqual([]);
});

test('long WhatsApp selection keeps complete content for copy/download and invalid CEP prevents opening', async ({ page }) => {
  await page.route('**/js/catalog.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('personalizable:false,available:true},','personalizable:true,available:true},') });
  });
  await page.addInitScript(() => {
    localStorage.setItem('presence:cart:v1',JSON.stringify({ version:1, lines:[0,1,2].map(i=>({ id:'biblia',quantity:1,note:'Opção '+i+': '+'Detalhes '.repeat(30) })) }));
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('blocked')}}});
  });
  await page.goto('/checkout.html');
  await page.locator('#checkout-note').fill('Observações adicionais. '.repeat(20));
  await expect(page.locator('#message-instructions')).toContainText('longa');
  for (let i=0;i<3;i++) expect(await page.locator('#order-message').inputValue()).toContain('Opção '+i);
  await page.locator('#copy-order').click(); await expect(page.locator('#copy-feedback')).toContainText('Selecione e copie');
  const pending=page.waitForEvent('download'); await page.locator('#download-order').click(); const download=await pending;
  expect(require('node:fs').readFileSync(await download.path(),'utf8')).toBe(await page.locator('#order-message').inputValue());
  await page.locator('#checkout-cep').fill('00000-000'); await expect(page.locator('#checkout-whatsapp')).toHaveAttribute('aria-disabled','true');
  await page.locator('#checkout-cep').fill(''); await expect(page.locator('#checkout-whatsapp')).toHaveAttribute('aria-disabled','false');
});

test('admin endpoints require authentication and server files are never static', async ({ page, request }) => {
  await page.goto('/admin.html'); await expect(page.locator('#admin-login-panel')).toBeVisible(); await expect(page.locator('#admin-workspace')).toBeHidden();
  for (const url of ['/server/commerce.cjs','/data/commerce-8010.sqlite','/.env','/server/migrations/001-commerce.sql']) expect((await request.get(url)).status()).toBe(404);
  expect((await request.get('/api/admin/orders')).status()).toBe(401);
});
