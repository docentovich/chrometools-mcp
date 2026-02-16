/**
 * Screenshot Action Handler
 */

import { processScreenshot } from '../image-processing.js';

/**
 * Execute screenshot action on element
 *
 * @param {Page} page - Puppeteer page instance
 * @param {ElementHandle} element - Target element
 * @param {Object} options - Screenshot options
 * @param {string} options.identifier - Element identifier (for output message)
 * @param {number} options.padding - Padding around element in pixels (default: 0)
 * @param {number|null} options.maxWidth - Max width for scaling (default: 1024, null for original)
 * @param {number|null} options.maxHeight - Max height for scaling (default: 8000, null for original)
 * @param {number} options.quality - JPEG quality 1-100 (default: 50)
 * @param {string} options.format - Image format: 'png', 'jpeg', 'auto' (default: 'jpeg')
 * @returns {Promise<Object>} Result with content array (text + image)
 */
export async function executeScreenshotAction(page, element, options = {}) {
  const {
    identifier = 'element',
    padding = 0,
    maxWidth = 1024,
    maxHeight = 8000,
    quality = 40,
    format = 'jpeg'
  } = options;

  // Scroll to element to ensure it's in viewport
  await element.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));

  const box = await element.boundingBox();
  if (!box) {
    throw new Error(`Element is not visible or has no bounding box: ${identifier}`);
  }

  const clip = {
    x: Math.max(box.x - padding, 0),
    y: Math.max(box.y - padding, 0),
    width: Math.max(box.width + padding * 2, 1),
    height: Math.max(box.height + padding * 2, 1)
  };

  // Take screenshot as buffer
  const screenshotBuffer = await page.screenshot({ clip, encoding: 'binary' });

  // Process with compression and scaling
  const processed = await processScreenshot(screenshotBuffer, {
    maxWidth: maxWidth ?? 1024,
    maxHeight: maxHeight ?? 8000,
    quality: quality ?? 80,
    format: format ?? 'auto'
  });

  // Build info message
  const infoText = `Screenshot captured: ${processed.metadata.width}x${processed.metadata.height} ${processed.metadata.format.toUpperCase()}` +
    (processed.metadata.scaled ? ` (scaled from ${processed.metadata.originalWidth}x${processed.metadata.originalHeight})` : '') +
    (processed.metadata.compressed ? ` (${processed.metadata.compressionRatio}% compression)` : '') +
    `\nSize: ${(processed.metadata.finalSize / 1024).toFixed(1)}KB` +
    (processed.metadata.originalSize !== processed.metadata.finalSize ?
      ` (original: ${(processed.metadata.originalSize / 1024).toFixed(1)}KB)` : '');

  return {
    content: [
      { type: "text", text: infoText },
      { type: "image", data: processed.buffer.toString('base64'), mimeType: processed.mimeType }
    ]
  };
}
