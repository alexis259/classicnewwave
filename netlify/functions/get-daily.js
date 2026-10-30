// netlify/functions/get-daily.js
// Returns today's weather + synopsis from Supabase
// Front end calls this instead of OpenWeatherMap directly

const { scoreWeather } = require('./scoring');
const { fetchFreshWeather, detectAlert, toNYCDateKey } = require('./weather-source');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

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


// Scoring lives in scoring.js (it also reports what drove the score).

// The "high" is the max of the forecast slots still ahead of now, so it only
// falls as the day goes on; the score is built from it. For a day that has
// already posted, keep what was posted. Mutates `refreshed` in place.
function freezePosted(refreshed, row) {
  delete refreshed.score;
  delete refreshed.penalties;
  if (row.high != null) refreshed.high = row.high;
  return refreshed;
}

// If past 8AM and no synopsis yet, generate one server-side and save it.
// rainTiming is ephemeral (never persisted — see fetchFreshWeather), so it can
// only be passed in directly from a caller that just did a fresh OWM fetch;
// it's null on the "not stale, served from cache" path, which is correct since
// there's no fresh timing data to give it there.
async function maybeAutoGenerate(row, dateKey, rainTiming = null) {
  if (row.synopsis_approved || !isAfterEightAMNYC()) return row;

  try {
    const weather = {
      temp: row.temp, high: row.high, low: row.low, feelsLike: row.feels_like,
      condition: row.condition, humidity: row.humidity, precipChance: row.precip_chance,
      windSpeed: row.wind_speed, rainTiming
    };
    const text = await autoGenerateSynopsis(weather, row.score, row.penalties);
    const update = { synopsis_approved: text, approved: true, updated_at: new Date().toISOString() };

    // Guard the write with synopsis_approved=is.null at the DATABASE level,
    // not just a re-check in JS. The LLM call above can take several
    // seconds — long enough for an admin's own approval to land in that
    // window. A re-check-then-write still has a race between the check and
    // the write; a conditional UPDATE is atomic — if someone approved their
    // own version in the meantime, this PATCH matches zero rows and their
    // text is left untouched instead of getting overwritten a moment later.
    const result = await supabaseFetch(
      `/daily?date_key=eq.${encodeURIComponent(dateKey)}&synopsis_approved=is.null`,
      {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(update)
      }
    );

    if (Array.isArray(result) && result.length > 0) {
      return { ...row, ...update };
    }
    // Zero rows matched — someone else's approval won the race. Return the
    // row as it now actually stands, not the text we just discarded.
    const fresh = await supabaseFetch(`/daily?date_key=eq.${encodeURIComponent(dateKey)}&select=*`);
    return fresh?.[0] || row;
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

      // Once the day's post is out, its score, penalties and high are frozen —
      // they're what the graphic and caption already showed. A later refresh
      // (or manual repost) sees a smaller "high" as the day's warm slots
      // elapse, which dropped a posted 4 to a reposted 2. See freezePosted().
      if (row.ig_posted) freezePosted(refreshed, row);

      // Re-score on explicit force refresh so scoring band changes take effect immediately
      if (force && !row.ig_posted) {
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
      const finalRow = await maybeAutoGenerate(mergedRow, dateKey, weather.rainTiming);
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
    const finalRow = await maybeAutoGenerate(insertedRow, dateKey, weather.rainTiming);
    return { statusCode: 200, headers, body: JSON.stringify({ ...finalRow, rain_timing: weather.rainTiming }) };

  } catch (err) {
    console.error('get-daily error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

exports.freezePosted = freezePosted;
