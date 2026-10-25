const { test, expect } = require('@playwright/test');

for (const width of [1440, 390, 320]) {
  test(`themes preserve the storefront at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('.card')).toHaveCount(16);
    const toggle = page.getByRole('button', { name: 'Modo escuro', exact: true });

    for (const theme of ['dark', 'light']) {
      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(toggle).toHaveAttribute('aria-pressed', String(theme === 'dark'));
      expect(await page.evaluate(() => localStorage.getItem('presence:theme'))).toBe(theme);
      await expect(page.locator('.card')).toHaveCount(16);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const reopened = await context.newPage();
      await reopened.goto('/');
      await expect(reopened.locator('html')).toHaveAttribute('data-theme', theme);
      await reopened.close();
      await page.screenshot({ path: `test-results/home-${width}-${theme}.png`, fullPage: true });

      if (width > 1080) {
        await page.locator('#ddb').click();
        await expect(page.locator('#ddm')).toBeVisible();
        await page.keyboard.press('Escape');
      } else {
        await page.locator('#burger').click();
        await expect(page.locator('#mnav')).toBeVisible();
        await page.locator('#burger').click();
      }
      await page.locator('#fprice').selectOption('priced');
      await expect(page.locator('.card')).toHaveCount(3);
      await page.locator('#clear').click();
      await page.locator('[data-fav="biblia"]').click();
      await expect(page.locator('[data-fav="biblia"]')).toHaveAttribute('aria-pressed', 'true');
      await page.locator('[data-fav="biblia"]').click();

      await page.goto('/#p-caneca');
      await expect(page.locator('#detail')).toBeVisible();
      await page.locator('#dn').fill('Nome de teste');
      await page.locator('[data-q="1"]').click();
      await expect(page.locator('#dq')).toHaveValue('2');
      expect(decodeURIComponent(await page.locator('#dgo').getAttribute('href'))).toContain('Nome de teste');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `test-results/detail-${width}-${theme}.png`, fullPage: true });
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.goto('/');
    }
    const reopened = await context.newPage();
    await reopened.goto('/');
    await expect(reopened.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(errors).toEqual([]);
  });
}

test('theme works when localStorage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } });
  });
  await page.goto('/');
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.card')).toHaveCount(16);
});

test('theme text tokens meet WCAG AA contrast', async ({ page }) => {
  await page.goto('/');
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.locator('#theme-toggle').click();
    const ratios = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      const token = name => styles.getPropertyValue('--' + name).trim();
      const luminance = hex => {
        const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
          .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
      };
      const contrast = (fg, bg) => {
        const a = luminance(token(fg)), b = luminance(token(bg));
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      };
      return [
        ...['white', 'cream', 'card'].flatMap(bg => ['text', 'muted', 'teal'].map(fg => contrast(fg, bg))),
        contrast('muted', 'beige'), contrast('on-button', 'button'),
        contrast('feature-button-text', 'feature-button'),
      ];
    });
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
  }
});
