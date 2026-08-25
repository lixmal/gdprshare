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
