const { test, expect } = require('@playwright/test');
// Focus/storage tests do not depend on entrance animations in background tabs.
// Existing theme/refinement suites continue to exercise the animated storefront.
test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ context }) => {
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
});

test('favorites synchronize across tabs and preserve unrelated keyboard focus', async ({ page, context }) => {
  await page.goto('/');
  const second = await context.newPage();
  try {
    await second.goto('/'); await second.bringToFront(); await second.locator('#q').focus();
    await page.bringToFront(); await page.locator('[data-fav="biblia"]').click();
    await expect(page.locator('[data-fav="biblia"]')).toHaveAttribute('aria-pressed','true');
    await second.bringToFront();
    await expect(second.locator('#favn')).toHaveText('1');
    await expect(second.locator('[data-fav="biblia"]')).toHaveAttribute('aria-pressed','true');
    await expect(second.locator('#q')).toBeFocused();
    // A queued notification must not overwrite the newer shared storage state.
    await second.evaluate(() => dispatchEvent(new StorageEvent('storage', {key:'presence:favs',newValue:'[]',storageArea:localStorage})));
    await expect(second.locator('#favn')).toHaveText('1');
    await expect(second.locator('#q')).toBeFocused();
    await page.bringToFront(); await page.locator('[data-fav="biblia"]').click();
    await expect(page.locator('[data-fav="biblia"]')).toHaveAttribute('aria-pressed','false');
    await second.bringToFront();
    await expect(second.locator('#favn')).toBeHidden();
    await expect(second.locator('#q')).toBeFocused();
    await page.evaluate(() => localStorage.setItem('presence:favs', JSON.stringify(['missing','biblia','biblia',null])));
    await expect(second.locator('#favn')).toHaveText('1');
    await page.evaluate(() => localStorage.removeItem('presence:favs'));
    await expect(second.locator('#favn')).toBeHidden();
    await page.evaluate(() => localStorage.setItem('presence:favs','"biblia"'));
    await expect(second.locator('#favn')).toBeHidden();
    await page.evaluate(() => localStorage.clear());
    await expect(second.locator('#q')).toBeFocused();
  } finally { await second.close(); }
});

test('removing the last visible favorite restores focus to the favorites trigger', async ({ page, context }) => {
  await page.goto('/'); await page.locator('[data-fav="biblia"]').click();
  await expect(page.locator('[data-fav="biblia"]')).toBeFocused();
  await page.locator('#favview').click();
  await page.locator('[data-fav="biblia"]').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.card')).toHaveCount(0);
  await expect(page.locator('#favview')).toBeFocused();
  await page.locator('#clear').click(); await page.locator('[data-fav="biblia"]').click(); await page.locator('#favview').click();
  await page.locator('[data-fav="biblia"]').focus();
  const other = await context.newPage();
  try {
    await other.goto('/'); await expect(other.locator('[data-fav="biblia"]')).toHaveAttribute('aria-pressed','true');
    await other.locator('[data-fav="biblia"]').click();
    await expect(other.locator('[data-fav="biblia"]')).toHaveAttribute('aria-pressed','false');
    await page.bringToFront();
    await expect(page.locator('.card')).toHaveCount(0); await expect(page.locator('#favview')).toBeFocused();
  } finally { await other.close(); }
});

test('detail route, skip link and browser back/forward keep a main landmark and predictable focus', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('main:visible')).toHaveCount(1);
  await page.locator('.skip-link').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#produtos')).toBeFocused();
  const opener = page.locator('[data-product="biblia"] h3 button');
  await opener.focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#p-biblia$/); await expect(page.locator('main:visible')).toHaveCount(1);
  await expect(page.locator('#pt')).toBeFocused();
  await expect(page.locator('.skip-link')).toHaveAttribute('href','#pt');
  await page.locator('.skip-link').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#pt')).toBeFocused(); await expect(page).toHaveURL(/#p-biblia$/);
  await page.goBack(); await expect(page.locator('#detail')).toBeHidden();
  await expect(page.locator('main:visible')).toHaveCount(1); await expect(opener).toBeFocused();
  await page.goForward(); await expect(page.locator('#pt')).toBeFocused();
  await page.locator('#detail .crumb a').first().click();
  await expect(page.locator('main:visible')).toHaveCount(1); await expect(opener).toBeFocused();
});

test('direct detail entry and invalid hashes have a visible focusable skip destination', async ({ page }) => {
  await page.goto('/#p-caneca'); await expect(page.locator('main:visible')).toHaveCount(1);
  await page.locator('.skip-link').focus(); await page.keyboard.press('Enter'); await expect(page.locator('#pt')).toBeFocused();
  await page.locator('#detail .crumb a').first().click(); await expect(page.locator('#produtos')).toBeFocused();
  await page.goto('/#p-missing'); await expect(page.locator('main:visible')).toHaveCount(1);
  await page.locator('.skip-link').focus(); await page.keyboard.press('Enter'); await expect(page.locator('#produtos')).toBeFocused();
});

test('returning through a multi-product history restores the opener of the product being left', async ({ page }) => {
  await page.goto('/');
  const bible = page.locator('[data-product="biblia"] h3 button');
  const devotional = page.locator('[data-product="devocional"] h3 button');
  await bible.click(); await page.locator('#detail .crumb a').first().click();
  await devotional.click(); await page.locator('#detail .crumb a').first().click();
  await page.goBack(); await expect(page.locator('#pt')).toHaveText('Devocional');
  await page.goBack(); await expect(devotional).toBeFocused();
  await page.goBack(); await expect(page.locator('#pt')).toHaveText('Bíblia');
  await page.goBack(); await expect(bible).toBeFocused();
});

test('mobile Escape closes navigation, desktop resizing synchronizes state and cart Escape still works', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.locator('#burger').click(); await page.locator('#mnav a').first().focus();
  await page.keyboard.press('Escape'); await expect(page.locator('#mnav')).toBeHidden();
  await expect(page.locator('#burger')).toHaveAttribute('aria-expanded','false'); await expect(page.locator('#burger')).toBeFocused();
  await page.locator('#burger').click(); await page.locator('#mnav a').first().focus();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('#mnav')).toBeHidden(); await expect(page.locator('#burger')).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('#ddb')).toBeFocused(); await page.locator('#ddb').press('ArrowDown');
  await expect(page.locator('#ddm')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.locator('#ddb')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#burger').click(); await page.locator('#cart-open').click();
  await page.keyboard.press('Escape'); await expect(page.locator('#cart-drawer')).toBeHidden();
});

test('catalog and cart messages describe an inquiry requiring an explicit WhatsApp send', async ({ page }) => {
  await page.goto('/#p-biblia');
  await expect(page.locator('#detail')).toContainText('Você precisa enviar a mensagem');
  await expect(page.locator('#detail')).toContainText('não registra nem confirma um pedido');
  await page.locator('#detail-add-cart').click(); await page.locator('#cart-open').click();
  await expect(page.locator('#cart-drawer')).toContainText('não registra, confirma nem paga um pedido');
  await expect(page.locator('#cart-checkout')).toContainText('Preparar mensagem');
  const text = new URL(await page.locator('#cart-checkout').getAttribute('href')).searchParams.get('text');
  expect(text).toContain('Você precisa enviar a mensagem'); expect(text).toContain('instruções de pagamento');
  expect(text).toContain('Frete a consultar');
});
