// netlify/functions/manage-examples.js
// Add/delete rows in synopsis_examples on behalf of editorial.html.
// The anon key used client-side there can read this table but is
// intentionally blocked from writing by Supabase RLS (it's a public key,
// visible to anyone who opens dev tools — allowing it to write would let
// anyone inject arbitrary content into the brand's voice examples). This
// goes through a privileged, password-gated function instead, matching
// every other write in this app (approve-synopsis.js, override-score.js).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PW = process.env.ADMIN_PW;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bad request' }) }; }

  if (body.password !== ADMIN_PW) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    if (body.action === 'add') {
      const { synopsis, temp, feels_like, condition, precip_chance, score } = body;
      if (!synopsis) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'synopsis is required' }) };
      }

      const res = await fetch(`${SUPABASE_URL}/rest/v1/synopsis_examples`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ synopsis, temp, feels_like, condition, precip_chance, score })
      });
      if (!res.ok) throw new Error(`Insert failed: ${await res.text()}`);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (body.action === 'delete') {
      const { id } = body;
      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'id is required' }) };
      }

      const res = await fetch(`${SUPABASE_URL}/rest/v1/synopsis_examples?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'return=minimal'
        }
      });
      if (!res.ok) throw new Error(`Delete failed: ${await res.text()}`);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (body.action === 'list') {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/synopsis_examples?select=*&order=created_at.desc`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      if (!res.ok) throw new Error(`List failed: ${await res.text()}`);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, rows: await res.json() }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    console.error('manage-examples error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
