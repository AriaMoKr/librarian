// "Also in the library" (public/js/librarian/also.js, SPEC §5.10; docs/LIBRARIAN.md, experiment 3
// step 3): what the other libraries have on the book in hand. How a title is known in an article
// and what shows that an article is on an author or on a book; whose the catalogue's books are and
// which are one work; his answer for a book (the articles on its author and on itself, the same
// work elsewhere, the author's other books), for a work with no author, for two authors of one
// name, and from a Wikipedia's article (the books themselves); what he asks of the libraries; a
// find's lines, and a find taken to. The button and its list are checked in a browser.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALSO, findLines, MAX_FINDS } from '../public/js/librarian/ask.js';
import {
  listsNames, lookAlso, namesTitle, openingOf, readWords, runsOf, sameAuthor, sameWords, showsAuthor, showsBook, titleSought, wordKey, wordsIn, wordsOf, workKey,
} from '../public/js/librarian/also.js';
import { volumeOf } from '../public/js/librarian/xref.js';
import { fold } from '../public/js/search.js';
import './helpers/vendor.js'; // librarian.js → desk.js → the page's ../../vendor/common/panel.js

const { takeThere } = await import('../public/js/librarian/librarian.js');

const p = (...runs) => ({ t: 'p', r: runs.map((r) => (typeof r === 'string' ? [r, 0] : r)) });
const h = (l, text) => ({ t: 'h', l, r: [[text, 0]] });
const li = (text) => ({ t: 'li', r: [[text, 0]], d: 1, m: '•' });

// ------------------------------------------------------------------------------------------------
// A small library: two Gutenberg files, a Wikisource and two Wikipedias.

const pg = { id: 'pg', kind: 'gutenberg', title: 'Gutenberg · Language' };
const all = { id: 'all', kind: 'gutenberg', title: 'Gutenberg · every book' };
const ws = { id: 'ws', kind: 'wikisource', title: 'Wikisource' };
const wp = { id: 'wp', kind: 'wikipedia', title: 'Wikipedia', articles: 9 };
const mini = { id: 'mini', kind: 'wikipedia', title: 'Wikipedia (introductions)', articles: 3 };
const libraries = [pg, all, ws, wp, mini];

const book = (lib, id, title, author, authorId = null, more = {}) => ({ id: String(id), libId: lib.id, title, author, authorId, readable: true, ...more });
const BOOKS = {
  pg: [
    book(pg, 12629, 'Language: An Introduction to the Study of Speech', 'Edward Sapir', '4464'),
    book(pg, 32856, 'Lectures on the Science of Language', 'F. Max (Friedrich Max) Müller', '787'),
    book(pg, 76, 'Adventures of Huckleberry Finn', 'Mark Twain', '53'),
    book(pg, 119, 'A Tramp Abroad — Volume 1', 'Mark Twain', '53'),
    book(pg, 16328, 'Beowulf', 'Anonymous', '216'),
    book(pg, 500, 'A Description of New England', 'John Smith', '1'),
    book(pg, 600, 'Poems', 'Ann Nobody', '9'),
  ],
  all: [
    book(all, 12629, 'Language: An Introduction to the Study of Speech', 'Edward Sapir', '4464'),
    book(all, 74, 'The Adventures of Tom Sawyer', 'Mark Twain', '53'),
    book(all, 5782, 'A Tramp Abroad — Volume 2', 'Mark Twain', '53'),
    book(all, 700, 'Select Discourses', 'John Smith', '2'),
  ],
  ws: [
    book(ws, 'Adventures_of_Huckleberry_Finn', 'Adventures of Huckleberry Finn', 'Mark Twain'),
    book(ws, 'Roughing_It', 'Roughing It', 'Mark Twain'),
    book(ws, 'Beowulf', 'Beowulf', null),
    book(ws, 'Chips', 'Chips from a German Workshop', 'Max Müller'),
  ],
  wp: [{ id: 'v1', libId: 'wp', title: 'A – Z', author: null }],
  mini: [{ id: 'v1', libId: 'mini', title: 'A – Z', author: null }],
};
/** The catalogue's index, as search.js bookIndex makes it. */
const index = () => libraries.flatMap((lib) => BOOKS[lib.id].map((b) => ({ book: b, lib, hay: fold(`${b.title} ${b.author || ''}`), title: fold(b.title) })));

/** Each Wikipedia's articles, in its order: [title, blocks, another name]. */
const ARTICLES = {
  wp: [
    ['Adventures of Huckleberry Finn', [h(1, 'Adventures of Huckleberry Finn'), p('Adventures of Huckleberry Finn is a picaresque novel by American author Mark Twain, first published in 1884.'), h(2, 'Plot'), p('Huck runs away.')]],
    ['Edward Sapir', [h(1, 'Edward Sapir'), p('Edward Sapir (1884–1939) was an American anthropologist-linguist.'), h(2, 'Works'), li('Language: An Introduction to the Study of Speech (1921)')]],
    ['John Smith', [h(1, 'John Smith'), p('John Smith may refer to:'), li('John Smith (explorer) (1580–1631), of Jamestown'), li('John Smith (Platonist) (1618–1652), who wrote the Select Discourses')]],
    ['Language', [h(1, 'Language'), p('Language is a structured system of communication that consists of grammar and vocabulary.'), h(2, 'Study'), p('Edward Sapir wrote a book on it, and so did Otto Jespersen.')]],
    ['Language (Sapir book)', [h(1, 'Language (Sapir book)'), p('Language: An Introduction to the Study of Speech is a 1921 work on linguistics.')]],
    ['Mark Twain', [h(1, 'Mark Twain'), p('Samuel Langhorne Clemens (1835–1910), known by the pen name Mark Twain, was an American writer.'), p('His novels include The Adventures of Tom Sawyer and its sequel, Adventures of Huckleberry Finn.')], 'Samuel Clemens'],
    ['Max Müller', [h(1, 'Max Müller'), p('Friedrich Max Müller (1823–1900) was a German-born British philologist and Orientalist.'), h(2, 'Life'), p('He lived in Oxford.')]],
    ['Relativity', [h(1, 'Relativity'), p('The theory of relativity usually encompasses two theories by Albert Einstein, proposed and published in 1905 and 1915.')]],
    ['Roughing It', [h(1, 'Roughing It'), p('Roughing It is a book of semi-autobiographical travel literature by Mark Twain.')]],
  ],
  mini: [
    ['Ann Nobody', [h(1, 'Ann Nobody'), p('Ann Nobody (born 1970) is a Canadian curler.')]],
    ['Mark Twain', [h(1, 'Mark Twain'), p('Samuel Langhorne Clemens, known by the pen name Mark Twain, was an American writer, humorist and essayist.')]],
    ['Robert Gordon Latham', [h(1, 'Robert Gordon Latham'), p('Robert Gordon Latham (1812–1888) was an English ethnologist and philologist.')]],
  ],
};

/** The libraries as the looking asks them, counted: an article search by prefix or other name, an article's blocks. */
function access({ fail = [] } = {}) {
  const calls = { articles: [], blocks: [] };
  return {
    calls,
    libraries,
    index,
    articles: async (lib, q, limit) => {
      calls.articles.push(`${lib.id}: ${q}`);
      if (fail.includes(lib.id)) throw new Error('no answer');
      const s = fold(q);
      return ARTICLES[lib.id]
        .map(([title, , from], n) => (fold(title).startsWith(s) ? { title, book: 'v1', n } : from && fold(from) === s ? { title, book: 'v1', n, from } : null))
        .filter(Boolean).slice(0, limit);
    },
    blocksOf: async (lib, bookId, n) => {
      calls.blocks.push(`${lib.id}: ${ARTICLES[lib.id][n][0]}`);
      return ARTICLES[lib.id][n][1];
    },
  };
}
const inHand = (lib, title) => BOOKS[lib.id].find((b) => b.title.startsWith(title));
const brief = (answer) => answer.finds.map((f) => [f.also, f.lib.id, f.kind === 'book' ? f.book.title : f.article.title]);

describe('names and titles as words', () => {
  it('parts a text at everything but a letter, a digit and an apostrophe inside', () => {
    assert.deepEqual(wordsOf('Moby-Dick; or, The Whale'), ['Moby', 'Dick', 'or', 'The', 'Whale']);
    assert.deepEqual(wordsOf('Adam’s apple (1921)'), ["Adam's", 'apple', '1921']);
    assert.equal(wordKey('F. Max Müller'), 'f max muller');
    assert.ok(sameWords('Moby Dick', 'Moby-Dick') && sameWords('Max Müller', 'max muller'));
    assert.ok(!sameWords('Max Müller', 'Friedrich Max Müller') && !sameWords('', ''));
  });

  it('finds a run of words among a text\'s, never across two blocks', () => {
    const words = wordsIn(['He wrote Roughing It', 'It was Roughing', 'It again; then Roughing it once more.']);
    assert.deepEqual(runsOf(words, 'roughing it'), [2, 12]);
    assert.deepEqual([words.raw[2], words.raw[3], words.raw[4]], ['Roughing', 'It', '|']);
    assert.deepEqual(runsOf(words, 'it'), [3, 5, 9, 13]);
    assert.deepEqual(runsOf(words, 'nothing here'), []);
    assert.deepEqual(runsOf(words, ''), []);
  });

  it('reads an article\'s words block by block, pausing where frames must go on', async () => {
    const blocks = Array.from({ length: 400 }, (_, i) => p(`Paragraph ${i} of many, with words enough to take a while.`));
    let pauses = 0;
    const words = await readWords(blocks, async () => { pauses++; });
    assert.ok(pauses >= 1);
    assert.equal(runsOf(words, 'paragraph 399 of many').length, 1);
    assert.deepEqual((await readWords(blocks)).low, words.low);
    // A table's cells and headings are read; a picture in a line is no word.
    const table = await readWords([{ t: 'tr', c: [[['Notable work', 0]], [['Roughing It', 0]]] }, { t: 'p', r: [['a ', 0], ['pic', 0, { src: 'x.png', w: 1, h: 1 }], [' b', 0]] }, { t: 'pre', x: 'code here' }]);
    assert.deepEqual(table.raw, ['Notable', 'work', 'Roughing', 'It', '|', 'a', 'b', '|']);
  });
});

describe('an article\'s opening', () => {
  it('is its paragraphs before the first heading under its title', () => {
    const o = openingOf(ARTICLES.wp[5][1]);
    assert.match(o.first, /^Samuel Langhorne Clemens/);
    assert.match(o.lead, /Clemens.*\| His novels include/);
    const sapir = openingOf(ARTICLES.wp[1][1]);
    assert.equal(sapir.lead, sapir.first);
    assert.ok(!/Language: An/.test(sapir.lead));
    // No title heading; a heading before any text; short lines are no first paragraph.
    assert.equal(openingOf([p('A long enough first paragraph of an article.'), h(2, 'More'), p('Later.')]).lead, 'A long enough first paragraph of an article.');
    assert.deepEqual(openingOf([h(1, 'T'), h(2, 'Quick facts'), p('Born 1900 in a town somewhere far away.')]), { first: '', lead: '' });
    assert.equal(openingOf([li('Short'), p('The first paragraph that says what the thing is.')]).first, 'The first paragraph that says what the thing is.');
    assert.deepEqual(openingOf([]), { first: '', lead: '' });
  });

  it('tells a page that only lists what a name may refer to', () => {
    assert.ok(listsNames('John Smith', openingOf(ARTICLES.wp[2][1])));
    assert.ok(listsNames('Mercury (disambiguation)', { first: '', lead: '' }));
    assert.ok(!listsNames('Mark Twain', openingOf(ARTICLES.wp[5][1])));
  });
});

describe('a book\'s title in an article', () => {
  const sought = (title, author = 'Some One') => titleSought({ id: '1', title, author });

  it('is looked for by its words, as a title where they are few', () => {
    assert.deepEqual(sought('Adventures of Huckleberry Finn', 'Mark Twain'), { key: 'adventures of huckleberry finn', n: 4, strict: false });
    assert.deepEqual(sought('Language: An Introduction to the Study of Speech'), { key: 'language', n: 1, strict: true });
    assert.deepEqual(sought('Lectures on the Science of Language'), { key: 'lectures on the science of language', n: 6, strict: true });
    assert.deepEqual(sought('Common Sense'), { key: 'common sense', n: 2, strict: true });
    assert.deepEqual(sought('A Tramp Abroad — Volume 1'), { key: 'a tramp abroad', n: 3, strict: true });
  });

  it('tells nothing when it is words many titles share, the author\'s own name, or one short word', () => {
    assert.equal(sought('Poems'), null);
    assert.equal(sought('Emma'), null);
    assert.equal(sought('The Works of Edgar Allan Poe — Volume 1', 'Edgar Allan Poe'), null);
    assert.equal(sought('Letters of Jane Austen', 'Jane Austen'), null);
    assert.equal(sought('The Complete Poetical Works'), null);
    assert.ok(sought('Walden'));
  });

  it('is named where its words stand in a row, with its capitals when they are few', () => {
    const text = wordsIn(['It was plain common sense, he said.', 'His pamphlet Common Sense sold widely, as did the adventures of Huckleberry Finn and Moby-Dick.']);
    assert.ok(namesTitle(text, sought('Common Sense')));
    assert.ok(!namesTitle(wordsIn(['It was plain common sense, he said.']), sought('Common Sense')));
    assert.ok(namesTitle(text, sought('Adventures of Huckleberry Finn')), 'three words of its own: whatever their case');
    assert.ok(namesTitle(text, sought('Moby Dick; or, The Whale')), 'a hyphen parts words');
    assert.ok(!namesTitle(text, sought('Roughing It')));
    // A little word of the title may be written either way; the others as a title.
    assert.ok(namesTitle(wordsIn(['See A Tramp Abroad and On liberty']), sought('A tramp abroad')));
    assert.ok(!namesTitle(wordsIn(['He was a tramp abroad for years.']), sought('A Tramp Abroad')));
  });
});

describe('whose an article is', () => {
  const twain = { names: ['Mark Twain'], titles: [titleSought(BOOKS.pg[2]), titleSought(BOOKS.pg[3])] };
  const of = async (blocks) => ({ words: await readWords(blocks), opening: openingOf(blocks) });

  it('an author\'s, when it names a book of theirs, gives their fuller name, or has three names spelled out', async () => {
    assert.equal(showsAuthor({ ...(await of(ARTICLES.wp[5][1])), matched: 'Mark Twain', ...twain }), 'title');
    assert.equal(showsAuthor({ ...(await of(ARTICLES.mini[1][1])), matched: 'Mark Twain', ...twain }), null, 'a writer of that name, but nothing of theirs');
    const mueller = { names: ['Friedrich Max Müller', 'F. Max Müller', 'Max Müller'], titles: [] };
    assert.equal(showsAuthor({ ...(await of(ARTICLES.wp[6][1])), matched: 'Max Müller', ...mueller }), 'fuller');
    assert.equal(showsAuthor({ ...(await of([p('Max Müller (born 1990) is a footballer from Graz.')])), matched: 'Max Müller', ...mueller }), null);
    assert.equal(showsAuthor({ ...(await of(ARTICLES.mini[2][1])), matched: 'Robert Gordon Latham', names: ['Robert Gordon Latham', 'R. G. Latham'], titles: [] }), 'names');
    // An initial is no name spelled out.
    assert.equal(showsAuthor({ ...(await of([p('R. G. Latham was a writer of some note in his day.')])), matched: 'R. G. Latham', names: ['R. G. Latham'], titles: [] }), null);
  });

  it('a book\'s, when its title names the author or its first paragraph names them and says it is a work', () => {
    assert.ok(showsBook('Adventures of Huckleberry Finn', openingOf(ARTICLES.wp[0][1]), 'Twain'));
    assert.ok(showsBook('Language (Sapir book)', openingOf(ARTICLES.wp[4][1]), 'Sapir'), 'the title says whose');
    assert.ok(!showsBook('Language', openingOf(ARTICLES.wp[3][1]), 'Sapir'), 'the author named only further down');
    assert.ok(!showsBook('Relativity', openingOf(ARTICLES.wp[7][1]), 'Einstein'), 'theirs, but no written work');
    assert.ok(showsBook('Roughing It', openingOf(ARTICLES.wp[8][1]), 'Twain'));
    assert.ok(!showsBook('Roughing It', openingOf(ARTICLES.wp[8][1]), 'Harte'));
    assert.ok(!showsBook('Roughing It', openingOf(ARTICLES.wp[8][1]), ''), 'no author to go by');
    assert.ok(!showsBook('The Twain Shall Meet', openingOf([p('The twain shall meet is a book about rivers meeting.')]), 'Twain'), 'a name has its capital');
  });
});

describe('the catalogue\'s books', () => {
  const e = (lib, title) => ({ book: inHand(lib, title), lib });

  it('are one author\'s by Gutenberg\'s number between its files, else by a name they share', () => {
    assert.ok(sameAuthor(e(pg, 'Adventures'), e(all, 'The Adventures of Tom Sawyer')));
    assert.ok(!sameAuthor(e(pg, 'A Description'), e(all, 'Select Discourses')), 'two John Smiths, told apart by their numbers');
    assert.ok(sameAuthor(e(pg, 'Adventures'), e(ws, 'Roughing It')));
    assert.ok(sameAuthor(e(pg, 'Lectures'), e(ws, 'Chips')), 'F. Max (Friedrich Max) Müller is Max Müller');
    assert.ok(!sameAuthor(e(pg, 'Beowulf'), e(ws, 'Beowulf')), 'no one is no author');
    assert.ok(!sameAuthor(e(pg, 'Language'), e(ws, 'Roughing It')));
  });

  it('are one work by their title without a subtitle, and their volume', () => {
    assert.equal(workKey(inHand(pg, 'Language')), 'language');
    assert.equal(workKey(inHand(pg, 'A Tramp Abroad')), 'a tramp abroad #1');
    assert.notEqual(workKey(inHand(pg, 'A Tramp Abroad')), workKey(inHand(all, 'A Tramp Abroad')));
    assert.equal(workKey(inHand(pg, 'Adventures')), workKey(inHand(ws, 'Adventures')));
    assert.deepEqual(['Introduction to the science of language, Volume 1 (of 2)', 'My Life — Volume 2', 'Essays (Vol. 3)', 'Faust — Part II', 'The Jungle Book 2', 'Emma'].map(volumeOf), ['1', '2', '3', 'ii', '', '']);
  });
});

describe('his answer for a book in hand', () => {
  it('has the articles on its author and on the book, the same work elsewhere, and the author\'s other books', async () => {
    const a = access();
    const steps = [];
    const answer = await lookAlso({ ...a, book: inHand(pg, 'Adventures'), onStep: (s) => steps.push(s) });
    assert.deepEqual(brief(answer), [
      ['author', 'wp', 'Mark Twain'], ['title', 'wp', 'Adventures of Huckleberry Finn'], ['same', 'ws', 'Adventures of Huckleberry Finn'],
      ['name', 'mini', 'Mark Twain'], ['other', 'all', 'The Adventures of Tom Sawyer'],
    ]);
    assert.equal(answer.text, 'Also in the library: the article on its author, the article on this book, the same work in Wikisource and 3 other books by Mark Twain. '
      + 'And an article called “Mark Twain”, though nothing in it tells me it is the same person. Here are the first 5.');
    assert.equal(answer.finds.length, MAX_FINDS);
    assert.deepEqual(steps, ['Looking in 2 libraries…']);
    assert.equal(answer.search, null);
    // Asked of the Wikipedias only, by the author's name and the title's forms; the articles found are read once.
    // One search by the name and one by the title, of each Wikipedia: the title's forms are among
    // what begins with it.
    assert.deepEqual([...a.calls.articles].sort(), ['mini: Adventures of Huckleberry Finn', 'mini: Mark Twain', 'wp: Adventures of Huckleberry Finn', 'wp: Mark Twain']);
    assert.deepEqual([...a.calls.blocks].sort(), ['mini: Mark Twain', 'wp: Adventures of Huckleberry Finn', 'wp: Mark Twain']);
  });

  it('asks for a title\'s forms by name only where more articles begin with it than one search gives', async () => {
    const big = { id: 'big', kind: 'wikipedia', title: 'Wikipedia', articles: 20 };
    const emma = book(pg, 158, 'Emma', 'Jane Austen', '68');
    const films = Array.from({ length: 12 }, (_, i) => [`Emma (${1930 + i} film)`, [p(`Emma is a ${1930 + i} film of the novel by Jane Austen, made in black and white.`)]]);
    const titles = [
      ['Emma', [p('Emma is a feminine given name, of Germanic origin, borne by queens and by many others since.')]],
      ...films,
      ['Emma (novel)', [p('Emma is a novel written by English author Jane Austen, first published in December 1815.')]],
      ['Emma Goldman', [p('Emma Goldman was a Lithuanian-born anarchist revolutionary, political activist and writer.')]],
    ];
    const asked = [];
    const o = {
      libraries: [pg, big], index: () => [{ book: emma, lib: pg, hay: fold('Emma Jane Austen') }],
      articles: async (lib, q, limit) => {
        asked.push(q);
        return titles.map(([title], n) => ({ title, book: 'v1', n })).filter((x) => fold(x.title).startsWith(fold(q))).slice(0, limit);
      },
      blocksOf: async (lib, id, n) => titles[n][1],
    };
    const answer = await lookAlso({ ...o, book: emma });
    assert.deepEqual(brief(answer), [['title', 'big', 'Emma (novel)']]);
    assert.equal(answer.text, 'Also in the library: the article on this book.');
    assert.deepEqual(asked, ['Jane Austen', 'Emma', 'Emma (novel)'], 'the films fill the search: the novel is asked for by name, and nothing after it');
    // A title with a subtitle, where the search is filled by other titles: the forms in brackets
    // are all among them, so only the title in full is asked for.
    asked.length = 0;
    const names = Array.from({ length: 12 }, (_, i) => [`Emma ${String.fromCharCode(65 + i)}`, [p('Someone of that name, who lived long ago and far away.')]]);
    const o2 = { ...o, articles: async (lib, q, limit) => {
      asked.push(q);
      return [['Emma'], ...names].map(([title], n) => ({ title, book: 'v1', n })).filter((x) => fold(x.title).startsWith(fold(q))).slice(0, limit);
    }, blocksOf: async () => [p('Emma is a feminine given name, of Germanic origin, borne by queens and by many others since.')] };
    const none = await lookAlso({ ...o2, book: { ...emma, title: 'Emma: A Novel' } });
    assert.equal(none.text, 'I see nothing else in the library on this book or its author.');
    assert.deepEqual(asked, ['Jane Austen', 'Emma', 'Emma: A Novel']);
  });

  it('goes without a Wikipedia that takes too long, and says so', async () => {
    const a = access();
    const slow = { ...a, articles: (lib, q, limit) => (lib.id === 'mini' ? new Promise(() => {}) : a.articles(lib, q, limit)) };
    const t = Date.now();
    const answer = await lookAlso({ ...slow, book: inHand(pg, 'Lectures'), wait: 30 });
    assert.ok(Date.now() - t < 2000);
    assert.deepEqual(brief(answer), [['author', 'wp', 'Max Müller'], ['other', 'ws', 'Chips from a German Workshop']]);
    assert.equal(answer.text, 'Also in the library: the article on its author and one other book by F. Max Müller. I did not hear from Wikipedia (introductions) in time.');
    const nothing = await lookAlso({ ...slow, libraries: [pg, mini], book: inHand(pg, 'A Description'), wait: 30 });
    assert.equal(nothing.text, 'I see nothing else in the library on this book or its author. I did not hear from Wikipedia (introductions) in time.');
  });

  it('knows an author by another name of the article, and by a fuller name in its opening', async () => {
    const a = access();
    const answer = await lookAlso({ ...a, book: inHand(pg, 'Lectures') });
    assert.deepEqual(brief(answer), [['author', 'wp', 'Max Müller'], ['other', 'ws', 'Chips from a German Workshop']]);
    assert.equal(answer.text, 'Also in the library: the article on its author and one other book by F. Max Müller.');
    // The fullest name is asked first; the article is found by the name it has.
    assert.deepEqual(a.calls.articles.filter((c) => c.startsWith('wp: ') && /Müller$/.test(c)), ['wp: Friedrich Max Müller', 'wp: F. Max Müller', 'wp: Max Müller']);
  });

  it('offers the article on the book, not the article of the same word', async () => {
    const answer = await lookAlso({ ...access(), book: inHand(pg, 'Language') });
    assert.deepEqual(brief(answer), [['author', 'wp', 'Edward Sapir'], ['title', 'wp', 'Language (Sapir book)'], ['same', 'all', 'Language: An Introduction to the Study of Speech']]);
    assert.equal(answer.text, 'Also in the library: the article on its author, the article on this book and the same work in Gutenberg · every book.');
  });

  it('tells two authors of one name apart, and passes over a page that lists them', async () => {
    const answer = await lookAlso({ ...access(), book: inHand(pg, 'A Description') });
    assert.deepEqual(answer, { text: 'I see nothing else in the library on this book or its author.', finds: [], search: null });
  });

  it('says so of an article of the author\'s name that does not show it is theirs', async () => {
    const answer = await lookAlso({ ...access(), book: inHand(pg, 'Poems') });
    assert.deepEqual(brief(answer), [['name', 'mini', 'Ann Nobody']]);
    assert.equal(answer.text, 'I found an article called “Ann Nobody”, though nothing in it tells me it is the same person.');
  });

  it('finds a work with no author by its title where another library has it so too, and asks for no article', async () => {
    const a = access();
    const answer = await lookAlso({ ...a, book: inHand(pg, 'Beowulf') });
    assert.deepEqual(brief(answer), [['same', 'ws', 'Beowulf']]);
    assert.equal(answer.text, 'Also in the library: the same work in Wikisource.');
    assert.deepEqual(a.calls.articles, []);
  });

  it('looks from any library\'s book, leaves a Wikipedia being indexed alone, and goes on without one that fails', async () => {
    const answer = await lookAlso({ ...access(), book: inHand(ws, 'Roughing It') });
    assert.deepEqual(brief(answer), [['author', 'wp', 'Mark Twain'], ['title', 'wp', 'Roughing It'], ['name', 'mini', 'Mark Twain'],
      ['other', 'pg', 'Adventures of Huckleberry Finn'], ['other', 'pg', 'A Tramp Abroad — Volume 1']]);
    assert.match(answer.text, /^Also in the library: the article on its author, the article on this book and 4 other books by Mark Twain\. And an article called “Mark Twain”.* Here are the first 5\.$/);
    const busy = access();
    const some = await lookAlso({ ...busy, libraries: [pg, all, ws, { ...wp, indexing: { stage: 'sizes' } }, mini], book: inHand(pg, 'Adventures') });
    assert.ok(busy.calls.articles.every((c) => c.startsWith('mini: ')));
    assert.deepEqual(brief(some).map((f) => f[0]), ['same', 'name', 'other', 'other', 'other']);
    const failing = await lookAlso({ ...access({ fail: ['wp'] }), book: inHand(pg, 'Adventures') });
    assert.deepEqual(brief(failing).map((f) => f[0]), ['same', 'name', 'other', 'other', 'other']);
  });

  it('says when there is nowhere else to look', async () => {
    const a = access();
    assert.equal((await lookAlso({ ...a, libraries: [pg], book: inHand(pg, 'Adventures') })).text, 'There is no other library here for me to look in.');
    assert.deepEqual(a.calls.articles, []);
  });
});

describe('his answer from a Wikipedia\'s article', () => {
  const volume = BOOKS.wp[0];
  const at = (n) => ({ title: ARTICLES.wp[n][0], blocks: ARTICLES.wp[n][1] });

  it('on a writer: their books in the other libraries', async () => {
    const a = access();
    const answer = await lookAlso({ ...a, book: volume, article: at(5) });
    assert.deepEqual(brief(answer), [
      ['by', 'pg', 'Adventures of Huckleberry Finn'], ['by', 'pg', 'A Tramp Abroad — Volume 1'], ['by', 'all', 'The Adventures of Tom Sawyer'],
      ['by', 'all', 'A Tramp Abroad — Volume 2'], ['by', 'ws', 'Adventures of Huckleberry Finn'],
    ]);
    assert.equal(answer.text, 'The library has 6 books by Mark Twain. Here are the first 5.');
    assert.deepEqual(a.calls.articles, [], 'the catalogue and the open article are all it needs');
    assert.deepEqual(a.calls.blocks, []);
  });

  it('on a book: the book itself, in each library that has it', async () => {
    const answer = await lookAlso({ ...access(), book: volume, article: at(0) });
    assert.deepEqual(brief(answer), [['itself', 'pg', 'Adventures of Huckleberry Finn'], ['itself', 'ws', 'Adventures of Huckleberry Finn']]);
    assert.equal(answer.text, 'The library has the book this article is about, 2 times.');
    const sapir = await lookAlso({ ...access(), book: volume, article: at(4) });
    assert.deepEqual(brief(sapir), [['itself', 'pg', 'Language: An Introduction to the Study of Speech'], ['itself', 'all', 'Language: An Introduction to the Study of Speech']]);
  });

  it('on neither: nothing, though a book has the article\'s word for its title, or an author its name', async () => {
    const nothing = 'I see no book in the library that this article is about, nor any by someone of its name.';
    assert.equal((await lookAlso({ ...access(), book: volume, article: at(3) })).text, nothing, 'Language, the article on language');
    assert.equal((await lookAlso({ ...access(), book: volume, article: at(2) })).text, nothing, 'John Smith, a list of them');
    assert.equal((await lookAlso({ ...access(), book: volume, article: at(7) })).text, nothing);
    // A writer of that name who is not shown to be the catalogue's.
    assert.equal((await lookAlso({ ...access(), book: BOOKS.mini[0], article: { title: 'Ann Nobody', blocks: ARTICLES.mini[0][1] } })).text, nothing);
  });

  it('with the volume not open at an article: where to ask', async () => {
    const answer = await lookAlso({ ...access(), book: volume, article: null });
    assert.match(answer.text, /^Ask me this at an article/);
    assert.deepEqual(answer.finds, []);
  });
});

describe('what the library also has, as finds', () => {
  const twain = { kind: 'article', article: { title: 'Mark Twain', book: 'v412', n: 7 }, lib: wp, also: 'author' };
  const same = { kind: 'book', book: inHand(ws, 'Adventures'), lib: ws, also: 'same' };

  it('say what each is to the book under its title', () => {
    assert.deepEqual(findLines(twain, true), { title: 'Mark Twain', line: 'Wikipedia · Volume 412', snippet: [['About its author', false]] });
    assert.deepEqual(findLines(same, true), { title: 'Adventures of Huckleberry Finn', line: 'Mark Twain · Wikisource', snippet: [['The same work', false]] });
    assert.equal(findLines({ ...same, also: undefined }, true).snippet, null);
    for (const what of ['author', 'name', 'title', 'same', 'other', 'itself', 'by']) assert.ok(ALSO[what], what);
  });

  it('are followed as a link of the open book is, so Back comes back; with the book not open, as a search\'s results', () => {
    const calls = [];
    const interaction = (state) => ({
      state,
      searchPick: (...a) => calls.push(['searchPick', ...a]),
      openArticle: (...a) => calls.push(['openArticle', ...a]),
      openText: () => {}, openAt: () => {},
      followTo: (...a) => calls.push(['followTo', ...a]),
    });
    takeThere(interaction('read'), twain);
    takeThere(interaction('read'), same);
    assert.deepEqual(calls, [
      ['followTo', { libId: 'wp', id: 'v412', at: { c: 7, b: 0 } }],
      ['followTo', { libId: 'ws', id: 'Adventures_of_Huckleberry_Finn', at: { c: 0, b: 0 } }],
    ]);
    calls.length = 0;
    takeThere(interaction('inspect'), twain);
    takeThere(interaction('inspect'), same);
    // A book that cannot be read is taken from its shelf, not opened.
    takeThere(interaction('read'), { ...same, book: { ...same.book, readable: false } });
    assert.deepEqual(calls.map((c) => c[0]), ['openArticle', 'searchPick', 'searchPick']);
  });
});
