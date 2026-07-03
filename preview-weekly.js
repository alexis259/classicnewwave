// preview-weekly.js — local QA for the weekly forecast card
// Usage: node preview-weekly.js [score] [high] [condition] [humidity] [precipChance]
// Examples:
//   node preview-weekly.js
//   node preview-weekly.js 7 78 Rain 72 55

const { drawWeekly } = require('./netlify/functions/generate-ig-graphic');
const fs   = require('fs');
const path = require('path');

const score       = Number(process.argv[2] ?? 8);
const high        = Number(process.argv[3] ?? 74);
const condition   = process.argv[4] || 'Clear';
const humidity    = Number(process.argv[5] ?? 58);
const precipChance = Number(process.argv[6] ?? 10);

const row = {
  temp: high - 6,
  high,
  low: high - 18,
  feels_like: high - 4,
  condition,
  humidity,
  precip_chance: precipChance,
  wind_speed: 9,
  score,
  penalties: [],
  synopsis_approved: "city looking right today. take it all in — this one's for the ones who never left.",
  forecast: [
    { day: 'Wed', high: high,      rain: precipChance },
    { day: 'Thu', high: high - 4,  rain: 20 },
    { day: 'Fri', high: high + 3,  rain: 5  },
    { day: 'Sat', high: high - 8,  rain: 60 },
    { day: 'Sun', high: high - 2,  rain: 30 },
  ]
};

async function main() {
  console.log(`Generating weekly card: score=${score}, high=${high}°F, condition=${condition}, humidity=${humidity}%, precip=${precipChance}%...`);
  const canvas = await drawWeekly(row);
  const out = path.join(__dirname, 'preview-weekly.png');
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`Saved: ${out}`);

  const { execSync } = require('child_process');
  try { execSync(`open "${out}"`); } catch {}
}

main().catch(err => { console.error(err); process.exit(1); });
