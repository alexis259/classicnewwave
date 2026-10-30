// Run with: node --test tests/*.test.js
process.env.SUPABASE_URL = 'http://sb.test';
process.env.SUPABASE_KEY = 'k';
process.env.ADMIN_PW = 'pw';
process.env.OWM_KEY = 'o';
const test = require('node:test');
const assert = require('node:assert/strict');

const posted = { date_key: 'x', high: 63.59, condition: 'broken clouds', humidity: 86, precip_chance: 0, score: 5, penalties: ['a bit cool', 'humid & heavy', 'overcast'], ig_posted: true, synopsis_approved: 'keep me' };

function mock() {
  const seen = { patches: [], logs: 0 };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const json = (b, ok = true, status = 200) => ({ ok, status, json: async () => b, text: async () => (b == null ? '' : JSON.stringify(b)) });
    if (u.includes('/rest/v1/daily') && (!opts.method || opts.method === 'GET')) return json([{ ...posted }]);
    if (u.includes('/rest/v1/daily') && opts.method === 'PATCH') {
      const body = JSON.parse(opts.body); seen.patches.push(body);
      return json([{ ...posted, ...body }]);
    }
    if (u.includes('/weather_log')) { seen.logs++; return json(null, true, 201); }
    if (u.includes('api.weather.gov')) throw new Error('nws down'); // OWM-only path is enough here
    if (u.includes('data/2.5/weather')) return json({ cod: 200, dt: Math.floor(Date.now() / 1000), main: { temp: 68, feels_like: 68, humidity: 47, temp_max: 70, temp_min: 50 }, weather: [{ description: 'clear sky' }], wind: { speed: 6 } });
    if (u.includes('data/2.5/forecast')) {
      const base = Math.floor(Date.now() / 1000);
      return json({ list: [1, 4, 7].map(i => ({ dt: base + i * 3600, main: { temp: 68 + i / 2, temp_max: 70 }, pop: 0 })) });
    }
    throw new Error('unexpected fetch ' + u);
  };
  return seen;
}
const run = async (body, method = 'POST') => {
  delete require.cache[require.resolve('../netlify/functions/refresh-today.js')];
  delete require.cache[require.resolve('../netlify/functions/weather-source.js')];
  const { handler } = require('../netlify/functions/refresh-today.js');
  const res = await handler({ httpMethod: method, body: JSON.stringify(body) });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};

test('wrong or missing password is refused and writes nothing', async () => {
  const seen = mock();
  assert.equal((await run({ password: 'nope' })).status, 401);
  assert.equal((await run({})).status, 401);
  assert.equal((await run({}, 'GET')).status, 405);
  assert.equal(seen.patches.length, 0);
});

test('rewrites the posted-and-frozen score, penalties and high, but not the synopsis or post state', async () => {
  const seen = mock();
  const r = await run({ password: 'pw' });
  assert.equal(r.status, 200);
  assert.equal(seen.patches.length, 1);
  const p = seen.patches[0];
  assert.equal(p.high, 71.5);   // OWM-only path here: max forecast slot
  assert.equal(p.condition, 'clear sky');
  assert.equal(p.humidity, 47);
  assert.equal(p.score, 10);    // 71.5° high, 47% humidity, clear, dry: no deductions
  assert.deepEqual(p.penalties, []);
  assert.ok(Array.isArray(p.penalties));
  for (const k of ['synopsis_approved', 'ig_posted', 'ig_post_id', 'ig_caption', 'approved']) assert.equal(k in p, false, k);
  assert.equal(r.body.before.score, 5);
  assert.equal(r.body.after.score, 10);
  assert.equal(r.body.before.condition, 'broken clouds');
});
