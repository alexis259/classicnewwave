// netlify/functions/approve-synopsis.js
// Called from admin panel when you hit Approve & Publish
// Updates Supabase so every device sees the approved text immediately

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
    const { text, draft, password } = JSON.parse(event.body);

    // Auth check
    if (password !== ADMIN_PW) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const dateKey = new Date().toDateString();

    const updateData = draft
      ? { synopsis_draft: text, updated_at: new Date().toISOString() }
      : { synopsis_approved: text, approved: true, updated_at: new Date().toISOString() };

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
        body: JSON.stringify(updateData)
      }
    );

    const result = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, result }) };

  } catch (err) {
    console.error('approve-synopsis error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
