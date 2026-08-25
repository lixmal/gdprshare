const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const en = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'public', 'locales', 'en.json'), 'utf8'));

// A password the sender sets is a second lock on top of the link: the file is
// encrypted under both, so the link alone opens nothing.

async function openOptions(page) {
  const more = page.locator('.app-inner button[aria-expanded="false"]');
  if (await more.count() > 0)
    await more.first().click();
}

async function share(page, { content, password }) {
  const filePath = path.join(__dirname, 'test-password-' + Date.now() + '.txt');
  fs.writeFileSync(filePath, content);

  await page.goto('/');
  await page.locator('input#content').setInputFiles(filePath);

  await openOptions(page);
  await page.locator('input#count').fill('4');
  await openOptions(page);
  await page.locator('select#geo-restriction').selectOption('none');
  if (password) {
    await openOptions(page);
    await page.locator('input#password').fill(password);
  }

  await page.locator('input[type="submit"]').click();
  await page.waitForURL(/\/uploaded/);

  const url = await page.locator('input#link-key').inputValue();
  fs.unlinkSync(filePath);

  return url;
}

test.describe('A password on top of the link', () => {
  test('marks the link and tells the sender to pass the password on separately', async ({ page }) => {
    const url = await share(page, { content: 'locked content', password: 'a good password' });

    // the marker rides in the fragment, so the server never sees it
    expect(url).toContain('#p.');
    await expect(page.locator('#link-key-help')).toHaveText(en.uploaded.passwordNotice);
  });

  test('asks for the password instead of downloading, then hands over the file', async ({ page, context }) => {
    const content = 'password protected content ' + Date.now();
    const url = await share(page, { content, password: 'a good password' });

    const reader = await context.newPage();
    await reader.goto(url, { waitUntil: 'load' });

    // the link alone gets no file: the page asks, and nothing is spent yet
    const field = reader.locator('input#password');
    await expect(field).toBeVisible();
    await expect(reader.locator('label[for="password"]')).toHaveText(en.download.senderPassword);

    const downloadPromise = reader.waitForEvent('download');
    await field.fill('a good password');
    await reader.locator('input[type="submit"]').click();

    const download = await downloadPromise;
    const saved = path.join(__dirname, 'got-' + await download.suggestedFilename());
    await download.saveAs(saved);
    expect(fs.readFileSync(saved, 'utf8')).toBe(content);
    fs.unlinkSync(saved);
  });

  test('refuses the file with the wrong password', async ({ page, context }) => {
    const url = await share(page, { content: 'not for you', password: 'the right one' });

    const reader = await context.newPage();
    await reader.goto(url, { waitUntil: 'load' });
    await reader.locator('input#password').fill('the wrong one');
    await reader.locator('input[type="submit"]').click();

    // the file never decrypts, and the reader is told rather than left waiting
    await expect(reader.locator('.alert')).toBeVisible({ timeout: 15000 });
    await expect(reader.locator('.alert')).toContainText(en.errors.invalidPassword);
  });

  test('still asks for the password when the link was split', async ({ page, context }) => {
    const content = 'split and locked ' + Date.now();
    const url = await share(page, { content, password: 'both halves' });
    const [link, fragment] = url.split('#');

    const reader = await context.newPage();
    await reader.goto(link, { waitUntil: 'load' });

    // first the secret, which says a password belongs with it
    await expect(reader.locator('label[for="password"]')).toHaveText(en.download.password);
    await reader.locator('input#password').fill(fragment);
    await reader.locator('input[type="submit"]').click();

    await expect(reader.locator('label[for="password"]')).toHaveText(en.download.senderPassword);

    const downloadPromise = reader.waitForEvent('download');
    await reader.locator('input#password').fill('both halves');
    await reader.locator('input[type="submit"]').click();

    const download = await downloadPromise;
    const saved = path.join(__dirname, 'got-split-' + await download.suggestedFilename());
    await download.saveAs(saved);
    expect(fs.readFileSync(saved, 'utf8')).toBe(content);
    fs.unlinkSync(saved);
  });

  test('leaves a share without a password working as before', async ({ page, context }) => {
    const content = 'no password here ' + Date.now();
    const url = await share(page, { content, password: null });

    expect(url).not.toContain('#p.');

    const reader = await context.newPage();
    const downloadPromise = reader.waitForEvent('download');
    await reader.goto(url, { waitUntil: 'load' });

    const download = await downloadPromise;
    const saved = path.join(__dirname, 'got-plain-' + await download.suggestedFilename());
    await download.saveAs(saved);
    expect(fs.readFileSync(saved, 'utf8')).toBe(content);
    fs.unlinkSync(saved);
  });
});
