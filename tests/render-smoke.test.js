// Run with: node --test tests/*.test.js
// Every template that shows the hair forecast must still draw, in each hair tier.
const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../netlify/functions/generate-ig-graphic.js');

const key = '2026-11-06';
const base = {
  date_key: key, high: 64, low: 49, feels_like: 56, condition: 'clear sky', score: 6, wind_speed: 8, synopsis_approved: 'cool start, clear all day.',
  forecast: [0, 1, 2, 3, 4].map(i => ({ dateKey: `2026-11-0${6 + i}`, day: ['Fri', 'Sat', 'Sun', 'Mon', 'Tue'][i], high: 60 + i, rain: 0 }))
};
const rows = {
  good: { ...base, temp: 57.6, humidity: 86, precip_chance: 0 },
  dry: { ...base, temp: 46, humidity: 63, precip_chance: 0 },
  silk: { ...base, temp: 84, humidity: 87, precip_chance: 10 },
  rain: { ...base, temp: 55, humidity: 90, precip_chance: 80 }
};

for (const [name, draw] of [['slide 2', 'drawDailySlide2'], ['weekly', 'drawWeekly'], ['hair', 'drawHair'], ['dashboard', 'drawDashboard']]) {
  test(`${name} draws in every hair tier`, async () => {
    for (const [tier, row] of Object.entries(rows)) {
      const canvas = await g[draw](row);
      assert.ok(canvas.width > 0 && canvas.height > 0, `${draw} / ${tier}`);
    }
  });
}
