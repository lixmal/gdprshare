const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Paths that reach a form element directly rather than through React state:
// the message box, the password prompt and the picked file. They are the parts
// a refactor of the element references can break without any other test
// noticing.

async function openOptions(page) {
  const more = page.locator('.app-inner button[aria-expanded="false"]');
  if (await more.count() > 0)
    await more.first().click();
}

async function setCount(page, count) {
  await openOptions(page);
  await page.locator('input#count').fill(count);
  await openOptions(page);
  await page.locator('select#geo-restriction').selectOption('none');
}

test.describe('Form elements the code reads directly', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('sends a typed message and hands back what was typed', async ({ page, context }) => {
    const message = 'A message typed into the box, not a file. ' + Date.now();

    await page.locator('label[for="type-text"]').click();
    await expect(page.locator('textarea#text')).toBeVisible();
    await page.locator('textarea#text').fill(message);

    await setCount(page, '2');
    await page.locator('input[type="submit"]').click();
    await page.waitForURL(/\/uploaded/);

    const url = await page.locator('input#link-key').inputValue();

    // the message comes back as the text it was, not as a download
    const reader = await context.newPage();
    await reader.goto(url, { waitUntil: 'load' });
    await expect(reader.getByText(message)).toBeVisible({ timeout: 15000 });
  });

  test('accepts the password when the link does not carry it', async ({ page, context }) => {
    const content = 'Split link content ' + Date.now();
    const filePath = path.join(__dirname, 'test-split-link.txt');
    fs.writeFileSync(filePath, content);

    await page.locator('input#content').setInputFiles(filePath);
    await setCount(page, '2');
    await page.locator('input[type="submit"]').click();
    await page.waitForURL(/\/uploaded/);

    const url = await page.locator('input#link-key').inputValue();
    const [link, password] = url.split('#');
    expect(password).toBeTruthy();

    // the link without its fragment asks for the password instead
    const reader = await context.newPage();
    await reader.goto(link, { waitUntil: 'load' });

    const field = reader.locator('input#password');
    await expect(field).toBeVisible();

    const downloadPromise = reader.waitForEvent('download');
    await field.fill(password);
    await reader.locator('button[type="submit"], input[type="submit"]').first().click();

    const download = await downloadPromise;
    const saved = path.join(__dirname, 'downloaded-' + await download.suggestedFilename());
    await download.saveAs(saved);
    expect(fs.readFileSync(saved, 'utf8')).toBe(content);

    fs.unlinkSync(filePath);
    fs.unlinkSync(saved);
  });

  test('clears a picked file and asks for one again', async ({ page }) => {
    const filePath = path.join(__dirname, 'test-cleared.txt');
    fs.writeFileSync(filePath, 'picked and then dropped');

    await page.locator('input#content').setInputFiles(filePath);
    await expect(page.getByText('test-cleared.txt')).toBeVisible();

    await page.locator('.picked button.btn-icon').click();

    await expect(page.getByText('test-cleared.txt')).toHaveCount(0);
    // the input itself is empty again, so the same file can be picked anew
    expect(await page.locator('input#content').evaluate((el) => el.files.length)).toBe(0);

    fs.unlinkSync(filePath);
  });
});
