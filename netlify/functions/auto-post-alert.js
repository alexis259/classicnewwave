// netlify/functions/auto-post-alert.js
// Scheduled noon NYC — posts a weather alert to IG if today's conditions
// cross alert thresholds. Generates advisory copy + caption via Claude Haiku,
// renders the alert card, and publishes to Instagram.
//
// Programming slot: NOON (12:00 PM NYC)
// Trigger: today's daily row has alert_flag set ('hot' | 'cold' | 'storm')
// Duplicate guard: optimistic alert_ig_posted lock (same pattern as daily post)

const { drawAlertCard } = require('./trigger-alert');

const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY   = process.env.ANTHROPIC_KEY;
const META_IG_USER_ID = process.env.META_IG_USER_ID;
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const ADMIN_PW        = process.env.ADMIN_PW;
const META_API        = 'https://graph.facebook.com/v21.0';

function toNYCDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(date);
}

async function supabaseFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...options.headers
    }
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── COPY GENERATION ──

const ALERT_CONTEXT = {
  hot:   (temp, feelsLike) => `extreme heat — ${temp}°F, feels like ${feelsLike}°F`,
  cold:  (temp, feelsLike) => `extreme cold — ${temp}°F, feels like ${feelsLike}°F`,
  storm: (temp)            => `major storm — heavy rain and dangerous wind`
};

async function generateAlertCopy(type, temp, feelsLike) {
  const context = (ALERT_CONTEXT[type] || (() => type))(temp, feelsLike);

  const advisoryPrompt = `You write weather advisory copy for Classic NewWeather (CNW) — an NYC weather lifestyle brand.
This copy appears large on a graphic card. Keep it SHORT and punchy.

Rules:
- Exactly 2 lines, separated by a newline
- 5-8 words per line max
- Lowercase-casual by default. ALL CAPS only when it really lands.
- NYC voice — direct, no corporate language, cultural slang welcome if natural
- Be specific about the actual threat
- Do NOT mention specific times, expiry windows, or durations — this is a forecast-based prediction, not a confirmed timed event, and you don't have accurate timing data
- No quotes, no labels, no hashtags

Alert: ${type.toUpperCase()} — ${context}

Write the 2 lines. Nothing else.`;

  const captionPrompt = `You write Instagram captions for @classicnewweather — an NYC daily weather account with a specific voice.

Rules:
- 2-3 lines, casual and cool, lowercase mostly
- NYC energy — name the specific alert, give the temp, tell people what to do right now
- Do NOT mention specific times, expiry windows, or durations — this is a forecast-based prediction, not a confirmed timed event, and you don't have accurate timing data
- End with 4-5 hashtags on their own line — always include #NYC and #NewYork
- No corporate language. Direct and real.

Alert: ${type.toUpperCase()} — ${context}

Write just the caption text.`;

  const [advisoryRes, captionRes] = await Promise.all([
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 80, messages: [{ role: 'user', content: advisoryPrompt }] })
    }),
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: captionPrompt }] })
    })
  ]);

  const [advisoryData, captionData] = await Promise.all([advisoryRes.json(), captionRes.json()]);
  return {
    advisory: advisoryData.content?.[0]?.text?.trim() || null,
    caption:  captionData.content?.[0]?.text?.trim()  || null
  };
}

// ── IMAGE + META ──

async function uploadAlertImage(buffer, filename) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/story-images/${filename}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey': SUPABASE_KEY,
      'Content-Type': 'image/png',
      'x-upsert': 'true'
    },
    body: buffer
  });
  if (!res.ok) throw new Error(`Storage upload failed: ${await res.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/story-images/${filename}`;
}

async function postToIG(imageUrl, caption) {
  const params = new URLSearchParams({ access_token: META_PAGE_ACCESS_TOKEN, image_url: imageUrl, caption: caption || '' });
  const createRes = await fetch(`${META_API}/${META_IG_USER_ID}/media`, { method: 'POST', body: params });
  const createData = await createRes.json();
  if (createData.error) throw new Error(`Meta container error: ${createData.error.message}`);

  const containerId = createData.id;
  const start = Date.now();
  while (Date.now() - start < 90000) {
    const statusRes = await fetch(`${META_API}/${containerId}?fields=status_code&access_token=${META_PAGE_ACCESS_TOKEN}`);
    const statusData = await statusRes.json();
    if (statusData.status_code === 'FINISHED') break;
    if (statusData.status_code === 'ERROR') throw new Error(`Meta container failed: ${containerId}`);
    await new Promise(r => setTimeout(r, 3000));
  }

  const pubParams = new URLSearchParams({ creation_id: containerId, access_token: META_PAGE_ACCESS_TOKEN });
  const pubRes = await fetch(`${META_API}/${META_IG_USER_ID}/media_publish`, { method: 'POST', body: pubParams });
  const pubData = await pubRes.json();
  if (pubData.error) throw new Error(`Meta publish error: ${pubData.error.message}`);
  return pubData.id;
}

// ── HANDLER ──

exports.handler = async (event) => {
  const dateKey = toNYCDateKey(new Date());

  // Auth: Netlify cron sends { next_run } in body — skip password check
  // Manual trigger from admin requires password
  let isManual = false;
  try {
    const body = JSON.parse(event.body || '{}');
    if (body.next_run) {
      // cron — proceed
    } else if (body.password === ADMIN_PW) {
      isManual = true;
    } else if (event.body) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
  } catch {}

  try {
    // Fetch today's daily row
    const rows = await supabaseFetch(`/daily?date_key=eq.${encodeURIComponent(dateKey)}&select=*`);
    const row = rows?.[0];

    if (!row?.alert_flag) {
      console.log(`auto-post-alert: no alert flag for ${dateKey}, skipping`);
      return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'no alert' }) };
    }

    if (row.alert_ig_posted && !isManual) {
      console.log(`auto-post-alert: already posted for ${dateKey}, skipping`);
      return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'already posted' }) };
    }

    const alertType = row.alert_flag;
    const temp      = Math.round(row.high);
    const feelsLike = Math.round(row.feels_like);

    // Optimistic lock — set posted before generating to block duplicate cron runs
    if (!isManual) {
      await supabaseFetch(`/daily?date_key=eq.${encodeURIComponent(dateKey)}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({ alert_ig_posted: true })
      });
    }

    console.log(`auto-post-alert: generating ${alertType} copy — ${temp}°F / feels ${feelsLike}°F`);
    const { advisory, caption } = await generateAlertCopy(alertType, temp, feelsLike);
    console.log('auto-post-alert: advisory =>', advisory);
    console.log('auto-post-alert: caption  =>', caption);

    // Render card
    const canvas   = await drawAlertCard(alertType, temp, advisory);
    const buffer   = await canvas.encode('png');
    const filename = `alert-auto-${alertType}-${dateKey}.png`;
    const imageUrl = await uploadAlertImage(buffer, filename);

    // Post to IG
    const postId = await postToIG(imageUrl, caption);
    console.log(`auto-post-alert: posted → ${postId}`);

    // Write final state back to row
    await supabaseFetch(`/daily?date_key=eq.${encodeURIComponent(dateKey)}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ alert_ig_posted: true, alert_ig_post_id: postId, alert_ig_caption: caption })
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, postId, alertType, temp, advisory, caption }) };

  } catch (err) {
    console.error('auto-post-alert error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
