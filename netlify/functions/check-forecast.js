// netlify/functions/check-forecast.js
// Scheduled daily at 7AM NYC (11:00 UTC summer / 12:00 UTC winter)
// Scans OWM 5-day forecast for alert-worthy upcoming conditions
// Results stored in Supabase forecast_alerts table for admin panel display

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OWM_KEY = process.env.OWM_KEY;

function toNYCDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(date);
}

async function supabaseFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...options.headers
    }
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

exports.handler = async () => {
  try {
    // Fetch OWM 5-day / 3-hour forecast
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/forecast?q=New York&appid=${OWM_KEY}&units=imperial`
    );
    const data = await res.json();
    if (!data.list) throw new Error('OWM forecast fetch failed');

    // Group slots by NYC date — track worst-case values per day
    const days = {};
    for (const slot of data.list) {
      const key = toNYCDateKey(new Date(slot.dt * 1000));
      if (!days[key]) {
        days[key] = { high: -Infinity, feelsLike: -Infinity, precip: 0, wind: 0, hasThunderstorm: false };
      }
      days[key].high      = Math.max(days[key].high, slot.main.temp);
      days[key].feelsLike = Math.max(days[key].feelsLike, slot.main.feels_like);
      days[key].precip    = Math.max(days[key].precip, (slot.pop || 0) * 100);
      days[key].wind      = Math.max(days[key].wind, slot.wind?.speed || 0);
      if (slot.weather?.[0]?.main === 'Thunderstorm') days[key].hasThunderstorm = true;
    }

    const sortedDays = Object.entries(days).sort(([a], [b]) => a.localeCompare(b));
    const alerts = [];

    // ── Single-day extremes ──
    for (const [dateKey, d] of sortedDays) {
      if (d.high >= 95 || d.feelsLike >= 100) {
        alerts.push({ type: 'hot', date: dateKey, high: Math.round(d.high), feelsLike: Math.round(d.feelsLike) });
      } else if (d.high <= 20 || d.feelsLike <= 10) {
        alerts.push({ type: 'cold', date: dateKey, high: Math.round(d.high), feelsLike: Math.round(d.feelsLike) });
      }
      if (d.precip >= 70 && (d.hasThunderstorm || d.wind >= 25)) {
        alerts.push({ type: 'storm', date: dateKey, precip: Math.round(d.precip), wind: Math.round(d.wind) });
      }
    }

    // ── Multi-day patterns (heat wave / cold snap) ──
    let hotRun = [], coldRun = [];
    for (const [dateKey, d] of sortedDays) {
      if (d.high >= 90) {
        hotRun.push({ date: dateKey, high: Math.round(d.high) });
      } else {
        if (hotRun.length >= 3) {
          alerts.push({ type: 'heatwave', start_date: hotRun[0].date, end_date: hotRun[hotRun.length - 1].date, days: hotRun.length, peak_high: Math.max(...hotRun.map(x => x.high)) });
        }
        hotRun = [];
      }
      if (d.high <= 32) {
        coldRun.push({ date: dateKey, high: Math.round(d.high) });
      } else {
        if (coldRun.length >= 3) {
          alerts.push({ type: 'cold_snap', start_date: coldRun[0].date, end_date: coldRun[coldRun.length - 1].date, days: coldRun.length, peak_low: Math.min(...coldRun.map(x => x.high)) });
        }
        coldRun = [];
      }
    }
    // Flush remaining runs
    if (hotRun.length >= 3) alerts.push({ type: 'heatwave', start_date: hotRun[0].date, end_date: hotRun[hotRun.length - 1].date, days: hotRun.length, peak_high: Math.max(...hotRun.map(x => x.high)) });
    if (coldRun.length >= 3) alerts.push({ type: 'cold_snap', start_date: coldRun[0].date, end_date: coldRun[coldRun.length - 1].date, days: coldRun.length, peak_low: Math.min(...coldRun.map(x => x.high)) });

    // ── Deduplicate: remove individual hot/cold alerts covered by a multi-day pattern ──
    const coveredDates = new Set();
    for (const a of alerts) {
      if (a.type === 'heatwave' || a.type === 'cold_snap') {
        let d = new Date(a.start_date + 'T12:00:00Z');
        const end = new Date(a.end_date + 'T12:00:00Z');
        while (d <= end) { coveredDates.add(toNYCDateKey(d)); d.setDate(d.getDate() + 1); }
      }
    }
    const deduped = alerts.filter(a => !((a.type === 'hot' || a.type === 'cold') && coveredDates.has(a.date)));

    // ── Store result in Supabase ──
    await supabaseFetch('/forecast_alerts', {
      method: 'POST',
      body: JSON.stringify({ alerts: deduped })
    });

    console.log(`check-forecast: ${deduped.length} alert(s) detected`, JSON.stringify(deduped));
    return { statusCode: 200, body: JSON.stringify({ ok: true, alerts: deduped }) };

  } catch (err) {
    console.error('check-forecast error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
