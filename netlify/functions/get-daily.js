// netlify/functions/get-daily.js
// Returns today's weather + synopsis from Supabase
// Front end calls this instead of OpenWeatherMap directly

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OWM_KEY = process.env.OWM_KEY;

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

function toNYCDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(date);
}

async function fetchFreshWeather() {
  const [cr, fr] = await Promise.all([
    fetch(`https://api.openweathermap.org/data/2.5/weather?q=New York&appid=${OWM_KEY}&units=imperial`),
    fetch(`https://api.openweathermap.org/data/2.5/forecast?q=New York&appid=${OWM_KEY}&units=imperial`)
  ]);
  const current = await cr.json();
  const forecastData = await fr.json();

  if (current.cod !== 200) throw new Error('OWM fetch failed');

  // Group forecast slots by NYC date, picking the slot closest to noon NYC time
  const days = {};
  const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  forecastData.list.forEach(slot => {
    const date = new Date(slot.dt * 1000);
    const key = toNYCDateKey(date);
    const hourNYC = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(date));
    if (!days[key] || Math.abs(hourNYC - 12) < Math.abs(days[key].hourNYC - 12)) {
      days[key] = { slot, hourNYC };
    }
  });

  // Compute true daily high/low from today's forecast slots
  // Use only daytime slots (6AM–9PM NYC) to avoid inflated overnight temp_max values
  // Use slot temp (not temp_max) which is more accurate for the actual period
  const todayKey = toNYCDateKey(new Date());
  const todaySlots = forecastData.list.filter(slot =>
    toNYCDateKey(new Date(slot.dt * 1000)) === todayKey
  );
  const daytimeSlots = todaySlots.filter(slot => {
    const hourNYC = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date(slot.dt * 1000)));
    return hourNYC >= 6 && hourNYC <= 21;
  });
  const slotsForHigh = daytimeSlots.length > 0 ? daytimeSlots : todaySlots;
  const dailyHigh = slotsForHigh.length > 0
    ? Math.max(...slotsForHigh.map(s => s.main.temp))
    : current.main.temp_max;
  const dailyLow = todaySlots.length > 0
    ? Math.min(...todaySlots.map(s => s.main.temp))
    : current.main.temp_min;
  // Max rain probability across today's daytime slots — same slot set as dailyHigh,
  // so the topline precipChance (score/synopsis/hair) can't disagree with the forecast strip.
  const precipChance = slotsForHigh.length > 0
    ? Math.round(Math.max(...slotsForHigh.map(s => (s.pop || 0) * 100)))
    : 0;

  // precipChance is a whole-day worst case — it can be 100% off a single evening
  // slot while it's dry and sunny right now. rainTiming carries WHEN that risk
  // actually peaks, so the synopsis can say "clear now, storms tonight" instead
  // of a flat "rain today" that misrepresents current conditions.
  let rainTiming = null;
  if (precipChance > 20 && slotsForHigh.length > 0) {
    const peakSlot = slotsForHigh.reduce((best, s) => (s.pop || 0) > (best.pop || 0) ? s : best, slotsForHigh[0]);
    const peakHourNYC = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date(peakSlot.dt * 1000)));
    const currentHourNYC = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date()));
    if (peakHourNYC - currentHourNYC <= 1) rainTiming = 'now';
    else if (peakHourNYC < 11) rainTiming = 'this morning';
    else if (peakHourNYC < 15) rainTiming = 'around midday';
    else if (peakHourNYC < 18) rainTiming = 'this afternoon';
    else if (peakHourNYC < 21) rainTiming = 'this evening';
    else rainTiming = 'overnight';
  }

  const forecast = Object.entries(days).slice(0, 5).map(([key, { slot }]) => ({
    dateKey: key,
    day: dayNames[new Date(slot.dt * 1000).getDay()],
    high: key === todayKey ? dailyHigh : slot.main.temp_max,
    rain: key === todayKey ? precipChance : Math.round((slot.pop || 0) * 100)
  }));

  return {
    temp: current.main.temp,
    feelsLike: current.main.feels_like,
    condition: current.weather[0].description,
    high: dailyHigh,
    low: dailyLow,
    humidity: current.main.humidity,
    precipChance,
    rainTiming,
    windSpeed: Math.round(current.wind.speed),
    forecast
  };
}

// Named/thresholded to match auto-post-ig's 8:00 AM EDT cron — that job calls
// get-daily?force=true right before posting, so the synopsis must already be
// generatable by 8am or the IG caption goes out with no "today's vibe" line.
function isAfterEightAMNYC() {
  const hour = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false
  }).format(new Date()));
  return hour >= 8;
}

// Delegates to generate-synopsis.js so the auto-fallback uses the exact same
// voice/anti-repetition rules as the admin-drafted path — one implementation,
// not two that can drift apart.
async function autoGenerateSynopsis(weather, score, penalties) {
  const siteUrl = process.env.URL || process.env.DEPLOY_URL;
  if (!siteUrl) throw new Error('No site URL available to call generate-synopsis');

  const res = await fetch(`${siteUrl}/.netlify/functions/generate-synopsis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      temp: weather.temp,
      high: weather.high,
      feelsLike: weather.feelsLike,
      condition: weather.condition,
      precipChance: weather.precipChance,
      rainTiming: weather.rainTiming,
      humidity: weather.humidity,
      windSpeed: weather.windSpeed,
      score,
      penalties
    })
  });
  const data = await res.json();
  if (!data.text) throw new Error('No text from generate-synopsis');
  return data.text;
}

function detectAlert(weather) {
  if (weather.high >= 95 || weather.feelsLike >= 100) return 'hot';
  if (weather.high <= 28 || weather.feelsLike <= 20) return 'cold';
  const isThunderstorm = (weather.condition || '').toLowerCase().includes('thunderstorm');
  if (weather.precipChance >= 70 && (isThunderstorm || weather.windSpeed >= 25)) return 'storm';
  return null;
}

function scoreWeather(w) {
  let score = 10;
  const penalties = [];
  const t = w.high;

  if (t >= 70 && t <= 80) {}
  else if ((t >= 65 && t < 70) || (t > 80 && t <= 82)) { score -= 1; }
  else if (t >= 60 && t < 65) { score -= 2; penalties.push("a bit cool"); }
  else if (t >= 55 && t < 60) { score -= 3; penalties.push("kinda cool"); }
  else if (t >= 50 && t < 55) { score -= 4; penalties.push("chilly"); }
  else if (t >= 42 && t < 50) { score -= 5; penalties.push("cold out"); }
  else if (t >= 35 && t < 42) { score -= 6; penalties.push("cold af"); }
  else if (t >= 28 && t < 35) { score -= 7; penalties.push("freezing"); }
  else if (t < 28)             { score -= 8; penalties.push("BRUTAL"); }
  else if (t > 82 && t < 90)  { score -= 2; penalties.push("hot"); }
  else if (t >= 90 && t < 95) { score -= 6; penalties.push("extreme heat"); }
  else if (t >= 95)            { score -= 8; penalties.push("scorching"); }

  const chill = w.temp - w.feelsLike;
  if (chill >= 15)     { score -= 3; penalties.push("wind chill nasty"); }
  else if (chill >= 8) { score -= 2; penalties.push("wind making it worse"); }
  else if (chill >= 4) { score -= 1; penalties.push("some wind chill"); }

  if (w.precipChance > 70)      { score -= 3; penalties.push("heavy rain"); }
  else if (w.precipChance > 45) { score -= 2; penalties.push("real rain chance"); }
  else if (w.precipChance > 20) { score -= 1; penalties.push("light rain possible"); }

  if (w.humidity > 80)      { score -= 2; penalties.push("humid & heavy"); }
  else if (w.humidity > 70) { score -= 1; penalties.push("a lil humid"); }

  const condDesc = (w.condition || '').toLowerCase();
  if ((condDesc === 'broken clouds' || condDesc === 'overcast clouds') && w.precipChance < 20) {
    score -= 1; penalties.push("overcast");
  }

  return { score: Math.max(1, Math.min(10, score)), penalties };
}

// If past 8AM and no synopsis yet, generate one server-side and save it
async function maybeAutoGenerate(row, dateKey) {
  if (row.synopsis_approved || !isAfterEightAMNYC()) return row;

  try {
    const weather = {
      temp: row.temp, high: row.high, low: row.low, feelsLike: row.feels_like,
      condition: row.condition, humidity: row.humidity, precipChance: row.precip_chance,
      windSpeed: row.wind_speed
    };
    const text = await autoGenerateSynopsis(weather, row.score, row.penalties);
    const update = { synopsis_approved: text, approved: true, updated_at: new Date().toISOString() };
    await supabaseFetch(`/daily?date_key=eq.${encodeURIComponent(dateKey)}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify(update)
    });
    return { ...row, ...update };
  } catch(e) {
    console.error('auto-gen synopsis error:', e);
    return row; // non-fatal — return row without synopsis
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const dateKey = toNYCDateKey(new Date());

    // Check if we already have today's data in Supabase
    const existing = await supabaseFetch(
      `/daily?date_key=eq.${encodeURIComponent(dateKey)}&select=*`
    );

    if (existing && existing.length > 0) {
      const row = existing[0];
      const lastUpdated = new Date(row.updated_at || 0).getTime();
      const force = event.queryStringParameters?.force === 'true';
      const stale = force || (Date.now() - lastUpdated) > 3 * 60 * 60 * 1000;

      if (!stale) {
        const finalRow = await maybeAutoGenerate(row, dateKey);
        return { statusCode: 200, headers, body: JSON.stringify(finalRow) };
      }

      // Row is older than 3 hours — refresh weather from OWM
      const weather = await fetchFreshWeather();
      const refreshed = {
        temp: weather.temp,
        high: weather.high,
        low: weather.low,
        feels_like: weather.feelsLike,
        condition: weather.condition,
        wind_speed: weather.windSpeed,
        forecast: weather.forecast,
        alert_flag: detectAlert(weather),
        updated_at: new Date().toISOString()
      };

      // Lock humidity + precip_chance once the graphic has been posted, EXCEPT on an
      // explicit force refresh — force is a deliberate manual admin action (the
      // "force refresh" button in admin.html), not a background cron tick, so it's
      // allowed to correct an advisory that already went out.
      // These drive the hair forecast — changing them on a normal background refresh
      // would silently contradict the advisory that was already published.
      if (!row.ig_posted || force) {
        refreshed.humidity = weather.humidity;
        refreshed.precip_chance = weather.precipChance;
      } else {
        // Locked: precip_chance stays frozen at row.precip_chance, but
        // refreshed.forecast (always overwritten above) has today's entry
        // freshly computed from THIS fetch — pin it back to the frozen
        // value so the forecast strip can't disagree with the locked headline.
        const todayForecast = refreshed.forecast.find(f => f.dateKey === dateKey);
        if (todayForecast) todayForecast.rain = row.precip_chance;
      }

      // Re-score on explicit force refresh so scoring band changes take effect immediately
      if (force) {
        const rescored = scoreWeather({ ...weather, humidity: refreshed.humidity, precipChance: refreshed.precip_chance });
        refreshed.score = rescored.score;
        refreshed.penalties = rescored.penalties;
      }

      await supabaseFetch(`/daily?date_key=eq.${encodeURIComponent(dateKey)}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify(refreshed)
      });

      const mergedRow = { ...row, ...refreshed };
      const finalRow = await maybeAutoGenerate(mergedRow, dateKey);
      // rain_timing is ephemeral — computed from this fetch only, never persisted
      // (no matching Supabase column), so it's attached here, after the PATCH.
      return { statusCode: 200, headers, body: JSON.stringify({ ...finalRow, rain_timing: weather.rainTiming }) };
    }

    // No data yet — fetch fresh from OWM
    const weather = await fetchFreshWeather();
    const { score, penalties } = scoreWeather(weather);

    // Insert into Supabase
    const row = {
      date_key: dateKey,
      temp: weather.temp,
      high: weather.high,
      low: weather.low,
      feels_like: weather.feelsLike,
      condition: weather.condition,
      humidity: weather.humidity,
      precip_chance: weather.precipChance,
      wind_speed: weather.windSpeed,
      forecast: weather.forecast,
      score,
      penalties,
      alert_flag: detectAlert(weather),
      synopsis_draft: null,
      synopsis_approved: null,
      approved: false,
      updated_at: new Date().toISOString()
    };

    const inserted = await supabaseFetch('/daily', {
      method: 'POST',
      body: JSON.stringify(row)
    });
    if (!Array.isArray(inserted)) {
      console.error('Supabase insert failed:', JSON.stringify(inserted));
    }

    const insertedRow = Array.isArray(inserted) ? inserted[0] : row;
    const finalRow = await maybeAutoGenerate(insertedRow, dateKey);
    return { statusCode: 200, headers, body: JSON.stringify({ ...finalRow, rain_timing: weather.rainTiming }) };

  } catch (err) {
    console.error('get-daily error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
