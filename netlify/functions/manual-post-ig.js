// netlify/functions/manual-post-ig.js
// Manual trigger for posting today's graphic to Instagram from the control room.
// Background function (15-min timeout) but NO schedule — unscheduled background
// functions accept HTTP POST, unlike scheduled ones which Netlify locks to cron-only.

const { generateAndUpload } = require('./generate-ig-graphic');
const { generateCaption } = require('./ig-caption');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
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

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Password auth — always required, no cron bypass
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bad request' }) };
  }

  if (body.password !== ADMIN_PW) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (!META_IG_USER_ID || !META_PAGE_ACCESS_TOKEN) {
    return { statusCode: 200, headers, body: JSON.stringify({ skipped: true, reason: 'Meta credentials not configured' }) };
  }

  try {
    const dateKey = toNYCDateKey(new Date());

    // Force-refresh weather score so the graphic uses the latest OWM forecast
    const siteUrl = process.env.URL || process.env.DEPLOY_URL;
    let rainTiming = null;
    if (siteUrl) {
      console.log(`manual-post-ig: force-refreshing score siteUrl=${siteUrl}`);
      const gdRes = await fetch(`${siteUrl}/.netlify/functions/get-daily?force=true`);
      console.log(`manual-post-ig: get-daily?force=true responded ${gdRes.status}`);
      try {
        const gdBody = await gdRes.json();
        rainTiming = gdBody.rain_timing ?? null;
      } catch (e) { /* non-fatal — caption just won't have timing context */ }
    }

    const rows = await supabaseFetch(`/daily?date_key=eq.${encodeURIComponent(dateKey)}&select=*`);
    if (!rows || rows.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'No weather data for today' }) };
    }
    const row = rows[0];

    // Always regenerate graphics — score may have changed from the force-refresh
    row.story_image_url = null;
    row.feed_image_url = null;

    const nycDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' }).format(new Date());
    const templateType = nycDay === 'Monday' ? 'weekly' : 'daily';

    console.log(`manual-post-ig: generating graphics (${templateType})`);
    const urls = await generateAndUpload(row, dateKey, templateType);
    row.feed_image_url = urls.feedImageUrl;
    row.story_image_url = urls.storyImageUrl;
    row.slide2_url = urls.slide2Url;

    const feedImageUrl = row.feed_image_url || row.story_image_url;
    const caption = await generateCaption(row, rainTiming);

    let feedPostId;

    if (templateType === 'daily' && row.slide2_url) {
      console.log('manual-post-ig: posting daily as 2-slide carousel');
      const [item1Id, item2Id] = await Promise.all([
        createCarouselItem(feedImageUrl),
        createCarouselItem(row.slide2_url)
      ]);
      await Promise.all([waitForContainer(item1Id), waitForContainer(item2Id)]);
      const carouselId = await createCarouselContainer([item1Id, item2Id], caption);
      await waitForContainer(carouselId);
      feedPostId = await publishIGContainer(carouselId);
    } else {
      const feedContainerId = await createIGContainer(feedImageUrl, caption, false);
      await waitForContainer(feedContainerId);
      feedPostId = await publishIGContainer(feedContainerId);
    }

    const storyContainerId = await createIGContainer(row.story_image_url, null, true);
    await waitForContainer(storyContainerId);
    const storyPostId = await publishIGContainer(storyContainerId);

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

    console.log(`manual-post-ig: posted feed=${feedPostId} story=${storyPostId}`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, feedPostId, storyPostId, caption })
    };

  } catch (err) {
    console.error('manual-post-ig error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
