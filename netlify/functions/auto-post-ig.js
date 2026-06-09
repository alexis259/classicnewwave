// netlify/functions/auto-post-ig.js
// Posts today's story graphic to Instagram (feed + story) via Meta Graph API
// Triggered by Netlify scheduled cron at 7:30 AM ET, or manually from admin panel

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const META_IG_USER_ID = process.env.META_IG_USER_ID;
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const ADMIN_PW = process.env.ADMIN_PW;

const META_API = 'https://graph.facebook.com/v21.0';

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

function toNYCDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(date);
}

async function generateCaption(row) {
  const prompt = `You write short Instagram captions for @classicnewweather — an NYC daily weather account with a specific voice.

VOICE:
- 2-3 lines max, casual and cool
- lowercase mostly, NYC energy
- give the score, tease the vibe, tell people to check the link in bio
- end with 4-5 hashtags on their own line — always include #NYC and #NewYork

TODAY:
- Temp: ${Math.round(row.temp)}°F, high of ${Math.round(row.high)}°F, feels like ${Math.round(row.feels_like)}°F
- Condition: ${row.condition}
- Rain: ${row.precip_chance}%
- Score: ${row.score}/10
- Today's vibe: ${row.synopsis_approved || ''}

Write just the caption text.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 250,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  const text = data.content?.[0]?.text?.trim();
  if (!text) throw new Error('No caption from Claude');
  return text;
}

async function createIGContainer(imageUrl, caption, isStory) {
  const params = new URLSearchParams({ access_token: META_PAGE_ACCESS_TOKEN });
  params.set('image_url', imageUrl);
  if (isStory) {
    params.set('media_type', 'STORIES');
  } else {
    params.set('caption', caption);
  }
  const res = await fetch(`${META_API}/${META_IG_USER_ID}/media`, {
    method: 'POST',
    body: params
  });
  const data = await res.json();
  if (data.error) throw new Error(`Meta container error: ${data.error.message}`);
  return data.id;
}

async function publishIGContainer(containerId) {
  const params = new URLSearchParams({
    creation_id: containerId,
    access_token: META_PAGE_ACCESS_TOKEN
  });
  const res = await fetch(`${META_API}/${META_IG_USER_ID}/media_publish`, {
    method: 'POST',
    body: params
  });
  const data = await res.json();
  if (data.error) throw new Error(`Meta publish error: ${data.error.message}`);
  return data.id;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Manual POST from admin — verify password
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      if (body.password !== ADMIN_PW) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
    } catch {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bad request' }) };
    }
  }

  // Guard: skip without Meta credentials — safe to deploy before creds are ready
  if (!META_IG_USER_ID || !META_PAGE_ACCESS_TOKEN) {
    console.log('auto-post-ig: Meta credentials not configured — skipping');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ skipped: true, reason: 'Meta credentials not configured' })
    };
  }

  try {
    const dateKey = toNYCDateKey(new Date());

    const rows = await supabaseFetch(`/daily?date_key=eq.${encodeURIComponent(dateKey)}&select=*`);
    if (!rows || rows.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'No weather data for today' }) };
    }
    const row = rows[0];

    if (!row.story_image_url) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'No story image queued — upload from admin panel first' })
      };
    }

    // Use dedicated 4:5 feed image if available, fall back to story image
    const feedImageUrl = row.feed_image_url || row.story_image_url;

    if (!row.synopsis_approved) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Synopsis not approved yet' }) };
    }

    // NOTE: duplicate-post guard disabled for testing — re-enable before production
    // if (row.ig_posted) {
    //   return {
    //     statusCode: 200,
    //     headers,
    //     body: JSON.stringify({ skipped: true, reason: 'Already posted today' })
    //   };
    // }

    const caption = await generateCaption(row);

    // Create feed + story containers in parallel
    const [feedContainerId, storyContainerId] = await Promise.all([
      createIGContainer(feedImageUrl, caption, false),
      createIGContainer(row.story_image_url, null, true)
    ]);

    // Publish both in parallel
    const [feedPostId, storyPostId] = await Promise.all([
      publishIGContainer(feedContainerId),
      publishIGContainer(storyContainerId)
    ]);

    // Record in Supabase
    await supabaseFetch(`/daily?date_key=eq.${encodeURIComponent(dateKey)}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        ig_posted: true,
        ig_post_id: feedPostId,
        ig_caption: caption,
        ig_posted_at: new Date().toISOString()
      })
    });

    console.log(`auto-post-ig: posted feed=${feedPostId} story=${storyPostId}`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, feedPostId, storyPostId, caption })
    };

  } catch (err) {
    console.error('auto-post-ig error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
