// netlify/functions/schedule-gate.js
// Daylight-saving-proof scheduling.
//
// Netlify cron runs in UTC, so a job pinned to "12:00 UTC" is 8:00am in New York
// only in summer: on Nov 1, 2026 the clocks changed, the 8am post started firing
// at 7am, before the synopsis step opens (it generates at 8am NYC), and the post
// went out with no synopsis. The old fix was editing netlify.toml twice a year.
//
// Instead each job is scheduled at BOTH possible UTC hours (e.g. "0 12,13 * * *"
// for 8am NYC) and calls shouldSkipCron(), which lets only the run that lands on
// the right New York hour through. Manual runs (admin button, HTTP) are never
// skipped; only Netlify's own cron events are.

function nycHour(now = new Date()) {
  const h = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(now), 10);
  return h % 24; // some ICU versions print midnight as "24"
}

// Netlify scheduled invocations carry { next_run } in the body.
function isCronEvent(event) {
  try {
    return !!JSON.parse((event && event.body) || '{}').next_run;
  } catch {
    return false;
  }
}

// True when this is a cron run that landed on the wrong New York hour.
function shouldSkipCron(event, targetHour, label = 'job', now = new Date()) {
  if (!isCronEvent(event)) return false;
  const h = nycHour(now);
  if (h === targetHour) return false;
  console.log(`${label}: cron fired at ${h}:00 New York time, wants ${targetHour}:00 (daylight-saving twin run) — skipping`);
  return true;
}

module.exports = { nycHour, isCronEvent, shouldSkipCron };
