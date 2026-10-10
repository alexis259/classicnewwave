// netlify/functions/check-meta.js
// Read-only health check for the Meta/Instagram connection, run from inside
// the deployed site so it uses the token Netlify actually holds. Nothing is
// created or posted. Password-gated like the other admin functions.
//
// It reports metadata only — the token itself is never returned or logged.

const META_API = 'https://graph.facebook.com/v21.0';
const META_IG_USER_ID = process.env.META_IG_USER_ID;
const TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const ADMIN_PW = process.env.ADMIN_PW;

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

// Meta error payloads describe the problem; they don't echo the token.
function metaError(data) {
  const e = data && data.error;
  if (!e) return null;
  return { message: e.message, type: e.type, code: e.code, subcode: e.error_subcode };
}

function iso(unixSeconds) {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, '');
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Bad request' }); }
  if (body.password !== ADMIN_PW) return respond(401, { error: 'Unauthorized' });

  const result = {
    envPresent: { META_PAGE_ACCESS_TOKEN: !!TOKEN, META_IG_USER_ID: !!META_IG_USER_ID },
    tokenInfo: null,
    instagramAccount: null
  };

  if (!TOKEN || !META_IG_USER_ID) {
    return respond(200, { ok: false, reason: 'A required environment variable is missing', ...result });
  }

  try {
    // 1. What kind of token is this, and when does it expire?
    const dbgRes = await fetch(
      `${META_API}/debug_token?input_token=${encodeURIComponent(TOKEN)}&access_token=${encodeURIComponent(TOKEN)}`
    );
    const dbg = await dbgRes.json();
    if (dbg.data) {
      result.tokenInfo = {
        type: dbg.data.type,
        isValid: dbg.data.is_valid,
        // 0 means the token itself never expires
        expiresAt: dbg.data.expires_at === 0 ? 'never' : iso(dbg.data.expires_at),
        dataAccessExpiresAt: iso(dbg.data.data_access_expires_at),
        scopes: dbg.data.scopes,
        pageId: dbg.data.profile_id || null
      };
    } else {
      result.tokenInfo = { error: metaError(dbg) || 'debug_token returned nothing' };
    }

    // 2. Can this token actually see the Instagram account the posts go to?
    //    This is the same account the posting code publishes to.
    const igRes = await fetch(
      `${META_API}/${META_IG_USER_ID}?fields=id,username,media_count&access_token=${encodeURIComponent(TOKEN)}`
    );
    const ig = await igRes.json();
    result.instagramAccount = ig.error
      ? { error: metaError(ig) }
      : { id: ig.id, username: ig.username, mediaCount: ig.media_count };

    const tokenOk = result.tokenInfo && result.tokenInfo.isValid === true;
    const igOk = result.instagramAccount && !result.instagramAccount.error;
    return respond(200, { ok: !!(tokenOk && igOk), ...result });
  } catch (err) {
    console.error('check-meta error:', err.message);
    return respond(500, { ok: false, error: err.message, ...result });
  }
};
