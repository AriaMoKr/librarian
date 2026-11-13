#!/usr/bin/env node
/**
 * "Also in the library", counted (docs/LIBRARIAN.md, experiment 3 step 3): over folders of ZIMs,
 * what the Librarian finds in the other libraries for each book: the article on its author, the
 * article on the book, the same work elsewhere and the author's other books, by the rule the page
 * uses (public/js/librarian/also.js), read as the server reads the files (server/library.js, in
 * this process). Nothing is sent anywhere.
 *
 *   node tools/librarian-also.mjs [--dir <folder of ZIMs>]… [--books 200] [--articles 0]
 *     [--out <file>] [--cache <folder>]
 *
 * Without --dir: the demo set as the Pages workflow keeps it (.demo/render and .demo/files), which
 * has no such links: use it on a collection that has (a Gutenberg file beside a general
 * Wikipedia or a Wikisource).
 * Prints a line per library of books: how many of its books were looked at (--books of them,
 * evenly spread; "all" for every one), and how many had an article on their author (shown to be
 * theirs), an article of the author's name only, an article on the book, the same work in
 * another library, and other books of the author's there. With --articles <n>, a line per
 * Wikipedia too: of n of its articles, evenly spread, how many are on a book the library has, or
 * on a writer it has books by.
 * --out keeps every article offered with what it was offered for and how it opens, to read by
 * hand: whether the article on "its author" is on that author, and the article on "this book" on
 * that book. --cache is where the libraries' indexes are kept (default: .cache here).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Library } from '../server/library.js';
import { lookAlso, openingOf } from '../public/js/librarian/also.js';
import { bookIndex } from '../public/js/search.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    dir: { type: 'string', multiple: true },
    books: { type: 'string', default: '200' },
    articles: { type: 'string', default: '0' },
    out: { type: 'string' },
    cache: { type: 'string' },
  },
});
const dirs = values.dir?.length ? values.dir : [path.join(ROOT, '.demo', 'render'), path.join(ROOT, '.demo', 'files')].filter((d) => fs.existsSync(d));
if (!dirs.length) {
  console.error('usage: node tools/librarian-also.mjs [--dir <folder of ZIMs>]… [--books 200|all] [--articles 0] [--out <file>] [--cache <folder>]\n'
    + '(without --dir: the demo set in .demo/render and .demo/files, which are not here)');
  process.exit(2);
}
const BOOKS = values.books === 'all' ? Infinity : Math.max(1, Number(values.books) || 200);
const ARTICLES = Math.max(0, Number(values.articles) || 0);
const t0 = Date.now();
/** A library's id without its edition. */
const undated = (id) => id.replace(/_\d{4}-\d{2}$/, '');
/** n of a list, evenly spread. */
const spread = (list, n) => (list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]));

// The libraries, opened as the server opens a folder (their indexes built on a first open).
const scan = { log: () => {}, warn: (m) => console.error(m), ...(values.cache ? { cacheDir: values.cache } : {}) };
const folders = await Promise.all(dirs.map((d) => Library.scan(d, scan)));
const open = folders.flatMap((f) => f.list());
for (let waited = 0; ; waited++) {
  const infos = await Promise.all(open.map((l) => l.info()));
  const busy = infos.filter((i) => i.indexing);
  if (!busy.length) break;
  if (waited % 20 === 0) console.error(`waiting for ${busy.length} ${busy.length === 1 ? 'index' : 'indexes'}…`);
  await new Promise((r) => setTimeout(r, 500));
}
const libraries = await Promise.all(open.map((l) => l.info()));
const byId = new Map(open.map((l) => [l.id, l]));
/** @type {Record<string, any[]>} */
const booksByLib = {};
for (const l of open) booksByLib[l.id] = (await l.books()).map((b) => ({ ...b, libId: l.id })); // as the page's books carry their library
const access = {
  libraries,
  index: () => bookIndex(libraries, booksByLib),
  articles: (lib, q, limit) => byId.get(lib.id).searchArticles(q, limit),
  blocksOf: async (lib, id, n) => (await byId.get(lib.id).chunk(id, n)).blocks,
};
const wikis = libraries.filter((l) => l.kind === 'wikipedia');
console.log(`"Also in the library" over ${libraries.length} ${libraries.length === 1 ? 'library' : 'libraries'} (${wikis.length} with articles)`);

/** Every article offered, to read by hand. */
const offered = [];
const cut = (s, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);
const row = (cells, widths) => cells.map((c, i) => (i ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i]))).join('  ');
const W = [44, 7, 8, 10, 8, 10, 12];
console.log(`\n${row(['library', 'books', 'author', 'name only', 'book', 'same work', 'other books'], W)}`);
const total = { books: 0, author: 0, name: 0, title: 0, same: 0, other: 0 };
for (const lib of libraries.filter((l) => l.kind !== 'wikipedia')) {
  const books = spread(booksByLib[lib.id], BOOKS);
  const n = { author: 0, name: 0, title: 0, same: 0, other: 0 };
  for (const book of books) {
    const answer = await lookAlso({ ...access, book });
    const kinds = new Set(answer.finds.map((f) => f.also));
    for (const k of Object.keys(n)) if (kinds.has(k)) n[k]++;
    for (const f of answer.finds) {
      if (f.kind !== 'article') continue;
      const blocks = await access.blocksOf(f.lib, f.article.book, f.article.n).catch(() => []);
      offered.push({ what: f.also, from: undated(lib.id), book: book.title, author: book.author ?? null, lib: undated(f.lib.id), title: f.article.title, opens: cut(openingOf(blocks).first) });
    }
  }
  console.log(row([undated(lib.id), books.length, n.author, n.name, n.title, n.same, n.other], W));
  total.books += books.length;
  for (const k of Object.keys(n)) total[k] += n[k];
}
console.log(row(['in all', total.books, total.author, total.name, total.title, total.same, total.other], W));

// From articles: the books themselves.
if (ARTICLES && wikis.length) {
  console.log(`\n${row(['library', 'articles', 'on a book', 'on a writer'], [44, 9, 10, 12])}`);
  for (const lib of wikis) {
    const l = byId.get(lib.id);
    const titles = (await l.articleTitles()).titles;
    const volumes = booksByLib[lib.id];
    const size = Math.max(1, Math.ceil(titles.length / Math.max(1, volumes.length)));
    let itself = 0;
    let by = 0;
    const picked = spread(titles.map((title, i) => ({ title, i })), ARTICLES);
    for (const { title, i } of picked) {
      const volume = volumes[Math.floor(i / size)];
      if (!volume) continue;
      const blocks = (await l.chunk(volume.id, i % size).catch(() => null))?.blocks;
      if (!blocks) continue;
      const answer = await lookAlso({ ...access, book: volume, article: { title, blocks } });
      const kinds = new Set(answer.finds.map((f) => f.also));
      if (kinds.has('itself')) itself++;
      if (kinds.has('by')) by++;
      for (const f of answer.finds.slice(0, 1)) offered.push({ what: f.also, from: undated(lib.id), article: title, lib: undated(f.lib.id), book: f.kind === 'book' ? f.book.title : null, author: f.kind === 'book' ? f.book.author ?? null : null, opens: cut(openingOf(blocks).first) });
    }
    console.log(row([undated(lib.id), picked.length, itself, by], [44, 9, 10, 12]));
  }
}

console.log(`\n${total.books} books looked at in ${((Date.now() - t0) / 1000).toFixed(1)} s; ${offered.filter((o) => o.what === 'author').length} articles offered as on an author, `
  + `${offered.filter((o) => o.what === 'title').length} as on a book, ${offered.filter((o) => o.what === 'name').length} of an author's name only.`);
if (values.out) {
  fs.writeFileSync(values.out, `${JSON.stringify({ made: new Date().toISOString(), dirs: dirs.map((d) => path.basename(d)), offered }, null, 1)}\n`);
  console.log(`${offered.length} of them written to ${values.out}, to read by hand.`);
}
await Promise.all(folders.map((f) => f.close()));
