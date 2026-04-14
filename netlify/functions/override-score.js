// netlify/functions/override-score.js
// Called from admin panel to manually override today's score in Supabase

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ADMIN_PW = process.env.ADMIN_PW;

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
    const { score, password } = JSON.parse(event.body);

    if (password !== ADMIN_PW) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const s = parseInt(score);
    if (!s || s < 1 || s > 10) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Score must be 1–10' }) };
    }

    const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/daily?date_key=eq.${encodeURIComponent(dateKey)}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ score: s, updated_at: new Date().toISOString() })
      }
    );

    const result = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, result }) };

  } catch (err) {
    console.error('override-score error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
