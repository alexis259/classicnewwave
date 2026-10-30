// netlify/functions/nws.js
// National Weather Service forecast for NYC, used for the daily HIGH and the
// SKY. OpenWeatherMap supplies everything else (current temp, humidity, wind,
// rain chance).
//
// Why: on Oct 30 OWM's forecast had a 63.6° high and broken clouds, and the
// day was sunny near 70° (NWS said 69°, Sunny). OWM builds each day's high from
// a few 3-hourly slots, and for later days from the single slot nearest noon,
// which misses the afternoon peak. NWS is the official forecast, free, needs
// no key, and the site already uses api.weather.gov for alerts.
//
// Everything here degrades to "no NWS data" (null) rather than throwing, so a
// NWS outage just means the OWM numbers are used, as before.

const OKX_GRID = 'OKX/33,42'; // NWS grid cell for lower Manhattan (api.weather.gov/points/40.7128,-74.0060)
const BASE = `https://api.weather.gov/gridpoints/${OKX_GRID}`;
// NWS requires an identifying User-Agent. No personal contact details in it.
const HEADERS = { 'User-Agent': 'classicnewweather.com weather site', 'Accept': 'application/geo+json' };
const TIMEOUT_MS = 4000;

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNWS() {
  try {
    const [hourly, daily] = await Promise.all([getJson(`${BASE}/forecast/hourly`), getJson(`${BASE}/forecast`)]);
    return { hourly: hourly.properties.periods, daily: daily.properties.periods };
  } catch (e) {
    console.warn('nws: unavailable, using OpenWeatherMap values:', e.message);
    return null;
  }
}

// NWS "shortForecast" -> an OWM-style description, so the icons, the
// "overcast" scoring rule and the copy all keep working unchanged. Returns null
// for precipitation, fog and haze: those stay with OWM, which also supplies the
// rain chance they have to agree with.
function nwsConditionFor(shortForecast) {
  const s = String(shortForecast || '').toLowerCase().trim();
  if (!s) return null;
  if (/rain|shower|drizzle|storm|thunder|snow|sleet|flurr|ice|fog|mist|haze|smoke|dust/.test(s)) return null;
  if (/^(?:sunny|clear)$/.test(s)) return 'clear sky';
  if (/^mostly (?:sunny|clear)$/.test(s)) return 'few clouds';
  if (/^partly (?:sunny|cloudy)$/.test(s)) return 'scattered clouds';
  if (/^mostly cloudy$/.test(s)) return 'broken clouds';
  if (/^cloudy$/.test(s)) return 'overcast clouds';
  return null;
}

// NWS period times are already local ("2026-10-30T08:00:00-04:00").
const dateOf = (p) => String(p.startTime).slice(0, 10);
const hourOf = (p) => parseInt(String(p.startTime).slice(11, 13), 10);

// From the raw periods: today's high, each day's high, and the sky right now.
function summarizeNWS(nws, todayKey) {
  if (!nws || !Array.isArray(nws.hourly) || !Array.isArray(nws.daily)) return null;

  // Today's high: the daytime (6am-9pm) peak of what's left in the hourly
  // forecast, and NWS's own daytime period for today when it still exists
  // (it covers the whole day even after the peak has passed).
  const hourlyToday = nws.hourly.filter(p => dateOf(p) === todayKey && hourOf(p) >= 6 && hourOf(p) <= 21);
  const candidates = hourlyToday.map(p => p.temperature);
  const dailyHighs = {};
  for (const p of nws.daily) {
    if (p.isDaytime) dailyHighs[dateOf(p)] = p.temperature;
  }
  if (dailyHighs[todayKey] != null) candidates.push(dailyHighs[todayKey]);
  const validCandidates = candidates.filter(v => typeof v === 'number' && !Number.isNaN(v));
  const high = validCandidates.length ? Math.max(...validCandidates) : null;
  if (high != null) dailyHighs[todayKey] = high;

  const nowPeriod = nws.hourly.find(p => dateOf(p) === todayKey) || nws.hourly[0];
  return {
    high,
    dailyHighs,
    shortForecast: nowPeriod ? nowPeriod.shortForecast : null,
    condition: nowPeriod ? nwsConditionFor(nowPeriod.shortForecast) : null
  };
}

// Applies NWS to an OWM-built weather object (returns a new one).
function mergeNWS(weather, summary, todayKey) {
  if (!summary) return { weather, used: { high: false, condition: false } };
  const out = { ...weather };
  const used = { high: false, condition: false };

  if (summary.high != null) {
    out.high = Math.max(summary.high, weather.temp); // the high can't be below right now
    used.high = true;
  }
  // Keep OWM's wording when it says it's precipitating or foggy: that goes
  // with the rain chance and feels-like it's reporting.
  if (summary.condition && !/rain|drizzle|snow|thunder|sleet|shower|mist|fog|haze|smoke|dust/i.test(weather.condition || '')) {
    out.condition = summary.condition;
    used.condition = true;
  }
  if (Array.isArray(weather.forecast)) {
    out.forecast = weather.forecast.map(f => {
      const nwsHigh = summary.dailyHighs[f.dateKey];
      if (nwsHigh == null) return f;
      return { ...f, high: f.dateKey === todayKey ? out.high : nwsHigh };
    });
  }
  return { weather: out, used };
}

module.exports = { fetchNWS, summarizeNWS, mergeNWS, nwsConditionFor, OKX_GRID };
