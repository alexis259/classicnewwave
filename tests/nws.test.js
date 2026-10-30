// Run with: node --test tests/*.test.js
// NWS supplies the daily high and the sky; OWM the rest. Fixtures are the real
// Oct 30, 2026 numbers: OWM said 63.6° / broken clouds, NWS said 69° / Sunny.
process.env.OWM_KEY = 'k';
process.env.SUPABASE_URL = 'http://sb.test';
process.env.SUPABASE_SERVICE_KEY = 'sk';
const test = require('node:test');
const assert = require('node:assert/strict');
const nws = require('../netlify/functions/nws.js');

const TODAY = '2026-10-30';
const hourlyTemps = { 8: 60, 9: 61, 10: 64, 11: 66, 12: 67, 13: 67, 14: 68, 15: 66, 16: 65, 17: 64, 18: 63, 19: 62, 20: 62, 21: 60, 22: 59, 23: 59 };
const hourly = (from = 8, sky = 'Sunny') => Object.entries(hourlyTemps).filter(([h]) => +h >= from).map(([h, t]) => ({
  startTime: `${TODAY}T${String(h).padStart(2, '0')}:00:00-04:00`, temperature: t, shortForecast: sky
}));
const daily = (withToday = true) => [
  ...(withToday ? [{ startTime: `${TODAY}T06:00:00-04:00`, isDaytime: true, temperature: 69, shortForecast: 'Sunny' }] : []),
  { startTime: `${TODAY}T18:00:00-04:00`, isDaytime: false, temperature: 49, shortForecast: 'Mostly Clear' },
  { startTime: '2026-10-31T06:00:00-04:00', isDaytime: true, temperature: 61, shortForecast: 'Sunny' },
  { startTime: '2026-11-01T06:00:00-04:00', isDaytime: true, temperature: 62, shortForecast: 'Mostly Sunny' },
];
const owmWeather = () => ({
  temp: 57.65, feelsLike: 57.16, condition: 'broken clouds', high: 63.59, low: 48.96, humidity: 86, precipChance: 0, rainTiming: null, windSpeed: 8,
  forecast: [
    { dateKey: TODAY, day: 'Fri', high: 63.59, rain: 0 },
    { dateKey: '2026-10-31', day: 'Sat', high: 55.35, rain: 0 },
    { dateKey: '2026-11-01', day: 'Sun', high: 59.32, rain: 0 },
    { dateKey: '2026-11-04', day: 'Wed', high: 70, rain: 0 }
  ]
});

test('sky wording maps to OWM-style descriptions; precipitation and fog stay with OWM', () => {
  const m = nws.nwsConditionFor;
  assert.equal(m('Sunny'), 'clear sky');
  assert.equal(m('Clear'), 'clear sky');
  assert.equal(m('Mostly Sunny'), 'few clouds');
  assert.equal(m('Partly Cloudy'), 'scattered clouds');
  assert.equal(m('Partly Sunny'), 'scattered clouds');
  assert.equal(m('Mostly Cloudy'), 'broken clouds');
  assert.equal(m('Cloudy'), 'overcast clouds');
  for (const s of ['Rain Showers Likely', 'Slight Chance Rain Showers', 'Patchy Fog', 'Chance Snow', 'Thunderstorms', 'Sunny then Slight Chance Rain', '', null, 'Something New']) {
    assert.equal(m(s), null, String(s));
  }
});

test("Oct 30: today's high is NWS's 69, not OWM's 63.6", () => {
  const s = nws.summarizeNWS({ hourly: hourly(), daily: daily() }, TODAY);
  assert.equal(s.high, 69);
  const { weather, used } = nws.mergeNWS(owmWeather(), s, TODAY);
  assert.equal(weather.high, 69);
  assert.equal(weather.condition, 'clear sky');
  assert.deepEqual(used, { high: true, condition: true });
  assert.equal(weather.forecast[0].high, 69);   // today in the week strip agrees
  assert.equal(weather.forecast[1].high, 61);   // Saturday: 55 -> 61
  assert.equal(weather.forecast[2].high, 62);
  assert.equal(weather.forecast[3].high, 70);   // a day NWS doesn't cover keeps OWM's
  assert.equal(weather.humidity, 86);           // everything else stays OWM's
  assert.equal(weather.temp, 57.65);
  assert.equal(weather.low, 48.96);
});

test("late in the day, after NWS drops today's daytime period, the high comes from what's left", () => {
  const s = nws.summarizeNWS({ hourly: hourly(15), daily: daily(false) }, TODAY);
  assert.equal(s.high, 66); // remaining hourly peak; the day's real peak has passed
});

test('the high is never below the current temperature', () => {
  const s = nws.summarizeNWS({ hourly: hourly(), daily: daily() }, TODAY);
  const { weather } = nws.mergeNWS({ ...owmWeather(), temp: 72 }, s, TODAY);
  assert.equal(weather.high, 72);
});

test("OWM's wording is kept while it reports rain or fog", () => {
  const s = nws.summarizeNWS({ hourly: hourly(8, 'Cloudy'), daily: daily() }, TODAY);
  const { weather, used } = nws.mergeNWS({ ...owmWeather(), condition: 'light rain' }, s, TODAY);
  assert.equal(weather.condition, 'light rain');
  assert.equal(used.condition, false);
  assert.equal(weather.high, 69); // the high still comes from NWS
});

test('NWS unavailable or malformed: OWM values pass through untouched', () => {
  const w = owmWeather();
  for (const bad of [null, undefined, {}, { hourly: [], daily: [] }, { hourly: null, daily: [] }]) {
    const s = nws.summarizeNWS(bad, TODAY);
    const r = nws.mergeNWS(w, s, TODAY);
    assert.equal(r.weather.high, 63.59);
    assert.equal(r.weather.condition, 'broken clouds');
  }
});

// ───────── end to end through weather-source with fetch mocked ─────────
function mockAll({ nwsFails = false, logFails = false } = {}) {
  const calls = { logged: [] };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const json = (b, ok = true, status = 200) => ({ ok, status, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.includes('openweathermap.org/data/2.5/weather')) {
      return json({ cod: 200, dt: Math.floor(Date.now() / 1000) - 45 * 60, main: { temp: 57.65, feels_like: 57.16, humidity: 86, temp_max: 60, temp_min: 50 }, weather: [{ description: 'broken clouds' }], wind: { speed: 8 } });
    }
    if (u.includes('openweathermap.org/data/2.5/forecast')) {
      const base = Math.floor(Date.now() / 1000);
      return json({ list: [0, 3, 6, 9].map(i => ({ dt: base + i * 3600, main: { temp: 60 + i, temp_max: 61 + i }, pop: 0 })) });
    }
    if (u.includes('api.weather.gov')) {
      if (nwsFails) throw new Error('timeout');
      if (u.endsWith('/forecast/hourly')) return json({ properties: { periods: hourly() } });
      return json({ properties: { periods: daily() } });
    }
    if (u.includes('/weather_log')) {
      if (logFails) throw new Error('down');
      calls.logged.push(JSON.parse(opts.body));
      return json(null, true, 201);
    }
    throw new Error('unexpected fetch ' + u);
  };
  return calls;
}
const load = () => { delete require.cache[require.resolve('../netlify/functions/weather-source.js')]; return require('../netlify/functions/weather-source.js'); };

test('fetchFreshWeather: NWS high and sky win, and the comparison is logged', async () => {
  const calls = mockAll();
  const realNow = Date.now;
  // NWS fixture is for 2026-10-30; pin "today" to it
  const fixed = new Date('2026-10-30T12:01:00Z').getTime();
  Date.now = () => fixed;
  const OrigDate = Date;
  global.Date = class extends OrigDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  try {
    const w = await load().fetchFreshWeather();
    assert.equal(w.high, 69);
    assert.equal(w.condition, 'clear sky');
    assert.equal(w.humidity, 86);
    assert.equal('_owmDataAgeMin' in w, false);
    assert.equal(calls.logged.length, 1);
    assert.equal(calls.logged[0].nws_high, 69);
    assert.equal(calls.logged[0].used_nws_high, true);
    assert.equal(calls.logged[0].nws_condition, 'Sunny');
    assert.equal(calls.logged[0].owm_data_age_min, 45);
    assert.equal(calls.logged[0].date_key, '2026-10-30');
  } finally { global.Date = OrigDate; Date.now = realNow; }
});

test('fetchFreshWeather: NWS down -> OWM values, nothing thrown', async () => {
  mockAll({ nwsFails: true });
  const w = await load().fetchFreshWeather();
  assert.equal(w.condition, 'broken clouds');
  assert.ok(w.high < 80);
});

test('fetchFreshWeather: a missing weather_log table never breaks the fetch', async () => {
  mockAll({ logFails: true });
  const w = await load().fetchFreshWeather();
  assert.equal(typeof w.high, 'number');
});
