// Run with: node --test tests/*.test.js
// The repeat check, run on the four real posts that read alike (Oct 18-21, 2026),
// plus the cases that must NOT be flagged.
const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../netlify/functions/copy-guard.js');
const { pickShape, FORMS, CLOSERS } = require('../netlify/functions/synopsis-shape.js');
const { withBaseline } = require('../netlify/functions/slang.js');

const OCT18 = "WIND'S MAKING 43 FEEL LIKE 36...BUNDLE UP BUT IT CLEARS OUT NICE BY AFTERNOON.";
const OCT19 = "49 to 65 and we're climbing out of the cold-humidity's there but it's dry and that's what matters.";
const OCT20 = "THE WIND'S SHARP BUT THE SKY'S CLEAN AND WE'RE CLIMBING TO 65—THIS HITS DIFFERENT FR.";
const OCT21 = "THE WIND'S GOT TEETH BUT WE'RE CLIMBING TO 63 AND THE SKY'S HOLDING—THIS ONE'S A W.";
const avoidTerms = withBaseline([]);
const repeats = (text, recent) => g.repeatProblems(text, { recent }).map(p => p.msg);

test('Oct 21 is rejected against Oct 18-20: same opener, same phrase, same pivot', () => {
  const m = repeats(OCT21, [OCT20, OCT19, OCT18]);
  assert.ok(m.some(x => /opened the same way/.test(x)), m.join('|'));
  assert.ok(m.some(x => /reused a phrase/.test(x)), m.join('|'));
  assert.ok(m.some(x => /"but" pivot/.test(x)), m.join('|'));
});

test('Oct 20 is rejected against Oct 18-19: the "but" pivot every day used', () => {
  const m = repeats(OCT20, [OCT19, OCT18]);
  assert.ok(m.some(x => /"but" pivot/.test(x)), m.join('|'));
});

test('the filler slang on Oct 20 and 21 is now a hard rejection', () => {
  const ctx = { avoidTerms, score: 9, high: 65, temp: 60, feelsLike: 58, precipChance: 0, humidity: 50, windSpeed: 8, now: new Date('2026-10-20T12:00:00-04:00') };
  assert.ok(g.checkSynopsis(OCT20, ctx).some(p => p.type === 'avoid' && p.hard));
  assert.ok(g.checkSynopsis(OCT21, { ...ctx, score: 8, high: 63 }).some(p => p.type === 'avoid' && p.hard));
});

test('a number change alone does not make a phrase new', () => {
  const m = repeats('cool start then we reach 71 by lunch', ['cool start then we reach 68 by lunch']);
  assert.ok(m.some(x => /reused a phrase/.test(x)));
});

test('genuinely different copy is not flagged', () => {
  const recent = [OCT21, OCT20, OCT19, OCT18];
  for (const t of [
    'jacket weather. the wind has opinions.',
    'ugh. 58 and gray and nobody asked.',
    'rain starts around lunch so pack the umbrella now',
  ]) assert.deepEqual(repeats(t, recent), [], t);
});

test('no recent days means nothing to compare', () => {
  assert.deepEqual(repeats(OCT21, []), []);
  assert.deepEqual(repeats(OCT21, undefined), []);
});

test('a device only counts as overused when most recent days used it', () => {
  // ellipsis used by 1 of 4 recent days: fine
  const m = repeats('cold today... dress for it', ['sunny and warm', 'mild all day', 'rain later', 'pretty out... enjoy it']);
  assert.equal(m.some(x => /ellipsis/.test(x)), false);
});

test('checkSynopsis includes the repeat check', () => {
  const ctx = { recent: [OCT20], avoidTerms: [], now: new Date('2026-10-21T12:00:00-04:00') };
  assert.ok(g.checkSynopsis(OCT21, ctx).some(p => p.type === 'repeat'));
});

test('shape: consecutive days never share a form or closer, and every one gets used', () => {
  const start = new Date('2026-10-01T12:00:00Z').getTime();
  const days = Array.from({ length: 60 }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10));
  const shapes = days.map(d => pickShape(d));
  for (let i = 1; i < shapes.length; i++) {
    assert.notEqual(shapes[i].formIdx, shapes[i - 1].formIdx, days[i]);
    if (shapes[i].closer && shapes[i - 1].closer) assert.notEqual(shapes[i].closerIdx, shapes[i - 1].closerIdx, days[i]);
  }
  assert.equal(new Set(shapes.map(s => s.formIdx)).size, FORMS.length);
  assert.equal(new Set(shapes.map(s => s.closerIdx)).size, CLOSERS.length);
});

test('shape: a retry rotates to a different form', () => {
  assert.notEqual(pickShape('2026-10-21', 0).formIdx, pickShape('2026-10-21', 1).formIdx);
});

test('slang baseline: the owner can reclaim a term by marking it "use"', () => {
  assert.ok(withBaseline([]).includes('W'));
  assert.ok(!withBaseline([], ['w']).includes('W'));
  assert.equal(withBaseline(['W']).filter(t => t.toLowerCase() === 'w').length, 1);
});
