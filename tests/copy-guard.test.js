// Run with: node --test tests/
// Every check in copy-guard.js, including the cases that must NOT be flagged —
// a check that blocks good copy is its own bug.
const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../netlify/functions/copy-guard.js');

const OCT = new Date('2026-10-10T12:00:00-04:00');   // fall, both calendars
const SEP10 = new Date('2026-09-10T12:00:00-04:00'); // meteorological fall, astronomical summer
const JAN = new Date('2026-01-15T12:00:00-05:00');
const ctx = { temp: 68, high: 75, feelsLike: 68, precipChance: 0, humidity: 55, windSpeed: 6, score: 9, now: OCT };
const types = (ps) => ps.map(p => p.type);
const msgs = (ps) => ps.map(p => p.msg).join(' | ');

test('calendar: day names, including in hashtags', () => {
  for (const t of ['still a solid vibe for a tuesday.', 'Thursday is looking good', '#NYC #MondayVibes', '#MustacheMonday', 'a wednesday kind of day']) {
    assert.ok(g.namesADay(t), t);
  }
  for (const t of ['sun is out and it feels great', 'sunny until sundown', 'harmony and friction and a monitor']) {
    assert.ok(!g.namesADay(t), t);
  }
});

test('calendar: relative time, holidays, clock times', () => {
  for (const t of ['beats yesterday though', 'tomorrow looks better', 'great weekend weather', 'all week long', 'happy halloween', 'thanksgiving vibes', 'rain by 3pm', 'clears up around 4:30 p.m.']) {
    assert.ok(g.calendarProblems(t, { now: OCT }).length, t);
  }
  for (const t of ['tonight looks clear', 'rain moves in this afternoon', 'around midday it clears up', 'we move anyway']) {
    assert.equal(g.calendarProblems(t, { now: OCT }).length, 0, t);
  }
});

test('calendar: months — wrong month flagged, current month and verbs are not', () => {
  assert.ok(g.calendarProblems('mid-march is hitting different', { now: OCT }).length);
  assert.ok(g.calendarProblems('classic april weather', { now: OCT }).length);
  assert.equal(g.calendarProblems('crisp october air', { now: OCT }).length, 0, 'current month is fine');
  assert.equal(g.calendarProblems('this may be rough but it is fine', { now: OCT }).length, 0, '"may" the verb');
  assert.equal(g.calendarProblems('the wind will march through', { now: OCT }).length, 0, '"march" the verb');
});

test('calendar: seasons — must match the real season by either calendar', () => {
  assert.ok(g.calendarProblems('#spring', { now: OCT }).length);
  assert.ok(g.calendarProblems('summer is knocking early', { now: OCT }).length);
  assert.equal(g.calendarProblems('#FallInNYC', { now: OCT }).length, 0);
  assert.equal(g.calendarProblems('temps fall tonight', { now: OCT }).length, 0, '"fall" the verb');
  assert.equal(g.calendarProblems('last gasp of summer', { now: SEP10 }).length, 0, 'astronomical summer until ~Sep 22');
  assert.equal(g.calendarProblems('fall vibes', { now: SEP10 }).length, 0, 'meteorological fall from Sep 1');
  assert.ok(g.calendarProblems('winter is coming', { now: SEP10 }).length);
  assert.equal(g.calendarProblems('real winter air today', { now: JAN }).length, 0);
});

test('calendar: season boundaries (astronomical edges and the 0-based-month trap)', () => {
  const at = (iso) => new Date(iso + 'T12:00:00-04:00');
  const flagged = (text, iso) => g.calendarProblems(text, { now: at(iso) }).length > 0;
  assert.ok(flagged('summer vibes', '2026-10-10'), 'summer is wrong in October');
  assert.ok(!flagged('summer vibes', '2026-06-25'));
  assert.ok(!flagged('summer vibes', '2026-09-21'), 'last day of astronomical summer');
  assert.ok(flagged('summer vibes', '2026-10-01'), 'meteorological fall AND astronomical fall');
  assert.ok(!flagged('fall vibes', '2026-09-22'), 'first astronomical fall day');
  assert.ok(!flagged('winter vibes', '2026-12-25'));
  assert.ok(!flagged('winter vibes', '2026-03-10'), 'astronomical winter runs to ~Mar 19');
  assert.ok(flagged('winter vibes', '2026-04-10'));
  assert.ok(!flagged('spring vibes', '2026-03-05'), 'meteorological spring from Mar 1');
  assert.ok(flagged('spring vibes', '2026-07-01'));
});

test('numbers: only numbers from the data may appear', () => {
  assert.equal(g.numberProblems('68 climbing to 75, feels like 68, 9/10', ctx).length, 0);
  assert.ok(g.numberProblems('we are hitting 85 today', ctx).length, 'the real "85 on an 81 day" mistake');
  assert.equal(g.numberProblems('3 degrees warmer, 5 mph breeze', ctx).length, 0, 'small numbers ignored');
  assert.equal(g.numberProblems('#NYC2026 #Weather', ctx).length, 0, 'hashtags ignored');
  assert.equal(g.numberProblems('lovely high 70s today', ctx).length, 0, 'decade ok when a real temp is in it');
  assert.ok(g.numberProblems('feels like the 90s', ctx).length, 'decade not ok when no temp is in it');
  assert.equal(g.numberProblems('0% chance of rain, 55% humidity', ctx).length, 0);
  assert.equal(g.numberProblems('dropping to 54 later', { ...ctx, extraAllowedNumbers: [54] }).length, 0, 'numbers from the approved synopsis are allowed');
  assert.ok(g.numberProblems('dropping to 54 later', ctx).length);
  assert.match(msgs(g.numberProblems('hitting 85', ctx)), /85/);
});

test('score: stated score must equal the real one', () => {
  assert.equal(g.scoreProblems('a clean 9/10 day', ctx).length, 0);
  assert.equal(g.scoreProblems('score: 9', ctx).length, 0);
  assert.ok(g.scoreProblems('5/10 day but the afternoon is yours', { ...ctx, score: 7 }).length, 'the real Sep 13 mistake');
  assert.ok(g.scoreProblems('score of 4', ctx).length);
  assert.equal(g.scoreProblems('no score mentioned at all', ctx).length, 0);
});

test('claims: language must match the data', () => {
  assert.ok(g.dataClaimProblems("rain's hammering down", { precipChance: 55 }).length, 'strong rain language needs >70%');
  assert.equal(g.dataClaimProblems("rain's hammering down", { precipChance: 85 }).length, 0);
  assert.ok(g.dataClaimProblems('bone dry all day', { precipChance: 90 }).length);
  assert.equal(g.dataClaimProblems('bone dry all day', { precipChance: 5 }).length, 0);
  assert.ok(g.dataClaimProblems('absolutely freezing out', { feelsLike: 60 }).length);
  assert.equal(g.dataClaimProblems('absolutely freezing out', { feelsLike: 28 }).length, 0);
  assert.ok(g.dataClaimProblems('scorching today', { feelsLike: 70 }).length);
  assert.equal(g.dataClaimProblems('scorching today', { feelsLike: 99 }).length, 0);
});

test('avoid list from the slang dictionary is enforced', () => {
  const c = { avoidTerms: ['dub', 'slaps'] };
  assert.ok(types(g.checkSynopsis('this day is a dub', c)).includes('avoid'));
  assert.ok(types(g.checkSynopsis('honestly this one SLAPS fr', c)).includes('avoid'), 'case-insensitive');
  assert.ok(!types(g.checkSynopsis('a double dose of sun', c)).includes('avoid'), 'whole words only');
  assert.ok(!types(g.checkSynopsis('nothing banned here', c)).includes('avoid'));
});

test('style (soft): repetitive shapes are flagged but never "hard"', () => {
  const s = (t, c = ctx) => g.styleProblems(t, c);
  assert.ok(s('a perfect day to walk places').length);
  assert.ok(s('get out there and enjoy it', { ...ctx, score: 8 }).length);
  assert.equal(s('get out there and enjoy it', { ...ctx, score: 10 }).length, 0, 'allowed on a 9-10');
  assert.ok(s("the humidity's thick but 74 is still solid").length);
  assert.ok(s('need coffee for this one').length);
  assert.ok(s("the humidity's thick but 74 is still solid").every(p => p.hard === false));
  assert.equal(s('clear and 68. nothing to complain about.').length, 0);
});

test('synopsis: length is soft/fixable, everything else factual is hard', () => {
  const long = g.checkSynopsis('x'.repeat(150), ctx);
  assert.deepEqual(types(long).filter(t => t === 'length'), ['length']);
  assert.ok(long.find(p => p.type === 'length').hard === false);
  assert.ok(g.checkSynopsis('a tuesday kind of day', ctx).some(p => p.hard));
  assert.deepEqual(g.checkSynopsis('clear and 68, climbing to 75. humidity behaving.', ctx), []);
});

test('caption: required hashtags (soft), real length cap (hard)', () => {
  const ok = '68 and clear today. 9/10.\n\n#NYC #NewYork #Weather';
  assert.deepEqual(g.checkCaption(ok, ctx), []);
  assert.ok(g.checkCaption('68 and clear today. 9/10.', ctx).some(p => p.type === 'style' && !p.hard));
  assert.ok(g.checkCaption('x'.repeat(2100) + ' #NYC #NewYork', ctx).some(p => p.hard));
  assert.ok(g.checkCaption('nice. 9/10 #NYC #NewYork #MondayVibes', ctx).some(p => p.type === 'calendar'));
});

test('alerts: no temps, no times/durations, no fear language, advisory is 2 lines', () => {
  const a = (t, kind) => g.checkAlert(t, { kind });
  assert.ok(a('stay safe, it is 95 degrees out', 'caption').length);
  assert.ok(a('flood watch in effect until 11pm', 'caption').length);
  assert.ok(a('this is a deadly storm', 'caption').length);
  assert.ok(a('devastating flooding ahead', 'caption').length);
  assert.ok(a('one line only', 'advisory').length);
  assert.ok(a('line one\nline two\nline three', 'advisory').length);
  assert.equal(a('storms moving through\nstay off the roads', 'advisory').length, 0);
  assert.equal(a('a winter storm warning is up. take it easy out there.\n\n#NYC', 'caption').length, 0, 'real alert names contain a season word');
});

test('trimToLength: ends on a natural break, never mid-thought', () => {
  const oct5 = "the humidity's got everything feeling thick and damp even though it's technically dry—56 to 64 and you'll want a jacket but honestly it's not bad at all today";
  const sep24 = "the wind's gonna cut through 54 and the humidity's thick but we're climbing to 67 and staying dry—layer up, it'll feel sharper than it looks right now.";
  for (const s of [oct5, sep24]) {
    const o = g.trimToLength(s);
    assert.ok(o.length <= 140);
    assert.ok(!/\b(?:it's|its|it|than|but|honestly)$/i.test(o), o);
  }
  assert.equal(g.trimToLength('short and sweet.'), 'short and sweet.');
  assert.equal(g.trimToLength('a'.repeat(140)).length, 140);
  const noBreak = 'it is a day where the weather is doing a whole lot of nothing special at all really and you could wear just about anything outside and honestly it would be fine than';
  assert.ok(!/\b(?:than|honestly)$/.test(g.trimToLength(noBreak)));
  assert.ok(!g.trimToLength("the humidity's making itself known and honestly it is a lot today...but the temperature is staying put so it all evens out in the end I guess and we move on").endsWith('.'));
});

// ───────────── generateChecked: retry / best-attempt / fallback ─────────────

function scripted(outputs) {
  const prompts = [];
  const queue = [...outputs];
  return { prompts, callModel: async (extra) => { prompts.push(extra); return queue.shift(); } };
}
const quiet = (fn) => async () => { const w = console.warn; console.warn = () => {}; try { await fn(); } finally { console.warn = w; } };
const check = (t) => g.checkSynopsis(t, ctx);
const FALLBACK = '68° now, topping out at 75°.';

test('generateChecked: clean first answer is used as-is, one call', quiet(async () => {
  const s = scripted(['clear and 68, climbing to 75. nothing to complain about.']);
  const r = await g.generateChecked({ callModel: s.callModel, check, fallback: FALLBACK });
  assert.equal(r.attempts, 1); assert.equal(r.usedFallback, false);
}));

test('generateChecked: retries on a hard error and uses the clean one', quiet(async () => {
  const s = scripted(['a tuesday kind of day', 'clear and 68, climbing to 75. easy one.']);
  const r = await g.generateChecked({ callModel: s.callModel, check, fallback: FALLBACK });
  assert.equal(r.attempts, 2); assert.ok(r.text.startsWith('clear and 68'));
}));

test('generateChecked: the retry names the problem but never echoes the rejected text', quiet(async () => {
  const s = scripted(['wednesday is looking great out there', 'clear and 68, climbing to 75.']);
  await g.generateChecked({ callModel: s.callModel, check, fallback: FALLBACK });
  assert.match(s.prompts[1], /rejected/); assert.match(s.prompts[1], /day of the week/);
  assert.ok(!/looking great/i.test(s.prompts[1]));
}));

test('generateChecked: only soft problems left -> ships the least-bad, not the fallback', quiet(async () => {
  const concession = "the humidity's thick but 68 is still solid—we move.";
  const s = scripted([concession, concession + ' fr', concession + ' ok']);
  const r = await g.generateChecked({ callModel: s.callModel, check, fallback: FALLBACK });
  assert.equal(r.usedFallback, false); assert.equal(r.attempts, 3);
  assert.ok(r.text.startsWith("the humidity's thick"));
}));

test('generateChecked: every attempt has a HARD error -> safe fallback, bad text never ships', quiet(async () => {
  const s = scripted(['a tuesday kind of day', 'we are hitting 99 today', 'it is mid-march out there']);
  const r = await g.generateChecked({ callModel: s.callModel, check, fallback: FALLBACK });
  assert.equal(r.usedFallback, true); assert.equal(r.text, FALLBACK);
}));

test('generateChecked: prefers an attempt without a hard error over one with', quiet(async () => {
  const s = scripted(['a tuesday kind of day', "the humidity's thick but 68 is still solid—we move.", 'we are hitting 99 today']);
  const r = await g.generateChecked({ callModel: s.callModel, check, fallback: FALLBACK });
  assert.equal(r.usedFallback, false); assert.ok(r.text.includes('still solid'));
}));

test('generateChecked: model returns nothing -> fallback', quiet(async () => {
  const r = await g.generateChecked({ callModel: async () => null, check, fallback: FALLBACK });
  assert.equal(r.usedFallback, true); assert.equal(r.text, FALLBACK);
}));

test('generateChecked: stops retrying when the time budget is spent', quiet(async () => {
  let calls = 0;
  const slow = async () => { calls++; await new Promise(r => setTimeout(r, 30)); return 'a tuesday kind of day'; };
  const r = await g.generateChecked({ callModel: slow, check, fallback: FALLBACK, budgetMs: 10 });
  assert.equal(calls, 1); assert.equal(r.usedFallback, true);
}));

test('claims: "dry" on a humid day is rejected; advice and dry-weather days are fine', () => {
  const humid = { ...ctx, humidity: 79, precipChance: 0 };
  for (const t of ["it's dry and that's what matters", 'mostly dry out there', 'stays dry all afternoon', 'pretty dry but heavy']) {
    assert.ok(types(g.dataClaimProblems(t, humid)).includes('claim'), t);
  }
  for (const t of ['stay dry out there', 'keep dry, rain later', 'no rain today, just thick air', 'dry cleaning day']) {
    assert.deepEqual(g.dataClaimProblems(t, humid), [], t);
  }
  // not humid: "dry" is fine
  assert.deepEqual(g.dataClaimProblems("it's dry and that's what matters", { ...ctx, humidity: 55 }), []);
  assert.deepEqual(g.dataClaimProblems("it's dry", { ...ctx, humidity: undefined }), []);
});

test('dashes: em dash, en dash, "--" and spaced hyphen all become commas; word hyphens survive', () => {
  const cases = [
    ['colder than 43—just accept the L', 'colder than 43, just accept the L'],
    ['wind is sharp — bring a jacket', 'wind is sharp, bring a jacket'],
    ['clear skies – finally', 'clear skies, finally'],
    ['clear skies -- finally', 'clear skies, finally'],
    ['clear skies - finally', 'clear skies, finally'],
    ['high of 49–65 today', 'high of 49 to 65 today'],
    ['warm... — then cool', 'warm... then cool'],
    ['rain later—', 'rain later'],
    ['—ugh, rain', 'ugh, rain'],
    ['stop—.', 'stop.'],
    ['the cold-humidity combo is rough', 'the cold-humidity combo is rough'],
    ['no dashes here', 'no dashes here'],
  ];
  for (const [input, want] of cases) assert.equal(g.stripDashes(input), want, input);
});

test('dashes: only the dashed line changes; hashtags and line breaks are untouched', () => {
  const input = "it's wet out there — layer up\n\n#NYC #NewYork #classicnewweather";
  assert.equal(g.stripDashes(input), "it's wet out there, layer up\n\n#NYC #NewYork #classicnewweather");
  assert.equal(g.stripDashes(null), '');
});
