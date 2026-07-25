// netlify/functions/get-archive.js
// Returns past daily rows for the broadcast archive page

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const params = event.queryStringParameters || {};
    const limit = Math.min(parseInt(params.limit || '90'), 365);
    const date = params.date;

    const fields = [
      'date_key', 'score', 'penalties',
      'high', 'low', 'temp', 'feels_like',
      'humidity', 'precip_chance', 'wind_speed', 'condition',
      'synopsis_approved',
      'feed_image_url', 'story_image_url',
      'ig_posted', 'ig_post_id', 'ig_posted_at', 'ig_caption',
      'alert_flag', 'alert_ig_posted', 'alert_ig_post_id', 'alert_ig_caption'
    ].join(',');

    let url;
    if (date) {
      url = `${SUPABASE_URL}/rest/v1/daily?date_key=eq.${encodeURIComponent(date)}&select=${fields}`;
    } else {
      url = `${SUPABASE_URL}/rest/v1/daily?select=${fields}&order=date_key.desc&limit=${limit}`;
    }

    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });

    const rows = await res.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ rows: Array.isArray(rows) ? rows : [] })
    };
  } catch (err) {
    console.error('get-archive error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
