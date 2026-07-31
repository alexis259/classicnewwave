// preview-progress.js — generates preview-progress.png locally for QA
// Usage: node preview-progress.js

const { drawProgressUpdate } = require('./netlify/functions/generate-ig-graphic');
const fs   = require('fs');
const path = require('path');

const mockData = {
  issue: 3,
  date: 'JULY 31, 2026',
  updates: [
    { title: 'WEATHER SCORING UPDATE', desc: 'Perfect band expanded to 70–80°F. Overcast penalty tightened.' },
    { title: 'BROADCAST ARCHIVE',      desc: 'Browse the last 90 days of daily broadcasts.' },
    { title: 'WEATHER ALERT SYSTEM',   desc: 'Two-layer automated system now live at 7AM.' },
  ],
  nextUp: ['SMS BETA LAUNCH', 'SYSTEM USER TOKEN', 'MOBILE QA']
};

async function main() {
  const { execSync } = require('child_process');
  const files = [];
  for (let issue = 1; issue <= 4; issue++) {
    console.log(`Generating issue ${issue}…`);
    const canvas = await drawProgressUpdate({ ...mockData, issue });
    const out    = path.join(__dirname, `preview-progress-issue${issue}.png`);
    fs.writeFileSync(out, canvas.toBuffer('image/png'));
    console.log(`Saved: ${out}`);
    files.push(out);
  }
  try { execSync(`open ${files.map(f => `"${f}"`).join(' ')}`); } catch {}
}

main().catch(err => { console.error(err); process.exit(1); });
