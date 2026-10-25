const { test, expect } = require('@playwright/test');
const engine = require('../js/commerce');
const publicRules = require('../js/coupons');
const shipEngine = require('../js/shipping');
const catalog = cents => [{ id: 'fixture', name: 'Combo de teste', is_combo: true, price: cents / 100, available: true, cat: 'test' }];
const lines = [{ id: 'fixture', quantity: 1 }];
const shipping = { quoteId: 'test-only-quote', serviceCode: 'TEST_A', destinationCEP: '01310100', priceCents: 1234, expiresAt: Date.now() + 3600000 };
const order = (code, cents, context = null, rules = publicRules) => engine.summary(lines, catalog(cents), code, rules, Date.now(), context);

test('BEMVINDO5 is 7%, with an exact R$50 eligible merchandise boundary', () => {
  expect(order('BEMVINDO5', 4999).coupon.valid).toBe(false);
  expect(order('BEMVINDO5', 4999).coupon.message).toContain('50,00');
  expect(order(' bemvindo5 ', 5000).discount).toBe(350);
  expect(order('BEMVINDO5', 5001).discount).toBe(350);
  expect(order('BEMVINDO5', 5050).discount).toBe(354);
  expect(order('BEMVINDO5', 6000, shipping).estimatedTotal).toBe(6814);
  expect(order('BEMVINDO5', 6000, shipping).shippingDiscount).toBe(0);
});
test('PRESENCA10 has no minimum for explicit combos and rounds half cents up', () => {
  for (const cents of [1, 5, 45, 1005, 4500]) {
    const value = order('PRESENCA10', cents, shipping);
    expect(value.coupon.valid).toBe(true);
    expect(value.discount).toBe(Math.floor((cents + 5) / 10));
    expect(value.payableShipping).toBe(1234);
    expect(value.total).toBeGreaterThanOrEqual(0);
    expect(Number.isSafeInteger(value.estimatedTotal)).toBe(true);
  }
});
test('FRETEGRATIS only waives known, selected, unexpired shipping, at any merchandise amount', () => {
  for (const context of [null, {}, { ...shipping, quoteId: '' }, { ...shipping, serviceCode: '' }, { ...shipping, expiresAt: 1 }, { ...shipping, priceCents: null }, { ...shipping, priceCents: -1 }]) {
    const value = order('FRETEGRATIS', 6000, context);
    expect(value.coupon.valid).toBe(false);
    expect(value.coupon.message).toContain('cotação');
    expect(value.shippingDiscount).toBe(0);
    expect(value.estimatedTotal).toBeNull();
  }
  const value = order('FRETEGRATIS', 1, shipping);
  expect(value.discount).toBe(0);
  expect(value.shippingDiscount).toBe(1234);
  expect(value.payableShipping).toBe(0);
  expect(value.estimatedTotal).toBe(1);
  expect(order('FRETEGRATIS', 6000, { ...shipping, priceCents: 0 }).estimatedTotal).toBe(6000);
});
test('removal and replacement use one coupon only, without discounting shipping twice', () => {
  expect(order('BEMVINDO5 PRESENCA10', 6000, shipping).coupon.valid).toBe(false);
  expect(order('PRESENCA10', 6000, shipping).estimatedTotal).toBe(6634);
  expect(order('FRETEGRATIS', 6000, shipping).estimatedTotal).toBe(6000);
  const removed = order('', 6000, shipping);
  expect(removed.discount).toBe(0); expect(removed.shippingDiscount).toBe(0);
  expect(removed.estimatedTotal).toBe(7234);
});
test('all public coupons respect expiration and disabled rules', () => {
  for (const rule of publicRules) {
    expect(order(rule.code, 6000, shipping, [{ ...rule, active: false }]).coupon.message).toContain('inativo');
    expect(order(rule.code, 6000, shipping, [{ ...rule, expiresAt: '2000-01-01T00:00:00Z' }]).coupon.message).toContain('expirou');
  }
});
test('DEV cannot be authorized by a forged active rule or caller-supplied environment', () => {
  expect(publicRules.find(rule => rule.code === 'DEV')).toBeUndefined();
  const forged = [{ code: 'DEV', active: true, type: 'percentage', value: 100, environment: 'development', authorized: true }];
  const value = order(' dev ', 6000, { ...shipping, authorized: true, admin: true, environment: 'test' }, forged);
  expect(value.coupon.valid).toBe(false);
  expect(value.discount).toBe(0); expect(value.shippingDiscount).toBe(0);
  expect(value.estimatedTotal).toBe(7234);
});
test('100% merchandise math in an isolated fixture never waives shipping', () => {
  const value = order('TEST_ONLY_FULL', 6000, shipping, [{ code: 'TEST_ONLY_FULL', active: true, type: 'percentage', value: 100 }]);
  expect(value.total).toBe(0);
  expect(value.shippingDiscount).toBe(0);
  expect(value.estimatedTotal).toBe(1234);
  expect(order('TEST_ONLY_FULL', 6000, shipping, [{ code: 'TEST_ONLY_FULL', active: true, type: 'percentage', value: 101 }]).coupon.valid).toBe(false);
});
test('quote fingerprint preserves a shipping waiver but binds merchandise/cart changes', () => {
  const plain = order('', 6000, shipping), waived = order('FRETEGRATIS', 6000, shipping);
  const config = { enabledServices: ['TEST_A'], endpoint: '/api/shipping', packaging: {} };
  expect(shipEngine.fingerprint(waived, '01310100', config)).toBe(shipEngine.fingerprint(plain, '01310100', config));
  expect(shipEngine.fingerprint(order('PRESENCA10', 6000, shipping), '01310100', config)).not.toBe(shipEngine.fingerprint(plain, '01310100', config));
});

async function add(page, id) { await page.locator(`[data-add-cart="${id}"]`).first().click(); }
async function open(page) { await page.locator('#cart-open').click(); }
async function apply(page, code) { await page.locator('#coupon-code').fill(code); await page.locator('#coupon-apply').click(); }

for (const width of [1440, 390, 320]) {
  test(`public merchandise coupons and offline free-shipping validation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' });
    // Test-only classification; the real catalog is not changed into combos.
    await page.route('**/js/catalog.js', async route => {
      const source = await route.fetch();
      await route.fulfill({ response: source, body: (await source.text()).replace('id:"devocional",is_combo:false', 'id:"devocional",is_combo:true') });
    });
    await page.goto('/'); await add(page, 'devocional'); await open(page);
    await apply(page, 'BEMVINDO5');
    await expect(page.locator('#coupon-feedback')).toContainText('50,00');
    await apply(page, ' presenca10 ');
    await expect(page.locator('#cart-discount')).toContainText('4,50');
    await expect(page.locator('#cart-total')).toContainText('40,50');
    await expect(page.locator('#shipping-payable')).toHaveText('A consultar');
    await apply(page, 'FRETEGRATIS');
    await expect(page.locator('#coupon-feedback')).toContainText('cotação');
    await expect(page.locator('#applied-coupon')).toHaveText('PRESENCA10');
    await page.locator('#remove-coupon').click(); await page.locator('#cart-close').click();
    await add(page, 'biblia'); await open(page); await apply(page, 'BEMVINDO5');
    await expect(page.locator('#cart-discount')).toContainText('7,35');
    await expect(page.locator('#cart-total')).toContainText('97,65');
    await page.locator('[data-cart-remove="1"]').click();
    await expect(page.locator('#coupon-feedback')).toContainText('mínimo');
    await expect(page.locator('#cart-total')).toContainText('45,00');
    await expect(page.locator('#applied-coupon')).toHaveText('');
    await apply(page, 'PRESENCA10'); await page.reload(); await open(page);
    await expect(page.locator('#cart-total')).toContainText('40,50');
    await page.locator('#cart-close').click(); await page.locator('#theme-toggle').click(); await open(page);
    await expect(page.locator('#cart-total')).toContainText('40,50');
    await apply(page, 'DEV'); await expect(page.locator('#coupon-feedback')).toContainText('não está disponível');
    expect(await page.locator('#cart-drawer').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  });
}

test('production DEV rejects stored totals, forged rules, URL flags and direct API requests', async ({ page, request }) => {
  await page.goto('/?coupon=DEV&environment=development&admin=true&dev=true');
  await page.evaluate(() => {
    localStorage.setItem('presence:cart:v1', JSON.stringify({ version: 1, lines: [{ id: 'biblia', quantity: 1 }], coupon: 'DEV', discount: 6000, total: 0, authorized: true, shippingDiscount: 99999 }));
    localStorage.setItem('environment', 'development'); localStorage.setItem('admin', 'true');
    sessionStorage.setItem('dev', 'true');
  });
  await page.reload(); await open(page);
  await expect(page.locator('#coupon-feedback')).toContainText('não está disponível');
  await expect(page.locator('#cart-total')).toContainText('60,00');
  await expect(page.locator('#applied-coupon')).toHaveText('');
  await page.evaluate(() => {
    window.DEV = true; window.authorized = true; window.environment = 'development';
    PRESENCE_COUPONS.push({ code: 'DEV', active: true, type: 'percentage', value: 100 });
  });
  await apply(page, 'DEV');
  await expect(page.locator('#cart-discount')).toContainText('0,00');
  await expect(page.locator('#cart-total')).toContainText('60,00');
  const text = new URL(await page.locator('#cart-checkout').getAttribute('href')).searchParams.get('text');
  expect(text).not.toContain('Cupom: DEV');
  for (const url of ['/api/coupons', '/api/checkout']) {
    const response = await request.post(url, { data: { coupon: 'DEV', discount: 6000, total: 0, environment: 'development', admin: true } });
    expect(response.status()).toBe(403); // Commerce API now rejects requests lacking same-origin CSRF headers.
  }
});

async function shippingFixture(page, expiresMs = 60000) {
  await page.route('**/js/shipping-config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'const PRESENCE_SHIPPING = {endpoint:"/api/shipping",timeoutMs:1000,enabledServices:["TEST_A","TEST_B"],packaging:{strategy:"approved-recipes",recipes:[{items:{biblia:1},tareGrams:20,lengthCm:20,widthCm:15,heightCm:8}]}};' }));
  await page.route('**/js/catalog.js', async route => {
    const source = await route.fetch();
    await route.fulfill({ response: source, body: (await source.text()).replaceAll('shipping:{eligible:null,weightGrams:null,lengthCm:null,widthCm:null,heightCm:null}', 'shipping:{eligible:true,weightGrams:100,lengthCm:10,widthCm:8,heightCm:2}') });
  });
  await page.route('**/api/shipping', route => {
    const body = route.request().postDataJSON();
    return route.fulfill({ json: { ...body, source: 'correios', quoteId: 'test-only', expiresAt: new Date(Date.now() + expiresMs).toISOString(), options: [{ serviceCode: 'TEST_A', name: 'Teste A', priceCents: 1234, deliveryDays: 5 }, { serviceCode: 'TEST_B', name: 'Teste B', priceCents: 2345, deliveryDays: 2 }] } });
  });
  await page.goto('/'); await add(page, 'biblia'); await open(page);
  await page.locator('#destination-cep').fill('01310100'); await page.locator('#shipping-calculate').click();
  await expect(page.locator('#shipping-cost')).toContainText('12,34');
}

test('free shipping uses the selected quote, recalculates, removes, and reaches WhatsApp', async ({ page }) => {
  await shippingFixture(page); await apply(page, 'FRETEGRATIS');
  await expect(page.locator('#applied-coupon')).toHaveText('FRETEGRATIS');
  await expect(page.locator('#cart-discount')).toContainText('0,00');
  await expect(page.locator('#cart-total')).toContainText('60,00');
  await expect(page.locator('#shipping-discount')).toContainText('12,34');
  await expect(page.locator('#shipping-payable')).toContainText('0,00');
  await expect(page.locator('#estimated-total')).toContainText('60,00');
  await page.locator('input[value="TEST_B"]').check();
  await expect(page.locator('#shipping-discount')).toContainText('23,45');
  const text = new URL(await page.locator('#cart-checkout').getAttribute('href')).searchParams.get('text');
  for (const phrase of ['FRETEGRATIS', 'Teste B', 'Desconto no frete: R$', '23,45', 'Frete a pagar: R$', '60,00']) expect(text).toContain(phrase);
  await page.locator('#remove-coupon').click();
  await expect(page.locator('#estimated-total')).toContainText('83,45');
  await apply(page, 'FRETEGRATIS');
  await page.screenshot({ path: 'test-results/coupon-shipping-waiver-light.png' });
  await page.locator('[data-focus="plus-0"]').click();
  await expect(page.locator('#applied-coupon')).toHaveText('');
  await expect(page.locator('#coupon-feedback')).toContainText('cotação');
  await expect(page.locator('#estimated-total')).toHaveText('A confirmar');
  await expect(page.locator('#shipping-discount')).toContainText('0,00');
  await page.reload(); await open(page);
  await expect(page.locator('#applied-coupon')).toHaveText('');
  await expect(page.locator('#shipping-payable')).toHaveText('A consultar');
});
test('expired shipping and destination changes remove FRETEGRATIS instead of claiming free delivery', async ({ page }) => {
  await shippingFixture(page, 1500); await apply(page, 'FRETEGRATIS');
  await expect(page.locator('#applied-coupon')).toHaveText('FRETEGRATIS');
  await expect(page.locator('#shipping-payable')).toHaveText('A consultar');
  await expect(page.locator('#applied-coupon')).toHaveText('');
  await page.locator('#shipping-calculate').click(); await expect(page.locator('#shipping-cost')).toContainText('12,34');
  await apply(page, 'FRETEGRATIS');
  await page.locator('#destination-cep').fill('20040002');
  await expect(page.locator('#shipping-discount')).toContainText('0,00');
  await expect(page.locator('#applied-coupon')).toHaveText('');
  await expect(page.locator('#shipping-payable')).toHaveText('A consultar');
});
