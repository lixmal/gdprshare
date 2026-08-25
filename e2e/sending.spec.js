const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// While a file is on its way its options are settled: a form that still took
// instructions would be describing a share that has already been opened.

test.describe('A form that is sending', () => {
  test('takes no further instructions until it is done', async ({ page }) => {
    const filePath = path.join(__dirname, 'test-sending.bin');
    // large enough to be sent in pieces, so the upload lasts long enough to see
    fs.writeFileSync(filePath, crypto.randomBytes(12 * 1024 * 1024));

    // hold the chunks back so the form can be inspected mid-flight
    await page.route('**/api/v1/uploads/**', async (route) => {
      await new Promise((done) => setTimeout(done, 700));
      return route.continue();
    });

    await page.goto('/');
    await page.locator('input#content').setInputFiles(filePath);
    const more = page.locator('.app-inner button[aria-expanded="false"]');
    if (await more.count() > 0) await more.first().click();
    await page.locator('select#geo-restriction').selectOption('none');

    // everything is settable before the send
    await expect(page.locator('input[type="submit"]')).toBeEnabled();

    await page.locator('input[type="submit"]').click();
    await expect(page.locator('#upload-progress-bar')).toBeVisible();

    // nothing about the share can be changed while it is being sent
    await expect(page.locator('input[type="submit"]')).toBeDisabled();
    await expect(page.locator('input#count')).toBeDisabled();
    await expect(page.locator('input#expiry')).toBeDisabled();
    await expect(page.locator('select#geo-restriction')).toBeDisabled();
    await expect(page.locator('input#password')).toBeDisabled();
    await expect(page.locator('label[for="type-text"]')).toBeDisabled();

    await page.waitForURL(/\/uploaded/, { timeout: 60000 });

    fs.unlinkSync(filePath);
  });

  test('is usable again when a send fails', async ({ page }) => {
    const filePath = path.join(__dirname, 'test-sending-fails.bin');
    fs.writeFileSync(filePath, crypto.randomBytes(12 * 1024 * 1024));

    await page.route('**/api/v1/uploads', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json',
                      body: JSON.stringify({ code: 'store_failed', message: 'no' }) }));

    await page.goto('/');
    await page.locator('input#content').setInputFiles(filePath);
    const more = page.locator('.app-inner button[aria-expanded="false"]');
    if (await more.count() > 0) await more.first().click();
    await page.locator('select#geo-restriction').selectOption('none');
    await page.locator('input[type="submit"]').click();

    await expect(page.locator('.alert')).toBeVisible();
    // the sender can change something and try again
    await expect(page.locator('input#count')).toBeEnabled();
    await expect(page.locator('input[type="submit"]')).toBeEnabled();

    fs.unlinkSync(filePath);
  });
});
