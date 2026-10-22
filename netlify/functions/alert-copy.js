// netlify/functions/alert-copy.js
// Shared weather-alert copy generator — used by both the scheduled
// OWM-threshold alert poster (auto-post-alert.js) and the live NWS alert
// poller (check-nws-alerts.js), so the two can't drift into different tones
// or rules. They used to each carry their own near-identical copy of this.

const { checkAlert, generateChecked, stripDashes } = require('./copy-guard');

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

  const callModelFor = (prompt, maxTokens) => async (extraInstruction) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt + extraInstruction }] })
    });
    const data = await res.json();
    const out = data.content?.[0]?.text?.trim();
    return out ? stripDashes(out) : null;
  };

  // These rules were already in the prompts (no temperatures, no times or
  // durations, no fear-mongering, exactly 2 lines on the card), but a prompt
  // only asks. The output is now checked and regenerated if it breaks one
  // (see copy-guard.js). If every attempt breaks a rule, a plain, neutral
  // fallback is used — it's built from the alert's name only, so it can't
  // overstate, invent a time, or include a temperature.
  // OWM-threshold alerts pass just "HOT" / "COLD" / "STORM"; NWS ones pass the
  // real alert name ("FLOOD WATCH").
  const rawName = String(context).split(' — ')[0].trim().toLowerCase();
  const alertName = { hot: 'extreme heat alert', cold: 'extreme cold alert', storm: 'storm alert' }[rawName] || rawName || 'weather alert';
  const advisoryFallback = 'weather alert for the city\ncheck local updates, stay safe';
  const captionFallback = `${alertName} for nyc. check local updates and stay safe out there.\n\n#NYC #NewYork #WeatherAlert #classicnewweather`;

  // The two pieces are independent, so they run in parallel.
  const [advisory, caption] = await Promise.all([
    generateChecked({
      callModel: callModelFor(advisoryPrompt, 80),
      check: (t) => checkAlert(t, { kind: 'advisory' }),
      fallback: advisoryFallback,
      label: 'alert-advisory'
    }),
    generateChecked({
      callModel: callModelFor(captionPrompt, 200),
      check: (t) => checkAlert(t, { kind: 'caption' }),
      fallback: captionFallback,
      label: 'alert-caption'
    })
  ]);

  return { advisory: advisory.text, caption: caption.text };
}

module.exports = { generateAlertCopy };
