// @ts-check
// The citation rule (docs/LIBRARIAN.md, experiment 2; SPEC §5.10): like Stephenson's Librarian, he
// says only what a source he was shown says. The model's answer is taken apart into its sentences,
// each with the ids it cites ([P4], [B2][P7]), and a sentence stays only when:
// - it cites something the tools showed the model (an id made up is struck out; a sentence left
//   citing nothing goes);
// - what it quotes is in what it cites (or in another passage shown, which it then cites too);
// - its numbers and its names are in what it cites, or round it (the book's title and author, the
//   section: "In Language, Sapir writes …");
// - it judges or guesses only as they do ("the best", "I recommend", "probably"), and never says
//   what he thinks ("I think");
// - at least half of its other words are there too.
// A sentence saying what the sources do not say goes too. What is left is the answer; nothing
// left, and he found nothing that says so. Pure (tested in Node).

import { fold } from '../search.js';

/** What the Librarian says when nothing he read says it. */
export const NOTHING = 'I found nothing that says so.';

/** At least this share of a sentence's words must be in what it cites. */
export const SUPPORT = 0.5;

/** An id as the tools give them: a book, an article, a place in the text, a section, a passage. */
const ID = '[BATSP]\\d{1,4}';
/** A citation as models write them: [P3], [P3, P4], [P3; B1], (P3), 【P3】. */
const GROUP = `[\\[(【]\\s*${ID}(?:\\s*(?:[,;/&]|and)\\s*${ID})*\\s*[\\])】]`;
/** Citations, with the space before them: one, or several in a row ("[B1][P2]", "[P2], [P5], and [P7]"). */
const MARK = new RegExp(`\\s*${GROUP}(?:\\s*(?:[,;&]\\s*)?(?:and\\s+)?${GROUP})*`, 'gu');

/** A sentence that says nothing was found ("I found nothing that says so", "I could not find …"). */
const SAYS_NOTHING = /\b(?:found nothing|nothing that says|(?:could|did) ?n[o']t find|can ?n[o']t find|unable to find|no (?:information|mention|passages?|sources?) (?:about|on|of|that)|do(?:es)? ?n[o']t (?:say|mention|state))\b/i;

/** Words before a full stop that do not end a sentence ("c. 1564", "Dr. Smith", "e.g. Paris"). */
const ABBREVIATIONS = new Set(['c', 'ca', 'cf', 'dr', 'mr', 'mrs', 'ms', 'st', 'prof', 'vol', 'vols', 'no', 'nos', 'eg', 'ie', 'etc', 'vs', 'jr', 'sr', 'inc', 'ltd', 'co', 'approx', 'fig', 'ed', 'eds', 'rev', 'gen', 'col', 'lt', 'mt', 'ft', 'pp', 'p', 'ch', 'chap']);

/**
 * Capitalized words that are no names ("The", "According"; a sentence's first words: "Based on
 * the text, …"), and words for the library itself.
 */
const NOT_NAMES = new Set([
  'the', 'a', 'an', 'in', 'on', 'at', 'of', 'to', 'by', 'for', 'from', 'with', 'and', 'but', 'or', 'so', 'as', 'if', 'it', 'its',
  'he', 'she', 'his', 'her', 'him', 'they', 'their', 'them', 'we', 'our', 'you', 'your', 'i', 'my', 'me', 'this', 'that',
  'these', 'those', 'there', 'here', 'then', 'when', 'where', 'while', 'which', 'who', 'whom', 'whose', 'what', 'how', 'why',
  'yes', 'no', 'not', 'also', 'both', 'each', 'some', 'many', 'most', 'all', 'any', 'one', 'after', 'before', 'during',
  'however', 'although', 'though', 'because', 'since', 'according', 'among', 'between', 'about', 'under', 'over', 'into',
  'based', 'first', 'second', 'third', 'finally', 'another', 'other', 'like', 'unlike', 'thus', 'therefore', 'hence',
  'moreover', 'furthermore', 'additionally', 'overall', 'indeed', 'instead', 'still', 'yet', 'even', 'now', 'only', 'such',
  'several', 'none', 'neither', 'either', 'every', 'once', 'until', 'unless', 'despite', 'following', 'later', 'earlier',
  'note', 'let', 'sure', 'per', 'don', 'doesn', 'didn', 'isn', 'wasn', 'aren', 'weren', 'can', 'cannot',
  'project', 'gutenberg', 'wikipedia', 'wikimed', 'library', 'librarian', 'encyclopedia', 'article', 'book', 'chapter',
  'section', 'page', 'volume', 'passage', 'preface', 'contents', 'quick', 'facts', 'source', 'sources', 'result', 'results',
]);

/** Words too common, or about the sources themselves, to count for or against a sentence. */
const NOT_COUNTED = new Set([
  ...NOT_NAMES,
  'book', 'books', 'article', 'articles', 'passage', 'passages', 'library', 'text', 'texts', 'author', 'authors', 'wrote',
  'written', 'writes', 'write', 'writing', 'says', 'said', 'states', 'stated', 'describes', 'described', 'describe', 'defines',
  'defined', 'define', 'definition', 'mention', 'mentions', 'mentioned', 'explains', 'explained', 'notes', 'noted', 'called', 'titled',
  'entitled', 'named', 'found', 'find', 'shows', 'gives', 'given', 'tells', 'told', 'chapter', 'section', 'page', 'pages',
  'have', 'has', 'had', 'been', 'were', 'was', 'are', 'is', 'be', 'being', 'will', 'would', 'could', 'should', 'shall', 'may',
  'might', 'must', 'does', 'did', 'done', 'made', 'make', 'makes', 'such', 'than', 'only', 'very', 'just', 'more', 'other',
  'others', 'well', 'into', 'upon', 'onto', 'within', 'without', 'through', 'throughout', 'also', 'like', 'known', 'often',
  'first', 'begins', 'begin', 'starts', 'start', 'opens', 'open', 'line', 'lines', 'words', 'word', 'quote', 'quotes',
]);

/**
 * Words that judge or guess: each must be in what a sentence cites ("the best book", "I
 * recommend", "probably").
 */
const JUDGEMENTS = new Set([
  'best', 'better', 'worst', 'worse', 'greatest', 'finest', 'favourite', 'favorite', 'excellent', 'outstanding', 'superb',
  'brilliant', 'wonderful', 'recommend', 'recommends', 'recommended', 'suggest', 'suggests', 'suggested', 'probably', 'likely',
  'unlikely', 'perhaps', 'maybe', 'possibly', 'presumably', 'apparently', 'seemingly', 'supposedly', 'arguably',
]);
/** What he thinks, which is never his to say ("I think", "I would recommend", "in my opinion"). */
const BELIEF = /\bI (?:think|believe|guess|assume|suppose|feel|would (?:say|recommend|suggest))\b|\bin my (?:opinion|view)\b/i;

/**
 * @typedef {object} Statement a sentence of the answer
 * @property {string} text the sentence, without its citations
 * @property {string[]} ids what it cites, as the model wrote them (B1, P4)
 */

/**
 * @typedef {object} Checked an answer held to the rule
 * @property {Statement[]} kept the sentences that stay, citing only what was shown
 * @property {Array<Statement & { why: string }>} dropped the sentences that go, and why
 * @property {string[]} madeUp ids cited that no tool gave
 * @property {boolean} saidNothing whether the model said it found nothing
 */

/** The ids a citation names. @param {string} mark */
const idsIn = (mark) => [...mark.toUpperCase().matchAll(new RegExp(ID, 'g'))].map((m) => m[0]);

/** Whether the full stop at `i` ends a sentence: not after an abbreviation, an initial or "U.S". @param {string} s @param {number} i */
function endsSentence(s, i) {
  if (s[i] !== '.') return true;
  const word = /([\p{L}.]+)$/u.exec(s.slice(Math.max(0, i - 12), i))?.[1] ?? '';
  if (!word) return true;
  if (/^\p{Lu}$/u.test(word) || word.includes('.')) return false; // "A. L. Kroeber", "U.S."
  return !ABBREVIATIONS.has(word.toLowerCase());
}

/**
 * The answer's sentences, each with the ids it cites: those inside it and those right after it
 * ("… world.” [P2]"). Thinking a model leaves in (<think>…</think>) is taken out.
 * @param {string} answer
 * @returns {Statement[]}
 */
export function statementsOf(answer) {
  // Thinking left in, and the encyclopedia's own references copied ("[1]"), go.
  const s = String(answer ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\s*\[\d{1,3}\]/g, '').replace(/\s+/g, ' ').trim();
  /** The text without citations, and where each citation was in it. */
  let plain = '';
  /** @type {Array<{ at: number, ids: string[] }>} */
  const marks = [];
  /** Where a sentence surely ends: its own full stop after its citation (below). */
  const ends = [];
  let last = 0;
  for (const m of s.matchAll(MARK)) {
    plain += s.slice(last, m.index);
    marks.push({ at: plain.length, ids: idsIn(m[0]) });
    last = (m.index ?? 0) + m[0].length;
    // "… in Ottawa, Ont. [P3]." : the sentence's own full stop, after its citation, where its words
    // end with one already (an abbreviation's, a quotation's): one full stop, and the sentence ends.
    if (s[last] === '.' && s[last + 1] !== '.' && /[.!?…]["”’')\]]*$/.test(plain)) {
      last++;
      ends.push(plain.length);
    }
  }
  plain += s.slice(last);
  // Sentence ends: . ! ? (and the quotes or brackets closing on them) before a capital, a digit or
  // an opening quote, and the end.
  for (const m of plain.matchAll(/[.!?…]+["”’')\]]*(?=\s+["“‘(]?[\p{Lu}\d])/gu)) {
    if (endsSentence(plain, m.index ?? 0)) ends.push((m.index ?? 0) + m[0].length);
  }
  ends.push(plain.length);
  ends.sort((a, b) => a - b);
  /** @type {Statement[]} */
  const out = [];
  let start = 0;
  for (const end of ends) {
    const text = plain.slice(start, end).trim();
    // A citation belongs to the sentence it stands in or right after (spaces before it skipped).
    const ids = [];
    for (const m of marks) {
      let at = m.at;
      while (at > 0 && /\s/.test(plain[at - 1])) at--;
      if (at > start && at <= end) for (const id of m.ids) if (!ids.includes(id)) ids.push(id);
    }
    if (/[\p{L}\p{N}]/u.test(text)) out.push({ text, ids });
    start = end;
  }
  return out;
}

/** Text for matching: folded, quotes plain, words one space apart. @param {string} s */
export const norm = (s) => fold(s).replace(/[’‘`´]/g, "'").replace(/[^\p{L}\p{N}']+/gu, ' ').replace(/(^|\s)'+|'+(\s|$)/g, '$1$2').trim();

/**
 * A word's stem for matching: folded, without "'s" and a plain ending ("signs", "discovered",
 * "studies": sign, discover, study), its first 5 letters.
 * @param {string} w
 */
export const stem = (w) => fold(w).replace(/['’]s$/, '').replace(/['’]/g, '')
  .replace(/ies$/, 'y').replace(/(?<=\w{3})(?:es|ing|ed|ly|(?<!s)s)$/, '').slice(0, 5);

/** Digits grouped in threes by spaces, as one number ("299 792 458"). */
const GROUPED = /(?<![\d.,])\d{1,3}(?:[    ]\d{3})+(?!\d)/g;

/**
 * The numbers in a text, thousands' commas and spaces taken out ("299,792,458", "299 792 458",
 * "1.5"); not the digits of a word or an id ("A1", "B2B").
 * @param {string} s
 */
const numbersIn = (s) => new Set([...s.replace(GROUPED, (m) => m.replace(/\D/g, '')).matchAll(/(?<![\p{L}\d])\d+(?:[.,]\d+)*/gu)]
  .map((m) => m[0].replace(/,(?=\d{3}\b)/g, '').replace(/\.$/, '')));

/** The words of a text (letters and inner apostrophes; hyphens and dashes part them: "Stratford-upon-Avon"). @param {string} s */
const wordsIn = (s) => s.match(/[\p{L}][\p{L}'’]*/gu) ?? [];

/** A word as the lists hold it: folded, without "'s" or a contraction's end ("I'll", "Sapir's"). @param {string} w */
const bare = (w) => fold(w).replace(/['’](?:s|ll|ve|re|m|d|t)$/, '');

/** Whether a word reads as a name: capitalized, and no common word ("The", "Based"). @param {string} w */
const isName = (w) => /^\p{Lu}/u.test(w) && !NOT_NAMES.has(bare(w));

/** Capitalized words in a row: a name of several words ("Jack Nicklaus", "Elizabeth II"). */
const NAME_RUN = /\p{Lu}[\p{L}'’]*(?:[  ]+\p{Lu}[\p{L}'’]*)+/gu;

/** What a sentence quotes: “…”, "…", or ‘…’ round three words or more; each part between ellipses. @param {string} s */
function quotesIn(s) {
  const found = [
    ...[...s.matchAll(/[“"]([^”"]+)[”"]/g)].map((m) => m[1]),
    ...[...s.matchAll(/(?:^|[\s(])[‘']([^’']+?\s[^’']+?\s[^’']+?)[’'](?=[\s,.;:!?)]|$)/g)].map((m) => m[1]),
  ];
  return found.flatMap((q) => q.split(/…|\.\.\./)).map(norm).filter(Boolean);
}

/**
 * The answer held to the rule, against what the tools showed (tools.js sources).
 * @param {string} answer the model's answer
 * @param {Map<string, { kind: string, text: string, context: string }>} sources
 * @returns {Checked}
 */
export function checkAnswer(answer, sources) {
  /** @type {Checked} */
  const out = { kept: [], dropped: [], madeUp: [], saidNothing: false };
  const shown = [...sources.entries()];
  for (const st of statementsOf(answer)) {
    // What the sources do not say is not his to say, cited or not: he found nothing.
    if (SAYS_NOTHING.test(st.text)) {
      out.saidNothing = true;
      continue;
    }
    const drop = (/** @type {string} */ why) => out.dropped.push({ ...st, why });
    const unknown = st.ids.filter((id) => !sources.has(id));
    out.madeUp.push(...unknown.filter((id) => !out.madeUp.includes(id)));
    const ids = st.ids.filter((id) => sources.has(id));
    if (!st.ids.length) {
      drop('cites nothing');
      continue;
    }
    if (!ids.length) {
      drop('cites only what it was not shown');
      continue;
    }
    if (BELIEF.test(st.text)) {
      drop('says what he thinks');
      continue;
    }
    // A quote must be in what it cites (or round it: a book's title); else in another thing shown,
    // which it then cites too.
    const cited = () => ids.map((id) => /** @type {{ text: string, context: string }} */ (sources.get(id)));
    let quoted = true;
    for (const q of quotesIn(st.text)) {
      if (cited().some((s) => norm(`${s.text}\n${s.context}`).includes(q))) continue;
      const other = shown.find(([, s]) => norm(s.text).includes(q));
      if (other) ids.push(other[0]);
      else quoted = false;
    }
    if (!quoted) {
      drop('quotes words that no source has');
      continue;
    }
    const around = cited().map((s) => `${s.text}\n${s.context}`).join('\n');
    const nums = numbersIn(around);
    const missingNumber = [...numbersIn(st.text)].find((n) => !nums.has(n));
    if (missingNumber) {
      drop(`a number its sources do not have (${missingNumber})`);
      continue;
    }
    const stems = new Set(wordsIn(around).map(stem));
    // A name of several words, one of them in what it cites ("Nicklaus"), stands whole ("Jack
    // Nicklaus") in another thing shown: that is cited too.
    for (const run of st.text.matchAll(NAME_RUN)) {
      const parts = wordsIn(run[0]).filter(isName);
      if (parts.every((w) => stems.has(stem(w))) || !parts.some((w) => stems.has(stem(w)))) continue;
      const whole = ` ${norm(run[0])} `;
      const other = shown.find(([, s]) => ` ${norm(`${s.text}\n${s.context}`)} `.includes(whole));
      if (!other) continue;
      if (!ids.includes(other[0])) ids.push(other[0]);
      for (const w of parts) stems.add(stem(w));
    }
    const words = wordsIn(st.text);
    const missingName = words.find((w) => isName(w) && !stems.has(stem(w)));
    if (missingName) {
      drop(`a name its sources do not have (${missingName})`);
      continue;
    }
    const judged = words.find((w) => JUDGEMENTS.has(bare(w)) && !stems.has(stem(w)));
    if (judged) {
      drop(`a judgement its sources do not make (${judged})`);
      continue;
    }
    const counted = words.filter((w) => w.length >= 4 && !NOT_COUNTED.has(bare(w)));
    const supported = counted.filter((w) => stems.has(stem(w))).length;
    if (counted.length >= 2 && supported / counted.length < SUPPORT) {
      drop(`says more than its sources (${supported} of ${counted.length} words there)`);
      continue;
    }
    out.kept.push({ text: st.text, ids });
  }
  return out;
}
