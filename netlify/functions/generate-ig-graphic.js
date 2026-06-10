// netlify/functions/generate-ig-graphic.js
// 6 branded IG templates: daily, weekly, alert, hair, teaser, dashboard

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');

const W = 1080, H = 1350;
const BG = '#0a0a0a';
const ACCENT = '#CC3300';
const INSET = 18;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PW = process.env.ADMIN_PW;

function loadFont(filename) {
  for (const dir of [path.join(__dirname, 'fonts'), path.join(__dirname, 'netlify/functions/fonts')]) {
    try { return fs.readFileSync(path.join(dir, filename)); } catch {}
  }
  throw new Error(`Font not found: ${filename}`);
}

GlobalFonts.register(loadFont('VT323.woff2'), 'VT323');
GlobalFonts.register(loadFont('ShareTechMono.woff2'), 'Share Tech Mono');
GlobalFonts.register(loadFont('BarlowCondensed-Bold.woff2'), 'Barlow Condensed');
GlobalFonts.register(loadFont('BarlowCondensed-ExtraBold.woff2'), 'Barlow Condensed XB');
GlobalFonts.register(loadFont('BarlowCondensed-Black.woff2'), 'Barlow Condensed BK');

// ── DATA HELPERS ──

function toNYCDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(date);
}

function getNYCDay(d = new Date()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' }).format(d).toUpperCase();
}

function getNYCDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric'
  }).format(d).toUpperCase();
}

function getNYCShortDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', month: 'long', day: 'numeric'
  }).format(d).toUpperCase();
}

function outfitItems(temp, rain) {
  const pieces = [];
  if (temp < 40) pieces.push('HEAVY COAT');
  else if (temp < 50) pieces.push('JACKET');
  else if (temp < 60) pieces.push('LIGHT JACKET');
  else if (temp < 68) pieces.push('LAYER UP');
  pieces.push(temp < 40 ? 'SWEATER' : temp < 55 ? 'HOODIE' : temp < 68 ? 'LONG SLEEVE' : 'TEE');
  pieces.push(temp < 45 ? 'SWEATS' : temp < 65 ? 'JEANS' : 'SHORTS');
  pieces.push(temp < 35 || rain > 60 ? 'WATERPROOF BOOTS' : temp < 55 ? 'BOOTS' : 'SNEAKERS');
  if (temp < 32) pieces.push('HAT + GLOVES');
  else if (temp < 42) pieces.push('BEANIE');
  if (rain > 30) pieces.push('UMBRELLA');
  return pieces;
}

function getHairStatus(humidity, rain) {
  if (humidity >= 80 || rain > 60) return { level: 'SILK PRESS WARNING', color: '#E8C500', sub: 'PROCEED AT YOUR OWN RISK.', rec: 'PUFF  •  BRAIDS  •  BUN' };
  if (humidity >= 70 || rain > 40)  return { level: 'HIGH HUMIDITY ALERT',  color: '#E88000', sub: 'MONITOR CLOSELY.',          rec: 'WASH & GO  •  PROTECTIVE STYLE' };
  if (humidity >= 55 || rain > 25)  return { level: 'PROCEED WITH CAUTION', color: '#C8A000', sub: 'PRODUCT RECOMMENDED.',       rec: 'ANTI-HUMIDITY SPRAY  •  BRAID OUT' };
  return                                    { level: 'WASH & GO APPROVED',   color: '#5AAA40', sub: "YOU'RE GOOD.",               rec: 'SILK PRESS  •  BLOWOUT  •  ANY STYLE' };
}

function getOutsideMeter(score) {
  if (score >= 8) return { label: 'WE OUTSIDE.', sub: 'Go enjoy it.', pct: 1.0, color: '#3AAA50' };
  if (score >= 6) return { label: 'GO FOR IT.',  sub: 'Conditions solid.', pct: 0.75, color: '#8AAA20' };
  if (score >= 4) return { label: 'PROCEED W/ CAUTION.', sub: 'Layer up.', pct: 0.5, color: '#C8A000' };
  if (score >= 2) return { label: 'THINK ABOUT IT.', sub: 'Not the move.', pct: 0.28, color: '#E87000' };
  return                  { label: 'STAY IN.', sub: 'For real.', pct: 0.08, color: '#CC2200' };
}

function conditionEmoji(c) {
  const s = (c || '').toLowerCase();
  if (s.includes('thunder')) return '⛈';
  if (s.includes('rain') || s.includes('drizzle')) return '🌧';
  if (s.includes('snow')) return '❄';
  if (s.includes('fog') || s.includes('mist') || s.includes('haze')) return '🌫';
  if (s.includes('cloud')) return '⛅';
  return '☀';
}

function conditionLabel(c) {
  const s = (c || '').toLowerCase();
  if (s.includes('thunder')) return 'THUNDERSTORM';
  if (s.includes('drizzle')) return 'DRIZZLE';
  if (s.includes('rain')) return 'RAIN';
  if (s.includes('snow')) return 'SNOW';
  if (s.includes('fog') || s.includes('mist')) return 'FOGGY';
  if (s.includes('cloud')) return 'CLOUDY';
  return 'CLEAR SKIES';
}

function getAlertData(row) {
  const high = Math.round(row.high ?? row.temp);
  const c = (row.condition || '').toLowerCase();
  if (c.includes('thunder')) return { type: 'STORM', headline: 'STORM WATCH.', temp: `${high}° TODAY.`, warn1: 'STAY INSIDE.', warn2: 'WATCH THE SKIES.' };
  if (high > 92)             return { type: 'HOT',   headline: 'HOT HOT.',     temp: `${high}° TODAY.`, warn1: 'DRINK WATER.', warn2: "DON'T BE A HERO." };
  if (high < 20)             return { type: 'BRUTAL',headline: 'BRUTAL OUT.',  temp: `${high}° TODAY.`, warn1: 'STAY WARM.', warn2: 'FOR REAL.' };
  if (high < 32)             return { type: 'FREEZE',headline: 'FREEZING.',    temp: `${high}° TODAY.`, warn1: 'BUNDLE UP.', warn2: 'PROTECT YOUR PEOPLE.' };
  if ((row.wind_speed||0) > 25) return { type: 'WIND', headline: 'GUSTY.',     temp: `${Math.round(row.wind_speed)} MPH WINDS.`, warn1: 'HOLD YOUR HAT.', warn2: 'WIND IS SERIOUS.' };
  if (row.precip_chance > 70) return { type: 'RAIN', headline: 'RAIN.',        temp: `${row.precip_chance}% CHANCE.`, warn1: 'PACK AN UMBRELLA.', warn2: 'OR GET WET.' };
  return                             { type: 'HOT',   headline: 'HOT HOT.',     temp: `${high}° TODAY.`, warn1: 'DRINK WATER.', warn2: "DON'T BE A HERO." };
}

function wrapText(ctx, text, x, y, maxW, lineH, maxLines = Infinity) {
  const words = text.split(' ');
  let line = '', lines = [];
  for (let n = 0; n < words.length; n++) {
    const test = line + words[n] + ' ';
    if (ctx.measureText(test).width > maxW && n > 0) {
      lines.push(line.trim());
      line = words[n] + ' ';
      if (lines.length >= maxLines) break;
    } else { line = test; }
  }
  if (lines.length < maxLines) lines.push(line.trim());
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineH));
  return lines.length;
}

// ── DRAWING PRIMITIVES ──

function scanlines(ctx) {
  for (let y = 0; y < H; y += 4) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, y, W, 1);
  }
}

function border(ctx, color = ACCENT, inset = INSET, lw = 3) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.strokeRect(inset + lw / 2, inset + lw / 2, W - inset * 2 - lw, H - inset * 2 - lw);
}

function hline(ctx, y, color = '#222', lw = 1, x0 = INSET + 20, x1 = W - INSET - 20) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
}

function ticker(ctx, text, color = ACCENT) {
  const y = H - 52, h = 52;
  ctx.fillStyle = color;
  ctx.fillRect(0, y, W, h);
  ctx.fillStyle = '#fff';
  ctx.font = '500 21px "Share Tech Mono"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, y + h / 2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
}

function logo(ctx, x, y, scale = 1) {
  const sw = Math.round(48 * scale), sh = Math.round(44 * scale);
  const cx = x + sw / 2, cy = y + sh;

  // Retro sun — bottom half-circle
  const grad = ctx.createLinearGradient(cx, cy - sw / 2, cx, cy);
  grad.addColorStop(0, '#F0B800'); grad.addColorStop(1, '#CC4400');
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, sw / 2, Math.PI, 0); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  // Stripe cuts
  ctx.fillStyle = BG;
  const r = sw / 2, strH = Math.round(2.5 * scale);
  [0.28, 0.55, 0.78].forEach(t => {
    const sy = cy - r + r * t;
    if (sy > cy - r && sy < cy) ctx.fillRect(cx - r, sy - strH / 2, r * 2, strH);
  });
  // Bridge towers
  const tw = Math.round(4 * scale), th = Math.round(14 * scale);
  ctx.fillStyle = '#777';
  ctx.fillRect(cx - r * 0.5 - tw / 2, cy - r - th, tw, th);
  ctx.fillRect(cx + r * 0.5 - tw / 2, cy - r - th, tw, th);
  // Cable arc
  ctx.strokeStyle = '#555'; ctx.lineWidth = Math.round(1.5 * scale);
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.5, cy - r);
  ctx.quadraticCurveTo(cx, cy - r - th * 0.55, cx + r * 0.5, cy - r);
  ctx.stroke();
  ctx.restore();

  // Text
  const tx = x + sw + Math.round(10 * scale);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.round(21 * scale)}px "Barlow Condensed"`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('classic', tx, y + Math.round(2 * scale));
  ctx.font = `700 ${Math.round(19 * scale)}px "Barlow Condensed"`;
  ctx.fillText('newweather', tx, y + Math.round(24 * scale));
}

function dateBadge(ctx, x, y, day, dateStr, accentColor = ACCENT) {
  const bw = 230, bh = 64;
  ctx.strokeStyle = accentColor; ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, bw, bh);
  ctx.fillStyle = accentColor;
  ctx.font = '700 18px "Barlow Condensed"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(day, x + bw / 2, y + 8);
  ctx.fillStyle = '#aaa';
  ctx.font = '400 13px "Share Tech Mono"';
  ctx.fillText(dateStr, x + bw / 2, y + 32);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
}

function semiGauge(ctx, cx, cy, r, pct, meterColor) {
  ctx.lineCap = 'round';
  // Track
  ctx.strokeStyle = '#222'; ctx.lineWidth = 12;
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0); ctx.stroke();
  // Value
  const angle = Math.PI + pct * Math.PI;
  ctx.strokeStyle = meterColor; ctx.lineWidth = 12;
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, angle); ctx.stroke();
  // Needle tip
  const nx = cx + Math.cos(angle) * r, ny = cy + Math.sin(angle) * r;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(nx, ny, 5, 0, Math.PI * 2); ctx.fill();
  // Center
  ctx.fillStyle = '#333';
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
}

function panel(ctx, x, y, w, h, label, accentColor = ACCENT) {
  ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#111'; ctx.fillRect(x + 1, y + 1, w - 2, 18);
  ctx.fillStyle = accentColor;
  ctx.font = '700 11px "Share Tech Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 8, y + 9);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
}

// Pixel-art weather icon (condition: 'sun'|'cloud'|'rain'|'snow'|'storm'|'fog')
function weatherIcon(ctx, cx, cy, size, condition) {
  const r = size / 2;
  const c = (condition || '').toLowerCase();
  ctx.save();
  if (c.includes('thunder') || c.includes('storm')) {
    // Dark cloud + yellow bolt
    ctx.fillStyle = '#555';
    ctx.beginPath(); ctx.ellipse(cx - r * 0.1, cy - r * 0.2, r * 0.7, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#F0C000';
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.1, cy - r * 0.2);
    ctx.lineTo(cx - r * 0.2, cy + r * 0.3);
    ctx.lineTo(cx, cy + r * 0.1);
    ctx.lineTo(cx - r * 0.3, cy + r * 0.7);
    ctx.lineTo(cx + r * 0.3, cy + r * 0.1);
    ctx.lineTo(cx + r * 0.1, cy + r * 0.3);
    ctx.closePath(); ctx.fill();
  } else if (c.includes('rain') || c.includes('drizzle')) {
    ctx.fillStyle = '#888';
    ctx.beginPath(); ctx.ellipse(cx, cy - r * 0.15, r * 0.7, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5599EE'; ctx.lineWidth = Math.max(2, size * 0.06); ctx.lineCap = 'round';
    [[-0.3, 0.2], [0, 0.3], [0.3, 0.2]].forEach(([dx, dy]) => {
      ctx.beginPath();
      ctx.moveTo(cx + dx * r, cy + dy * r);
      ctx.lineTo(cx + (dx - 0.12) * r, cy + (dy + 0.4) * r);
      ctx.stroke();
    });
  } else if (c.includes('snow')) {
    ctx.strokeStyle = '#aaddf8'; ctx.lineWidth = Math.max(2, size * 0.06); ctx.lineCap = 'round';
    [[0, -1], [1, 0], [0, 1], [-1, 0], [0.7, -0.7], [0.7, 0.7], [-0.7, 0.7], [-0.7, -0.7]].forEach(([dx, dy]) => {
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + dx * r * 0.7, cy + dy * r * 0.7); ctx.stroke();
    });
  } else if (c.includes('fog') || c.includes('mist') || c.includes('haze')) {
    ctx.strokeStyle = '#888'; ctx.lineWidth = Math.max(3, size * 0.08); ctx.lineCap = 'round';
    [-0.35, -0.05, 0.25].forEach(dy => {
      ctx.beginPath(); ctx.moveTo(cx - r * 0.7, cy + dy * r); ctx.lineTo(cx + r * 0.7, cy + dy * r); ctx.stroke();
    });
  } else if (c.includes('cloud')) {
    ctx.fillStyle = '#888';
    ctx.beginPath(); ctx.ellipse(cx - r * 0.2, cy, r * 0.55, r * 0.38, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + r * 0.25, cy + r * 0.05, r * 0.45, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx - r * 0.05, cy - r * 0.2, r * 0.4, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    // Sun — circle + rays
    ctx.fillStyle = '#F0B800';
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#F0B800'; ctx.lineWidth = Math.max(2, size * 0.07); ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const inner = r * 0.55, outer = r * 0.88;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ── TEMPLATE 1: DAILY ──

async function drawDaily(row) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const high = Math.round(row.high ?? row.temp);
  const score = row.score;
  const synopsis = row.synopsis_approved || '';
  const outfit = outfitItems(high, row.precip_chance);
  const day = getNYCDay(), dateStr = getNYCDate();

  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  scanlines(ctx);
  border(ctx);

  // Header
  const hY = INSET;
  ctx.fillStyle = '#0f0f0f';
  ctx.fillRect(INSET, hY, W - INSET * 2, 84);
  hline(ctx, hY + 84, '#222', 1, INSET, W - INSET);
  logo(ctx, INSET + 22, hY + 12, 1.3);
  dateBadge(ctx, W - INSET - 245, hY + 10, day, dateStr);

  // City name
  ctx.fillStyle = ACCENT;
  ctx.font = '400 112px "Barlow Condensed BK"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('NEW YORK CITY', W / 2, hY + 100);

  // High temp
  ctx.fillStyle = '#555';
  ctx.font = '400 24px "Share Tech Mono"';
  ctx.fillText(`HIGH ${high}°F`, W / 2, hY + 218);

  // Score — big VT323
  ctx.fillStyle = ACCENT;
  ctx.font = '400 420px "VT323"';
  ctx.fillText(String(score), W / 2, hY + 238);

  // Out of 10 — tight under score
  ctx.fillStyle = '#444';
  ctx.font = '400 22px "Share Tech Mono"';
  ctx.fillText('OUT OF 10', W / 2, hY + 494);

  hline(ctx, hY + 524, '#222', 1);

  ctx.textAlign = 'left'; ctx.textBaseline = 'top';

  // TODAY'S MOOD
  const p1y = hY + 548, pw = W - INSET * 2 - 40, px = INSET + 20;
  panel(ctx, px, p1y, pw, 280, "TODAY'S MOOD");
  weatherIcon(ctx, px + pw - 44, p1y + 46, 54, row.condition);
  ctx.fillStyle = '#ddd';
  ctx.font = '400 27px "Share Tech Mono"';
  ctx.textBaseline = 'top';
  wrapText(ctx, synopsis || 'check classicnewweather.com', px + 12, p1y + 26, pw - 80, 36, 5);

  // TODAY'S FIT
  const p2y = p1y + 296;
  panel(ctx, px, p2y, pw, 280, "TODAY'S FIT");
  ctx.fillStyle = '#ddd';
  ctx.font = '400 27px "Share Tech Mono"';
  wrapText(ctx, outfit.join('  ·  '), px + 12, p2y + 26, pw - 24, 36, 5);

  // URL line
  ctx.fillStyle = '#2a2a2a';
  ctx.font = '400 18px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('classicnewweather.com', W / 2, p2y + 300);

  ticker(ctx, 'STAY COOL  ·  DRINK WATER  ·  ENJOY THE DAY');

  return canvas;
}

// ── TEMPLATE 2: WEEKLY ──

async function drawWeekly(row) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const high = Math.round(row.high ?? row.temp);
  const score = row.score;
  const synopsis = row.synopsis_approved || '';
  const outfit = outfitItems(high, row.precip_chance);
  const hair = getHairStatus(row.humidity, row.precip_chance);
  const meter = getOutsideMeter(score);
  const forecast = Array.isArray(row.forecast) ? row.forecast.slice(0, 5) : [];
  const day = getNYCDay(), dateStr = getNYCDate();

  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  scanlines(ctx);
  border(ctx);

  // Header
  ctx.fillStyle = '#0f0f0f';
  ctx.fillRect(INSET, INSET, W - INSET * 2, 80);
  hline(ctx, INSET + 80, '#222', 1, INSET, W - INSET);
  logo(ctx, INSET + 22, INSET + 12, 1.2);

  // "LOCAL FORECAST" badge
  const lfx = W / 2 - 90;
  ctx.fillStyle = ACCENT;
  ctx.font = '700 14px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('LOCAL FORECAST', W / 2, INSET + 44);

  dateBadge(ctx, W - INSET - 232, INSET + 8, day, dateStr);

  // City + high
  ctx.fillStyle = ACCENT;
  ctx.font = '400 88px "Barlow Condensed BK"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('NEW YORK CITY', W / 2, INSET + 92);

  ctx.fillStyle = '#666';
  ctx.font = '400 22px "Share Tech Mono"';
  ctx.fillText(`HIGH ${high}°F`, W / 2, INSET + 183);

  // Score + condition icon — side by side
  ctx.fillStyle = ACCENT;
  ctx.font = '400 180px "VT323"';
  ctx.textAlign = 'right';
  ctx.fillText(String(score), W / 2 - 20, INSET + 196);

  weatherIcon(ctx, W / 2 + 74, INSET + 258, 90, row.condition);

  ctx.fillStyle = '#888';
  ctx.font = '400 16px "Share Tech Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(conditionLabel(row.condition), W / 2 + 24, INSET + 322);
  ctx.fillStyle = '#444';
  ctx.fillText('OUT OF 10', W / 2 - 160, INSET + 374);

  hline(ctx, INSET + 400, '#222', 1);

  // 4-panel row
  const panW = (W - INSET * 2 - 40 - 9) / 4;
  const panH = 230;
  const panY = INSET + 414;
  const panX0 = INSET + 20;
  const cols = [panX0, panX0 + panW + 3, panX0 + (panW + 3) * 2, panX0 + (panW + 3) * 3];

  // TODAY'S MOOD
  panel(ctx, cols[0], panY, panW, panH, "TODAY'S MOOD");
  ctx.fillStyle = '#ccc'; ctx.font = '400 16px "Share Tech Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  wrapText(ctx, synopsis || '—', cols[0] + 6, panY + 22, panW - 12, 22, 6);

  // FIT CHECK
  panel(ctx, cols[1], panY, panW, panH, 'FIT CHECK');
  ctx.fillStyle = '#ccc'; ctx.font = '400 16px "Share Tech Mono"';
  wrapText(ctx, outfit.slice(0, 4).join('\n'), cols[1] + 6, panY + 22, panW - 12, 22, 6);

  // HAIR REPORT
  panel(ctx, cols[2], panY, panW, panH, 'HAIR REPORT');
  ctx.fillStyle = hair.color; ctx.font = '700 14px "Share Tech Mono"';
  wrapText(ctx, hair.level, cols[2] + 6, panY + 22, panW - 12, 18, 3);
  ctx.fillStyle = '#888'; ctx.font = '400 13px "Share Tech Mono"';
  ctx.fillText(`HUM: ${row.humidity}%`, cols[2] + 6, panY + 80);
  wrapText(ctx, hair.sub, cols[2] + 6, panY + 100, panW - 12, 18, 3);

  // OUTSIDE METER
  panel(ctx, cols[3], panY, panW, panH, 'OUTSIDE METER');
  semiGauge(ctx, cols[3] + panW / 2, panY + 120, panW / 2 - 10, meter.pct, meter.color);
  ctx.fillStyle = meter.color; ctx.font = '700 13px "Barlow Condensed"';
  ctx.textAlign = 'center';
  ctx.fillText(meter.label, cols[3] + panW / 2, panY + 148);
  ctx.fillStyle = '#666'; ctx.font = '400 12px "Share Tech Mono"';
  ctx.fillText(meter.sub, cols[3] + panW / 2, panY + 164);

  hline(ctx, panY + panH + 16, '#222', 1);

  // WEEK AHEAD strip
  const wkY = panY + panH + 30;
  ctx.fillStyle = '#555'; ctx.font = '700 13px "Share Tech Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('THE CULTURE\'S WEATHER CHANNEL', INSET + 20, wkY);
  ctx.fillStyle = ACCENT; ctx.font = '700 13px "Share Tech Mono"';
  ctx.fillText('WEEK AHEAD', W - INSET - 140, wkY);

  const dayW = (W - INSET * 2 - 40) / 5;
  forecast.forEach((f, i) => {
    const fx = INSET + 20 + i * dayW;
    const fy = wkY + 24;
    ctx.fillStyle = '#888'; ctx.font = '700 14px "Share Tech Mono"';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(f.day.toUpperCase(), fx + dayW / 2, fy);
    weatherIcon(ctx, fx + dayW / 2, fy + 34, 40, f.rain > 50 ? 'rain' : 'clear');
    ctx.fillStyle = '#ddd'; ctx.font = '700 22px "Barlow Condensed"';
    ctx.fillText(`${Math.round(f.high)}°`, fx + dayW / 2, fy + 68);
    ctx.fillStyle = f.rain > 30 ? '#5599dd' : '#555'; ctx.font = '400 13px "Share Tech Mono"';
    ctx.fillText(f.rain > 0 ? `${f.rain}%` : 'dry', fx + dayW / 2, fy + 93);
  });

  hline(ctx, wkY + 120, '#222', 1);

  // Bottom crawl
  ctx.textAlign = 'left';
  ctx.fillStyle = '#333'; ctx.font = '400 14px "Share Tech Mono"';
  ctx.textBaseline = 'top';
  ctx.fillText('>>> STAY COOL  ·  DRINK WATER  ·  ENJOY THE DAY  ·  CHECK ON YOUR PEOPLE  >>>', INSET + 20, wkY + 130);

  // Statement block — fills remaining vertical space
  hline(ctx, wkY + 160, '#1a1a1a', 1);
  ctx.fillStyle = ACCENT;
  ctx.font = '400 196px "Barlow Condensed BK"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('ALL NYC.', W / 2, wkY + 174);
  ctx.fillStyle = '#1c1c1c';
  ctx.font = '400 156px "Barlow Condensed BK"';
  ctx.fillText('ALL WEATHER.', W / 2, wkY + 372);
  ctx.fillStyle = '#333';
  ctx.font = '400 16px "Share Tech Mono"';
  ctx.fillText('classicnewweather.com', W / 2, wkY + 548);

  ticker(ctx, 'STAY COOL  ·  DRINK WATER  ·  ENJOY THE DAY  ·  START YOUR WEEK RIGHT');

  return canvas;
}

// ── TEMPLATE 3: WEATHER ALERT ──

async function drawAlert(row) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const alert = getAlertData(row);

  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);

  // Watermark — repeated "WEATHER ALERT" text in dark reds
  const watermarks = ['#3A0000', '#2A0000', '#1A0000', '#450000', '#280000'];
  ctx.font = '400 72px "Barlow Condensed BK"';
  ctx.textBaseline = 'top';
  for (let row_i = 0; row_i < 14; row_i++) {
    ctx.fillStyle = watermarks[row_i % watermarks.length];
    ctx.textAlign = row_i % 2 === 0 ? 'left' : 'center';
    ctx.fillText('WEATHER ALERT', row_i % 2 === 0 ? -20 : W / 2, row_i * 96 - 20);
  }

  scanlines(ctx);
  border(ctx, '#880000');

  // Header
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(INSET, INSET, W - INSET * 2, 80);
  hline(ctx, INSET + 80, '#330000', 1, INSET, W - INSET);
  logo(ctx, INSET + 22, INSET + 14, 1.2);

  // WEATHER ALERT badge
  ctx.fillStyle = '#CC0000';
  ctx.fillRect(W - INSET - 200, INSET + 16, 186, 46);
  ctx.fillStyle = '#fff';
  ctx.font = '700 16px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('WEATHER ALERT', W - INSET - 200 + 93, INSET + 39);

  // Main content — centered
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';

  // Type line
  ctx.fillStyle = '#CC0000';
  ctx.font = '700 18px "Share Tech Mono"';
  ctx.fillText(alert.type, W / 2, INSET + 120);

  // BIG headline
  ctx.fillStyle = '#ffffff';
  ctx.font = '400 164px "Barlow Condensed BK"';
  ctx.fillText(alert.headline, W / 2, INSET + 148);

  // Temperature
  ctx.fillStyle = '#888';
  ctx.font = '400 120px "Barlow Condensed BK"';
  ctx.fillText(alert.temp, W / 2, INSET + 308);

  hline(ctx, INSET + 460, '#330000', 2, INSET, W - INSET);

  // Warning lines
  ctx.fillStyle = '#ffffff';
  ctx.font = '400 100px "Barlow Condensed BK"';
  ctx.fillText(alert.warn1, W / 2, INSET + 480);
  ctx.fillStyle = '#cccccc';
  ctx.fillText(alert.warn2, W / 2, INSET + 582);

  hline(ctx, INSET + 710, '#330000', 1, INSET, W - INSET);

  // Bottom two-column
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = '400 28px "Share Tech Mono"';
  ctx.fillText('> CHECK ON', INSET + 30, INSET + 730);
  ctx.fillText('  YOUR PEOPLE.', INSET + 30, INSET + 762);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#888';
  ctx.font = '400 22px "Share Tech Mono"';
  ctx.fillText('WEATHER IS JUST', W - INSET - 30, INSET + 730);
  ctx.fillText('THE BEGINNING.', W - INSET - 30, INSET + 756);
  weatherIcon(ctx, W - INSET - 55, INSET + 808, 56, row.condition);

  ticker(ctx, 'STAY COOL  ·  DRINK WATER  ·  ENJOY THE DAY  ·  CHECK ON YOUR PEOPLE', '#880000');

  return canvas;
}

// ── TEMPLATE 4: HAIR FORECAST ──

async function drawHair(row) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const hair = getHairStatus(row.humidity, row.precip_chance);
  const day = getNYCDay(), shortDate = getNYCShortDate();
  const HAIR_ACCENT = '#8B9E2A';

  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  scanlines(ctx);
  border(ctx, HAIR_ACCENT);

  // Header
  ctx.fillStyle = '#0d110a';
  ctx.fillRect(INSET, INSET, W - INSET * 2, 80);
  hline(ctx, INSET + 80, '#2a3318', 1, INSET, W - INSET);
  logo(ctx, INSET + 22, INSET + 14, 1.2);

  // HAIR FORECAST badge
  ctx.fillStyle = HAIR_ACCENT;
  ctx.fillRect(W / 2 - 120, INSET + 16, 240, 46);
  ctx.fillStyle = '#000';
  ctx.font = '700 16px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('HAIR FORECAST', W / 2, INSET + 39);

  ctx.fillStyle = '#888';
  ctx.font = '400 14px "Share Tech Mono"';
  ctx.fillText(`${day.slice(0, 3).toUpperCase()}  ·  ${shortDate.split(',')[0]}`, W / 2, INSET + 70);

  // Left panel (text content) — 60% width
  const leftW = Math.round(W * 0.58) - INSET;
  const leftX = INSET + 20;
  const contentY = INSET + 110;

  // Status level
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillStyle = hair.color;
  ctx.font = '400 76px "Barlow Condensed BK"';
  wrapText(ctx, hair.level, leftX, contentY, leftW - 20, 78, 2);

  hline(ctx, contentY + 170, '#2a3318', 1, leftX, leftX + leftW - 20);

  ctx.fillStyle = '#888';
  ctx.font = '700 14px "Share Tech Mono"';
  ctx.fillText('HUMIDITY:', leftX, contentY + 186);

  ctx.fillStyle = hair.color;
  ctx.font = '400 100px "VT323"';
  ctx.fillText(`${row.humidity}%`, leftX, contentY + 208);

  ctx.fillStyle = '#aaa';
  ctx.font = '400 20px "Share Tech Mono"';
  ctx.fillText(hair.sub, leftX, contentY + 308);

  hline(ctx, contentY + 360, '#2a3318', 1, leftX, leftX + leftW - 20);

  ctx.fillStyle = HAIR_ACCENT;
  ctx.font = '700 13px "Share Tech Mono"';
  ctx.fillText('ALTERNATIVE RECOMMENDATION:', leftX, contentY + 378);

  ctx.fillStyle = '#ddd';
  ctx.font = '400 22px "Share Tech Mono"';
  wrapText(ctx, hair.rec, leftX, contentY + 400, leftW - 20, 28, 2);

  // Rain chance
  hline(ctx, contentY + 460, '#2a3318', 1, leftX, leftX + leftW - 20);
  ctx.fillStyle = '#555';
  ctx.font = '700 13px "Share Tech Mono"';
  ctx.fillText(`RAIN: ${row.precip_chance}%  ·  WIND: ${row.wind_speed || 0} MPH`, leftX, contentY + 476);

  // THE VERDICT — big accent block lower left
  hline(ctx, contentY + 530, '#2a3318', 1, leftX, leftX + leftW - 20);
  ctx.fillStyle = '#1a2010';
  ctx.fillRect(leftX, contentY + 546, leftW - 20, 480);
  ctx.fillStyle = HAIR_ACCENT;
  ctx.font = '700 13px "Share Tech Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('THE VERDICT:', leftX + 8, contentY + 560);
  ctx.fillStyle = hair.color;
  ctx.font = '400 136px "Barlow Condensed BK"';
  wrapText(ctx, hair.level, leftX + 8, contentY + 578, leftW - 36, 140, 3);
  ctx.fillStyle = '#333';
  ctx.font = '400 15px "Share Tech Mono"';
  ctx.fillText('classicnewweather.com', leftX + 8, contentY + 988);

  // Right panel — decorative
  const rightX = INSET + leftW + 28;
  const rightW = W - INSET * 2 - leftW - 36;
  const rightH = H - INSET * 2 - 80 - 52;
  ctx.fillStyle = '#0d110a';
  ctx.fillRect(rightX, INSET + 90, rightW, rightH);
  ctx.strokeStyle = '#2a3318'; ctx.lineWidth = 1;
  ctx.strokeRect(rightX, INSET + 90, rightW, rightH);

  // Decorative panel — humidity bar + wavy texture lines
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const rcx = rightX + rightW / 2;
  // Humidity arc gauge — constrained to panel
  const hairGaugeR = Math.min(rightW / 2 - 20, 80);
  const hairGaugeCy = INSET + 90 + hairGaugeR + 22;
  semiGauge(ctx, rcx, hairGaugeCy, hairGaugeR, Math.min(row.humidity / 100, 1), hair.color);
  ctx.fillStyle = hair.color;
  ctx.font = '400 56px "VT323"';
  ctx.fillText(`${row.humidity}%`, rcx, hairGaugeCy + 8);
  ctx.fillStyle = '#555';
  ctx.font = '700 11px "Share Tech Mono"';
  ctx.fillText('HUMIDITY', rcx, INSET + 276);
  // Wavy texture lines suggesting hair — fill most of right panel
  ctx.save();
  const waveColors = [hair.color, '#555', '#444', '#555', hair.color, '#333', '#444'];
  for (let wi = 0; wi < 26; wi++) {
    const wy = INSET + 310 + wi * 34;
    ctx.strokeStyle = waveColors[wi % waveColors.length];
    ctx.lineWidth = wi % 2 === 0 ? 2.5 : 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const amp = 6 + (wi % 3) * 3;
    const freq = 3 + (wi % 2);
    const x0 = rightX + 12, x1 = rightX + rightW - 12;
    for (let xi = 0; xi <= 40; xi++) {
      const xp = x0 + (xi / 40) * (x1 - x0);
      const yp = wy + Math.sin((xi / 40) * Math.PI * freq) * amp;
      xi === 0 ? ctx.moveTo(xp, yp) : ctx.lineTo(xp, yp);
    }
    ctx.stroke();
  }
  ctx.restore();

  // Footer
  const footerY = H - INSET - 110;
  hline(ctx, footerY, '#2a3318', 1, INSET, W - INSET);
  ctx.fillStyle = '#666'; ctx.font = '400 14px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('STAY SMOOTH.   ·   CHECK THE FORECAST.   ·   RESPECT THE WEATHER.', W / 2, footerY + 12);
  ctx.fillStyle = '#444';
  ctx.font = '400 12px "Share Tech Mono"';
  ctx.fillText("THE CULTURE'S WEATHER CHANNEL  ·  CLASSICNEWWEATHER.COM", W / 2, footerY + 34);

  ticker(ctx, 'STAY SMOOTH  ·  CHECK THE FORECAST  ·  RESPECT THE WEATHER', HAIR_ACCENT);

  return canvas;
}

// ── TEMPLATE 5: TEASER / TECHNICAL DIFFICULTIES ──

async function drawTeaser(row) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // SMPTE color bars — 7 vertical stripes
  const bars = ['#C0C0C0', '#C0C000', '#00C0C0', '#00C000', '#C000C0', '#C00000', '#0000C0'];
  const barW = W / bars.length;
  bars.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(i * barW, 0, barW, H * 0.72);
  });
  // Bottom section — darker reversed bars
  const bBars = ['#0000C0', '#0a0a0a', '#C000C0', '#0a0a0a', '#00C0C0', '#0a0a0a', '#C0C0C0'];
  bBars.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(i * barW, H * 0.72, barW, H * 0.23);
  });
  // Very bottom black strip
  ctx.fillStyle = '#000';
  ctx.fillRect(0, H * 0.95, W, H * 0.05);

  // CRT grain overlay
  for (let i = 0; i < 18000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${(Math.random() * 0.35).toFixed(3)})`;
    ctx.fillRect(Math.floor(Math.random() * W), Math.floor(Math.random() * H), 1, 1);
  }
  // Scanlines
  for (let y = 0; y < H; y += 3) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, y, W, 1);
  }

  // Dark overlay in center for text readability
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 0, W, H);

  // Main text block
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.strokeStyle = '#000'; ctx.lineWidth = 8; ctx.lineJoin = 'round';

  const lines1 = ['PLEASE STAND BY', 'WE ARE EXPERIENCING', 'TECHNICAL DIFFICULTIES'];
  const sizes = [118, 90, 82];
  let ty = 140;
  lines1.forEach((line, i) => {
    ctx.font = `400 ${sizes[i]}px "Barlow Condensed BK"`;
    ctx.strokeText(line, W / 2, ty);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(line, W / 2, ty);
    ty += sizes[i] + 14;
  });

  // Black pill
  const pillY = ty + 30;
  const pillW = 760, pillH = 80, pillR = 40;
  const pillX = (W - pillW) / 2;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(pillX + pillR, pillY);
  ctx.lineTo(pillX + pillW - pillR, pillY);
  ctx.arc(pillX + pillW - pillR, pillY + pillR, pillR, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(pillX + pillR, pillY + pillH);
  ctx.arc(pillX + pillR, pillY + pillR, pillR, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#F0C000';
  ctx.font = '400 38px "Barlow Condensed BK"';
  ctx.textBaseline = 'middle';
  ctx.fillText('YOUR WEATHER UPDATE IS COMING REAL SOON', W / 2, pillY + pillH / 2);

  // Footer bar
  ctx.fillStyle = '#000';
  ctx.fillRect(0, H - 68, W, 68);
  ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, H - 68); ctx.lineTo(W, H - 68); ctx.stroke();

  logo(ctx, 24, H - 58, 1.1);

  ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(W / 2 - 10, H - 60); ctx.lineTo(W / 2 - 10, H - 10); ctx.stroke();

  ctx.fillStyle = '#888'; ctx.font = '400 16px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('THANK YOU FOR YOUR PATIENCE.', W * 0.72, H - 34);

  return canvas;
}

// ── TEMPLATE 6: DASHBOARD ──

async function drawDashboard(row) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const high = Math.round(row.high ?? row.temp);
  const score = row.score;
  const synopsis = row.synopsis_approved || '';
  const outfit = outfitItems(high, row.precip_chance);
  const hair = getHairStatus(row.humidity, row.precip_chance);
  const meter = getOutsideMeter(score);
  const forecast = Array.isArray(row.forecast) ? row.forecast.slice(0, 5) : [];
  const scoreLabel = score >= 8 ? 'A PERFECT DAY' : score >= 6 ? 'A SOLID DAY' : score >= 4 ? 'PROCEED WITH CAUTION' : score >= 2 ? 'ROUGH ONE OUT THERE' : 'STAY HOME TODAY';

  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  scanlines(ctx);
  border(ctx);

  // Header
  ctx.fillStyle = '#0f0f0f';
  ctx.fillRect(INSET, INSET, W - INSET * 2, 70);
  hline(ctx, INSET + 70, '#222', 1, INSET, W - INSET);
  logo(ctx, INSET + 14, INSET + 10, 1.1);
  ctx.fillStyle = '#555';
  ctx.font = '400 13px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('NYC  ·  DAILY WEATHER  ·  AM EDITION', W / 2 + 40, INSET + 35);

  // Date row
  ctx.fillStyle = ACCENT;
  ctx.font = '400 20px "Share Tech Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const shortDate = getNYCShortDate();
  ctx.fillText(shortDate, INSET + 20, INSET + 82);
  ctx.fillStyle = '#555';
  ctx.textAlign = 'right';
  ctx.fillText('NEW YORK CITY', W - INSET - 20, INSET + 82);

  hline(ctx, INSET + 110, '#222', 1);

  // Score hero row
  ctx.fillStyle = ACCENT;
  ctx.font = '400 148px "VT323"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(String(score), INSET + 22, INSET + 114);

  ctx.fillStyle = '#fff';
  ctx.font = '400 60px "Barlow Condensed BK"';
  ctx.textAlign = 'left';
  ctx.fillText(scoreLabel, INSET + 128, INSET + 128);

  ctx.fillStyle = '#444';
  ctx.font = '400 16px "Share Tech Mono"';
  ctx.fillText('OUT OF 10', INSET + 22, INSET + 260);

  hline(ctx, INSET + 290, '#222', 1);

  // 4 compact panels (2x2)
  const cp = { x: INSET + 20, y: INSET + 306, w: (W - INSET * 2 - 40 - 6) / 2, h: 370 };

  // Mood
  panel(ctx, cp.x, cp.y, cp.w, cp.h, "TODAY'S MOOD");
  ctx.fillStyle = '#bbb'; ctx.font = '400 24px "Share Tech Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  wrapText(ctx, synopsis || '—', cp.x + 8, cp.y + 28, cp.w - 16, 32, 8);

  // Fit check
  panel(ctx, cp.x + cp.w + 6, cp.y, cp.w, cp.h, 'FIT CHECK');
  ctx.fillStyle = '#bbb'; ctx.font = '400 24px "Share Tech Mono"';
  wrapText(ctx, outfit.join('\n'), cp.x + cp.w + 14, cp.y + 28, cp.w - 16, 32, 8);

  // Hair forecast
  panel(ctx, cp.x, cp.y + cp.h + 6, cp.w, cp.h, 'HAIR FORECAST');
  ctx.fillStyle = hair.color; ctx.font = '700 20px "Share Tech Mono"';
  wrapText(ctx, hair.level, cp.x + 8, cp.y + cp.h + 30, cp.w - 16, 24, 2);
  ctx.fillStyle = '#888'; ctx.font = '400 18px "Share Tech Mono"';
  ctx.fillText(`HUMIDITY: ${row.humidity}%`, cp.x + 8, cp.y + cp.h + 86);
  ctx.fillText(hair.sub, cp.x + 8, cp.y + cp.h + 114);
  ctx.fillStyle = '#555'; ctx.font = '400 16px "Share Tech Mono"';
  wrapText(ctx, hair.rec, cp.x + 8, cp.y + cp.h + 152, cp.w - 16, 22, 3);

  // Outside meter
  const omX = cp.x + cp.w + 6, omY = cp.y + cp.h + 6, omCx = omX + cp.w / 2;
  panel(ctx, omX, omY, cp.w, cp.h, 'OUTSIDE METER');
  const omR = Math.min(cp.w / 2 - 20, cp.h * 0.38);
  const omCy = omY + cp.h - 64 - omR;
  semiGauge(ctx, omCx, omCy, omR, meter.pct, meter.color);
  ctx.fillStyle = meter.color; ctx.font = '700 20px "Barlow Condensed"';
  ctx.textAlign = 'center';
  ctx.fillText(meter.label, omCx, omY + cp.h - 36);
  ctx.fillStyle = '#666'; ctx.font = '400 14px "Share Tech Mono"';
  ctx.fillText(meter.sub, omCx, omY + cp.h - 14);

  const afterPanels = cp.y + cp.h * 2 + 18;
  hline(ctx, afterPanels, '#222', 1);

  // 5-DAY OUTLOOK
  ctx.fillStyle = ACCENT; ctx.font = '700 14px "Share Tech Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('5-DAY OUTLOOK', INSET + 20, afterPanels + 10);

  const dayW = (W - INSET * 2 - 40) / 5;
  forecast.forEach((f, i) => {
    const fx = INSET + 20 + i * dayW + dayW / 2;
    const fy = afterPanels + 32;
    ctx.fillStyle = '#777'; ctx.font = '700 13px "Share Tech Mono"';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(f.day.toUpperCase(), fx, fy);
    weatherIcon(ctx, fx, fy + 26, 38, f.rain > 50 ? 'rain' : 'clear');
    ctx.fillStyle = '#eee'; ctx.font = '700 26px "Barlow Condensed"';
    ctx.fillText(`${Math.round(f.high)}°`, fx, fy + 60);
    ctx.fillStyle = f.rain > 30 ? '#5599dd' : '#555'; ctx.font = '400 13px "Share Tech Mono"';
    ctx.fillText(f.rain > 0 ? `${f.rain}%` : 'dry', fx, fy + 90);
  });

  hline(ctx, afterPanels + 140, '#222', 1);

  // Culture's weather channel footer text
  ctx.fillStyle = '#333'; ctx.font = '400 13px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText("— THE CULTURE'S WEATHER CHANNEL —", W / 2, afterPanels + 150);
  ctx.fillStyle = ACCENT;
  ctx.font = '400 14px "Share Tech Mono"';
  ctx.fillText('STAY COOL  ·  DRINK WATER  ·  ENJOY THE DAY  ·  CHECK ON YOUR PEOPLE', W / 2, afterPanels + 170);

  ticker(ctx, "THE CULTURE'S WEATHER CHANNEL  ·  CLASSICNEWWEATHER.COM");

  return canvas;
}

// ── UPLOAD + ORCHESTRATION ──

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

async function generateAndUpload(row, dateKey, type = 'daily') {
  const renderers = { daily: drawDaily, weekly: drawWeekly, alert: drawAlert, hair: drawHair, teaser: drawTeaser, dashboard: drawDashboard };
  const fn = renderers[type] || drawDaily;
  const feedCanvas = await fn(row);
  const feedBuffer = await feedCanvas.encode('png');

  // 9:16 story wrapper
  const storyCanvas = createCanvas(1080, 1920);
  const sCtx = storyCanvas.getContext('2d');
  sCtx.fillStyle = type === 'teaser' ? '#000' : BG;
  sCtx.fillRect(0, 0, 1080, 1920);
  sCtx.drawImage(feedCanvas, 0, (1920 - 1350) / 2);
  const storyBuffer = await storyCanvas.encode('png');

  const slug = type === 'daily' ? dateKey : `${dateKey}-${type}`;
  const [feedImageUrl, storyImageUrl] = await Promise.all([
    uploadImage(feedBuffer, `${slug}-feed.png`),
    uploadImage(storyBuffer, `${slug}.png`)
  ]);

  // Save to Supabase (only update feed/story URLs for daily type — others are on-demand)
  if (type === 'daily' || type === 'weekly') {
    await fetch(`${SUPABASE_URL}/rest/v1/daily?date_key=eq.${encodeURIComponent(dateKey)}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ feed_image_url: feedImageUrl, story_image_url: storyImageUrl })
    });
  }

  return { feedImageUrl, storyImageUrl };
}

exports.generateAndUpload = generateAndUpload;

// ── HTTP HANDLER ──

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let password, type;
  try { ({ password, type = 'daily' } = JSON.parse(event.body || '{}')); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bad request' }) }; }

  if (password !== ADMIN_PW) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  try {
    const dateKey = toNYCDateKey(new Date());
    const res = await fetch(`${SUPABASE_URL}/rest/v1/daily?date_key=eq.${encodeURIComponent(dateKey)}&select=*`, {
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
    });
    const rows = await res.json();
    if (!rows?.length) return { statusCode: 404, headers, body: JSON.stringify({ error: 'No weather data for today' }) };

    const { feedImageUrl, storyImageUrl } = await generateAndUpload(rows[0], dateKey, type);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, type, feedImageUrl, storyImageUrl }) };
  } catch (err) {
    console.error('generate-ig-graphic error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
