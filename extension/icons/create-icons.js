/**
 * Create ChromeTools extension icons
 * Run with: node create-icons.js
 *
 * Creates a happy robot icon with Chrome colors
 */

import Jimp from 'jimp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Colors (RGBA format for Jimp)
const CHROME_BLUE = 0x4285F4FF;
const CHROME_GREEN = 0x34A853FF;
const CHROME_YELLOW = 0xFBBC05FF;
const CHROME_RED = 0xEA4335FF;
const ROBOT_BODY = 0x5C6BC0FF;     // Nice indigo/purple
const ROBOT_FACE = 0x7986CBFF;     // Lighter purple for face
const ROBOT_LIGHT = 0x9FA8DAFF;    // Highlight
const WHITE = 0xFFFFFFFF;
const BLACK = 0x333333FF;
const SMILE_COLOR = 0xFFFFFFFF;
const ANTENNA_COLOR = 0xFFD54FFF;  // Golden antenna ball
const TRANSPARENT = 0x00000000;

async function createIcon(size) {
  const image = new Jimp(size, size, TRANSPARENT);

  const center = size / 2;
  const headRadius = size * 0.38;

  // Draw robot head (rounded rectangle approximation with circle)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center + size * 0.05; // Slightly lower
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Head shape (circle with flat bottom)
      if (dist <= headRadius && y < center + headRadius * 0.85) {
        // Gradient effect - lighter at top
        const gradientFactor = 1 - (y / size) * 0.3;
        if (dy < -headRadius * 0.3) {
          image.setPixelColor(ROBOT_LIGHT, x, y);
        } else {
          image.setPixelColor(ROBOT_FACE, x, y);
        }
      }
    }
  }

  // Draw ears (Chrome colored circles on sides)
  const earRadius = size * 0.12;
  const earY = center;
  drawCircle(image, center - headRadius - earRadius * 0.3, earY, earRadius, CHROME_BLUE);
  drawCircle(image, center + headRadius + earRadius * 0.3, earY, earRadius, CHROME_GREEN);

  // Draw antenna
  const antennaX = center;
  const antennaTopY = center - headRadius - size * 0.12;
  const antennaBottomY = center - headRadius + size * 0.05;

  // Antenna stem
  for (let y = antennaTopY + size * 0.06; y <= antennaBottomY; y++) {
    const thickness = Math.max(1, size * 0.03);
    for (let dx = -thickness; dx <= thickness; dx++) {
      image.setPixelColor(ROBOT_LIGHT, Math.round(antennaX + dx), Math.round(y));
    }
  }

  // Antenna ball (golden/yellow)
  drawCircle(image, antennaX, antennaTopY + size * 0.03, size * 0.07, ANTENNA_COLOR);

  // Draw happy eyes (big and expressive)
  const eyeRadius = size * 0.11;
  const eyeOffset = size * 0.15;
  const eyeY = center - size * 0.05;

  // Eye whites
  drawCircle(image, center - eyeOffset, eyeY, eyeRadius, WHITE);
  drawCircle(image, center + eyeOffset, eyeY, eyeRadius, WHITE);

  // Pupils (looking slightly up and to the side - friendly look)
  const pupilRadius = eyeRadius * 0.5;
  const pupilOffsetX = size * 0.02;
  const pupilOffsetY = -size * 0.02;
  drawCircle(image, center - eyeOffset + pupilOffsetX, eyeY + pupilOffsetY, pupilRadius, CHROME_BLUE);
  drawCircle(image, center + eyeOffset + pupilOffsetX, eyeY + pupilOffsetY, pupilRadius, CHROME_BLUE);

  // Eye shine (small white dot)
  if (size >= 32) {
    const shineRadius = Math.max(1, size * 0.025);
    drawCircle(image, center - eyeOffset + pupilOffsetX - size * 0.02, eyeY + pupilOffsetY - size * 0.02, shineRadius, WHITE);
    drawCircle(image, center + eyeOffset + pupilOffsetX - size * 0.02, eyeY + pupilOffsetY - size * 0.02, shineRadius, WHITE);
  }

  // Draw big happy smile
  const smileY = center + size * 0.12;
  const smileWidth = size * 0.22;
  const smileHeight = size * 0.08;

  for (let x = center - smileWidth; x <= center + smileWidth; x++) {
    // Curved smile (arc)
    const normalizedX = (x - center) / smileWidth;
    const curveY = smileHeight * (1 - normalizedX * normalizedX);

    for (let dy = 0; dy <= curveY; dy++) {
      const py = Math.round(smileY + dy);
      if (py < size) {
        image.setPixelColor(WHITE, Math.round(x), py);
      }
    }
  }

  // Rosy cheeks (small pink circles for larger sizes)
  if (size >= 48) {
    const cheekRadius = size * 0.04;
    const cheekY = center + size * 0.08;
    const cheekColor = 0xFFAB91FF; // Soft coral/pink

    drawCircle(image, center - eyeOffset - size * 0.1, cheekY, cheekRadius, cheekColor);
    drawCircle(image, center + eyeOffset + size * 0.1, cheekY, cheekRadius, cheekColor);
  }

  return image;
}

function drawCircle(image, cx, cy, radius, color) {
  const r2 = radius * radius;
  for (let y = cy - radius - 1; y <= cy + radius + 1; y++) {
    for (let x = cx - radius - 1; x <= cx + radius + 1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        if (x >= 0 && x < image.getWidth() && y >= 0 && y < image.getHeight()) {
          image.setPixelColor(color, Math.round(x), Math.round(y));
        }
      }
    }
  }
}

async function main() {
  console.log('Creating ChromeTools icons (happy robot)...');

  // Create icons
  const icon16 = await createIcon(16);
  const icon48 = await createIcon(48);
  const icon128 = await createIcon(128);

  // Save icons
  await icon16.writeAsync(path.join(__dirname, 'icon16.png'));
  await icon48.writeAsync(path.join(__dirname, 'icon48.png'));
  await icon128.writeAsync(path.join(__dirname, 'icon128.png'));

  console.log('✅ Icons created successfully!');
  console.log('  - icon16.png (happy robot)');
  console.log('  - icon48.png (happy robot)');
  console.log('  - icon128.png (happy robot)');
}

main().catch(console.error);
