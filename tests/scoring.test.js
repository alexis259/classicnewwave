// Run with: node --test tests/*.test.js
// scoring.js must produce exactly what the old inline scoreWeather did (the
// stored scores on the live site were built with it), and its label table must
// agree with the deductions it actually makes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreWeather, scoreBreakdown, driversFromPenalties, LABEL_INFO } = require('../netlify/functions/scoring.js');

// Verbatim copy of the pre-refactor implementation from get-daily.js.
function legacyScoreWeather(w) {
  let score = 10;
  const penalties = [];
  const t = w.high;

  if (t >= 70 && t <= 80) {}
  else if ((t >= 65 && t < 70) || (t > 80 && t <= 82)) { score -= 1; }
  else if (t >= 60 && t < 65) { score -= 2; penalties.push("a bit cool"); }
  else if (t >= 55 && t < 60) { score -= 3; penalties.push("kinda cool"); }
  else if (t >= 50 && t < 55) { score -= 4; penalties.push("chilly"); }
  else if (t >= 42 && t < 50) { score -= 5; penalties.push("cold out"); }
  else if (t >= 35 && t < 42) { score -= 6; penalties.push("cold af"); }
  else if (t >= 28 && t < 35) { score -= 7; penalties.push("freezing"); }
  else if (t < 28)             { score -= 8; penalties.push("BRUTAL"); }
  else if (t > 82 && t < 90)  { score -= 2; penalties.push("hot"); }
  else if (t >= 90 && t < 95) { score -= 6; penalties.push("extreme heat"); }
  else if (t >= 95)            { score -= 8; penalties.push("scorching"); }

  const chill = w.temp - w.feelsLike;
  if (chill >= 15)     { score -= 3; penalties.push("wind chill nasty"); }
  else if (chill >= 8) { score -= 2; penalties.push("wind making it worse"); }
  else if (chill >= 4) { score -= 1; penalties.push("some wind chill"); }

  if (w.precipChance > 70)      { score -= 3; penalties.push("heavy rain"); }
  else if (w.precipChance > 45) { score -= 2; penalties.push("real rain chance"); }
  else if (w.precipChance > 20) { score -= 1; penalties.push("light rain possible"); }

  if (w.humidity > 80)      { score -= 2; penalties.push("humid & heavy"); }
  else if (w.humidity > 70) { score -= 1; penalties.push("a lil humid"); }

  const condDesc = (w.condition || '').toLowerCase();
  if ((condDesc === 'broken clouds' || condDesc === 'overcast clouds') && w.precipChance < 20) {
    score -= 1; penalties.push("overcast");
  }

  return { score: Math.max(1, Math.min(10, score)), penalties };
}

function* grid() {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < 30000; i++) {
    const high = -5 + rnd() * 110;
    const temp = high - rnd() * 25;
    yield {
      high, temp, feelsLike: temp - (rnd() < 0.3 ? rnd() * 20 : rnd() * 5),
      precipChance: Math.round(rnd() * 100), humidity: Math.round(rnd() * 100),
      condition: ['clear sky', 'overcast clouds', 'broken clouds', 'moderate rain', 'few clouds'][Math.floor(rnd() * 5)]
    };
  }
  // exact band edges
  for (const high of [27.9, 28, 34.9, 35, 41.9, 42, 49.9, 50, 54.9, 55, 59.9, 60, 64.9, 65, 69.9, 70, 80, 80.1, 82, 82.1, 89.9, 90, 94.9, 95]) {
    for (const precipChance of [0, 20, 21, 45, 46, 70, 71]) {
      for (const humidity of [70, 71, 80, 81]) {
        yield { high, temp: high, feelsLike: high - 4, precipChance, humidity, condition: 'overcast clouds' };
      }
    }
  }
}

test('scoring.js matches the old scoreWeather on 30k+ inputs and every band edge', () => {
  let n = 0;
  for (const w of grid()) {
    assert.deepEqual(scoreWeather(w), legacyScoreWeather(w), JSON.stringify(w));
    n++;
  }
  assert.ok(n > 30000);
});

test('every label scoreWeather can emit is in the cost table with the right cost', () => {
  for (const w of grid()) {
    for (const item of scoreBreakdown(w)) {
      if (!item.label) continue;
      assert.ok(LABEL_INFO[item.label], `missing ${item.label}`);
      assert.equal(LABEL_INFO[item.label].cost, item.cost, item.label);
      assert.equal(LABEL_INFO[item.label].driver, item.driver, item.label);
    }
  }
});

test('Oct 25: cool temps outrank humidity', () => {
  const d = driversFromPenalties(['a bit cool', 'some wind chill', 'a lil humid']);
  assert.deepEqual(d.map(x => x.driver), ['temp', 'wind', 'humidity']);
  assert.deepEqual(d.map(x => x.cost), [2, 1, 1]);
});

test('unknown or missing labels do not throw', () => {
  assert.deepEqual(driversFromPenalties(undefined), []);
  assert.equal(driversFromPenalties(['something new'])[0].cost, 1);
});
