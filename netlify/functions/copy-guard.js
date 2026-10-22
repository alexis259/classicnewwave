// netlify/functions/copy-guard.js
// Checks, retry, and cleanup shared by every copy generator (generate-synopsis,
// ig-caption, alert-copy), so they all enforce the same rules instead of each
// carrying their own.
//
// Why this exists: these writers are language models. They can't count
// characters, don't know what day it is, and will state numbers that aren't
// in the data. Each of those has already reached a real post (a Thursday
// called "tuesday", "mid-march" in August, "hitting 85" on an 81° day, a
// caption scoring the day 5/10 when it was 7). A prompt asks nicely; this
// checks the result and regenerates when it's wrong.
//
// Every problem is either:
//   hard — a factual or calendar error. Never ships. If every attempt has
//          one, a safe, boring, factually-correct fallback is used instead.
//   soft — a style miss (repetitive shape, etc). Triggers a retry, but if no
//          attempt is clean, the least-bad one still ships.
//
// The rejected text is deliberately NEVER echoed back to the model in a retry:
// a literal bad example in a prompt gets copied rather than avoided.

const MAX_SYNOPSIS_LEN = 140;
const MAX_CAPTION_LEN = 2000; // Instagram's limit is 2200

// ───────────────────────── calendar claims ─────────────────────────
// The writers aren't told the date, so anything they say about it is a guess.

// "monday" … "sunday". No word boundaries on purpose, so hashtags like
// #MondayVibes match too. (Plain "sun" / "mon" don't: sun is a weather word.)
const DAY_NAME = /(?:mon|tues|wednes|thurs|fri|satur|sun)day/i;
const RELATIVE_TIME = /\b(?:tomorrow|yesterday|weekends?|weekdays?|last night|this week|next week|last week|all week|rest of the week)\b/i;
const HOLIDAY = /\b(?:halloween|thanksgiving|christmas|xmas|new year'?s|memorial day|labor day|fourth of july|4th of july|independence day|easter|valentine'?s|mlk day|columbus day|veterans day)\b/i;
const CLOCK_TIME = /\b\d{1,2}(?::\d{2})?\s?(?:a\.?m\.?|p\.?m\.?)(?=\W|$)/i;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
// "may" is a common verb ("this may be rough") and "march" can be one too, so
// those two only count in month-like phrasing.
const MONTH_RES = MONTHS.map((name, i) => {
  if (name === 'may') return null;
  if (name === 'march') return [i, /\b(?:mid-?|early |late |in |this |last |next )march\b|#march\b/i];
  return [i, new RegExp(`\\b${name}\\b|#${name}\\b`, 'i')];
}).filter(Boolean);

const SEASON_RES = {
  winter: /\bwinter(?:time)?\b|#winter/i,
  spring: /\bspring(?:time)?\b|#spring/i,
  summer: /\bsummer(?:time)?\b|#summer/i,
  // "fall" is also a verb ("temps fall tonight"), so only count it in
  // season-like phrasing.
  fall: /\bautumn\b|#fall\w*|\bfall(?:\s+(?:weather|vibes?|feel|feels|season|is here|colors|foliage|days?|air|chill|jacket|wardrobe))\b|\bit'?s (?:officially )?fall\b/i
};

// Meteorological seasons (Dec-Feb winter, Mar-May spring, ...).
function meteorologicalSeason(m) {
  if (m === 11 || m <= 1) return 'winter';
  if (m <= 4) return 'spring';
  if (m <= 7) return 'summer';
  return 'fall';
}
// Astronomical seasons (equinoxes/solstices, approximated to the day).
function astronomicalSeason(m, d) {
  const md = (m + 1) * 100 + d; // m is 0-based; thresholds below are MMDD
  if (md >= 1221 || md < 320) return 'winter';
  if (md < 621) return 'spring';
  if (md < 922) return 'summer';
  return 'fall';
}

// NYC month (0-11) and day — the app's day is NYC's day, not the server's (UTC).
function nycDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric' }).formatToParts(now);
  const get = (t) => parseInt(parts.find(p => p.type === t).value, 10);
  return { month: get('month') - 1, day: get('day') };
}
function nycMonth(now = new Date()) {
  return nycDateParts(now).month;
}

function namesADay(text) {
  return DAY_NAME.test(text || '');
}

function calendarProblems(text, { now = new Date(), seasons = true } = {}) {
  const out = [];
  const add = (msg) => out.push({ type: 'calendar', hard: true, msg });

  if (DAY_NAME.test(text)) add('named a day of the week');
  if (RELATIVE_TIME.test(text)) add('referred to a time it cannot know about (tomorrow, yesterday, the weekend, this week)');
  if (HOLIDAY.test(text)) add('mentioned a holiday');
  if (CLOCK_TIME.test(text)) add('stated a clock time it was never given');

  if (seasons) {
    const m = nycMonth(now);
    for (const [i, re] of MONTH_RES) {
      if (i !== m && re.test(text)) { add(`named the wrong month (it is not ${MONTHS[i]})`); break; }
    }
    // Accept either definition, so early-September "summer" or late-September
    // "fall" isn't flagged during the weeks the two calendars disagree.
    const { month, day } = nycDateParts(now);
    const validNow = new Set([meteorologicalSeason(month), astronomicalSeason(month, day)]);
    for (const [name, re] of Object.entries(SEASON_RES)) {
      if (!validNow.has(name) && re.test(text)) { add(`referred to ${name} but it is not ${name}`); break; }
    }
  }
  return out;
}

// ───────────────────────── numbers & score ─────────────────────────

function roundedValues(ctx) {
  return [ctx.temp, ctx.high, ctx.feelsLike, ctx.precipChance, ctx.humidity, ctx.windSpeed, ctx.score]
    .filter(v => v != null && !Number.isNaN(Number(v)))
    .map(v => Math.round(Number(v)));
}

// Any number of 15+ must come from today's data (or from the approved
// synopsis the caption is built on). Smaller numbers are left alone: they're
// "3 degrees", "5 mph", and the 10 in "9/10".
function numberProblems(text, ctx) {
  const stripped = text
    .replace(/#\w+/g, ' ')
    .replace(/\b\d{1,2}\s*\/\s*10\b/g, ' ')
    .replace(/\b\d{1,2}(?::\d{2})?\s?(?:a\.?m\.?|p\.?m\.?)(?=\W|$)/gi, ' ');

  const allowed = new Set(roundedValues(ctx));
  (ctx.extraAllowedNumbers || []).forEach(n => allowed.add(Math.round(n)));

  const temps = [ctx.temp, ctx.high, ctx.feelsLike].filter(v => v != null).map(Number);
  const bad = new Set();
  for (const m of stripped.matchAll(/\d+(?:\.\d+)?(s?)/g)) {
    const n = parseFloat(m[0]);
    if (n < 15) continue;
    if (m[1]) { // "70s" / "mid-70s": fine if any real temperature is in that decade
      if (temps.some(t => t >= n && t < n + 10)) continue;
    } else if (allowed.has(Math.round(n))) continue;
    bad.add(m[0]);
  }
  if (!bad.size) return [];

  const list = [...allowed].sort((a, b) => a - b).join(', ');
  return [{ type: 'number', hard: true, msg: `stated a number that is not in today's data (${[...bad].join(', ')}) — only use numbers from the data: ${list}` }];
}

function scoreProblems(text, ctx) {
  if (ctx.score == null) return [];
  const claimed = new Set();
  for (const m of text.matchAll(/\b(\d{1,2})\s*\/\s*10\b/g)) claimed.add(parseInt(m[1], 10));
  for (const m of text.matchAll(/\bscore\s*(?:of|is|:)?\s*(\d{1,2})\b/gi)) claimed.add(parseInt(m[1], 10));
  const wrong = [...claimed].filter(n => n !== Math.round(ctx.score));
  return wrong.length
    ? [{ type: 'score', hard: true, msg: `gave a score of ${wrong[0]}/10 but today's score is ${Math.round(ctx.score)}/10` }]
    : [];
}

// ───────────────────── claims that contradict the data ─────────────────────

const STRONG_RAIN = /\b(?:pouring|poured|pours|hammer(?:ing|s|ed)?|downpours?|torrential|deluge|drenched|soaked|soaking|buckets|cats and dogs|flood(?:ing|ed)?|heavy rain)\b/i;
const NO_RAIN = /\b(?:no rain|zero rain|zero chance|bone[- ]dry|rain[- ]free|dry all day|completely dry|totally dry|not a drop)\b/i;
// "it's dry", "stays dry", "pretty dry" — as a description of the day. Advice
// ("stay dry", "keep dry") is not matched. Readers hear "dry" as low humidity,
// so on a humid day it contradicts the humidity the graphic itself shows.
const CALLS_DAY_DRY = /\b(?:it'?s|its|is|are|stays|remains|looks|be|being|pretty|mostly|totally|completely|actually|still|but|and)\s+dry\b/i;
const HUMID_ABOVE = 70; // matches the scoring band where humidity starts costing points
const COLD_WORDS = /\b(?:freezing|frigid|arctic|bitter(?:ly)?)\b/i;
const HOT_WORDS = /\b(?:scorching|sweltering|boiling|blistering|oven)\b/i;

function dataClaimProblems(text, ctx) {
  const out = [];
  const add = (msg) => out.push({ type: 'claim', hard: true, msg });

  if (ctx.precipChance != null) {
    if (STRONG_RAIN.test(text) && ctx.precipChance <= 70) {
      add(`used heavy-rain language but the rain chance is only ${Math.round(ctx.precipChance)}%`);
    }
    if (NO_RAIN.test(text) && ctx.precipChance >= 60) {
      add(`said there is no rain but the rain chance is ${Math.round(ctx.precipChance)}%`);
    }
  }
  if (ctx.humidity != null && ctx.humidity > HUMID_ABOVE && CALLS_DAY_DRY.test(text)) {
    add(`called the day "dry" while humidity is ${Math.round(ctx.humidity)}% — say "no rain" if that's what you mean, or describe the humidity`);
  }
  if (ctx.feelsLike != null) {
    if (COLD_WORDS.test(text) && ctx.feelsLike > 45) add(`called it freezing but it feels like ${Math.round(ctx.feelsLike)}°`);
    if (HOT_WORDS.test(text) && ctx.feelsLike < 85) add(`called it scorching but it feels like ${Math.round(ctx.feelsLike)}°`);
  }
  return out;
}

// Terms the owner marked "avoid" in the slang dictionary. Asked of the model
// in the prompt; enforced here.
function avoidProblems(text, ctx) {
  const hit = (ctx.avoidTerms || []).find(t => {
    const term = String(t || '').trim();
    if (!term) return false;
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\w])${esc}(?:[^\\w]|$)`, 'i').test(text);
  });
  return hit ? [{ type: 'avoid', hard: true, msg: `used a term the owner banned ("${hit}")` }] : [];
}

// ───────────────────────── style (soft) ─────────────────────────
// Repetitive shapes that have each taken over the synopsis for days at a time.

function styleProblems(text, ctx) {
  const out = [];
  const add = (msg) => out.push({ type: 'style', hard: false, msg });
  if (/\b(?:perfect|good|great|solid|nice|best|ideal|beautiful|gorgeous|lovely|fine|decent)\s+day\s+to\b/i.test(text)) {
    add('used the "[adjective] day to [verb]" shape');
  }
  if (!(ctx.score >= 9) && (/\b(?:go|get|head|step)\s+(?:outside|out there|out and)\b|\btouch grass\b|\bget out\b/i.test(text))) {
    add('told the reader to go outside');
  }
  if (/\bbut\b[^.!?\n]{0,60}\bstill\b/i.test(text)) {
    add('used the "gripe, but it\'s still fine" concession shape');
  }
  if (/\bcoffee\b/i.test(text)) add('mentioned coffee');
  return out;
}

// ───────────────────────── repetition across days (soft) ─────────────────────────
// A prompt can't make a model vary day to day, so each draft is compared with
// the last several approved synopses (ctx.recent, newest first). Words alone
// aren't the signal — numbers are normalised and filler words ignored, so
// "climbing to 63" and "climbing to 65" count as the same phrase.
// The retry message never quotes the repeated text (see header).

const FILLER = new Set([
  'the', 'a', 'an', 'and', 'but', 'or', 'so', 'it', 'its', "it's", 'is', 'are', 'was', 'be', 'to', 'of',
  'in', 'on', 'at', 'for', 'with', 'we', "we're", 'you', "you're", 'your', 'i', 'im', "i'm", 'that', "that's",
  'this', 'just', 'still', 'out', 'up', 'today', 'all', 'day', 'then', 'not', 'no', 'as', 'by', 'from',
  'like', 'if', 'than', '#'
]);

function tokens(text) {
  return String(text || '').toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\d+(?:\.\d+)?/g, ' # ')
    .replace(/[^a-z#'\s]/g, ' ')
    .split(/\s+/).filter(Boolean);
}

function ngrams(toks, n) {
  const out = new Set();
  for (let i = 0; i + n <= toks.length; i++) {
    const gram = toks.slice(i, i + n);
    if (gram.every(w => FILLER.has(w))) continue; // "and the", "it's all" say nothing
    out.add(gram.join(' '));
  }
  return out;
}

function closingClause(text) {
  const parts = String(text || '').split(/\s*(?:—|\.{2,}|…|[.!?])\s*/).map(x => x.trim()).filter(Boolean);
  return tokens(parts[parts.length - 1] || '');
}

// Punctuation/word devices a synopsis can lean on. Using one that most recent
// days also used is how a "voice" turns into a template.
const DEVICES = {
  'a "but" pivot': (t) => /\bbut\b/i.test(t),
  'an em-dash pivot': (t) => t.includes('—'),
  'an ellipsis trail-off': (t) => /\.{3}|…/.test(t)
};

function repeatProblems(text, ctx) {
  const recent = (ctx.recent || []).filter(Boolean);
  if (!recent.length) return [];
  const out = [];
  const add = (msg) => out.push({ type: 'repeat', hard: false, msg });

  const toks = tokens(text);
  const recentToks = recent.map(tokens);

  const opener = toks.slice(0, 2).join(' ');
  if (toks.length >= 2 && recentToks.some(r => r.slice(0, 2).join(' ') === opener)) {
    add('opened the same way as a recent day');
  }

  const closer = closingClause(text);
  if (closer.length >= 2 && recent.some(r => {
    const rc = closingClause(r);
    return rc.length >= 2 && (rc.slice(-2).join(' ') === closer.slice(-2).join(' ') ||
      rc.slice(0, 2).join(' ') === closer.slice(0, 2).join(' '));
  })) {
    add('closed the same way as a recent day');
  }

  const grams3 = ngrams(toks, 3);
  if (recentToks.some(r => { const g = ngrams(r, 3); return [...grams3].some(x => g.has(x)); })) {
    add('reused a phrase from a recent day');
  } else {
    // A two-word phrase is only a problem once it has run on several days.
    const bigrams = ngrams(toks, 2);
    const overused = [...bigrams].some(b => recentToks.filter(r => ngrams(r, 2).has(b)).length >= 2);
    if (overused) add('leaned on a phrase that has already run on several recent days');
  }

  const lastFew = recent.slice(0, 4);
  const need = Math.min(3, lastFew.length);
  if (need >= 2) {
    for (const [name, uses] of Object.entries(DEVICES)) {
      if (uses(text) && lastFew.filter(uses).length >= need) {
        add(`used ${name}, which nearly every recent day also used`);
      }
    }
  }
  return out;
}

// ───────────────────────── per-kind checks ─────────────────────────

function lengthProblem(text, max) {
  // Fixable: over-long text can still be trimmed cleanly, so this is soft.
  return text.length > max
    ? [{ type: 'length', hard: false, msg: 'ran over the length limit — keep it under 115 characters total' }]
    : [];
}

function checkSynopsis(text, ctx = {}) {
  return [
    ...lengthProblem(text, MAX_SYNOPSIS_LEN),
    ...calendarProblems(text, ctx),
    ...numberProblems(text, ctx),
    ...scoreProblems(text, ctx),
    ...dataClaimProblems(text, ctx),
    ...avoidProblems(text, ctx),
    ...styleProblems(text, ctx),
    ...repeatProblems(text, ctx)
  ];
}

function checkCaption(text, ctx = {}) {
  const out = [
    ...calendarProblems(text, ctx),
    ...numberProblems(text, ctx),
    ...scoreProblems(text, ctx),
    ...dataClaimProblems(text, ctx),
    ...avoidProblems(text, ctx)
  ];
  if (text.length > MAX_CAPTION_LEN) out.push({ type: 'length', hard: true, msg: 'is too long for an Instagram caption' });
  if (!/#NYC\b/i.test(text) || !/#NewYork\b/i.test(text)) {
    out.push({ type: 'style', hard: false, msg: 'left out the required #NYC and #NewYork hashtags' });
  }
  return out;
}

// Alerts: the owner's rules are no temperature numbers, no times or durations,
// and nothing that reads as fear-mongering. Season/month are skipped because
// real alert names legitimately contain them ("Winter Storm Warning").
const ALERT_TEMP = /\d+\s*(?:°|degrees?)/i;
const ALERT_TIME = /\b\d{1,2}(?::\d{2})?\s?(?:a\.?m\.?|p\.?m\.?)(?=\W|$)|\buntil\b|\bexpires?\b|\bfor the next\b|\bthrough (?:tonight|the night|midnight|noon)\b|\bby (?:noon|midnight)\b/i;
const ALERT_FEAR = /\b(?:devastating|catastrophic|deadly|brutal|apocalyptic|life-threatening|doomsday|terrifying|horrific|disaster)\b/i;

function checkAlert(text, { kind = 'caption' } = {}) {
  const out = calendarProblems(text, { seasons: false });
  const add = (msg) => out.push({ type: 'alert', hard: true, msg });
  if (ALERT_TEMP.test(text)) add('included a temperature number');
  if (ALERT_TIME.test(text)) add('mentioned a time or duration');
  if (ALERT_FEAR.test(text)) add('used fear-mongering language');
  if (kind === 'advisory') {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length !== 2) add('was not exactly 2 lines');
  }
  return out;
}

// ───────────────────────── trimming ─────────────────────────

// Words a sentence can't end on, used only when a cut has no punctuation to
// land on, to avoid ending on "...than" or "...but honestly it's".
const DANGLING = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'so', 'nor', 'yet', 'than', 'that', 'which',
  'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'about', 'like',
  'is', 'are', 'was', 'were', 'be', 'it', "it's", "that's", "there's", "we're", "you're",
  "they're", "i'm", "he's", "she's", 'its', 'your', 'our', 'their', 'this', 'these', 'those',
  'not', 'just', 'still', 'even', 'though', 'because', 'if', 'when', 'while', 'honestly'
]);

const MIN_CUT = 40; // don't return a stub when cutting at a break

// Cut `text` to at most `max` chars, ending on a natural break (sentence end,
// ellipsis, em-dash, comma, semicolon) rather than mid-thought.
function trimToLength(text, max = MAX_SYNOPSIS_LEN) {
  text = String(text || '').trim();
  if (text.length <= max) return text;

  const head = text.slice(0, max + 1); // +1 so a break sitting exactly at `max` counts
  let cutAt = -1;
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (c === '.' && head[i + 1] === '.') {
      cutAt = i; // start of an ellipsis: cut before it, skip the rest of the run
      while (head[i + 1] === '.') i++;
    } else if (c === '.' || c === '!' || c === '?') {
      cutAt = i + 1;
    } else if (c === '—' || c === ',' || c === ';') {
      cutAt = i;
    }
  }
  if (cutAt >= MIN_CUT && cutAt <= max) {
    return text.slice(0, cutAt).replace(/[\s,;—-]+$/, '').trim();
  }

  const words = text.slice(0, max).replace(/\s+\S*$/, '').split(/\s+/);
  while (words.length > 3 && DANGLING.has(words[words.length - 1].toLowerCase().replace(/[.,!?…—-]+$/, ''))) {
    words.pop();
  }
  return words.join(' ').replace(/[\s,;—-]+$/, '').trim();
}

// ───────────────────────── retry orchestration ─────────────────────────

function retryInstruction(problems) {
  const msgs = [...new Set(problems.map(p => p.msg))];
  return `\n\nYour previous attempt was rejected because it ${msgs.join('; and it ')}. ` +
    `Write a completely new one that fixes ${msgs.length > 1 ? 'all of that' : 'that'}.`;
}

// Calls `callModel` until a clean result comes back, up to `maxAttempts` or the
// time budget (these run inside time-limited serverless functions). If nothing
// is clean: ship the least-bad attempt that has no HARD problem, else `fallback`.
//   callModel(extraInstruction) -> string | null
//   check(text)                 -> [{ type, hard, msg }] (or a Promise of it)
async function generateChecked({ callModel, check, fallback, maxAttempts = 3, budgetMs = 7000, label = 'copy' }) {
  const started = Date.now();
  const attempts = [];
  let extra = '';

  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0 && Date.now() - started > budgetMs) break;

    const candidate = await callModel(extra);
    if (candidate == null) {
      console.warn(`${label}: model returned nothing — using fallback`);
      return { text: fallback, attempts: attempts.length + 1, usedFallback: true, problems: [] };
    }
    const problems = await check(candidate);
    attempts.push({ candidate, problems });
    if (!problems.length) return { text: candidate, attempts: attempts.length, usedFallback: false, problems: [] };
    extra = retryInstruction(problems);
  }

  const shippable = attempts.filter(a => !a.problems.some(p => p.hard));
  if (shippable.length) {
    const best = shippable.reduce((b, a) =>
      (a.problems.length < b.problems.length ||
       (a.problems.length === b.problems.length && a.candidate.length < b.candidate.length)) ? a : b);
    console.warn(`${label}: no clean attempt in ${attempts.length}; shipping least-bad (${best.problems.map(p => p.type).join(',')})`);
    return { text: best.candidate, attempts: attempts.length, usedFallback: false, problems: best.problems };
  }

  console.warn(`${label}: every attempt had a hard error (${[...new Set(attempts.flatMap(a => a.problems.filter(p => p.hard).map(p => p.type)))].join(',')}) — using safe fallback`);
  return { text: fallback, attempts: attempts.length, usedFallback: true, problems: attempts[attempts.length - 1].problems };
}

module.exports = {
  MAX_SYNOPSIS_LEN,
  namesADay,
  trimToLength,
  checkSynopsis,
  checkCaption,
  checkAlert,
  generateChecked,
  // exposed for tests
  calendarProblems, numberProblems, scoreProblems, dataClaimProblems, styleProblems, repeatProblems, nycMonth
};
