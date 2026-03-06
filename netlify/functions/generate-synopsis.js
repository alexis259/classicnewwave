// netlify/functions/generate-synopsis.js
// Calls Claude API server-side to avoid CORS issues

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { temp, feelsLike, condition, precipChance, humidity, windSpeed, score, penalties } = JSON.parse(event.body);

    const prompt = `You write short, punchy daily NYC weather updates in a very specific voice.

VOICE RULES:
- 1-2 sentences MAX. tight.
- blend of hype and chill. never forced, never corny.
- lowercase mostly. ALL CAPS only when it really lands.
- natural NYC energy — like texting a homie who keeps it real
- weather is info, not drama. matter of fact with personality.
- no hashtags. one emoji max if it's perfect. no "hey guys".

EXAMPLES:
"39 degrees and the city said no today. rain comin — grab that umbrella. 🌧️"
"65 and sunny out here cousins. this the one."
"wind making it feel like 28. stay bundled."

TODAY:
- Temp: ${Math.round(temp)}°F, feels like ${Math.round(feelsLike)}°F
- Condition: ${condition}
- Rain: ${precipChance}%
- Humidity: ${humidity}%
- Wind: ${windSpeed} mph
- Score: ${score}/10
- Issues: ${penalties && penalties.length ? penalties.join(', ') : 'none — clean day'}

Write it. Just the text.`;

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
