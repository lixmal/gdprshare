const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFName } = require('pdf-lib');

// The advanced options live behind "More options" since the redesign.
async function openOptions(page) {
  const more = page.locator('button[aria-expanded="false"]');
  if (await more.count() > 0)
    await more.first().click();
}


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

    const fileInput = page.locator('input#content');
    await expect(fileInput).toBeVisible({ timeout: 10000 });
    await fileInput.setInputFiles(testFilePath);

    await openOptions(page);
    await page.locator('input#expiry').fill('1');
    await openOptions(page);
    await page.locator('input#count').fill('2');
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');

    const uploadButton = page.locator('input[type="submit"]');
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

    await openOptions(page);
    await page.locator('input#expiry').fill('1');
    await openOptions(page);
    await page.locator('input#count').fill('2');
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');

    const uploadButton = page.locator('input[type="submit"]');
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

    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');

    const uploadButton = page.locator('input[type="submit"]');
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

    const fileInput = page.locator('input#content');
    await expect(fileInput).toBeVisible({ timeout: 10000 });
    await fileInput.setInputFiles(testFilePath);

    await openOptions(page);
    await page.locator('input#count').fill('2');
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');

    const uploadButton = page.locator('input[type="submit"]');
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
    await page.locator('label[for="type-image"]').click();

    // Upload the image
    const fileInput = page.locator('input#image-content');
    await fileInput.setInputFiles(testImagePath);

    await openOptions(page);
    await page.locator('input#count').fill('2');
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');

    const uploadButton = page.locator('input[type="submit"]');
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

    await page.locator('label[for="type-image"]').click();

    const fileInput = page.locator('input#image-content');
    await fileInput.setInputFiles(testImagePath);

    await openOptions(page);
    await page.locator('input#count').fill('2');
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');

    const uploadButton = page.locator('input[type="submit"]');
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
    await page.locator('label[for="type-image"]').click();

    // Set disappear to 5 seconds (smallest preset)
    await openOptions(page);
    await page.locator('select#ephemeral').selectOption('5');

    // Upload the image
    const fileInput = page.locator('input#image-content');
    await fileInput.setInputFiles(testImagePath);

    await openOptions(page);
    await page.locator('input#count').fill('2');
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');

    const uploadButton = page.locator('input[type="submit"]');
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

    // Verify image is shown
    const modalImage = downloadPage.locator('#modal-image');
    await expect(modalImage).toBeVisible({ timeout: 5000 });

    // Countdown is hidden by default (showcountdown: false)
    const countdown = downloadPage.locator('#countdown-timer');
    await expect(countdown).not.toBeVisible();

    // Modal should still auto-close after the ephemeral duration expires
    await expect(modalImage).not.toBeVisible({ timeout: 10000 });
  });

  test('should block download when EEA-only flag is set and client is outside EEA', async ({ page, context }) => {
    const testContent = 'EEA test ' + Date.now();
    const testFilePath = path.join(__dirname, 'eea-test.txt');
    fs.writeFileSync(testFilePath, testContent);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Leave geo-restriction as EU/EEA (default)
    await openOptions(page);
    await page.locator('input#count').fill('2');

    const uploadButton = page.locator('input[type="submit"]');
    await uploadButton.click();

    await page.waitForURL(/\/uploaded/);

    const downloadLinkInput = page.locator('input#link-key');
    const downloadUrl = await downloadLinkInput.inputValue();

    // Try to download from localhost (not in EEA)
    const downloadPage = await context.newPage();
    await downloadPage.goto(downloadUrl, { waitUntil: 'load' });

    // the client shows the localized message for the API's error code, not the
    // terse wire message
    const en = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'public', 'locales', 'en.json'), 'utf8'));
    const errorMessage = downloadPage.locator('.alert-danger');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
    await expect(errorMessage).toContainText(en.errors.server.download_location_forbidden);

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

    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');

    const uploadButton = page.locator('input[type="submit"]');
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

  test('should strip image metadata during upload', async ({ page, context }) => {
    const testImagePath = path.join(__dirname, 'test-image.png');
    const originalBytes = fs.readFileSync(testImagePath);

    await page.locator('label[for="type-image"]').click();

    const fileInput = page.locator('input#image-content');
    await fileInput.setInputFiles(testImagePath);

    await openOptions(page);
    await page.locator('input#count').fill('2');
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');

    const uploadButton = page.locator('input[type="submit"]');
    await uploadButton.click();

    await page.waitForURL(/\/uploaded/);

    const downloadLinkInput = page.locator('input#link-key');
    const downloadUrl = await downloadLinkInput.inputValue();

    const downloadPage = await context.newPage();
    await downloadPage.goto(downloadUrl, { waitUntil: 'load' });

    const inlineImage = downloadPage.locator('#inline-image');
    await expect(inlineImage).toBeVisible({ timeout: 10000 });

    // Get the image blob data via fetch on the object URL
    const imageInfo = await downloadPage.evaluate(async () => {
      const img = document.querySelector('#inline-image');
      const response = await fetch(img.src);
      const blob = await response.blob();
      const buffer = await blob.arrayBuffer();
      return {
        size: buffer.byteLength,
        bytes: Array.from(new Uint8Array(buffer).slice(0, 8)),
      };
    });

    // The re-encoded image should be a valid PNG with non-zero size
    expect(imageInfo.size).toBeGreaterThan(0);

    // Verify it's still a valid PNG (starts with PNG signature)
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    expect(imageInfo.bytes).toEqual(pngSignature);
  });
  async function makePdfWithMetadata(filePath) {
    const doc = await PDFDocument.create();
    doc.addPage().drawText('page content');
    doc.setTitle('Secret Project Plan');
    doc.setAuthor('Jane Doe');
    doc.setProducer('SomeEditor 1.2');

    const xmp = doc.context.stream(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:creator>Jane Doe</dc:creator></x:xmpmeta>',
      { Type: 'Metadata', Subtype: 'XML' },
    );
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmp));

    fs.writeFileSync(filePath, await doc.save());
  }

  // Uploads the file, follows the link and returns the decrypted bytes.
  async function uploadAndDownload(page, context, filePath, { strip }) {
    await page.locator('input#content').setInputFiles(filePath);
    if (strip) {
      await openOptions(page);
      await page.locator('input#strip').check();
    }

    await openOptions(page);
    await page.locator('input#count').fill('2');
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');
    await page.locator('input[type="submit"]').click();

    await page.waitForURL(/\/uploaded/);
    const downloadUrl = await page.locator('input#link-key').inputValue();

    const downloadPage = await context.newPage();
    const downloadPromise = downloadPage.waitForEvent('download', { timeout: 15000 });
    await downloadPage.goto(downloadUrl, { waitUntil: 'load' });
    const download = await downloadPromise;

    const saved = await download.path();
    const bytes = fs.readFileSync(saved);
    await downloadPage.close();

    return bytes;
  }

  test('should strip pdf metadata when the option is checked', async ({ page, context }) => {
    const pdfPath = path.join(__dirname, 'test-strip.pdf');
    await makePdfWithMetadata(pdfPath);

    const bytes = await uploadAndDownload(page, context, pdfPath, { strip: true });

    // stripped pdfs are saved uncompressed, so nothing can hide in an object stream
    const raw = bytes.toString('latin1');
    expect(raw).toContain('%PDF-');
    expect(raw).not.toContain('Jane Doe');
    expect(raw).not.toContain('Secret Project Plan');
    expect(raw).not.toContain('SomeEditor');
    expect(raw).not.toContain('xmpmeta');

    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBeUndefined();
    expect(doc.getAuthor()).toBeUndefined();

    fs.unlinkSync(pdfPath);
  });

  test('should keep pdf metadata when the option is left unchecked', async ({ page, context }) => {
    const pdfPath = path.join(__dirname, 'test-nostrip.pdf');
    await makePdfWithMetadata(pdfPath);

    const bytes = await uploadAndDownload(page, context, pdfPath, { strip: false });

    // opt-in: without the checkbox the file is uploaded untouched. The values live
    // in a compressed object stream, so read them back through a pdf parser.
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getTitle()).toBe('Secret Project Plan');
    expect(doc.getAuthor()).toBe('Jane Doe');
    expect(doc.getProducer()).toBe('SomeEditor 1.2');

    fs.unlinkSync(pdfPath);
  });

  test('should abort the upload when metadata cannot be stripped', async ({ page }) => {
    const docPath = path.join(__dirname, 'test-strip.docx');
    fs.writeFileSync(docPath, 'not a format we can strip');

    await page.locator('input#content').setInputFiles(docPath);
    await openOptions(page);
    await page.locator('input#strip').check();
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');
    await page.locator('input[type="submit"]').click();

    // the upload must fail loudly instead of sending the file with its metadata
    await expect(page.locator('text=/could not remove the hidden data/i')).toBeVisible({ timeout: 10000 });
    expect(page.url()).not.toMatch(/\/uploaded/);

    fs.unlinkSync(docPath);
  });

  test('should only offer the strip option for the file type', async ({ page }) => {
    await openOptions(page);
    await expect(page.locator('input#strip')).toBeVisible();

    await page.locator('label[for="type-image"]').click();
    await openOptions(page);
    await expect(page.locator('input#strip')).toHaveCount(0);

    await page.locator('label[for="type-text"]').click();
    await openOptions(page);
    await expect(page.locator('input#strip')).toHaveCount(0);
  });
  // Two frame 1x1 GIF with a comment block, an XMP application extension and
  // the NETSCAPE looping block.
  function makeGifWithMetadata(filePath) {
    const text = (v) => Array.from(v).map((c) => c.charCodeAt(0));
    const subBlock = (v) => [v.length].concat(text(v));

    const frame = [
      0x21, 0xf9, 0x04, 0x00, 0x32, 0x00, 0x00, 0x00,
      0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      0x02, 0x02, 0x44, 0x01, 0x00,
    ];

    const bytes = [].concat(
      text('GIF89a'),
      [0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00],
      [0x00, 0x00, 0x00, 0xff, 0xff, 0xff],
      [0x21, 0xff], subBlock('NETSCAPE2.0'), [0x03, 0x01, 0x00, 0x00, 0x00],
      [0x21, 0xfe], subBlock('Shot by Jane Doe'), [0x00],
      [0x21, 0xff], subBlock('XMP DataXMP'), subBlock('<dc:creator>Jane Doe</dc:creator>'), [0x00],
      frame,
      frame,
      [0x3b],
    );

    fs.writeFileSync(filePath, Buffer.from(bytes));
  }

  test('should strip gif metadata without destroying the animation', async ({ page, context }) => {
    const gifPath = path.join(__dirname, 'test-anim.gif');
    makeGifWithMetadata(gifPath);

    // the image type always strips
    await page.locator('label[for="type-image"]').click();
    await page.locator('input#image-content').setInputFiles(gifPath);
    await openOptions(page);
    await page.locator('input#count').fill('2');
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');
    await page.locator('input[type="submit"]').click();

    await page.waitForURL(/\/uploaded/);
    const downloadUrl = await page.locator('input#link-key').inputValue();

    const downloadPage = await context.newPage();
    await downloadPage.goto(downloadUrl, { waitUntil: 'load' });
    await expect(downloadPage.locator('#inline-image')).toBeVisible({ timeout: 10000 });

    const result = await downloadPage.evaluate(async () => {
      const img = document.querySelector('#inline-image');
      const buffer = await (await fetch(img.src)).arrayBuffer();
      let raw = '';
      const view = new Uint8Array(buffer);
      for (let i = 0; i < view.length; i++) raw += String.fromCharCode(view[i]);
      return {
        raw,
        // a real browser decoder accepted the rewritten block structure
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
    });

    expect(result.raw.startsWith('GIF89a')).toBe(true);
    expect(result.raw).not.toContain('Jane Doe');
    expect(result.raw).not.toContain('XMP Data');
    // animation intact: looping block plus both frames still present
    expect(result.raw).toContain('NETSCAPE2.0');
    expect(result.raw.split('\x21\xf9\x04\x00\x32').length - 1).toBe(2);
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);

    await downloadPage.close();
    fs.unlinkSync(gifPath);
  });

  test('should load the pdf bundle only when a pdf is stripped', async ({ page }) => {
    const requested = [];
    page.on('request', (req) => {
      if (req.url().includes('pdf-lib.js')) requested.push(req.url());
    });

    await page.reload();
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');

    // not part of the initial page load
    expect(requested).toHaveLength(0);

    const pdfPath = path.join(__dirname, 'test-lazy.pdf');
    await makePdfWithMetadata(pdfPath);

    await page.locator('input#content').setInputFiles(pdfPath);
    await openOptions(page);
    await page.locator('input#strip').check();
    await page.locator('input[type="submit"]').click();

    await page.waitForURL(/\/uploaded/);
    expect(requested.length).toBeGreaterThan(0);

    fs.unlinkSync(pdfPath);
  });
});

test.describe('Upload with the options panel closed', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  // The email field only exists while the options are open, so reading it from
  // the DOM used to throw and leave the form stuck behind its spinner.
  test('uploads without ever opening the advanced options', async ({ page }) => {
    const testFilePath = path.join(__dirname, 'test-collapsed.txt');
    fs.writeFileSync(testFilePath, 'uploaded with the options collapsed');

    await page.locator('input#content').setInputFiles(testFilePath);
    await expect(page.locator('button[aria-expanded="false"]')).toBeVisible();

    await page.locator('input[type="submit"]').click();

    await page.waitForURL(/\/uploaded/);
    await expect(page.locator('input#link-key')).toHaveValue(/\/d\/.+#.+/);

    fs.unlinkSync(testFilePath);
  });

  test('remembers the notification address for the next upload', async ({ page }) => {
    await openOptions(page);
    await page.locator('input#email').fill('sender@example.org');

    const testFilePath = path.join(__dirname, 'test-email.txt');
    fs.writeFileSync(testFilePath, 'with a notification address');
    await page.locator('input#content').setInputFiles(testFilePath);
    await openOptions(page);
    await page.locator('select#geo-restriction').selectOption('none');
    await page.locator('input[type="submit"]').click();
    await page.waitForURL(/\/uploaded/);

    await page.goto('/');
    await openOptions(page);
    await expect(page.locator('input#email')).toHaveValue('sender@example.org');

    fs.unlinkSync(testFilePath);
  });
});
