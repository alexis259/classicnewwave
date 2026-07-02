// preview-alert.js — local QA for the weather alert card
// Usage: node preview-alert.js [hot|cold|storm] [temp] ["custom copy / line two"]
// Examples:
//   node preview-alert.js hot 101
//   node preview-alert.js cold 18
//   node preview-alert.js storm 72 "RAIN COMING / GET YOUR UMBRELLA."

const { drawAlertCard } = require('./netlify/functions/trigger-alert');
const fs   = require('fs');
const path = require('path');

const variant    = process.argv[2] || 'hot';
const temp       = Number(process.argv[3] ?? 101);
const customCopy = process.argv[4] || null;

async function main() {
  console.log(`Generating alert card: variant=${variant}, temp=${temp}°${customCopy ? `, custom="${customCopy}"` : ''}...`);
  const canvas = await drawAlertCard(variant, temp, customCopy);
  const out    = path.join(__dirname, `preview-alert-${variant}.png`);
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`Saved: ${out}`);

  const { execSync } = require('child_process');
  try { execSync(`open "${out}"`); } catch {}
}

main().catch(err => { console.error(err); process.exit(1); });
