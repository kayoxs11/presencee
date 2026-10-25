const { test, expect } = require('@playwright/test');
const shipping = require('../js/shipping');

// All measurements, services and rates in this file are isolated test fixtures.
const measurement = { eligible: true, weightGrams: 100, lengthCm: 10, widthCm: 8, heightCm: 2 };
const packaging = { strategy: 'approved-recipes', recipes: [{ items: { biblia: 1, devocional: 1 }, tareGrams: 20, lengthCm: 20, widthCm: 15, heightCm: 8 }] };
const config = { endpoint: '/api/shipping', timeoutMs: 500, enabledServices: ['TEST_A', 'TEST_B'], packaging };
const entries = [{ id: 'biblia', quantity: 1, product: { id: 'biblia', shipping: measurement } }, { id: 'devocional', quantity: 1, product: { id: 'devocional', shipping: measurement } }];
function response(request, options = {}) {
  return { source: 'correios', quoteId: 'fixture-only', originCEP: '53110000', destinationCEP: request.destinationCEP, fingerprint: request.fingerprint, expiresAt: new Date(Date.now() + 60000).toISOString(), options: [{ serviceCode: 'TEST_A', name: 'Serviço de teste A', priceCents: 1234, deliveryDays: 5 }, { serviceCode: 'TEST_B', name: 'Serviço de teste B', priceCents: 2345, deliveryDays: null }], ...options };
}
async function fixture(page, settings = config, dimensions = true) {
  await page.route('**/js/shipping-config.js', route => route.fulfill({ contentType: 'text/javascript', body: `const PRESENCE_SHIPPING = ${JSON.stringify(settings)};` }));
  if (dimensions) await page.route('**/js/catalog.js', async route => {
    const source = await route.fetch();
    await route.fulfill({ response: source, body: (await source.text()).replaceAll('shipping:{eligible:null,weightGrams:null,lengthCm:null,widthCm:null,heightCm:null}', `shipping:${JSON.stringify(measurement)}`) });
  });
}
async function cart(page) {
  await page.goto('/');
  await page.locator('[data-add-cart="biblia"]').first().click();
  await page.locator('[data-add-cart="devocional"]').first().click();
  await page.locator('#cart-open').click();
}
async function destination(page, cep = '01310100') {
  await page.locator('#destination-cep').fill(cep);
  await page.locator('#shipping-calculate').click();
}

test('CEP validation and fixed origin', () => {
  expect(shipping.ORIGIN_CEP).toBe('53110000');
  for (const cep of ['01310100', '01310-100', ' 53110-000 ']) expect(shipping.normalizeCEP(cep)).toBeTruthy();
  for (const cep of ['', '1234567', '123456789', '00000000', '11111-111', 'abc1310100', '0131-0100']) expect(shipping.normalizeCEP(cep)).toBeNull();
  expect(shipping.formatCEP('53110000')).toBe('53110-000');
});
test('multiple products use approved outer package and summed weight with tare', () => {
  expect(shipping.shipment(entries, packaging)).toEqual({ reliable: true, package: { weightGrams: 220, lengthCm: 20, widthCm: 15, heightCm: 8 } });
  expect(shipping.shipment([{ ...entries[0], quantity: 2 }, entries[1]], packaging).reliable).toBe(false);
  expect(shipping.shipment(entries, { strategy: 'manual' }).reliable).toBe(false);
  expect(shipping.shipment([{ ...entries[0], product: { shipping: null } }], packaging).reliable).toBe(false);
  expect(shipping.shipment([{ ...entries[0], product: { shipping: { ...measurement, heightCm: null } } }], packaging).reason).toContain('medidas');
});
test('response validation rejects stale, mismatched, unauthorized and malformed quotes', () => {
  const request = { destinationCEP: '01310100', fingerprint: 'test' };
  expect(shipping.validateResponse(response(request), request, config.enabledServices).options).toHaveLength(2);
  for (const extra of [{ destinationCEP: '53110000' }, { originCEP: '00000000' }, { fingerprint: 'old' }, { expiresAt: '2000-01-01T00:00:00Z' }, { source: 'manual' }, { options: [{ serviceCode: 'UNKNOWN', name: 'Test', priceCents: 10 }] }, { options: [{ serviceCode: 'TEST_A', name: 'Test', priceCents: 10.5 }] }, { options: [] }]) expect(() => shipping.validateResponse(response(request, extra), request, config.enabledServices)).toThrow('INVALID_RESPONSE');
});

for (const width of [1440, 390, 320]) {
  test(`shipping fallback and quotation message at ${width}px in both themes`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' });
    await cart(page);
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') { await page.locator('#cart-close').click(); await page.locator('#theme-toggle').click(); await page.locator('#cart-open').click(); }
      await expect(page.locator('#shipping-origin')).toHaveText('53110-000');
      await destination(page, '123');
      await expect(page.locator('#shipping-feedback')).toContainText('8 dígitos');
      await expect(page.locator('#destination-cep')).toHaveAttribute('aria-invalid', 'true');
      await destination(page);
      await expect(page.locator('#destination-cep')).toHaveValue('01310-100');
      await expect(page.locator('#shipping-feedback')).toContainText('Frete a consultar');
      await expect(page.locator('#shipping-cost')).toHaveText('A consultar');
      await expect(page.locator('#estimated-total')).toHaveText('A confirmar');
      const url = new URL(await page.locator('#shipping-quote-request').getAttribute('href'));
      expect(url.pathname).toBe('/5581994382429');
      const message = url.searchParams.get('text');
      for (const phrase of ['Bíblia', 'Devocional', 'Quantidade: 1', '53110-000', '01310-100', '105,00', 'Frete a consultar', 'total final ainda precisam de confirmação']) expect(message).toContain(phrase);
      const checkout = new URL(await page.locator('#cart-checkout').getAttribute('href')).searchParams.get('text');
      expect(checkout).toContain('01310-100'); expect(checkout).toContain('não está confirmado');
      expect(await page.locator('#cart-drawer').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
      await page.locator('#shipping-title').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/shipping-fallback-${width}-${theme}.png` });
    }
    expect(errors).toEqual([]);
  });
}

test('provider fixture integrates options, coupons and cart/CEP invalidation', async ({ page }) => {
  await fixture(page);
  await page.route('**/js/coupons.js', route => route.fulfill({ contentType: 'text/javascript', body: 'const PRESENCE_COUPONS = [{code:"TEST10",type:"percentage",value:10,active:true}];' }));
  const requests = [];
  await page.route('**/api/shipping', async route => {
    const request = route.request().postDataJSON(); requests.push(request);
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.fulfill({ json: response(request) });
  });
  await cart(page); await destination(page);
  await expect(page.locator('#shipping-cost')).toHaveText(/12,34/);
  await expect(page.locator('#estimated-total')).toHaveText(/117,34/);
  expect(requests[0].originCEP).toBe('53110000');
  expect(requests[0].package).toEqual({ weightGrams: 220, lengthCm: 20, widthCm: 15, heightCm: 8 });
  await page.locator('input[value="TEST_B"]').check();
  await expect(page.locator('#estimated-total')).toHaveText(/128,45/);
  await expect(page.locator('#shipping-options')).toContainText('Prazo a confirmar');
  let message = new URL(await page.locator('#cart-checkout').getAttribute('href')).searchParams.get('text');
  expect(message).toContain('Serviço de teste B'); expect(message).toContain('128,45');
  await page.locator('#coupon-code').fill('TEST10'); await page.locator('#coupon-apply').click();
  await expect(page.locator('#shipping-cost')).toHaveText('A consultar');
  await expect(page.locator('#shipping-feedback')).toContainText('invalidada');
  await destination(page);
  await expect(page.locator('#estimated-total')).toHaveText(/106,84/);
  message = new URL(await page.locator('#cart-checkout').getAttribute('href')).searchParams.get('text');
  for (const phrase of ['TEST10', '10,50', '106,84', '5 dias úteis']) expect(message).toContain(phrase);
  await page.locator('[data-focus="plus-0"]').click();
  await expect(page.locator('#estimated-total')).toHaveText('A confirmar');
  await page.locator('[data-focus="minus-0"]').click(); await destination(page);
  await expect(page.locator('#shipping-cost')).toHaveText(/12,34/);
  await page.locator('#destination-cep').fill('20040002');
  await expect(page.locator('#shipping-options')).toBeHidden();
  await expect(page.locator('#shipping-cost')).toHaveText('A consultar');
});

test('expired quotes stop affecting the estimated total automatically', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/shipping', route => route.fulfill({ json: response(route.request().postDataJSON(), { expiresAt: new Date(Date.now() + 1000).toISOString() }) }));
  await cart(page); await destination(page);
  await expect(page.locator('#shipping-cost')).toHaveText(/12,34/);
  await expect(page.locator('#shipping-cost')).toHaveText('A consultar');
  await expect(page.locator('#estimated-total')).toHaveText('A confirmar');
  await expect(page.locator('#shipping-feedback')).toContainText('invalidada');
});

for (const status of [401, 422, 503, 500]) {
  test(`provider error ${status} remains a quotation, never free shipping`, async ({ page }) => {
    await fixture(page); await page.route('**/api/shipping', route => route.fulfill({ status, json: { secret: 'never display provider payload' } }));
    await cart(page); await destination(page);
    await expect(page.locator('#shipping-feedback')).toContainText('Frete a consultar');
    await expect(page.locator('#shipping-feedback')).not.toContainText('secret');
    await expect(page.locator('#estimated-total')).toHaveText('A confirmar');
  });
}
test('provider timeout and in-flight cart edits cannot apply an old quote', async ({ page }) => {
  await fixture(page, { ...config, timeoutMs: 100 });
  await page.route('**/api/shipping', async route => { await new Promise(resolve => setTimeout(resolve, 600)); try { await route.fulfill({ json: response(route.request().postDataJSON()) }); } catch (_) {} });
  await cart(page); await destination(page);
  await expect(page.locator('#shipping-feedback')).toContainText('demorou');
  await expect(page.locator('#shipping-cost')).toHaveText('A consultar');
  await page.locator('#shipping-calculate').click();
  await page.locator('#destination-cep').fill('20040002');
  await expect(page.locator('#shipping-options')).toBeHidden();
  await expect(page.locator('#shipping-calculate')).toBeEnabled();
  await page.waitForTimeout(700);
  await expect(page.locator('#shipping-cost')).toHaveText('A consultar');
});
test('missing measurements prevent provider requests', async ({ page }) => {
  await fixture(page, config, false);
  let called = false;
  await page.route('**/api/shipping', route => { called = true; return route.abort(); });
  await cart(page); await destination(page);
  await expect(page.locator('#shipping-feedback')).toContainText('confirmação');
  expect(called).toBe(false);
});
