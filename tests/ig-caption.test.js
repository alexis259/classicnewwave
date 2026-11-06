// Run with: node --test tests/*.test.js
process.env.SUPABASE_URL = 'http://sb.test';
process.env.SUPABASE_SERVICE_KEY = 'sk';
process.env.ANTHROPIC_KEY = 'a';
const test = require('node:test');
const assert = require('node:assert/strict');

function mock(replies, prompts) {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const json = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.includes('slang_terms')) return json([]);
    prompts.push(JSON.parse(opts.body).messages[0].content);
    return json({ content: [{ text: replies.shift() }] });
  };
}
const gen = async (row) => {
  delete require.cache[require.resolve('../netlify/functions/ig-caption.js')];
  return require('../netlify/functions/ig-caption.js').generateCaption(row);
};
const TAGS = '\n\n#NYC #NewYork #NYCWeather';

const cool = { temp: 57.65, low: 49, high: 63.59, feels_like: 57.16, precip_chance: 0, humidity: 86, wind_speed: 8, score: 5, condition: 'broken clouds', penalties: ['a bit cool', 'overcast'], synopsis_approved: '' };

test('caption on a cool, high-RH day: told the air is comfortable; a humidity caption is redone', async () => {
  const prompts = [];
  mock([
    "64 and cloudy, humid and heavy out there. 5/10, link in bio." + TAGS,
    "64 and cloudy, bring a layer. 5/10, link in bio." + TAGS
  ], prompts);
  const out = await gen(cool);
  assert.match(prompts[0], /Air: comfortable \(dew point 53°F\)\. Do not mention humidity/);
  assert.equal(out, "64 and cloudy, bring a layer. 5/10, link in bio." + TAGS);
  assert.match(prompts[1], /dew point is 53/);
});

test('caption on a muggy day: the air line allows it', async () => {
  const prompts = [];
  mock(["84 and swampy out there. 5/10, link in bio." + TAGS], prompts);
  const out = await gen({ ...cool, temp: 82, high: 84, feels_like: 90, humidity: 85, penalties: ['humid & heavy'], condition: 'few clouds' });
  assert.match(prompts[0], /Air: heavy and muggy \(dew point 77°F\)\. Mention it only if it matters/);
  assert.match(out, /swampy/);
});
