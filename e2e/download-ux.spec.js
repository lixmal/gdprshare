const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The advanced options live behind "More options" since the redesign.
async function openOptions(page) {
  const more = page.locator('.app-inner button[aria-expanded="false"]');
  if (await more.count() > 0)
    await more.first().click();
}


const en = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'public', 'locales', 'en.json'), 'utf8'));

// Uploads a file of the given size and returns its download URL.
async function uploadSized(page, bytes, name) {
  await page.goto('/');
  const filePath = path.join(__dirname, name);
  fs.writeFileSync(filePath, Buffer.alloc(bytes, 'a'));

  await page.locator('input#content').setInputFiles(filePath);
  await openOptions(page);
  await page.locator('input#count').fill('3');
  await openOptions(page);
  await page.locator('select#geo-restriction').selectOption('none');
  await page.locator('input[type="submit"]').click();
  await page.waitForURL(/\/uploaded/);

  const url = await page.locator('input#link-key').inputValue();
  fs.unlinkSync(filePath);

  return url;
}

test.describe('Download progress and loading feedback', () => {
  test('serves a spinner before the bundle has run', async ({ page }) => {
    // block the bundle so the page stays in its pre-React state
    await page.route('**/assets/scripts/bundle.js', (route) => route.abort());
    await page.goto('/');

    // a visitor on a slow connection sees this instead of a blank page
    await expect(page.locator('.boot-spinner')).toBeVisible();
    await expect(page.locator('.boot-loader')).toHaveAttribute('role', 'status');
  });

  test('replaces the boot spinner once the app renders', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('input#content')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.boot-spinner')).toHaveCount(0);
  });

  test('still renders when the config request never answers', async ({ page }) => {
    // a hanging request used to leave the page blank forever
    await page.route('**/api/v1/config', () => { /* never resolves */ });
    await page.goto('/');

    await expect(page.locator('input#content')).toBeVisible({ timeout: 15000 });
  });

  test('still renders when the locale file never answers', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'de-DE' });
    const page = await context.newPage();
    await page.route('**/assets/locales/de.json', () => { /* never resolves */ });

    await page.goto('/');

    // falls back to the bundled English rather than hanging
    await expect(page.locator('input#content')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await context.close();
  });

  test('shows the download phase and a progress bar for a large file', async ({ page, context }) => {
    const url = await uploadSized(page, 3 * 1024 * 1024, 'ux-large.bin');

    const downloadPage = await context.newPage();

    // throttle the transfer so the progress UI is observable
    await downloadPage.route('**/api/v1/files/**', async (route) => {
      if (route.request().method() !== 'GET')
        return route.continue();

      const response = await route.fetch();
      const body = await response.body();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return route.fulfill({ response, body });
    });

    const statusSeen = downloadPage.locator('.download-status-text');
    await downloadPage.goto(url, { waitUntil: 'commit' });

    await expect(statusSeen).toBeVisible({ timeout: 10000 });
    await expect(statusSeen).toHaveText(
      new RegExp(`${en.download.status.downloading}|${en.download.status.decrypting}`));

    await downloadPage.unrouteAll({ behavior: 'ignoreErrors' });
    await downloadPage.close();
  });

  test('clears the status once the download finishes', async ({ page, context }) => {
    const url = await uploadSized(page, 1024, 'ux-small.bin');

    const downloadPage = await context.newPage();
    await downloadPage.goto(url, { waitUntil: 'load' });

    await expect(downloadPage.locator('.alert-success')).toBeVisible({ timeout: 15000 });
    await expect(downloadPage.locator('.download-status')).toHaveCount(0);

    await downloadPage.unrouteAll({ behavior: 'ignoreErrors' });
    await downloadPage.close();
  });

  test('shows the status in the visitor language', async ({ browser }) => {
    const de = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'public', 'locales', 'de.json'), 'utf8'));

    const context = await browser.newContext({ locale: 'de-DE' });
    const page = await context.newPage();
    const url = await uploadSized(page, 2 * 1024 * 1024, 'ux-de.bin');

    const downloadPage = await context.newPage();
    await downloadPage.route('**/api/v1/files/**', async (route) => {
      if (route.request().method() !== 'GET')
        return route.continue();

      const response = await route.fetch();
      const body = await response.body();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return route.fulfill({ response, body });
    });

    await downloadPage.goto(url, { waitUntil: 'commit' });

    const status = downloadPage.locator('.download-status-text');
    await expect(status).toBeVisible({ timeout: 10000 });
    await expect(status).toHaveText(
      new RegExp(`${de.download.status.downloading}|${de.download.status.decrypting}`));

    await downloadPage.unrouteAll({ behavior: 'ignoreErrors' });
    await downloadPage.close();
    await context.close();
  });
});
