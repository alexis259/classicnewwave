// netlify/functions/refresh-today.js
// Admin action: re-pull today's weather and REWRITE today's row, including the
// score, penalties and high that get-daily freezes once the day has posted.
//
// That freeze stops a repost from quietly re-scoring a day. This is the
// deliberate way around it, for when the posted data was simply wrong (Oct 30:
// a 63.6° / cloudy forecast on a ~69° / sunny day). It does not touch the
// synopsis or the Instagram post state; the intended order is:
//   1. Refresh data (this)   2. regenerate + approve the synopsis   3. re-post

const { scoreWeather } = require('./scoring');
const { fetchFreshWeather, detectAlert, toNYCDateKey } = require('./weather-source');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ADMIN_PW = process.env.ADMIN_PW;

const sb = async (path, options = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation', ...options.headers }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};

const pick = (r) => ({ high: r.high, condition: r.condition, humidity: r.humidity, precip_chance: r.precip_chance, score: r.score, penalties: r.penalties });

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { password } = JSON.parse(event.body || '{}');
    if (!ADMIN_PW || password !== ADMIN_PW) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

    const dateKey = toNYCDateKey(new Date());
    const rows = await sb(`/daily?date_key=eq.${encodeURIComponent(dateKey)}&select=*`);
    if (!rows || !rows.length) return { statusCode: 404, headers, body: JSON.stringify({ error: 'No row for today yet' }) };
    const before = rows[0];

    const weather = await fetchFreshWeather();
    const { score, penalties } = scoreWeather(weather);
    const update = {
      temp: weather.temp,
      high: weather.high,
      low: weather.low,
      feels_like: weather.feelsLike,
      condition: weather.condition,
      humidity: weather.humidity,
      precip_chance: weather.precipChance,
      wind_speed: weather.windSpeed,
      forecast: weather.forecast,
      alert_flag: detectAlert(weather),
      score,
      penalties,
      updated_at: new Date().toISOString()
    };
    const [after] = await sb(`/daily?date_key=eq.${encodeURIComponent(dateKey)}`, { method: 'PATCH', body: JSON.stringify(update) });

    console.log(`refresh-today: ${dateKey} high ${before.high} -> ${update.high}, score ${before.score} -> ${score}`);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, date_key: dateKey, before: pick(before), after: pick(after || { ...before, ...update }) }) };
  } catch (err) {
    console.error('refresh-today error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
