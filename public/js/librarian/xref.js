// @ts-check
// Links between libraries (docs/LIBRARIAN.md, experiment 3; SPEC §5.10): what a text names that
// another library has an article on, and the names a book's author and title may have an article
// under. He can only find things: a link is offered where the words on the page are an article's
// title as written, never where they merely resemble one.
//
// The rule for words (mentionsIn). Words in a row are a mention of an article of another library
// when:
// - they are its title as written: the same words in the same order with the same marks between
//   them, the first letter's case aside ("probability density function" for "Probability density
//   function"; not "Nova" for "NOvA", "early stage" for "Early Stage", nor "a group" for
//   "A-group"). Hyphens and dashes within a word, quotes and spaces are alike whatever their kind;
// - they are two words or more, two of them not little words ("The Tradition" is one word in all
//   but name; "up to", "a value", "almost all"), and the last is not a little word;
// - the text's own library has no article of those words (its own links lead there), and they are
//   not part of a longer run that is an article's title anywhere ("field theory" in "quantum
//   field theory"): the longest run counts;
// - they stand in running text: a paragraph or a list item, not a heading, a table (an infobox's
//   labels: "Molar mass"), a caption, a link (linked already), raised or lowered text (a
//   reference's number) nor a list of sources ("Wayback Machine");
// - and the text shows which sense it means, since the same words can be two things ("large
//   numbers of bats" is not mathematics' Large numbers, the "nuclear fusion" of a fungus's cells
//   not physics'): it writes them as a name ("Isaac Newton", "the Manhattan Project", "COVID-19
//   vaccine"), or it names another article of the same library within a few lines (NEAR: "atrial
//   fibrillation" beside "high blood pressure", both WikiMed's).
// The first four parts make a match (matchesIn); the last makes it a mention.
// A single word is never one: over the demo set single words led to the right article less than
// half the time ("Mass" in Catholic Church is not physics' Mass, "Tiger" in a golfer's article not
// the animal). tools/librarian-xref.mjs counts the mentions over folders of ZIMs and holds the
// rule to matches read by hand (tools/librarian-xref-checked.json): the mentions among them must
// be the right article 19 times in 20. Pure (tested in Node); English.

/** The longest title looked for, in words. */
export const MAX_WORDS = 8;

/**
 * Little words: none counts as one of a mention's two words, and none ends one. English
 * (docs/LIBRARIAN.md, "English to start"). Words that begin names are not among them ("up
 * quark", "Down syndrome", "New York", "First World War").
 */
export const LITTLE = new Set((
  'a an the and or but nor so yet if while because although though unless whether than as '
  + 'of to in on at by for with from into onto upon about after before between among through during without within '
  + 'against above below per via '
  + 'it its this that these those there here he she they we you i him her them us me his their our your my mine yours '
  + 'who whom whose which what when where why how '
  + 'all any some no not none each every both either neither such same other another many much more most few less least '
  + 'several one own '
  + 'is are was were be been being am do does did have has had having will would shall should can could may might must '
  + 'almost also only just very too then thus hence still even ever never always often again once now etc'
).split(' '));

/** Headings of a list of sources: what stands under one is not running text. */
const SOURCES = new Set([
  'references', 'notes', 'citations', 'footnotes', 'sources', 'bibliography', 'further reading', 'external links',
  'works cited', 'notes and references', 'references and notes', 'explanatory notes', 'general references',
]);

/** Style bits of a run (SPEC §3.5): raised and lowered text. */
const RAISED = 8 | 16;

/**
 * @typedef {object} Tokens a text as its words and what stands between them
 * @property {string[]} words letters and digits, with the hyphens and apostrophes inside them
 * @property {string[]} gaps gaps[i]: what stands between words[i] and words[i + 1] (" ", ", ", "/")
 * @property {number[]} at at[i]: where words[i] begins in plain(text)
 */

/**
 * @typedef {object} Entry an article's title, of a library
 * @property {string} lib the library's id
 * @property {string} title
 * @property {any} [ref] what its keeper needs to open it (a volume and a chunk)
 * @property {Tokens} [tokens] its words, once a text has had them (entryTokens)
 */

/**
 * @typedef {object} Piece running text of a block, between what parts it (a link, a line's end)
 * @property {number} block the block's index among the blocks given
 * @property {string} text
 */

/**
 * @typedef {object} Mention words of a text that are an article's title in another library
 * @property {string} text the words as the text has them, where they first stand
 * @property {string} key the words in lower case, one space apart (what the titles are kept by)
 * @property {Entry[]} entries the articles of those words, one per library that has one
 * @property {number} block the block they first stand in (its index among the blocks given)
 * @property {string} context the words round them there
 * @property {number} count how many times they stand in the blocks
 * @property {boolean} name whether the text writes them as a name, somewhere (isName)
 * @property {number[]} at where they stand: each time, how many characters of running text come before
 * @property {number[]} blocks the block they stand in, each time
 * @property {number | null} near how far the nearest other match of an article of the same library
 *   stands, in characters of running text (nearestOf; null with none, or not looked for yet)
 */

/**
 * A text with its hyphens, quotes and spaces made one kind each, and what is not seen taken out
 * (soft hyphens, zero-width marks). A long dash stays: it parts words, as a comma does.
 * @param {string} s
 */
export function plain(s) {
  s = String(s ?? '');
  if (/[^\x20-\x7e]/.test(s)) {
    s = s.replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, '')
      .replace(/[\u2010-\u2013\u2212]/g, '-')
      .replace(/[\u2018\u2019\u02bc]/g, "'")
      .replace(/[\u201c-\u201e]/g, '"')
      .replace(/\s+/g, ' ');
  }
  return s.replace(/ {2,}/g, ' ');
}

/** A word: letters and digits (and the marks on them), with single hyphens and apostrophes inside. */
const WORD = /[\p{L}\p{N}\p{M}]+(?:['-][\p{L}\p{N}\p{M}]+)*/gu;

/**
 * A text as its words and what stands between them.
 * @param {string} text
 * @returns {Tokens}
 */
export function tokensOf(text) {
  const s = plain(text);
  /** @type {Tokens} */
  const t = { words: [], gaps: [], at: [] };
  let end = -1;
  for (const m of s.matchAll(WORD)) {
    const i = m.index ?? 0;
    if (end >= 0) t.gaps.push(s.slice(end, i));
    t.words.push(m[0]);
    t.at.push(i);
    end = i + m[0].length;
  }
  return t;
}

/**
 * What titles are kept by: their words in lower case, one space apart.
 * @param {string[]} words
 */
export const keyOf = (words) => words.join(' ').toLowerCase();

/**
 * Whether a word is a little word where it stands: a capital letter alone after the first word is
 * a letter's name, not "a" or "I" ("Vitamin A", "World War I").
 * @param {string} word as written
 * @param {boolean} first whether it is the run's first word
 */
const isLittle = (word, first) => LITTLE.has(word.toLowerCase()) && (first || word.length > 1 || word !== word.toUpperCase());

/**
 * Whether words may be a mention at all, whatever they name: two or more, two of them not little
 * words, the last not a little word.
 * @param {string[]} words as written
 * @param {number} [from]
 * @param {number} [n] how many of them
 */
export function mayBeMention(words, from = 0, n = words.length - from) {
  if (n < 2 || isLittle(words[from + n - 1], false)) return false;
  let counted = 0;
  for (let k = from; k < from + n; k++) if (!isLittle(words[k], k === from)) counted++;
  return counted >= 2;
}

/**
 * Whether the `n` words of `t` from `i` are the title `e` as written: the same words and the same
 * marks between them, the first letter's case aside.
 * @param {Tokens} t
 * @param {number} i
 * @param {number} n
 * @param {Tokens} e
 */
export function asWritten(t, i, n, e) {
  if (e.words.length !== n) return false;
  for (let k = 1; k < n; k++) {
    if (t.words[i + k] !== e.words[k] || t.gaps[i + k - 1] !== e.gaps[k - 1]) return false;
  }
  const a = t.words[i];
  const b = e.words[0];
  if (a === b) return true;
  const la = String.fromCodePoint(a.codePointAt(0) ?? 0);
  const lb = String.fromCodePoint(b.codePointAt(0) ?? 0);
  return a.slice(la.length) === b.slice(lb.length) && la.toLowerCase() === lb.toLowerCase();
}

/**
 * A title's words and the marks between them, taken when a text first has its words (most titles
 * are never met: a library's tens of thousands are kept as they are).
 * @param {Entry} entry
 * @returns {Tokens}
 */
export const entryTokens = (entry) => (entry.tokens ??= tokensOf(entry.title));

/**
 * The titles of the libraries' articles, kept by their words (keyOf). Kept small, a page holding
 * a hundred thousand of them: a title, its library and its ref, nothing more until it is met.
 */
export class Titles {
  /**
   * @param {{ single?: boolean }} [options] single: titles of one word are kept too (to count what
   *   the rule leaves out: tools/librarian-xref.mjs; no match is ever one)
   */
  constructor({ single = false } = {}) {
    /** @type {Map<string, Entry | Entry[]>} a key's title, or its titles */
    this.byKey = new Map();
    /** How many titles it holds. */
    this.count = 0;
    this.single = single;
  }

  /**
   * Adds an article's title; false for one that is not kept: no words, more than MAX_WORDS of
   * them, or one word (unless `single`).
   * @param {string} lib the library's id
   * @param {string} title
   * @param {any} [ref] what the keeper needs to open the article
   */
  add(lib, title, ref) {
    const { words } = tokensOf(title);
    const n = words.length;
    if (!n || n > MAX_WORDS || (n === 1 && !this.single)) return false;
    const key = keyOf(words);
    /** @type {Entry} */
    const entry = ref === undefined ? { lib, title: String(title) } : { lib, title: String(title), ref };
    const had = this.byKey.get(key);
    if (had === undefined) this.byKey.set(key, entry);
    else if (Array.isArray(had)) had.push(entry);
    else this.byKey.set(key, [had, entry]);
    this.count++;
    return true;
  }

  /**
   * The titles of those words, whatever their case and the marks between them.
   * @param {string} key
   * @returns {Entry[] | undefined}
   */
  get(key) {
    const had = this.byKey.get(key);
    if (had === undefined) return undefined;
    return Array.isArray(had) ? had : [had];
  }
}

/** A heading's words, as SOURCES names them. @param {any[]} runs */
const headingOf = (runs) => plain(runs.map((r) => (typeof r?.[0] === 'string' ? r[0] : '')).join('')).trim().toLowerCase();

/**
 * The running text of blocks (SPEC §3.5), in pieces: paragraphs and list items, each parted at a
 * link, a picture, raised or lowered text and a line's end; nothing of a heading, a table, a
 * caption, preformatted text, nor of what stands under a heading of sources.
 * @param {any[]} blocks
 * @returns {Piece[]}
 */
export function piecesOf(blocks) {
  /** @type {Piece[]} */
  const out = [];
  let sources = 0; // under a heading of sources: its level
  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b];
    if (!block) continue;
    if (block.t === 'h') {
      const level = block.l ?? 1;
      if (sources && level <= sources) sources = 0;
      if (!sources && SOURCES.has(headingOf(block.r ?? []))) sources = level;
      continue;
    }
    if (sources || (block.t !== 'p' && block.t !== 'li') || !Array.isArray(block.r)) continue;
    let text = '';
    for (const run of block.r) {
      if (!Array.isArray(run) || typeof run[0] !== 'string') continue;
      // A link (linked already), a picture in the line, a reference's number: they part the text.
      const parts = run[2] || (run[1] & RAISED) ? ['', ''] : run[0].split('\n');
      for (let k = 0; k < parts.length; k++) {
        if (k && /[\p{L}\p{N}]/u.test(text)) out.push({ block: b, text });
        if (k) text = '';
        text += parts[k];
      }
    }
    if (/[\p{L}\p{N}]/u.test(text)) out.push({ block: b, text });
  }
  return out;
}

/**
 * The blocks round some of a part's, enough to tell which matches there stand: those from `first`
 * to `last` and their neighbours, until `margin` characters of text come before and after them (or
 * the part ends). Where they begin under a heading of sources, one leads them, so what is no
 * running text stays none.
 * @param {any[]} blocks a part's
 * @param {number} first
 * @param {number} last
 * @param {number} margin characters of text each way (0: those blocks alone)
 * @returns {{ blocks: any[], start: number, lead: number }} blocks[i] is the part's block
 *   i - lead + start
 */
export function windowOf(blocks, first, last, margin) {
  if (!blocks.length) return { blocks: [], start: 0, lead: 0 };
  const chars = (/** @type {any} */ block) => {
    let n = 0;
    if (Array.isArray(block?.r)) for (const run of block.r) if (typeof run?.[0] === 'string') n += run[0].length;
    return n;
  };
  let start = Math.max(0, Math.min(first, blocks.length - 1));
  let end = Math.max(start, Math.min(last, blocks.length - 1));
  for (let n = 0; start > 0 && n < margin;) n += chars(blocks[--start]);
  for (let n = 0; end < blocks.length - 1 && n < margin;) n += chars(blocks[++end]);
  let sources = 0; // under a heading of sources as they begin: its level
  for (let b = 0; b < start; b++) {
    const block = blocks[b];
    if (block?.t !== 'h') continue;
    const level = block.l ?? 1;
    if (sources && level <= sources) sources = 0;
    if (!sources && SOURCES.has(headingOf(block.r ?? []))) sources = level;
  }
  const out = blocks.slice(start, end + 1);
  if (sources) out.unshift({ t: 'h', l: sources, r: [['References', 0]] });
  return { blocks: out, start, lead: sources ? 1 : 0 };
}

/**
 * The words round a place in a text (from `from` up to `to`), cut at spaces, "…" where it is cut.
 * @param {string} s
 * @param {number} from
 * @param {number} to
 * @param {number} [span] how far each way, in characters
 */
export function contextOf(s, from, to, span = 90) {
  let a = Math.max(0, from - span);
  let b = Math.min(s.length, to + span);
  if (a > 0) a = Math.min(from, s.indexOf(' ', a) + 1 || a);
  if (b < s.length) b = Math.max(to, s.lastIndexOf(' ', b));
  return `${a > 0 ? '… ' : ''}${s.slice(a, b).trim()}${b < s.length ? ' …' : ''}`;
}

/** What ends a sentence, or opens words quoted: a capital after it is no sign of a name. */
const SENTENCE_END = /[.!?:;"(\[]/;

/**
 * Whether the text writes the `n` words from `i` as a name: with a capital that grammar does not
 * ask for (one past a word's first letter, "COVID-19", "mRNA"; one beginning a word that begins
 * no sentence, "Isaac Newton", "the Manhattan Project", "by Caesarean section").
 * @param {Tokens} t
 * @param {number} i
 * @param {number} n
 */
export function isName(t, i, n) {
  for (let k = i; k < i + n; k++) {
    const w = t.words[k];
    if (/^.+\p{Lu}/u.test(w)) return true;
    if (!/^\p{Lu}/u.test(w)) continue;
    // The run's first word: a name only where no sentence begins.
    if (k > i || (i > 0 && !SENTENCE_END.test(t.gaps[i - 1]))) return true;
  }
  return false;
}

/**
 * The matches in blocks: the words that are the title of an article of another library, as
 * written (the rule's first four parts), each once, in the order they first stand. A match is
 * not yet a mention: mentionsIn keeps those that stand.
 * @param {any[]} blocks §3.5 blocks: a page's, an article's, a book's part
 * @param {{ get(key: string): Entry[] | undefined }} titles the libraries' titles (Titles)
 * @param {{ own?: string | null }} [options] own: the id of the text's own library
 * @returns {Mention[]}
 */
export function matchesIn(blocks, titles, { own = null } = {}) {
  /** @type {Map<string, Mention>} */
  const found = new Map();
  let before = 0; // the running text before this piece, in characters
  for (const piece of piecesOf(blocks)) {
    const s = plain(piece.text);
    const t = tokensOf(s);
    const low = t.words.map((w) => w.toLowerCase());
    const start = before;
    before += s.length + 1;
    for (let i = 0; i + 1 < low.length;) {
      let step = 1;
      // The longest run first; its key's shorter ones are its beginnings.
      const most = Math.min(MAX_WORDS, low.length - i);
      const joined = low.slice(i, i + most).join(' ');
      let end = joined.length;
      for (let n = most; n >= 2; end -= low[i + n - 1].length + 1, n--) {
        const entries = titles.get(joined.slice(0, end))?.filter((e) => asWritten(t, i, n, entryTokens(e)));
        if (!entries?.length) continue;
        // Its own library has it: no link between libraries, and nothing inside it is one.
        if (own !== null && entries.some((e) => e.lib === own)) {
          step = n;
          break;
        }
        if (!mayBeMention(t.words, i, n)) continue;
        const key = joined.slice(0, end);
        const had = found.get(key);
        const name = isName(t, i, n);
        if (had) {
          had.count++;
          had.name ||= name;
          had.at.push(start + t.at[i]);
          had.blocks.push(piece.block);
        } else {
          const from = t.at[i];
          const to = t.at[i + n - 1] + t.words[i + n - 1].length;
          found.set(key, {
            text: s.slice(from, to), key, entries, block: piece.block, context: contextOf(s, from, to), count: 1, name,
            at: [start + from], blocks: [piece.block], near: null,
          });
        }
        step = n;
        break;
      }
      i += step;
    }
  }
  return [...found.values()];
}

/**
 * How near another article of the same library must be named for words that are not written as
 * a name to stand as a mention: within this many characters of running text, a few lines.
 */
export const NEAR = 300;

/**
 * Gives each match its `near`: how far the nearest other match of an article of the same library
 * stands from it, in characters of running text (null with none).
 * @param {Mention[]} matches
 * @returns {Mention[]} the same
 */
export function nearestOf(matches) {
  /** @type {Map<string, Array<{ at: number, m: Mention }>>} every place of a library's matches */
  const places = new Map();
  for (const m of matches) {
    m.near = null;
    for (const lib of new Set(m.entries.map((e) => e.lib))) {
      let list = places.get(lib);
      if (!list) places.set(lib, list = []);
      for (const at of m.at) list.push({ at, m });
    }
  }
  const nearer = (/** @type {Mention} */ m, /** @type {number} */ d) => {
    if (m.near === null || d < m.near) m.near = d;
  };
  for (const list of places.values()) {
    list.sort((a, b) => a.at - b.at);
    for (let i = 0; i < list.length; i++) {
      const { at, m } = list[i];
      // The nearest place of another match, before and after.
      let j = i - 1;
      while (j >= 0 && list[j].m === m) j--;
      if (j >= 0) nearer(m, at - list[j].at);
      j = i + 1;
      while (j < list.length && list[j].m === m) j++;
      if (j < list.length) nearer(m, list[j].at - at);
    }
  }
  return matches;
}

/**
 * Whether a match stands as a mention: the text writes it as a name, or names another article of
 * the same library near it (NEAR).
 * @param {{ name: boolean, near: number | null }} match with its `near` (nearestOf)
 */
export const stands = (match) => match.name || (match.near !== null && match.near <= NEAR);

/**
 * The mentions in blocks of articles of other libraries (the whole rule above), each once, in the
 * order they first stand. What stands near the blocks' ends may lack its company: give the text
 * round the pages wanted, and take the mentions on them (their `blocks`).
 * @param {any[]} blocks §3.5 blocks: a page's and its neighbours', an article's, a book's part
 * @param {{ get(key: string): Entry[] | undefined }} titles the libraries' titles (Titles)
 * @param {{ own?: string | null }} [options] own: the id of the text's own library
 * @returns {Mention[]}
 */
export function mentionsIn(blocks, titles, options) {
  return nearestOf(matchesIn(blocks, titles, options)).filter(stands);
}

/**
 * The mentions on pages: the matches on the blocks `first` to `last` of a part that stand, told
 * from the text round them (a mention's company may stand on the page before), in the pages'
 * order, each with where it first stands on them (`block`, `blocks`: the part's) and the words
 * round it there. What is offered is as the pages have it.
 * @param {any[]} blocks the part's blocks, or those round the pages (windowOf, with NEAR)
 * @param {number} first
 * @param {number} last
 * @param {{ get(key: string): Entry[] | undefined }} titles
 * @param {{ own?: string | null }} [options] own: the id of the book's own library
 * @returns {Mention[]}
 */
export function mentionsOn(blocks, first, last, titles, { own = null } = {}) {
  // What stands: told with the text before and after, where its company may be.
  const round = windowOf(blocks, first, last, NEAR);
  const standing = new Set();
  for (const m of mentionsIn(round.blocks, titles, { own })) {
    if (m.blocks.some((b) => b - round.lead + round.start >= first && b - round.lead + round.start <= last)) standing.add(m.key);
  }
  if (!standing.size) return [];
  // What is offered: as the pages have it.
  const page = windowOf(blocks, first, last, 0);
  const shift = page.start - page.lead;
  const out = [];
  for (const m of matchesIn(page.blocks, titles, { own })) {
    if (!standing.has(m.key)) continue;
    m.block += shift;
    m.blocks = m.blocks.map((b) => b + shift);
    out.push(m);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// A book's author and title as articles (step 3 looks them up; an article found must still say
// it is theirs).

/** Who is no one to look up. */
const NO_ONE = /^(?:anonymous|anon\.?|various|unknown|wikipedia|wikisource|n\/a)$/i;
/** What stands before a name without being part of an article's title. */
const HONORIFIC = /^(?:sir|dame|dr|mr|mrs|miss|ms|rev|reverend|prof|professor|capt|captain|col|colonel|gen|general|hon)\.?\s+/i;
/** What ends a name without being its surname. */
const AFTER_NAME = /^(?:jr|sr|ii|iii|iv|esq)\.?$/i;

/**
 * The names an author may have an article under, the fullest first. Project Gutenberg writes
 * "F. Max (Friedrich Max) Müller": the names in brackets stand for those before them ("Friedrich
 * Max Müller"), and without initials he is "Max Müller". "Twain, Mark" is turned round; years
 * after a name go. None for no one's name ("Anonymous", "Various").
 * @param {string | null | undefined} author
 * @returns {string[]}
 */
export function authorNames(author) {
  let s = plain(String(author ?? '')).trim();
  // "Austen, Jane, 1775-1817": the years go.
  s = s.replace(/,?\s*\(?\b\d{3,4}\??\s*-\s*(?:\d{3,4}\??)?\)?\s*$/, '').trim();
  if (!s || NO_ONE.test(s)) return [];
  const names = [];
  const add = (/** @type {string} */ name) => {
    name = name.replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '');
    if (name && !names.includes(name)) names.push(name);
  };
  // "Surname, Given names" (not "Given Surname, Jr."): turned round.
  const turned = /^([^,()]+),\s*([^,()]+(?:\([^)]*\)[^,()]*)?)$/.exec(s);
  if (turned && !AFTER_NAME.test(turned[2].trim())) s = `${turned[2].trim()} ${turned[1].trim()}`;
  const bracket = /^(.*?)\s*\(([^)]+)\)\s*(.*)$/.exec(s);
  let given = s;
  if (bracket) {
    const [, before, inside, after] = bracket;
    // "F. Max (Friedrich Max) Müller": the names in full, then as given. "Saki (H. H. Munro)":
    // another name altogether. "Homer (750? BCE-650? BCE)": no name at all.
    const named = !/\d/.test(inside);
    if (after && named) add(`${inside} ${after}`);
    given = after ? `${before} ${after}` : before;
    add(given);
    if (!after && named) add(inside);
  } else add(s);
  for (const name of [...names]) {
    add(name.replace(HONORIFIC, ''));
  }
  // Without initials ("Max Müller", "Harold Palmer"), where a first name is left.
  const words = given.replace(HONORIFIC, '').split(' ');
  const kept = words.filter((w) => !/^\p{Lu}\.$/u.test(w));
  if (kept.length >= 2 && kept.length < words.length && !/^\p{Lu}\.$/u.test(words[words.length - 1])) add(kept.join(' '));
  return names;
}

/**
 * An author's surname, as an article about a book of theirs names them ("Müller", "Twain"); ''
 * for no one's.
 * @param {string | null | undefined} author
 */
export function surnameOf(author) {
  const name = authorNames(author).at(-1) ?? '';
  const words = name.split(' ').map((w) => w.replace(/,+$/, '')).filter((w) => w && !AFTER_NAME.test(w));
  return words.at(-1) ?? '';
}

/**
 * What ends a title without being part of the work's name, after a mark: ", Volume 1 (of 2)",
 * " — Part II", " (Vol. 3)". Not "The Jungle Book 2".
 */
const VOLUME = /(?:\s*[,;:]\s*|\s+[-\u2014]\s*|\s*\()(?:volumes?|vols?\.?|parts?|books?)\s+(?:\d+|[ivxlc]+)\b(?:\s*\(?of\s+(?:\d+|[ivxlc]+)\)?)?\)?\s*$/i;

/**
 * The titles a book may have an article under, the likeliest first: its title without a subtitle
 * or a volume's number ("Language" for "Language: An Introduction to the Study of Speech"), then
 * as Wikipedia tells works of one name apart ("Emma (novel)", "Language (Sapir book)"), then the
 * title in full.
 * @param {{ title?: string | null, subtitle?: string | null, author?: string | null }} book
 * @returns {string[]}
 */
export function titleForms(book) {
  const full = plain(String(book?.title ?? '')).trim();
  if (!full) return [];
  let main = full.replace(VOLUME, '').trim() || full;
  // A subtitle after a colon or a semicolon, or an other title ("…; or, The Whale").
  main = main.split(/\s*[:;]\s+|,\s+or,?\s+/i)[0].replace(VOLUME, '').trim() || main;
  const surname = surnameOf(book.author);
  const forms = [main, `${main} (novel)`];
  if (surname) forms.push(`${main} (${surname} novel)`);
  forms.push(`${main} (book)`);
  if (surname) forms.push(`${main} (${surname} book)`);
  forms.push(`${main} (play)`, `${main} (poem)`);
  if (full !== main) forms.push(full);
  return forms;
}
