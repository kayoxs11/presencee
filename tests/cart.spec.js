const { test, expect } = require('@playwright/test');
const key = 'presence:cart:v1';
const testRules = [
  { code: 'TEST10', type: 'percentage', value: 10, active: true, minSubtotalCents: 10000 },
  { code: 'TESTFIX', type: 'fixed', value: 1000, active: true },
  { code: 'INACTIVE', type: 'fixed', value: 1000, active: false },
];
async function fixtureCoupons(page) {
  await page.route('**/js/coupons.js', route => route.fulfill({ contentType: 'text/javascript', body: `const PRESENCE_COUPONS = ${JSON.stringify(testRules)};` }));
}
async function add(page, id, times = 1) {
  for (let i = 0; i < times; i++) await page.locator(`[data-add-cart="${id}"]`).first().click();
}
async function open(page) { await page.locator('#cart-open').click(); await expect(page.locator('#cart-drawer')).toBeVisible(); }

for (const width of [1440, 390, 320]) {
  test(`cart, coupons and checkout at ${width}px in both themes`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fixtureCoupons(page);
    await page.goto('/');
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.locator('#theme-toggle').click();
      await add(page, 'biblia', 2); await add(page, 'devocional');
      await expect(page.locator('#cart-count')).toHaveText('3');
      await open(page);
      await expect(page.locator('.cart-line')).toHaveCount(2);
      await expect(page.locator('#cart-total')).toContainText('165,00');
      await page.locator('#coupon-code').fill('UNKNOWN'); await page.locator('#coupon-apply').click();
      await expect(page.locator('#coupon-feedback')).toContainText('não encontrado');
      await page.locator('#coupon-code').fill('INACTIVE'); await page.locator('#coupon-apply').click();
      await expect(page.locator('#coupon-feedback')).toContainText('inativo');
      await page.locator('#coupon-code').fill(' test10 '); await page.locator('#coupon-apply').click();
      await expect(page.locator('#cart-discount')).toContainText('16,50');
      await expect(page.locator('#cart-total')).toContainText('148,50');
      await page.locator('[data-focus="plus-0"]').click();
      await expect(page.locator('#cart-total')).toContainText('202,50');
      await page.locator('[data-focus="minus-0"]').click();
      await page.locator('#remove-coupon').click();
      await expect(page.locator('#cart-total')).toContainText('165,00');
      await page.locator('#coupon-code').fill('TESTFIX'); await page.locator('#coupon-apply').click();
      await expect(page.locator('#cart-total')).toContainText('155,00');
      const text = new URL(await page.locator('#cart-checkout').getAttribute('href')).searchParams.get('text');
      for (const word of ['Bíblia', 'Devocional', 'Quantidade: 2', 'TESTFIX', '155,00', 'frete não incluídos']) expect(text).toContain(word);
      expect(await page.locator('#cart-drawer').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
      await page.screenshot({ path: `test-results/cart-${width}-${theme}.png` });
      await page.keyboard.press('Escape');
      await expect(page.locator('#cart-drawer')).not.toBeVisible();
      await expect(page.locator('#cart-open')).toBeFocused();
      await page.reload(); await open(page);
      await expect(page.locator('#cart-total')).toContainText('155,00');
      await page.locator('[data-cart-remove="1"]').click();
      await expect(page.locator('#cart-total')).toContainText('110,00');
      await page.locator('#cart-clear').click();
      await expect(page.locator('#cart-total')).toContainText('0,00');
      await expect(page.locator('#cart-checkout')).toHaveAttribute('aria-disabled', 'true');
      await page.locator('#cart-continue').click();
    }
    expect(errors).toEqual([]);
  });
}

test('detail quantity adds to the cart and coupon is invalidated below minimum', async ({ page }) => {
  await fixtureCoupons(page); await page.goto('/#p-reforma');
  await page.locator('#dq').fill('2'); await page.locator('#detail-add-cart').click(); await open(page);
  await expect(page.locator('#cart-total')).toContainText('140,00');
  await page.locator('#coupon-code').fill('TEST10'); await page.locator('#coupon-apply').click();
  await page.locator('[data-focus="minus-0"]').click();
  await expect(page.locator('#cart-total')).toContainText('70,00');
  await expect(page.locator('#coupon-feedback')).toContainText('mínimo');
  await page.locator('#cart-close').click(); await page.goto('/#p-caneca');
  await expect(page.locator('#detail-add-cart')).toHaveCount(0);
  await expect(page.locator('#dgo')).toContainText('Solicitar orçamento');
  await expect(page.locator('#cart-count')).toHaveText('1');
});

test('malformed storage is safe and saved prices do not control totals', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(key => localStorage.setItem(key, '{bad json'), key); await page.reload(); await open(page);
  await expect(page.locator('#cart-notice')).toContainText('inválido');
  await expect(page.locator('.cart-line')).toHaveCount(0);
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ version: 1, lines: [{ id: 'biblia', quantity: 2, priceSeen: 1, price: 0 }, { id: 'caneca', quantity: 1 }, { id: 'missing', quantity: 1 }] })), key);
  await page.reload(); await open(page);
  await expect(page.locator('.cart-line')).toHaveCount(1);
  await expect(page.locator('#cart-total')).toContainText('120,00');
  await expect(page.locator('#cart-notice')).toContainText('atualizado');
  await expect(page.locator('#cart-notice')).toContainText('removido');
});

test('native dialog traps focus and restores it, with animated close', async ({ page }) => {
  await page.goto('/'); await open(page);
  await expect(page.locator('#cart-close')).toBeFocused();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement === document.body || document.querySelector('#cart-drawer').contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#cart-drawer')).not.toBeVisible();
  await expect(page.locator('#cart-open')).toBeFocused();
});

test('long summaries offer the entire text for copy or download', async ({ page }) => {
  // Isolated priced, personalized fixture; no new public product or price.
  await page.route('**/js/catalog.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('price:60,img:""', 'price:60,personalizable:true,img:""').replace('personalizable:false,available:true},', 'personalizable:true,available:true},') });
  });
  await page.goto('/#p-biblia');
  for (let i = 0; i < 3; i++) { await page.locator('#dn').fill(`Configuração ${i}: ` + 'Detalhes '.repeat(25)); await page.locator('#detail-add-cart').click(); }
  await open(page); await expect(page.locator('.cart-line')).toHaveCount(3);
  await page.locator('#cart-checkout').click();
  await expect(page.locator('#checkout-fallback')).toBeVisible();
  const text = await page.locator('#order-message').inputValue();
  for (let i = 0; i < 3; i++) expect(text).toContain(`Configuração ${i}`);
  const downloadPromise = page.waitForEvent('download'); await page.locator('#download-order').click();
  const download = await downloadPromise; expect(download.suggestedFilename()).toBe('presence-resumo-do-pedido.txt');
  await expect(page.locator('#fallback-whatsapp')).toHaveAttribute('href', /wa.me\/5581994382429/);
});
