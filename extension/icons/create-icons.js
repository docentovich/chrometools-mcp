/**
 * Simple script to create placeholder PNG icons
 * Run with: node create-icons.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal 16x16 PNG (purple square with "CT")
// This is a pre-generated base64 PNG
const icon16Base64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA2ElEQVQ4T2NkoBAwUqifAWQA8/79/xlsbGwYpqSkMFy6dInB29ubITIykuHQoUMMixcvZpCTk2OQl5dn4OTkZGBhYQEbiGE5ugEgzf///2ewtLRksLCwYNi4cSPDnz9/GJSVlRnExMQYfv36xXD58mWG169fM8jKyjIoKioyYDMA2QCQYRkZGQy/f/9mCA0NZdi2bRuDi4sLg6mpKYOGhgaDgIAAw5cvXxiuXr3K8PTpUwYFBQUGZWVlDAOwGgByHbIBHz9+ZGBnZ2f49esXg4CAAIOEhASyVQwgLxAXCwAbdmMRy/FYUAAAAABJRU5ErkJggg==';

// Minimal 48x48 PNG
const icon48Base64 = 'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAA5klEQVRoQ+2YQQ6AIAwE4f9/Wj14MQbNFBqSiCeVzrKzLVVz8mjP7bv8/wGYXYGlFVgKgOUV2AWAZQBYnEDXP4DrAFQHwDIALAPAMgCW/gOW/oS2ArD0J7QVAKX/gKX/wKYALP0HLK3A9DuQ2cCyAGZXYGkALAPAMgAsA8AyACwDwLK0Apv/A1v+A7f8CLb8CLb8CLb8CLb0J9TyH7hlAbb0J7TlP9CW/8Atv4Et/4G2/Adu+Q9s+Q+05T9wy49gy39gS39CW/4Dt/wItvwHtvwHbvkPbPkP3PIj2PIf2NIfsOVHcIt/4BeH9mERO9Xj7gAAAABJRU5ErkJggg==';

// Minimal 128x128 PNG
const icon128Base64 = 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAA+UlEQVR4nO3bMQ6AIBBA0cH7X5reABvKcRI0MTTk5y1NQ0EogQIAAAAAAAAA4E/y/wDdNv8OwO7y7wA0yL8DAAAAAAAAAACcJf8OwO7y7wDcJv8OwK3y7wDcJv8OQIP8OwC3yb8D0CD/DsBt8u8A3Cb/DkCD/DsAt8m/A9Ag/w7AbfLvANwm/w5Ag/w7ALfJvwPQIP8OwG3y7wDcJv8OQIP8OwC3yb8D0CD/DsBt8u8A3Cb/DkCD/DsAt8m/A9Ag/w7AbfLvANwm/w5Ag/w7ALfJvwPQIP8OwG3y7wAAAAAAAAAAAACA/8i/AwAAAAAAAAAAANB+AF1kDZEXMu8MAAAAAElFTkSuQmCC';

// Write files
fs.writeFileSync(path.join(__dirname, 'icon16.png'), Buffer.from(icon16Base64, 'base64'));
fs.writeFileSync(path.join(__dirname, 'icon48.png'), Buffer.from(icon48Base64, 'base64'));
fs.writeFileSync(path.join(__dirname, 'icon128.png'), Buffer.from(icon128Base64, 'base64'));

console.log('Icons created successfully!');
