// netlify/functions/get-analytics.js
// Returns 7-day visit metrics from Supabase for the admin dashboard

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

function toNYCDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(date);
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    // Build the last 7 date keys in NYC time
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(toNYCDateKey(d));
    }
    const todayKey = days[days.length - 1];
    const sevenDaysAgo = days[0];

    // Fetch all rows in the window
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/page_views?date_key=gte.${sevenDaysAgo}&select=date_key,visitor_id,session_id,referrer`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );
    const rows = await res.json();

    // Aggregate by day
    const byDay = {};
    days.forEach(d => { byDay[d] = { views: 0, visitors: new Set(), sessions: new Set() }; });

    rows.forEach(row => {
      if (!byDay[row.date_key]) return;
      byDay[row.date_key].views++;
      byDay[row.date_key].visitors.add(row.visitor_id);
      byDay[row.date_key].sessions.add(row.session_id);
    });

    // Top referrers (last 7 days, excluding self)
    const refCounts = {};
    rows.forEach(row => {
      if (!row.referrer) return;
      try {
        const hostname = new URL(row.referrer).hostname.replace(/^www\./, '');
        if (hostname.includes('classicnewweather') || hostname.includes('classicnewwave')) return;
        refCounts[hostname] = (refCounts[hostname] || 0) + 1;
      } catch (e) {}
    });
    const topReferrers = Object.entries(refCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([source, count]) => ({ source, count }));

    const daily = days.map(d => ({
      date: d,
      views: byDay[d].views,
      visitors: byDay[d].visitors.size,
      sessions: byDay[d].sessions.size
    }));

    const today = byDay[todayKey];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        today: {
          views: today.views,
          visitors: today.visitors.size,
          sessions: today.sessions.size
        },
        daily,
        topReferrers
      })
    };
  } catch (err) {
    console.error('get-analytics error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
