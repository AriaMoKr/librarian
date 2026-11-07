// The librarian (public/js/librarian/, SPEC §5.10): its questions (ask.js parseQuestion,
// searchesFor), its answers over a small catalogue with the article and full-text searches faked
// (ask), the card's list of finds (card.js findList, on test/helpers/fake-dom.js) and the ways to a
// find (librarian.js takeThere).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bookIndex } from '../public/js/search.js';
import { ask, citedText, findLines, MAX_FINDS, parseQuestion, PROMPT, searchesFor } from '../public/js/librarian/ask.js';
import { findList } from '../public/js/librarian/card.js';
import { fakeDocument, inner, markup } from './helpers/fake-dom.js';
import './helpers/vendor.js'; // librarian.js → desk.js → the page's ../../vendor/common/panel.js

const { takeThere } = await import('../public/js/librarian/librarian.js');

const pg = { id: 'pg', kind: 'gutenberg', title: 'Gutenberg' };
const wp = { id: 'wp', kind: 'wikipedia', title: 'Wikipedia', illustration: 'zim/wp/icon.png' };
const book = (id, title, author, rank, extra = {}) => ({ id, title, author, rank, ...extra });
const booksByLib = {
  pg: [
    book('1', 'Moby Dick; Or, The Whale', 'Herman Melville', 1, { cover: 'zim/pg/covers/1.jpg' }),
    book('2', 'Pride and Prejudice', 'Jane Austen', 2),
    book('3', 'Emma', 'Jane Austen', 3),
    book('4', 'Persuasion', 'Jane Austen', 4),
    book('5', 'Stand by Me', 'Someone Else', 5),
    book('6', 'Paris as It Was', 'Blagdon', 6),
    book('7', 'A Night in Paris', 'Anon', 7),
    book('8', 'What Is Man?', 'Mark Twain', 8),
    book('9', 'The Story of the Alphabet', 'Edward Clodd', 9),
    book('10', 'In the Path of the Alphabet', 'Frances Jermain', 10),
    ...['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'].map((n, i) => book(`t${i}`, `Tale ${n}`, 'Mark Twain', 10 + i)),
  ],
  wp: [book('v1', 'Aa – Zz', 'Wikipedia', 1)],
};
const libraries = [pg, wp];

const ARTICLES = [
  { title: 'Pariser–Parr–Pople method', book: 'v1', n: 2 },
  { title: 'Paris', book: 'v1', n: 3 },
  { title: 'Paris Commune', book: 'v1', n: 4 },
  { title: 'Black hole', book: 'v1', n: 9 },
  { title: 'New York City', from: 'NYC', book: 'v1', n: 7 },
];
const HITS = [
  { title: 'Moby Dick; Or, The Whale', author: 'Herman Melville', snippet: [['Call me ', false], ['Ishmael', true], ['.', false]], to: { book: '1', c: 0, b: 2 } },
];

/** The librarian's library: the catalogue's books, and the article and full-text searches faked. */
function library(over = {}) {
  const asked = { articles: [], texts: [] };
  return {
    asked,
    libraries,
    index: () => bookIndex(libraries, booksByLib),
    findArticles: async (q) => {
      asked.articles.push(q);
      return ARTICLES.filter((a) => (a.from ?? a.title).toLowerCase().startsWith(q.toLowerCase())).map((article) => ({ article, lib: wp }));
    },
    findInText: async (q) => {
      asked.texts.push(q);
      return q.toLowerCase() === 'call me ishmael' ? HITS.map((hit) => ({ hit, lib: pg })) : [];
    },
    ...over,
  };
}

const ids = (answer) => answer.finds.map((f) => (f.kind === 'book' ? f.book.id : f.kind === 'article' ? f.article.title : `text:${f.hit.title}`));

describe('librarian: questions', () => {
  it('takes the asking off a title', () => {
    for (const [text, q] of [
      ['Do you have Moby Dick?', 'Moby Dick'],
      ['Hello, have you got “Emma”, please?', 'Emma'],
      ['Who wrote Moby Dick?', 'Moby Dick'],
      ["I'm looking for a copy of Persuasion.", 'Persuasion'],
      ['Can you find me Pride and Prejudice', 'Pride and Prejudice'],
      ['where can i find moby dick', 'moby dick'],
      ['Moby Dick', 'Moby Dick'],
    ]) {
      const question = parseQuestion(text);
      assert.equal(question.q, q, text);
      assert.equal(question.by, '', text);
      assert.equal(question.wants, 'any', text);
    }
  });

  it('tells an author, a subject and a title apart', () => {
    assert.deepEqual(pick(parseQuestion('Anything by Jane Austen?')), { q: '', by: 'Jane Austen', wants: 'book' });
    assert.deepEqual(pick(parseQuestion('books written by Mark Twain')), { q: '', by: 'Mark Twain', wants: 'book' });
    assert.deepEqual(pick(parseQuestion('Do you have the works of Mark Twain?')), { q: '', by: 'Mark Twain', wants: 'book' });
    assert.deepEqual(pick(parseQuestion('What is a black hole?')), { q: 'black hole', by: '', wants: 'article' });
    assert.deepEqual(pick(parseQuestion('What’s photosynthesis')), { q: 'photosynthesis', by: '', wants: 'article' });
    assert.deepEqual(pick(parseQuestion('Tell me about Paris')), { q: 'Paris', by: '', wants: 'article' });
    assert.deepEqual(pick(parseQuestion("I'm looking for the article on New York")), { q: 'New York', by: '', wants: 'article' });
    assert.deepEqual(pick(parseQuestion('Books about whales')), { q: 'whales', by: '', wants: 'any' });
    assert.deepEqual(pick(parseQuestion('Is there a book called The Time Machine?')), { q: 'The Time Machine', by: '', wants: 'book' });
    assert.deepEqual(pick(parseQuestion('On the Origin of Species')), { q: 'On the Origin of Species', by: '', wants: 'any' }, '"on" alone is a title\'s');
    assert.deepEqual(pick(parseQuestion('The Story of the Alphabet')), { q: 'The Story of the Alphabet', by: '', wants: 'any' }, '"the story" begins titles');
  });

  it('asks for a title as typed first when a book has it, before taking it apart', () => {
    const index = bookIndex(libraries, booksByLib);
    assert.deepEqual(searchesFor(parseQuestion('What is man?'), index).map((s) => [s.q, s.wants]), [['What is man', 'any'], ['man', 'article']]);
    assert.deepEqual(searchesFor(parseQuestion('What is a black hole?'), index).map((s) => [s.q, s.wants]), [['black hole', 'article'], ['What is a black hole', 'any']]);
  });

  it('keeps "X by Y" whole, with its split to try next', () => {
    const question = parseQuestion('Pride and Prejudice by Jane Austen');
    assert.equal(question.q, 'Pride and Prejudice by Jane Austen');
    assert.deepEqual(question.split, { q: 'Pride and Prejudice', by: 'Jane Austen' });
    assert.deepEqual(searchesFor(question), [
      { q: 'Pride and Prejudice by Jane Austen', by: '', wants: 'any' },
      { q: 'Pride and Prejudice', by: 'Jane Austen', wants: 'book' },
    ], 'the words as typed are the first search already');
    assert.deepEqual(searchesFor(parseQuestion('Do you have zzz?')).map((s) => s.q), ['zzz', 'Do you have zzz']);
  });

  it('knows a question that asks for nothing yet', () => {
    assert.deepEqual([parseQuestion('Hello!').empty, parseQuestion('Hello!').greeting], [true, true]);
    assert.deepEqual([parseQuestion('Do you have').empty, parseQuestion('Do you have').greeting], [true, false]);
    assert.equal(parseQuestion('   ').empty, true);
    assert.equal(parseQuestion('Hi, Emma please').empty, false);
  });
});

/** @param {ReturnType<typeof parseQuestion>} question */
function pick({ q, by, wants }) {
  return { q, by, wants };
}

describe('librarian: answers', () => {
  it('finds a book by its title and says where it is', async () => {
    const answer = await ask('Do you have Moby Dick?', library());
    assert.deepEqual(ids(answer), ['1']);
    assert.equal(answer.text, 'I have Moby Dick; Or, The Whale, by Herman Melville, in Gutenberg.');
  });

  it("lists an author's books, the first five of more", async () => {
    let answer = await ask('Anything by Jane Austen?', library());
    assert.deepEqual(ids(answer), ['2', '3', '4']);
    assert.equal(answer.text, 'I have 3 books by Jane Austen.');
    const lib = library();
    answer = await ask('books by twain', lib);
    assert.equal(answer.finds.length, MAX_FINDS);
    assert.equal(answer.text, 'I have 8 books by Mark Twain; here are the first 5.');
    assert.deepEqual(lib.asked, { articles: [], texts: [] }, "an author's books only: no articles asked for");
  });

  it('tries a title and its author when the whole finds nothing, and keeps a title with "by" whole', async () => {
    let answer = await ask('Emma by Jane Austen', library());
    assert.deepEqual(ids(answer), ['3']);
    assert.deepEqual(answer.search, { q: 'Emma', by: 'Jane Austen', wants: 'book' });
    assert.equal(answer.text, 'I have Emma, by Jane Austen, in Gutenberg.');
    answer = await ask('Stand by Me', library());
    assert.deepEqual(ids(answer), ['5']);
    answer = await ask('Emma by Herman Melville', library());
    assert.deepEqual(ids(answer), []);
    assert.equal(answer.text, 'I have nothing called “Emma by Herman Melville”. I looked in all 2 libraries here.');
  });

  it("puts Wikipedia's articles first for a subject, without a leading article word", async () => {
    const lib = library();
    let answer = await ask('What is a black hole?', lib);
    assert.deepEqual(ids(answer), ['Black hole']);
    assert.equal(answer.text, 'I have the article “Black hole”, in Wikipedia.');
    assert.deepEqual(lib.asked.articles, ['black hole']);
    answer = await ask('the black hole', lib);
    assert.deepEqual(ids(answer), ['Black hole']);
    assert.deepEqual(lib.asked.articles.slice(1), ['the black hole', 'black hole'], 'with the "the" and without');
  });

  it('lists books and articles: an article named as asked first, those beginning with the words as a whole next', async () => {
    const answer = await ask('Paris', library());
    assert.deepEqual(ids(answer), ['Paris', '6', '7', 'Paris Commune', 'Pariser–Parr–Pople method']);
    assert.equal(answer.text, 'I have 2 books and 3 articles for “Paris”.');
  });

  it('keeps a title whole that its words would take apart', async () => {
    let answer = await ask('What is man?', library());
    assert.deepEqual(ids(answer), ['8']);
    assert.equal(answer.text, 'I have What Is Man?, by Mark Twain, in Gutenberg.');
    answer = await ask('The Story of the Alphabet', library());
    assert.deepEqual(ids(answer), ['9']);
  });

  it('says what it has, and that there is more', async () => {
    const many = ARTICLES.concat(Array.from({ length: 6 }, (_, i) => ({ title: `Paris ${i}`, book: 'v1', n: 20 + i })));
    const answer = await ask('Paris', library({
      findArticles: async (q) => many.filter((a) => a.title.toLowerCase().startsWith(q.toLowerCase())).map((article) => ({ article, lib: wp })),
    }));
    assert.equal(answer.finds.length, MAX_FINDS);
    assert.equal(answer.text, 'I have 2 books and 3 articles for “Paris”, and more.');
  });

  it('finds words in the text, where the server can search it', async () => {
    const answer = await ask('call me ishmael', library());
    assert.deepEqual(ids(answer), ['text:Moby Dick; Or, The Whale']);
    assert.equal(answer.text, 'I found “call me ishmael” in Moby Dick; Or, The Whale, in Gutenberg.');
  });

  it('says when it has nothing, and what to ask', async () => {
    assert.equal((await ask('zzz', library())).text, 'I have nothing called “zzz”. I looked in all 2 libraries here.');
    assert.equal((await ask('What is zzz?', library())).text, 'I have no article on “zzz”. I looked in all 2 libraries here.');
    assert.equal((await ask('anything by Nobody', library())).text, 'I have no books by Nobody. I looked in all 2 libraries here.');
    assert.equal((await ask('zzz', library({ libraries: [pg] }))).text, 'I have nothing called “zzz”. I looked in the library here.');
    assert.equal((await ask('zzz', library({ libraries: [], index: () => [] }))).text, 'There are no books here yet.');
    assert.equal((await ask('Hello', library())).text, `Hello. ${PROMPT}`);
    assert.equal((await ask('', library())).text, PROMPT);
  });

  it('goes on without the articles when their search fails or stalls', async () => {
    let answer = await ask('Paris', library({ findArticles: async () => { throw new Error('offline'); } }));
    assert.deepEqual(ids(answer), ['6', '7']);
    const t0 = Date.now();
    answer = await ask('Paris', library({ findArticles: () => new Promise(() => {}), wait: 30 }));
    assert.deepEqual(ids(answer), ['6', '7']);
    assert.ok(Date.now() - t0 < 2000, 'not held by a request that never answers');
  });

  it("names an article reached by another name, as the search's results do", async () => {
    const answer = await ask('NYC', library());
    assert.deepEqual(findLines(answer.finds[0], true), { title: 'NYC → New York City', line: 'Wikipedia · Volume 1', snippet: null });
  });
});

describe('librarian: the card', () => {
  it('lists the finds, each a button that takes you there', async () => {
    const finds = (await ask('Paris', library())).finds.slice(0, 2).concat((await ask('Moby Dick', library())).finds);
    const taken = [];
    const list = findList(fakeDocument(), finds, { multi: true, take: (find) => taken.push(find) });
    assert.equal(list.getAttribute('aria-label'), 'What the librarian found');
    const buttons = list.findAll((el) => el.tagName === 'BUTTON');
    assert.equal(buttons.length, 3);
    assert.equal(markup(buttons[0]), '<button type="button" class="lb-find"><img class="lb-icon" alt="" width="34" height="34" data-src="zim/wp/icon.png">'
      + '<span class="lb-find-text"><span class="lb-find-title">Paris</span><span class="lb-find-line">Wikipedia · Volume 1</span></span>'
      + '<span class="lb-find-go">Take me there</span></button>');
    assert.equal(inner(buttons[2]), '<img class="lb-cover" alt="" width="34" height="48" data-src="zim/pg/covers/1.jpg">'
      + '<span class="lb-find-text"><span class="lb-find-title">Moby Dick; Or, The Whale</span><span class="lb-find-line">Herman Melville · Gutenberg</span></span>'
      + '<span class="lb-find-go">Take me there</span>');
    buttons[2].click();
    assert.deepEqual(taken, [finds[2]]);
  });

  it("shows a place in the text with its snippet's words", async () => {
    const { finds } = await ask('call me ishmael', library());
    const [button] = findList(fakeDocument(), finds, { multi: false, take: () => {} }).findAll((el) => el.tagName === 'BUTTON');
    assert.match(inner(button), /<span class="lb-find-snip">Call me <b>Ishmael<\/b>.<\/span>/);
    assert.match(inner(button), /<span class="lb-nocover"><\/span>/, 'no picture: a blank in its place');
  });

  it('takes you there as the search does; to a place he read, its book open there', async () => {
    const calls = [];
    const interaction = {
      searchPick: (...a) => calls.push(['searchPick', ...a]),
      openArticle: (...a) => calls.push(['openArticle', ...a]),
      openText: (...a) => calls.push(['openText', ...a]),
      openAt: (...a) => calls.push(['openAt', ...a]),
    };
    const [moby] = (await ask('Moby Dick', library())).finds;
    const [paris] = (await ask('Paris', library())).finds;
    const [text] = (await ask('call me ishmael', library())).finds;
    for (const find of [moby, paris, text, PASSAGE]) takeThere(interaction, find);
    assert.deepEqual(calls, [
      ['searchPick', booksByLib.pg[0], { take: true }],
      ['openArticle', 'wp', 'v1', 3],
      ['openText', 'pg', HITS[0]],
      ['openAt', 'pg', '9', { c: 0, b: 2 }],
    ]);
  });

  it('shows a place he read: its book, section and words, numbered as his sentences cite it', () => {
    assert.deepEqual(findLines(PASSAGE, true), {
      title: 'The Story of the Alphabet', line: 'Preface · Edward Clodd · Gutenberg', snippet: [['“The story of the alphabet is told here.”', false]],
    });
    // A long one cut at a word; a section has no words of its own.
    const long = findLines({ ...PASSAGE, text: 'word '.repeat(100).trim(), section: '', author: '' }, false);
    assert.equal(long.line, '');
    assert.match(long.snippet?.[0][0] ?? '', /^“(word ){40,}word…”$/);
    assert.ok((long.snippet?.[0][0].length ?? 0) <= 244);
    assert.equal(findLines({ ...PASSAGE, text: '' }, false).snippet, null);
    const taken = [];
    const list = findList(fakeDocument(), [PASSAGE, { kind: 'book', book: booksByLib.pg[1], lib: pg }], { multi: false, numbered: true, take: (find) => taken.push(find) });
    assert.equal(list.getAttribute('aria-label'), 'Where the librarian read it');
    const buttons = list.findAll((el) => el.tagName === 'BUTTON');
    assert.equal(inner(buttons[0]), '<span class="lb-num">1</span><img class="lb-cover" alt="" width="34" height="48" data-src="zim/pg/covers/9.jpg">'
      + '<span class="lb-find-text"><span class="lb-find-title">The Story of the Alphabet</span><span class="lb-find-line">Preface · Edward Clodd</span>'
      + '<span class="lb-find-snip">“The story of the alphabet is told here.”</span></span><span class="lb-find-go">Take me there</span>');
    assert.match(inner(buttons[1]), /^<span class="lb-num">2<\/span><span class="lb-nocover"><\/span>/);
    buttons[0].click();
    assert.deepEqual(taken, [PASSAGE]);
    // Without a cover, a place in a book shows its library's picture.
    const [icon] = findList(fakeDocument(), [{ ...PASSAGE, lib: wp, cover: null }], { multi: false, take: () => {} }).findAll((el) => el.tagName === 'IMG');
    assert.equal(markup(icon), '<img class="lb-icon" alt="" width="34" height="34" data-src="zim/wp/icon.png">');
  });

  it('gives a reading with its sources\' numbers where only text shows them (his panel)', () => {
    const statements = [{ text: 'It was told in 1891.', cites: [1] }, { text: 'Clodd wrote it.', cites: [2, 1] }, { text: 'Uncited.', cites: [] }];
    assert.equal(citedText({ text: 'It was told in 1891. Clodd wrote it. Uncited.', finds: [], search: null, statements }), 'It was told in 1891. [1] Clodd wrote it. [2, 1] Uncited.');
    assert.equal(citedText({ text: 'I have Emma.', finds: [], search: null }), 'I have Emma.');
  });
});

/** A place the librarian read (read.js findOf). */
const PASSAGE = {
  kind: 'passage', lib: pg, bookId: '9', at: { c: 0, b: 2 }, title: 'The Story of the Alphabet', section: 'Preface',
  text: 'The story of the alphabet is told here.', author: 'Edward Clodd', cover: 'zim/pg/covers/9.jpg',
};
