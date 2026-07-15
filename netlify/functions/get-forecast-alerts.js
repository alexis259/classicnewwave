// netlify/functions/get-forecast-alerts.js
// Returns the most recent forecast_alerts row for the admin panel

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

exports.handler = async () => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/forecast_alerts?select=alerts,run_at&order=run_at.desc&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ alerts: [], run_at: null }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify(rows[0]) };
  } catch (err) {
    console.error('get-forecast-alerts error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
