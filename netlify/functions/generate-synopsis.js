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
    supabaseFetch('/synopsis_examples?select=synopsis,temp,feels_like,condition,precip_chance,score&order=created_at.desc&limit=6'),
    supabaseFetch('/daily?select=synopsis_approved,temp,feels_like,condition,precip_chance,score&approved=eq.true&synopsis_approved=not.is.null&order=date_key.desc&limit=6')
  ]);

  const examples = [];

  // Curated examples anchor the voice first
  for (const row of seeded) {
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

    const scoreTier = score >= 9 ? 'PERFECT (9-10)' : score >= 7 ? 'GOOD (7-8)' : score >= 4 ? 'MID/BLAH (4-6)' : 'BAD (1-3)';

    const prompt = `You write daily NYC weather updates in a very specific voice. Study the examples — match that energy exactly.

VOICE RULES:
- ONE sentence. never two unless absolutely necessary. shorter is always better.
- never explain, never elaborate, never justify. just say it.
- lowercase mostly. ALL CAPS only when it really lands.
- natural NYC energy — like texting a homie who keeps it real.
- no hashtags. one emoji max if it's perfect. no "hey guys".

SCORE TIER — ${scoreTier}:
${score >= 9 ? '- pure hype. this is the one. go outside energy.' : score >= 7 ? '- positive but grounded. good day, say so plainly.' : score >= 4 ? '- flat energy. matter of fact. no excitement. "it\'s aight" or "blah" level.' : '- defeated. done. minimal words. stay inside energy.'}
${score >= 88 || (feelsLike >= 100) ? '- EXCEPTION: extreme heat = bad-day urgency regardless of score. warn them.' : ''}

${exampleBlock || fallbackExamples}

TODAY:
- Temp: ${Math.round(temp)}°F${high != null ? `, high of ${Math.round(high)}°F` : ''}, feels like ${Math.round(feelsLike)}°F
- Condition: ${condition}
- Rain: ${precipChance}%
- Humidity: ${humidity}%
- Wind: ${windSpeed} mph
- Score: ${score}/10
- Issues: ${penalties && penalties.length ? penalties.join(', ') : 'none — clean day'}

Write it. Just the text. Keep it short.`;

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
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await res.json();
    const text = data.content?.[0]?.text?.trim();
    if (!text) throw new Error('No text returned');

    return { statusCode: 200, headers, body: JSON.stringify({ text }) };

  } catch (err) {
    console.error('generate-synopsis error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
