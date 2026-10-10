// netlify/functions/ig-caption.js
// Shared Instagram caption generator — used by both the scheduled auto-post
// (auto-post-ig.js) and the manual repost trigger (manual-post-ig.js) so the
// two can't drift into different voices or rules. They used to each carry
// their own near-identical copy of this function.

const { getSlang } = require('./slang');
const { checkCaption, generateChecked } = require('./copy-guard');

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

async function generateCaption(row, rainTiming = null) {
  // Same slang dictionary the synopsis writer reads (managed in editorial.html).
  // Empty strings if the table is missing/empty.
  const { block: slangBlock, rule: slangRule, avoid: avoidTerms } = await getSlang();

  const prompt = `You write short Instagram captions for @classicnewweather — an NYC daily weather account with a specific voice.

VOICE:
- 2-3 lines max, casual and cool
- lowercase mostly, NYC energy
- give the score, tease the vibe, tell people to check the link in bio
- never name a day of the week, in the text or in a hashtag (no "monday," "tuesday," #MondayVibes, etc.). You are not told what day it is, so any day you name is a guess and has been wrong before. Say "today" instead.
- end with 4-5 hashtags on their own line — always include #NYC and #NewYork${slangRule ? `\n- ${slangRule}` : ''}

${slangBlock}

RAIN LANGUAGE — calibrate intensity to the actual percentage, never oversell it:
- Only use strong/heavy language ("pouring," "hammering," "heavy rain," "downpour") when Rain is above 70%.
- 45-70%: moderate language ("rain's likely," "good chance of rain," "grab an umbrella just in case").
- 20-45%: soft, hedged language ("might rain," "slight chance," "keep an eye on the sky").
- Under 20%: don't lead with rain at all unless it's genuinely the most notable thing about the day.
- Rain % is a whole-day worst case, not necessarily happening right now — if a rain timing window is given below, say so plainly ("clear now, rain moves in tonight") instead of writing as if it's raining currently.
- Overselling intensity that doesn't pan out costs credibility with the audience — when in doubt, undersell rather than oversell.

TODAY:
- Temp: ${Math.round(row.temp)}°F, high of ${Math.round(row.high)}°F, feels like ${Math.round(row.feels_like)}°F
- Condition right now: ${row.condition}
- Rain: ${row.precip_chance}% chance at some point today${rainTiming && rainTiming !== 'now' ? ` — peaks ${rainTiming}, not happening yet` : rainTiming === 'now' ? ' — happening now' : ''}
- Score: ${row.score}/10
- Today's vibe: ${row.synopsis_approved || ''}

Write just the caption text.`;

  const callModel = async (extraInstruction) => {
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
        messages: [{ role: 'user', content: prompt + extraInstruction }]
      })
    });
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || null;
  };

  // Safe, factual, boring: built only from the data, so it can't be wrong.
  const fallback = `${Math.round(row.high)}° in NYC today. score: ${row.score}/10. check the link in bio.\n\n#NYC #NewYork #NewYorkCity #NYCWeather #classicnewweather`;

  // The model doesn't know the date, can't be trusted to repeat numbers
  // faithfully, and has put the wrong day, the wrong month, and the wrong
  // score on real posts. So the result is checked against the row it was
  // given (see copy-guard.js) and regenerated if it's wrong. The approved
  // synopsis is part of what the model sees, so numbers in it are allowed.
  const facts = {
    temp: row.temp,
    high: row.high,
    feelsLike: row.feels_like,
    precipChance: row.precip_chance,
    humidity: row.humidity,
    windSpeed: row.wind_speed,
    score: row.score,
    extraAllowedNumbers: ((row.synopsis_approved || '').match(/\d+/g) || []).map(Number),
    avoidTerms,
    now: new Date()
  };

  const result = await generateChecked({
    callModel,
    check: (text) => checkCaption(text, facts),
    fallback,
    label: 'ig-caption'
  });
  return result.text;
}

module.exports = { generateCaption };
