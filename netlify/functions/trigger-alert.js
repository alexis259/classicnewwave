// netlify/functions/trigger-alert.js
// Manually-triggered weather alert card renderer.
// NEVER runs automatically. Not part of the daily cron pipeline.
//
// POST /api/trigger-alert
// Body: { password, variant: "hot"|"cold"|"storm", temp: number, custom_copy?: string }
// custom_copy overrides the advisory line. Use "/" to split into two lines.

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');

const W = 1080, H = 1350;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PW = process.env.ADMIN_PW;

// ── FONTS ──

function resolveFontPath(filename) {
  for (const dir of [
    path.join(__dirname, 'fonts'),
    path.join(__dirname, 'netlify/functions/fonts')
  ]) {
    const p = path.join(dir, filename);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Font not found: ${filename}`);
}

GlobalFonts.registerFromPath(resolveFontPath('BebasNeue-Regular.woff2'),       'Bebas Neue');
GlobalFonts.registerFromPath(resolveFontPath('BarlowCondensed-Black.woff2'),  'Barlow Condensed BK');
GlobalFonts.registerFromPath(resolveFontPath('IBMPlexMono-Regular.woff2'),    'IBM Plex Mono');
GlobalFonts.registerFromPath(resolveFontPath('IBMPlexMono-Bold.woff2'),       'IBM Plex Mono Bold');

// ── VARIANT CONFIGS ──

const VARIANTS = {
  hot: {
    bg:           '#0d0d0d',
    accent:       '#cc4400',
    badgeBorder:  '#cc4400',
    tickerBg:     '#cc4400',
    pillText:     '#cc4400',
    conditionLabel: 'HOT',
    headline:     'HOT HOT.',
    advisory:     ['THIS MF IS TOO HOT.', 'PLEASE DRINK SOME WATER.'],
    pillTag:      'STAY COOL',
    wmFrom: { r: 204, g: 34,  b: 0  },   // #cc2200 — top
    wmTo:   { r: 17,  g: 34,  b: 0  }    // #112200 — bottom
  },
  cold: {
    bg:           '#0a0d12',
    accent:       '#1a55aa',
    badgeBorder:  '#4a88cc',
    tickerBg:     '#1a3a6a',
    pillText:     '#1a3a6a',
    conditionLabel: 'COLD',
    headline:     'BUNDLE UP.',
    advisory:     ['LAYER UP.', "DON'T PLAY YOURSELF."],
    pillTag:      'STAY WARM',
    wmFrom: { r: 10, g: 26, b: 58  },    // #0a1a3a — top
    wmTo:   { r: 26, g: 85, b: 170 }     // #1a55aa — bottom
  },
  storm: {
    bg:           '#0d0d0f',
    accent:       '#5a4a7a',
    badgeBorder:  '#7a6aaa',
    tickerBg:     '#2a1a4a',
    pillText:     '#2a1a4a',
    conditionLabel: 'STORM',
    headline:     'STAY DRY.',
    advisory:     ["IT'S GONNA GET WET.", 'ACT ACCORDINGLY.'],
    pillTag:      'STAY DRY',
    wmFrom: { r: 26, g: 26, b: 26 },     // #1a1a1a — top
    wmTo:   { r: 42, g: 26, b: 58 }      // #2a1a3a — bottom
  }
};

// ── HELPERS ──

function lerpColor(from, to, t) {
  return {
    r: Math.round(from.r + (to.r - from.r) * t),
    g: Math.round(from.g + (to.g - from.g) * t),
    b: Math.round(from.b + (to.b - from.b) * t)
  };
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,    x + w, y + r,    r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,      y + h, x,      y + h - r, r);
  ctx.lineTo(x,      y + r);
  ctx.arcTo(x,      y,     x + r,  y,         r);
  ctx.closePath();
}

// Binary-search the largest font size where text fits within targetW
function fitFontSize(ctx, text, family, targetW, max = 320) {
  let lo = 40, hi = max;
  while (hi - lo > 1) {
    const mid = Math.round((lo + hi) / 2);
    ctx.font = `400 ${mid}px ${family}`;
    ctx.measureText(text).width <= targetW ? (lo = mid) : (hi = mid);
  }
  return lo;
}

// ── MAIN DRAW ──

async function drawAlertCard(variant, temp, customCopy) {
  const cfg = VARIANTS[variant];
  if (!cfg) throw new Error(`Unknown variant: ${variant}`);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const HEADER_H = 110;
  const TICKER_H = 100;
  const TICKER_Y = H - TICKER_H;         // 1250
  const BOT_H    = 90;
  const BOT_Y    = TICKER_Y - BOT_H;     // 1160
  const BODY_TOP = HEADER_H;             // 110
  const BODY_H   = BOT_Y - BODY_TOP;     // 1050
  const PAD      = 48;

  // ── BACKGROUND ──
  ctx.fillStyle = cfg.bg;
  ctx.fillRect(0, 0, W, H);

  // ── WATERMARK — z=0, full bleed, drawn before all content ──
  // 8 rows of Bebas Neue "WEATHER ALERT" tiled wall-to-wall.
  // Each row gets a different interpolated color stop — no CSS gradient used.
  {
    const WM_SIZE = 128;
    ctx.font = `400 ${WM_SIZE}px "Bebas Neue", "Barlow Condensed BK"`;
    ctx.textBaseline = 'top';
    const tileW = ctx.measureText('WEATHER ALERT').width + 16; // +16 gap between tiles
    const rowH  = H / 8;

    for (let i = 0; i < 8; i++) {
      const t       = i / 7;
      const col     = lerpColor(cfg.wmFrom, cfg.wmTo, t);
      const opacity = 0.20 - t * 0.10;  // 0.20 at top → 0.10 at bottom
      ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},${opacity})`;

      // Alternate rows are shifted left by ~45% of tile width to break up the grid
      const xStart = (i % 2 === 0) ? 0 : -Math.round(tileW * 0.45);
      const yPos   = Math.round(i * rowH) - 10; // slight upward bleed

      for (let x = xStart; x < W + tileW; x += tileW) {
        ctx.fillText('WEATHER ALERT', x, yPos);
      }
    }
  }

  // ── HEADER BAR — z=2 ──
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, W, HEADER_H);

  // Subtle bottom divider
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, HEADER_H); ctx.lineTo(W, HEADER_H); ctx.stroke();

  // Left — wordmark in IBM Plex Mono
  ctx.fillStyle = '#ffffff';
  ctx.font = '400 26px "IBM Plex Mono"';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('classicnewweather', PAD, HEADER_H / 2);

  // Right — WEATHER ALERT filled badge
  const BADGE_W = 240, BADGE_H = 58;
  const badgeX  = W - PAD - BADGE_W;
  const badgeY  = Math.round((HEADER_H - BADGE_H) / 2);
  ctx.fillStyle   = cfg.accent;
  ctx.fillRect(badgeX, badgeY, BADGE_W, BADGE_H);
  ctx.strokeStyle = cfg.badgeBorder;
  ctx.lineWidth   = 2;
  ctx.strokeRect(badgeX, badgeY, BADGE_W, BADGE_H);
  ctx.fillStyle   = '#ffffff';
  ctx.font        = '400 18px "IBM Plex Mono"';
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('WEATHER ALERT', badgeX + BADGE_W / 2, badgeY + BADGE_H / 2);

  // ── BODY — z=2, content block centered vertically ──

  // Advisory lines: custom_copy overrides, "/" splits into two lines
  const advisoryLines = customCopy
    ? customCopy.split('/').map(s => s.trim()).filter(Boolean)
    : cfg.advisory;

  // Auto-size headline and temp to fill ~920px (canvas width minus small margins)
  const DISPLAY_FAMILY = '"Bebas Neue", "Barlow Condensed BK"';
  const DISPLAY_TARGET = W - 80; // 1000px — nearly full bleed
  const headlineSz = fitFontSize(ctx, cfg.headline,        DISPLAY_FAMILY, DISPLAY_TARGET);
  const tempSz     = fitFontSize(ctx, `${temp}° TODAY.`,   DISPLAY_FAMILY, DISPLAY_TARGET);

  const ADV_SZ     = 52;
  const ADV_LINE_H = Math.round(ADV_SZ * 1.5); // 78px

  const GAP_2  = 16;
  const GAP_3  = 28;
  const blockH = headlineSz + GAP_2 + tempSz + GAP_3 + (advisoryLines.length * ADV_LINE_H);
  let cY = BODY_TOP + Math.round((BODY_H - blockH) / 2);

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';

  // Headline — auto-sized Bebas Neue, white
  ctx.fillStyle = '#ffffff';
  ctx.font      = `400 ${headlineSz}px ${DISPLAY_FAMILY}`;
  ctx.fillText(cfg.headline, W / 2, cY);
  cY += headlineSz + GAP_2;

  // Temp line — auto-sized Bebas Neue, muted gray
  ctx.fillStyle = '#aaaaaa';
  ctx.font      = `400 ${tempSz}px ${DISPLAY_FAMILY}`;
  ctx.fillText(`${temp}° TODAY.`, W / 2, cY);
  cY += tempSz + GAP_3;

  // Advisory copy — IBM Plex Mono Bold 52px, white, lineH 1.5
  ctx.fillStyle = '#ffffff';
  ctx.font      = `400 ${ADV_SZ}px "IBM Plex Mono Bold"`;
  for (const line of advisoryLines) {
    ctx.fillText(line, W / 2, cY);
    cY += ADV_LINE_H;
  }

  // ── BOTTOM INFO ROW — full width, pinned above ticker ──
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(PAD, BOT_Y + 12); ctx.lineTo(W - PAD, BOT_Y + 12); ctx.stroke();

  // Use ink bounding box for true vertical centering
  ctx.font = '400 16px "IBM Plex Mono"';
  ctx.textBaseline = 'alphabetic';
  const botM = ctx.measureText('CHECK ON YOUR PEOPLE.');
  const botY = BOT_Y + 12 + (BOT_H - 12) / 2 + (botM.actualBoundingBoxAscent - botM.actualBoundingBoxDescent) / 2;

  ctx.textAlign = 'left';
  ctx.fillStyle = cfg.accent;
  ctx.fillText('▶', PAD, botY);
  const arrowW = ctx.measureText('▶ ').width;
  ctx.fillStyle = '#cccccc';
  ctx.fillText('CHECK ON YOUR PEOPLE.', PAD + arrowW, botY);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#888888';
  ctx.fillText('TAKE CARE OF YOURSELF.', W - PAD, botY);

  // ── TICKER BAR — pinned to bottom ──
  ctx.fillStyle = cfg.tickerBg;
  ctx.fillRect(0, TICKER_Y, W, TICKER_H);

  const TICKER_FONT = '400 18px "IBM Plex Mono"';
  const PILL_FONT   = '400 16px "IBM Plex Mono"';
  const PILL_H      = 38;
  const PILL_PX     = 18;

  // Measure pill text for width, then get ink-center Y for both pill and copy
  ctx.font = PILL_FONT;
  const PILL_W  = ctx.measureText(cfg.pillTag).width + PILL_PX * 2;
  const pillX   = PAD;
  const pillY   = TICKER_Y + Math.round((TICKER_H - PILL_H) / 2);

  ctx.fillStyle = '#ffffff';
  roundRectPath(ctx, pillX, pillY, PILL_W, PILL_H, PILL_H / 2);
  ctx.fill();

  // Pill label — ink-box centered inside pill
  ctx.textBaseline = 'alphabetic';
  const pillM  = ctx.measureText(cfg.pillTag);
  const pillTY = pillY + PILL_H / 2 + (pillM.actualBoundingBoxAscent - pillM.actualBoundingBoxDescent) / 2;
  ctx.fillStyle = cfg.pillText;
  ctx.textAlign = 'center';
  ctx.fillText(cfg.pillTag, pillX + PILL_W / 2, pillTY);

  // Ticker copy — ink-box centered in ticker bar
  ctx.font = TICKER_FONT;
  const tickerCopy = 'DRINK WATER  ·  ENJOY THE DAY  ·  CHECK ON YOUR PEOPLE';
  const tickM  = ctx.measureText(tickerCopy);
  const tickTY = TICKER_Y + TICKER_H / 2 + (tickM.actualBoundingBoxAscent - tickM.actualBoundingBoxDescent) / 2;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.fillText(tickerCopy, pillX + PILL_W + 22, tickTY);

  return canvas;
}

// ── UPLOAD ──

async function uploadAlertImage(buffer, filename) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/story-images/${filename}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey':        SUPABASE_SERVICE_KEY,
      'Content-Type':  'image/png',
      'x-upsert':      'true'
    },
    body: buffer
  });
  if (!res.ok) throw new Error(`Storage upload failed: ${await res.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/story-images/${filename}`;
}

// Exported for local preview script
exports.drawAlertCard = drawAlertCard;

// ── HTTP HANDLER ──

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let password, variant, temp, custom_copy;
  try {
    ({ password, variant, temp, custom_copy } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bad request' }) };
  }

  if (password !== ADMIN_PW) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (!['hot', 'cold', 'storm'].includes(variant)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'variant must be "hot", "cold", or "storm"' })
    };
  }

  const parsedTemp = Number(temp);
  if (!Number.isFinite(parsedTemp)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'temp must be a number' }) };
  }

  try {
    const canvas   = await drawAlertCard(variant, parsedTemp, custom_copy || null);
    const buffer   = await canvas.encode('png');
    const filename = `alert-${variant}-${Date.now()}.png`;
    const imageUrl = await uploadAlertImage(buffer, filename);

    console.log(`trigger-alert: ${variant} alert at ${parsedTemp}° → ${imageUrl}`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, variant, temp: parsedTemp, imageUrl })
    };
  } catch (err) {
    console.error('trigger-alert error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
