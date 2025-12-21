/**
 * utils/image-processing.js
 *
 * Image processing utilities for screenshots and comparisons
 */

import Jimp from 'jimp';

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
