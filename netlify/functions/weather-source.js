// netlify/functions/weather-source.js
// Where today's weather comes from: OpenWeatherMap for current conditions, rain
// chance, humidity and wind, with the daily HIGH and the SKY taken from the
// National Weather Service (nws.js) when it's available. Shared by get-daily
// (the daily refresh) and refresh-today (the manual correction).

const { fetchNWS, summarizeNWS, mergeNWS } = require('./nws');

const OWM_KEY = process.env.OWM_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function toNYCDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(date);
}

async function fetchOWM() {
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
  // Max rain probability across today's REMAINING daytime slots — a slot whose
  // 3-hour window has already fully elapsed shouldn't count toward "today's
  // risk" anymore (its rain, if any, already happened and is done). OWM's
  // forecast list can include a bucket that started before "now" depending on
  // exactly when it last rolled, so this isn't just a late-night edge case —
  // without this filter, rain that already came and cleared can keep reading
  // as still-pending for the rest of the day.
  const now = Date.now();
  const remainingSlots = slotsForHigh.filter(s => (s.dt * 1000 + 3 * 60 * 60 * 1000) > now);
  const slotsForPrecip = remainingSlots.length > 0 ? remainingSlots : slotsForHigh;
  const precipChance = slotsForPrecip.length > 0
    ? Math.round(Math.max(...slotsForPrecip.map(s => (s.pop || 0) * 100)))
    : 0;

  // precipChance is a whole-day worst case — it can be 100% off a single evening
  // slot while it's dry and sunny right now. rainTiming carries WHEN that risk
  // actually peaks, so the synopsis can say "clear now, storms tonight" instead
  // of a flat "rain today" that misrepresents current conditions.
  let rainTiming = null;
  if (precipChance > 20 && slotsForPrecip.length > 0) {
    const peakSlot = slotsForPrecip.reduce((best, s) => (s.pop || 0) > (best.pop || 0) ? s : best, slotsForPrecip[0]);
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
    _owmDataAgeMin: Math.round((Date.now() - current.dt * 1000) / 60000),
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


// One row per fresh fetch, so the OWM-vs-NWS question ("is OWM stale? is it
// just wrong?") can be answered from data instead of from one bad morning.
// Table is optional (see logSourceComparison); never throws, never blocks long.
//
//   create table weather_log (
//     id bigint generated always as identity primary key,
//     created_at timestamptz default now(),
//     date_key text, temp numeric,
//     owm_high numeric, nws_high numeric,
//     owm_condition text, nws_condition text,
//     used_nws_high boolean, used_nws_condition boolean,
//     owm_data_age_min integer
//   );
//   alter table weather_log enable row level security;
async function logSourceComparison(row) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/weather_log`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(row)
    });
    if (!res.ok) console.warn(`weather_log: not recorded (HTTP ${res.status}) — is the table created?`);
  } catch (e) {
    console.warn('weather_log: not recorded:', e.message);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFreshWeather() {
  const [owm, nws] = await Promise.all([fetchOWM(), fetchNWS()]);
  const todayKey = toNYCDateKey(new Date());
  const summary = summarizeNWS(nws, todayKey);
  const { weather, used } = mergeNWS(owm, summary, todayKey);

  console.log(`weather-source: high owm=${Math.round(owm.high)} nws=${summary && summary.high != null ? summary.high : 'n/a'} used=${weather.high != null ? Math.round(weather.high) : 'n/a'} | sky owm="${owm.condition}" nws="${summary ? summary.shortForecast : 'n/a'}" used="${weather.condition}" | owm data age ${owm._owmDataAgeMin}min`);
  await logSourceComparison({
    date_key: todayKey,
    temp: owm.temp,
    owm_high: owm.high,
    nws_high: summary ? summary.high : null,
    owm_condition: owm.condition,
    nws_condition: summary ? summary.shortForecast : null,
    used_nws_high: used.high,
    used_nws_condition: used.condition,
    owm_data_age_min: owm._owmDataAgeMin
  });

  delete weather._owmDataAgeMin;
  return weather;
}

function detectAlert(weather) {
  if (weather.high >= 95 || weather.feelsLike >= 100) return 'hot';
  if (weather.high <= 28 || weather.feelsLike <= 20) return 'cold';
  const isThunderstorm = (weather.condition || '').toLowerCase().includes('thunderstorm');
  if (weather.precipChance >= 70 && (isThunderstorm || weather.windSpeed >= 25)) return 'storm';
  return null;
}

module.exports = { fetchFreshWeather, detectAlert, toNYCDateKey, fetchOWM };
