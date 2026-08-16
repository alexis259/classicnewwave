// netlify/functions/generate-synopsis.js
// Calls Claude API server-side, pulling examples from Supabase to match writing style

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function supabaseFetch(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function fetchExamples() {
  // Pull from both sources in parallel
  const [seeded, approved] = await Promise.all([
    supabaseFetch('/synopsis_examples?select=synopsis,temp,feels_like,condition,precip_chance,score'),
    supabaseFetch('/daily?select=synopsis_approved,temp,feels_like,condition,precip_chance,score&approved=eq.true&synopsis_approved=not.is.null&order=date_key.desc&limit=6')
  ]);

  const examples = [];

  // Shuffle curated examples so the same 6 don't anchor every generation
  const shuffled = seeded.sort(() => Math.random() - 0.5).slice(0, 6);

  // Curated examples anchor the voice first
  for (const row of shuffled) {
    examples.push({
      synopsis: row.synopsis,
      temp: row.temp,
      feelsLike: row.feels_like,
      condition: row.condition,
      precipChance: row.precip_chance,
      score: row.score
    });
  }

  // Recent approved synopses fill remaining slots
  for (const row of approved) {
    if (examples.length >= 8) break;
    if (row.synopsis_approved) {
      examples.push({
        synopsis: row.synopsis_approved,
        temp: row.temp,
        feelsLike: row.feels_like,
        condition: row.condition,
        precipChance: row.precip_chance,
        score: row.score
      });
    }
  }

  return examples;
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
    try {
      const examples = await fetchExamples();
      if (examples.length > 0) {
        exampleBlock = `EXAMPLES FROM MY ACTUAL WRITING — match this voice exactly:\n${examples.map(formatExample).join('\n\n')}`;
      }
    } catch(e) {
      // Non-fatal — generate without examples
    }

    const fallbackExamples = !exampleBlock ? `EXAMPLES:
"WE MADE IT. CALL OFF WORK. GO OUTSIDE."
"different day. same weather. just wear clothes at this point"
"rain all day and it's gonna feel colder than it actually is—just accept the L and bring an umbrella."
"its gone be hot today. but we do not care. its been too cold. go lay in the grass cousin"
"im just here to report that the weather today is NOT GOOD. v chilly and the wind got it feeling like its 16 degrees"` : '';

    const systemPrompt = `You write the daily weather synopsis for Classic NewWeather (CNW) — an NYC weather brand with a personal, reactive voice. You are not a forecaster. You're the friend who already checked the weather and is giving their real take.

## Voice

The CNW voice is personal and direct. It reacts to the weather like a person, not a service. Sometimes it's one punchy sentence. Sometimes it's pure emotion with no data. Sometimes it leads with the vibe and mentions the temp after. There is no single required structure — the weather dictates the form.

Good examples of the voice:
- "WE MADE IT. CALL OFF WORK. GO OUTSIDE."
- "different day. same weather. just wear clothes at this point"
- "blahhh..back to the trenches we go. today it'll be rain and it might be mixed with some snow. i dont even know anymore"
- "im just here to report that the weather today is NOT GOOD. v chilly and the wind got it feeling like its 16 degrees"
- "its gone be hot today. but we do not care. its been too cold. no complaints from me."
- "rain all day and it's gonna feel colder than 43—just accept the L and bring an umbrella."
- "happy friday. throw some layers on today - the weather is jokey again"
- "Today is the last day of good weather for the foreseeable future. don't waste it inside."
- "high of 82 today so it's gonna get warm. the humidity brought the score down but we move."
- "clouds all day but we're hitting 66 and it's dry. can't even be mad at that."

Notice: these use ellipses, em-dashes, periods, and ALL CAPS selectively. They talk directly to the reader ("we", "cousin", "family", "fr"). They're honest about being tired of bad weather. They can be self-aware and meta. They rarely sound like weather copy.

## Style Rules

- Lowercase by default. ALL CAPS only for real emphasis — not every other word.
- Ellipses (...) for trail-offs and hesitation. Em-dash (—) for pivots. Mix them up.
- Slang where it fits: "fr," "mf," "cousin," "family," "yall." Never forced.
- A short beat lands harder than an instruction — but vary what that beat IS. Sometimes it's an action, sometimes a reaction, sometimes a comparison, sometimes a complaint, sometimes nothing at all. Don't default to telling the reader to go do something outside.
- Hard cap: 140 characters. Count before output. Cut content, don't compress.
- 1–2 sentences max. One sentence is often stronger.

## Score Band Calibration

- 9–10 (Perfect): Unreserved hype. Make it feel unmissable — hype doesn't require literally saying "go outside," find a fresh way to sell it each time.
- 7–8 (Good): Confident. Acknowledge any caveats then dismiss them.
- 4–6 (Mid): Flat, honest acceptance. "it's mid." "nothing special." "we move anyway."
- 1–3 (Bad): Blunt. Give permission to stay in. No silver lining.
- Extreme heat/cold: Urgency regardless of score. A 95°F day is a warning.

## Anti-Patterns — Never Do This

- Never mention coffee. Not once. Not ever.
- Never say "good day to move around" or any variation of it.
- Never use "sticky" as the default word for humidity — find a different way every time.
- Never start with "seventy-[spelled out number] and..."
- Never use the same action clause two days in a row (check examples closely)
- Ban the entire "[adjective] day to [verb]" shape — "perfect day to walk," "good day to be outside," "great day to move around," any variant. Not once. Find a completely different way to land the vibe.
- Ban the whole MOVE of telling the reader to physically go/get/head/step/be outside — no matter how it's phrased. "go outside," "get out there," "step outside," "get out while you can," "spend time outside," "touch grass" are all the SAME move wearing different words, and swapping the wording doesn't get around the ban. Only make this move on a genuine 9-10 day, and even then say it differently than you have before.
- For whatever closes the synopsis, rotate the TYPE of move, not just the wording — a flat acceptance ("we move anyway"), a comparison to another day, a complaint, a joke, a warning, a rhetorical aside, or no closing beat at all — just the observation, full stop. Read back what you're about to write: if its function is "encouraging the reader to be outside," that's the banned move above regardless of phrasing — pick a genuinely different move instead.
- The EXAMPLES above show voice and range, not phrases to borrow. If the same phrase, clause, or closing move shows up in more than one example, it's now overused — do not reuse it, no matter how well it fits.
- No corporate weather copy: "temperatures will reach," "conditions will be," "we recommend"
- No forced positivity on bad days — don't soften a 2/10 day
- The rain % is a whole-day worst case, not necessarily what's happening right now. If TODAY includes a rain timing window (e.g. "this evening," "overnight"), the rain isn't happening yet — say so plainly ("clear now, rain moves in tonight") instead of writing as if it's raining currently. If no timing is given, or it says "now," it's fine to treat the rain as current.

## Output Format

Return only the synopsis text — no preamble, no explanation, no quotation marks.`;

    const scoreTier = score >= 9 ? 'PERFECT (9-10)' : score >= 7 ? 'GOOD (7-8)' : score >= 4 ? 'MID/BLAH (4-6)' : 'BAD (1-3)';
    const extremeHeat = high >= 95 || feelsLike >= 100;

    const userPrompt = `SCORE TIER: ${scoreTier}${extremeHeat ? ' — EXTREME HEAT OVERRIDE: urgency regardless of score' : ''}

${exampleBlock || fallbackExamples}

TODAY:
- Temp: ${Math.round(temp)}°F${high != null ? `, high of ${Math.round(high)}°F` : ''}, feels like ${Math.round(feelsLike)}°F
- Condition right now: ${condition}
- Rain: ${precipChance}% chance at some point today${rainTiming && rainTiming !== 'now' ? ` — peaks ${rainTiming}, not happening yet` : rainTiming === 'now' ? ' — happening now' : ''}
- Humidity: ${humidity}%
- Wind: ${windSpeed} mph
- Score: ${score}/10
- Issues: ${penalties && penalties.length ? penalties.join(', ') : 'none — clean day'}

Write the synopsis.`;

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
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    const data = await res.json();
    let text = data.content?.[0]?.text?.trim();
    if (!text) throw new Error('No text returned');

    // Hard cap at 140 chars — trim at last sentence boundary if possible
    if (text.length > 140) {
      const trimmed = text.slice(0, 140);
      const lastPeriod = trimmed.lastIndexOf('.');
      text = lastPeriod > 80 ? trimmed.slice(0, lastPeriod + 1) : trimmed.trimEnd();
    }

    return { statusCode: 200, headers, body: JSON.stringify({ text }) };

  } catch (err) {
    console.error('generate-synopsis error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
