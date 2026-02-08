const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test.describe('Full E2E Upload and Download Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
  });

  test('should load the homepage', async ({ page }) => {
    await expect(page).toHaveTitle(/GDPR/i);
    await expect(page.locator('input[type="file"]')).toBeVisible();
  });

  test('should upload a file and get a download link', async ({ page }) => {
    const testContent = 'Hello from E2E test! ' + Date.now();
    const testFilePath = path.join(__dirname, 'test-file.txt');
    fs.writeFileSync(testFilePath, testContent);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    await page.locator('input#expiry').fill('1');
    await page.locator('input#count').fill('2');
    await page.locator('input#only-eea').uncheck();

    const uploadButton = page.locator('input[type="submit"][value="Upload"]');
    await uploadButton.click();

    // Wait for success message or redirect
    await page.waitForURL(/\/uploaded/);

    // Verify we got a file ID and owner token
    const downloadLink = page.locator('input#link-key');
    await expect(downloadLink).toBeVisible();

    const linkValue = await downloadLink.inputValue();
    expect(linkValue).toContain('/d/');

    fs.unlinkSync(testFilePath);
  });

  test('should complete full upload, copy link, and download flow', async ({ page, context }) => {
    // Create a test file with unique content
    const testContent = 'E2E Test Content ' + Date.now();
    const testFilePath = path.join(__dirname, 'test-e2e.txt');
    fs.writeFileSync(testFilePath, testContent);

    // Step 1: Upload
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    await page.locator('input#expiry').fill('1');
    await page.locator('input#count').fill('2');
    await page.locator('input#only-eea').uncheck();

    const uploadButton = page.locator('input[type="submit"][value="Upload"]');
    await uploadButton.click();

    await page.waitForURL(/\/uploaded/);

    // Step 2: Copy the download link
    const downloadLinkInput = page.locator('input#link-key');
    await expect(downloadLinkInput).toBeVisible();

    const downloadUrl = await downloadLinkInput.inputValue();
    expect(downloadUrl).toContain('/d/');

    // Extract the hash (password) from the URL
    const hashMatch = downloadUrl.match(/#(.+)$/);
    expect(hashMatch).toBeTruthy();
    const passwordHash = hashMatch[1];

    // Step 3: Test clipboard functionality
    const copyButton = page.locator('button#link-copy');

    if (await copyButton.isVisible()) {
      await copyButton.click();

      // Wait a bit for clipboard operation
      await page.waitForTimeout(500);

      // Verify clipboard contains the URL
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText).toContain('/d/');
    }

    const downloadPage = await context.newPage();

    // Start waiting for download BEFORE navigation (critical timing)
    const downloadPromise = downloadPage.waitForEvent('download');
    await downloadPage.goto(downloadUrl, { waitUntil: 'load' });

    const download = await downloadPromise;
    const downloadPath = path.join(__dirname, await download.suggestedFilename());
    await download.saveAs(downloadPath);

    // Verify downloaded file is decrypted and matches original content
    const downloadedContent = fs.readFileSync(downloadPath, 'utf8');
    expect(downloadedContent).toBe(testContent);

    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
    if (fs.existsSync(downloadPath)) {
      fs.unlinkSync(downloadPath);
    }
  });

  test('should test clipboard copy button functionality', async ({ page }) => {
    // Upload a file first
    const testContent = 'Clipboard test ' + Date.now();
    const testFilePath = path.join(__dirname, 'clipboard-test.txt');
    fs.writeFileSync(testFilePath, testContent);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    await page.locator('input#only-eea').uncheck();

    const uploadButton = page.locator('input[type="submit"][value="Upload"]');
    await uploadButton.click();

    await page.waitForURL(/\/uploaded/);

    // Find and click the copy button
    const copyButton = page.locator('button#link-copy');
    await expect(copyButton).toBeVisible();

    // Click the copy button
    await copyButton.click();

    // Wait for clipboard operation
    await page.waitForTimeout(500);

    // Verify clipboard was written to
    const clipboardContent = await page.evaluate(async () => {
      return await navigator.clipboard.readText();
    });

    expect(clipboardContent).toBeTruthy();
    expect(clipboardContent).toContain('/d/');
    expect(clipboardContent.length).toBeGreaterThan(10);

    fs.unlinkSync(testFilePath);
  });

  test('should verify download count decrements', async ({ page, context }) => {
    // Upload with count of 2
    const testContent = 'Count test ' + Date.now();
    const testFilePath = path.join(__dirname, 'count-test.txt');
    fs.writeFileSync(testFilePath, testContent);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    await page.locator('input#count').fill('2');
    await page.locator('input#only-eea').uncheck();

    const uploadButton = page.locator('input[type="submit"][value="Upload"]');
    await uploadButton.click();

    await page.waitForURL(/\/uploaded/);

    const downloadLinkInput = page.locator('input#link-key');
    const downloadUrl = await downloadLinkInput.inputValue();

    // First download
    const downloadPage1 = await context.newPage();
    await downloadPage1.goto(downloadUrl);
    await downloadPage1.waitForTimeout(1000);

    // Attempt to trigger download
    const downloadButton1 = downloadPage1.locator('input[type="submit"]').or(
      downloadPage1.locator('button[type="submit"]')
    );
    if (await downloadButton1.isVisible({ timeout: 1000 }).catch(() => false)) {
      const download1 = downloadPage1.waitForEvent('download');
      await downloadButton1.click();
      await download1;
    }

    // Second download should work
    const downloadPage2 = await context.newPage();
    await downloadPage2.goto(downloadUrl);
    await downloadPage2.waitForTimeout(1000);

    const downloadButton2 = downloadPage2.locator('input[type="submit"]').or(
      downloadPage2.locator('button[type="submit"]')
    );
    if (await downloadButton2.isVisible({ timeout: 1000 }).catch(() => false)) {
      const download2 = downloadPage2.waitForEvent('download');
      await downloadButton2.click();
      await download2;
    }

    // Third download should fail
    const downloadPage3 = await context.newPage();
    await downloadPage3.goto(downloadUrl);
    await downloadPage3.waitForTimeout(1000);

    // Should show error message
    const errorMessage = downloadPage3.locator('text=/download count expired|not found/i');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });

    fs.unlinkSync(testFilePath);
  });

  test('should upload a non-disappearing image and display it immediately', async ({ page, context }) => {
    const testImagePath = path.join(__dirname, 'test-image.png');

    // Select image type (no disappear checked)
    await page.locator('select#type').selectOption('image');

    // Upload the image
    const fileInput = page.locator('input#image-content');
    await fileInput.setInputFiles(testImagePath);

    await page.locator('input#count').fill('2');
    await page.locator('input#only-eea').uncheck();

    const uploadButton = page.locator('input[type="submit"][value="Upload"]');
    await uploadButton.click();

    await page.waitForURL(/\/uploaded/);

    const downloadLinkInput = page.locator('input#link-key');
    await expect(downloadLinkInput).toBeVisible();
    const downloadUrl = await downloadLinkInput.inputValue();

    // Navigate to download page
    const downloadPage = await context.newPage();
    await downloadPage.goto(downloadUrl, { waitUntil: 'load' });

    // Image should display immediately inline (no button press needed)
    const inlineImage = downloadPage.locator('#inline-image');
    await expect(inlineImage).toBeVisible({ timeout: 10000 });

    // There should be no "View Image" button
    const viewImageBtn = downloadPage.locator('button#view-image');
    await expect(viewImageBtn).not.toBeVisible();

    // There should be no Close button
    const closeBtn = downloadPage.locator('button:has-text("Close")');
    await expect(closeBtn).not.toBeVisible();

    // Verify anti-save measures
    const antiSave = await downloadPage.evaluate(() => {
      const img = document.querySelector('#inline-image');
      const modal = img.closest('.image-modal');
      const overlay = document.querySelector('.image-overlay');
      const imgStyles = window.getComputedStyle(img);
      const modalStyles = window.getComputedStyle(modal);
      return {
        pointerEvents: imgStyles.pointerEvents,
        draggable: img.draggable,
        userSelect: modalStyles.userSelect,
        hasOverlay: !!overlay,
      };
    });
    expect(antiSave.pointerEvents).toBe('none');
    expect(antiSave.draggable).toBe(false);
    expect(antiSave.userSelect).toBe('none');
    expect(antiSave.hasOverlay).toBe(true);
  });

  test('should blur image when tab loses focus', async ({ page, context }) => {
    const testImagePath = path.join(__dirname, 'test-image.png');

    await page.locator('select#type').selectOption('image');

    const fileInput = page.locator('input#image-content');
    await fileInput.setInputFiles(testImagePath);

    await page.locator('input#count').fill('2');
    await page.locator('input#only-eea').uncheck();

    const uploadButton = page.locator('input[type="submit"][value="Upload"]');
    await uploadButton.click();

    await page.waitForURL(/\/uploaded/);

    const downloadLinkInput = page.locator('input#link-key');
    const downloadUrl = await downloadLinkInput.inputValue();

    const downloadPage = await context.newPage();
    await downloadPage.goto(downloadUrl, { waitUntil: 'load' });

    const inlineImage = downloadPage.locator('#inline-image');
    await expect(inlineImage).toBeVisible({ timeout: 10000 });

    // Initially not blurred
    const modal = downloadPage.locator('.image-modal');
    await expect(modal).not.toHaveClass(/image-hidden/);

    // Simulate visibilitychange to hidden
    await downloadPage.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, writable: true });
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await expect(modal).toHaveClass(/image-hidden/);

    // Verify blur is applied
    const blurFilter = await downloadPage.evaluate(() => {
      const img = document.querySelector('#inline-image');
      return window.getComputedStyle(img).filter;
    });
    expect(blurFilter).toBe('blur(80px)');

    // Simulate visibilitychange back to visible (unblur is delayed 1.5s)
    await downloadPage.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, writable: true });
      Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Should still be blurred immediately after focus (1.5s delay)
    await expect(modal).toHaveClass(/image-hidden/);

    // After the delay, blur should be removed
    await expect(modal).not.toHaveClass(/image-hidden/, { timeout: 3000 });

    // Verify blur is removed
    const noBlur = await downloadPage.evaluate(() => {
      const img = document.querySelector('#inline-image');
      return window.getComputedStyle(img).filter;
    });
    expect(noBlur).toBe('none');

    // Test window blur event
    await downloadPage.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
    });

    await expect(modal).toHaveClass(/image-hidden/);

    // Test window focus event (also delayed)
    await downloadPage.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
    });

    // Should still be blurred immediately
    await expect(modal).toHaveClass(/image-hidden/);

    // After delay, blur removed
    await expect(modal).not.toHaveClass(/image-hidden/, { timeout: 3000 });
  });

  test('should upload a disappearing image with countdown', async ({ page, context }) => {
    const testImagePath = path.join(__dirname, 'test-image.png');

    // Select image type
    await page.locator('select#type').selectOption('image');

    // Enable disappear
    await page.locator('input#disappear').check();

    // Set duration to 3 seconds for fast test
    await page.locator('input#ephemeral-seconds').fill('3');

    // Upload the image
    const fileInput = page.locator('input#image-content');
    await fileInput.setInputFiles(testImagePath);

    await page.locator('input#count').fill('2');
    await page.locator('input#only-eea').uncheck();

    const uploadButton = page.locator('input[type="submit"][value="Upload"]');
    await uploadButton.click();

    await page.waitForURL(/\/uploaded/);

    const downloadLinkInput = page.locator('input#link-key');
    const downloadUrl = await downloadLinkInput.inputValue();

    // Navigate to download page
    const downloadPage = await context.newPage();
    await downloadPage.goto(downloadUrl, { waitUntil: 'load' });

    // Wait for View Image button
    const viewImageBtn = downloadPage.locator('button#view-image');
    await expect(viewImageBtn).toBeVisible({ timeout: 10000 });

    // Click View Image
    await viewImageBtn.click();

    // Verify image and countdown are shown
    const modalImage = downloadPage.locator('#modal-image');
    await expect(modalImage).toBeVisible({ timeout: 5000 });

    const countdown = downloadPage.locator('#countdown-timer');
    await expect(countdown).toBeVisible();

    // Modal should auto-close after countdown expires
    await expect(modalImage).not.toBeVisible({ timeout: 10000 });
  });

  test('should block download when EEA-only flag is set and client is outside EEA', async ({ page, context }) => {
    const testContent = 'EEA test ' + Date.now();
    const testFilePath = path.join(__dirname, 'eea-test.txt');
    fs.writeFileSync(testFilePath, testContent);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Leave only-eea checked (default)
    await page.locator('input#count').fill('2');

    const uploadButton = page.locator('input[type="submit"][value="Upload"]');
    await uploadButton.click();

    await page.waitForURL(/\/uploaded/);

    const downloadLinkInput = page.locator('input#link-key');
    const downloadUrl = await downloadLinkInput.inputValue();

    // Try to download from localhost (not in EEA)
    const downloadPage = await context.newPage();
    await downloadPage.goto(downloadUrl, { waitUntil: 'load' });

    // Should see the forbidden error
    const errorMessage = downloadPage.locator('text=/download from this location forbidden/i');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });

    fs.unlinkSync(testFilePath);
  });

  test('should verify crypto encryption/decryption works', async ({ page }) => {
    // This test verifies the entire crypto pipeline by uploading and downloading
    const testContent = 'Crypto test ' + Date.now() + ' with special chars: äöü @#$%';
    const testFilePath = path.join(__dirname, 'crypto-test.txt');
    fs.writeFileSync(testFilePath, testContent);

    // Upload
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    await page.locator('input#only-eea').uncheck();

    const uploadButton = page.locator('input[type="submit"][value="Upload"]');
    await uploadButton.click();

    await page.waitForURL(/\/uploaded/);

    // Get download link with embedded password
    const downloadLinkInput = page.locator('input#link-key');
    const downloadUrl = await downloadLinkInput.inputValue();

    // Verify the URL has a hash (password)
    expect(downloadUrl).toMatch(/#[A-Za-z0-9_-]+$/);

    // Navigate to download page
    await page.goto(downloadUrl);

    // Wait a moment for auto-download attempt
    await page.waitForTimeout(1500);

    // If crypto works, we should either get a download or see the download page
    // (not an error about decryption failure)
    const cryptoError = page.locator('text=/decryption error|invalid password/i');
    const hasCryptoError = await cryptoError.isVisible().catch(() => false);

    // We should NOT see a crypto error
    expect(hasCryptoError).toBeFalsy();

    fs.unlinkSync(testFilePath);
  });
});
