const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The advanced options live behind "More options" since the redesign.
async function openOptions(page) {
  const more = page.locator('button[aria-expanded="false"]');
  if (await more.count() > 0)
    await more.first().click();
}


const locales = (file) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'locales', file), 'utf8'));

const de = locales('de.json');
const ja = locales('ja.json');
const zhTW = locales('zh-TW.json');
const zhCN = locales('zh-CN.json');
const ar = locales('ar.json');
const en = locales('en.json');

// Uploads a file and returns its download URL without the key fragment, so the
// download page renders its password form.
async function uploadAndGetLink(page, { count = '2' } = {}) {
  await page.goto('/');
  const filePath = path.join(__dirname, 'test-i18n.txt');
  fs.writeFileSync(filePath, 'localized download test');

  await page.locator('input#content').setInputFiles(filePath);
  await openOptions(page);
  await page.locator('input#count').fill(count);
  await openOptions(page);
  await page.locator('select#geo-restriction').selectOption('none');
  await page.locator('input[type="submit"]').click();
  await page.waitForURL(/\/uploaded/);

  const url = await page.locator('input#link-key').inputValue();
  fs.unlinkSync(filePath);

  return url;
}

test.describe('Download page localization', () => {
  test('renders in German for a German browser', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'de-DE' });
    const page = await context.newPage();

    const url = await uploadAndGetLink(page);
    await page.goto(url.split('#')[0]);

    await expect(page.locator('h4')).toHaveText(de.download.title);
    await expect(page.locator('label[for="password"]')).toHaveText(de.download.password);
    await expect(page.locator('input[type="submit"]')).toHaveValue(de.download.submit);
    await expect(page.locator('a[href="/"]:not(.shell-mark)')).toHaveText(de.download.uploadLink);
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    await context.close();
  });

  test('renders in Japanese for a Japanese browser', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'ja-JP' });
    const page = await context.newPage();

    const url = await uploadAndGetLink(page);
    await page.goto(url.split('#')[0]);

    await expect(page.locator('h4')).toHaveText(ja.download.title);
    await expect(page.locator('label[for="password"]')).toHaveText(ja.download.password);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');

    await context.close();
  });

  test('keeps traditional and simplified Chinese apart', async ({ browser }) => {
    const tw = await browser.newContext({ locale: 'zh-TW' });
    const twPage = await tw.newPage();
    let url = await uploadAndGetLink(twPage);
    await twPage.goto(url.split('#')[0]);

    await expect(twPage.locator('a[href="/"]:not(.shell-mark)')).toHaveText(zhTW.download.uploadLink);
    await expect(twPage.locator('html')).toHaveAttribute('lang', 'zh-TW');
    await tw.close();

    const cn = await browser.newContext({ locale: 'zh-CN' });
    const cnPage = await cn.newPage();
    url = await uploadAndGetLink(cnPage);
    await cnPage.goto(url.split('#')[0]);

    await expect(cnPage.locator('a[href="/"]:not(.shell-mark)')).toHaveText(zhCN.download.uploadLink);
    await expect(cnPage.locator('html')).toHaveAttribute('lang', 'zh-CN');
    // the two scripts must not be serving the same text
    expect(zhTW.download.uploadLink).not.toBe(zhCN.download.uploadLink);
    await cn.close();
  });

  test('sets right to left direction for Arabic', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'ar-EG' });
    const page = await context.newPage();

    const url = await uploadAndGetLink(page);
    await page.goto(url.split('#')[0]);

    await expect(page.locator('h4')).toHaveText(ar.download.title);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    await context.close();
  });

  test('falls back to English for an unsupported language', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'is-IS' });
    const page = await context.newPage();

    const url = await uploadAndGetLink(page);
    await page.goto(url.split('#')[0]);

    await expect(page.locator('h4')).toHaveText(en.download.title);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await context.close();
  });

  test('lets the lang parameter override the browser language', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'de-DE' });
    const page = await context.newPage();

    const url = await uploadAndGetLink(page);
    await page.goto(url.split('#')[0] + '?lang=ja');

    await expect(page.locator('h4')).toHaveText(ja.download.title);

    await context.close();
  });

  test('translates a server error instead of showing the raw API message', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'de-DE' });
    const page = await context.newPage();

    // no such file: the API answers with code file_not_found_or_limit_exceeded
    await page.goto('/d/thisfiledoesnotexist#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

    // an exhausted or unknown link is an expected end state, so it reads as a
    // notice rather than an error
    const alert = page.locator('.alert-notice');
    await expect(alert).toBeVisible({ timeout: 10000 });
    await expect(alert).toContainText(de.errors.server.file_not_found_or_limit_exceeded);
    // the terse English API message must not leak through
    await expect(alert).not.toContainText('file not found');

    await context.close();
  });

  test('translates the expired download limit error', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'fr-FR' });
    const page = await context.newPage();
    const fr = locales('fr.json');

    const url = await uploadAndGetLink(page, { count: '1' });

    // consume the only allowed download through the API, so the page visit
    // below deterministically hits the limit
    const fileId = url.split('#')[0].split('/').pop();
    const consumed = await context.request.get('/api/v1/files/' + fileId);
    expect(consumed.ok(), 'first download should succeed').toBeTruthy();

    // now the link is exhausted
    await page.goto(url);
    const alert = page.locator('.alert-notice');
    await expect(alert).toBeVisible({ timeout: 10000 });
    await expect(alert).toContainText(fr.errors.server.download_count_expired);
    // the terse English API message must not leak through
    await expect(alert).not.toContainText('download count expired');

    await context.close();
  });

  test('serves each locale file over http', async ({ request }) => {
    const shipped = fs.readdirSync(path.join(__dirname, '..', 'public', 'locales'));

    for (const file of shipped) {
      const response = await request.get('/assets/locales/' + file);
      expect(response.ok(), file + ' should be served').toBeTruthy();
      const body = await response.json();
      expect(body.download.title, file + ' should have a title').toBeTruthy();
    }
  });
});
