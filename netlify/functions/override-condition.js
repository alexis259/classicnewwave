// netlify/functions/override-condition.js
// Called from admin panel to manually override today's displayed condition
// (drives the weather emoji/icon) in Supabase.
//
// This is cosmetic and temporary: condition is NOT locked like precip_chance/
// humidity, so the next background refresh (every 3 hours, or any manual
// force-refresh) will overwrite it again with whatever OWM reports at that
// moment. Use this to bridge a gap where OWM's current 3-hour bucket still
// says one thing but conditions have visibly already moved on.

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
    const { condition, password } = JSON.parse(event.body);

    if (password !== ADMIN_PW) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const c = (condition || '').trim();
    if (!c) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'condition is required' }) };
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
        body: JSON.stringify({ condition: c, updated_at: new Date().toISOString() })
      }
    );

    const result = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, result }) };

  } catch (err) {
    console.error('override-condition error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
