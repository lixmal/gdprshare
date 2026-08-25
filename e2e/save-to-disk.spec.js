const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const en = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'public', 'locales', 'en.json'), 'utf8'));

// A file too large to assemble in the browser is written straight to disk. That
// needs somewhere to write it, and the browser only offers a place to save from
// a click, so a large download waits for one instead of starting on its own.

async function openOptions(page) {
  const more = page.locator('.app-inner button[aria-expanded="false"]');
  if (await more.count() > 0)
    await more.first().click();
}

async function share(page, content) {
  const filePath = path.join(__dirname, 'test-save-' + Date.now() + '.txt');
  fs.writeFileSync(filePath, content);

  await page.goto('/');
  await page.locator('input#content').setInputFiles(filePath);
  await openOptions(page);
  await page.locator('select#geo-restriction').selectOption('none');
  await page.locator('input[type="submit"]').click();
  await page.waitForURL(/\/uploaded/);

  const url = await page.locator('input#link-key').inputValue();
  fs.unlinkSync(filePath);

  return url;
}

// Reports the file as far larger than it is, so the branch for a file that
// cannot be held in the browser is reachable without sending one.
async function reportAsLarge(page, bytes) {
  await page.route('**/api/v1/files/*', async (route) => {
    if (route.request().method() !== 'HEAD')
      return route.continue();

    const response = await route.fetch();
    const headers = Object.assign({}, response.headers(), { 'content-length': String(bytes) });

    return route.fulfill({ response, headers, body: '' });
  });
}

// Stands in for the browser's save dialog and keeps what was written.
async function stubTheSaveDialog(page, { cancel } = {}) {
  await page.addInitScript((shouldCancel) => {
    window.__written = [];
    window.showSaveFilePicker = async (options) => {
      window.__suggested = options && options.suggestedName;
      if (shouldCancel)
        throw new DOMException('The user aborted a request.', 'AbortError');

      return {
        createWritable: async () => ({
          write: async (bytes) => { window.__written.push(Array.from(bytes)); },
          close: async () => { window.__closed = true; },
        }),
      };
    };
  }, !!cancel);
}

test.describe('A file too large to hold in the browser', () => {
  test('waits for a click and is written where the recipient says', async ({ page, context }) => {
    const content = 'pretend this is enormous ' + Date.now();
    const url = await share(page, content);

    const reader = await context.newPage();
    await stubTheSaveDialog(reader);
    await reportAsLarge(reader, 128 * 1024 * 1024);
    await reader.goto(url, { waitUntil: 'load' });

    // no download started on its own
    const button = reader.locator('button#save-file');
    await expect(button).toBeVisible();
    await expect(button).toContainText('128');
    await expect(reader.locator('.hint').last()).toHaveText(en.download.saveHint);

    await button.click();
    await expect(reader.locator('.success, .alert-success')).toBeVisible({ timeout: 15000 });

    // the file went through the dialog's writable, byte for byte
    const written = await reader.evaluate(() => window.__written);
    const closed = await reader.evaluate(() => window.__closed);
    expect(closed).toBe(true);
    expect(Buffer.from(written.flat()).toString()).toBe(content);

    // and the dialog was offered the file's own name
    expect(await reader.evaluate(() => window.__suggested)).toBeTruthy();
  });

  test('leaves the link usable when the save dialog is dismissed', async ({ page, context }) => {
    const url = await share(page, 'not saved this time');

    const reader = await context.newPage();
    await stubTheSaveDialog(reader, { cancel: true });
    await reportAsLarge(reader, 128 * 1024 * 1024);
    await reader.goto(url, { waitUntil: 'load' });

    await reader.locator('button#save-file').click();

    // closing the dialog is not a failure: no error, and the button is still there
    await expect(reader.locator('button#save-file')).toBeVisible();
    await expect(reader.locator('.alert-danger')).toHaveCount(0);
  });

  test('starts on its own when it is small enough to hold', async ({ page, context }) => {
    const content = 'small enough to assemble ' + Date.now();
    const url = await share(page, content);

    const reader = await context.newPage();
    await stubTheSaveDialog(reader);

    const downloadPromise = reader.waitForEvent('download');
    await reader.goto(url, { waitUntil: 'load' });

    const download = await downloadPromise;
    const saved = path.join(__dirname, 'got-small-' + await download.suggestedFilename());
    await download.saveAs(saved);
    expect(fs.readFileSync(saved, 'utf8')).toBe(content);

    // the dialog was never involved
    expect(await reader.evaluate(() => window.__written)).toHaveLength(0);
    await expect(reader.locator('button#save-file')).toHaveCount(0);

    fs.unlinkSync(saved);
  });
});
