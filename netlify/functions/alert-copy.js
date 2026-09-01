// netlify/functions/alert-copy.js
// Shared weather-alert copy generator — used by both the scheduled
// OWM-threshold alert poster (auto-post-alert.js) and the live NWS alert
// poller (check-nws-alerts.js), so the two can't drift into different tones
// or rules. They used to each carry their own near-identical copy of this.

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

async function generateAlertCopy(context) {
  const advisoryPrompt = `You write weather advisory copy for classicnewweather (CNW) — an NYC weather lifestyle brand.
This copy appears large on a graphic card. Keep it SHORT and punchy.

Rules:
- Exactly 2 lines, separated by a newline
- 5-8 words per line max
- Lowercase-casual by default. ALL CAPS only when it really lands.
- NYC voice — direct, no corporate language, cultural slang welcome if natural
- Be specific about the actual threat
- Do NOT mention specific times, expiry windows, or durations — this is a forecast-based prediction, not a confirmed timed event, and you don't have accurate timing data
- Do NOT include a specific temperature number
- Stay calm and direct, not alarmist. This is a heads-up, not a doomsday warning — skip words like "devastating," "catastrophic," "deadly," "brutal," or anything that oversells the danger. Straight information reads as more trustworthy than drama.
- No quotes, no labels, no hashtags

Alert: ${context}

Write the 2 lines. Nothing else.`;

  const captionPrompt = `You write Instagram captions for @classicnewweather — an NYC daily weather account with a specific voice.

Rules:
- 2-3 lines, casual and cool, lowercase mostly
- NYC energy — name the specific alert, tell people what to do right now
- Do NOT mention specific times, expiry windows, or durations — this is a forecast-based prediction, not a confirmed timed event, and you don't have accurate timing data
- Do NOT include a specific temperature number
- Stay calm and direct, not alarmist. This is a heads-up, not a doomsday warning — skip words like "devastating," "catastrophic," "deadly," "brutal," or anything that oversells the danger. Give people real, practical guidance instead of scaring them.
- End with 4-5 hashtags on their own line — always include #NYC and #NewYork
- No corporate language. Direct and real.

Alert: ${context}

Write just the caption text.`;

  const [advisoryRes, captionRes] = await Promise.all([
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 80, messages: [{ role: 'user', content: advisoryPrompt }] })
    }),
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: captionPrompt }] })
    })
  ]);

  const [advisoryData, captionData] = await Promise.all([advisoryRes.json(), captionRes.json()]);
  return {
    advisory: advisoryData.content?.[0]?.text?.trim() || null,
    caption:  captionData.content?.[0]?.text?.trim()  || null
  };
}

module.exports = { generateAlertCopy };
