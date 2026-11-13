// "Also in the library" (public/js/librarian/also.js) over real ZIM files, read as the server
// reads them: a small library written by test/helpers/also-fixtures.js (two Gutenberg files, a
// Wikisource, two Wikipedias), its catalogue, its articles found by their titles and other names,
// and its articles' blocks as the converter makes them. The same answers as with a library made
// up in test/client-librarian-also.test.js, so what the looking expects of an article's blocks, a
// Wikisource's authors and a Wikipedia's titles holds for the real ones.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lookAlso, openingOf } from '../public/js/librarian/also.js';
import { bookIndex } from '../public/js/search.js';
import { Library } from '../server/library.js';
import { writeAlsoSet } from './helpers/also-fixtures.js';

describe('"Also in the library" over ZIM files', () => {
  /** @type {string} */
  let dir;
  /** @type {Library} */
  let folder;
  /** @type {any[]} */
  let libraries;
  /** @type {Record<string, any[]>} */
  let booksByLib;
  /** @type {Map<string, any>} */
  const byId = new Map();
  const lib = (part) => libraries.find((l) => l.id.includes(part));
  const book = (part, title) => booksByLib[lib(part).id].find((b) => b.title.startsWith(title));
  const asked = { articles: 0, blocks: 0 };
  /** What the looking is given: the catalogue, each Wikipedia's article search and an article's blocks, as the page's are. */
  const access = () => ({
    libraries,
    index: () => bookIndex(libraries, booksByLib),
    articles: (l, q, limit) => {
      asked.articles++;
      return byId.get(l.id).searchArticles(q, limit);
    },
    blocksOf: async (l, id, n) => {
      asked.blocks++;
      return (await byId.get(l.id).chunk(id, n)).blocks;
    },
  });
  const brief = (answer) => answer.finds.map((f) => [f.also, f.lib.id.replace(/_2026-01$/, ''), f.kind === 'book' ? f.book.title : f.article.title]);

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'librarian-also-'));
    writeAlsoSet(dir);
    folder = await Library.scan(dir, { cacheDir: path.join(dir, '.cache'), log: () => {}, warn: () => {} });
    const open = folder.list();
    for (let t = 0; t < 400; t++) {
      const infos = await Promise.all(open.map((l) => l.info()));
      if (!infos.some((i) => i.indexing)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    libraries = await Promise.all(open.map((l) => l.info()));
    booksByLib = {};
    for (const l of open) {
      byId.set(l.id, l);
      booksByLib[l.id] = (await l.books()).map((b) => ({ ...b, libId: l.id })); // as the page's books carry their library (main.js)
    }
  });
  after(async () => {
    await folder?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads the set as two Gutenberg files, a Wikisource with its authors, and two Wikipedias', () => {
    assert.deepEqual(libraries.map((l) => `${l.id.replace(/_2026-01$/, '')} ${l.kind}`).sort(), [
      'gutenberg_en_lcc-p gutenberg', 'gutenberg_en_lcc-ps gutenberg', 'wikipedia_en_test wikipedia', 'wikipedia_en_test_mini wikipedia', 'wikisource_en_test wikisource',
    ]);
    assert.ok(libraries.every((l) => !l.indexing));
    assert.deepEqual(booksByLib[lib('wikisource').id].map((b) => `${b.title} | ${b.author}`).sort(), [
      'Adventures of Huckleberry Finn | Mark Twain', 'Beowulf | null', 'Chips from a German Workshop | Max Müller', 'Roughing It | Mark Twain',
    ]);
    assert.equal(book('lcc-p_', 'Adventures').authorId, book('lcc-ps', 'The Adventures of Tom Sawyer').authorId);
    assert.notEqual(book('lcc-p_', 'A Description').authorId, book('lcc-ps', 'Select Discourses').authorId);
    assert.equal(lib('test_mini').articles, 3); // the main page is none
  });

  it('finds an article by its title and by another name, and reads its opening from its blocks', async () => {
    const wp = byId.get(lib('wikipedia_en_test_2026').id);
    const twain = (await wp.searchArticles('Mark Twain', 4))[0];
    assert.equal(twain.title, 'Mark Twain');
    assert.deepEqual((await wp.searchArticles('Samuel Clemens', 4)).map((a) => [a.title, a.from]), [['Mark Twain', 'Samuel Clemens']]);
    const { blocks } = await wp.chunk(twain.book, twain.n);
    const opening = openingOf(blocks);
    assert.match(opening.first, /^Samuel Langhorne Clemens \(1835–1910\), known by the pen name Mark Twain, was an American writer/);
    assert.match(opening.lead, /Adventures of Huckleberry Finn \(1884\)\.$/);
    assert.ok(!/Roughing It/.test(opening.lead), 'the section under its heading is not its opening');
  });

  it('answers for a book in hand as with a library made up', async () => {
    const twain = await lookAlso({ ...access(), book: book('lcc-p_', 'Adventures') });
    assert.deepEqual(brief(twain), [
      ['author', 'wikipedia_en_test', 'Mark Twain'], ['title', 'wikipedia_en_test', 'Adventures of Huckleberry Finn'], ['same', 'wikisource_en_test', 'Adventures of Huckleberry Finn'],
      ['name', 'wikipedia_en_test_mini', 'Mark Twain'], ['other', 'gutenberg_en_lcc-ps', 'The Adventures of Tom Sawyer'],
    ]);
    assert.match(twain.text, /^Also in the library: the article on its author, the article on this book, the same work in Wikisource and 3 other books by Mark Twain\. And an article called “Mark Twain”, though nothing in it tells me it is the same person\. Here are the first 5\.$/);
    const sapir = await lookAlso({ ...access(), book: book('lcc-p_', 'Language') });
    assert.deepEqual(brief(sapir), [
      ['author', 'wikipedia_en_test', 'Edward Sapir'], ['title', 'wikipedia_en_test', 'Language (Sapir book)'], ['same', 'gutenberg_en_lcc-ps', 'Language: An Introduction to the Study of Speech'],
    ]);
    const mueller = await lookAlso({ ...access(), book: book('lcc-p_', 'Lectures') });
    assert.deepEqual(brief(mueller), [['author', 'wikipedia_en_test', 'Max Müller'], ['other', 'wikisource_en_test', 'Chips from a German Workshop']]);
    assert.equal((await lookAlso({ ...access(), book: book('lcc-p_', 'A Description') })).text, 'I see nothing else in the library on this book or its author.');
    assert.deepEqual(brief(await lookAlso({ ...access(), book: book('lcc-p_', 'Beowulf') })), [['same', 'wikisource_en_test', 'Beowulf']]);
    assert.deepEqual(brief(await lookAlso({ ...access(), book: book('lcc-p_', 'Poems') })), [['name', 'wikipedia_en_test_mini', 'Ann Nobody']]);
    // From the Wikisource's copy: the articles, and the Gutenberg files' books.
    const roughing = await lookAlso({ ...access(), book: book('wikisource', 'Roughing It') });
    assert.deepEqual(brief(roughing).slice(0, 3), [['author', 'wikipedia_en_test', 'Mark Twain'], ['title', 'wikipedia_en_test', 'Roughing It'], ['name', 'wikipedia_en_test_mini', 'Mark Twain']]);
  });

  it('answers from a Wikipedia\'s article with the books themselves', async () => {
    const wp = byId.get(lib('wikipedia_en_test_2026').id);
    const volume = booksByLib[wp.id][0];
    const at = async (title) => {
      const a = (await wp.searchArticles(title, 4)).find((x) => x.title === title);
      return { title, blocks: (await wp.chunk(a.book, a.n)).blocks };
    };
    const before = { ...asked };
    const twain = await lookAlso({ ...access(), book: volume, article: await at('Mark Twain') });
    assert.equal(twain.text, 'The library has 6 books by Mark Twain. Here are the first 5.');
    assert.ok(twain.finds.every((f) => f.also === 'by' && f.kind === 'book' && f.book.author === 'Mark Twain'));
    const huck = await lookAlso({ ...access(), book: volume, article: await at('Adventures of Huckleberry Finn') });
    assert.deepEqual(brief(huck), [['itself', 'gutenberg_en_lcc-p', 'Adventures of Huckleberry Finn'], ['itself', 'wikisource_en_test', 'Adventures of Huckleberry Finn']]);
    const nothing = 'I see no book in the library that this article is about, nor any by someone of its name.';
    assert.equal((await lookAlso({ ...access(), book: volume, article: await at('Language') })).text, nothing);
    assert.equal((await lookAlso({ ...access(), book: volume, article: await at('John Smith') })).text, nothing);
    assert.deepEqual(asked, before, 'the catalogue and the open article are all it reads');
    assert.match((await lookAlso({ ...access(), book: volume, article: null })).text, /^Ask me this at an article/);
  });

  it('is counted over a folder by tools/librarian-also.mjs, each article offered kept with how it opens', () => {
    const out = path.join(dir, 'offered.json');
    const tool = fileURLToPath(new URL('../tools/librarian-also.mjs', import.meta.url));
    const printed = execFileSync(process.execPath, [tool, '--dir', dir, '--books', 'all', '--articles', '20', '--cache', path.join(dir, '.cache'), '--out', out], { encoding: 'utf8' });
    const line = (name) => printed.split('\n').find((l) => l.startsWith(name))?.trim().split(/\s{2,}/) ?? [];
    // books, with an article on the author, of the author's name only, on the book, the same work, other books
    assert.deepEqual(line('gutenberg_en_lcc-p '), ['gutenberg_en_lcc-p', '7', '4', '3', '2', '3', '3']);
    assert.deepEqual(line('in all'), ['in all', '15', '9', '8', '5', '6', '8']);
    assert.deepEqual(line('wikipedia_en_test '), ['wikipedia_en_test', '9', '3', '3']); // articles, on a book, on a writer
    const { offered } = JSON.parse(fs.readFileSync(out, 'utf8'));
    const twain = offered.find((o) => o.what === 'author' && o.book === 'Adventures of Huckleberry Finn' && o.from === 'gutenberg_en_lcc-p');
    assert.deepEqual([twain.lib, twain.title, twain.author], ['wikipedia_en_test', 'Mark Twain', 'Mark Twain']);
    assert.match(twain.opens, /^Samuel Langhorne Clemens/);
    assert.ok(offered.some((o) => o.what === 'name' && o.title === 'Ann Nobody'));
    assert.ok(offered.some((o) => o.what === 'itself' && o.article === 'Adventures of Huckleberry Finn'));
    assert.ok(!offered.some((o) => o.title === 'Language' || o.title === 'John Smith'), 'neither the word\'s article nor the list of names');
  });
});
