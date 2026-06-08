// netlify/functions/upload-story.js
// Uploads story image to Supabase Storage server-side (bypasses RLS)
// Called from admin panel after drawing the story canvas

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PW = process.env.ADMIN_PW;

function toNYCDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(date);
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

  let password, imageData, type;
  try {
    const body = JSON.parse(event.body);
    password = body.password;
    imageData = body.imageData; // base64 PNG, no data URI prefix
    type = body.type || 'story'; // 'story' | 'feed'
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (password !== ADMIN_PW) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (!imageData) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No image data provided' }) };
  }

  try {
    const dateKey = toNYCDateKey(new Date());
    const filename = type === 'feed' ? `${dateKey}-feed.png` : `${dateKey}.png`;
    const dbColumn = type === 'feed' ? 'feed_image_url' : 'story_image_url';
    const imageBuffer = Buffer.from(imageData, 'base64');

    // Upload to Supabase Storage using service key — bypasses RLS
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/story-images/${filename}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY,
        'Content-Type': 'image/png',
        'x-upsert': 'true'
      },
      body: imageBuffer
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Storage upload failed: ${errText}`);
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/story-images/${filename}`;

    // Save URL to today's daily row
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/daily?date_key=eq.${encodeURIComponent(dateKey)}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ [dbColumn]: publicUrl })
    });

    if (!patchRes.ok) {
      const errText = await patchRes.text();
      throw new Error(`Failed to save image URL: ${errText}`);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, publicUrl })
    };

  } catch (err) {
    console.error('upload-story error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
