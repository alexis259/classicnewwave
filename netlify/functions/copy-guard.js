// netlify/functions/copy-guard.js
// Checks and cleanup shared by the copy generators (generate-synopsis.js,
// ig-caption.js), so both enforce the same rules instead of each carrying
// their own.
//
// Why this exists:
//  - The model has no idea what day it is. Four captions named a weekday and
//    all four were wrong (one said "tuesday" on a Thursday). Prompts alone
//    can't prevent that, so generated text is checked and regenerated.
//  - Models can't count characters. When a synopsis ran over the 140-char
//    limit it was chopped at a word boundary, leaving endings like
//    "...sharper than it". Over-long text is now regenerated, and if it
//    still has to be trimmed it's cut at a natural break, not mid-thought.

const MAX_SYNOPSIS_LEN = 140;

// "monday" ... "sunday". No word boundaries on purpose, so it also catches
// hashtags like #MondayVibes. (Plain "sun"/"mon" don't match: sun is a weather
// word.)
const DAY_NAME = /(?:mon|tues|wednes|thurs|fri|satur|sun)day/i;

function namesADay(text) {
  return DAY_NAME.test(text || '');
}

// Last resort, only after regeneration has failed. Drops hashtags that contain
// a day name and swaps any remaining day word for "today".
function scrubDayNames(text) {
  return String(text || '')
    .replace(/[ \t]*#\w*(?:mon|tues|wednes|thurs|fri|satur|sun)day\w*/gi, '')
    .replace(new RegExp(DAY_NAME.source, 'gi'), 'today')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Words a sentence can't end on. Used only when a cut has no punctuation to
// land on, to avoid ending on "...than" or "...but honestly it's".
const DANGLING = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'so', 'nor', 'yet', 'than', 'that', 'which',
  'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'about', 'like',
  'is', 'are', 'was', 'were', 'be', 'it', "it's", "that's", "there's", "we're", "you're",
  "they're", "i'm", "he's", "she's", 'its', 'your', 'our', 'their', 'this', 'these', 'those',
  'not', 'just', 'still', 'even', 'though', 'because', 'if', 'when', 'while', 'honestly'
]);

const MIN_CUT = 40; // don't return a stub when cutting at a break

// Cut `text` to at most `max` chars, ending on a natural break (sentence end,
// ellipsis, em-dash, comma, semicolon) rather than mid-thought.
function trimToLength(text, max = MAX_SYNOPSIS_LEN) {
  text = String(text || '').trim();
  if (text.length <= max) return text;

  const head = text.slice(0, max + 1); // +1 so a break sitting exactly at `max` counts
  let cutAt = -1;

  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (c === '.' && head[i + 1] === '.') {
      // start of an ellipsis: cut before it, skip the rest of the run
      cutAt = i;
      while (head[i + 1] === '.') i++;
    } else if (c === '.' || c === '!' || c === '?') {
      cutAt = i + 1;
    } else if (c === '—' || c === ',' || c === ';') {
      cutAt = i;
    }
  }

  // Only use a break that leaves a real thought and actually fits.
  if (cutAt >= MIN_CUT && cutAt <= max) {
    return text.slice(0, cutAt).replace(/[\s,;—-]+$/, '').trim();
  }

  // No usable break: cut at a word boundary, then drop any dangling tail words.
  const words = text.slice(0, max).replace(/\s+\S*$/, '').split(/\s+/);
  while (words.length > 3 && DANGLING.has(words[words.length - 1].toLowerCase().replace(/[.,!?…—-]+$/, ''))) {
    words.pop();
  }
  return words.join(' ').replace(/[\s,;—-]+$/, '').trim();
}

module.exports = { MAX_SYNOPSIS_LEN, namesADay, scrubDayNames, trimToLength };
