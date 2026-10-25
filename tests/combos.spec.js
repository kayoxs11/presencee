const { test, expect } = require('@playwright/test');
const engine = require('../js/commerce');
const rules = require('../js/coupons');
// Isolated catalog fixtures. No new products or classifications are published.
const catalog = [
  { id: 'combo-a', name: 'Produto A', is_combo: true, price: 10.05, available: true },
  { id: 'combo-b', name: 'Produto B', is_combo: true, price: 20.05, available: true },
  { id: 'individual', name: 'Kit combo no nome não basta', is_combo: false, price: 60, available: true },
];
const line = (id, quantity = 1, extra = {}) => ({ id, quantity, ...extra });
const summary = (lines, products = catalog, code = 'PRESENCA10') => engine.summary(lines, products, code, rules);
const rejection = 'Este cupom é válido somente para combos.';

test('combo-only cart receives 10% with no minimum and integer-cent rounding', () => {
  const order = summary([line('combo-a')]);
  expect(order.coupon.valid).toBe(true);
  expect(order.subtotal).toBe(1005);
  expect(order.discount).toBe(101);
  expect(order.total).toBe(904);
});
test('mixed cart discounts only combo quantities and charges individual items in full', () => {
  const order = summary([line('combo-a', 2), line('individual')]);
  expect(order.subtotal).toBe(8010);
  expect(order.discount).toBe(201);
  expect(order.total).toBe(7809);
});
test('individual-only cart rejects with the exact message, regardless of product name', () => {
  const order = summary([line('individual', 5)]);
  expect(order.coupon.valid).toBe(false);
  expect(order.coupon.message).toBe(rejection);
  expect(order.discount).toBe(0);
  expect(order.total).toBe(30000);
});
test('multiple eligible combos sum quantities before rounding once', () => {
  const order = summary([line('combo-a', 2), line('combo-b', 3), line('individual')]);
  expect(order.subtotal).toBe(14025);
  expect(order.discount).toBe(803);
  expect(order.total).toBe(13222);
  const small = [{ ...catalog[0], price: .05 }, { ...catalog[1], price: .05 }];
  expect(summary([line('combo-a'), line('combo-b')], small).discount).toBe(1);
});
test('quantity changes, combo removal and catalog reclassification recalculate eligibility', () => {
  expect(summary([line('combo-a', 3), line('individual')]).discount).toBe(302);
  expect(summary([line('combo-a'), line('individual')]).discount).toBe(101);
  expect(summary([line('individual')]).coupon.message).toBe(rejection);
  const changed = catalog.map(product => ({ ...product, is_combo: false }));
  expect(summary([line('combo-a')], changed).discount).toBe(0);
  expect(summary([line('combo-a')], changed).coupon.message).toBe(rejection);
});
test('missing/truthy flags and forged saved cart flags never classify a product as a combo', () => {
  for (const flag of [undefined, null, false, 'true', 1]) {
    const products = [{ ...catalog[2], is_combo: flag }];
    const order = summary([line('individual', 1, { is_combo: true, type: 'combo' })], products);
    expect(order.coupon.message).toBe(rejection);
    expect(order.discount).toBe(0);
  }
});
test('other coupons keep individual merchandise and shipping behavior', () => {
  expect(summary([line('individual')], catalog, 'BEMVINDO5').discount).toBe(420);
  const shipping = { quoteId: 'test-only', serviceCode: 'TEST', destinationCEP: '01310100', expiresAt: Date.now() + 60000, priceCents: 1000 };
  const waived = engine.summary([line('individual')], catalog, 'FRETEGRATIS', rules, Date.now(), shipping);
  expect(waived.discount).toBe(0); expect(waived.shippingDiscount).toBe(1000);
  expect(waived.estimatedTotal).toBe(6000);
  expect(summary([line('individual')], catalog, 'DEV').coupon.valid).toBe(false);
});

test('real catalog and restored line metadata cannot apply PRESENCA10 without actual combos', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('presence:cart:v1', JSON.stringify({ version: 1, lines: [{ id: 'biblia', quantity: 1, is_combo: true }], coupon: 'PRESENCA10' })));
  await page.reload(); await page.locator('#cart-open').click();
  await expect(page.locator('#coupon-feedback')).toContainText(rejection);
  await expect(page.locator('#cart-total')).toContainText('60,00');
  await expect(page.locator('#applied-coupon')).toHaveText('');
  await page.locator('#coupon-code').fill('PRESENCA10'); await page.locator('#coupon-apply').click();
  await expect(page.locator('#coupon-feedback')).toHaveText(rejection);
});

for (const width of [1440, 390]) {
  test(`mixed cart revalidates combo discount and checkout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/js/catalog.js', async route => {
      const source = await route.fetch();
      await route.fulfill({ response: source, body: (await source.text()).replace('id:"devocional",is_combo:false', 'id:"devocional",is_combo:true') });
    });
    await page.goto('/');
    await page.locator('[data-add-cart="biblia"]').first().click();
    await page.locator('[data-add-cart="devocional"]').first().click();
    await page.locator('#cart-open').click();
    await page.locator('#coupon-code').fill('PRESENCA10'); await page.locator('#coupon-apply').click();
    await expect(page.locator('#cart-discount')).toContainText('4,50');
    await expect(page.locator('#cart-total')).toContainText('100,50');
    // Increasing an individual item must not increase the discount.
    await page.locator('[data-focus="plus-0"]').click();
    await expect(page.locator('#cart-discount')).toContainText('4,50');
    await expect(page.locator('#cart-total')).toContainText('160,50');
    await page.locator('[data-focus="plus-1"]').click();
    await expect(page.locator('#cart-discount')).toContainText('9,00');
    await expect(page.locator('#cart-total')).toContainText('201,00');
    const message = new URL(await page.locator('#cart-checkout').getAttribute('href')).searchParams.get('text');
    expect(message).toContain('Cupom: PRESENCA10'); expect(message).toContain('201,00');
    await page.locator('[data-cart-remove="1"]').click();
    await expect(page.locator('#coupon-feedback')).toContainText(rejection);
    await expect(page.locator('#cart-discount')).toContainText('0,00');
    await expect(page.locator('#cart-total')).toContainText('120,00');
    await expect(page.locator('#applied-coupon')).toHaveText('');
  });
}
