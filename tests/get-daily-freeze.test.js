// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://x';
const { freezePosted } = require('../netlify/functions/get-daily');

test('posted day keeps its high and drops any rescored score/penalties', () => {
  const row = { high: 61.07, score: 4, ig_posted: true };
  const refreshed = { high: 59.86, temp: 59.7, score: 2, penalties: ['kinda cool'] };
  freezePosted(refreshed, row);
  assert.equal(refreshed.high, 61.07);
  assert.equal('score' in refreshed, false);
  assert.equal('penalties' in refreshed, false);
  assert.equal(refreshed.temp, 59.7); // live fields still refresh
});

test('a stored null high does not overwrite the fresh one', () => {
  const refreshed = { high: 59.86 };
  freezePosted(refreshed, { high: null });
  assert.equal(refreshed.high, 59.86);
});
