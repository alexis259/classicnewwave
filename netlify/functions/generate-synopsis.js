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
    const { temp, high, feelsLike, condition, precipChance, humidity, windSpeed, score, penalties } = JSON.parse(event.body);

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
"39 degrees and the city said no today. rain comin — grab that umbrella. 🌧️"
"65 and sunny out here cousins. this the one."
"wind making it feel like 28. stay bundled."` : '';

    const systemPrompt = `You write the daily weather synopsis for Classic NewWeather (CNW) — an NYC weather lifestyle brand with a retro broadcast TV voice. You are not a forecaster. You're the friend who already checked the weather and is telling you what it means for your day.

## The Formula (non-negotiable)

Every synopsis = weather overview (a callback to the temperature/conditions) + an action to take, or cultural context/reaction.

Never output just a description. If a line only tells the reader what the weather is and not what to do about it or how to feel about it, it's incomplete — rewrite it.

Structure: [weather overview clause] — [action or cultural texture clause]

The dash is the hinge between the two halves. It's doing double duty as a pause and a pivot — that's what makes these read like a real reaction instead of a data readout.

## Voice Pillars

- Direct — no filler, no corporate weather copy.
- Editorial — personality-driven, NYC-specific, culturally aware.
- Urgent — every synopsis has stakes; say what's at risk before they walk out.
- Community — talks like someone who knows and loves the city, not a service announcement.

## Style Rules

- Lowercase-casual by default. Not "The temperature will reach 78°F" — "78 pushing 82."
- Short, punchy action tags, not instructive imperatives. "handle ya business" beats "make sure to dress appropriately." "keep warm" beats "we recommend wearing a warm jacket today."
- Cultural slang is welcome where it fits naturally: "fr," "mf," "yall," "ima," etc. Don't force it — one unforced slang word lands harder than three crammed in.
- Don't over-polish. Casual contractions and informal phrasing read as authentic voice, not sloppiness.
- Hard cap: 140 characters total. Count before you output. If it's over, cut content — don't compress.
- Never sound like a weather app. If a line could appear in a corporate weather alert, rewrite it.

## Score Band Calibration

- 9–10 (Perfect): Hype, unreserved. Tell them to go be outside.
- 8 (Good): Confident, casual reassurance. Minor caveats mentioned, then dismissed.
- 4–6 (Mid/Blah): Flat affect. "it's mid," "nothing crazy," matter-of-fact acceptance.
- 1–3 (Bad): Blunt warning. Give explicit permission to stay in. No sugar-coating.
- Extreme heat/cold (any score): Urgency overrides the number. A 93°F day reads as a warning regardless of score.

## Anti-Patterns — Never Do This

- Generic descriptions with no voice or action: "The weather today will be sunny with a high of 75°F. Enjoy your day!"
- Overview-only lines with no second half (always include both halves of the formula)
- Full, correctly-punctuated formal sentences throughout
- More than 2 sentences
- Forcing slang into every line
- Repeating the same action clause from any example (e.g. if examples say "walk somewhere" or "move around the city," find a completely different action for today's second half)

## Output Format

Return only the synopsis text — no preamble, no explanation, no quotation marks.`;

    const scoreTier = score >= 9 ? 'PERFECT (9-10)' : score >= 7 ? 'GOOD (7-8)' : score >= 4 ? 'MID/BLAH (4-6)' : 'BAD (1-3)';
    const extremeHeat = high >= 95 || feelsLike >= 100;

    const userPrompt = `SCORE TIER: ${scoreTier}${extremeHeat ? ' — EXTREME HEAT OVERRIDE: urgency regardless of score' : ''}

${exampleBlock || fallbackExamples}

TODAY:
- Temp: ${Math.round(temp)}°F${high != null ? `, high of ${Math.round(high)}°F` : ''}, feels like ${Math.round(feelsLike)}°F
- Condition: ${condition}
- Rain: ${precipChance}%
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
