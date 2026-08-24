const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const en = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'public', 'locales', 'en.json'), 'utf8'));

// The footer states what this server keeps and why. Its facts follow the
// configuration the server reports, so a claim can never outrun the setup.
test.describe('Footer', () => {
  test('keeps its account of stored data collapsed until asked', async ({ page }) => {
    await page.goto('/');

    const footer = page.locator('.shell-footer');
    await expect(footer.getByRole('button')).toHaveText(new RegExp(en.footer.kept));
    await expect(footer.locator('.shell-footer-facts')).toHaveCount(0);

    await footer.getByRole('button').click();

    const facts = footer.locator('.shell-footer-facts li');
    // the file, the password, the notification address, the client info line
    // and the operator note
    await expect(facts).toHaveCount(5);
    await expect(facts.first()).toContainText('14 days');
    await expect(footer).toContainText(en.footer.keptPassword);
    await expect(footer).toContainText(en.footer.operator);
    // the articles are useless without saying which law they belong to
    await expect(footer).toContainText(en.footer.law);
  });

  test('says nothing is kept about downloaders when the server keeps nothing', async ({ page }) => {
    await page.goto('/');
    await page.locator('.shell-footer button').click();

    // the test server runs with saveclientinfo off
    await expect(page.locator('.shell-footer')).toContainText(en.footer.keptClientNone);
    await expect(page.locator('.shell-footer')).not.toContainText(en.footer.keptClient);
  });

  test('leaves out operator links that are not configured', async ({ page }) => {
    await page.goto('/');

    const footer = page.locator('.shell-footer');
    await expect(footer.getByRole('link')).toHaveCount(0);
  });

  test('stays on the download page, where the recipient reads it', async ({ page }) => {
    await page.goto('/d/doesnotexistatall');
    await expect(page.locator('.shell-footer')).toBeVisible();
  });
});
