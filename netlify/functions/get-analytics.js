// netlify/functions/get-analytics.js
// Returns 7-day visit metrics from Supabase for the admin dashboard

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function toNYCDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(date);
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    // Build the last 30 date keys in NYC time
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(toNYCDateKey(d));
    }
    const todayKey = days[days.length - 1];
    const thirtyDaysAgo = days[0];

    // Fetch all rows in the 30-day window, including created_at for peak hour
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/page_views?date_key=gte.${thirtyDaysAgo}&select=date_key,visitor_id,session_id,referrer,created_at`,
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

    // Top referrers (30 days, excluding self)
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

    // Peak hours — aggregate by hour of day (NYC time) using created_at
    const hourCounts = new Array(24).fill(0);
    rows.forEach(row => {
      if (!row.created_at) return;
      const hour = parseInt(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York', hour: 'numeric', hour12: false
        }).format(new Date(row.created_at)),
        10
      );
      if (hour >= 0 && hour < 24) hourCounts[hour]++;
    });
    const peakHours = hourCounts.map((count, hour) => ({ hour, count }));

    // Direct vs referred traffic
    let directCount = 0, referredCount = 0;
    rows.forEach(row => {
      if (row.referrer) referredCount++;
      else directCount++;
    });

    // Returning vs new visitors (visitor seen on more than one date = returning)
    const visitorDates = {};
    rows.forEach(row => {
      if (!visitorDates[row.visitor_id]) visitorDates[row.visitor_id] = new Set();
      visitorDates[row.visitor_id].add(row.date_key);
    });
    let newVisitors = 0, returningVisitors = 0;
    Object.values(visitorDates).forEach(dates => {
      if (dates.size > 1) returningVisitors++;
      else newVisitors++;
    });

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
        topReferrers,
        peakHours,
        trafficSplit: { direct: directCount, referred: referredCount },
        visitorType: { new: newVisitors, returning: returningVisitors }
      })
    };
  } catch (err) {
    console.error('get-analytics error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
