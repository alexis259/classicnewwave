// netlify/functions/generate-ig-graphic.js
// Generates the daily IG feed + story graphic server-side.
// Called automatically by auto-post-ig.js when no image is queued,
// or manually from the admin panel (POST with password) to override.

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PW = process.env.ADMIN_PW;

// Register fonts — try local dev path first, then Netlify bundle path
function loadFont(filename) {
  for (const dir of [
    path.join(__dirname, 'fonts'),
    path.join(__dirname, 'netlify/functions/fonts'),
  ]) {
    try { return fs.readFileSync(path.join(dir, filename)); } catch {}
  }
  throw new Error(`Cannot find font: ${filename}`);
}

GlobalFonts.register(loadFont('IBMPlexMono-Bold.woff2'), 'IBM Plex Mono');
GlobalFonts.register(loadFont('IBMPlexMono-Regular.woff2'), 'IBM Plex Mono');
GlobalFonts.register(loadFont('ArchivoBlack.woff2'), 'Archivo Black');
GlobalFonts.register(loadFont('SpaceGrotesk-Regular.woff2'), 'Space Grotesk');

function toNYCDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(date);
}

function outfitForWeather(temp, rain) {
  let outerwear, top, bottom, shoes, extras = [];
  if (temp < 40)      outerwear = 'heavy coat';
  else if (temp < 50) outerwear = 'coat / jacket';
  else if (temp < 60) outerwear = 'light jacket';
  else if (temp < 68) outerwear = 'layer up';
  else                outerwear = null;
  if (temp < 40)      top = 'heavy sweater / hoodie';
  else if (temp < 55) top = 'hoodie / sweatshirt';
  else if (temp < 68) top = 'long sleeve';
  else                top = 'tee';
  if (temp < 45)      bottom = 'heavy pants / sweats';
  else if (temp < 65) bottom = 'jeans / pants';
  else                bottom = 'shorts / light pants';
  if (temp < 35 || rain > 60) shoes = 'waterproof boots';
  else if (temp < 55)          shoes = 'boots';
  else                         shoes = 'sneakers';
  if (temp < 32)      extras.push('hat + gloves');
  else if (temp < 42) extras.push('beanie');
  if (rain > 30)      extras.push('umbrella ☂');
  return [outerwear, top, bottom, shoes, ...extras].filter(Boolean);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = Infinity) {
  const words = text.split(' ');
  let line = '';
  const lines = [];
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    if (ctx.measureText(testLine).width > maxWidth && n > 0) {
      lines.push(line.trim());
      line = words[n] + ' ';
      if (lines.length >= maxLines) break;
    } else {
      line = testLine;
    }
  }
  if (lines.length < maxLines) lines.push(line.trim());
  if (lines.length === maxLines && line.trim()) {
    let last = lines[lines.length - 1];
    while (ctx.measureText(last + '…').width > maxWidth && last.length > 0) {
      last = last.slice(0, last.lastIndexOf(' '));
    }
    lines[lines.length - 1] = last + '…';
  }
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  return lines.length;
}

async function uploadImage(buffer, filename) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/story-images/${filename}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey': SUPABASE_SERVICE_KEY,
      'Content-Type': 'image/png',
      'x-upsert': 'true'
    },
    body: buffer
  });
  if (!res.ok) throw new Error(`Storage upload failed: ${await res.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/story-images/${filename}`;
}

async function generateAndUpload(row, dateKey) {
  const W = 1080, H = 1350;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const high = Math.round(row.high ?? row.temp);
  const score = row.score;
  const synopsis = row.synopsis_approved || '';
  const outfit = outfitForWeather(high, row.precip_chance);
  const dateStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long', month: 'long', day: 'numeric'
  }).format(new Date()).toUpperCase();

  // Color bands
  let bgColor, accent;
  if (high >= 75)      { bgColor = '#C4501A'; accent = '#F0C040'; }
  else if (high >= 50) { bgColor = '#2D5A3D'; accent = '#A8D5A2'; }
  else                 { bgColor = '#1C3A5E'; accent = '#89C4E1'; }

  const PAD = 80;

  // Background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);

  // Noise texture overlay
  for (let i = 0; i < 14000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${(Math.random() * 0.05).toFixed(3)})`;
    ctx.fillRect(Math.floor(Math.random() * W), Math.floor(Math.random() * H), 1, 1);
  }

  // Top accent stripe
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 8);

  // Date row
  ctx.textBaseline = 'top';
  ctx.letterSpacing = '3px';

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 40px "IBM Plex Mono"';
  ctx.textAlign = 'left';
  ctx.fillText(dateStr, PAD, 32);

  ctx.fillStyle = accent;
  ctx.textAlign = 'right';
  ctx.fillText(`HIGH ${high}°F`, W - PAD, 32);

  ctx.textAlign = 'left';
  ctx.letterSpacing = '0px';

  // NYC sub-label
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '400 22px "IBM Plex Mono"';
  ctx.letterSpacing = '6px';
  ctx.fillText('NEW YORK CITY', PAD, 84);
  ctx.letterSpacing = '0px';

  // Header divider
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, 122); ctx.lineTo(W - PAD, 122); ctx.stroke();

  // Score (280px centered)
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 280px "Archivo Black"';
  ctx.textBaseline = 'top';
  const scoreText = String(score);
  const scoreW = ctx.measureText(scoreText).width;
  ctx.fillText(scoreText, (W - scoreW) / 2, 148);

  // OUT OF 10
  ctx.fillStyle = accent;
  ctx.font = '400 28px "IBM Plex Mono"';
  ctx.letterSpacing = '7px';
  const outOf = 'OUT OF 10';
  const outOfW = ctx.measureText(outOf).width;
  ctx.fillText(outOf, (W - outOfW) / 2, 420);
  ctx.letterSpacing = '0px';

  // Divider after score
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, 474); ctx.lineTo(W - PAD, 474); ctx.stroke();

  let cursor = 516;

  // TODAY'S MOOD
  if (synopsis) {
    ctx.fillStyle = accent;
    ctx.font = '400 22px "IBM Plex Mono"';
    ctx.letterSpacing = '6px';
    ctx.textBaseline = 'top';
    ctx.fillText("TODAY'S MOOD", PAD, cursor);
    ctx.letterSpacing = '0px';
    cursor += 46;

    ctx.fillStyle = '#ffffff';
    ctx.font = '400 46px "Space Grotesk"';
    const lines = wrapText(ctx, synopsis, PAD, cursor, W - PAD * 2, 62);
    cursor += lines * 62 + 44;

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, cursor); ctx.lineTo(W - PAD, cursor); ctx.stroke();
    cursor += 40;
  }

  // TODAY'S FIT
  ctx.fillStyle = accent;
  ctx.font = '400 22px "IBM Plex Mono"';
  ctx.letterSpacing = '6px';
  ctx.textBaseline = 'top';
  ctx.fillText("TODAY'S FIT", PAD, cursor);
  ctx.letterSpacing = '0px';
  cursor += 46;

  ctx.fillStyle = '#ffffff';
  ctx.font = '400 44px "IBM Plex Mono"';
  wrapText(ctx, outfit.join('  ·  '), PAD, cursor, W - PAD * 2, 60, 3);

  // Footer URL
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '400 24px "IBM Plex Mono"';
  ctx.letterSpacing = '3px';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('CLASSICNEWWEATHER.COM', W / 2, 1310);
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Bottom accent stripe
  ctx.fillStyle = accent;
  ctx.fillRect(0, 1342, W, 8);

  // Export feed PNG
  const feedBuffer = await canvas.encode('png');

  // Build 9:16 story: feed centered on matching bg
  const storyCanvas = createCanvas(1080, 1920);
  const storyCtx = storyCanvas.getContext('2d');
  storyCtx.fillStyle = bgColor;
  storyCtx.fillRect(0, 0, 1080, 1920);
  storyCtx.drawImage(canvas, 0, (1920 - 1350) / 2);
  const storyBuffer = await storyCanvas.encode('png');

  // Upload both in parallel
  const [feedImageUrl, storyImageUrl] = await Promise.all([
    uploadImage(feedBuffer, `${dateKey}-feed.png`),
    uploadImage(storyBuffer, `${dateKey}.png`)
  ]);

  // Save URLs to Supabase
  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/daily?date_key=eq.${encodeURIComponent(dateKey)}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ feed_image_url: feedImageUrl, story_image_url: storyImageUrl })
  });
  if (!patchRes.ok) throw new Error(`Failed to save image URLs: ${await patchRes.text()}`);

  return { feedImageUrl, storyImageUrl };
}

exports.generateAndUpload = generateAndUpload;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let password;
  try {
    ({ password } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bad request' }) };
  }

  if (password !== ADMIN_PW) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const dateKey = toNYCDateKey(new Date());

    const res = await fetch(`${SUPABASE_URL}/rest/v1/daily?date_key=eq.${encodeURIComponent(dateKey)}&select=*`, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    });
    const rows = await res.json();
    if (!rows || rows.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'No weather data for today' }) };
    }

    const { feedImageUrl, storyImageUrl } = await generateAndUpload(rows[0], dateKey);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, feedImageUrl, storyImageUrl })
    };
  } catch (err) {
    console.error('generate-ig-graphic error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
