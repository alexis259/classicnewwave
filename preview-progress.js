// preview-progress.js — generates preview-progress.png locally for QA
// Usage: node preview-progress.js

const { drawProgressUpdate } = require('./netlify/functions/generate-ig-graphic');
const fs   = require('fs');
const path = require('path');

const mockData = {
  issue: 3,
  date: 'JULY 30, 2026',
  updates: [
    {
      icon:  'sunny.png',
      title: 'WEATHER SCORING UPDATE',
      desc:  'Perfect band expanded to 70–80°F. Humidity threshold raised to 70%. Overcast penalty tightened.'
    },
    {
      icon:  'partly-cloudy.png',
      title: 'BROADCAST ARCHIVE',
      desc:  'Browse the last 90 days of daily broadcasts — score, conditions, synopsis, and IG graphic.'
    },
    {
      icon:  'light-rain.png',
      title: 'WEATHER ALERT SYSTEM',
      desc:  'Two-layer automated system now live. Proactive forecast detection at 7AM daily.'
    },
  ],
  nextUp: ['SMS BETA LAUNCH', 'SYSTEM USER TOKEN', 'MOBILE QA']
};

async function main() {
  console.log('Generating progress update graphic…');
  const canvas = await drawProgressUpdate(mockData);
  const out    = path.join(__dirname, 'preview-progress.png');
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`Saved: ${out}`);
  const { execSync } = require('child_process');
  try { execSync(`open "${out}"`); } catch {}
}

main().catch(err => { console.error(err); process.exit(1); });
