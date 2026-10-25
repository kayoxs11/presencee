const { test, expect } = require('@playwright/test');

for (const width of [1440, 390, 320]) {
  test(`editorial interactions and contact at ${width}px`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const contact = page.getByRole('link', { name: 'Fale conosco pelo WhatsApp', exact: true });
    await expect(contact).toBeVisible();
    const url = new URL(await contact.getAttribute('href'));
    expect(url.hostname).toBe('wa.me');
    expect(url.pathname).toBe('/5581994382429');
    expect(url.searchParams.get('text')).toContain('Conheci a Presence Papelaria');
    await expect(contact).toHaveAttribute('target', '_blank');
    await expect(contact.locator('svg')).toHaveCount(1);

    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.locator('#theme-toggle').click();
      await page.locator('footer').scrollIntoViewIfNeeded();
      await expect(page.locator('footer')).toBeVisible();
      for (const link of await page.locator('footer a').all()) {
        expect(await link.getAttribute('href')).toMatch(/^(#|https:\/\/)/);
      }
      await expect(page.locator('#yr')).toHaveText(String(new Date().getFullYear()));
      await page.getByRole('navigation', { name: 'Presentes', exact: true }).getByRole('link', { name: 'Caneca personalizada', exact: true }).click();
      await expect(page.locator('#pt')).toHaveText('Caneca personalizada');
      await page.getByRole('navigation', { name: 'Explore', exact: true }).getByRole('link', { name: 'Devocionais', exact: true }).click();
      await expect(page.locator('.card')).toHaveCount(1);
      await page.locator('#clear').click();
      await expect(page.locator('.card')).toHaveCount(16);
      const search = page.locator(width <= 760 ? '#mq' : '#q');
      await search.fill('magnéticos');
      await expect(page.locator('.card')).toHaveCount(1);
      await search.fill('');
      await expect(page.locator('.card')).toHaveCount(16);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await page.locator('.hero h1').evaluate(e => getComputedStyle(e).animationName)).toBe('none');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `test-results/editorial-${width}-${theme}.png` });
    }
    expect(errors).toEqual([]);
  });
}

test('content remains visible without the motion controller', async ({ page }) => {
  await page.route('**/js/motion.js', route => route.abort());
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(16);
  await expect(page.locator('.hero h1')).toBeVisible();
  await page.locator('footer').scrollIntoViewIfNeeded();
  await expect(page.locator('.footer-brand')).toBeVisible();
  expect(await page.locator('.footer-brand').evaluate(e => getComputedStyle(e).opacity)).toBe('1');
});

test('invalid contact is not exposed as a WhatsApp link', async ({ page }) => {
  await page.route('**/js/catalog.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('whatsappRaw:"8199438-2429"', 'whatsappRaw:"invalid"') });
  });
  await page.goto('/');
  await expect(page.locator('#whatsapp-float')).toBeHidden();
  await expect(page.locator('#footer-contact')).not.toHaveAttribute('href');
  await expect(page.locator('#footer-contact')).toHaveText('WhatsApp indisponível');
});
