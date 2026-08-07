// netlify/functions/check-nws-alerts.js
// Background function — runs every 30 min
// Polls NWS active alerts API for NYC. On critical events:
//   1. Sets alert_flag on today's daily row
//   2. Stores alert in forecast_alerts for control room visibility
//   3. Generates copy + posts to IG immediately (doesn't wait for noon)
// Duplicate guard: optimistic alert_ig_posted lock (same as auto-post-alert)

const { drawAlertCard } = require('./trigger-alert');

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_KEY         = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY        = process.env.ANTHROPIC_KEY;
const META_IG_USER_ID      = process.env.META_IG_USER_ID;
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const ADMIN_PW             = process.env.ADMIN_PW;
const META_API             = 'https://graph.facebook.com/v21.0';

// NYC lat/lon for NWS point query
const NWS_POINT = '40.7128,-74.0060';

// Events that warrant an immediate IG post
const CRITICAL_EVENTS = new Set([
  'Tornado Warning',
  'Tornado Watch',
  'Severe Thunderstorm Warning',
  'Flash Flood Warning',
  'Flash Flood Watch',
  'Winter Storm Warning',
  'Winter Storm Watch',
  'Blizzard Warning',
  'Blizzard Watch',
  'Ice Storm Warning',
  'Heat Advisory',
  'Excessive Heat Warning',
  'Heat Watch',
  'High Wind Warning',
  'Extreme Cold Warning',
  'Extreme Wind Warning',
]);

// NWS severity for sorting — pick the highest-severity critical alert first
const SEVERITY_RANK = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };

function toNYCDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(date);
}

// Map NWS event name to existing alert card type (hot / cold / storm)
function mapNWSType(event) {
  if (/heat|hot/i.test(event)) return 'hot';
  if (/winter|blizzard|ice|freeze|cold|snow/i.test(event)) return 'cold';
  return 'storm';
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

async function fetchNWSAlerts() {
  const res = await fetch(
    `https://api.weather.gov/alerts/active?point=${NWS_POINT}`,
    {
      headers: {
        'User-Agent': 'classicnewweather/1.0 (classicnewweather@gmail.com)',
        'Accept': 'application/geo+json'
      }
    }
  );
  if (!res.ok) throw new Error(`NWS API responded ${res.status}`);
  const data = await res.json();
  return (data.features || []).map(f => ({
    event:    f.properties.event,
    headline: f.properties.headline,
    severity: f.properties.severity,
    urgency:  f.properties.urgency,
    expires:  f.properties.expires,
  }));
}

async function generateAlertCopy(context) {
  const advisoryPrompt = `You write weather advisory copy for Classic NewWeather (CNW) — an NYC weather lifestyle brand.
This copy appears large on a graphic card. Keep it SHORT and punchy.

Rules:
- Exactly 2 lines, separated by a newline
- 5-8 words per line max
- Lowercase-casual. ALL CAPS only when it really lands.
- NYC voice — direct, no corporate language, cultural slang welcome if natural
- Be specific about the actual threat
- No quotes, no labels, no hashtags

Alert: ${context}

Write the 2 lines. Nothing else.`;

  const captionPrompt = `You write Instagram captions for @classicnewweather — an NYC daily weather account with a specific voice.

Rules:
- 2-3 lines, casual and cool, lowercase mostly
- NYC energy — name the specific alert, tell people what to do right now
- Do NOT mention specific times, expiry windows, or durations — you don't have accurate data
- End with 4-5 hashtags on their own line — always include #NYC and #NewYork
- No corporate language. Direct and real.

Alert: ${context}

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

exports.handler = async (event) => {
  // Auth: Netlify cron sends next_run in body; manual trigger requires password
  try {
    const body = JSON.parse(event.body || '{}');
    if (!body.next_run && body.password !== ADMIN_PW) {
      if (event.body) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
  } catch {}

  const dateKey = toNYCDateKey(new Date());

  // No posts after 8PM NYC — alerts after this hour aren't actionable
  const nycHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date()));
  if (nycHour >= 20) {
    console.log(`check-nws-alerts: past 8PM NYC (${nycHour}:xx) — skipping post`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'past cutoff' }) };
  }

  try {
    // ── 1. Fetch NWS active alerts ──
    const allAlerts = await fetchNWSAlerts();
    console.log(`check-nws-alerts: ${allAlerts.length} active NWS alert(s):`, allAlerts.map(a => a.event).join(', ') || 'none');

    // ── 2. Store all active events in forecast_alerts for control room ──
    if (allAlerts.length > 0) {
      await supabaseFetch('/forecast_alerts', {
        method: 'POST',
        body: JSON.stringify({ alerts: allAlerts.map(a => ({ type: 'nws', ...a })) })
      });
    }

    // ── 3. Find critical NWS events, sorted by severity ──
    const critical = allAlerts
      .filter(a => CRITICAL_EVENTS.has(a.event))
      .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 4) - (SEVERITY_RANK[b.severity] ?? 4));

    const topNWS = critical[0] || null;

    // ── 4. Load today's daily row ──
    const rows = await supabaseFetch(`/daily?date_key=eq.${encodeURIComponent(dateKey)}&select=alert_flag,alert_ig_posted,high,feels_like`);
    const row = rows?.[0];

    if (!row) {
      console.log(`check-nws-alerts: no daily row for ${dateKey} yet — will retry next cycle`);
      return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'no daily row yet' }) };
    }

    // ── 5. Determine what to post: NWS takes priority over OWM ──
    // NWS: critical event detected
    // OWM: daily row has alert_flag set (from get-daily.js scoring)
    const hasNWS = !!topNWS;
    const hasOWM = !!row.alert_flag && !hasNWS;

    if (!hasNWS && !hasOWM) {
      console.log('check-nws-alerts: no critical NWS events, no OWM alert flag — skipping');
      return { statusCode: 200, body: JSON.stringify({ ok: true, nws: allAlerts.length, critical: 0 }) };
    }

    // ── 6. Skip IG post if already posted today ──
    if (row.alert_ig_posted) {
      console.log(`check-nws-alerts: alert already posted for ${dateKey} — skipping IG`);
      return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'already posted' }) };
    }

    // ── 7. Resolve alert type and copy context ──
    let alertType, copyContext, filename;
    if (hasNWS) {
      alertType   = mapNWSType(topNWS.event);
      copyContext  = `${topNWS.event.toUpperCase()} — NWS issued for NYC`;
      filename    = `alert-nws-${alertType}-${dateKey}.png`;
      console.log(`check-nws-alerts: posting NWS alert → "${topNWS.event}" (${topNWS.severity})`);
      // Set alert_flag if not already set
      if (!row.alert_flag) {
        await supabaseFetch(`/daily?date_key=eq.${encodeURIComponent(dateKey)}`, {
          method: 'PATCH',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify({ alert_flag: alertType })
        });
      }
    } else {
      alertType   = row.alert_flag;
      const temp  = Math.round(row.high);
      const feels = Math.round(row.feels_like);
      const OWM_CONTEXT = {
        hot:   `extreme heat — ${temp}°F, feels like ${feels}°F`,
        cold:  `extreme cold — ${temp}°F, feels like ${feels}°F`,
        storm: `major storm — heavy rain and dangerous wind`
      };
      copyContext  = OWM_CONTEXT[alertType] || alertType;
      filename    = `alert-owm-${alertType}-${dateKey}.png`;
      console.log(`check-nws-alerts: posting OWM alert → ${alertType} (${temp}°F / feels ${feels}°F)`);
    }

    // ── 8. Optimistic lock ──
    await supabaseFetch(`/daily?date_key=eq.${encodeURIComponent(dateKey)}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ alert_ig_posted: true })
    });

    // ── 9. Generate copy, render card, upload, post ──
    const { advisory, caption } = await generateAlertCopy(copyContext);
    console.log('check-nws-alerts: advisory =>', advisory);
    console.log('check-nws-alerts: caption  =>', caption);

    const temp     = Math.round(row.high || 75);
    const canvas   = await drawAlertCard(alertType, temp, advisory);
    const buffer   = await canvas.encode('png');
    const imageUrl = await uploadAlertImage(buffer, filename);
    const postId   = await postToIG(imageUrl, caption);
    console.log(`check-nws-alerts: posted → ${postId}`);

    // ── 10. Write final state ──
    await supabaseFetch(`/daily?date_key=eq.${encodeURIComponent(dateKey)}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ alert_ig_posted: true, alert_ig_post_id: postId, alert_ig_caption: caption })
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, postId, alertType, source: hasNWS ? 'nws' : 'owm', advisory, caption })
    };

  } catch (err) {
    console.error('check-nws-alerts error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
