// @ts-check
// "Mentioned here" (docs/LIBRARIAN.md, experiment 3 step 2; SPEC §5.10): asked while a book is
// open, the librarian tells which articles of other libraries its open pages name, by the rule
// for links between libraries (xref.js). Each is a find to be taken to: the article comes into
// the reader's hands as a link's page does, and Back brings the book back at its page
// (librarian.js: interaction.followTo).
// What stands is told from the text round the pages (a mention's company may stand on the page
// before), what is offered from the pages themselves, in their order. The titles are the
// libraries' own, kept at hand (titles.js) and got only once someone asks. Pure but for what it
// is given (tested in Node); the button and its list are here-panel.js.

import { isPage } from '../reader/spreads.js';
import { MAX_FINDS } from './ask.js';
import { matchesIn, mentionsIn, NEAR, windowOf } from './xref.js';

/**
 * @typedef {object} PagePart the open pages' blocks in one part (chunk) of the book
 * @property {number} c the part
 * @property {number} first the first block some of which is on the pages
 * @property {number} last the last
 */

/**
 * The parts of the book the pages shown are in, with their blocks there, and how many pages that
 * is (a spread's one or two).
 * @param {{ left?: unknown, right?: unknown } | null | undefined} spread the spread shown
 *   (interaction.spreadShown)
 * @param {{ blocksOn(ref: any): { first: number, last: number } | null }} reader the open book's
 * @returns {{ parts: PagePart[], pages: number }}
 */
export function partsOf(spread, reader) {
  /** @type {PagePart[]} */
  const parts = [];
  let pages = 0;
  for (const ref of [spread?.left, spread?.right]) {
    if (!isPage(ref)) continue;
    pages++;
    const on = reader.blocksOn(ref);
    if (!on) continue;
    const c = /** @type {{ c: number }} */ (ref).c;
    const had = parts.find((p) => p.c === c);
    if (had) {
      had.first = Math.min(had.first, on.first);
      had.last = Math.max(had.last, on.last);
    } else parts.push({ c, first: on.first, last: on.last });
  }
  return { parts, pages };
}

/**
 * The mentions on pages (xref.js's rule): the matches on the blocks `first` to `last` of a part
 * that stand, told from the text round them, in the pages' order, each with where it first stands
 * on them (`block`, `blocks`: the part's) and the words round it there.
 * @param {any[]} blocks the part's blocks
 * @param {number} first
 * @param {number} last
 * @param {{ get(key: string): import('./xref.js').Entry[] | undefined }} titles
 * @param {{ own?: string | null }} [options] own: the id of the book's own library
 * @returns {import('./xref.js').Mention[]}
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

/** Names in a row: "A", "A and B", "A, B and C". @param {string[]} names */
const listed = (names) => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/**
 * @typedef {import('./titles.js').Lib & { title?: string }} Lib
 */

/**
 * @typedef {object} Here what "Mentioned here" reads
 * @property {{ libId: string, id: string }} book the open book
 * @property {PagePart[]} parts the open pages' blocks (partsOf)
 * @property {number} pages how many pages are open
 * @property {(c: number) => Promise<any[]>} blocksOf a part's blocks
 * @property {Lib[]} libraries the catalogue's
 * @property {import('./titles.js').TitleShelf} shelf the libraries' titles
 * @property {(step: string) => void} [onStep] told what he is doing meanwhile
 */

/**
 * Answers "what do these pages mention?": the articles of other libraries the open pages name, at
 * most MAX_FINDS of them as finds, in the pages' order.
 * @param {Here} o
 * @returns {Promise<import('./ask.js').Answer>}
 */
export async function lookHere({ book, parts, pages, blocksOf, libraries, shelf, onStep = () => {} }) {
  const these = pages === 1 ? 'this page' : 'these pages';
  /** @param {string} text @returns {import('./ask.js').Answer} */
  const say = (text) => ({ text, finds: [], search: null });
  const name = (/** @type {Lib} */ l) => String(l.title ?? l.id);
  const own = libraries.find((l) => l.id === book.libId) ?? null;
  const others = libraries.filter((l) => l.id !== book.libId && l.kind === 'wikipedia');
  if (!others.length) return say('No other library here has articles for me to look in.');
  // Its own library's articles are its own links': their titles tell which words are no link to
  // another library.
  const ownToo = own?.kind === 'wikipedia' ? own : null;
  if (ownToo && !shelf.canHold(ownToo)) return say(`${name(ownToo)} is too large for me to tell what its pages name elsewhere.`);
  const usable = others.filter((l) => shelf.canHold(l));
  const indexing = others.filter((l) => l.indexing);
  const large = others.filter((l) => !l.indexing && !shelf.canHold(l));
  /** What was not looked in, and why. */
  const left = () => [
    large.length ? ` ${listed(large.map(name))} ${large.length > 1 ? 'are' : 'is'} too large for me to look in.` : '',
    indexing.length ? ` ${listed(indexing.map(name))} ${indexing.length > 1 ? 'are' : 'is'} still being indexed.` : '',
  ].join('');
  if (!usable.length) return say(`I cannot look in the other libraries here.${left()}`);

  const titles = await shelf.of(ownToo ? [...usable, ownToo] : usable, {
    onGetting: (libs) => onStep(libs.length === 1 ? `Getting the titles of ${name(libs[0])}…` : `Getting the titles of ${libs.length} libraries…`),
  });
  const failed = titles.failed.map(name);
  if (ownToo && titles.failed.includes(ownToo)) return say(`I could not get the titles of ${name(ownToo)}, so I cannot tell what its pages name elsewhere.`);
  if (titles.failed.length === usable.length + (ownToo ? 1 : 0)) return say(`I could not get the titles of ${listed(failed)}.`);
  onStep(pages === 1 ? 'Reading this page…' : 'Reading these pages…');

  /** @type {Map<string, import('./xref.js').Mention>} */
  const found = new Map();
  for (const part of parts) {
    const blocks = await blocksOf(part.c);
    for (const m of mentionsOn(blocks, part.first, part.last, titles, { own: ownToo?.id ?? null })) {
      if (!found.has(m.key)) found.set(m.key, m);
    }
  }
  /** @type {import('./ask.js').Find[]} */
  const finds = [];
  for (const m of found.values()) {
    if (finds.length >= MAX_FINDS) break;
    const to = titles.articleOf(m.entries[0]);
    if (to) finds.push({ kind: 'article', article: to.article, lib: to.lib, mention: { text: m.text, context: m.context } });
  }
  const n = found.size;
  const These = `${these[0].toUpperCase()}${these.slice(1)}`;
  const verb = pages === 1 ? 'names' : 'name';
  const text = !n ? `I see nothing on ${these} that another library has an article on.`
    : n === 1 ? `${These} ${verb} one article of another library.`
      : `${These} ${verb} ${n} articles of other libraries${n > finds.length ? `; here are the first ${finds.length}` : ''}.`;
  const notGot = failed.length ? ` I could not get the titles of ${listed(failed)}.` : '';
  return { text: `${text}${notGot}${left()}`, finds, search: null };
}
