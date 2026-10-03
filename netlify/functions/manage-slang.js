// netlify/functions/manage-slang.js
// Add/delete/list rows in slang_terms on behalf of editorial.html.
//
// Same arrangement as manage-examples.js: slang_terms has RLS enabled with no
// policies, so the public anon key can't touch it (it's visible to anyone who
// opens dev tools) and everything goes through this password-gated function
// using the service key.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PW = process.env.ADMIN_PW;

const STATUSES = new Set(['use', 'avoid']);

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

async function supabase(path, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, '');
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Bad request' }); }

  if (body.password !== ADMIN_PW) return respond(401, { error: 'Unauthorized' });

  try {
    if (body.action === 'list') {
      const res = await supabase('/slang_terms?select=*&order=region.asc,status.asc,term.asc');
      if (!res.ok) {
        const detail = await res.text();
        // Table not created yet — tell the UI so it can show setup steps
        // instead of a generic failure.
        if (/PGRST205|does not exist|schema cache/i.test(detail)) {
          return respond(200, { ok: true, rows: [], tableMissing: true });
        }
        throw new Error(`List failed: ${detail}`);
      }
      return respond(200, { ok: true, rows: await res.json() });
    }

    if (body.action === 'add') {
      const term = (body.term || '').trim();
      const meaning = (body.meaning || '').trim();
      const usage_note = (body.usage_note || '').trim() || null;
      const region = (body.region || 'nyc').trim().toLowerCase() || 'nyc';
      const status = (body.status || 'use').trim().toLowerCase();

      if (!term) return respond(400, { error: 'term is required' });
      if (!meaning) return respond(400, { error: 'meaning is required' });
      if (!STATUSES.has(status)) return respond(400, { error: "status must be 'use' or 'avoid'" });

      const res = await supabase('/slang_terms', {
        method: 'POST',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({ term, meaning, usage_note, region, status })
      });
      if (!res.ok) throw new Error(`Insert failed: ${await res.text()}`);
      return respond(200, { ok: true });
    }

    if (body.action === 'delete') {
      if (!body.id) return respond(400, { error: 'id is required' });
      const res = await supabase(`/slang_terms?id=eq.${encodeURIComponent(body.id)}`, {
        method: 'DELETE',
        headers: { 'Prefer': 'return=minimal' }
      });
      if (!res.ok) throw new Error(`Delete failed: ${await res.text()}`);
      return respond(200, { ok: true });
    }

    return respond(400, { error: 'Unknown action' });
  } catch (err) {
    console.error('manage-slang error:', err);
    return respond(500, { error: err.message });
  }
};
