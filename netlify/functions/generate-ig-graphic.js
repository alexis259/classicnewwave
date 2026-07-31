// netlify/functions/generate-ig-graphic.js
// 6 branded IG templates: daily, weekly, alert, hair, teaser, dashboard

const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');

const W = 1080, H = 1350;
const BG = '#111111';
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
  pieces.push(temp < 40 ? 'SWEATER' : temp < 55 ? 'HOODIE' : temp < 68 ? 'LONG SLEEVE' : temp < 80 ? 'TEE' : 'TANK');
  pieces.push(temp < 45 ? 'SWEATS' : temp < 65 ? 'JEANS' : 'SHORTS');
  pieces.push(temp < 35 || rain > 60 ? 'WATERPROOF BOOTS' : temp < 55 ? 'BOOTS' : 'SNEAKERS');
  if (temp < 32) pieces.push('HAT + GLOVES');
  else if (temp < 42) pieces.push('BEANIE');
  if (rain > 30) pieces.push('UMBRELLA');
  return pieces;
}

function getHairStatus(humidity, rain) {
  if (humidity >= 85 || rain > 60) return { level: 'SILK PRESS WARNING',  color: '#E8C500', sub: 'PROCEED AT YOUR OWN RISK.', rec: 'PUFF  •  BRAIDS  •  BUN' };
  if (humidity >= 75 || rain > 40) return { level: 'HIGH HUMIDITY ALERT', color: '#E88000', sub: 'MONITOR CLOSELY.',          rec: 'WASH & GO  •  PROTECTIVE STYLE' };
  if (humidity >= 65 || rain > 25) return { level: 'MODERATE RISK',       color: '#C8A000', sub: 'PROCEED WITH CAUTION.',     rec: 'ANTI-HUMIDITY SPRAY  •  BRAID OUT' };
  if (humidity >= 55)              return { level: 'LOW RISK',             color: '#88AA40', sub: 'FRIZZ POSSIBLE.',           rec: 'SILK PRESS  •  WASH & GO' };
  return                                   { level: 'GOOD HAIR DAY',       color: '#5AAA40', sub: "YOU'RE GOOD.",              rec: 'SILK PRESS  •  BLOWOUT  •  ANY STYLE' };
}

function getHairIconFile(humidity, rain) {
  if (rain > 60 || humidity >= 85) return 'cornrows.png';    // SILK PRESS WARNING → go protective
  if (rain > 40 || humidity >= 75) return 'afro-puff.png';   // HIGH HUMIDITY ALERT → protective
  if (rain > 25 || humidity >= 65) return 'silk-press.png';  // MODERATE RISK → silk press at risk
  return 'wash-and-go.png';                                   // LOW RISK / GOOD HAIR DAY
}

// Returns 3 icons for the full hair graphic panel
function getHairIconFilesForDisplay(humidity, rain) {
  if (rain > 60 || humidity >= 80) return ['cornrows.png', 'bantu-knots.png', 'afro-puff.png'];
  if (rain > 40 || humidity >= 70) return ['afro-puff.png', 'wash-and-go.png', 'bantu-knots.png'];
  if (rain > 25 || humidity >= 55) return ['wash-and-go.png', 'afro-puff.png', 'silk-press.png'];
  return ['silk-press.png', 'wash-and-go.png', 'afro-puff.png'];
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
  const top    = outfit.find(i => ['SWEATER','HOODIE','LONG SLEEVE','TEE','TANK'].includes(i));
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

// ── THEME COLOR — dynamic accent based on temp + rain ──
function getThemeColor(high, precipChance) {
  if (precipChance >= 70) return '#1177BB';   // heavy rain — blue
  if (precipChance >= 45) return '#2299AA';   // rain — teal
  if (high >= 89) return '#FF3300';           // brutal heat — bright red
  if (high >= 83) return '#E85500';           // hot — burnt orange
  if (high >= 78) return '#CC4400';           // warm — orange
  if (high >= 65) return '#CC3300';           // perfect — red-orange
  if (high >= 55) return '#BB8800';           // cool — amber
  if (high >= 50) return '#3388AA';           // chilly — slate blue
  if (high >= 42) return '#2266CC';           // cold — blue
  if (high >= 28) return '#1155BB';           // cold af — deep blue
  return '#0044AA';                           // freezing/brutal — cold blue
}

// ── SLIDE 2 COLORS — per-condition dark background tints ──
function getSlide2Colors(high, precipChance) {
  const accent = getThemeColor(high, precipChance);
  let bg, border, secondary;
  if (precipChance >= 70)      { bg = '#060a12'; border = '#0c1220'; secondary = '#5588bb'; }
  else if (precipChance >= 45) { bg = '#080c14'; border = '#0e1422'; secondary = '#6a99aa'; }
  else if (high >= 89)         { bg = '#1a0a08'; border = '#2a1008'; secondary = '#cc9980'; }
  else if (high >= 83)         { bg = '#180e08'; border = '#281808'; secondary = '#bb9970'; }
  else if (high >= 78)         { bg = '#160e08'; border = '#261408'; secondary = '#aa8860'; }
  else if (high >= 65)         { bg = '#140e08'; border = '#221208'; secondary = '#aa8860'; }
  else if (high >= 55)         { bg = '#100e08'; border = '#1e1808'; secondary = '#997755'; }
  else if (high >= 50)         { bg = '#080e14'; border = '#0e1a22'; secondary = '#6a99aa'; }
  else if (high >= 42)         { bg = '#070a12'; border = '#0c1220'; secondary = '#6088aa'; }
  else if (high >= 28)         { bg = '#060910'; border = '#0a101e'; secondary = '#5577aa'; }
  else                         { bg = '#060810'; border = '#0a1020'; secondary = '#5577aa'; }
  return { accent, bg, border, secondary };
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

  let hairIconImg = null;
  try { hairIconImg = await loadImage(path.join(__dirname, `assets/${getHairIconFile(row.humidity, row.precip_chance)}`)); } catch {}

  const themeColor = getThemeColor(high, row.precip_chance);

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


  // ── SECTION Y POSITIONS ──
  const headerH  = 135;   // 0–135
  const cityY    = 135;   // 135–320
  const scoreTop = 320;   // 320–680
  const TICKER_H = 135;   // 1215–1350
  const tickerY  = 1215;
  const panelTop = 680;   // 680–1215 → 535px for 3 equal sections
  const panelBot = tickerY;
  const panelH   = panelBot - panelTop;   // 535
  const outOf10Y = scoreTop + 290;        // = 610, ~70px gap before panel

  // ── HEADER ──
  ctx.fillStyle = '#0f0f0f';
  ctx.fillRect(0, 0, W, headerH);
  hline(ctx, headerH, '#333', 1, 0, W);

  // Vertically center text using ink bounding box (textBaseline='middle' undershoots for Share Tech Mono)
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.font = '400 36px "Share Tech Mono"';
  ctx.textAlign = 'left';
  { const hm = ctx.measureText('classicnewweather');
    ctx.fillText('classicnewweather', INSET + 22, (headerH + hm.actualBoundingBoxAscent - hm.actualBoundingBoxDescent) / 2); }

  // Date — right-aligned, same row
  ctx.fillStyle = '#E8B800';
  ctx.font = '400 32px "Share Tech Mono"';
  ctx.textAlign = 'right';
  { const dl = `${day}  ${dateStr}`;
    const dm = ctx.measureText(dl);
    ctx.fillText(dl, W - INSET - 22, (headerH + dm.actualBoundingBoxAscent - dm.actualBoundingBoxDescent) / 2); }

  // ── NEW YORK CITY — Bebas Neue, solid orange, vertically centered ──
  ctx.fillStyle = themeColor;
  ctx.font = '400 152px "Bebas Neue", "Barlow Condensed BK"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('NEW YORK CITY', W / 2, cityY + 46);

  // ── SCORE SECTION: rule · HIGH · score number — equal spacing ──
  ctx.strokeStyle = themeColor; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(INSET + 20, scoreTop + 3); ctx.lineTo(W - INSET - 20, scoreTop + 3); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = '400 32px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(`HIGH ${high}°F`, W / 2, scoreTop + 17);

  // Score — optically centered both axes using actual ink bounding box
  ctx.fillStyle = themeColor;
  ctx.font = '400 320px "Bebas Neue", "Barlow Condensed BK"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const scoreStr = String(score);
  const sm = ctx.measureText(scoreStr);
  // Horizontal: shift so ink center lands at W/2
  const scoreCx = W / 2 + (sm.actualBoundingBoxLeft - sm.actualBoundingBoxRight) / 2;
  // Vertical: place ink center at midpoint between bottom of HIGH text and top of OUT OF 10
  const highBottom = scoreTop + 49;   // HIGH text at +17, 32px font
  const zoneCenter = (highBottom + outOf10Y) / 2;
  // With textBaseline='middle', actualBoundingBoxAscent/Descent are from em-middle to ink edges
  const scoreCy = zoneCenter + (sm.actualBoundingBoxAscent - sm.actualBoundingBoxDescent) / 2;
  ctx.fillText(scoreStr, scoreCx, scoreCy);
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

  // Panel split: equal thirds — MOOD / FIT / HAIR
  const SECTION_H = Math.floor(panelH / 3);  // ~178px each
  const HAIR_H = SECTION_H;
  const FIT_H_FIXED = SECTION_H;
  const moodH = panelH - FIT_H_FIXED - HAIR_H;
  const fitH  = FIT_H_FIXED;
  const MOOD_LABEL_H = 56, MOOD_LINE_H = 34, MOOD_FONT = '400 26px "Share Tech Mono"';
  const moodText = (synopsis || 'CLASSICNEWWEATHER.COM').toUpperCase();

  // Rounded ACCENT outline
  ctx.strokeStyle = themeColor; ctx.lineWidth = 2;
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
  ctx.strokeStyle = themeColor; ctx.lineWidth = 1;
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

  ctx.fillStyle = themeColor;
  ctx.font = '400 36px "Share Tech Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText("TODAY'S MOOD", sbx + ICON_W + 18, sby + 14);
  ctx.fillStyle = '#fff';
  ctx.font = MOOD_FONT;
  const maxMoodLines = Math.floor((moodH - MOOD_LABEL_H - 8) / MOOD_LINE_H);
  wrapText(ctx, moodText, sbx + ICON_W + 18, sby + MOOD_LABEL_H, pw - ICON_W - 32, MOOD_LINE_H, maxMoodLines);

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

  ctx.fillStyle = themeColor;
  ctx.font = '400 36px "Share Tech Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText("TODAY'S FIT", sbx + ICON_W + 18, divY + 14);
  ctx.fillStyle = '#fff';
  ctx.font = MOOD_FONT;
  ctx.fillText(fitItems.join(' · '), sbx + ICON_W + 18, divY + MOOD_LABEL_H);

  // ── HAIR FORECAST ──
  const hairDivY = divY + fitH;
  ctx.strokeStyle = themeColor; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(sbx, hairDivY); ctx.lineTo(sbx + sbw, hairDivY); ctx.stroke();

  const hair = getHairStatus(row.humidity, row.precip_chance);
  const hairCy = hairDivY + HAIR_H / 2;

  if (hairIconImg) {
    const hicnSz = 100;
    ctx.drawImage(hairIconImg, sbx + ICON_W / 2 - hicnSz / 2, hairCy - hicnSz / 2, hicnSz, hicnSz);
  }

  ctx.fillStyle = themeColor;
  ctx.font = '400 36px "Share Tech Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('HAIR FORECAST', sbx + ICON_W + 18, hairDivY + 12);
  ctx.fillStyle = hair.color;
  ctx.font = '400 28px "Share Tech Mono"';
  ctx.fillText(hair.level, sbx + ICON_W + 18, hairDivY + 58);
  ctx.fillStyle = '#777';
  ctx.font = '400 24px "Share Tech Mono"';
  ctx.fillText(`HUM: ${row.humidity}%  ·  ${hair.sub}`, sbx + ICON_W + 18, hairDivY + 98);

  // ── TICKER — broadcast bar, INSIDE card border ──
  ctx.fillStyle = themeColor;
  ctx.fillRect(sbx, tickerY, sbw, TICKER_H);
  ctx.fillStyle = '#fff';
  ctx.font = '400 52px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('DRINK WATER  ·  ENJOY THE DAY', sbx + sbw / 2, tickerY + TICKER_H / 2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';

  return canvas;
}

// ── TEMPLATE: DAILY SLIDE 1 — Rating + Mood + Fit ──

async function drawDailySlide1(row) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const high = Math.round(row.high ?? row.temp);
  const score = row.score;
  const synopsis = row.synopsis_approved || '';
  const day = getNYCDay(), dateStr = getNYCDate();
  const themeColor = getThemeColor(high, row.precip_chance);
  const outfit  = outfitItems(high, row.precip_chance);
  const fitRep  = getRepresentativeFitItems(outfit);

  // Night outfit — only when high/low swing ≥ 15°F
  const low          = row.low != null ? Math.round(row.low) : null;
  const showNightFit = low != null && (high - low) >= 15;
  const nightOutfit  = showNightFit ? outfitItems(low, row.precip_chance) : [];
  const nightFitRep  = showNightFit ? getRepresentativeFitItems(nightOutfit) : [];

  let weatherIconImg = null;
  try { weatherIconImg = await loadImage(path.join(__dirname, `assets/${getWeatherIconFile(row.condition)}`)); } catch {}

  const fitIconImgs = await Promise.all(fitRep.map(async item => {
    const file = getFitIconFile(item);
    if (!file) return null;
    try { return await loadImage(path.join(__dirname, `assets/${file}`)); } catch { return null; }
  }));

  const nightFitIconImgs = await Promise.all(nightFitRep.map(async item => {
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

  // ── LAYOUT CONSTANTS ──
  const headerH  = 90;
  const BOX_PAD  = 12;
  const TICKER_H = 100;
  const tickerY  = H - TICKER_H;   // 1250
  const panelTop = 628;
  const bodyH    = tickerY - panelTop;
  const boxH     = Math.floor((bodyH - BOX_PAD * 3) / 2);
  const moodBoxY = panelTop + BOX_PAD;
  const fitBoxY  = moodBoxY + boxH + BOX_PAD;
  const moodH    = boxH;
  const FIT_H    = boxH;
  const SBR      = 8;
  const px = INSET + 20, pw = W - INSET * 2 - 40;
  const ICON_W   = 200;

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // ── HEADER ──
  ctx.fillStyle = '#0f0f0f';
  ctx.fillRect(0, 0, W, headerH);
  hline(ctx, headerH, '#333', 1, 0, W);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#cccccc';
  ctx.font = '400 28px "IBM Plex Mono"';
  ctx.textAlign = 'left';
  { const hm = ctx.measureText('classicnewweather');
    ctx.fillText('classicnewweather', INSET + 22, (headerH + hm.actualBoundingBoxAscent - hm.actualBoundingBoxDescent) / 2); }
  ctx.fillStyle = themeColor;
  ctx.font = '400 26px "IBM Plex Mono"';
  ctx.textAlign = 'right';
  { const dl = `${day}  ${dateStr}`;
    const dm = ctx.measureText(dl);
    ctx.fillText(dl, W - INSET - 22, (headerH + dm.actualBoundingBoxAscent - dm.actualBoundingBoxDescent) / 2); }

  // ── NEW YORK CITY ──
  ctx.fillStyle = themeColor;
  ctx.font = '400 148px "Bebas Neue", "Barlow Condensed BK"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('NEW YORK CITY', W / 2, headerH + 22);

  // ── SCORE SECTION ──
  const scoreTop  = 308;
  const outOf10Y  = 576;

  ctx.strokeStyle = themeColor; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(INSET + 20, scoreTop); ctx.lineTo(W - INSET - 20, scoreTop); ctx.stroke();
  ctx.fillStyle = '#aaa';
  ctx.font = '400 26px "IBM Plex Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(`HIGH ${high}°F`, W / 2, scoreTop + 14);

  ctx.fillStyle = themeColor;
  ctx.font = '400 280px "Bebas Neue", "Barlow Condensed BK"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const scoreStr = String(score);
  const sm = ctx.measureText(scoreStr);
  const scoreCx = W / 2 + (sm.actualBoundingBoxLeft - sm.actualBoundingBoxRight) / 2;
  const highBottom = scoreTop + 40;
  const zoneCenter = (highBottom + outOf10Y) / 2;
  const scoreCy = zoneCenter + (sm.actualBoundingBoxAscent - sm.actualBoundingBoxDescent) / 2;
  ctx.fillText(scoreStr, scoreCx, scoreCy);

  ctx.fillStyle = '#aaaaaa';
  ctx.font = '400 24px "IBM Plex Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('OUT OF 10', W / 2, outOf10Y);

  // ── MOOD BOX ──
  ctx.strokeStyle = themeColor; ctx.lineWidth = 2;
  roundRect(px, moodBoxY, pw, moodH, SBR);
  ctx.stroke();

  ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px + ICON_W, moodBoxY); ctx.lineTo(px + ICON_W, moodBoxY + moodH); ctx.stroke();

  const moodCy = moodBoxY + moodH / 2;
  if (weatherIconImg) {
    const iconSize = 160;
    const wic = createCanvas(iconSize, iconSize);
    const wictx = wic.getContext('2d');
    wictx.drawImage(weatherIconImg, 0, 0, iconSize, iconSize);
    const wd = wictx.getImageData(0, 0, iconSize, iconSize);
    for (let pi = 0; pi < wd.data.length; pi += 4) {
      if (wd.data[pi] < 30 && wd.data[pi + 1] < 30 && wd.data[pi + 2] < 30) wd.data[pi + 3] = 0;
    }
    wictx.putImageData(wd, 0, 0);
    ctx.drawImage(wic, px + Math.floor(ICON_W / 2) - Math.floor(iconSize / 2), moodCy - Math.floor(iconSize / 2));
  } else {
    weatherIcon(ctx, px + ICON_W / 2, moodCy, 160, row.condition);
  }

  // TODAY'S MOOD label — sits in the text column, right of the vertical divider
  const MOOD_LABEL_H = 52;
  ctx.fillStyle = themeColor;
  ctx.font = '400 30px "IBM Plex Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText("TODAY'S MOOD", px + ICON_W + 16, moodBoxY + 14);

  // Body copy vertically centered in remaining space below label — auto-scale font to fit
  const moodBodyMaxW = pw - ICON_W - 28;
  const moodText = (synopsis || 'CLASSICNEWWEATHER.COM').toUpperCase();
  const moodWords = moodText.split(' ');
  let moodFontSize = 50;
  let MOOD_LINE_H = 64;
  let maxMoodLines = 1;

  // Find largest font size where all text fits within the box height
  while (moodFontSize >= 24) {
    MOOD_LINE_H  = Math.round(moodFontSize * 1.28);
    maxMoodLines = Math.max(1, Math.floor((moodH - MOOD_LABEL_H - 8) / MOOD_LINE_H));
    ctx.font = `400 ${moodFontSize}px "IBM Plex Mono"`;
    let line = '', count = 0;
    for (let n = 0; n < moodWords.length; n++) {
      const test = line + moodWords[n] + ' ';
      if (ctx.measureText(test).width > moodBodyMaxW && n > 0) { count++; line = moodWords[n] + ' '; }
      else { line = test; }
    }
    if (line.trim()) count++;
    if (count <= maxMoodLines) break;
    moodFontSize -= 2;
  }

  // Count actual lines used for vertical centering
  ctx.font = `400 ${moodFontSize}px "IBM Plex Mono"`;
  let moodLine = '', moodLineCount = 0;
  for (let n = 0; n < moodWords.length; n++) {
    const test = moodLine + moodWords[n] + ' ';
    if (ctx.measureText(test).width > moodBodyMaxW && n > 0) {
      moodLineCount++;
      moodLine = moodWords[n] + ' ';
      if (moodLineCount >= maxMoodLines) break;
    } else { moodLine = test; }
  }
  if (moodLineCount < maxMoodLines) moodLineCount++;
  const moodBlockH = moodLineCount * MOOD_LINE_H;
  const availH = moodH - MOOD_LABEL_H;
  const moodBodyY = moodBoxY + MOOD_LABEL_H + Math.floor((availH - moodBlockH) / 2);
  ctx.fillStyle = '#fff';
  wrapText(ctx, moodText, px + ICON_W + 16, moodBodyY, moodBodyMaxW, MOOD_LINE_H, maxMoodLines);

  // ── FIT BOX ──
  ctx.strokeStyle = themeColor; ctx.lineWidth = 2;
  roundRect(px, fitBoxY, pw, FIT_H, SBR);
  ctx.stroke();

  const FIT_ICON_SZ  = 80, FIT_ICON_GAP = 16;
  const FIT_LABEL_H  = 36;
  const FIT_NAMES_H  = 48;

  // Helper: draw one half of the fit box (split / day-night mode only)
  function drawFitHalf(icons, items, startX, halfW, label, tempLabel) {
    const validImgs = icons.filter(Boolean);
    const ICON_SZ   = 68, ICON_GAP = 12, LABEL_H = FIT_LABEL_H, NAMES_H = 36;

    ctx.fillStyle = themeColor;
    ctx.font = '400 22px "IBM Plex Mono"';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(label, startX + halfW / 2, fitBoxY + 14);
    if (tempLabel) {
      ctx.fillStyle = '#666';
      ctx.font = '400 18px "IBM Plex Mono"';
      ctx.fillText(tempLabel, startX + halfW / 2, fitBoxY + 40);
    }

    const labelUsedH  = tempLabel ? LABEL_H + 20 : LABEL_H;
    const contentH    = FIT_H - labelUsedH - 14;
    const contentTopY = fitBoxY + labelUsedH + 14;
    const blockH      = ICON_SZ + 14 + NAMES_H;
    const bw          = validImgs.length * ICON_SZ + Math.max(0, validImgs.length - 1) * ICON_GAP;
    const iconsRowY   = contentTopY + Math.floor((contentH - blockH) / 2);
    const iconsRowX   = startX + Math.floor((halfW - bw) / 2);

    validImgs.forEach((img, i) => {
      const fic = createCanvas(ICON_SZ, ICON_SZ);
      const fictx = fic.getContext('2d');
      fictx.drawImage(img, 0, 0, ICON_SZ, ICON_SZ);
      const fd = fictx.getImageData(0, 0, ICON_SZ, ICON_SZ);
      for (let pi = 0; pi < fd.data.length; pi += 4) {
        if (fd.data[pi] > 210 && fd.data[pi + 1] > 210 && fd.data[pi + 2] > 210) fd.data[pi + 3] = 0;
      }
      fictx.putImageData(fd, 0, 0);
      ctx.drawImage(fic, iconsRowX + i * (ICON_SZ + ICON_GAP), iconsRowY);
    });

    const namesStr = items.join('  ·  ');
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let nf = 28;
    ctx.font = `400 ${nf}px "IBM Plex Mono"`;
    while (ctx.measureText(namesStr).width > halfW - 16 && nf > 14) { nf -= 2; ctx.font = `400 ${nf}px "IBM Plex Mono"`; }
    ctx.fillText(namesStr, startX + halfW / 2, iconsRowY + ICON_SZ + 14 + NAMES_H / 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  }

  if (showNightFit) {
    // Day/night split: two halves
    const halfW = Math.floor(pw / 2);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px + halfW, fitBoxY + 1); ctx.lineTo(px + halfW, fitBoxY + FIT_H - 1); ctx.stroke();
    drawFitHalf(fitIconImgs,      fitRep,      px,           halfW,             'DAY',   `HIGH ${high}°F`);
    drawFitHalf(nightFitIconImgs, nightFitRep, px + halfW,   Math.ceil(pw / 2), 'NIGHT', `LOW ${low}°F`);
  } else {
    // Single outfit: left column (ICON_W) = item 0, right section = remaining items in equal columns
    // "TODAY'S FIT" label aligns with "TODAY'S MOOD" at px + ICON_W + 16
    const n        = fitRep.length;
    const rightW   = pw - ICON_W;
    const rCols    = Math.max(1, n - 1);
    const rColW    = Math.floor(rightW / rCols);
    const iconSz   = FIT_ICON_SZ;  // 80px — full size
    const blockH   = iconSz + 12 + FIT_NAMES_H;
    const iconY    = fitBoxY + FIT_LABEL_H + Math.floor((FIT_H - FIT_LABEL_H - blockH) / 2);
    const nameY    = iconY + iconSz + 12;

    // Dividers
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px + ICON_W, fitBoxY); ctx.lineTo(px + ICON_W, fitBoxY + FIT_H); ctx.stroke();
    for (let i = 1; i < rCols; i++) {
      const dvx = px + ICON_W + i * rColW;
      ctx.beginPath(); ctx.moveTo(dvx, fitBoxY + 1); ctx.lineTo(dvx, fitBoxY + FIT_H - 1); ctx.stroke();
    }

    // "TODAY'S FIT" label — same x as "TODAY'S MOOD"
    ctx.fillStyle = themeColor;
    ctx.font = '400 26px "IBM Plex Mono"';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText("TODAY'S FIT", px + ICON_W + 16, fitBoxY + 14);

    // Draw each item in its column
    fitIconImgs.forEach((img, i) => {
      const colX = i === 0 ? px : px + ICON_W + (i - 1) * rColW;
      const colW = i === 0 ? ICON_W : rColW;
      const ix   = colX + Math.floor((colW - iconSz) / 2);

      if (img) {
        const fic = createCanvas(iconSz, iconSz);
        const fictx = fic.getContext('2d');
        fictx.drawImage(img, 0, 0, iconSz, iconSz);
        const fd = fictx.getImageData(0, 0, iconSz, iconSz);
        for (let pi = 0; pi < fd.data.length; pi += 4) {
          if (fd.data[pi] > 210 && fd.data[pi + 1] > 210 && fd.data[pi + 2] > 210) fd.data[pi + 3] = 0;
        }
        fictx.putImageData(fd, 0, 0);
        ctx.drawImage(fic, ix, iconY);
      }

      const name = fitRep[i] || '';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      let nf = 36;
      ctx.font = `400 ${nf}px "IBM Plex Mono"`;
      while (ctx.measureText(name).width > colW - 8 && nf > 14) { nf -= 2; ctx.font = `400 ${nf}px "IBM Plex Mono"`; }
      ctx.fillText(name, colX + Math.floor(colW / 2), nameY);
    });

    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  }

  // ── TICKER ──
  ctx.fillStyle = themeColor;
  ctx.fillRect(0, tickerY, W, TICKER_H);
  ctx.fillStyle = '#fff';
  ctx.font = '400 38px "IBM Plex Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('DRINK WATER  ·  ENJOY THE DAY', W / 2, tickerY + TICKER_H / 2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';

  return canvas;
}

// ── TEMPLATE: DAILY SLIDE 2 — Hair Forecast ──

async function drawDailySlide2(row) {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');
  const day    = getNYCDay(), dateStr = getNYCDate();
  const hum    = row.humidity;
  const rain   = row.precip_chance;

  // Per-condition color palette (replaces fixed green/gold system)
  const high = Math.round(row.high ?? row.temp);
  const s2   = getSlide2Colors(high, rain);

  // Hair level + copy
  let alertLevel, proceedText, recText;
  if (hum >= 85 || rain > 60) {
    alertLevel = 'SILK PRESS WARNING';  proceedText = 'PROCEED AT YOUR OWN RISK.';  recText = 'PUFF  ·  BRAIDS  ·  BUN';
  } else if (hum >= 75 || rain > 40) {
    alertLevel = 'HIGH HUMIDITY ALERT'; proceedText = 'MONITOR CLOSELY.';            recText = 'WASH & GO  ·  PROTECTIVE STYLE';
  } else if (hum >= 65 || rain > 25) {
    alertLevel = 'MODERATE RISK';       proceedText = 'PROCEED WITH CAUTION.';       recText = 'ANTI-HUMIDITY SPRAY  ·  BRAID OUT';
  } else if (hum >= 55) {
    alertLevel = 'LOW RISK';            proceedText = 'FRIZZ POSSIBLE.';             recText = 'SILK PRESS  ·  WASH & GO';
  } else {
    alertLevel = 'GOOD HAIR DAY';       proceedText = "YOU'RE GOOD.";                recText = 'SILK PRESS  ·  BLOWOUT  ·  ANY STYLE';
  }

  // Hair icons (3 files from existing helper)
  const hairIconFiles = getHairIconFilesForDisplay(hum, rain);
  const hairIconImgs  = await Promise.all(hairIconFiles.map(async f => {
    try { return await loadImage(path.join(__dirname, `assets/${f}`)); } catch { return null; }
  }));

  // ── BACKGROUND (green palette, subtle grain) ──
  ctx.fillStyle = s2.bg; ctx.fillRect(0, 0, W, H);
  const grainImg = ctx.getImageData(0, 0, W, H);
  let rv = 0x5F3759DF;
  function grainRand() { rv ^= rv << 13; rv ^= rv >> 17; rv ^= rv << 5; return (rv >>> 0) / 0xFFFFFFFF; }
  for (let i = 0; i < 14000; i++) {
    const gx = Math.floor(grainRand() * W);
    const gy = Math.floor(grainRand() * H);
    const gb = Math.floor(grainRand() * 18);
    const idx = (gy * W + gx) * 4;
    grainImg.data[idx]     = Math.min(255, grainImg.data[idx]     + gb);
    grainImg.data[idx + 1] = Math.min(255, grainImg.data[idx + 1] + gb);
    grainImg.data[idx + 2] = Math.min(255, grainImg.data[idx + 2] + gb);
  }
  ctx.putImageData(grainImg, 0, 0);

  // ── LAYOUT CONSTANTS ──
  const headerH   = 90;
  const TICKER_H  = 90;
  const tickerY   = H - TICKER_H;  // 1260
  const marginX   = INSET + 40;    // 58px left/right margin
  const hlMaxW    = W - marginX * 2;
  const HL_LINE_H = 122;
  const LABEL_H   = 36;  // section label line height (z2, z3)
  const TITLE_H   = 80;  // slide title "HAIR FORECAST" (z1)
  const LABEL_GAP = 18;  // gap below label

  // ── HEADER ──
  ctx.fillStyle = s2.border;
  ctx.fillRect(0, 0, W, headerH);
  hline(ctx, headerH, s2.border, 1, 0, W);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = s2.secondary;
  ctx.font = '400 28px "IBM Plex Mono"';
  ctx.textAlign = 'left';
  { const hm = ctx.measureText('classicnewweather');
    ctx.fillText('classicnewweather', INSET + 22, (headerH + hm.actualBoundingBoxAscent - hm.actualBoundingBoxDescent) / 2); }
  ctx.fillStyle = s2.accent;
  ctx.font = '400 26px "IBM Plex Mono"';
  ctx.textAlign = 'right';
  { const dl = `${day}  ${dateStr}`;
    const dm = ctx.measureText(dl);
    ctx.fillText(dl, W - INSET - 22, (headerH + dm.actualBoundingBoxAscent - dm.actualBoundingBoxDescent) / 2); }

  // ── MEASURE HEADLINE (dry run) to compute zone heights ──
  ctx.font = '400 110px "Bebas Neue", "Barlow Condensed BK"';
  const hlLineCount = measureLines(ctx, alertLevel, hlMaxW);

  // Zone heights
  const z1H = TITLE_H + LABEL_GAP + hlLineCount * HL_LINE_H;
  const z2H = LABEL_H + LABEL_GAP + 176 + 16 + 34;  // label + hum number + gap + proceed text
  const z3H = LABEL_H + LABEL_GAP + 180 + 16 + 42;  // label + single icon + gap + rec text

  // Center zone block; shrink gap if needed
  const contentTop = headerH + 40;
  const contentBot = tickerY - 40;
  const ZONE_GAP   = Math.min(80, Math.floor((contentBot - contentTop - z1H - z2H - z3H) / 2));
  const blockH     = z1H + ZONE_GAP + z2H + ZONE_GAP + z3H;
  const blockStart = contentTop + Math.floor((contentBot - contentTop - blockH) / 2);

  const z1Y = blockStart;
  const z2Y = z1Y + z1H + ZONE_GAP;
  const z3Y = z2Y + z2H + ZONE_GAP;

  // ── ZONE 1: HAIR FORECAST title + alert headline ──
  ctx.fillStyle = s2.accent;
  ctx.font = '400 72px "Bebas Neue", "Barlow Condensed BK"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('HAIR FORECAST', W / 2, z1Y);

  ctx.font = '400 110px "Bebas Neue", "Barlow Condensed BK"';
  ctx.fillStyle = s2.accent;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  wrapText(ctx, alertLevel, W / 2, z1Y + TITLE_H + LABEL_GAP, hlMaxW, HL_LINE_H);

  // ── ZONE 2: HUMIDITY stat ──
  ctx.fillStyle = s2.secondary;
  ctx.font = '400 26px "IBM Plex Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('HUMIDITY', W / 2, z2Y);

  ctx.fillStyle = s2.accent;
  ctx.font = '400 160px "Bebas Neue", "Barlow Condensed BK"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(`${hum}%`, W / 2, z2Y + LABEL_H + LABEL_GAP);

  ctx.fillStyle = s2.secondary;
  ctx.font = '400 28px "IBM Plex Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(proceedText, W / 2, z2Y + LABEL_H + LABEL_GAP + 176 + 16);

  // ── ZONE 3: Alternative recommendation ──
  ctx.fillStyle = s2.accent;
  ctx.font = '400 22px "IBM Plex Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('ALTERNATIVE RECOMMENDATION', W / 2, z3Y);

  // Single hair icon — scaled up, centered
  const HAIR_ICN = 180;
  const firstHairImg = hairIconImgs.find(Boolean);
  const iconsY = z3Y + LABEL_H + LABEL_GAP;
  if (firstHairImg) {
    ctx.drawImage(firstHairImg, Math.floor((W - HAIR_ICN) / 2), iconsY, HAIR_ICN, HAIR_ICN);
  }

  // Rec text centered below icons
  ctx.fillStyle = s2.accent;
  ctx.font = '400 34px "IBM Plex Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(recText, W / 2, iconsY + HAIR_ICN + 16);

  // ── TICKER — border-tint bg, accent top border, accent text ──
  ctx.fillStyle = s2.border;
  ctx.fillRect(0, tickerY, W, TICKER_H);
  ctx.fillStyle = s2.accent;
  ctx.fillRect(0, tickerY, W, 2);  // accent top border
  const tickerItems = ['STAY SMOOTH.', 'CHECK THE FORECAST.', 'DRINK WATER.'];
  ctx.fillStyle = s2.accent;
  ctx.font = '400 26px "IBM Plex Mono"';
  ctx.textBaseline = 'middle';
  const tickerCy = tickerY + TICKER_H / 2;
  ctx.textAlign = 'left';   ctx.fillText(tickerItems[0], marginX,     tickerCy);
  ctx.textAlign = 'center'; ctx.fillText(tickerItems[1], W / 2,       tickerCy);
  ctx.textAlign = 'right';  ctx.fillText(tickerItems[2], W - marginX, tickerCy);
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
  const hairIconFiles = getHairIconFilesForDisplay(row.humidity, row.precip_chance);
  const hairIconImgs  = await Promise.all(hairIconFiles.map(async f => {
    try { return await loadImage(path.join(__dirname, `assets/${f}`)); } catch { return null; }
  }));
  const fitRep = getRepresentativeFitItems(outfit);
  const fitIconImgsW = await Promise.all(fitRep.map(async item => {
    const file = getFitIconFile(item);
    if (!file) return null;
    try { return await loadImage(path.join(__dirname, `assets/${file}`)); } catch { return null; }
  }));
  const forecast = Array.isArray(row.forecast) ? row.forecast.slice(0, 5) : [];
  const day = getNYCDay(), dateStr = getNYCDate();
  const themeColor = getThemeColor(high, row.precip_chance);

  let weatherIconImg = null;
  try { weatherIconImg = await loadImage(path.join(__dirname, `assets/${getWeatherIconFile(row.condition)}`)); } catch {}

  // ── BACKGROUND — charcoal ──
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, W, H);

  // ── HEADER ──
  const headerH = 135;
  ctx.fillStyle = '#0d0d0d'; ctx.fillRect(0, 0, W, headerH);
  hline(ctx, headerH, '#2a2a2a', 1, 0, W);
  ctx.fillStyle = '#cccccc';
  ctx.font = '400 36px "Share Tech Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('classicnewweather', INSET + 22, headerH / 2);
  ctx.fillStyle = themeColor;
  ctx.font = '400 32px "Share Tech Mono"';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText(`${day}  ${dateStr}`, W - INSET - 22, headerH / 2);

  // ── NEW YORK CITY ──
  ctx.fillStyle = themeColor;
  ctx.font = '400 130px "Bebas Neue", "Barlow Condensed BK"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('NEW YORK CITY', W / 2, headerH + 10);

  // ── SCORE SECTION ──
  const scoreTop = headerH + 148;
  ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(INSET + 20, scoreTop + 3); ctx.lineTo(W - INSET - 20, scoreTop + 3); ctx.stroke();
  ctx.fillStyle = '#aaaaaa';
  ctx.font = '400 32px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(`HIGH ${high}°F`, W / 2, scoreTop + 14);

  // Score — centered
  ctx.fillStyle = themeColor;
  ctx.font = '400 175px "Bebas Neue", "Barlow Condensed BK"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(String(score), W / 2, scoreTop + 44);

  // Weather icon — right side
  const iconSize = 90;
  const iconCx = W - INSET - 70;
  const iconCy = scoreTop + 44 + 86;
  if (weatherIconImg) {
    const wic = createCanvas(iconSize, iconSize);
    const wictx = wic.getContext('2d');
    wictx.drawImage(weatherIconImg, 0, 0, iconSize, iconSize);
    const wd = wictx.getImageData(0, 0, iconSize, iconSize);
    for (let pi = 0; pi < wd.data.length; pi += 4) {
      if (wd.data[pi] < 30 && wd.data[pi + 1] < 30 && wd.data[pi + 2] < 30) wd.data[pi + 3] = 0;
    }
    wictx.putImageData(wd, 0, 0);
    ctx.drawImage(wic, iconCx - iconSize / 2, iconCy - iconSize / 2);
  } else {
    weatherIcon(ctx, iconCx, iconCy, 60, row.condition);
  }

  // Condition label + OUT OF 10
  const condY = scoreTop + 244;
  ctx.fillStyle = '#aaaaaa';
  ctx.font = '400 26px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('OUT OF 10', W / 2, condY);
  ctx.fillText(conditionLabel(row.condition).toUpperCase(), W / 2, condY + 34);

  // ── 3-PANEL ROW ──
  const panelTop = condY + 76;
  hline(ctx, panelTop - 8, '#2a2a2a', 1);
  const panW = Math.floor((W - INSET * 2 - 40 - 6) / 3);
  const panH = 250;
  const panX0 = INSET + 20;
  const cols = [panX0, panX0 + panW + 3, panX0 + (panW + 3) * 2];

  // TODAY'S MOOD
  panel(ctx, cols[0], panelTop, panW, panH, '', '#2a2a2a');
  ctx.fillStyle = '#0d0d0d'; ctx.fillRect(cols[0] + 1, panelTop + 1, panW - 2, 30);
  ctx.fillStyle = themeColor; ctx.font = '700 22px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText("TODAY'S MOOD", cols[0] + panW / 2, panelTop + 16);
  // Auto-scale mood text to fit panel height (panH - 40px header = ~210px available)
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  {
    const moodBodyMaxW = panW - 16;
    const moodBodyAvailH = panH - 40;
    const moodBodyText = synopsis || '—';
    const moodWords = moodBodyText.split(' ');
    let moodFontSize = 27;
    let moodLineH = 34;
    let moodMaxLines = 5;
    while (moodFontSize >= 14) {
      moodLineH = Math.round(moodFontSize * 1.26);
      moodMaxLines = Math.max(1, Math.floor(moodBodyAvailH / moodLineH));
      ctx.font = `400 ${moodFontSize}px "Share Tech Mono"`;
      let line = '', count = 0;
      for (let n = 0; n < moodWords.length; n++) {
        const test = line + moodWords[n] + ' ';
        if (ctx.measureText(test).width > moodBodyMaxW && n > 0) { count++; line = moodWords[n] + ' '; }
        else { line = test; }
      }
      if (line.trim()) count++;
      if (count <= moodMaxLines) break;
      moodFontSize -= 2;
    }
    ctx.fillStyle = '#dddddd';
    wrapText(ctx, moodBodyText, cols[0] + panW / 2, panelTop + 40, moodBodyMaxW, moodLineH, moodMaxLines);
  }

  // FIT CHECK — icons + names
  panel(ctx, cols[1], panelTop, panW, panH, '', '#2a2a2a');
  ctx.fillStyle = '#0d0d0d'; ctx.fillRect(cols[1] + 1, panelTop + 1, panW - 2, 30);
  ctx.fillStyle = themeColor; ctx.font = '700 22px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('FIT CHECK', cols[1] + panW / 2, panelTop + 16);
  {
    const validFitW = fitIconImgsW.filter(Boolean);
    const FW_ICN = 70, FW_GAP = 14;
    const icnBlockW = validFitW.length * FW_ICN + Math.max(0, validFitW.length - 1) * FW_GAP;
    const icnBlockH = FW_ICN + 12 + 24;
    const icnY0 = panelTop + 30 + Math.floor((panH - 30 - icnBlockH) / 2);
    const icnX0 = cols[1] + Math.floor((panW - icnBlockW) / 2);
    validFitW.forEach((img, i) => {
      const fic = createCanvas(FW_ICN, FW_ICN);
      const fictx = fic.getContext('2d');
      fictx.drawImage(img, 0, 0, FW_ICN, FW_ICN);
      const fd = fictx.getImageData(0, 0, FW_ICN, FW_ICN);
      for (let pi = 0; pi < fd.data.length; pi += 4) {
        if (fd.data[pi] > 210 && fd.data[pi + 1] > 210 && fd.data[pi + 2] > 210) fd.data[pi + 3] = 0;
      }
      fictx.putImageData(fd, 0, 0);
      ctx.drawImage(fic, icnX0 + i * (FW_ICN + FW_GAP), icnY0);
    });
    ctx.fillStyle = '#dddddd'; ctx.font = '400 20px "Share Tech Mono"';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(fitRep.join('  ·  '), cols[1] + panW / 2, icnY0 + FW_ICN + 12);
  }

  // HAIR REPORT
  panel(ctx, cols[2], panelTop, panW, panH, '', '#2a2a2a');
  ctx.fillStyle = '#0d0d0d'; ctx.fillRect(cols[2] + 1, panelTop + 1, panW - 2, 30);
  ctx.fillStyle = themeColor; ctx.font = '700 22px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('HAIR REPORT', cols[2] + panW / 2, panelTop + 16);
  // Level — centered, larger text
  ctx.fillStyle = '#dddddd'; ctx.font = '700 24px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  wrapText(ctx, hair.level, cols[2] + panW / 2, panelTop + 46, panW - 16, 30, 2);
  // Humidity — centered
  ctx.fillStyle = '#aaaaaa'; ctx.font = '400 18px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(`HUM: ${row.humidity}%`, cols[2] + panW / 2, panelTop + 114);
  // Hair icon — centered in remaining space
  const ICN = 100;
  const firstValidImg = hairIconImgs.find(Boolean);
  if (firstValidImg) {
    const icnX = cols[2] + Math.floor((panW - ICN) / 2);
    const icnY = panelTop + panH - ICN - 18;
    ctx.drawImage(firstValidImg, icnX, icnY, ICN, ICN);
  }

  // ── THE WEEK AHEAD ──
  const wkY = panelTop + panH + 20;
  hline(ctx, wkY, '#2a2a2a', 1);

  ctx.fillStyle = themeColor;
  ctx.font = '400 64px "Bebas Neue", "Barlow Condensed BK"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('THE WEEK AHEAD', INSET + 28, wkY + 10);
  ctx.fillStyle = '#aaaaaa';
  ctx.font = '400 18px "Share Tech Mono"';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText('NEW YORK CITY', W - INSET - 28, wkY + 42);

  hline(ctx, wkY + 88, '#2a2a2a', 1);

  // 5-day forecast grid
  const dayW = (W - INSET * 2 - 40) / 5;
  const gridTop = wkY + 106;

  forecast.forEach((f, i) => {
    const fx = INSET + 20 + i * dayW;
    const cx = fx + dayW / 2;
    const isRainy = f.rain >= 45;

    // Day name
    ctx.fillStyle = i === 0 ? themeColor : '#666666';
    ctx.font = '400 48px "Bebas Neue", "Barlow Condensed BK"';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(f.day.toUpperCase(), cx, gridTop);

    // Weather icon
    weatherIcon(ctx, cx, gridTop + 72, 56, f.rain > 50 ? 'rain' : 'clear');

    // Temperature
    ctx.fillStyle = isRainy ? '#4488cc' : (i === 0 ? '#ffffff' : '#aaaaaa');
    ctx.font = '400 96px "Bebas Neue", "Barlow Condensed BK"';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(`${Math.round(f.high)}°`, cx, gridTop + 112);

    // Rain %
    ctx.fillStyle = isRainy ? '#4488cc' : '#666666';
    ctx.font = '400 22px "Share Tech Mono"';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(f.rain > 0 ? `${f.rain}% rain` : 'dry', cx, gridTop + 222);

    // Vertical divider
    if (i < forecast.length - 1) {
      ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fx + dayW, gridTop - 10);
      ctx.lineTo(fx + dayW, gridTop + 256);
      ctx.stroke();
    }
  });

  hline(ctx, gridTop + 268, '#2a2a2a', 1);
  ctx.fillStyle = '#aaaaaa';
  ctx.font = '400 18px "Share Tech Mono"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('classicnewweather.com', W / 2, gridTop + 294);

  // ── TICKER ──
  const WTICKER_Y = H - 52;
  ctx.fillStyle = themeColor;
  ctx.fillRect(0, WTICKER_Y, W, 52);
  ctx.font = '500 21px "Share Tech Mono"';
  ctx.textBaseline = 'middle';
  const wTickerCy = WTICKER_Y + 26;
  const wItems = ['STAY COOL', 'DRINK WATER', 'ENJOY THE DAY', 'START YOUR WEEK RIGHT'];
  const wSep = '  ·  ';
  const wSepW = ctx.measureText(wSep).width;
  const wTotalW = wItems.reduce((s, t) => s + ctx.measureText(t).width, 0) + wSepW * (wItems.length - 1);
  let wTickerX = Math.floor((W - wTotalW) / 2);
  wItems.forEach((item, i) => {
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(item, wTickerX, wTickerCy);
    wTickerX += ctx.measureText(item).width;
    if (i < wItems.length - 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(wSep, wTickerX, wTickerCy);
      wTickerX += wSepW;
    }
  });

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
  if (level === 'SILK PRESS WARNING')  return [0, 3, 5];   // Natural Puff, Box Braids, High Bun
  if (level === 'HIGH HUMIDITY ALERT') return [15, 4, 11]; // Wash-and-Go, Cornrows, Bantu Knots
  if (level === 'MODERATE RISK')       return [10, 4, 3];  // Twist Out, Cornrows, Box Braids
  if (level === 'LOW RISK')            return [7, 10, 14]; // Silk Press, Twist Out, Curly Fro
  return [7, 8, 14]; // GOOD HAIR DAY: Silk Press, Blowout, Curly Fro
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

  // Hair icons — individual PNGs (already have transparent backgrounds)
  const hairIconFiles = getHairIconFilesForDisplay(row.humidity, row.precip_chance);
  const loadedHairImgs = await Promise.all(
    hairIconFiles.map(async f => { try { return await loadImage(path.join(__dirname, `assets/${f}`)); } catch { return null; } })
  );
  const validHairImgs = loadedHairImgs.filter(Boolean);
  if (validHairImgs.length > 0) {
    const ICN_SZ = 76, icnGap = 12;
    const totalIconW = validHairImgs.length * ICN_SZ + (validHairImgs.length - 1) * icnGap;
    const icnStartX  = icnAreaX + (ICN_AREA_W - totalIconW) / 2;
    const icnY       = ALT_Y + (ALT_H - ICN_SZ) / 2;
    validHairImgs.forEach((img, i) => {
      ctx.drawImage(img, icnStartX + i * (ICN_SZ + icnGap), icnY, ICN_SZ, ICN_SZ);
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

// ── TEMPLATE 7: PROGRESS UPDATE ──

async function drawProgressUpdate(data) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const issue   = data.issue   || 1;
  const updates = (data.updates || []).slice(0, 4);
  const nextUp  = data.nextUp  || [];
  const dateStr = data.date    || getNYCDate();

  // ── COLORWAY ──
  const COLORWAYS = {
    classic:   { bg: '#0a0a0a', bar: '#CC3300', border: '#CC3300', title1: '#ffffff', title2: '#CC3300', hdr: '#111111', ticker: '#CC3300' },
    midnight:  { bg: '#060a14', bar: '#1a3464', border: '#2255aa', title1: '#ffffff', title2: '#4488ee', hdr: '#0a0e18', ticker: '#1a3464' },
    ember:     { bg: '#0e0804', bar: '#994400', border: '#cc5500', title1: '#ffffff', title2: '#ff6622', hdr: '#150e08', ticker: '#994400' },
    gold:      { bg: '#0c0a04', bar: '#7a5500', border: '#cc9900', title1: '#ffffff', title2: '#F0B800', hdr: '#121006', ticker: '#7a5500' },
  };
  const COLORWAY_ORDER = ['classic', 'midnight', 'ember', 'gold'];
  const cwKey = data.colorway || COLORWAY_ORDER[(issue - 1) % COLORWAY_ORDER.length];
  const cw = COLORWAYS[cwKey] || COLORWAYS.classic;

  // ── BACKGROUND + GRAIN ──
  ctx.fillStyle = cw.bg; ctx.fillRect(0, 0, W, H);
  const grainImg = ctx.getImageData(0, 0, W, H);
  let rv = 0x5F3759DF;
  function grainRand() { rv ^= rv << 13; rv ^= rv >> 17; rv ^= rv << 5; return (rv >>> 0) / 0xFFFFFFFF; }
  for (let i = 0; i < 18000; i++) {
    const gx = Math.floor(grainRand() * W);
    const gy = Math.floor(grainRand() * H);
    const gb = Math.floor(grainRand() * 25);
    const idx = (gy * W + gx) * 4;
    grainImg.data[idx]     = Math.min(255, grainImg.data[idx]     + gb);
    grainImg.data[idx + 1] = Math.min(255, grainImg.data[idx + 1] + gb);
    grainImg.data[idx + 2] = Math.min(255, grainImg.data[idx + 2] + gb);
  }
  ctx.putImageData(grainImg, 0, 0);
  scanlines(ctx);
  border(ctx, cw.border, INSET, 3);

  // ── LAYOUT CONSTANTS ──
  // Title block: two 140px Bebas lines stacked, each ~100px visible cap height
  // UPDATES bottom ≈ titleY + 140 + 100 = titleY + 240 → divider at titleY + 260
  const PAD       = 40;
  const HDR_Y     = INSET;
  const HDR_H     = 96;
  const ISSUE_Y   = HDR_Y + HDR_H;       // 114
  const ISSUE_H   = 52;
  const TITLE_Y   = ISSUE_Y + ISSUE_H;   // 166
  const TITLE_FSZ = 140;                 // Bebas Neue font size
  const titleX    = INSET + PAD;
  const titleY    = TITLE_Y + 16;        // 182
  const DIV_Y     = titleY + TITLE_FSZ + TITLE_FSZ + 20; // 182+140+140+20 = 482
  const ROWS_Y    = DIV_Y + 14;          // 496
  const TICK_H    = 65;
  const NEXT_H    = 90;
  const NEXT_Y    = H - TICK_H - NEXT_H; // 1195
  const ROWS_H    = NEXT_Y - ROWS_Y;     // 699

  const n    = Math.max(1, Math.min(4, updates.length));
  const rowH = Math.floor(ROWS_H / n);

  // ── HEADER ──
  ctx.fillStyle = cw.hdr;
  ctx.fillRect(INSET, HDR_Y, W - INSET * 2, HDR_H);

  let logoImg = null;
  try { logoImg = await loadImage(path.join(__dirname, 'assets/logo.png')); } catch {}

  const LOGO_SZ = 60;
  const logoX = INSET + PAD;
  const logoY = HDR_Y + Math.floor((HDR_H - LOGO_SZ) / 2);

  if (logoImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(logoX + LOGO_SZ / 2, logoY + LOGO_SZ / 2, LOGO_SZ / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logoImg, logoX, logoY, LOGO_SZ, LOGO_SZ);
    ctx.restore();
    // Single-line brand name
    const wx = logoX + LOGO_SZ + 14;
    ctx.fillStyle = '#f0f0f0';
    ctx.font = '400 22px "Barlow Condensed BK"';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('classicnewweather', wx, HDR_Y + HDR_H / 2);
  } else {
    logo(ctx, logoX, HDR_Y + Math.floor((HDR_H - 44) / 2), 1.0);
  }

  // Tagline right
  ctx.fillStyle = '#555';
  ctx.font = '400 13px "Share Tech Mono"';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText("THE CULTURE'S WEATHER CHANNEL", W - INSET - PAD, HDR_Y + HDR_H / 2);

  // Header bottom rule
  ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(INSET, ISSUE_Y); ctx.lineTo(W - INSET, ISSUE_Y); ctx.stroke();

  // ── ISSUE BAR ──
  ctx.fillStyle = cw.bar;
  ctx.fillRect(INSET, ISSUE_Y, W - INSET * 2, ISSUE_H);

  const issueNum = String(issue).padStart(2, '0');
  ctx.fillStyle = '#fff';
  ctx.font = '400 18px "Share Tech Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(`\u2116${issueNum} \u00B7 PROGRESS UPDATES`, INSET + PAD, ISSUE_Y + ISSUE_H / 2);

  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '400 14px "Share Tech Mono"';
  ctx.textAlign = 'right';
  ctx.fillText(dateStr, W - INSET - PAD, ISSUE_Y + ISSUE_H / 2);

  // ── TITLE BLOCK ──
  // Two stacked lines: full TITLE_FSZ line-height between tops so they don't overlap
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.font = `400 ${TITLE_FSZ}px "Bebas Neue", "Barlow Condensed BK"`;

  ctx.fillStyle = cw.title1;
  ctx.fillText('PROGRESS', titleX, titleY);

  ctx.fillStyle = cw.title2;
  ctx.fillText('UPDATES', titleX, titleY + TITLE_FSZ);

  // ── DIVIDER — drawn AFTER both title words end ──
  ctx.strokeStyle = cw.border; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(INSET + PAD, DIV_Y);
  ctx.lineTo(W - INSET - PAD, DIV_Y);
  ctx.stroke();

  // ── LOAD ICONS — rotate through pool based on issue number ──
  const PROGRESS_ICONS = ['skyline.png', 'thermostat.png', 'droplet.png', 'caution.png', 'megaphone.png', 'alert.png'];
  const iconImgs = await Promise.all(updates.map(async (_, i) => {
    const file = PROGRESS_ICONS[((issue - 1) + i) % PROGRESS_ICONS.length];
    try { return await loadImage(path.join(__dirname, `assets/${file}`)); } catch { return null; }
  }));

  // ── UPDATE ROWS ──
  const ICON_SZ   = 100;
  const ICON_COL  = INSET + PAD;
  const TEXT_X    = ICON_COL + ICON_SZ + 32;
  const TEXT_W    = W - INSET - PAD - TEXT_X;
  const ROW_TITLE = 52;  // px — Barlow Condensed BK
  const ROW_DESC  = 24;  // px — Share Tech Mono
  const ROW_LH    = ROW_DESC + 8;

  for (let i = 0; i < n; i++) {
    const update = updates[i];
    const ry = ROWS_Y + i * rowH;

    // Row divider
    if (i > 0) {
      ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(INSET + PAD, ry);
      ctx.lineTo(W - INSET - PAD, ry);
      ctx.stroke();
    }

    // Icon — vertically centered
    const iconImg = iconImgs[i];
    const iconY = ry + Math.floor((rowH - ICON_SZ) / 2);
    if (iconImg) {
      const ic = createCanvas(ICON_SZ, ICON_SZ);
      const ictx = ic.getContext('2d');
      ictx.drawImage(iconImg, 0, 0, ICON_SZ, ICON_SZ);
      const id = ictx.getImageData(0, 0, ICON_SZ, ICON_SZ);
      for (let pi = 0; pi < id.data.length; pi += 4) {
        if (id.data[pi] < 30 && id.data[pi + 1] < 30 && id.data[pi + 2] < 30) id.data[pi + 3] = 0;
      }
      ictx.putImageData(id, 0, 0);
      ctx.drawImage(ic, ICON_COL, iconY);
    } else {
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(ICON_COL + ICON_SZ / 2, ry + rowH / 2, 12, 0, Math.PI * 2);
      ctx.fill();
    }

    // Text block — vertically centered, sized to content
    const descText   = update.desc || '';
    const descLCount = Math.min(3, measureLines(ctx, descText, TEXT_W) || 1);
    ctx.font = `400 ${ROW_DESC}px "Share Tech Mono"`; // set font before measureLines
    const descLinesN = Math.min(3, measureLines(ctx, descText, TEXT_W) || 1);
    const blockH     = ROW_TITLE + 10 + ROW_LH * descLinesN;
    const textTopY   = ry + Math.floor((rowH - blockH) / 2);

    ctx.fillStyle = '#ffffff';
    ctx.font = `400 ${ROW_TITLE}px "Barlow Condensed BK"`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText((update.title || '').toUpperCase(), TEXT_X, textTopY);

    ctx.fillStyle = '#999';
    ctx.font = `400 ${ROW_DESC}px "Share Tech Mono"`;
    wrapText(ctx, descText, TEXT_X, textTopY + ROW_TITLE + 10, TEXT_W, ROW_LH, 2);
  }

  // ── NEXT UP BAR ──
  // Inset fills by border width (3px) on each side so the border rect stays visible
  const BW          = 3;
  const NEXT_LABEL_H = 36;
  ctx.fillStyle = cw.bar;
  ctx.fillRect(INSET + BW, NEXT_Y, W - INSET * 2 - BW * 2, NEXT_LABEL_H);

  ctx.fillStyle = '#fff';
  ctx.font = '400 14px "Share Tech Mono"';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('NEXT UP', INSET + PAD, NEXT_Y + NEXT_LABEL_H / 2);

  ctx.fillStyle = '#0e0e0e';
  ctx.fillRect(INSET + BW, NEXT_Y + NEXT_LABEL_H, W - INSET * 2 - BW * 2, NEXT_H - NEXT_LABEL_H);

  if (nextUp.length > 0) {
    ctx.fillStyle = '#d0d0d0';
    ctx.font = '400 26px "Barlow Condensed BK"';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const items = nextUp.slice(0, 3).map(s => s.toUpperCase()).join('  \u00B7  ');
    ctx.fillText(items, INSET + PAD, NEXT_Y + NEXT_LABEL_H + (NEXT_H - NEXT_LABEL_H) / 2);
  }

  // ── TICKER ──
  ticker(ctx, "THE CULTURE'S WEATHER CHANNEL  \u00B7  CLASSICNEWWEATHER.COM", cw.ticker);

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
  let feedBuffer, storyBuffer, slide2Buffer = null;

  if (type === 'daily') {
    // Generate both carousel slides in parallel
    const [slide1Canvas, slide2Canvas] = await Promise.all([
      drawDailySlide1(row),
      drawDailySlide2(row)
    ]);
    feedBuffer = await slide1Canvas.encode('png');
    slide2Buffer = await slide2Canvas.encode('png');

    // Story: slide 1 centered in 9:16 frame
    const storyCanvas = createCanvas(1080, 1920);
    const sCtx = storyCanvas.getContext('2d');
    sCtx.fillStyle = BG;
    sCtx.fillRect(0, 0, 1080, 1920);
    sCtx.drawImage(slide1Canvas, 0, (1920 - 1350) / 2);
    storyBuffer = await storyCanvas.encode('png');
  } else {
    const renderers = { weekly: drawWeekly, alert: drawAlert, hair: drawHair, teaser: drawTeaser, dashboard: drawDashboard };
    const fn = renderers[type] || drawDaily;
    const feedCanvas = await fn(row);
    feedBuffer = await feedCanvas.encode('png');

    const storyCanvas = createCanvas(1080, 1920);
    const sCtx = storyCanvas.getContext('2d');
    sCtx.fillStyle = type === 'teaser' ? '#000' : BG;
    sCtx.fillRect(0, 0, 1080, 1920);
    sCtx.drawImage(feedCanvas, 0, (1920 - 1350) / 2);
    storyBuffer = await storyCanvas.encode('png');
  }

  const slug = type === 'daily' ? dateKey : `${dateKey}-${type}`;
  const uploadJobs = [
    uploadImage(feedBuffer, type === 'daily' ? `${slug}-daily-slide1.png` : `${slug}-feed.png`),
    uploadImage(storyBuffer, `${slug}.png`)
  ];
  if (slide2Buffer) uploadJobs.push(uploadImage(slide2Buffer, `${slug}-daily-slide2.png`));

  const urls = await Promise.all(uploadJobs);
  const feedImageUrl  = urls[0];
  const storyImageUrl = urls[1];
  const slide2Url     = slide2Buffer ? urls[2] : null;

  // Save to Supabase (only update feed/story URLs for daily/weekly — others are on-demand)
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

  return { feedImageUrl, storyImageUrl, slide2Url };
}

exports.generateAndUpload  = generateAndUpload;
exports.drawDailySlide1    = drawDailySlide1;
exports.drawDailySlide2    = drawDailySlide2;
exports.drawWeekly         = drawWeekly;
exports.drawAlert          = drawAlert;
exports.drawHair           = drawHair;
exports.drawTeaser         = drawTeaser;
exports.drawDashboard      = drawDashboard;
exports.drawProgressUpdate = drawProgressUpdate;

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

    const { feedImageUrl, storyImageUrl, slide2Url } = await generateAndUpload(rows[0], dateKey, type);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, type, feedImageUrl, storyImageUrl, slide2Url }) };
  } catch (err) {
    console.error('generate-ig-graphic error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
