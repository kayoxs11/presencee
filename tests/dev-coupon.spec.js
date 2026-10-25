const { test, expect } = require('@playwright/test');
const engine = require('../js/commerce');
const { PRODUCTS } = require('../js/catalog');
const devURL = 'http://127.0.0.1:8020';
const prodURL = 'http://127.0.0.1:8021';
const headers = { Origin: devURL, 'X-Presence-Development': '1' };

test('server-only engine grants 100% merchandise, never shipping, while default engine denies DEV', () => {
  const lines = [{ id: 'biblia', quantity: 2 }, { id: 'devocional', quantity: 1 }];
  const shipping = { quoteId: 'test', serviceCode: 'TEST_A', priceCents: 1234, destinationCEP: '01310100', expiresAt: Date.now() + 60000 };
  const order = engine.createDevelopmentEngine().summary(lines, PRODUCTS, 'DEV', [], Date.now(), shipping);
  expect(order.subtotal).toBe(16500); expect(order.discount).toBe(16500);
  expect(order.total).toBe(0); expect(order.shippingDiscount).toBe(0);
  expect(order.payableShipping).toBe(1234); expect(order.estimatedTotal).toBe(1234);
  expect(engine.summary(lines, PRODUCTS, 'DEV', []).coupon.valid).toBe(false);
});

test('local API resolves current prices and rejects invalid, unpriced and cross-origin requests', async ({ request }) => {
  const response = await request.post(devURL + '/__dev__/coupons', { headers, data: { code: 'DEV', lines: [{ id: 'biblia', quantity: 2, price: 1 }], discount: 1, total: 1, shippingDiscount: 99999 } });
  expect(response.status()).toBe(200);
  const order = await response.json();
  expect(order.discount).toBe(12000); expect(order.total).toBe(0); expect(order.shippingDiscount).toBe(0);
  for (const lines of [[{ id: 'caneca', quantity: 1 }], [{ id: 'biblia', quantity: 0 }], [{ id: 'missing', quantity: 1 }], []]) {
    expect((await request.post(devURL + '/__dev__/coupons', { headers, data: { code: 'DEV', lines } })).status()).toBe(422);
  }
  expect((await request.post(devURL + '/__dev__/coupons', { headers: { ...headers, Origin: 'https://attacker.example' }, data: { code: 'DEV', lines: [{ id: 'biblia', quantity: 1 }] } })).status()).toBe(403);
  expect((await request.post(devURL + '/__dev__/coupons', { data: { code: 'DEV', lines: [{ id: 'biblia', quantity: 1 }] } })).status()).toBe(403);
  expect((await request.get(devURL + '/__dev__/coupons.js', { headers: { Host: 'attacker.example:8020' } })).status()).toBe(404);
});

for (const width of [1440, 390]) {
  test(`local DEV applies, persists, updates, and removes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(devURL);
    await page.locator('[data-add-cart="biblia"]').first().click();
    await page.locator('[data-add-cart="devocional"]').first().click();
    await page.locator('#cart-open').click();
    await page.locator('#coupon-code').fill(' dev '); await page.locator('#coupon-apply').click();
    await expect(page.locator('#applied-coupon')).toHaveText('DEV');
    await expect(page.locator('#cart-subtotal')).toContainText('105,00');
    await expect(page.locator('#cart-discount')).toContainText('105,00');
    await expect(page.locator('#cart-total')).toContainText('0,00');
    await expect(page.locator('#estimated-total')).toHaveText('A confirmar');
    await expect(page.locator('#shipping-payable')).toHaveText('A consultar');
    await expect(page.locator('#coupon-feedback')).toContainText('desenvolvimento');
    await page.locator('[data-focus="plus-0"]').click();
    await expect(page.locator('#cart-discount')).toContainText('165,00');
    await expect(page.locator('#cart-total')).toContainText('0,00');
    await page.locator('[data-cart-remove="1"]').click();
    await expect(page.locator('#cart-discount')).toContainText('120,00');
    await page.reload(); await page.locator('#cart-open').click();
    await expect(page.locator('#applied-coupon')).toHaveText('DEV');
    await expect(page.locator('#cart-discount')).toContainText('120,00');
    await page.locator('#remove-coupon').click();
    await expect(page.locator('#cart-total')).toContainText('120,00');
    await expect(page.locator('#cart-discount')).toContainText('0,00');
    await page.locator('#cart-close').click(); await page.locator('#theme-toggle').click(); await page.locator('#cart-open').click();
    await page.locator('#coupon-code').fill('DEV'); await page.locator('#coupon-apply').click();
    await expect(page.locator('#cart-discount')).toContainText('120,00');
    expect(errors).toEqual([]);
  });
}

test('localhost hostname works in the supported explicit dev server', async ({ page }) => {
  await page.goto('http://localhost:8020');
  await page.locator('[data-add-cart="biblia"]').first().click(); await page.locator('#cart-open').click();
  await page.locator('#coupon-code').fill('DEV'); await page.locator('#coupon-apply').click();
  await expect(page.locator('#cart-discount')).toContainText('60,00');
});

test('quoted shipping remains payable after the server grants DEV', async ({ page }) => {
  await page.route('**/js/shipping-config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'const PRESENCE_SHIPPING={endpoint:"/api/shipping",timeoutMs:1000,enabledServices:["TEST_A"],packaging:{strategy:"approved-recipes",recipes:[{items:{biblia:1},tareGrams:20,lengthCm:20,widthCm:15,heightCm:8}]}};' }));
  await page.route('**/js/catalog.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replaceAll('shipping:{eligible:null,weightGrams:null,lengthCm:null,widthCm:null,heightCm:null}', 'shipping:{eligible:true,weightGrams:100,lengthCm:10,widthCm:8,heightCm:2}') });
  });
  await page.route('**/api/shipping', route => route.fulfill({ json: { ...route.request().postDataJSON(), source: 'correios', quoteId: 'fixture', expiresAt: new Date(Date.now() + 60000).toISOString(), options: [{ serviceCode: 'TEST_A', name: 'Serviço de teste', priceCents: 1234, deliveryDays: 5 }] } }));
  await page.goto(devURL); await page.locator('[data-add-cart="biblia"]').first().click(); await page.locator('#cart-open').click();
  await page.locator('#coupon-code').fill('DEV'); await page.locator('#coupon-apply').click();
  await expect(page.locator('#applied-coupon')).toHaveText('DEV');
  await page.locator('#destination-cep').fill('01310100'); await page.locator('#shipping-calculate').click();
  await expect(page.locator('#shipping-payable')).toContainText('12,34');
  await expect(page.locator('#shipping-discount')).toContainText('0,00');
  await expect(page.locator('#estimated-total')).toContainText('12,34');
  const message = new URL(await page.locator('#cart-checkout').getAttribute('href')).searchParams.get('text');
  expect(message).toContain('Cupom: DEV'); expect(message).toContain('12,34');
});

test('NODE_ENV=production overrides --dev and rejects flags, storage and direct API requests', async ({ page, request }) => {
  const response = await request.get(prodURL);
  expect(await response.text()).not.toContain('/__dev__/coupons.js');
  expect((await request.get(prodURL + '/__dev__/coupons.js')).status()).toBe(404);
  expect((await request.post(prodURL + '/__dev__/coupons', { headers: { Origin: prodURL, 'X-Presence-Development': '1' }, data: { code: 'DEV', environment: 'development', authorized: true, lines: [{ id: 'biblia', quantity: 1 }] } })).status()).toBe(403);
  await page.goto(prodURL + '/?dev=true&environment=development');
  await page.evaluate(() => localStorage.setItem('presence:cart:v1', JSON.stringify({ version: 1, coupon: 'DEV', authorized: true, lines: [{ id: 'biblia', quantity: 1 }] })));
  await page.reload(); await page.locator('#cart-open').click();
  await expect(page.locator('#applied-coupon')).toHaveText('');
  await expect(page.locator('#cart-total')).toContainText('60,00');
  await expect(page.locator('#coupon-feedback')).toContainText('não está disponível');
});
