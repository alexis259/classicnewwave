// netlify/functions/slang.js
// Shared slang-dictionary loader for the copy generators (generate-synopsis.js,
// ig-caption.js). One place builds the prompt text, so the synopsis and the
// caption can't drift into using different slang rules — the same duplication
// problem that bit the caption/alert generators before they were consolidated.
//
// Terms live in the slang_terms table, managed from editorial.html. The table
// has RLS enabled with no policies, so it's read with the service key only.
//
// Never throws: if the table is missing, empty, or Supabase is down, callers
// get empty strings and fall back to their built-in slang guidance.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Slang is regional. Everything is NYC today; this is the single place to
// change (or derive per request) once another city launches.
const DEFAULT_REGION = 'nyc';

async function getSlang(region = DEFAULT_REGION) {
  const empty = { block: '', rule: '' };
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/slang_terms?select=term,meaning,usage_note,status&region=eq.${encodeURIComponent(region)}&order=term.asc`,
      { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    if (!res.ok) return empty;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return empty;

    const use = rows.filter(r => r.status === 'use');
    const avoid = rows.filter(r => r.status === 'avoid');

    const lines = [`SLANG DICTIONARY (${region}) — the only slang you may use:`];
    if (use.length) {
      lines.push('USE — only where the meaning and usage actually fit:');
      for (const r of use) {
        lines.push(`- "${r.term}" — ${r.meaning}${r.usage_note ? ` How to use it: ${r.usage_note}` : ''}`);
      }
    }
    if (avoid.length) {
      lines.push('AVOID — never use these:');
      for (const r of avoid) {
        lines.push(`- "${r.term}" — ${r.meaning}${r.usage_note ? ` ${r.usage_note}` : ''}`);
      }
    }

    const rule = 'Slang comes ONLY from the SLANG DICTIONARY in the message below. Use a term only when its meaning and usage note genuinely fit today\'s weather, never use anything on the AVOID list, and do not invent or borrow slang that isn\'t listed. Slang is optional: at most one term, and none at all beats a forced one.';

    return { block: lines.join('\n'), rule };
  } catch (e) {
    console.error('getSlang failed (falling back to built-in slang guidance):', e.message);
    return empty;
  }
}

module.exports = { getSlang };
