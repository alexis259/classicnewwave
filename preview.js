// preview.js — generates slide1.png and slide2.png locally for QA
// Usage: node preview.js
// Edit mockRow below to test different weather conditions

const { drawDailySlide1, drawDailySlide2 } = require('./netlify/functions/generate-ig-graphic');
const fs   = require('fs');
const path = require('path');

// Edit these values to simulate different conditions
const mockRow = {
  temp:             89,
  high:             103,
  feels_like:       95,
  condition:        'Clear',
  precip_chance:    10,
  score:            4,
  humidity:         64,
  wind_speed:       8,
  synopsis_approved: "STARTING AT 89 BUT HEADING TO 103 — ITS FINNA GET REAL UGLY OUTSIDE. YALL BE SAFE."
};

async function main() {
  console.log('Generating slide 1...');
  const slide1 = await drawDailySlide1(mockRow);
  const out1   = path.join(__dirname, 'preview-slide1.png');
  fs.writeFileSync(out1, slide1.toBuffer('image/png'));
  console.log(`Saved: ${out1}`);

  console.log('Generating slide 2...');
  const slide2 = await drawDailySlide2(mockRow);
  const out2   = path.join(__dirname, 'preview-slide2.png');
  fs.writeFileSync(out2, slide2.toBuffer('image/png'));
  console.log(`Saved: ${out2}`);

  // Auto-open on macOS
  const { execSync } = require('child_process');
  try { execSync(`open "${out1}" "${out2}"`); } catch {}
}

main().catch(err => { console.error(err); process.exit(1); });
