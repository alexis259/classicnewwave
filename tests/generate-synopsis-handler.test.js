// End-to-end through the real handler with fetch mocked: what the model is
// shown, and what happens when its first drafts repeat recent days.
process.env.SUPABASE_URL = 'http://sb.test';
process.env.SUPABASE_KEY = 'k';
process.env.SUPABASE_SERVICE_KEY = 'sk';
process.env.ANTHROPIC_KEY = 'a';
const test = require('node:test');
const assert = require('node:assert/strict');

const RECENT = [
  "THE WIND'S SHARP BUT THE SKY'S CLEAN AND WE'RE CLIMBING TO 65—THIS HITS DIFFERENT FR.",
  "49 to 65 and we're climbing out of the cold-humidity's there but it's dry and that's what matters.",
  "WIND'S MAKING 43 FEEL LIKE 36...BUNDLE UP BUT IT CLEARS OUT NICE BY AFTERNOON."
];

// `garbled`: draft texts the proofreader should call GARBLED. `proofreads`
// collects the lines it was asked about. `proofreadFails`: make that call throw.
function mockFetch(replies, prompts, { garbled = [], proofreads = [], proofreadFails = false } = {}) {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (u.includes('/daily?')) return json(RECENT.map(s => ({ synopsis_approved: s })));
    if (u.includes('/synopsis_examples')) return json([]);
    if (u.includes('/slang_terms')) return json([]);
    if (u.includes('anthropic.com')) {
      const body = JSON.parse(opts.body);
      if (body.messages[0].content.startsWith('You proofread')) {
        const line = body.messages[0].content.split('Line: ')[1];
        proofreads.push(line);
        if (proofreadFails) throw new Error('network down');
        return json({ content: [{ text: garbled.includes(line) ? 'GARBLED' : 'OK' }] });
      }
      prompts.push(body.messages[0].content);
      return json({ content: [{ text: replies.shift() }] });
    }
    throw new Error('unexpected fetch ' + u);
  };
}

const weather = { temp: 60, high: 63, feelsLike: 57, condition: 'clear sky', precipChance: 0, humidity: 55, windSpeed: 14, score: 8, penalties: ['a bit cool'] };
const call = async () => {
  delete require.cache[require.resolve('../netlify/functions/generate-synopsis.js')];
  const { handler } = require('../netlify/functions/generate-synopsis.js');
  const res = await handler({ httpMethod: 'POST', body: JSON.stringify(weather) });
  return JSON.parse(res.body);
};

test('prompt no longer shows recent days, and carries an assigned shape', async () => {
  const prompts = [];
  mockFetch(['jacket weather. 63 and clear.'], prompts);
  const out = await call();
  assert.equal(out.attempts, 1);
  assert.ok(!prompts[0].includes('RECENT DAYS'));
  assert.ok(!prompts[0].includes('CLIMBING TO 65'));
  assert.match(prompts[0], /TODAY'S SHAPE/);
  assert.match(prompts[0], /Structure:/);
});

test('a draft that repeats recent days is rejected and redone in a different shape', async () => {
  const prompts = [];
  mockFetch([
    "THE WIND'S GOT TEETH BUT WE'RE CLIMBING TO 63 AND THE SKY'S HOLDING—THIS ONE'S A W.",
    'jacket weather. 63 and clear, wind has opinions.'
  ], prompts);
  const out = await call();
  assert.equal(out.attempts, 2);
  assert.equal(out.usedFallback, false);
  assert.equal(out.text, 'jacket weather. 63 and clear, wind has opinions.');
  const shape = (p) => p.match(/Structure: (.*)/)[1];
  assert.notEqual(shape(prompts[0]), shape(prompts[1]));
  // the retry says what was wrong without quoting the rejected draft
  assert.ok(!prompts[1].includes('TEETH'));
  assert.match(prompts[1], /rejected/);
});

// Oct 19's real draft, with its numbers swapped for today's mocked data so the
// number check doesn't reject it first — the point here is the proofreader.
const OCT19 = "60 to 63 and we're climbing out of the cold-humidity's there but it's dry and that's what matters.";

test('a garbled draft is rejected by the proofreader and redone', async () => {
  const prompts = [], proofreads = [];
  mockFetch([OCT19, 'jacket weather. 63 and clear, wind has opinions.'], prompts, { garbled: [OCT19], proofreads });
  const out = await call();
  assert.equal(out.attempts, 2);
  assert.equal(out.text, 'jacket weather. 63 and clear, wind has opinions.');
  assert.match(prompts[1], /garbled/);
  assert.ok(!prompts[1].includes('cold-humidity'));
});

test('proofreader is skipped for a draft the rules already rejected', async () => {
  const prompts = [], proofreads = [];
  mockFetch(['wow 99 degrees out there', 'jacket weather. 63 and clear, wind has opinions.'], prompts, { proofreads });
  await call();
  assert.equal(proofreads.length, 1); // only the clean second draft
});

test('proofreader failing does not block a good draft', async () => {
  const prompts = [];
  mockFetch(['jacket weather. 63 and clear, wind has opinions.'], prompts, { proofreadFails: true });
  const out = await call();
  assert.equal(out.attempts, 1);
  assert.equal(out.usedFallback, false);
  assert.equal(out.text, 'jacket weather. 63 and clear, wind has opinions.');
});
