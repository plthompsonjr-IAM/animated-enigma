// Run with: node generate-icons.js
// Generates simple placeholder PNG icons using the Canvas API (Node.js + canvas package)
// If canvas is not available, the icons/ directory can hold any 16x16, 48x48, 128x128 PNGs.

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];

for (const size of sizes) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#3b82f6';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  // Magnifying glass symbol
  const cx = size * 0.42, cy = size * 0.42, r = size * 0.22;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, size * 0.1);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.7, cy + r * 0.7);
  ctx.lineTo(cx + r * 1.5, cy + r * 1.5);
  ctx.stroke();

  const buf = canvas.toBuffer('image/png');
  const out = path.join(__dirname, 'icons', `icon${size}.png`);
  fs.writeFileSync(out, buf);
  console.log(`Wrote ${out}`);
}
