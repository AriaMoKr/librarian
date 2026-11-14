// @ts-check
// "Also in the library" (docs/LIBRARIAN.md, experiment 3 step 3; SPEC §5.10): asked with a book in
// hand or open, the librarian tells what the other libraries have on it:
// - the article on its author and the article on the book itself, of a Wikipedia;
// - the same work in another library (Gutenberg and Wikisource, or two Gutenberg files);
// - the author's other books in the other libraries.
// And from a Wikipedia's article on a writer or a book: the books themselves.
//
// He can only find things, so an article is offered as theirs where it shows it is, not where it
// merely has the name (xref.js names an author and a book as articles may: authorNames,
// titleForms):
// - An article of the author's name is on the author when it names a book of theirs that the
//   catalogue has, gives their fuller name ("Friedrich Max Müller" in "Max Müller"), or is named
//   by three names or more spelled out ("Robert Gordon Latham"). One that shows none of these is
//   offered as what it is, an article of that name, and he says he cannot tell it is the same
//   person. A page that only lists what a name may refer to is none.
// - An article of the book's title is on the book when its title names the author ("Language
//   (Sapir book)"), or its first paragraph names the author and says it is a book, a novel, a poem
//   and the like: "Language" alone is the article on language, and "Relativity" the theory.
// - Books are another's by their author's name, as each library writes it, and the same work by
//   the same title and volume as well. Between two Gutenberg files of one form the id they give
//   the author tells two of one name apart: Project Gutenberg's own number in the older files,
//   papers2zim's slug in the newer. A number and a slug cannot be compared, so between an older
//   file and a newer one the names are.
// What it looks up goes where a typed search goes: the libraries' articles by their titles (a few
// names and forms of a title), the articles found (read to see whose they are), and the
// catalogue's books, which the page has. Pure but for what it is given (tested in Node); English.

import { fold } from '../search.js';
import { MAX_FINDS } from './ask.js';
import { authorNames, LITTLE, plain, surnameOf, titleForms, volumeOf } from './xref.js';

/** @typedef {{ id: string, libId?: string, title: string, author?: string | null, authorId?: string | number | null, readable?: boolean }} Book a book of the catalogue (SPEC §4) */
/** @typedef {{ id: string, kind?: string, title?: string, indexing?: unknown }} Lib a library of the catalogue */
/** @typedef {{ title: string, book: string, n: number, from?: string }} Article an article, where it is (search.js findArticles) */
/** @typedef {{ book: Book, lib: Lib, hay: string }} Entry a book of the catalogue's index (search.js bookIndex) */
/**
 * @typedef {'author' | 'name' | 'title' | 'same' | 'other' | 'itself' | 'by'} What what a find is
 *   to the book in hand (a find's `also`; ask.js ALSO has the words for each)
 */

/** The names of an author tried as articles' titles, and the forms of a title, at most. */
const MOST_NAMES = 4;
const MOST_FORMS = 8;
/** The articles asked for at once by a title's beginning: its forms are among them ("Emma", "Emma (novel)"). */
const FORMS_AT_ONCE = 12;
/** ms a Wikipedia gets to answer (one read over the network a block at a time may take long), then the answer goes without it. */
export const ALSO_WAIT = 12000;
/** The books of an author whose titles are looked for in an article, at most (the most read first). */
const MOST_TITLES = 60;
/** How much of an article's opening is read (characters). */
const LEAD_CHARS = 3000;
/** ms of reading an article between two pauses, where the page's frames must go on. */
const SLICE_MS = 4;

/** A word: letters and digits, with an apostrophe inside ("Moby-Dick" is two, "Adam's" one). */
const WORD = /[\p{L}\p{N}\p{M}]+(?:'[\p{L}\p{N}\p{M}]+)*/gu;

/**
 * A text's words, parted at everything else.
 * @param {string | null | undefined} text
 * @returns {string[]}
 */
export const wordsOf = (text) => plain(String(text ?? '')).match(WORD) ?? [];

/**
 * What names and titles are compared by: their words without case or accents, one space apart.
 * @param {string | null | undefined} text
 */
export const wordKey = (text) => wordsOf(text).map((w) => fold(w)).join(' ');

/** Whether two names or titles are the same words. @param {string} a @param {string} b */
export const sameWords = (a, b) => wordKey(a) === wordKey(b) && wordKey(a) !== '';

/**
 * Words that many titles share and that tell no book from another: none counts towards knowing a
 * title in an article ("Poems", "The Works of …", "Letters of …").
 */
const GENERIC = new Set((
  'poems poetry essays letters works plays sermons stories tales verses memoirs autobiography journal journals diary '
  + 'speeches lectures selections miscellanies writings songs ballads sonnets fables dialogues history introduction '
  + 'grammar dictionary poetical complete collected selected notes studies sketches reminiscences recollections '
  + 'correspondence biography life volume volumes book books edition'
).split(' '));

/** Whether a word is written with a capital: at its start, or inside ("McClure", "iPhone"). @param {string} word */
const capital = (word) => /\p{Lu}/u.test(word);

/** A block's text: its runs', and a table row's cells'; nothing of a picture in a line. @param {any} block */
function textOf(block) {
  let s = '';
  /** @param {unknown} runs */
  const add = (runs) => {
    if (!Array.isArray(runs)) return;
    for (const run of runs) if (Array.isArray(run) && typeof run[0] === 'string' && !run[2]?.src) s += run[0];
  };
  add(block?.r);
  if (Array.isArray(block?.c)) {
    for (const cell of block.c) {
      add(cell);
      s += ' | ';
    }
  }
  return s;
}

/**
 * @typedef {object} Opening how an article begins
 * @property {string} first its first paragraph: what it says the thing is
 * @property {string} lead its text before its first heading (at most LEAD_CHARS)
 */

/**
 * An article's opening: its paragraphs and list items before the first heading under its title.
 * @param {any[]} blocks §3.5 blocks: the article's
 * @returns {Opening}
 */
export function openingOf(blocks) {
  let first = '';
  let lead = '';
  for (let b = 0; b < blocks.length && lead.length < LEAD_CHARS; b++) {
    const block = blocks[b];
    if (block?.t === 'h') {
      if ((block.l ?? 1) > 1 || lead) break;
      continue; // its title
    }
    if (block?.t !== 'p' && block?.t !== 'li') continue;
    const text = textOf(block).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (!first && block.t === 'p' && text.length >= 30) first = text;
    lead += `${lead ? ' | ' : ''}${text}`;
  }
  return { first: first || lead, lead: lead.slice(0, LEAD_CHARS) };
}

/**
 * Whether an article only lists what its name may refer to.
 * @param {string} title
 * @param {Opening} opening
 */
export function listsNames(title, opening) {
  return /\(disambiguation\)\s*$/i.test(title) || /\b(?:may|can|could|might)(?: also)? (?:refer|stand) (?:to|for)\b/i.test(opening.lead.slice(0, 400));
}

/**
 * @typedef {object} Words a text's words, to find names and titles among
 * @property {string[]} raw the words as written; '|' where a block ends
 * @property {string} low the same without case or accents, a space apart and at each end
 * @property {number[]} at where each word begins in `low`
 */

/**
 * The words of some texts, a block's each: what stands in two blocks is no run of words.
 * @param {string[]} texts
 * @returns {Words}
 */
export function wordsIn(texts) {
  /** @type {string[]} */
  const raw = [];
  for (const text of texts) {
    for (const w of wordsOf(text)) raw.push(w);
    raw.push('|');
  }
  /** @type {number[]} */
  const at = [];
  let low = ' ';
  for (const w of raw) {
    at.push(low.length);
    low += `${w === '|' ? w : fold(w)} `;
  }
  return { raw, low, at };
}

/**
 * Where a run of words stands among a text's: the index of its first word, each time.
 * @param {Words} words
 * @param {string} key the run, as wordKey gives it
 * @returns {number[]}
 */
export function runsOf(words, key) {
  /** @type {number[]} */
  const out = [];
  if (!key) return out;
  const want = ` ${key} `;
  for (let i = words.low.indexOf(want); i >= 0; i = words.low.indexOf(want, i + 1)) {
    // The word that begins at i + 1 (the run's first).
    let lo = 0;
    let hi = words.at.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (words.at[mid] < i + 1) lo = mid + 1;
      else hi = mid;
    }
    out.push(lo);
  }
  return out;
}

/**
 * @typedef {object} Sought how a book's title is looked for in an article
 * @property {string} key its words (wordKey), without a subtitle or a volume
 * @property {number} n how many words
 * @property {boolean} strict whether they must be written as a title there, with its capitals: a
 *   title of few words of its own may be ordinary words ("Common Sense", "On Liberty")
 */

/**
 * How a book's title is known in an article on its author; null for a title that tells nothing:
 * one made of words many titles share and of the author's own name ("Poems", "The Works of Edgar
 * Allan Poe"), or a single short word.
 * @param {Book} book
 * @returns {Sought | null}
 */
export function titleSought(book) {
  const main = titleForms(book)[0] ?? '';
  const words = wordsOf(main);
  const theirs = new Set(authorNames(book.author).flatMap((name) => wordsOf(name).map((w) => fold(w))));
  const own = words.filter((w) => {
    const f = fold(w);
    return !LITTLE.has(f) && !GENERIC.has(f) && !theirs.has(f) && !/^\d+$/.test(f);
  });
  if (!own.length || (words.length === 1 && words[0].length < 5)) return null;
  return { key: words.map((w) => fold(w)).join(' '), n: words.length, strict: own.length < 3 };
}

/**
 * Whether a text names a title: its words in a row; for a `strict` one, those that are not little
 * words written with capitals, as a title is.
 * @param {Words} words
 * @param {Sought} sought
 */
export function namesTitle(words, sought) {
  for (const i of runsOf(words, sought.key)) {
    if (!sought.strict) return true;
    let written = true;
    for (let k = i; k < i + sought.n && written; k++) {
      if (!LITTLE.has(words.raw[k].toLowerCase()) && !capital(words.raw[k])) written = false;
    }
    if (written) return true;
  }
  return false;
}

/** A name's words spelled out: not an initial ("F."), nor one letter. @param {string} name */
const spelledOut = (name) => wordsOf(name).filter((w) => w.length > 1).length;

/**
 * What shows that an article of an author's name is on that author: 'names' (it is named by three
 * names or more spelled out), 'fuller' (its opening gives a fuller name of theirs), 'title' (it
 * names a book of theirs); null when nothing does.
 * @param {object} o
 * @param {Words} o.words the article's words
 * @param {Opening} o.opening
 * @param {string} o.matched the name the article has (its title, or its other name)
 * @param {string[]} o.names the author's names (xref.js authorNames)
 * @param {Sought[]} o.titles their books' titles (titleSought)
 * @returns {'names' | 'fuller' | 'title' | null}
 */
export function showsAuthor({ words, opening, matched, names, titles }) {
  if (spelledOut(matched) >= 3) return 'names';
  const lead = wordsIn([opening.lead]);
  const n = wordsOf(matched).length;
  for (const name of names) {
    if (wordsOf(name).length > n && spelledOut(name) >= 3 && runsOf(lead, wordKey(name)).length) return 'fuller';
  }
  for (const sought of titles) if (namesTitle(words, sought)) return 'title';
  return null;
}

/** What an article's first paragraph calls a written work. */
const WORK = new RegExp(`\\b(?:${[
  'book', 'novel', 'novella', 'novelette', 'poem', 'play', 'treatise', 'essay', 'pamphlet', 'memoir', 'autobiography', 'biography',
  'story', 'tale', 'satire', 'tragedy', 'comedy', 'epic', 'dialogue', 'monograph', 'textbook', 'dictionary', 'encyclopa?edia',
  'anthology', 'collection', 'trilogy', 'fable', 'travelogue', 'manifesto', 'libretto', 'hymnal', 'songbook',
  'work of (?:fiction|non-?fiction|literature|philosophy|history|science|scholarship|reference|scientific literature|political philosophy)',
].join('|')})s?\\b`, 'i');

/**
 * Whether an article of a book's title is on that book: its title names the author in brackets,
 * or its first paragraph names the author and says it is a written work.
 * @param {string} title the article's
 * @param {Opening} opening
 * @param {string} surname the author's (xref.js surnameOf); none: it cannot be told
 */
export function showsBook(title, opening, surname) {
  if (surname.length < 3) return false;
  const named = fold(surname);
  const brackets = /\(([^)]*)\)\s*$/.exec(title)?.[1] ?? '';
  if (brackets && wordsOf(brackets).some((w) => fold(w) === named)) return true;
  // As written: a surname is a name, with its capital.
  return wordsOf(opening.first).some((w) => capital(w) && fold(w) === named) && WORK.test(opening.first);
}

// ------------------------------------------------------------------------------------------------
// The catalogue's books: whose they are, and which are one work.

/** @type {Map<string, string[]>} an author as written → their names' word keys */
const NAMES = new Map();

/** An author's names as word keys (xref.js authorNames), kept: many books have one author. @param {string | null | undefined} author */
function namesOf(author) {
  const a = String(author ?? '');
  let names = NAMES.get(a);
  if (!names) {
    if (NAMES.size > 4000) NAMES.clear();
    names = authorNames(a).map((n) => wordKey(n)).filter(Boolean);
    NAMES.set(a, names);
  }
  return names;
}

/**
 * An author's id in Gutenberg's older files: Project Gutenberg's own number ("53"). Kiwix's newer
 * files (papers2zim, SPEC §2.2) give a slug instead ("mark-twain").
 */
const NUMBERED = /^\d+$/;

/**
 * The id a Gutenberg file gives a book's author, else null.
 * @param {{ book: Book, lib: Lib }} x
 */
const gutenbergAuthor = (x) => (x.lib.kind === 'gutenberg' && x.book.authorId != null && x.book.authorId !== '' ? String(x.book.authorId) : null);

/**
 * The kind of id a book's author has: 'number' (Gutenberg's older files), 'slug' (its newer) or
 * '' (none: another library's book, or no author's id).
 * @param {{ book: Book, lib: Lib }} x
 */
export function idKind(x) {
  const id = gutenbergAuthor(x);
  return id === null ? '' : NUMBERED.test(id) ? 'number' : 'slug';
}

/**
 * Whether two books are one author's: by the id two Gutenberg files give the author where both
 * give one of a kind, Project Gutenberg's number in the older files or papers2zim's slug in the
 * newer (two authors of one name have two); else by a name they share. A number and a slug cannot
 * be compared, so between an older file and a newer one the names are.
 * @param {{ book: Book, lib: Lib }} x
 * @param {{ book: Book, lib: Lib }} y
 */
export function sameAuthor(x, y) {
  const kind = idKind(x);
  if (kind !== '' && kind === idKind(y)) return gutenbergAuthor(x) === gutenbergAuthor(y);
  const a = namesOf(x.book.author);
  const b = namesOf(y.book.author);
  return a.some((n) => b.includes(n));
}

/** What a work is known by among one author's: its title without a subtitle, and its volume. @param {Book} book */
export function workKey(book) {
  const vol = volumeOf(book.title);
  return `${wordKey(titleForms(book)[0] ?? book.title)}${vol ? ` #${vol}` : ''}`;
}

/** An author as said: as the book has them, without the names in brackets. @param {string | null | undefined} author */
const authorSaid = (author) => plain(String(author ?? '')).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

/** Names in a row: "A", "A and B", "A, B and C". @param {string[]} names */
const listed = (names) => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/**
 * @typedef {object} Also what "Also in the library" is given (the page's: librarian.js)
 * @property {Book & { libId: string }} book the book in hand
 * @property {{ title: string, blocks: any[] } | null} [article] with a Wikipedia's volume in
 *   hand: the article it is open at (null: not open)
 * @property {Lib[]} libraries the catalogue's
 * @property {() => Entry[]} index the catalogue's books (search.js bookIndex)
 * @property {(lib: Lib, q: string, limit: number) => Promise<Article[]>} articles a Wikipedia's
 *   articles whose titles start with q, or that are also called so (api.js searchArticles)
 * @property {(lib: Lib, book: string, n: number) => Promise<any[]>} blocksOf an article's blocks
 *   (api.js getChunk)
 * @property {(step: string) => void} [onStep] told what he is doing meanwhile
 * @property {(() => Promise<void>) | null} [breathe] a pause for the page's frames, taken between
 *   slices of reading an article (a headset's frame has 13.9 ms)
 * @property {number} [wait] ms a Wikipedia gets to answer (ALSO_WAIT)
 */

/** @param {string} text @returns {import('./ask.js').Answer} */
const say = (text) => ({ text, finds: [], search: null });

/**
 * An article's words, read block by block with pauses where the page's frames must go on.
 * @param {any[]} blocks
 * @param {(() => Promise<void>) | null} [breathe]
 * @returns {Promise<Words>}
 */
export async function readWords(blocks, breathe = null) {
  /** @type {string[]} */
  const texts = [];
  let since = performance.now();
  for (let b = 0; b < blocks.length; b++) {
    const t = blocks[b]?.t;
    if (t === 'p' || t === 'li' || t === 'h' || t === 'tr') texts.push(textOf(blocks[b]));
    if (breathe && !(b % 16) && performance.now() - since >= SLICE_MS) {
      await breathe();
      since = performance.now();
    }
  }
  if (breathe) await breathe();
  return wordsIn(texts);
}

/**
 * Answers "what else does the library have on this book?": at most MAX_FINDS finds, the articles
 * first, then the same work elsewhere, then the author's other books.
 * @param {Also} o
 * @returns {Promise<import('./ask.js').Answer>}
 */
export async function lookAlso(o) {
  const { book, libraries, index, onStep = () => {}, breathe = null, wait = ALSO_WAIT } = o;
  const lib = libraries.find((l) => l.id === book.libId) ?? { id: book.libId };
  const libName = (/** @type {Lib} */ l) => String(l.title ?? l.id);
  if (lib.kind === 'wikipedia') return fromArticle(o);
  if (libraries.length < 2) return say('There is no other library here for me to look in.');
  const here = { book, lib };
  const names = authorNames(book.author);
  const surname = surnameOf(book.author);

  // The catalogue's books by the same author, elsewhere: the same work, and the others.
  const mine = workKey(book);
  const hint = fold(surname);
  /** @type {Entry[]} */
  const theirs = [];
  if (names.length && hint) {
    for (const e of index()) {
      if (e.lib.kind !== 'wikipedia' && e.book !== book && e.hay.includes(hint) && sameAuthor(e, here)) theirs.push(e);
    }
  }
  const elsewhere = theirs.filter((e) => e.lib.id !== lib.id);
  const same = elsewhere.filter((e) => workKey(e.book) === mine);
  const others = elsewhere.filter((e) => workKey(e.book) !== mine);
  // A work with no author to go by ("Beowulf", Anonymous): the same where another library has it
  // so too, by a title that is a book's own.
  if (!names.length && titleSought(book)) {
    const first = mine.split(' ')[0];
    for (const e of index()) {
      if (e.lib.kind !== 'wikipedia' && e.lib.id !== lib.id && e.hay.includes(first) && !namesOf(e.book.author).length && workKey(e.book) === mine) same.push(e);
    }
  }

  // The Wikipedias' articles: on the author, and on the book.
  const wikis = libraries.filter((l) => l.kind === 'wikipedia' && l.id !== lib.id && !l.indexing);
  /** @type {import('./ask.js').Find[]} */
  const onAuthor = [];
  /** @type {import('./ask.js').Find[]} */
  const named = [];
  /** @type {import('./ask.js').Find[]} */
  const onBook = [];
  /** The Wikipedias that did not answer in time. @type {Lib[]} */
  const late = [];
  if (wikis.length && (names.length || surname)) {
    onStep(wikis.length === 1 ? `Looking in ${libName(wikis[0])}…` : `Looking in ${wikis.length} libraries…`);
    /** @type {Sought[]} */
    const titles = [];
    const seen = new Set();
    for (const b of [book, ...theirs.map((e) => e.book)]) {
      const sought = titleSought(b);
      if (!sought || seen.has(sought.key) || titles.length >= MOST_TITLES) continue;
      seen.add(sought.key);
      titles.push(sought);
    }
    await Promise.all(wikis.map(async (wiki) => {
      let over = false; // its time is up: what it finds after that is not waited for
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timer;
      const looking = (async () => {
        /** An article's opening and words, read once. @type {Map<string, Promise<{ opening: Opening, words: Words } | null>>} */
        const read = new Map();
        const reading = (/** @type {Article} */ a) => {
          const key = `${a.book}/${a.n}`;
          let p = read.get(key);
          if (!p) {
            p = o.blocksOf(wiki, a.book, a.n).then(async (blocks) => ({ opening: openingOf(blocks), words: await readWords(blocks, breathe) }), () => null);
            read.set(key, p);
          }
          return p;
        };
        /** The articles whose titles begin so, or that are also called so. @param {string} called @param {number} limit */
        const articlesOf = (called, limit) => o.articles(wiki, called, limit).catch(() => /** @type {Article[]} */ ([]));
        /** Among articles, the one called so: by its title, else by another name of its. @param {Article[]} found @param {string} called */
        const calledSo = (found, called) => found.find((a) => sameWords(a.title, called)) ?? found.find((a) => !!a.from && sameWords(a.from, called)) ?? null;
        // On the author: the fullest name first; an article that does not show it is theirs is
        // kept as an article of that name, unless another name's article shows it.
        /** @type {Article | null} */
        let unsure = null;
        /** @type {Article | null} */
        let sure = null;
        for (const name of names.slice(0, MOST_NAMES)) {
          const hit = calledSo(await articlesOf(name, 4), name);
          if (over) return;
          if (!hit) continue;
          const got = await reading(hit);
          if (over) return;
          if (!got || listsNames(hit.title, got.opening)) continue;
          const matched = sameWords(hit.title, name) ? hit.title : name;
          if (showsAuthor({ ...got, matched, names, titles })) {
            sure = hit;
            break;
          }
          unsure ??= hit;
        }
        if (sure) onAuthor.push({ kind: 'article', article: sure, lib: wiki, also: 'author' });
        else if (unsure) named.push({ kind: 'article', article: unsure, lib: wiki, also: 'name' });
        // On the book: the forms its title may have as an article's. One search by the title
        // itself finds them ("Emma", "Emma (novel)"); only where more articles begin so than it
        // gives are the forms it may have cut off asked for by name.
        if (!surname) return;
        const forms = titleForms(book).slice(0, MOST_FORMS);
        const main = forms[0] ?? '';
        const found = await articlesOf(main, FORMS_AT_ONCE);
        if (over) return;
        const cut = found.length >= FORMS_AT_ONCE;
        const bracketsCut = cut && wordKey(found[found.length - 1].title).startsWith(`${wordKey(main)} `) && /\(/.test(found[found.length - 1].title);
        for (const form of forms) {
          let hit = calledSo(found, form);
          if (!hit && cut && form !== main && (bracketsCut || !form.startsWith(`${main} (`))) {
            hit = calledSo(await articlesOf(form, 4), form);
            if (over) return;
          }
          if (!hit || hit === sure) continue;
          const got = await reading(hit);
          if (over) return;
          if (!got || listsNames(hit.title, got.opening) || !showsBook(hit.title, got.opening, surname)) continue;
          onBook.push({ kind: 'article', article: hit, lib: wiki, also: 'title' });
          break;
        }
      })();
      const inTime = await Promise.race([
        looking.then(() => true, () => true),
        new Promise((/** @type {(value: boolean) => void} */ resolve) => { timer = setTimeout(() => resolve(false), wait); }),
      ]);
      clearTimeout(timer);
      if (!inTime) {
        over = true;
        late.push(wiki);
      }
    }));
    // In the catalogue's order, whichever library answered first.
    const order = (/** @type {import('./ask.js').Find} */ a, /** @type {import('./ask.js').Find} */ b) => wikis.indexOf(a.lib) - wikis.indexOf(b.lib);
    onAuthor.sort(order);
    named.sort(order);
    onBook.sort(order);
  }

  /** @type {import('./ask.js').Find[]} */
  const all = [
    ...onAuthor, ...onBook,
    ...same.map((e) => /** @type {import('./ask.js').Find} */ ({ kind: 'book', book: e.book, lib: e.lib, also: 'same' })),
    ...named,
    ...others.map((e) => /** @type {import('./ask.js').Find} */ ({ kind: 'book', book: e.book, lib: e.lib, also: 'other' })),
  ];
  late.sort((a, b) => wikis.indexOf(a) - wikis.indexOf(b));
  const unheard = late.length ? ` I did not hear from ${listed(late.map(libName))} in time.` : '';
  if (!all.length) return say(`I see nothing else in the library on this book${names.length ? ' or its author' : ''}.${unheard}`);
  const finds = all.slice(0, MAX_FINDS);
  const author = authorSaid(book.author);
  const sameLibs = new Set(same.map((e) => e.lib.id));
  const parts = [
    onAuthor.length === 1 ? 'the article on its author' : onAuthor.length ? `articles on its author in ${onAuthor.length} libraries` : '',
    onBook.length === 1 ? 'the article on this book' : onBook.length ? `articles on this book in ${onBook.length} libraries` : '',
    sameLibs.size === 1 ? `the same work in ${libName(same[0].lib)}` : sameLibs.size ? `the same work in ${sameLibs.size} other libraries` : '',
    others.length === 1 ? `one other book by ${author}` : others.length ? `${others.length} other books by ${author}` : '',
  ].filter(Boolean);
  let text = parts.length ? `Also in the library: ${listed(parts)}.` : '';
  if (named.length) {
    const what = named.length === 1 ? `an article called “${named[0].kind === 'article' ? named[0].article.title : ''}”` : `${named.length} articles of the author’s name`;
    text += `${text ? ' And ' : 'I found '}${what}, though nothing in ${named.length === 1 ? 'it' : 'them'} tells me it is the same person.`;
  }
  if (all.length > finds.length) text += ` Here are the first ${finds.length}.`;
  return { text: `${text}${unheard}`, finds, search: null };
}

/**
 * From a Wikipedia's article on a writer or a book: the books themselves, of the other libraries.
 * @param {Also} o
 * @returns {Promise<import('./ask.js').Answer>}
 */
async function fromArticle({ book, article = null, libraries, index, breathe = null }) {
  if (!article) return say('Ask me this at an article: I look for the books of the library that it is about, or whose writer it is about.');
  const title = article.title;
  // "Language (Sapir book)": the name without its brackets.
  const name = title.replace(/\s*\([^)]*\)\s*$/, '').trim() || title;
  const nameKey = wordKey(name);
  const titleKey = wordKey(title);
  const terms = nameKey.split(' ').filter(Boolean);
  /** @type {Entry[]} */
  const near = [];
  if (terms.length) {
    for (const e of index()) {
      if (e.lib.kind !== 'wikipedia' && e.lib.id !== book.libId && terms.every((t) => e.hay.includes(t))) near.push(e);
    }
  }
  const opening = openingOf(article.blocks);
  /** @type {Entry[]} */
  const itself = [];
  /** @type {Entry[]} */
  const by = [];
  if (near.length && !listsNames(title, opening)) {
    // The book this article is about: one of its title's forms is the article's title, and the
    // article names its author.
    for (const e of near) {
      if (titleForms(e.book).some((form) => wordKey(form) === titleKey) && showsBook(title, opening, surnameOf(e.book.author))) itself.push(e);
    }
    // The books of the writer this article is about: theirs by name, each author of that name
    // told apart, and the article must show it is that one. A book joins an author's books only
    // when it is one author's with all of them, not only with the first: one with no number to
    // compare (a Wikisource's, a newer Gutenberg file's) would otherwise join two John Smiths into
    // one. It is compared with the first of each kind of id among them (idKind), since the others
    // of that kind have the same id: a writer's hundreds of books are not compared two by two.
    const called = near.filter((e) => namesOf(e.book.author).includes(nameKey));
    if (called.length) {
      const words = await readWords(article.blocks, breathe);
      /** @type {{ books: Entry[], firsts: Entry[] }[]} */
      const authors = [];
      for (const e of called) {
        const owner = authors.find((g) => g.firsts.every((m) => sameAuthor(m, e)));
        if (!owner) authors.push({ books: [e], firsts: [e] });
        else {
          owner.books.push(e);
          if (!owner.firsts.some((m) => idKind(m) === idKind(e))) owner.firsts.push(e);
        }
      }
      for (const { books: group } of authors) {
        /** @type {Sought[]} */
        const titles = [];
        for (const e of group.slice(0, MOST_TITLES)) {
          const sought = titleSought(e.book);
          if (sought && !titles.some((t) => t.key === sought.key)) titles.push(sought);
        }
        if (showsAuthor({ words, opening, matched: name, names: authorNames(group[0].book.author), titles })) by.push(...group);
      }
    }
  }
  if (!itself.length && !by.length) return say('I see no book in the library that this article is about, nor any by someone of its name.');
  const theirs = by.filter((e) => !itself.includes(e));
  /** @type {import('./ask.js').Find[]} */
  const all = [
    ...itself.map((e) => /** @type {import('./ask.js').Find} */ ({ kind: 'book', book: e.book, lib: e.lib, also: 'itself' })),
    ...theirs.map((e) => /** @type {import('./ask.js').Find} */ ({ kind: 'book', book: e.book, lib: e.lib, also: 'by' })),
  ];
  const finds = all.slice(0, MAX_FINDS);
  const parts = [
    itself.length === 1 ? 'the book this article is about' : itself.length ? `the book this article is about, ${itself.length} times` : '',
    theirs.length === 1 ? `one book by ${name}` : theirs.length ? `${theirs.length} books by ${name}` : '',
  ].filter(Boolean);
  return { text: `The library has ${listed(parts)}.${all.length > finds.length ? ` Here are the first ${finds.length}.` : ''}`, finds, search: null };
}
