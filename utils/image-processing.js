/**
 * utils/image-processing.js
 *
 * Image processing utilities for screenshots and comparisons
 */

import Jimp from 'jimp';
import pixelmatch from 'pixelmatch';

/**
 * Process screenshot with compression and scaling
 * @param {Buffer} screenshotBuffer - Raw screenshot buffer
 * @param {Object} options - Processing options
 * @param {number} options.maxWidth - Maximum width (default: 1024)
 * @param {number} options.maxHeight - Maximum height (default: 8000)
 * @param {number} options.quality - JPEG quality (default: 80)
 * @param {string} options.format - Output format: 'auto', 'png', 'jpeg' (default: 'auto')
 * @param {number} options.maxFileSize - Maximum file size in bytes (default: 3MB)
 * @returns {Promise<Object>} - Processed image data with metadata
 */
export async function processScreenshot(screenshotBuffer, options = {}) {
  const {
    maxWidth = 1024,
    maxHeight = 8000, // API limit is 8000px
    quality = 80,
    format = 'auto',
    maxFileSize = 3 * 1024 * 1024 // 3 MB limit
  } = options;

  // Load image with Jimp
  const image = await Jimp.read(screenshotBuffer);
  const originalWidth = image.bitmap.width;
  const originalHeight = image.bitmap.height;
  const originalSize = screenshotBuffer.length;

  let processed = false;

  // Apply scaling if needed to fit within maxWidth and maxHeight
  if (maxWidth !== null || maxHeight !== null) {
    let newWidth = originalWidth;
    let newHeight = originalHeight;

    // Calculate scale factors for both dimensions
    let scaleWidth = 1.0;
    let scaleHeight = 1.0;

    if (maxWidth !== null && originalWidth > maxWidth) {
      scaleWidth = maxWidth / originalWidth;
    }

    if (maxHeight !== null && originalHeight > maxHeight) {
      scaleHeight = maxHeight / originalHeight;
    }

    // Use the smaller scale factor to ensure both dimensions fit
    const scale = Math.min(scaleWidth, scaleHeight);

    if (scale < 1.0) {
      newWidth = Math.round(originalWidth * scale);
      newHeight = Math.round(originalHeight * scale);
      image.resize(newWidth, newHeight);
      processed = true;
    }
  }

  // Determine output format
  let outputFormat = format;
  let mimeType = 'image/png';

  if (format === 'auto') {
    // Auto-select: use JPEG for large images, PNG for small
    const estimatedSize = image.bitmap.width * image.bitmap.height * 4;
    outputFormat = estimatedSize > 500000 ? 'jpeg' : 'png'; // ~500KB threshold
  }

  // Convert to buffer with appropriate format and quality
  let currentQuality = quality;
  let resultBuffer;
  let compressionAttempts = 0;
  const maxCompressionAttempts = 10;

  if (outputFormat === 'jpeg') {
    image.quality(currentQuality);
    resultBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
    mimeType = 'image/jpeg';
    processed = true;

    // If file exceeds maxFileSize, reduce quality iteratively
    while (resultBuffer.length > maxFileSize && compressionAttempts < maxCompressionAttempts) {
      compressionAttempts++;
      // Reduce quality by 10 points each iteration
      currentQuality = Math.max(10, currentQuality - 10);
      image.quality(currentQuality);
      resultBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);

      // If quality is already at minimum and still too large, scale down the image
      if (currentQuality === 10 && resultBuffer.length > maxFileSize) {
        const scaleFactor = Math.sqrt(maxFileSize / resultBuffer.length * 0.9); // 0.9 for safety margin
        const newWidth = Math.round(image.bitmap.width * scaleFactor);
        const newHeight = Math.round(image.bitmap.height * scaleFactor);
        image.resize(newWidth, newHeight);
        image.quality(currentQuality);
        resultBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
        processed = true;
      }
    }
  } else {
    resultBuffer = await image.getBufferAsync(Jimp.MIME_PNG);
    mimeType = 'image/png';

    // If PNG exceeds maxFileSize, convert to JPEG and compress
    if (resultBuffer.length > maxFileSize) {
      outputFormat = 'jpeg';
      mimeType = 'image/jpeg';
      currentQuality = quality;
      image.quality(currentQuality);
      resultBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
      processed = true;

      // Reduce quality iteratively if still too large
      while (resultBuffer.length > maxFileSize && compressionAttempts < maxCompressionAttempts) {
        compressionAttempts++;
        currentQuality = Math.max(10, currentQuality - 10);
        image.quality(currentQuality);
        resultBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);

        // If quality is already at minimum and still too large, scale down the image
        if (currentQuality === 10 && resultBuffer.length > maxFileSize) {
          const scaleFactor = Math.sqrt(maxFileSize / resultBuffer.length * 0.9);
          const newWidth = Math.round(image.bitmap.width * scaleFactor);
          const newHeight = Math.round(image.bitmap.height * scaleFactor);
          image.resize(newWidth, newHeight);
          image.quality(currentQuality);
          resultBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
          processed = true;
        }
      }
    }
  }

  // Return original if no processing was needed and format is PNG
  if (!processed && outputFormat === 'png' && resultBuffer.length <= maxFileSize) {
    return {
      buffer: screenshotBuffer,
      mimeType: 'image/png',
      metadata: {
        width: originalWidth,
        height: originalHeight,
        originalSize,
        finalSize: screenshotBuffer.length,
        format: 'png',
        compressed: false,
        scaled: false
      }
    };
  }

  return {
    buffer: resultBuffer,
    mimeType,
    metadata: {
      width: image.bitmap.width,
      height: image.bitmap.height,
      originalWidth,
      originalHeight,
      originalSize,
      finalSize: resultBuffer.length,
      format: outputFormat,
      compressed: outputFormat === 'jpeg' || compressionAttempts > 0,
      scaled: processed,
      compressionRatio: Math.round((1 - resultBuffer.length / originalSize) * 100),
      quality: outputFormat === 'jpeg' ? currentQuality : undefined,
      compressionAttempts: compressionAttempts > 0 ? compressionAttempts : undefined,
      autoCompressed: compressionAttempts > 0 || (outputFormat === 'jpeg' && format === 'png')
    }
  };
}

/**
 * Calculate SSIM (Structural Similarity Index) for image comparison
 * @param {Uint8ClampedArray} img1Data - First image data
 * @param {Uint8ClampedArray} img2Data - Second image data
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {number} - SSIM score (0-1, higher is more similar)
 */
export function calculateSSIM(img1Data, img2Data, width, height) {
  if (img1Data.length !== img2Data.length) {
    return 0;
  }

  const windowSize = 8;
  const k1 = 0.01;
  const k2 = 0.03;
  const c1 = (k1 * 255) ** 2;
  const c2 = (k2 * 255) ** 2;

  let ssimSum = 0;
  let validWindows = 0;

  for (let y = 0; y <= height - windowSize; y += windowSize) {
    for (let x = 0; x <= width - windowSize; x += windowSize) {
      let sum1 = 0, sum2 = 0, sum1Sq = 0, sum2Sq = 0, sum12 = 0;

      for (let dy = 0; dy < windowSize; dy++) {
        for (let dx = 0; dx < windowSize; dx++) {
          const idx = ((y + dy) * width + (x + dx)) * 4;
          if (idx + 2 >= img1Data.length) continue;

          const gray1 = (img1Data[idx] * 0.299 + img1Data[idx + 1] * 0.587 + img1Data[idx + 2] * 0.114);
          const gray2 = (img2Data[idx] * 0.299 + img2Data[idx + 1] * 0.587 + img2Data[idx + 2] * 0.114);

          sum1 += gray1;
          sum2 += gray2;
          sum1Sq += gray1 * gray1;
          sum2Sq += gray2 * gray2;
          sum12 += gray1 * gray2;
        }
      }

      const n = windowSize * windowSize;
      const mean1 = sum1 / n;
      const mean2 = sum2 / n;
      const variance1 = (sum1Sq / n) - (mean1 * mean1);
      const variance2 = (sum2Sq / n) - (mean2 * mean2);
      const covariance = (sum12 / n) - (mean1 * mean2);

      const ssim = ((2 * mean1 * mean2 + c1) * (2 * covariance + c2)) /
        ((mean1 * mean1 + mean2 * mean2 + c1) * (variance1 + variance2 + c2));

      ssimSum += ssim;
      validWindows++;
    }
  }

  return validWindows > 0 ? ssimSum / validWindows : 0;
}

/**
 * Compare two images without stretching.
 *
 * Default: both are placed top-left on a common transparent canvas (max width x
 * max height); area covered by only one image counts as difference.
 *
 * With `offset` ({x, y} in px, position of the Figma image relative to the page
 * image, e.g. from anchor alignment): the canvas is the page image, only the
 * overlap of both images is compared, the rest is reported as `outsidePixels`.
 *
 * `masks` ([{x, y, width, height}] in page image px): excluded from the diff,
 * drawn hatched on diff and overlay.
 * @returns {Promise<{width, height, diffPixels, comparedPixels, outsidePixels, maskedPixels, ssim, diff: Jimp, overlay: Jimp}>}
 */
export async function compareImages(figmaBuffer, pageBuffer, { pixelThreshold = 0.1, offset = null, masks = [] } = {}) {
  const [figma, page] = await Promise.all([Jimp.read(figmaBuffer), Jimp.read(pageBuffer)]);
  const fw = figma.bitmap.width, fh = figma.bitmap.height;
  const pw = page.bitmap.width, ph = page.bitmap.height;

  let width, height, fx = 0, fy = 0, region;
  if (offset) {
    width = pw; height = ph;
    fx = Math.round(offset.x); fy = Math.round(offset.y);
    // Overlap of the shifted Figma image with the page image
    const x0 = Math.max(0, fx), y0 = Math.max(0, fy);
    const x1 = Math.min(pw, fx + fw), y1 = Math.min(ph, fy + fh);
    region = { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
  } else {
    width = Math.max(fw, pw); height = Math.max(fh, ph);
    region = { x: 0, y: 0, width, height };
  }
  if (region.width === 0 || region.height === 0) {
    throw new Error('Figma image and page element do not overlap after alignment');
  }

  const figmaCanvas = new Jimp(width, height, 0x00000000).composite(figma, fx, fy);
  const pageCanvas = new Jimp(width, height, 0x00000000).composite(page, 0, 0);

  // Masked areas: same opaque color in both images, so they never differ
  const clipRect = m => {
    const x0 = Math.max(region.x, Math.round(m.x)), y0 = Math.max(region.y, Math.round(m.y));
    const x1 = Math.min(region.x + region.width, Math.round(m.x + m.width));
    const y1 = Math.min(region.y + region.height, Math.round(m.y + m.height));
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
  };
  const maskRects = masks.map(clipRect).filter(Boolean);
  const maskSet = new Uint8Array(width * height);
  for (const m of maskRects) {
    for (let y = m.y; y < m.y + m.height; y++) for (let x = m.x; x < m.x + m.width; x++) maskSet[y * width + x] = 1;
  }
  let maskedPixels = 0;
  for (let i = 0; i < maskSet.length; i++) {
    if (!maskSet[i]) continue;
    maskedPixels++;
    for (const c of [figmaCanvas, pageCanvas]) {
      const d = c.bitmap.data;
      d[i * 4] = 255; d[i * 4 + 1] = 0; d[i * 4 + 2] = 255; d[i * 4 + 3] = 255;
    }
  }

  // Compare only the region (crop both canvases to it)
  const fr = figmaCanvas.clone().crop(region.x, region.y, region.width, region.height);
  const pr = pageCanvas.clone().crop(region.x, region.y, region.width, region.height);
  const diffRegion = new Jimp(region.width, region.height, 0x00000000);
  const diffPixels = pixelmatch(fr.bitmap.data, pr.bitmap.data, diffRegion.bitmap.data, region.width, region.height, {
    threshold: pixelThreshold,
    includeAA: false
  });
  const ssim = calculateSSIM(fr.bitmap.data, pr.bitmap.data, region.width, region.height);
  const diff = new Jimp(width, height, 0x00000000).composite(diffRegion, region.x, region.y);

  // Page with the design at 50% on top: misaligned edges show as doubled lines
  const overlay = new Jimp(width, height, 0x00000000).composite(page, 0, 0).composite(figma, fx, fy, {
    mode: Jimp.BLEND_SOURCE_OVER,
    opacitySource: 0.5,
    opacityDest: 1
  });

  // Hatch masked areas on diff and overlay
  for (const img of maskedPixels ? [diff, overlay] : []) {
    const d = img.bitmap.data;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (maskSet[i] && (x + y) % 8 < 2) { d[i * 4] = 128; d[i * 4 + 1] = 128; d[i * 4 + 2] = 128; d[i * 4 + 3] = 255; }
    }
  }

  const comparedPixels = region.width * region.height - maskedPixels;
  const unionArea = offset
    ? (pw * ph + fw * fh - region.width * region.height)
    : width * height;
  return {
    width,
    height,
    region,
    diffPixels,
    comparedPixels,
    outsidePixels: offset ? unionArea - region.width * region.height : 0,
    maskedPixels,
    ssim,
    figmaSize: { width: fw, height: fh },
    pageSize: { width: pw, height: ph },
    diff,
    overlay
  };
}
