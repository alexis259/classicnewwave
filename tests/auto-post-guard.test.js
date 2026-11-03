// Run with: node --test tests/*.test.js
// auto-post-ig's cron path: wrong hour is skipped (daylight-saving twin run),
// and a post with no synopsis is refused BEFORE the post is claimed, so
// Netlify's retry can try again.
process.env.SUPABASE_URL = 'http://sb.test';
process.env.SUPABASE_SERVICE_KEY = 'sk';
process.env.META_IG_USER_ID = '1';
process.env.META_PAGE_ACCESS_TOKEN = 't';
process.env.ADMIN_PW = 'pw';
process.env.URL = 'http://site.test';
const test = require('node:test');
const assert = require('node:assert/strict');

const OrigDate = Date;
function pinNow(iso) {
  const fixed = new OrigDate(iso).getTime();
  global.Date = class extends OrigDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
}
const unpin = () => { global.Date = OrigDate; };

const cron = { httpMethod: 'POST', body: JSON.stringify({ next_run: 'x' }) };

function mock(row) {
  const seen = { patches: [] };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const json = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.includes('get-daily')) return json({});
    if (u.includes('/rest/v1/daily') && opts.method === 'PATCH') { seen.patches.push(JSON.parse(opts.body)); return json([]); }
    if (u.includes('/rest/v1/daily')) return json([row]);
    throw new Error('stop: ' + u); // anything past the guards ends the run here
  };
  return seen;
}
const run = async (event) => {
  delete require.cache[require.resolve('../netlify/functions/auto-post-ig.js')];
  const { handler } = require('../netlify/functions/auto-post-ig.js');
  const res = await handler(event);
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};

test('winter: the 12 UTC run (7am New York) is skipped before touching anything', async () => {
  const seen = mock({ ig_posted: false, synopsis_approved: 'x' });
  pinNow('2026-11-03T12:00:05Z');
  try {
    const r = await run(cron);
    assert.equal(r.status, 200);
    assert.equal(r.body.skipped, true);
    assert.equal(seen.patches.length, 0);
  } finally { unpin(); }
});

test('winter: at 8am New York with no synopsis, it refuses and does NOT claim the post', async () => {
  const seen = mock({ ig_posted: false, synopsis_approved: null });
  pinNow('2026-11-03T13:00:05Z');
  try {
    const r = await run(cron);
    assert.equal(r.status, 500);
    assert.match(r.body.error, /synopsis/i);
    assert.equal(seen.patches.length, 0, 'must not set ig_posted, or the retry would be skipped');
  } finally { unpin(); }
});

test('winter: at 8am New York with a synopsis, it proceeds and claims the post', async () => {
  const seen = mock({ ig_posted: false, synopsis_approved: 'cool start, clear all day' });
  pinNow('2026-11-03T13:00:05Z');
  try {
    await run(cron);
    assert.deepEqual(seen.patches[0], { ig_posted: true });
  } finally { unpin(); }
});

test('a manual post is not blocked by the synopsis guard', async () => {
  const seen = mock({ ig_posted: false, synopsis_approved: null });
  pinNow('2026-11-03T20:00:00Z');
  try {
    const r = await run({ httpMethod: 'POST', body: JSON.stringify({ password: 'pw' }) });
    assert.notEqual(r.body.error, 'No synopsis available yet');
  } finally { unpin(); }
});
