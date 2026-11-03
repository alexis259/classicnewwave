// Run with: node --test tests/*.test.js
// The daylight-saving gate: a cron job scheduled at both possible UTC hours must
// run exactly once a day, at the right New York hour, in summer and in winter.
const test = require('node:test');
const assert = require('node:assert/strict');
const { nycHour, isCronEvent, shouldSkipCron } = require('../netlify/functions/schedule-gate.js');

const cron = { httpMethod: 'POST', body: JSON.stringify({ next_run: '2026-11-04T13:00:00.000Z' }) };
const manual = { httpMethod: 'POST', body: JSON.stringify({ password: 'x' }) };
const at = (iso) => new Date(iso);

// Which of a schedule's UTC hours actually run the job, on a given date?
const runsOn = (date, utcHours, targetNycHour) => utcHours.filter(h =>
  !shouldSkipCron(cron, targetNycHour, 't', at(`${date}T${String(h).padStart(2, '0')}:00:03Z`)));

test('8am post: summer runs at 12 UTC, winter runs at 13 UTC, never both, never neither', () => {
  for (const [date, want] of [
    ['2026-07-15', [12]], ['2026-10-30', [12]],   // EDT
    ['2026-11-01', [13]], ['2026-11-03', [13]], ['2026-12-25', [13]], ['2027-02-10', [13]], // EST (clocks changed Nov 1)
    ['2027-03-13', [13]], ['2027-03-15', [12]],   // spring forward is Mar 14, 2027
  ]) {
    assert.deepEqual(runsOn(date, [12, 13], 8), want, date);
  }
});

test('7am forecast check and noon alert post follow the same rule', () => {
  assert.deepEqual(runsOn('2026-07-15', [11, 12], 7), [11]);
  assert.deepEqual(runsOn('2026-12-15', [11, 12], 7), [12]);
  assert.deepEqual(runsOn('2026-07-15', [16, 17], 12), [16]);
  assert.deepEqual(runsOn('2026-12-15', [16, 17], 12), [17]);
});

test('the changeover days themselves each run exactly once', () => {
  // Nov 1, 2026: fall back at 2am. Mar 14, 2027: spring forward at 2am.
  for (const date of ['2026-11-01', '2027-03-14']) {
    assert.equal(runsOn(date, [12, 13], 8).length, 1, date);
  }
});

test('a slightly late cron still lands in its hour; manual runs are never skipped', () => {
  assert.equal(shouldSkipCron(cron, 8, 't', at('2026-11-03T13:04:30Z')), false);
  assert.equal(shouldSkipCron(manual, 8, 't', at('2026-11-03T20:00:00Z')), false);
  assert.equal(shouldSkipCron({ httpMethod: 'GET' }, 8, 't', at('2026-11-03T20:00:00Z')), false);
  assert.equal(shouldSkipCron({ body: 'not json' }, 8, 't', at('2026-11-03T20:00:00Z')), false);
  assert.equal(shouldSkipCron(undefined, 8, 't'), false);
});

test('helpers', () => {
  assert.equal(isCronEvent(cron), true);
  assert.equal(isCronEvent(manual), false);
  assert.equal(nycHour(at('2026-11-03T05:30:00Z')), 0);   // midnight must not come back as 24
  assert.equal(nycHour(at('2026-07-03T04:30:00Z')), 0);
});
