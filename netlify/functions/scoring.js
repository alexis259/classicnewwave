// netlify/functions/scoring.js
// The daily weather score, and WHY it is what it is.
//
// scoreBreakdown() returns each deduction with its cost and what drove it, so
// the copy writers can be told what actually held the day back and the copy
// check can tell when a line blames something minor (a 73% humidity that cost
// one point) for a day that was really held back by something bigger (cool
// temps, two points). Same thresholds as the old scoreWeather in get-daily.js;
// tests/scoring.test.js pins the two to identical output.
//
// Frontends read score/penalties from Supabase and never rescore, so this is
// the single place the thresholds live (admin.html keeps an offline fallback
// copy that is not used when Supabase has a score).

function scoreBreakdown(w) {
  const items = [];
  const take = (driver, label, cost) => items.push({ driver, label, cost });
  const t = w.high;

  if (t >= 70 && t <= 80) {}
  else if ((t >= 65 && t < 70) || (t > 80 && t <= 82)) take('temp', null, 1);
  else if (t >= 60 && t < 65) take('temp', 'a bit cool', 2);
  else if (t >= 55 && t < 60) take('temp', 'kinda cool', 3);
  else if (t >= 50 && t < 55) take('temp', 'chilly', 4);
  else if (t >= 42 && t < 50) take('temp', 'cold out', 5);
  else if (t >= 35 && t < 42) take('temp', 'cold af', 6);
  else if (t >= 28 && t < 35) take('temp', 'freezing', 7);
  else if (t < 28)            take('temp', 'BRUTAL', 8);
  else if (t > 82 && t < 90)  take('temp', 'hot', 2);
  else if (t >= 90 && t < 95) take('temp', 'extreme heat', 6);
  else if (t >= 95)           take('temp', 'scorching', 8);

  const chill = w.temp - w.feelsLike;
  if (chill >= 15)     take('wind', 'wind chill nasty', 3);
  else if (chill >= 8) take('wind', 'wind making it worse', 2);
  else if (chill >= 4) take('wind', 'some wind chill', 1);

  if (w.precipChance > 70)      take('rain', 'heavy rain', 3);
  else if (w.precipChance > 45) take('rain', 'real rain chance', 2);
  else if (w.precipChance > 20) take('rain', 'light rain possible', 1);

  if (w.humidity > 80)      take('humidity', 'humid & heavy', 2);
  else if (w.humidity > 70) take('humidity', 'a lil humid', 1);

  const condDesc = (w.condition || '').toLowerCase();
  if ((condDesc === 'broken clouds' || condDesc === 'overcast clouds') && w.precipChance < 20) {
    take('clouds', 'overcast', 1);
  }
  return items;
}

function scoreWeather(w) {
  const items = scoreBreakdown(w);
  const score = 10 - items.reduce((n, i) => n + i.cost, 0);
  return {
    score: Math.max(1, Math.min(10, score)),
    penalties: items.filter(i => i.label).map(i => i.label)
  };
}

// Cost and driver for a stored penalty label (the row only keeps the labels).
// The mild-temperature deduction has no label, so it never appears here.
const LABEL_INFO = {};
for (const w of [
  { high: 62 }, { high: 57 }, { high: 52 }, { high: 45 }, { high: 38 }, { high: 30 }, { high: 20 }, { high: 85 }, { high: 92 }, { high: 97 }
]) {
  for (const i of scoreBreakdown({ temp: 70, feelsLike: 70, precipChance: 0, humidity: 0, condition: '', ...w })) {
    if (i.label) LABEL_INFO[i.label] = i;
  }
}
for (const w of [
  { temp: 70, feelsLike: 66 }, { temp: 70, feelsLike: 62 }, { temp: 70, feelsLike: 55 },
  { precipChance: 30 }, { precipChance: 50 }, { precipChance: 80 },
  { humidity: 75 }, { humidity: 85 }, { condition: 'overcast clouds' }
]) {
  for (const i of scoreBreakdown({ high: 75, temp: 70, feelsLike: 70, precipChance: 0, humidity: 0, condition: '', ...w })) {
    if (i.label) LABEL_INFO[i.label] = i;
  }
}

// Stored penalty labels -> [{driver, label, cost}] biggest first. An unknown
// label (e.g. written by an older scoring version) counts as a 1-point item.
// Pass { high } so the unlabeled 1-point mild-temperature deduction (65-69
// and 81-82 degrees) is counted too.
function driversFromPenalties(labels, { high } = {}) {
  const items = (labels || []).map(label => LABEL_INFO[label] || { driver: 'other', label, cost: 1 });
  if (high != null && !items.some(i => i.driver === 'temp')) {
    const mild = scoreBreakdown({ high, temp: 70, feelsLike: 70, precipChance: 0, humidity: 0 }).find(i => i.driver === 'temp');
    if (mild) items.push({ ...mild, label: 'a little off from perfect' });
  }
  return items.sort((a, b) => b.cost - a.cost);
}

module.exports = { scoreBreakdown, scoreWeather, driversFromPenalties, LABEL_INFO };
