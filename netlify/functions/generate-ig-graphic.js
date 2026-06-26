// netlify/functions/generate-ig-graphic.js
// 6 branded IG templates: daily, weekly, alert, hair, teaser, dashboard

const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');

const W = 1080, H = 1350;
const BG = '#0a0a0a';
const ACCENT = '#CC3300';
const INSET = 18;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PW = process.env.ADMIN_PW;

function resolveFontPath(filename) {
  for (const dir of [path.join(__dirname, 'fonts'), path.join(__dirname, 'netlify/functions/fonts')]) {
    const p = path.join(dir, filename);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Font not found: ${filename}`);
}

// registerFromPath is more reliable than passing a Buffer in napi-rs/canvas
GlobalFonts.registerFromPath(resolveFontPath('VT323.woff2'), 'VT323');
GlobalFonts.registerFromPath(resolveFontPath('ShareTechMono.woff2'), 'Share Tech Mono');
GlobalFonts.registerFromPath(resolveFontPath('BarlowCondensed-Bold.woff2'), 'Barlow Condensed');
GlobalFonts.registerFromPath(resolveFontPath('BarlowCondensed-ExtraBold.woff2'), 'Barlow Condensed XB');
GlobalFonts.registerFromPath(resolveFontPath('BarlowCondensed-Black.woff2'), 'Barlow Condensed BK');
GlobalFonts.registerFromPath(resolveFontPath('BebasNeue-Regular.woff2'), 'Bebas Neue');
GlobalFonts.registerFromPath(resolveFontPath('IBMPlexMono-Regular.woff2'), 'IBM Plex Mono');
GlobalFonts.registerFromPath(resolveFontPath('IBMPlexMono-Bold.woff2'), 'IBM Plex Mono Bold');

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

function measureLines(ctx, text, maxW) {
  const words = text.split(' ');
  let line = '', count = 1;
  for (let n = 0; n < words.length; n++) {
    const test = line + words[n] + ' ';
    if (ctx.measureText(test).width > maxW && n > 0) { count++; line = words[n] + ' '; }
    else { line = test; }
  }
  return count;
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

function dateBadge(ctx, x, y, day, dateStr, accentColor = ACCENT, bw = 230, bh = 64, daySize = 18, dateSize = 13) {
  ctx.strokeStyle = accentColor; ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, bw, bh);
  ctx.fillStyle = accentColor;
  ctx.font = `700 ${daySize}px "Barlow Condensed"`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(day, x + bw / 2, y + Math.round(bh * 0.12));
  ctx.fillStyle = '#aaa';
  ctx.font = `400 ${dateSize}px "Share Tech Mono"`;
  ctx.fillText(dateStr, x + bw / 2, y + Math.round(bh * 0.50));
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

// ── SPRITE SHEET HELPERS (daily template) ──

// Weather icons — individual PNG files
function getWeatherIconFile(condition) {
  const c = (condition || '').toLowerCase();
  if (c.includes('thunder') || c.includes('storm'))                          return 'thunderstorm.png';
  if (c.includes('wintry') || c.includes('mix') || c.includes('sleet'))     return 'wintry-mix.png';
  if (c.includes('snow'))                                                    return 'snow.png';
  if (c.includes('rain') || c.includes('drizzle') || c.includes('shower'))  return 'light-rain.png';
  if (c.includes('wind'))                                                    return 'windy.png';
  if (c.includes('fog') || c.includes('mist') || c.includes('haze'))        return 'cloudy.png';
  if (c.includes('partly') || c.includes('scattered') || c.includes('few')) return 'partly-cloudy.png';
  if (c.includes('cloud') || c.includes('overcast') || c.includes('broken')) return 'cloudy.png';
  return 'sunny.png';
}

// Fit icons — individual PNG files
function getFitIconFile(item) {
  const map = {
    'TEE': 'tee.png', 'LONG SLEEVE': 'tee.png', 'LAYER UP': 'light-jacket.png',
    'TANK': 'tanktop.png',
    'HOODIE': 'hoodie.png', 'SWEATER': 'hoodie.png',
    'LIGHT JACKET': 'light-jacket.png',
    'JACKET': 'jacket.png', 'HEAVY COAT': 'jacket.png',
    'SHORTS': 'shorts.png',
    'JEANS': 'pants.png', 'SWEATS': 'pants.png',
    'SNEAKERS': 'sneakers.png',
    'BOOTS': 'boots.png', 'WATERPROOF BOOTS': 'rain-boots.png',
    'UMBRELLA': 'umbrella.png',
    'BEANIE': 'beanie.png', 'HAT + GLOVES': 'beanie.png',
  };
  return map[item] || null;
}

// Pick one representative item per category: [outer|top], [bottom], [shoes]
function getRepresentativeFitItems(outfit) {
  const outer  = outfit.find(i => ['HEAVY COAT','JACKET','LIGHT JACKET','LAYER UP'].includes(i));
  const top    = outfit.find(i => ['SWEATER','HOODIE','LONG SLEEVE','TEE'].includes(i));
  const bottom = outfit.find(i => ['SWEATS','JEANS','SHORTS'].includes(i));
  const shoes  = outfit.find(i => ['WATERPROOF BOOTS','BOOTS','SNEAKERS'].includes(i));
  return [outer || top, bottom, shoes].filter(Boolean);
}

// Simple outfit icon (tee + shorts + sneakers) for TODAY'S FIT panel
function drawOutfitIcon(ctx, cx, cy) {
  ctx.save();
  // Tee body
  ctx.fillStyle = '#888';
  ctx.fillRect(cx - 20, cy - 62, 40, 38);
  // Sleeves
  ctx.fillRect(cx - 36, cy - 62, 17, 20);
  ctx.fillRect(cx + 19, cy - 62, 17, 20);
  // V-collar
  ctx.fillStyle = BG;
  ctx.beginPath();
  ctx.moveTo(cx - 9, cy - 62); ctx.lineTo(cx, cy - 50); ctx.lineTo(cx + 9, cy - 62);
  ctx.closePath(); ctx.fill();
  // Shorts legs
  ctx.fillStyle = '#666';
  ctx.fillRect(cx - 20, cy - 22, 18, 30);
  ctx.fillRect(cx + 2, cy - 22, 18, 30);
  // Waistband
  ctx.fillStyle = '#777'; ctx.fillRect(cx - 20, cy - 22, 40, 8);
  // Sneakers
  ctx.fillStyle = '#888';
  ctx.beginPath(); ctx.ellipse(cx - 10, cy + 22, 15, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 10, cy + 22, 15, 8, 0, 0, Math.PI * 2); ctx.fill();
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

  let logoImg = null;
  try { logoImg = await loadImage(path.join(__dirname, 'assets/logo.png')); } catch {}

  let weatherIconImg = null;
  try { weatherIconImg = await loadImage(path.join(__dirname, `assets/${getWeatherIconFile(row.condition)}`)); } catch {}

  const fitItems = getRepresentativeFitItems(outfit);
  const fitIconImgs = await Promise.all(fitItems.map(async item => {
    const file = getFitIconFile(item);
    if (!file) return null;
    try { return await loadImage(path.join(__dirname, `assets/${file}`)); } catch { return null; }
  }));

  // ── BACKGROUND + GRAIN ──
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  const grainImg = ctx.getImageData(0, 0, W, H);
  let rv = 0x5F3759DF;
  function grainRand() { rv ^= rv << 13; rv ^= rv >> 17; rv ^= rv << 5; return (rv >>> 0) / 0xFFFFFFFF; }
  for (let i = 0; i < 22000; i++) {
    const gx = Math.floor(grainRand() * W);
    const gy = Math.floor(grainRand() * H);
    const gb = Math.floor(grainRand() * 30);
    const idx = (gy * W + gx) * 4;
    grainImg.data[idx]     = Math.min(255, grainImg.data[idx]     + gb);
    grainImg.data[idx + 1] = Math.min(255, grainImg.data[idx + 1] + gb);
    grainImg.data[idx + 2] = Math.min(255, grainImg.data[idx + 2] + gb);
  }
  ctx.putImageData(grainImg, 0, 0);
  scanlines(ctx);

  // Helper: scanline stripe overlay clipped to a rect
  function scanlineRect(rx, ry, rw, rh, alpha = 0.40, step = 14, barH = 7) {
    ctx.save();
    ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip();
    for (let sy = ry; sy < ry + rh; sy += step) {
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      ctx.fillRect(rx, sy, rw, barH);
    }
    ctx.restore();
  }


  // ── SECTION Y POSITIONS — 10/15/30/35/10% of 1350px ──
  const hY       = 0;
  const headerH  = 135;   // 10%  → 0–135
  const cityY    = 135;   // 15%  → 135–337
  const cityH    = 202;
  const scoreTop = 337;   // 30%  → 337–780 (extended slightly for OUT OF 10 breathing room)
  const scoreH   = 443;
  const TICKER_H = 135;   // 10%  → 1215–1350
  const tickerY  = 1215;
  const panelTop = 780;   // 35%  → 780–1215
  const panelBot = tickerY;
  const panelH   = panelBot - panelTop;   // 435
  const outOf10Y = scoreTop + 377;        // = 714, leaving 66px gap before panel

  // ── HEADER ──
  ctx.fillStyle = '#0f0f0f';
  ctx.fillRect(0, 0, W, headerH);
  hline(ctx, headerH, '#333', 1, 0, W);
  ctx.fillStyle = '#fff';
  ctx.font = '400 36px "Share Tech Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('classicnewweather', INSET + 22, headerH / 2);

  // Date — inline, right-aligned, same row as logo
  ctx.fillStyle = '#E8B800';
  ctx.font = '400 32px "Share Tech Mono"';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText(`${day}  ${dateStr}`, W - INSET - 22, headerH / 2);

  // ── NEW YORK CITY — Bebas Neue, solid orange, vertically centered ──
  ctx.fillStyle = '#cc4400';
  ctx.font = '400 152px "Bebas Neue", "Barlow Condensed BK"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('NEW YORK CITY', W / 2, cityY + 46);

  // ── SCORE SECTION: rule · HIGH · score number — equal spacing ──
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(INSET + 20, scoreTop + 3); ctx.lineTo(W - INSET - 20, scoreTop + 3); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = '400 32px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(`HIGH ${high}°F`, W / 2, scoreTop + 17);

  // Score — centered between HIGH bottom (~scoreTop+49) and outOf10Y (scoreTop+377)
  // Midpoint = +213, shifted +17 down to compensate for Barlow Condensed BK visual weight
  ctx.fillStyle = '#cc4400';
  ctx.font = '400 400px "Bebas Neue", "Barlow Condensed BK"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(score), W / 2, scoreTop + 230);
  ctx.textBaseline = 'top';

  // OUT OF 10
  ctx.fillStyle = '#fff';
  ctx.font = '400 28px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('OUT OF 10', W / 2, outOf10Y);

  hline(ctx, panelTop - 8, '#333', 1);

  // ── SHARED MOOD + FIT CONTAINER ──
  const px = INSET + 20, pw = W - INSET * 2 - 40;
  const ICON_W = 260;
  const SBR = 12;
  const sbx = px, sby = panelTop, sbw = pw, sbh = panelH;

  // Dynamic mood height — expands to fit synopsis, fitH gets the remainder (min 200px)
  const MOOD_LABEL_H = 68, MOOD_LINE_H = 44, MOOD_FONT = '400 36px "Share Tech Mono"';
  const moodText = (synopsis || 'CLASSICNEWWEATHER.COM').toUpperCase();
  ctx.font = MOOD_FONT;
  const moodLineCount = measureLines(ctx, moodText, pw - ICON_W - 32);
  const moodH = Math.min(panelH - 200, MOOD_LABEL_H + moodLineCount * MOOD_LINE_H + 24);
  const fitH  = panelH - moodH;

  // Rounded ACCENT outline
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sbx + SBR, sby); ctx.lineTo(sbx + sbw - SBR, sby);
  ctx.arcTo(sbx + sbw, sby, sbx + sbw, sby + SBR, SBR);
  ctx.lineTo(sbx + sbw, sby + sbh - SBR);
  ctx.arcTo(sbx + sbw, sby + sbh, sbx + sbw - SBR, sby + sbh, SBR);
  ctx.lineTo(sbx + SBR, sby + sbh);
  ctx.arcTo(sbx, sby + sbh, sbx, sby + sbh - SBR, SBR);
  ctx.lineTo(sbx, sby + SBR);
  ctx.arcTo(sbx, sby, sbx + SBR, sby, SBR);
  ctx.closePath(); ctx.stroke();


  // Vertical separator between icon col and text col
  ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(sbx + ICON_W, sby); ctx.lineTo(sbx + ICON_W, sby + sbh); ctx.stroke();

  // ACCENT horizontal divider between mood and fit sections
  const divY = sby + moodH;
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(sbx, divY); ctx.lineTo(sbx + sbw, divY); ctx.stroke();

  // ── TODAY'S MOOD — weather icon from individual PNG ──
  const moodCy = sby + moodH / 2;
  if (weatherIconImg) {
    const iconSize = 160;
    const wic = createCanvas(iconSize, iconSize);
    const wictx = wic.getContext('2d');
    wictx.drawImage(weatherIconImg, 0, 0, iconSize, iconSize);
    const wd = wictx.getImageData(0, 0, iconSize, iconSize);
    for (let pi = 0; pi < wd.data.length; pi += 4) {
      if (wd.data[pi] > 210 && wd.data[pi + 1] > 210 && wd.data[pi + 2] > 210) wd.data[pi + 3] = 0;
    }
    wictx.putImageData(wd, 0, 0);
    ctx.drawImage(wic, sbx + ICON_W / 2 - iconSize / 2, moodCy - iconSize / 2);
  } else {
    weatherIcon(ctx, sbx + ICON_W / 2, moodCy, 160, row.condition);
  }

  ctx.fillStyle = '#cc4400';
  ctx.font = '400 36px "Share Tech Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText("TODAY'S MOOD", sbx + ICON_W + 18, sby + 14);
  ctx.fillStyle = '#fff';
  ctx.font = MOOD_FONT;
  wrapText(ctx, moodText, sbx + ICON_W + 18, sby + MOOD_LABEL_H, pw - ICON_W - 32, MOOD_LINE_H);

  // ── TODAY'S FIT — individual PNG icons in a horizontal row ──
  const FIT_ICN   = 80, FIT_GAP = 10;
  const validFitImgs = fitIconImgs.filter(Boolean);
  if (validFitImgs.length > 0) {
    const fitTotalW = validFitImgs.length * FIT_ICN + (validFitImgs.length - 1) * FIT_GAP;
    const fitIconsX = sbx + Math.floor((ICON_W - fitTotalW) / 2);
    const fitIconsY = divY + Math.floor((fitH - FIT_ICN) / 2);
    validFitImgs.forEach((img, i) => {
      const fic = createCanvas(FIT_ICN, FIT_ICN);
      const fictx = fic.getContext('2d');
      fictx.drawImage(img, 0, 0, FIT_ICN, FIT_ICN);
      const fd = fictx.getImageData(0, 0, FIT_ICN, FIT_ICN);
      for (let pi = 0; pi < fd.data.length; pi += 4) {
        if (fd.data[pi] > 210 && fd.data[pi + 1] > 210 && fd.data[pi + 2] > 210) fd.data[pi + 3] = 0;
      }
      fictx.putImageData(fd, 0, 0);
      ctx.drawImage(fic, fitIconsX + i * (FIT_ICN + FIT_GAP), fitIconsY);
    });
  } else {
    drawOutfitIcon(ctx, sbx + ICON_W / 2, divY + fitH / 2);
  }

  ctx.fillStyle = '#cc4400';
  ctx.font = '400 36px "Share Tech Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText("TODAY'S FIT", sbx + ICON_W + 18, divY + 14);
  ctx.fillStyle = '#fff';
  ctx.font = MOOD_FONT;
  ctx.fillText(fitItems.join(' · '), sbx + ICON_W + 18, divY + MOOD_LABEL_H);

  // ── TICKER — broadcast bar, INSIDE card border ──
  ctx.fillStyle = ACCENT;
  ctx.fillRect(sbx, tickerY, sbw, TICKER_H);
  ctx.fillStyle = '#fff';
  ctx.font = '400 52px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('DRINK WATER  ·  ENJOY THE DAY', sbx + sbw / 2, tickerY + TICKER_H / 2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';

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

// ── HAIR ICON INDEX MAP ──
// Grid: 4 cols × 4 rows, row-major order
// 0:Natural Puff  1:High Puff  2:Straight Back Braids  3:Box Braids
// 4:Cornrows      5:High Bun   6:Low Bun               7:Silk Press
// 8:Blowout       9:Afro       10:Twist Out             11:Bantu Knots
// 12:Locs         13:Loc Bun   14:Curly Fro             15:Wash-and-Go

function getHairIconIndices(hair) {
  const level = hair.level;
  if (level === 'SILK PRESS WARNING')   return [0, 3, 5];   // Natural Puff, Box Braids, High Bun
  if (level === 'HIGH HUMIDITY ALERT')  return [15, 4, 11]; // Wash-and-Go, Cornrows, Bantu Knots
  if (level === 'PROCEED WITH CAUTION') return [10, 4, 3];  // Twist Out, Cornrows, Box Braids
  return [7, 8, 14]; // WASH & GO APPROVED: Silk Press, Blowout, Curly Fro
}

// ── TEMPLATE 4: HAIR FORECAST ──

async function drawHair(row) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const hair = getHairStatus(row.humidity, row.precip_chance);
  const humidity = row.humidity || 0;

  // Load assets (graceful fallback if missing)
  let logoImg = null, iconsSheet = null, modelImg = null;
  try { logoImg    = await loadImage(path.join(__dirname, 'assets/logo.png'));             } catch {}
  try { iconsSheet = await loadImage(path.join(__dirname, 'assets/hair-icons-sheet.png')); } catch {}
  try { modelImg   = await loadImage(path.join(__dirname, 'assets/hair-model.png'));        } catch {}

  // Brand colors
  const HBG     = '#0d1508';
  const HBORDER = '#3d5c1a';
  const HGOLD   = '#c8a200';
  const HTEAL   = '#00b8a8';

  // ── BACKGROUND ──
  ctx.fillStyle = HBG;
  ctx.fillRect(0, 0, W, H);

  // Grain texture
  for (let i = 0; i < 12000; i++) {
    ctx.fillStyle = `rgba(20,40,10,${(Math.random() * 0.07).toFixed(3)})`;
    ctx.fillRect(Math.floor(Math.random() * W), Math.floor(Math.random() * H), 2, 2);
  }

  // Scanlines
  for (let y = 0; y < H; y += 4) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, y, W, 1);
  }

  // ── LAYOUT CONSTANTS ──
  const BD     = 14;
  const PAD    = 24;
  const HDR_H  = 118;
  const MAIN_Y = BD + HDR_H;        // 132
  const MAIN_H = 730;
  const ALT_Y  = MAIN_Y + MAIN_H;   // 862
  const ALT_H  = 160;
  const FTR_Y  = ALT_Y + ALT_H;     // 1022
  const FTR_H  = 128;
  const BOT_Y  = FTR_Y + FTR_H;     // 1150  (BOT ends at H-52=1298)

  const LEFT_W  = 596;
  const RIGHT_X = LEFT_W;
  const RIGHT_W = W - BD - RIGHT_X; // 470

  const CX = BD + PAD;               // content left X = 38
  const CW = LEFT_W - BD - PAD * 2;  // content width  = 534

  // Green border
  ctx.strokeStyle = HBORDER;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(BD + 1.25, BD + 1.25, W - BD * 2 - 2.5, H - BD * 2 - 2.5);

  // Helper: horizontal divider
  function hdiv(y, x0 = BD, x1 = W - BD) {
    ctx.strokeStyle = HBORDER; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
  }

  // ── HEADER ──
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(BD, BD, W - BD * 2, HDR_H);

  const LOGO_SZ = 76;
  const logoX = CX, logoY = BD + (HDR_H - LOGO_SZ) / 2;

  if (logoImg) {
    // Circular clip for logo badge
    ctx.save();
    ctx.beginPath();
    ctx.arc(logoX + LOGO_SZ / 2, logoY + LOGO_SZ / 2, LOGO_SZ / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logoImg, logoX, logoY, LOGO_SZ, LOGO_SZ);
    ctx.restore();
    const wx = logoX + LOGO_SZ + 14;
    ctx.fillStyle = '#f0f0f0'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = '400 24px "Barlow Condensed BK"'; ctx.fillText('classic',    wx, logoY + 8);
    ctx.font = '400 22px "Barlow Condensed"';    ctx.fillText('newweather', wx, logoY + 34);
  } else {
    logo(ctx, CX, BD + (HDR_H - 44) / 2, 1.2);
  }

  // HAIR FORECAST badge (right side)
  const BDG_W = 270, BDG_H = 80;
  const bdgX = W - BD - PAD - BDG_W;
  const bdgY = BD + (HDR_H - BDG_H) / 2;
  ctx.strokeStyle = HBORDER; ctx.lineWidth = 1.5;
  ctx.strokeRect(bdgX, bdgY, BDG_W, BDG_H);
  ctx.fillStyle = HGOLD;
  ctx.font = '700 20px "Share Tech Mono"'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('HAIR FORECAST', bdgX + BDG_W / 2, bdgY + 10);
  ctx.fillStyle = '#888'; ctx.font = '400 14px "Share Tech Mono"';
  const dateNow = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'long', day: 'numeric'
  }).format(new Date()).toUpperCase();
  ctx.fillText(`${getNYCDay()}  ·  ${dateNow}`, bdgX + BDG_W / 2, bdgY + 48);

  hdiv(BD + HDR_H);

  // ── RIGHT PANEL: MODEL PHOTO ──
  if (modelImg) {
    ctx.save();
    ctx.beginPath(); ctx.rect(RIGHT_X, MAIN_Y, RIGHT_W, MAIN_H); ctx.clip();
    const imgR = modelImg.width / modelImg.height;
    const panR = RIGHT_W / MAIN_H;
    let dw, dh, dx, dy;
    if (imgR > panR) { dh = MAIN_H; dw = dh * imgR; dx = RIGHT_X - (dw - RIGHT_W) / 2; dy = MAIN_Y; }
    else             { dw = RIGHT_W; dh = dw / imgR; dx = RIGHT_X; dy = MAIN_Y - (dh - MAIN_H) / 2; }
    ctx.drawImage(modelImg, dx, dy, dw, dh);
    // Subtle green tint overlay
    ctx.fillStyle = 'rgba(8,20,4,0.28)'; ctx.fillRect(RIGHT_X, MAIN_Y, RIGHT_W, MAIN_H);
    ctx.restore();
  } else {
    // Fallback: wavy texture lines
    ctx.fillStyle = '#0d1208'; ctx.fillRect(RIGHT_X, MAIN_Y, RIGHT_W, MAIN_H);
    ctx.save();
    for (let wi = 0; wi < 22; wi++) {
      const wy = MAIN_Y + 30 + wi * 34;
      ctx.strokeStyle = wi % 2 === 0 ? `${HGOLD}33` : `${HBORDER}55`;
      ctx.lineWidth = wi % 3 === 0 ? 2 : 1; ctx.lineCap = 'round'; ctx.beginPath();
      for (let xi = 0; xi <= 30; xi++) {
        const xp = RIGHT_X + 12 + (xi / 30) * (RIGHT_W - 24);
        const yp = wy + Math.sin((xi / 30) * Math.PI * 3) * 7;
        xi === 0 ? ctx.moveTo(xp, yp) : ctx.lineTo(xp, yp);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Left/right panel divider
  ctx.strokeStyle = HBORDER; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(RIGHT_X, MAIN_Y); ctx.lineTo(RIGHT_X, MAIN_Y + MAIN_H); ctx.stroke();

  // ── LEFT PANEL CONTENT ──
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';

  let cy = MAIN_Y + 24;

  // Hair status headline — big Barlow Condensed BK, wraps to 2 lines
  ctx.fillStyle = hair.color;
  ctx.font = '400 92px "Barlow Condensed BK"';
  const nLines = wrapText(ctx, hair.level, CX, cy, CW, 96, 2);
  cy += nLines * 96 + 14;

  hdiv(cy, CX, LEFT_W - PAD); cy += 22;

  // HUMIDITY label
  ctx.fillStyle = '#777'; ctx.font = '700 15px "Share Tech Mono"';
  ctx.fillText('HUMIDITY:', CX, cy); cy += 26;

  // Big humidity number with horizontal scan-line stripe effect
  const HUM_SZ = 210;
  ctx.fillStyle = '#f0f0f0';
  ctx.font = `400 ${HUM_SZ}px "VT323"`;
  const humStr = `${humidity}%`;
  const humW   = ctx.measureText(humStr).width;
  const humH   = Math.round(HUM_SZ * 0.82);
  ctx.fillText(humStr, CX, cy);
  ctx.save();
  ctx.beginPath(); ctx.rect(CX, cy, humW + 4, humH); ctx.clip();
  for (let sy = cy + 2; sy < cy + humH; sy += 10) {
    ctx.fillStyle = 'rgba(13,21,8,0.38)';
    ctx.fillRect(CX, sy, humW + 4, 5);
  }
  ctx.restore();
  cy += humH + 14;

  // Sub text
  ctx.fillStyle = '#cccccc'; ctx.font = '400 21px "Share Tech Mono"';
  ctx.fillText(hair.sub, CX, cy);

  // ── ALTERNATIVE RECOMMENDATION ──
  hdiv(ALT_Y);
  ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(BD, ALT_Y, W - BD * 2, ALT_H);

  const ICN_AREA_W = 290;
  const icnAreaX   = W - BD - ICN_AREA_W;
  ctx.strokeStyle = HBORDER; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(icnAreaX, ALT_Y); ctx.lineTo(icnAreaX, ALT_Y + ALT_H); ctx.stroke();

  ctx.fillStyle = HTEAL; ctx.font = '700 13px "Share Tech Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('ALTERNATIVE RECOMMENDATION:', CX, ALT_Y + 18);
  ctx.fillStyle = '#f0f0f0'; ctx.font = '400 26px "Share Tech Mono"';
  wrapText(ctx, hair.rec, CX, ALT_Y + 44, icnAreaX - CX - 20, 30, 2);

  // Hair icons — crop from sprite sheet, remove white bg via pixel manipulation
  if (iconsSheet) {
    const idxs  = getHairIconIndices(hair);
    const cellW = iconsSheet.width / 4;
    const cellH = iconsSheet.height / 4;
    const ICN_SZ    = 76;
    const icnGap    = 12;
    const totalIconW = 3 * ICN_SZ + 2 * icnGap;
    const icnStartX  = icnAreaX + (ICN_AREA_W - totalIconW) / 2;
    const icnY       = ALT_Y + (ALT_H - ICN_SZ) / 2;

    idxs.slice(0, 3).forEach((idx, i) => {
      const srcX  = (idx % 4) * cellW;
      const srcY  = Math.floor(idx / 4) * cellH;
      const destX = icnStartX + i * (ICN_SZ + icnGap);
      // Render to offscreen canvas, strip white background
      const ic   = createCanvas(ICN_SZ, ICN_SZ);
      const ictx = ic.getContext('2d');
      ictx.drawImage(iconsSheet, srcX, srcY, cellW, cellH * 0.78, 0, 0, ICN_SZ, ICN_SZ);
      const d = ictx.getImageData(0, 0, ICN_SZ, ICN_SZ);
      for (let pi = 0; pi < d.data.length; pi += 4) {
        if (d.data[pi] > 200 && d.data[pi + 1] > 200 && d.data[pi + 2] > 200)
          d.data[pi + 3] = 0;
      }
      ictx.putImageData(d, 0, 0);
      ctx.drawImage(ic, destX, icnY);
    });
  }

  // ── FOOTER PHRASE ──
  hdiv(FTR_Y);
  const phrs = [
    { text: 'STAY SMOOTH.',        color: HGOLD     },
    { text: 'CHECK THE FORECAST.', color: '#f0f0f0' },
    { text: 'RESPECT THE WEATHER.', color: HTEAL    }
  ];
  const slotW = (W - BD * 2) / 3;
  ctx.font = '700 18px "Share Tech Mono"'; ctx.textBaseline = 'middle';
  phrs.forEach((p, i) => {
    ctx.fillStyle = p.color; ctx.textAlign = 'center';
    ctx.fillText(p.text, BD + slotW * i + slotW / 2, FTR_Y + FTR_H / 2);
  });

  // ── BOTTOM BAR ──
  hdiv(BOT_Y);
  const barMidY = BOT_Y + (H - 52 - BOT_Y) / 2;

  ctx.fillStyle = '#555'; ctx.font = '400 14px "Share Tech Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText("THE CULTURE'S WEATHER CHANNEL", CX, barMidY);

  // Globe icon (canvas-drawn)
  const GCX = W / 2, GR = 15;
  ctx.strokeStyle = HTEAL; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(GCX, barMidY, GR, 0, Math.PI * 2); ctx.stroke();
  [-0.45, 0, 0.45].forEach(t => {
    const ry = barMidY + t * GR;
    const rx = Math.sqrt(Math.max(0, GR * GR - (t * GR) ** 2));
    ctx.beginPath(); ctx.moveTo(GCX - rx, ry); ctx.lineTo(GCX + rx, ry); ctx.stroke();
  });
  ctx.beginPath(); ctx.moveTo(GCX, barMidY - GR); ctx.lineTo(GCX, barMidY + GR); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(GCX, barMidY, GR * 0.42, GR, 0, 0, Math.PI * 2); ctx.stroke();

  ctx.fillStyle = HTEAL; ctx.font = '400 14px "Share Tech Mono"';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText('CLASSICNEWWEATHER.COM', W - BD - PAD, barMidY);

  // Vertical dividers in bottom bar
  [W / 2 - 90, W / 2 + 90].forEach(x => {
    ctx.strokeStyle = '#2a3318'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, BOT_Y + 20); ctx.lineTo(x, H - 54); ctx.stroke();
  });

  ticker(ctx, 'STAY SMOOTH  ·  CHECK THE FORECAST  ·  RESPECT THE WEATHER', HBORDER);
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
