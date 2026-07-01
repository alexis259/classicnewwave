// netlify/functions/auto-post-ig.js
// Posts today's story graphic to Instagram (feed + story) via Meta Graph API
// Triggered by Netlify scheduled cron at 7:30 AM ET, or manually from admin panel

const { generateAndUpload } = require('./generate-ig-graphic');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
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
  if (!text) {
    console.warn('auto-post-ig: caption generation failed — using fallback');
    return `${Math.round(row.high)}° in NYC today. score: ${row.score}/10. check the link in bio.\n\n#NYC #NewYork #NewYorkCity #NYCWeather #classicnewweather`;
  }
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

async function createCarouselItem(imageUrl) {
  const params = new URLSearchParams({
    access_token: META_PAGE_ACCESS_TOKEN,
    image_url: imageUrl,
    is_carousel_item: 'true'
  });
  const res = await fetch(`${META_API}/${META_IG_USER_ID}/media`, {
    method: 'POST',
    body: params
  });
  const data = await res.json();
  if (data.error) throw new Error(`Meta carousel item error: ${data.error.message}`);
  return data.id;
}

async function createCarouselContainer(childIds, caption) {
  const params = new URLSearchParams({
    access_token: META_PAGE_ACCESS_TOKEN,
    media_type: 'CAROUSEL',
    caption,
    children: childIds.join(',')
  });
  const res = await fetch(`${META_API}/${META_IG_USER_ID}/media`, {
    method: 'POST',
    body: params
  });
  const data = await res.json();
  if (data.error) throw new Error(`Meta carousel container error: ${data.error.message}`);
  return data.id;
}

async function waitForContainer(containerId, maxWaitMs = 90000) {
  const interval = 3000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(
      `${META_API}/${containerId}?fields=status_code&access_token=${META_PAGE_ACCESS_TOKEN}`
    );
    const data = await res.json();
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') throw new Error(`Meta container processing failed: ${containerId}`);
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`Meta container timed out after ${maxWaitMs}ms: ${containerId}`);
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

    let rows = await supabaseFetch(`/daily?date_key=eq.${encodeURIComponent(dateKey)}&select=*`);

    // No row yet — nobody has hit the site today. Trigger get-daily to create it.
    if (!rows || rows.length === 0) {
      const siteUrl = process.env.URL || process.env.DEPLOY_URL;
      console.log(`auto-post-ig: no row for ${dateKey} — triggering get-daily (siteUrl=${siteUrl})`);
      if (siteUrl) {
        const gdRes = await fetch(`${siteUrl}/.netlify/functions/get-daily`);
        console.log(`auto-post-ig: get-daily responded ${gdRes.status}`);
        rows = await supabaseFetch(`/daily?date_key=eq.${encodeURIComponent(dateKey)}&select=*`);
        console.log(`auto-post-ig: re-fetch found ${rows?.length ?? 0} row(s)`);
      } else {
        console.error('auto-post-ig: URL env var not set — cannot trigger get-daily');
      }
    } else {
      console.log(`auto-post-ig: found row for ${dateKey}`);
    }

    if (!rows || rows.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'No weather data for today' }) };
    }
    const row = rows[0];

    // Determine template type: weekly on Mondays, daily otherwise
    const nycDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' }).format(new Date());
    const templateType = nycDay === 'Monday' ? 'weekly' : 'daily';

    if (row.ig_posted) {
      console.log('auto-post-ig: already posted today — skipping');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ skipped: true, reason: 'Already posted today' })
      };
    }

    // Generate images if not yet created, or if they predate the carousel format
    const hasCarouselImages = row.feed_image_url?.includes('-daily-slide1');
    if (!row.story_image_url || (templateType === 'daily' && !hasCarouselImages)) {
      console.log(`auto-post-ig: generating graphics (${templateType})`);
      const urls = await generateAndUpload(row, dateKey, templateType);
      row.feed_image_url = urls.feedImageUrl;
      row.story_image_url = urls.storyImageUrl;
      row.slide2_url = urls.slide2Url;
    } else if (templateType === 'daily') {
      // Carousel images already generated — derive slide2 URL from naming convention
      row.slide2_url = `${SUPABASE_URL}/storage/v1/object/public/story-images/${dateKey}-daily-slide2.png`;
      console.log('auto-post-ig: using existing carousel images');
    }

    const feedImageUrl = row.feed_image_url || row.story_image_url;
    const caption = await generateCaption(row);

    let feedPostId;

    if (templateType === 'daily' && row.slide2_url) {
      // 2-slide carousel: slide 1 = rating + mood, slide 2 = fit + hair
      console.log('auto-post-ig: posting daily as 2-slide carousel');
      const [item1Id, item2Id] = await Promise.all([
        createCarouselItem(feedImageUrl),
        createCarouselItem(row.slide2_url)
      ]);
      await Promise.all([waitForContainer(item1Id), waitForContainer(item2Id)]);
      const carouselId = await createCarouselContainer([item1Id, item2Id], caption);
      await waitForContainer(carouselId);
      feedPostId = await publishIGContainer(carouselId);
    } else {
      // Single image post (weekly and other templates)
      const feedContainerId = await createIGContainer(feedImageUrl, caption, false);
      await waitForContainer(feedContainerId);
      feedPostId = await publishIGContainer(feedContainerId);
    }

    // Story post (always single image)
    const storyContainerId = await createIGContainer(row.story_image_url, null, true);
    await waitForContainer(storyContainerId);
    const storyPostId = await publishIGContainer(storyContainerId);

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
