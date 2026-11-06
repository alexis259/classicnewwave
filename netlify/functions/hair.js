// netlify/functions/hair.js
// The hair forecast, in one place. It used to be written out separately in the
// graphic helper, slide 2 (inline), and the site, each rating the day by
// RELATIVE humidity. That misleads in cool weather: 86% at 57 degrees is
// comfortable air with almost no frizz risk, yet it read "HIGH HUMIDITY ALERT"
// most of the fall.
//
// The percentage is still what the slides SHOW (people know it), but the rating
// behind it comes from the dew point, which is what frizz actually follows. When
// the percentage looks scary and the air isn't, the sub-line says why. In cold,
// dry air the real problems are dryness and static, so that gets its own
// report instead of a "good hair day".
//
// Rain still counts on its own (wet hair), as it always did.

const { dewPointF } = require('./scoring');

// Dew point (F) bands. Tunable in one place.
const DRY_BELOW = 40;       // under this: dry-air report
const LOW_FROM = 55;        // frizz possible
const MODERATE_FROM = 62;
const HIGH_FROM = 66;
const SILK_FROM = 70;

const TIERS = {
  dry:      { rank: 0, level: 'DRY AIR',             color: '#4A9ECF', sub: 'MOISTURIZE + SEAL.',        rec: 'PROTECTIVE STYLE  ·  COVER UP',            single: 'cornrows.png',    trio: ['cornrows.png', 'bantu-knots.png', 'afro-puff.png'] },
  good:     { rank: 0, level: 'GOOD HAIR DAY',       color: '#5AAA40', sub: "YOU'RE GOOD.",              rec: 'SILK PRESS  ·  BLOWOUT  ·  ANY STYLE',     single: 'wash-and-go.png', trio: ['silk-press.png', 'wash-and-go.png', 'afro-puff.png'] },
  low:      { rank: 1, level: 'LOW RISK',            color: '#88AA40', sub: 'FRIZZ POSSIBLE.',          rec: 'SILK PRESS  ·  WASH & GO',                 single: 'wash-and-go.png', trio: ['wash-and-go.png', 'afro-puff.png', 'silk-press.png'] },
  moderate: { rank: 2, level: 'MODERATE RISK',       color: '#C8A000', sub: 'PROCEED WITH CAUTION.',    rec: 'ANTI-HUMIDITY SPRAY  ·  BRAID OUT',        single: 'silk-press.png',  trio: ['wash-and-go.png', 'afro-puff.png', 'silk-press.png'] },
  high:     { rank: 3, level: 'HIGH HUMIDITY ALERT', color: '#E88000', sub: 'MONITOR CLOSELY.',         rec: 'WASH & GO  ·  PROTECTIVE STYLE',           single: 'afro-puff.png',   trio: ['afro-puff.png', 'wash-and-go.png', 'bantu-knots.png'] },
  silk:     { rank: 4, level: 'SILK PRESS WARNING',  color: '#E8C500', sub: 'PROCEED AT YOUR OWN RISK.', rec: 'PUFF  ·  BRAIDS  ·  BUN',                 single: 'cornrows.png',    trio: ['cornrows.png', 'bantu-knots.png', 'afro-puff.png'] }
};

// The day's dew point for a stored row. get-daily pins it into today's forecast
// entry so it stays consistent with the (frozen) humidity after the post goes
// out; otherwise it's computed from the row's own temp and humidity.
function dewPointForRow(row) {
  if (!row) return null;
  const today = Array.isArray(row.forecast) ? row.forecast.find(f => f && f.dateKey === row.date_key) : null;
  if (today && typeof today.dew === 'number') return today.dew;
  return dewPointF(row.temp, row.humidity);
}

function dewTier(dew) {
  if (dew == null) return 'good';
  if (dew >= SILK_FROM) return 'silk';
  if (dew >= HIGH_FROM) return 'high';
  if (dew >= MODERATE_FROM) return 'moderate';
  if (dew >= LOW_FROM) return 'low';
  if (dew < DRY_BELOW) return 'dry';
  return 'good';
}

function rainTier(rain) {
  if (rain > 60) return 'silk';
  if (rain > 40) return 'high';
  if (rain > 25) return 'moderate';
  return null;
}

// hairStatus({ humidity, dewPoint, rain }) -> everything the slides and the site need.
function hairStatus({ humidity, dewPoint, rain }) {
  let key = dewTier(dewPoint);
  const rt = rainTier(rain || 0);
  if (rt && TIERS[rt].rank > TIERS[key].rank) key = rt;
  else if (rt && key === 'dry') key = rt; // rain beats "dry air"
  const t = TIERS[key];

  // A high percentage with comfortable air is the confusing case: say so.
  const coldAirNote = humidity != null && humidity >= 65 && dewPoint != null && dewPoint < LOW_FROM && (key === 'good' || key === 'dry');
  const sub = coldAirNote && key === 'good' ? 'COLD AIR, LOW FRIZZ.' : t.sub;

  return {
    tier: key, level: t.level, color: t.color, sub, rec: t.rec,
    icon: t.single, icons: t.trio,
    dewPoint: dewPoint == null ? null : Math.round(dewPoint)
  };
}

const hairStatusForRow = (row) => hairStatus({ humidity: row.humidity, dewPoint: dewPointForRow(row), rain: row.precip_chance });

module.exports = { hairStatus, hairStatusForRow, dewPointForRow, dewTier, TIERS, DRY_BELOW, LOW_FROM, MODERATE_FROM, HIGH_FROM, SILK_FROM };
