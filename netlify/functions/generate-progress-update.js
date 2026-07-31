// netlify/functions/generate-progress-update.js
// Renders a Progress Update IG graphic and optionally posts to Instagram.
// Issue number auto-increments via the progress_updates Supabase table.

const { drawProgressUpdate } = require('./generate-ig-graphic');
const path = require('path');

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PW             = process.env.ADMIN_PW;
const META_PAGE_ID         = process.env.META_PAGE_ID;
const META_TOKEN           = process.env.META_PAGE_ACCESS_TOKEN;

async function supabaseFetch(p, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${p}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...options.headers
    }
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function getNextIssueNumber() {
  const rows = await supabaseFetch('/progress_updates?select=issue&order=issue.desc&limit=1');
  if (!rows || rows.length === 0) return 1;
  return (rows[0].issue || 0) + 1;
}

async function saveIssue(issue, data, feedImageUrl) {
  await supabaseFetch('/progress_updates', {
    method: 'POST',
    body: JSON.stringify({
      issue,
      date_key: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()),
      updates: data.updates,
      next_up: data.nextUp || [],
      feed_image_url: feedImageUrl,
      created_at: new Date().toISOString()
    })
  });
}

async function uploadImage(buffer, filename) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/story-images/${filename}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey': SUPABASE_SERVICE_KEY,
      'Content-Type': 'image/png',
      'x-upsert': 'true'
    },
    body: buffer
  });
  if (!res.ok) throw new Error(`Storage upload failed: ${await res.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/story-images/${filename}`;
}

async function postToInstagram(imageUrl, caption) {
  // Create container
  const createRes = await fetch(
    `https://graph.facebook.com/v19.0/${META_PAGE_ID}/media?image_url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(caption)}&access_token=${META_TOKEN}`,
    { method: 'POST' }
  );
  const created = await createRes.json();
  if (!created.id) throw new Error(`IG container error: ${JSON.stringify(created)}`);

  // Publish
  const pubRes = await fetch(
    `https://graph.facebook.com/v19.0/${META_PAGE_ID}/media_publish?creation_id=${created.id}&access_token=${META_TOKEN}`,
    { method: 'POST' }
  );
  const published = await pubRes.json();
  if (!published.id) throw new Error(`IG publish error: ${JSON.stringify(published)}`);
  return published.id;
}

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
    const issue   = await getNextIssueNumber();
    const dateStr = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric'
    }).format(new Date()).toUpperCase();

    const data = {
      issue,
      date:    dateStr,
      updates: body.updates || [],
      nextUp:  body.nextUp  || []
    };

    const canvas = await drawProgressUpdate(data);
    const buffer = await canvas.encode('png');

    const slug        = `progress-update-${String(issue).padStart(3, '0')}`;
    const feedImageUrl = await uploadImage(buffer, `${slug}.png`);

    await saveIssue(issue, data, feedImageUrl);

    // Optionally post to IG
    let igPostId = null;
    if (body.post === true) {
      const caption = body.caption ||
        `CNW PROGRESS UPDATES — ISSUE №${String(issue).padStart(2, '0')}\n\nHere's what we've been building. More to come.\n\n#classicnewweather #nycweather`;
      igPostId = await postToInstagram(feedImageUrl, caption);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, issue, feedImageUrl, igPostId })
    };
  } catch (err) {
    console.error('generate-progress-update error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
