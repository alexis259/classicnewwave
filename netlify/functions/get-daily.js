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
  return res.json();
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

  const nearSlots = forecastData.list.slice(0, 3);
  const precipChance = Math.round(Math.max(...nearSlots.map(s => (s.pop || 0) * 100)));

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

  const forecast = Object.entries(days).slice(0, 5).map(([, { slot }]) => ({
    day: dayNames[new Date(slot.dt * 1000).getDay()],
    high: slot.main.temp_max,
    rain: Math.round((slot.pop || 0) * 100)
  }));

  // Compute true daily high from all forecast slots that fall on today's NYC date
  const todayKey = toNYCDateKey(new Date());
  const todaySlots = forecastData.list.filter(slot =>
    toNYCDateKey(new Date(slot.dt * 1000)) === todayKey
  );
  const dailyHigh = todaySlots.length > 0
    ? Math.max(...todaySlots.map(s => s.main.temp_max))
    : current.main.temp_max;

  return {
    temp: current.main.temp,
    feelsLike: current.main.feels_like,
    condition: current.weather[0].main,
    high: dailyHigh,
    humidity: current.main.humidity,
    precipChance,
    windSpeed: Math.round(current.wind.speed),
    forecast
  };
}

function scoreWeather(w) {
  let score = 10;
  const penalties = [];
  const t = w.high;

  if (t >= 70 && t <= 77) {}
  else if ((t >= 65 && t < 70) || (t > 77 && t <= 82)) { score -= 1; }
  else if (t >= 60 && t < 65) { score -= 2; penalties.push("a bit cool"); }
  else if (t >= 55 && t < 60) { score -= 3; penalties.push("kinda cool"); }
  else if (t >= 50 && t < 55) { score -= 4; penalties.push("chilly"); }
  else if (t >= 42 && t < 50) { score -= 5; penalties.push("cold out"); }
  else if (t >= 35 && t < 42) { score -= 6; penalties.push("cold af"); }
  else if (t >= 28 && t < 35) { score -= 7; penalties.push("freezing"); }
  else if (t < 28)             { score -= 8; penalties.push("BRUTAL"); }
  else if (t > 82 && t <= 88) { score -= 2; penalties.push("hot"); }
  else if (t > 88)             { score -= 4; penalties.push("too hot"); }

  const chill = w.temp - w.feelsLike;
  if (chill >= 15)     { score -= 3; penalties.push("wind chill nasty"); }
  else if (chill >= 8) { score -= 2; penalties.push("wind making it worse"); }
  else if (chill >= 4) { score -= 1; penalties.push("some wind chill"); }

  if (w.precipChance > 70)      { score -= 3; penalties.push("heavy rain"); }
  else if (w.precipChance > 45) { score -= 2; penalties.push("real rain chance"); }
  else if (w.precipChance > 20) { score -= 1; penalties.push("light rain possible"); }

  if (w.humidity > 80)      { score -= 2; penalties.push("humid & heavy"); }
  else if (w.humidity > 68) { score -= 1; penalties.push("a lil humid"); }

  if (w.condition.toLowerCase().includes('cloud') && w.precipChance < 20) {
    score -= 1; penalties.push("overcast");
  }

  return { score: Math.max(1, Math.min(10, score)), penalties };
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
        return { statusCode: 200, headers, body: JSON.stringify(row) };
      }

      // Row is older than 3 hours — refresh weather from OWM
      const weather = await fetchFreshWeather();
      const refreshed = {
        temp: weather.temp,
        high: weather.high,
        feels_like: weather.feelsLike,
        condition: weather.condition,
        humidity: weather.humidity,
        precip_chance: weather.precipChance,
        wind_speed: weather.windSpeed,
        forecast: weather.forecast,
        updated_at: new Date().toISOString()
      };

      // Only re-score and clear draft if admin hasn't approved
      if (!row.approved) {
        const { score, penalties } = scoreWeather(weather);
        refreshed.score = score;
        refreshed.penalties = penalties;
        refreshed.synopsis_draft = null; // force fresh synopsis on next load
      }

      await supabaseFetch(`/daily?date_key=eq.${encodeURIComponent(dateKey)}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify(refreshed)
      });

      return { statusCode: 200, headers, body: JSON.stringify({ ...row, ...refreshed }) };
    }

    // No data yet — fetch fresh from OWM
    const weather = await fetchFreshWeather();
    const { score, penalties } = scoreWeather(weather);

    // Insert into Supabase
    const row = {
      date_key: dateKey,
      temp: weather.temp,
      high: weather.high,
      feels_like: weather.feelsLike,
      condition: weather.condition,
      humidity: weather.humidity,
      precip_chance: weather.precipChance,
      wind_speed: weather.windSpeed,
      forecast: weather.forecast,
      score,
      penalties,
      synopsis_draft: null,
      synopsis_approved: null,
      approved: false,
      updated_at: new Date().toISOString()
    };

    const inserted = await supabaseFetch('/daily', {
      method: 'POST',
      body: JSON.stringify(row)
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(Array.isArray(inserted) ? inserted[0] : row)
    };

  } catch (err) {
    console.error('get-daily error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
