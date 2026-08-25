const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The options an upload was sent with come back for the next one, the way the
// app remembers them. The password never does: it belongs to one share.

async function openOptions(page) {
  const more = page.locator('.app-inner button[aria-expanded="false"]');
  if (await more.count() > 0)
    await more.first().click();
}

test.describe('Remembered upload options', () => {
  test('offers the last upload\'s options for the next one', async ({ page }) => {
    const filePath = path.join(__dirname, 'test-remembered.txt');
    fs.writeFileSync(filePath, 'remembered options');

    await page.goto('/');
    await page.locator('input#content').setInputFiles(filePath);

    await openOptions(page);
    await page.locator('input#expiry').fill('3');
    await openOptions(page);
    await page.locator('input#count').fill('9');
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');
    await openOptions(page);
    await page.locator('select#delay').selectOption('15');
    await openOptions(page);
    await page.locator('input#email').fill('someone@example.org');
    await openOptions(page);
    await page.locator('input#password').fill('not to be remembered');

    await page.locator('input[type="submit"]').click();
    await page.waitForURL(/\/uploaded/);

    // a fresh visit, as if the sender came back later
    await page.goto('/');
    await openOptions(page);

    await expect(page.locator('input#expiry')).toHaveValue('3');
    await expect(page.locator('input#count')).toHaveValue('9');
    await expect(page.locator('select#geo-restriction')).toHaveValue('none');
    await expect(page.locator('select#delay')).toHaveValue('15');
    await expect(page.locator('input#email')).toHaveValue('someone@example.org');

    // the password is not one of them
    await expect(page.locator('input#password')).toHaveValue('');

    fs.unlinkSync(filePath);
  });

  test('ignores a stored value the form no longer offers', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      window.localStorage.setItem('options', JSON.stringify({
        count: 9999,
        expiry: -3,
        geoRestriction: 'somewhere-else',
        delay: '7',
        strip: 'yes please',
      }));
    });

    await page.reload();
    await openOptions(page);

    // clamped to what the server allows and to what the selects hold
    await expect(page.locator('input#count')).toHaveValue('15');
    await expect(page.locator('input#expiry')).toHaveValue('1');
    await expect(page.locator('select#geo-restriction')).toHaveValue('eea');
    await expect(page.locator('select#delay')).toHaveValue('0');
  });
});
