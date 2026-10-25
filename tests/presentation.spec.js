const { test, expect } = require('@playwright/test');

test.use({ reducedMotion: 'reduce' });
const savedCart = { version: 1, lines: [{ id: 'biblia', quantity: 2 }] };
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`selection journey remains readable at ${width}px in both themes`, async ({ page }, testInfo) => {
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/')) writes.push(request.url()); });
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(cart => localStorage.setItem('presence:cart:v1', JSON.stringify(cart)), savedCart);
    for (const theme of ['light', 'dark']) {
      await page.goto('/');
      if (theme === 'dark') await page.locator('#theme-toggle').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('#grid .card')).toHaveCount(16);
      await expect(page.locator('#grid .product-visual img')).toHaveCount(0);
      await expect(page.locator('.catalog-guidance')).toContainText('dependem da resposta da loja');
      const button = page.locator('[data-add-cart="biblia"]').first();
      expect(await button.evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
      expect(await button.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(12);
      await noOverflow(page);
      await page.locator('#grid').evaluate(e => e.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: testInfo.outputPath(`catalog-${theme}.png`) });

      // Exercise the actual menu at tablet/mobile widths without changing route focus behavior.
      if (width <= 1080) {
        await page.locator('#burger').click();
        await expect(page.locator('#mnav')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#burger')).toBeFocused();
      }
      await page.goto('/#p-biblia');
      await expect(page.locator('#pt')).toBeFocused();
      await expect(page.locator('.gal .main .image-fallback')).toBeVisible();
      await expect(page.locator('#dgo')).toContainText('Consultar pelo WhatsApp');
      await noOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`detail-${theme}.png`) });

      await page.locator('#cart-open').click();
      await expect(page.locator('.cart-line')).toHaveCount(1);
      expect(await page.locator('#cart-drawer').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`cart-${theme}.png`) });
      await page.keyboard.press('Escape');
      await page.goto('/checkout.html');
      await expect(page.locator('.selection-totals > div')).toHaveCount(5);
      await expect(page.locator('.selection-totals > div').nth(2)).toContainText('120,00');
      await expect(page.locator('.selection-totals > div').nth(3)).toHaveText('Frete: a consultar');
      await expect(page.locator('.selection-totals > div').last()).toHaveText('Total final: a confirmar pelo WhatsApp');
      await expect(page.locator('#checkout-whatsapp')).toHaveAttribute('href', /^https:\/\/wa\.me\//);
      await expect(page.locator('input[type="password"], input[autocomplete^="cc-"]')).toHaveCount(0);
      await noOverflow(page);
      for (const control of ['#order-message', '#checkout-whatsapp', '#copy-order', '#download-order']) {
        expect(await page.locator(control).evaluate(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })).toBe(true);
      }
      await page.screenshot({ path: testInfo.outputPath(`review-${theme}.png`), fullPage: true });
    }
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });
}

// Synthetic geometric SVGs are served only inside this test, never published as product photos.
const fixtureImage = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1000"><rect width="600" height="1000" fill="#046A6A"/></svg>';
async function galleryFixture(page) {
  await page.route('**/js/catalog.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('price:60,img:""', 'price:60,img:"",images:["/test-photo.svg","/missing-photo.svg"]') });
  });
  await page.route('**/test-photo.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: fixtureImage }));
  await page.route('**/missing-photo.svg', route => route.fulfill({ status: 404, body: '' }));
}

test('portrait photos retain their frame; gallery failures recover and preserve keyboard focus', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await galleryFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#p-biblia');
  const main = page.locator('.gal .main'), image = page.locator('#gm');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(e => e.naturalWidth)).toBe(600);
  expect(await image.evaluate(e => getComputedStyle(e).objectFit)).toBe('contain');
  const before = await main.boundingBox();
  await expect(page.locator('.gallery-position')).toHaveText('Imagem 1 de 2');
  const missing = page.locator('[data-th="1"]');
  await missing.focus(); await page.keyboard.press('Enter');
  await expect(missing).toBeFocused();
  await expect(missing).toHaveAttribute('aria-current', 'true');
  await expect(main.locator('.image-fallback')).toBeVisible();
  await expect(main).toContainText('Fotografia indisponível');
  await expect(missing).toContainText('Imagem indisponível');
  await expect(image).toBeHidden();
  await expect(page.locator('.gallery-position')).toHaveText('Imagem 2 de 2');
  expect((await main.boundingBox()).height).toBeCloseTo(before.height, 0);
  await page.locator('[data-th="0"]').click();
  await expect(image).toBeVisible();
  await expect(main.locator('.image-fallback')).toBeHidden();
  await expect.poll(() => image.evaluate(e => e.naturalWidth)).toBe(600);
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('broken card and cart images retain product identity and usable actions', async ({ page }) => {
  await galleryFixture(page);
  await page.route('**/test-photo.svg', route => route.abort());
  await page.goto('/');
  const card = page.locator('[data-product="biblia"]');
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('.image-fallback')).toBeVisible();
  await expect(card.locator('.product-visual > img')).toBeHidden();
  await expect(card).toContainText('Fotografia indisponível');
  await card.locator('[data-add-cart]').click();
  await page.locator('#cart-open').click();
  await expect(page.locator('.cart-image .image-fallback')).toBeVisible();
  await expect(page.locator('#cart-total')).toContainText('60,00');
  await expect(page.locator('#cart-checkout')).toHaveAttribute('aria-disabled', 'false');
});

test('secondary pages load the established editorial fonts and fit narrow navigation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  for (const path of ['/checkout.html', '/tracking.html', '/admin.html']) {
    await page.goto(path);
    await expect(page.locator('link[href*="family=Cormorant"]')).toHaveCount(1);
    await noOverflow(page);
    await expect(page.locator('.commerce-header .logo')).toBeVisible();
    for (const link of await page.locator('.commerce-header nav a').all()) {
      expect(await link.evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
  }
});

test('long quotation-only names stay whole in narrow gallery placeholders', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/#p-caneca');
  await page.evaluate(() => document.fonts.ready);
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.locator('#theme-toggle').click();
    await expect(page.locator('#dgo')).toHaveText('Solicitar orçamento');
    await expect(page.locator('#detail-add-cart')).toHaveCount(0);
    // A word should occupy one line, rather than leaving its last letter orphaned.
    const lines = await page.locator('.gal .placeholder-name').evaluate(element => {
      const node = element.firstChild, word = 'personalizada', start = node.textContent.indexOf(word);
      const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + word.length);
      return range.getClientRects().length;
    });
    expect(lines).toBe(1);
    await noOverflow(page);
  }
});
