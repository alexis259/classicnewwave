// netlify/functions/subscribe.js
// Saves phone + name to Supabase subscribers table

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

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
    const { phone, name } = JSON.parse(event.body);

    if (!phone || phone.replace(/\D/g, '').length < 10) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid phone number' }) };
    }

    // Normalize to E.164 format (+1XXXXXXXXXX)
    const digits = phone.replace(/\D/g, '');
    const normalized = digits.length === 10 ? `+1${digits}` : `+${digits}`;

    const res = await fetch(`${SUPABASE_URL}/rest/v1/subscribers`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ phone: normalized, name: name || null })
    });

    if (res.status === 409) {
      // Already subscribed — that's fine, just confirm
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, already: true }) };
    }

    const result = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, result }) };

  } catch (err) {
    console.error('subscribe error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
