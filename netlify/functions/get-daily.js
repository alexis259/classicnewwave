// netlify/functions/get-daily.js
// Returns today's weather + synopsis from Supabase
// Front end calls this instead of OpenWeatherMap directly

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OWM_KEY = process.env.OWM_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

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

  // Compute true daily high/low from all forecast slots that fall on today's NYC date
  const todayKey = toNYCDateKey(new Date());
  const todaySlots = forecastData.list.filter(slot =>
    toNYCDateKey(new Date(slot.dt * 1000)) === todayKey
  );
  const dailyHigh = todaySlots.length > 0
    ? Math.max(...todaySlots.map(s => s.main.temp_max))
    : current.main.temp_max;
  const dailyLow = todaySlots.length > 0
    ? Math.min(...todaySlots.map(s => s.main.temp_min))
    : current.main.temp_min;

  const forecast = Object.entries(days).slice(0, 5).map(([key, { slot }]) => ({
    day: dayNames[new Date(slot.dt * 1000).getDay()],
    high: key === todayKey ? dailyHigh : slot.main.temp_max,
    rain: Math.round((slot.pop || 0) * 100)
  }));

  return {
    temp: current.main.temp,
    feelsLike: current.main.feels_like,
    condition: current.weather[0].main,
    high: dailyHigh,
    low: dailyLow,
    humidity: current.main.humidity,
    precipChance,
    windSpeed: Math.round(current.wind.speed),
    forecast
  };
}

function isAfterNineAMNYC() {
  const hour = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false
  }).format(new Date()));
  return hour >= 9;
}

async function fetchExamplesForSynopsis() {
  const [seeded, approved] = await Promise.all([
    supabaseFetch('/synopsis_examples?select=synopsis,temp,feels_like,condition,precip_chance,score&order=created_at.desc&limit=6'),
    supabaseFetch('/daily?select=synopsis_approved,temp,feels_like,condition,precip_chance,score&approved=eq.true&synopsis_approved=not.is.null&order=date_key.desc&limit=6')
  ]);
  const examples = [];
  for (const row of (approved || [])) {
    if (row.synopsis_approved) examples.push({ synopsis: row.synopsis_approved, temp: row.temp, feelsLike: row.feels_like, condition: row.condition, precipChance: row.precip_chance, score: row.score });
  }
  for (const row of (seeded || [])) {
    if (examples.length >= 8) break;
    examples.push({ synopsis: row.synopsis, temp: row.temp, feelsLike: row.feels_like, condition: row.condition, precipChance: row.precip_chance, score: row.score });
  }
  return examples;
}

async function autoGenerateSynopsis(weather, score, penalties) {
  let exampleBlock = '';
  try {
    const examples = await fetchExamplesForSynopsis();
    if (examples.length > 0) {
      exampleBlock = `EXAMPLES FROM MY ACTUAL WRITING — match this voice exactly:\n` +
        examples.map(ex => {
          const parts = [];
          if (ex.temp) parts.push(`${Math.round(ex.temp)}°F`);
          if (ex.feelsLike && ex.feelsLike !== ex.temp) parts.push(`feels ${Math.round(ex.feelsLike)}°F`);
          if (ex.condition) parts.push(ex.condition);
          if (ex.precipChance) parts.push(`${ex.precipChance}% rain`);
          if (ex.score) parts.push(`score ${ex.score}/10`);
          const conditions = parts.length ? `[${parts.join(', ')}]` : '';
          return `${conditions}\n"${ex.synopsis}"`;
        }).join('\n\n');
    }
  } catch(e) { /* non-fatal */ }

  const prompt = `You write short, punchy daily NYC weather updates in a very specific voice.

VOICE RULES:
- 1-2 sentences MAX. tight.
- blend of hype and chill. never forced, never corny.
- lowercase mostly. ALL CAPS only when it really lands.
- natural NYC energy — like texting a homie who keeps it real
- weather is info, not drama. matter of fact with personality.
- no hashtags. one emoji max if it's perfect. no "hey guys".

${exampleBlock || `EXAMPLES:\n"39 degrees and the city said no today. rain comin — grab that umbrella."\n"65 and sunny out here cousins. this the one."\n"wind making it feel like 28. stay bundled."`}

TODAY:
- Temp: ${Math.round(weather.temp)}°F, high of ${Math.round(weather.high)}°F, feels like ${Math.round(weather.feelsLike)}°F
- Condition: ${weather.condition}
- Rain: ${weather.precipChance}%
- Humidity: ${weather.humidity}%
- Wind: ${weather.windSpeed} mph
- Score: ${score}/10
- Issues: ${penalties && penalties.length ? penalties.join(', ') : 'none — clean day'}

Write it. Just the text.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 150, messages: [{ role: 'user', content: prompt }] })
  });
  const data = await res.json();
  const text = data.content?.[0]?.text?.trim();
  if (!text) throw new Error('No text from Claude');
  return text;
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

// If past 9AM and no synopsis yet, generate one server-side and save it
async function maybeAutoGenerate(row, dateKey) {
  if (row.synopsis_approved || !isAfterNineAMNYC()) return row;

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
        humidity: weather.humidity,
        precip_chance: weather.precipChance,
        wind_speed: weather.windSpeed,
        forecast: weather.forecast,
        updated_at: new Date().toISOString()
      };

      // Re-score only when admin explicitly forces a refresh
      if (force) {
        const { score, penalties } = scoreWeather(weather);
        refreshed.score = score;
        refreshed.penalties = penalties;
      }

      await supabaseFetch(`/daily?date_key=eq.${encodeURIComponent(dateKey)}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify(refreshed)
      });

      const mergedRow = { ...row, ...refreshed };
      const finalRow = await maybeAutoGenerate(mergedRow, dateKey);
      return { statusCode: 200, headers, body: JSON.stringify(finalRow) };
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
    return { statusCode: 200, headers, body: JSON.stringify(finalRow) };

  } catch (err) {
    console.error('get-daily error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
