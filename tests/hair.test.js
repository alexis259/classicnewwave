// Run with: node --test tests/*.test.js
process.env.SUPABASE_URL = 'http://sb.test';
process.env.SUPABASE_KEY = 'k';
process.env.SUPABASE_SERVICE_KEY = 'sk';
process.env.OWM_KEY = 'o';
const test = require('node:test');
const assert = require('node:assert/strict');
const hair = require('../netlify/functions/hair.js');
const { dewPointF } = require('../netlify/functions/scoring.js');

const at = (temp, rh, rain = 0) => hair.hairStatus({ humidity: rh, dewPoint: dewPointF(temp, rh), rain });

test('rated by dew point: a cool day with a high humidity PERCENTAGE is a good hair day and says why', () => {
  const s = at(57.65, 86);               // Oct 30, 8am: 86% RH, dew point 53
  assert.equal(s.tier, 'good');
  assert.equal(s.level, 'GOOD HAIR DAY');
  assert.equal(s.sub, 'COLD AIR, LOW FRIZZ.');
  assert.equal(at(52.3, 82).tier, 'good'); // Nov 3
});

test('the dew-point bands', () => {
  const tierAt = (dew) => hair.hairStatus({ humidity: 70, dewPoint: dew, rain: 0 }).tier;
  assert.equal(tierAt(30), 'dry');
  assert.equal(tierAt(39.9), 'dry');
  assert.equal(tierAt(40), 'good');
  assert.equal(tierAt(54.9), 'good');
  assert.equal(tierAt(55), 'low');
  assert.equal(tierAt(61.9), 'low');
  assert.equal(tierAt(62), 'moderate');
  assert.equal(tierAt(65.9), 'moderate');
  assert.equal(tierAt(66), 'high');
  assert.equal(tierAt(69.9), 'high');
  assert.equal(tierAt(70), 'silk');
});

test('genuinely sticky days still warn, and the percentage is untouched', () => {
  assert.equal(at(84, 87).tier, 'silk');
  assert.equal(at(75, 80).tier, 'high');
  assert.equal(at(65.6, 92).tier, 'moderate');
});

test('cold, dry air gets the dry-air report with protective styles', () => {
  const s = at(46, 63);                  // dew point 34
  assert.equal(s.tier, 'dry');
  assert.equal(s.level, 'DRY AIR');
  assert.match(s.rec, /PROTECTIVE STYLE/);
});

test('rain still counts on its own, and beats "dry air"', () => {
  assert.equal(at(55, 60, 30).tier, 'moderate');   // dew 41 would be good; rain 30% -> moderate
  assert.equal(at(55, 60, 50).tier, 'high');
  assert.equal(at(55, 60, 70).tier, 'silk');
  assert.equal(at(46, 63, 30).tier, 'moderate');   // would be dry-air, but it's wet
  assert.equal(at(84, 87, 10).tier, 'silk');       // rain never lowers a tier
});

test('no humidity data: no alarm', () => {
  assert.equal(hair.hairStatus({ humidity: null, dewPoint: null, rain: 0 }).tier, 'good');
});

test('every tier supplies the single icon and three icon files the slides need', () => {
  for (const [name, t] of Object.entries(hair.TIERS)) {
    assert.match(t.single, /\.png$/, name);
    assert.equal(t.trio.length, 3, name);
    assert.ok(t.level && t.sub && t.rec && t.color, name);
  }
});

test("the dew point stored with today's forecast beats recomputing from a newer temperature", () => {
  const row = { date_key: '2026-10-30', temp: 70, humidity: 86, precip_chance: 0, forecast: [{ dateKey: '2026-10-30', dew: 53.5 }] };
  assert.equal(hair.dewPointForRow(row), 53.5);
  assert.equal(hair.hairStatusForRow(row).tier, 'good');
  // without the pinned value it would have drifted up (good -> moderate) as the temperature rose
  assert.equal(hair.hairStatusForRow({ ...row, forecast: [] }).tier, 'moderate');
});

// ── get-daily: after the post, humidity is frozen, so the dew point must be too ──
function mockGetDaily(row) {
  const seen = { patches: [] };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const json = (b, ok = true, status = 200) => ({ ok, status, json: async () => b, text: async () => (b == null ? '' : JSON.stringify(b)) });
    if (u.includes('/rest/v1/daily') && opts.method === 'PATCH') { seen.patches.push(JSON.parse(opts.body)); return json(null); }
    if (u.includes('/rest/v1/daily')) return json([row]);
    if (u.includes('/weather_log')) return json(null, true, 201);
    if (u.includes('api.weather.gov')) throw new Error('nws down');
    if (u.includes('data/2.5/weather')) return json({ cod: 200, dt: Math.floor(Date.now() / 1000), main: { temp: 70, feels_like: 70, humidity: 40, temp_max: 72, temp_min: 50 }, weather: [{ description: 'clear sky' }], wind: { speed: 5 } });
    if (u.includes('data/2.5/forecast')) {
      const base = Math.floor(Date.now() / 1000);
      return json({ list: [1, 4].map(i => ({ dt: base + i * 3600, main: { temp: 70 + i, temp_max: 72 }, pop: 0 })) });
    }
    throw new Error('unexpected fetch ' + u);
  };
  return seen;
}
const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const postedRow = () => ({
  date_key: key, temp: 57.65, high: 63.6, low: 49, feels_like: 57, humidity: 86, precip_chance: 0, wind_speed: 6, condition: 'broken clouds',
  score: 5, penalties: [], forecast: [{ dateKey: key, day: 'Fri', high: 63.6, rain: 0 }],
  synopsis_approved: 'cool start', approved: true, ig_posted: true, updated_at: '2020-01-01T00:00:00Z'
});

test('get-daily: a later refresh on a posted day pins the 8am dew point, and ships the hair forecast', async () => {
  const seen = mockGetDaily(postedRow());
  delete require.cache[require.resolve('../netlify/functions/get-daily.js')];
  const { handler } = require('../netlify/functions/get-daily.js');
  const res = await handler({ httpMethod: 'GET', queryStringParameters: {} });
  const body = JSON.parse(res.body);

  const patch = seen.patches[0];
  const todayEntry = patch.forecast.find(f => f.dateKey === key);
  assert.equal(patch.humidity, undefined, 'humidity stays frozen');
  assert.equal(todayEntry.dew, 53.5, 'dew point frozen with it, not recomputed from the new 70 degrees');
  assert.equal(body.hair.tier, 'good');
  assert.equal(body.hair.level, 'GOOD HAIR DAY');
  assert.equal(body.hair.sub, 'COLD AIR, LOW FRIZZ.');
});
