const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The advanced options live behind "More options" since the redesign.
async function openOptions(page) {
  const more = page.locator('button[aria-expanded="false"]');
  if (await more.count() > 0)
    await more.first().click();
}


test.describe('Prolong with owner token', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  async function upload(page, name, expiry, count) {
    const testFilePath = path.join(__dirname, name);
    fs.writeFileSync(testFilePath, 'Prolong test content ' + Date.now());

    const fileInput = page.locator('input#content');
    await expect(fileInput).toBeVisible({ timeout: 10000 });
    await fileInput.setInputFiles(testFilePath);

    await openOptions(page);
    await page.locator('input#expiry').fill(expiry);
    await openOptions(page);
    await page.locator('input#count').fill(count);
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');
    await page.locator('input[type="submit"]').click();
    await page.waitForURL(/\/uploaded/);

    fs.unlinkSync(testFilePath);

    // back to the upload page, which lists the owned files
    await page.goto('/');
    await expect(page.locator('.saved-files .card').first()).toBeVisible();
  }

  test('adds days and downloads to an uploaded file', async ({ page }) => {
    await upload(page, 'test-prolong.txt', '4', '2');

    const card = page.locator('.saved-files .card').first();
    await expect(card.locator('.expiry')).toContainText('Downloads left: 2 of 2');

    await card.locator('button#prolong').click();

    const panel = card.locator('.prolong-panel');
    await expect(panel).toBeVisible();
    // 14 days maximum minus the 4 days the file has left
    await expect(panel.locator('label[for="prolong-days"]')).toContainText('10 left');
    await expect(panel.locator('label[for="prolong-count"]')).toContainText('13 left');

    await panel.locator('input#prolong-days').fill('3');
    await panel.locator('input#prolong-count').fill('2');
    await panel.locator('button.btn-primary').click();

    await expect(panel).toBeHidden();
    await expect(card.locator('.expiry')).toContainText('Downloads left: 4 of 4');

    // the room left shrinks by what was just added
    await card.locator('button#prolong').click();
    await expect(card.locator('label[for="prolong-days"]')).toContainText('7 left');
    await expect(card.locator('label[for="prolong-count"]')).toContainText('11 left');
  });

  test('caps the inputs at the allowed maximum', async ({ page }) => {
    await upload(page, 'test-prolong-cap.txt', '14', '15');

    const card = page.locator('.saved-files .card').first();
    // a file already at both maximums can't be prolonged
    await expect(card.locator('button#prolong')).toBeDisabled();
  });
});

test.describe('Busy state', () => {
  // Deleting or prolonging used to raise the upload form's spinner, which is
  // the wrong card entirely.
  test('a list action never masks the upload form', async ({ page }) => {
    await page.goto('/');

    const testFilePath = path.join(__dirname, 'test-busy.txt');
    fs.writeFileSync(testFilePath, 'busy state check');
    await page.locator('input#content').setInputFiles(testFilePath);
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');
    await page.locator('input[type="submit"]').click();
    await page.waitForURL(/\/uploaded/);
    await page.goto('/');

    const uploadCard = page.locator('.app-outer').first();
    const filesCard = page.locator('.files-card');
    await expect(filesCard.locator('.file-item')).toHaveCount(1);

    // the whole list is what waits on the server, the send form stays usable
    await page.locator('button#delete').click();
    await expect(uploadCard).not.toHaveClass(/loading-mask/);
    await expect(filesCard.locator('.file-item')).toHaveCount(0);

    fs.unlinkSync(testFilePath);
  });
});

test.describe('Dark theme', () => {
  // Bootstrap paints .card white and the file rows keep that class, so a
  // missing override showed up as white boxes inside the dark panel. Nothing in
  // the DOM says that is wrong, only the computed colours do.
  test('paints the uploads list from the dark tokens', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.localStorage.setItem('theme', 'dark'));

    const testFilePath = path.join(__dirname, 'test-dark.txt');
    fs.writeFileSync(testFilePath, 'dark theme check');
    await page.locator('input#content').setInputFiles(testFilePath);
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');
    await page.locator('input[type="submit"]').click();
    await page.waitForURL(/\/uploaded/);
    await page.goto('/');

    const row = page.locator('.file-item').first();
    await expect(row).toBeVisible();

    const colours = await page.evaluate(() => {
      const read = (selector, prop) =>
        getComputedStyle(document.querySelector(selector)).getPropertyValue(prop);
      return {
        body: read('body', 'background-color'),
        card: read('.files-card', 'background-color'),
        row: read('.file-item', 'background-color'),
        name: read('.file-name', 'color'),
      };
    });

    // the row adds no fill of its own, and nothing is left on bootstrap's white
    expect(colours.row).toBe('rgba(0, 0, 0, 0)');
    expect(colours.body).toBe('rgb(14, 16, 19)');
    expect(colours.card).toBe('rgb(21, 24, 29)');
    // and the text on that dark fill is light
    expect(colours.name).toBe('rgb(231, 233, 237)');

    fs.unlinkSync(testFilePath);
  });
});
