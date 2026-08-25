const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// A file is encrypted in fixed-size records, so one that spans several of them
// exercises the record numbering, the final-record marker and the reassembly on
// the way back. Small files only ever fill one record and prove none of it.

async function openOptions(page) {
  const more = page.locator('.app-inner button[aria-expanded="false"]');
  if (await more.count() > 0)
    await more.first().click();
}

test.describe('A file spanning several records', () => {
  test('comes back byte for byte', async ({ page, context }) => {
    // the record size is 4 MiB, so this is three records and a bit
    const content = crypto.randomBytes(9 * 1024 * 1024);
    const filePath = path.join(__dirname, 'test-multi-record.bin');
    fs.writeFileSync(filePath, content);

    await page.goto('/');
    await page.locator('input#content').setInputFiles(filePath);
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');
    await page.locator('input[type="submit"]').click();
    await page.waitForURL(/\/uploaded/, { timeout: 60000 });

    const url = await page.locator('input#link-key').inputValue();

    const reader = await context.newPage();
    const downloadPromise = reader.waitForEvent('download', { timeout: 60000 });
    await reader.goto(url, { waitUntil: 'load' });

    const download = await downloadPromise;
    const saved = path.join(__dirname, 'got-multi-record.bin');
    await download.saveAs(saved);

    const returned = fs.readFileSync(saved);
    expect(returned.length).toBe(content.length);
    expect(crypto.createHash('sha256').update(returned).digest('hex'))
      .toBe(crypto.createHash('sha256').update(content).digest('hex'));

    fs.unlinkSync(filePath);
    fs.unlinkSync(saved);
  });

  test('is sent in pieces, with progress', async ({ page }) => {
    const calls = [];
    await page.route('**/api/v1/**', (route) => {
      calls.push(new URL(route.request().url()).pathname);
      return route.continue();
    });

    const filePath = path.join(__dirname, 'test-in-pieces.bin');
    fs.writeFileSync(filePath, crypto.randomBytes(9 * 1024 * 1024));

    await page.goto('/');
    await page.locator('input#content').setInputFiles(filePath);
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');
    await page.locator('input[type="submit"]').click();

    // the sender is told how far along it is rather than left on a frozen page
    await expect(page.locator('#upload-progress-bar')).toBeVisible();

    await page.waitForURL(/\/uploaded/, { timeout: 60000 });

    expect(calls).toContain('/api/v1/uploads');
    // the header and each record, rather than the whole file in one request
    expect(calls.filter((p) => p.startsWith('/api/v1/uploads/')).length).toBeGreaterThan(1);
    expect(calls).not.toContain('/api/v1/files');

    fs.unlinkSync(filePath);
  });

  test('goes in a single request when it fits in one record', async ({ page }) => {
    const calls = [];
    await page.route('**/api/v1/**', (route) => {
      calls.push(new URL(route.request().url()).pathname);
      return route.continue();
    });

    const filePath = path.join(__dirname, 'test-one-request.txt');
    fs.writeFileSync(filePath, 'small enough for a single request');

    await page.goto('/');
    await page.locator('input#content').setInputFiles(filePath);
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');
    await page.locator('input[type="submit"]').click();
    await page.waitForURL(/\/uploaded/);

    // three round trips are not worth it for a file this size
    expect(calls).toContain('/api/v1/files');
    expect(calls).not.toContain('/api/v1/uploads');

    fs.unlinkSync(filePath);
  });

  test('is stored in the record format rather than as one block', async ({ page }) => {
    const filePath = path.join(__dirname, 'test-format.txt');
    fs.writeFileSync(filePath, 'small enough for a single record');

    await page.goto('/');
    await page.locator('input#content').setInputFiles(filePath);
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');
    await page.locator('input[type="submit"]').click();
    await page.waitForURL(/\/uploaded/);

    const url = await page.locator('input#link-key').inputValue();
    const fileId = url.split('#')[0].split('/').pop();

    // the version byte and the record size in the header are what the download
    // page reads to tell the format from the older single block
    const head = await page.evaluate(async (id) => {
      const response = await fetch('/api/v1/files/' + id);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return Array.from(bytes.slice(0, 5));
    }, fileId);

    expect(head[0]).toBe(1);
    const recordSize = (head[1] << 24) | (head[2] << 16) | (head[3] << 8) | head[4];
    expect(recordSize).toBe(4 * 1024 * 1024);

    fs.unlinkSync(filePath);
  });
});
