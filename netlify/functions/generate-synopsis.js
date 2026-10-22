// netlify/functions/generate-synopsis.js
// Calls Claude API server-side, pulling examples from Supabase to match writing style

const { getSlang } = require('./slang');
const { MAX_SYNOPSIS_LEN, checkSynopsis, generateChecked, trimToLength } = require('./copy-guard');
const { pickShape } = require('./synopsis-shape');

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function supabaseFetch(path, key = SUPABASE_KEY) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`
    }
  });
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function fetchExamples() {
  // Pull from both sources in parallel.
  // synopsis_examples needs the service key specifically — its RLS SELECT
  // policy blocks both the anon key AND the plain SUPABASE_KEY used
  // everywhere else in this app, returning an empty array with no error.
  // That silently made every curated example invisible to this function
  // (and to editorial.html's admin UI) since the table was first seeded.
  //
  // Sort by created_at, NOT date_key — date_key is text, and any row with a
  // malformed date_key (e.g. "Sat Mar 07 2026" from Date.toDateString()
  // instead of the ISO "2026-03-07" toNYCDateKey() produces) sorts ahead of
  // every correctly-formatted date lexicographically, permanently poisoning
  // "most recent" regardless of the actual date. created_at is a real
  // timestamp and immune to this regardless of what's in date_key.
  const [seeded, approved] = await Promise.all([
    supabaseFetch('/synopsis_examples?select=synopsis,temp,feels_like,condition,precip_chance,score', SUPABASE_SERVICE_KEY),
    supabaseFetch('/daily?select=synopsis_approved,temp,feels_like,condition,precip_chance,score&approved=eq.true&synopsis_approved=not.is.null&order=created_at.desc&limit=8')
  ]);

  // Curated examples are the ONLY voice anchor ("match this"). Recent approved
  // days used to also be shown as voice examples, which created a
  // self-reinforcing loop: if the last couple of days happened to share a
  // structure, the model would imitate it, producing a new approved day with
  // the same structure, which then anchored the day after — a repetitive
  // run that would eventually break and start a new one, just with
  // different words each time ("perfect day to X", then "go/get outside",
  // then "but [temp] is still [slang]—layers..."). Recent days are no longer
  // shown to the model at all: they're only used by copy-guard's repeat check
  // (see checkSynopsis), which compares each draft against them in code.
  const voiceExamples = seeded.sort(() => Math.random() - 0.5).slice(0, 6).map(row => ({
    synopsis: row.synopsis,
    temp: row.temp,
    feelsLike: row.feels_like,
    condition: row.condition,
    precipChance: row.precip_chance,
    score: row.score
  }));

  const recentDays = approved
    .filter(row => row.synopsis_approved)
    .map(row => row.synopsis_approved);

  return { voiceExamples, recentDays };
}

function formatExample(ex) {
  const parts = [];
  if (ex.temp) parts.push(`${Math.round(ex.temp)}°F`);
  if (ex.feelsLike && ex.feelsLike !== ex.temp) parts.push(`feels ${Math.round(ex.feelsLike)}°F`);
  if (ex.condition) parts.push(ex.condition);
  if (ex.precipChance) parts.push(`${ex.precipChance}% rain`);
  if (ex.score) parts.push(`score ${ex.score}/10`);
  const conditions = parts.length ? `[${parts.join(', ')}]` : '';
  return `${conditions}\n"${ex.synopsis}"`;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { temp, high, feelsLike, condition, precipChance, rainTiming, humidity, windSpeed, score, penalties } = JSON.parse(event.body);

    // Fetch examples (falls back gracefully if Supabase is unavailable)
    let exampleBlock = '';
    let recentDays = [];
    try {
      const fetched = await fetchExamples();
      recentDays = fetched.recentDays;
      if (fetched.voiceExamples.length > 0) {
        exampleBlock = `EXAMPLES FROM MY ACTUAL WRITING — match this voice exactly:\n${fetched.voiceExamples.map(formatExample).join('\n\n')}`;
      }
    } catch(e) {
      // Non-fatal — generate without examples
    }

    // Slang dictionary (managed in editorial.html). Empty strings if the
    // table is missing/empty, in which case the built-in guidance applies.
    const { block: slangBlock, rule: slangRule, avoid: avoidTerms } = await getSlang();

    const fallbackExamples = !exampleBlock ? `EXAMPLES:
"WE MADE IT. CALL OFF WORK. GO OUTSIDE."
"different day. same weather. just wear clothes at this point"
"rain all day and it's gonna feel colder than it actually is—just accept the L and bring an umbrella."
"its gone be hot today. but we do not care. its been too cold. go lay in the grass cousin"
"im just here to report that the weather today is NOT GOOD. v chilly and the wind got it feeling like its 16 degrees"` : '';

    const systemPrompt = `You write the daily weather synopsis for classicnewweather (CNW) — an NYC weather brand with a personal, reactive voice. You are not a forecaster. You're the friend who already checked the weather and is giving their real take.

## Voice

The CNW voice is personal and direct. It reacts to the weather like a person, not a service. Sometimes it's one punchy sentence. Sometimes it's pure emotion with no data. Sometimes it leads with the vibe and mentions the temp after. There is no single required structure — the weather dictates the form.

Good examples of the voice:
- "WE MADE IT. CALL OFF WORK. GO OUTSIDE."
- "different day. same weather. just wear clothes at this point"
- "blahhh..back to the trenches we go. today it'll be rain and it might be mixed with some snow. i dont even know anymore"
- "im just here to report that the weather today is NOT GOOD. v chilly and the wind got it feeling like its 16 degrees"
- "its gone be hot today. but we do not care. its been too cold. no complaints from me."
- "rain all day and it's gonna feel colder than 43—just accept the L and bring an umbrella."
- "Today is the last day of good weather for the foreseeable future. don't waste it inside."
- "high of 82 today so it's gonna get warm. the humidity brought the score down but we move."
- "clouds all day but we're hitting 66 and it's dry. can't even be mad at that."

Notice: these use ellipses, em-dashes, periods, and ALL CAPS selectively. They talk directly to the reader ("we", "cousin", "family", "fr"). They're honest about being tired of bad weather. They can be self-aware and meta. They rarely sound like weather copy.

## Style Rules

- Lowercase by default. ALL CAPS only for real emphasis — not every other word.
- Ellipses (...) for trail-offs and hesitation. Em-dash (—) for pivots. Mix them up.
- ${slangRule || 'Slang where it fits: "fr," "mf," "cousin," "family," "yall." Never forced.'}
- A short beat lands harder than an instruction — but vary what that beat IS. Sometimes it's an action, sometimes a reaction, sometimes a comparison, sometimes a complaint, sometimes nothing at all. Don't default to telling the reader to go do something outside.
- Length: 140 characters is a hard limit and you can't count reliably, so aim for roughly 90–120 and finish your thought inside that. Say less rather than running long — a short complete line always beats a long one that gets cut.
- 1–2 sentences max. One sentence is often stronger.

## Score Band Calibration

- 9–10 (Perfect): Unreserved hype. Make it feel unmissable — hype doesn't require literally saying "go outside," find a fresh way to sell it each time.
- 7–8 (Good): Confident. Acknowledge any caveats then dismiss them.
- 4–6 (Mid): Flat, honest acceptance. "it's mid." "nothing special." "we move anyway."
- 1–3 (Bad): Blunt. Give permission to stay in. No silver lining.
- Extreme heat/cold: Urgency regardless of score. A 95°F day is a warning.

## Rain Intensity Calibration

Match language strength to the actual rain %, never overstate it — overselling a storm that doesn't show up costs credibility with the audience:
- Above 70%: strong language is earned — "heavy rain," "pouring," "hammering," "downpour" are all fair game.
- 45–70%: moderate language only — "rain's likely," "good chance of rain," "decent shot at getting wet." No "heavy," "hammering," "pouring," or similar at this tier.
- 20–45%: soft, hedged language — "might rain," "slight chance," "keep an umbrella just in case." Don't frame this as a rain day at all.
- Under 20%: don't lead with rain, and don't mention it unless nothing else about the day is more notable.

## Anti-Patterns — Never Do This

- Never mention coffee. Not once. Not ever.
- Never name a day of the week (monday, tuesday, friday, etc.), and never write as if you know what day it is. You are not told the date, so any day you name is a guess, and a wrong one is embarrassing. Say "today" or leave time out entirely.
- Never say "good day to move around" or any variation of it.
- Never use "sticky" as the default word for humidity — find a different way every time.
- Never start with "seventy-[spelled out number] and..."
- Never use the same action clause two days in a row (check examples closely)
- Ban the entire "[adjective] day to [verb]" shape — "perfect day to walk," "good day to be outside," "great day to move around," any variant. Not once. Find a completely different way to land the vibe.
- Ban the whole MOVE of telling the reader to physically go/get/head/step/be outside — no matter how it's phrased. "go outside," "get out there," "step outside," "get out while you can," "spend time outside," "touch grass" are all the SAME move wearing different words, and swapping the wording doesn't get around the ban. Only make this move on a genuine 9-10 day, and even then say it differently than you have before.
- The EXAMPLES above show voice and range, not phrases to borrow. If the same phrase, clause, or closing move shows up in more than one example, it's now overused — do not reuse it, no matter how well it fits.
- Follow TODAY'S SHAPE in the message below. It's assigned so no two days read alike — don't swap it for a structure you like better.
- No corporate weather copy: "temperatures will reach," "conditions will be," "we recommend"
- No forced positivity on bad days — don't soften a 2/10 day
- The rain % is a whole-day worst case, not necessarily what's happening right now. If TODAY includes a rain timing window (e.g. "this evening," "overnight"), the rain isn't happening yet — say so plainly ("clear now, rain moves in tonight") instead of writing as if it's raining currently. If no timing is given, or it says "now," it's fine to treat the rain as current.

## Output Format

Return only the synopsis text — no preamble, no explanation, no quotation marks.`;

    const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

    const scoreTier = score >= 9 ? 'PERFECT (9-10)' : score >= 7 ? 'GOOD (7-8)' : score >= 4 ? 'MID/BLAH (4-6)' : 'BAD (1-3)';
    const extremeHeat = high >= 95 || feelsLike >= 100;

    // Rebuilt per attempt: a retry rotates to the next assigned shape so a
    // draft rejected as a repeat is rewritten differently, not reworded.
    const buildUserPrompt = (attempt) => {
      const shape = pickShape(dateKey, attempt);
      return `SCORE TIER: ${scoreTier}${extremeHeat ? ' — EXTREME HEAT OVERRIDE: urgency regardless of score' : ''}

${exampleBlock || fallbackExamples}

${slangBlock}

TODAY'S SHAPE (assigned — follow it):
- Structure: ${shape.form}${shape.closer ? `\n- Closing move: ${shape.closer}` : ''}

TODAY:
- Temp: ${Math.round(temp)}°F${high != null ? `, high of ${Math.round(high)}°F` : ''}, feels like ${Math.round(feelsLike)}°F
- Condition right now: ${condition}
- Rain: ${precipChance}% chance at some point today${rainTiming && rainTiming !== 'now' ? ` — peaks ${rainTiming}, not happening yet` : rainTiming === 'now' ? ' — happening now' : ''}
- Humidity: ${humidity}%
- Wind: ${windSpeed} mph
- Score: ${score}/10
- Issues: ${penalties && penalties.length ? penalties.join(', ') : 'none — clean day'}

Write the synopsis.`;
    };

    let attemptNo = 0;
    const callModel = async (extraInstruction) => {
      const userPrompt = buildUserPrompt(attemptNo++);
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          temperature: 1.0,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt + extraInstruction }]
        })
      });
      const data = await res.json();
      const out = data.content?.[0]?.text?.trim();
      if (!out) throw new Error('No text returned');
      return out;
    };

    // The model can't count characters, doesn't know the date, and will state
    // numbers that aren't in the data — so the result is checked (see
    // copy-guard.js) and regenerated when it's wrong. These are exactly the
    // values the prompt above was given, so a number the model "knew" must be
    // one of them.
    const facts = {
      temp, high, feelsLike, precipChance, humidity, windSpeed, score,
      avoidTerms, recent: recentDays, now: new Date()
    };

    // What ships if every attempt contains a factual or calendar error:
    // boring, but built only from the data, so it can't be wrong.
    const r = (v) => Math.round(Number(v));
    const safeFallback = `${r(temp)}° now${high != null ? `, topping out at ${r(high)}°` : ''}${precipChance >= 45 ? `. ${r(precipChance)}% chance of rain` : ''}.`;

    const result = await generateChecked({
      callModel,
      check: (candidate) => checkSynopsis(candidate, facts),
      fallback: safeFallback,
      label: 'generate-synopsis'
    });
    let text = result.text;

    // Only trims when a fallback was over the limit; ends on a natural break
    // instead of mid-thought.
    text = trimToLength(text, MAX_SYNOPSIS_LEN);

    return { statusCode: 200, headers, body: JSON.stringify({ text, attempts: result.attempts, usedFallback: result.usedFallback }) };

  } catch (err) {
    console.error('generate-synopsis error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
