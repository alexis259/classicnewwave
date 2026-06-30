// Removes white/near-white backgrounds from hair icon PNGs
// Usage: node scripts/remove-white-bg.js

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '../netlify/functions/assets');

const FILES = [
  'afro-puff.png',
  'bantu-knots.png',
  'cornrows.png',
  'silk-press.png',
  'wash-and-go.png',
];

async function removeWhiteBg(file) {
  const src = path.join(ASSETS, file);
  const img = await loadImage(src);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height);
  for (let i = 0; i < data.data.length; i += 4) {
    const r = data.data[i], g = data.data[i+1], b = data.data[i+2];
    if (r > 210 && g > 210 && b > 210) data.data[i+3] = 0;
  }
  ctx.putImageData(data, 0, 0);
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(src, buf);
  console.log(`✓ ${file}`);
}

(async () => {
  for (const f of FILES) await removeWhiteBg(f);
  console.log('Done.');
})();
