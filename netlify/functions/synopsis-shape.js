// netlify/functions/synopsis-shape.js
// Assigns each day's synopsis a structure and a closing move IN CODE.
//
// Asking the model to "vary the shape" doesn't work: it was told, at length,
// not to repeat itself, and still wrote the same sentence four days running.
// So the variety is decided here. The day number cycles through the forms, so
// two consecutive days can never get the same one, and a retry rotates to the
// next so a repeat-rejected draft is rewritten in a different shape.
//
// Descriptions are deliberately abstract — no sample sentences, because a
// sample in a prompt is what the model copies.

const FORMS = [
  'Lead with the verdict, then give the reason. No "but" pivot.',
  'Open on a raw reaction or exclamation with no setup. Explain after, or not at all.',
  'Lead with practical advice (what to wear or bring) and let the weather reason trail after it.',
  'Describe how it physically feels outside today. No gripe-then-reassure, no contrast words.',
  'One short clause. No pivot, no closing beat.'
];

const CLOSERS = [
  'flat acceptance',
  'a joke',
  'a warning',
  'a complaint',
  'a rhetorical aside',
  'none — end on the observation itself'
];

// "YYYY-MM-DD" (the NYC date key) -> whole days since 1970-01-01.
function dayNumber(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function pickShape(dateKey, attempt = 0) {
  const n = dayNumber(dateKey) + attempt;
  const formIdx = ((n % FORMS.length) + FORMS.length) % FORMS.length;
  // step of 5 is coprime with 6, so it visits every closer before repeating
  const closerIdx = (((n * 5) % CLOSERS.length) + CLOSERS.length) % CLOSERS.length;
  const minimal = formIdx === FORMS.length - 1; // the one-clause form has no closer
  return { form: FORMS[formIdx], closer: minimal ? null : CLOSERS[closerIdx], formIdx, closerIdx };
}

module.exports = { FORMS, CLOSERS, dayNumber, pickShape };
