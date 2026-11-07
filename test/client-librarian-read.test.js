// The Librarian reading (public/js/librarian/, SPEC §5.10; docs/LIBRARIAN.md, experiment 2): the
// library as the model's tools (tools.js) over a small catalogue with its reading faked, the
// citation rule (cite.js) and the conversation (read.js) with a scripted model.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bookIndex } from '../public/js/search.js';
import { blockText, idOf, LibraryTools, MAX_CALLS, SYSTEM } from '../public/js/librarian/tools.js';
import { checkAnswer, norm, NOTHING, statementsOf, stem } from '../public/js/librarian/cite.js';
import { finish, readFor, warmTurn } from '../public/js/librarian/read.js';

const pg = { id: 'pg', kind: 'gutenberg', title: 'Gutenberg' };
const wp = { id: 'wp', kind: 'wikipedia', title: 'Wikipedia' };
const book = (id, title, author, rank, extra = {}) => ({ id, title, author, rank, ...extra });
const BOOKS = {
  pg: [
    book('12629', 'Language', 'Edward Sapir', 1, { subtitle: 'An Introduction to the Study of Speech' }),
    book('2', 'Emma', 'Jane Austen', 2),
    ...Array.from({ length: 10 }, (_, i) => book(`t${i}`, `Tale ${i + 1}`, 'Mark Twain', 10 + i)),
  ],
  wp: [book('v1', 'Aa – Zz', 'Wikipedia', 1)],
};

const p = (text) => ({ t: 'p', r: [[text, 0]] });
const h = (l, text) => ({ t: 'h', l, r: [[text, 0]] });
/** A passage longer than a passage is shown (800 characters). */
const long = (n) => `Passage ${n} goes on about the sounds of speech and how they are made. `.repeat(14).trim();

const CHUNKS = {
  'pg/12629': [
    [
      h(1, 'Preface'),
      p('This little book aims to give a certain perspective on the subject of language.'),
      p('Edward Sapir. Ottawa, Ont., April 8, 1921.'),
      h(1, 'I'),
      h(2, 'Introductory: Language Defined'),
      p('Speech is so familiar a feature of daily life that we rarely pause to define it.'),
      p(long(1)), p(long(2)), p(long(3)), p(long(4)),
      p('Language is a purely human method of communicating ideas by means of symbols.[1]'),
    ],
    [
      h(1, 'II'),
      h(2, 'The Elements of Speech'),
      p('The Morse telegraph code is a symbolism of a symbolism.'),
      { t: 'li', r: [['Sounds', 0]], d: 1, m: '•' },
    ],
  ],
  'wp/v1': [
    [], [], [h(1, 'Germany'), p('Germany is a country in Central Europe. Its capital is Berlin.')],
    [
      h(1, 'Insulin'),
      p('Insulin is a peptide hormone produced by beta cells of the pancreatic islets.[1][citation needed]'),
      { t: 'tr', c: [[['Symbol', 2]], [['INS', 0]]], g: 0 },
      h(2, 'Structure'),
      p('Insulin is made of two chains joined by bonds.'),
      h(2, 'History'),
      h(3, 'Discovery'),
      p('Insulin was discovered in 1921 by Frederick Banting and Charles Best.[2]'),
    ],
    [h(1, 'Insulin glargine'), p('Insulin glargine is a long-acting insulin.')],
    [],
  ],
};
const META = {
  'pg/12629': {
    chunks: [{}, {}],
    toc: [
      { title: 'Preface', level: 1, c: 0, b: 0 },
      { title: 'I', level: 1, c: 0, b: 3 },
      { title: 'Introductory: Language Defined', level: 2, c: 0, b: 4 },
      { title: 'II', level: 1, c: 1, b: 0 },
      { title: 'The Elements of Speech', level: 2, c: 1, b: 1 },
      { title: 'A deeper heading', level: 3, c: 1, b: 2 },
    ],
  },
  'pg/2': { chunks: [{}], toc: [] },
  'wp/v1': { chunks: CHUNKS['wp/v1'].map(() => ({})) },
};
const ARTICLES = [
  { title: 'Insulin glargine', book: 'v1', n: 4 },
  { title: 'Insulin', book: 'v1', n: 3 },
  { title: 'Insulinoma', book: 'v1', n: 5 },
  { title: 'Germany', from: 'Deutschland', book: 'v1', n: 2 },
];

/** The library as the tools read it (search.js and api.js on the page), and what it was asked. */
function access({ fullText = false, chunk } = {}) {
  const libs = fullText ? [{ ...pg, fulltext: true }, wp] : [pg, wp];
  const asked = { chunks: [] };
  return {
    asked,
    libraries: () => libs,
    index: () => bookIndex(libs, BOOKS),
    articles: async (q) => ARTICLES.filter((a) => (a.from ?? a.title).toLowerCase().startsWith(q.toLowerCase())).map((article) => ({ article, lib: wp })),
    texts: async (q) => (q.includes('telegraph') ? [{
      hit: { title: 'Language', author: 'Edward Sapir', path: 'A/Language.12629', snippet: [['the Morse ', false], ['telegraph', true], [' code', false]], to: { book: '12629', c: 1, b: 2 } },
      lib: libs[0],
    }] : []),
    meta: async (lib, id) => META[`${lib}/${id}`],
    chunk: chunk ?? (async (lib, id, n) => {
      asked.chunks.push(`${lib}/${id}/${n}`);
      return CHUNKS[`${lib}/${id}`]?.[n] ?? [];
    }),
    place: async (lib, hit) => ({ at: { c: hit.to.c, b: hit.to.b } }),
  };
}

describe('the library as the model reads it (tools.js)', () => {
  it('says what a block says, as one line', () => {
    assert.equal(blockText({ t: 'p', r: [['A hormone', 0], ['[1]', 8], [' made\nin the ', 0], ['￼', 0, { src: 'x.png' }], ['pancreas.[citation needed]', 1]] }), 'A hormone made in the pancreas.');
    assert.equal(blockText(h(2, 'History')), 'History');
    assert.equal(blockText({ t: 'li', r: [['Sounds', 0]] }), '• Sounds');
    assert.equal(blockText({ t: 'li', r: [['[2]', 8]] }), '');
    assert.equal(blockText({ t: 'tr', c: [[['Born', 2]], [['26 April 1564\nStratford', 0]], [['England', 0]]] }), 'Born: 26 April 1564, Stratford; England');
    assert.equal(blockText({ t: 'tr', c: [[['Alone', 0]]] }), 'Alone');
    assert.equal(blockText({ t: 'pre', x: 'one\n  two' }), 'one two');
    assert.equal(blockText({ t: 'img', src: 'x.png' }), '');
    assert.equal(blockText({ t: 'hr' }), '');
  });

  it('reads ids as the model may write them', () => {
    assert.equal(idOf('[b1]'), 'B1');
    assert.equal(idOf(' P 12 '), 'P12');
    assert.equal(idOf(undefined), '');
  });

  it('offers the full-text search only where there is one', () => {
    const names = (t) => t.defs.map((d) => d.function.name);
    assert.deepEqual(names(new LibraryTools(access())), ['search_books', 'search_articles', 'read', 'find']);
    assert.deepEqual(names(new LibraryTools(access({ fullText: true }))), ['search_books', 'search_articles', 'search_text', 'read', 'find']);
    assert.deepEqual(new LibraryTools(access()).defs[0].function.parameters.required, ['query']);
  });

  it('finds books, a thing keeping its id; never a Wikipedia\'s volumes', async () => {
    const t = new LibraryTools(access());
    assert.match(await t.run('search_books', {}), /Say what to look for/);
    assert.equal(t.searched, false);
    assert.equal(await t.run('search_books', { query: 'Austen' }), 'One book:\n[B1] Emma, by Jane Austen (Gutenberg)');
    assert.equal(t.searched, true);
    assert.equal(await t.run('search_books', { query: 'language' }), 'One book:\n[B2] Language: An Introduction to the Study of Speech, by Edward Sapir (Gutenberg)');
    assert.equal(await t.run('search_books', { query: 'Emma' }), 'One book:\n[B1] Emma, by Jane Austen (Gutenberg)');
    const twain = await t.run('search_books', { query: 'tale', author: 'Twain' });
    assert.match(twain, /^10 books:\n\[B3\] Tale 1, by Mark Twain \(Gutenberg\)\n/);
    assert.match(twain, /\n…and 2 more\.$/);
    assert.match(await t.run('search_books', { query: 'Aa' }), /^No book's title or author has the words “Aa”/);
    const b2 = t.sources.get('B2');
    assert.equal(b2.kind, 'book');
    assert.equal(b2.book, '12629');
    assert.equal(b2.lib, pg);
    assert.equal(b2.at, null);
    assert.equal(b2.context, 'Language: An Introduction to the Study of Speech, by Edward Sapir (Gutenberg)');
  });

  it('finds articles: the subject named as asked first, then names beginning with it', async () => {
    const t = new LibraryTools(access());
    assert.equal(await t.run('search_articles', { query: 'the insulin' }),
      '3 articles:\n[A1] Insulin (Wikipedia)\n[A2] Insulin glargine (Wikipedia)\n[A3] Insulinoma (Wikipedia)');
    assert.equal(await t.run('search_articles', { query: 'Deutschland' }), 'One article:\n[A4] Germany (Wikipedia) (found as “Deutschland”)');
    assert.match(await t.run('search_articles', { query: 'Atlantis' }), /^No article's title begins with “Atlantis”/);
    assert.deepEqual(t.sources.get('A1').at, { c: 3, b: 0 });
    assert.equal(t.sources.get('A1').end, 3);
  });

  it('reads a book a page at a time, its contents first', async () => {
    const t = new LibraryTools(access());
    await t.run('search_books', { query: 'Language' });
    const page1 = await t.run('read', { id: 'b1' });
    assert.ok(page1.startsWith(
      'Language: An Introduction to the Study of Speech, by Edward Sapir (Gutenberg)\n'
      + 'Contents (read a section by its id): [S1] Preface; [S2] I. Introductory: Language Defined; [S3] II. The Elements of Speech\n'
      + 'Page 1:\n— Preface —\n[P1] This little book aims to give a certain perspective on the subject of language.\n'
      + '[P2] Edward Sapir. Ottawa, Ont., April 8, 1921.\n— I —\n— Introductory: Language Defined —\n[P3] Speech is so familiar',
    ), page1);
    const p4 = page1.split('\n').find((l) => l.startsWith('[P4] '));
    assert.ok(p4.endsWith('…') && p4.length <= '[P4] '.length + 801, p4);
    assert.ok(page1.includes('\n[P7] Passage 4 goes on'));
    assert.ok(!page1.includes('purely human'));
    assert.ok(page1.endsWith('\nMore: read {"id":"B1","page":2}'), page1);
    // The whole passage is held, as cut for the model's eyes only.
    assert.equal(t.sources.get('P4').text, long(1));

    assert.equal(await t.run('read', { id: 'B1', page: 2 }),
      'Page 2:\n[P8] Language is a purely human method of communicating ideas by means of symbols.\n'
      + '— II —\n— The Elements of Speech —\n[P9] The Morse telegraph code is a symbolism of a symbolism.\n[P10] • Sounds\n(The end.)');
    assert.equal(await t.run('read', { id: 'B1', page: 3 }), 'There is no page 3.');
    // A section from its heading; what was shown before keeps its id.
    const s2 = await t.run('read', { id: 'S2' });
    assert.ok(s2.startsWith('Page 1:\n— I —\n— Introductory: Language Defined —\n[P3] Speech is so familiar'), s2);
    assert.ok(s2.endsWith('More: read {"id":"S2","page":2}'), s2);
    const p9 = t.sources.get('P9');
    assert.deepEqual(p9.at, { c: 1, b: 2 });
    assert.equal(p9.title, 'The Elements of Speech');
    assert.equal(p9.in, 'Language');
    assert.equal(p9.context, 'Language: An Introduction to the Study of Speech, by Edward Sapir (Gutenberg)\nThe Elements of Speech');
    assert.match(await t.run('read', { id: 'B9' }), /^There is no B9 here/);
  });

  it('reads an article to its own end, its sections listed', async () => {
    const a = access();
    const t = new LibraryTools(a);
    await t.run('search_articles', { query: 'Insulin' });
    assert.equal(await t.run('read', { id: 'A1' }), [
      'Insulin (Wikipedia)',
      'Sections (read one by its id): [S1] Structure; [S2] History; [S3] Discovery',
      'Page 1:',
      '— Insulin —',
      '[P1] Insulin is a peptide hormone produced by beta cells of the pancreatic islets.',
      '[P2] Symbol: INS',
      '— Structure —',
      '[P3] Insulin is made of two chains joined by bonds.',
      '— History —',
      '— Discovery —',
      '[P4] Insulin was discovered in 1921 by Frederick Banting and Charles Best.',
      '(The end.)',
    ].join('\n'));
    assert.deepEqual(a.asked.chunks, ['wp/v1/3']);
    assert.equal(await t.run('read', { id: 'S3' }), 'Page 1:\n— Discovery —\n[P4] Insulin was discovered in 1921 by Frederick Banting and Charles Best.\n(The end.)');
    assert.equal(t.sources.get('P4').end, 3);
  });

  it('finds the passages that hold all the words, in the whole book or article', async () => {
    const t = new LibraryTools(access());
    await t.run('search_books', { query: 'Language' });
    await t.run('search_articles', { query: 'Insulin' });
    assert.equal(await t.run('find', { id: 'B1', words: 'symbol' }),
      '2 passages of Language with “symbol”:\n[P1] Language is a purely human method of communicating ideas by means of symbols.\n'
      + '[P2] The Morse telegraph code is a symbolism of a symbolism.');
    assert.equal(await t.run('find', { id: 'A1', words: 'insulin 1921' }),
      'One passage of Insulin with “insulin 1921”:\n[P3] Insulin was discovered in 1921 by Frederick Banting and Charles Best.');
    assert.match(await t.run('find', { id: 'A1', words: 'glargine' }), /^No passage of Insulin has all of “glargine”/);
    assert.match(await t.run('find', { id: 'B1', words: '' }), /^Say which words/);
    assert.match(await t.run('find', { id: 'X1', words: 'a' }), /^There is no X1 here/);
    // A passage found again keeps its id.
    assert.ok((await t.run('read', { id: 'B1', page: 2 })).startsWith('Page 2:\n[P1] Language is a purely human'));
  });

  it('searches the full text where it can, and reads from a little before the place found', async () => {
    const t = new LibraryTools(access({ fullText: true }));
    assert.equal(await t.run('search_text', { query: 'telegraph' }), '[T1] Language, by Edward Sapir (Gutenberg): “the Morse telegraph code”');
    assert.equal(await t.run('read', { id: 'T1' }),
      'Page 1:\n— The Elements of Speech —\n[P1] The Morse telegraph code is a symbolism of a symbolism.\n[P2] • Sounds\n(The end.)');
    // The passage stands in its book, not in the hit's snippet.
    assert.equal(t.sources.get('P1').context, 'Language, by Edward Sapir (Gutenberg)\nThe Elements of Speech');
    assert.match(await new LibraryTools(access()).run('search_text', { query: 'telegraph' }), /^There is no tool "search_text"/);
  });

  it('says what went wrong, and never throws', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const tools = new LibraryTools(access({ chunk: async () => { throw new Error('the network is down'); } }));
    await tools.run('search_books', { query: 'Language' });
    assert.equal(await tools.run('read', { id: 'B1' }), 'That could not be done just now (the network is down).');
    assert.equal(await tools.run('delete', {}), 'There is no tool "delete". The tools are: search_books, search_articles, read, find.');
    assert.deepEqual(tools.calls.map((c) => c.name), ['search_books', 'read', 'delete']);
  });
});

describe('the citation rule (cite.js)', () => {
  it('takes an answer apart into its sentences, each with what it cites', () => {
    assert.deepEqual(statementsOf('Born c. 1564 in Stratford [P1]. A. L. Kroeber knew him (P2). It said “Language is human.” [P3]'), [
      { text: 'Born c. 1564 in Stratford.', ids: ['P1'] },
      { text: 'A. L. Kroeber knew him.', ids: ['P2'] },
      { text: 'It said “Language is human.”', ids: ['P3'] },
    ]);
    assert.deepEqual(statementsOf('One [P1, P2]. Two [P3; B1]. Three 【P4】. Four [P5 and P6]. Five (A2/T3) [S1][P1].').map((s) => s.ids), [
      ['P1', 'P2'], ['P3', 'B1'], ['P4'], ['P5', 'P6'], ['A2', 'T3', 'S1', 'P1'],
    ]);
    assert.deepEqual(statementsOf('<think>I should cite it.</think> He signed it in Ottawa, Ont., on April 8, 1921 [P2].'), [
      { text: 'He signed it in Ottawa, Ont., on April 8, 1921.', ids: ['P2'] },
    ]);
    // Several citations in a row are one; a comma after one is the sentence's own.
    assert.deepEqual(statementsOf('It is in the article [P2], [P5], and [P7]. He wrote it [B1], and he signed it [P1].'), [
      { text: 'It is in the article.', ids: ['P2', 'P5', 'P7'] },
      { text: 'He wrote it, and he signed it.', ids: ['B1', 'P1'] },
    ]);
    assert.deepEqual(statementsOf(''), []);
  });

  it('matches words by their stems, and text without its punctuation', () => {
    assert.equal(stem('signs'), stem('sign'));
    assert.equal(stem('studies'), stem('study'));
    assert.equal(stem('discovered'), stem('discovery'));
    assert.equal(stem('press'), 'press');
    assert.equal(stem('Shakespeare’s'), stem('Shakespeare'));
    assert.equal(norm('“Ottawa, Ont.”'), 'ottawa ont');
    assert.equal(norm('Sapir’s ‘book’'), "sapir's book");
  });

  const CONTEXT = 'Language: An Introduction to the Study of Speech, by Edward Sapir (Gutenberg)';
  const SOURCES = new Map([
    ['B1', { kind: 'book', text: CONTEXT, context: CONTEXT }],
    ['P1', { kind: 'passage', text: 'Edward Sapir. Ottawa, Ont., April 8, 1921.', context: `${CONTEXT}\nPreface` }],
    ['P2', { kind: 'passage', text: 'Language is a purely human method of communicating ideas by means of symbols.', context: `${CONTEXT}\nIntroductory: Language Defined` }],
    ['P3', { kind: 'passage', text: 'The speed of light in vacuum is exactly 299792458 metres per second.', context: 'Speed of light (Wikipedia)' }],
    ['P4', { kind: 'passage', text: 'Born: c. 23 April 1564, Stratford-upon-Avon, England', context: 'William Shakespeare (Wikipedia)' }],
    ['P5', { kind: 'passage', text: 'Atomic number (Z): 6', context: 'Carbon (Wikipedia)\nQuick facts' }],
    ['P6', { kind: 'passage', text: 'It is the best-known work on the subject.', context: CONTEXT }],
    ['P7', { kind: 'passage', text: 'Nicklaus has the most wins, six between 1963 and 1986.', context: 'Masters Tournament (Wikipedia)\nRecords' }],
    ['P8', { kind: 'passage', text: 'Most wins: Jack Nicklaus (6)', context: 'Masters Tournament (Wikipedia)' }],
  ]);
  const check = (answer) => checkAnswer(answer, SOURCES);
  const why = (answer) => check(answer).dropped.map((d) => d.why);

  it('keeps what its sources say: names, numbers and words there, or round them', () => {
    assert.deepEqual(check('Edward Sapir wrote Language [B1].').kept, [{ text: 'Edward Sapir wrote Language.', ids: ['B1'] }]);
    assert.equal(check('Sapir signed the preface in Ottawa in 1921 [P1].').kept.length, 1);
    assert.equal(check('Light travels at 299,792,458 metres per second in vacuum [P3].').kept.length, 1);
    assert.equal(check('In Language, Sapir defines language by its symbols [P2].').kept.length, 1);
    // Words parted by any dash, numbers grouped by spaces, an id's digits no number, a reference gone.
    assert.equal(check('William Shakespeare was born around 23 April 1564 in Stratford‑upon‑Avon, England [P4].').kept.length, 1);
    assert.equal(check('Light travels at 299 792 458 metres per second in vacuum [P3].').kept.length, 1);
    assert.equal(check('Article A1 gives the atomic number of carbon as 6 [P5].').kept.length, 1);
    assert.deepEqual(check('Sapir signed the preface in Ottawa in 1921 [P1] [1].').kept, [{ text: 'Sapir signed the preface in Ottawa in 1921.', ids: ['P1'] }]);
    // A sentence's first words are no names; a judgement its source makes is its to make.
    assert.equal(check('Based on the text, Sapir signed the preface in Ottawa [P1].').kept.length, 1);
    assert.equal(check('I\'ll add that Sapir signed the preface in Ottawa [P1].').kept.length, 1);
    assert.equal(check('It is the best-known work on the subject [P6].').kept.length, 1);
    // A name of several words, one of them cited, whole in another thing shown: cited too.
    assert.deepEqual(check('Jack Nicklaus has the most wins, six between 1963 and 1986 [P7].').kept,
      [{ text: 'Jack Nicklaus has the most wins, six between 1963 and 1986.', ids: ['P7', 'P8'] }]);
  });

  it('strikes out what they do not say', () => {
    assert.deepEqual(why('Sapir was a linguist.'), ['cites nothing']);
    assert.deepEqual(why('Sapir signed the preface in Ottawa in 1922 [P1].'), ['a number its sources do not have (1922)']);
    assert.deepEqual(why('Sapir signed the preface in Toronto [P1].'), ['a name its sources do not have (Toronto)']);
    assert.deepEqual(why('Sapir signed the preface in Ottawa, Ontario [P1].'), ['a name its sources do not have (Ontario)']);
    // A name's other part only where the whole name stands in another thing shown.
    assert.deepEqual(why('Gary Nicklaus has the most wins, six between 1963 and 1986 [P7].'), ['a name its sources do not have (Gary)']);
    assert.deepEqual(why('Sapir loved cheerful mountain holidays [P1].'), ['says more than its sources (1 of 5 words there)']);
    // A sentence of one such word is held to its names and numbers alone.
    assert.deepEqual(why('He liked it [P1].'), []);
  });

  it('strikes out judgements and guesses its sources do not make, and what he thinks', () => {
    assert.deepEqual(why('The best book about language is Language by Edward Sapir [B1].'), ['a judgement its sources do not make (best)']);
    assert.deepEqual(why('I recommend Language, by Edward Sapir [B1].'), ['a judgement its sources do not make (recommend)']);
    assert.deepEqual(why('It was probably signed in Ottawa [P1].'), ['a judgement its sources do not make (probably)']);
    assert.deepEqual(why('I think Sapir signed it in Ottawa [P1].'), ['says what he thinks']);
  });

  it('holds a quote to what it cites, or to the passage that has it', () => {
    assert.equal(check('Sapir calls language “a purely human” method [P2].').kept.length, 1);
    // What is cited, with a book's own title round it.
    assert.equal(check('Sapir wrote “Language: An Introduction to the Study of Speech” [P2].').kept.length, 1);
    assert.deepEqual(check('Sapir signed it “Ottawa, Ont.” [B1].').kept, [{ text: 'Sapir signed it “Ottawa, Ont.”.', ids: ['B1', 'P1'] }]);
    assert.deepEqual(check('He wrote “An Introduction to the Study of Speech” [P1].').kept, [{ text: 'He wrote “An Introduction to the Study of Speech”.', ids: ['P1'] }]);
    assert.deepEqual(why('Sapir wrote that “language is a game” [P2].'), ['quotes words that no source has']);
  });

  it('strikes out ids no tool gave', () => {
    const made = check('Sapir was born in 1884 [P9]. Edward Sapir wrote Language [B1][B7].');
    assert.deepEqual(made.madeUp, ['P9', 'B7']);
    assert.deepEqual(made.dropped.map((d) => d.why), ['cites only what it was not shown']);
    assert.deepEqual(made.kept, [{ text: 'Edward Sapir wrote Language.', ids: ['B1'] }]);
  });

  it('hears him say he found nothing, cited or not', () => {
    for (const answer of [NOTHING, 'I could not find anything about his breakfast [P1].', 'The passages do not say [P2].']) {
      const c = check(answer);
      assert.equal(c.saidNothing, true, answer);
      assert.deepEqual([c.kept, c.dropped], [[], []], answer);
    }
  });
});

describe('the Librarian reading (read.js)', () => {
  const call = (name, args) => ({ function: { name, arguments: args } });
  /** A model that answers as scripted, turn by turn, and what it was sent. */
  function model(replies) {
    const sent = [];
    const chat = async (messages, tools) => {
      sent.push({ messages: structuredClone(messages), tools: tools.map((d) => d.function.name) });
      const r = replies[sent.length - 1];
      return { message: { role: 'assistant', content: '', ...(typeof r === 'function' ? r() : r) }, timings: { load: 1, prompt: 0.5, reply: 0.25, tokens: 10 } };
    };
    return { chat, sent };
  }

  it('searches, reads and answers with the sentences its sources say, numbered by source', async () => {
    const m = model([
      { tool_calls: [call('search_books', { query: 'Language' })] },
      { tool_calls: [call('find', '{"id":"B1","words":"Ottawa"}')] },
      { content: 'Edward Sapir signed the preface in Ottawa on April 8, 1921 [P1]. He wrote Language [B1][P1]. He liked strong black coffee [P1]' },
    ]);
    const steps = [];
    const tools = new LibraryTools(access());
    const r = await readFor('  Where did Sapir sign his preface? ', { chat: m.chat, tools, onStep: (s) => steps.push(s) });
    assert.equal(r.nothing, false);
    assert.equal(r.text, 'Edward Sapir signed the preface in Ottawa on April 8, 1921. He wrote Language.');
    assert.deepEqual(r.statements.map((s) => s.cites), [[1], [2, 1]]);
    assert.deepEqual(r.sources.map((s) => s.id), ['P1', 'B1']);
    assert.deepEqual(r.sources[0].at, { c: 0, b: 2 });
    assert.deepEqual(r.dropped.map((d) => d.why), ['says more than its sources (0 of 4 words there)']);
    assert.equal(r.rounds, 3);
    assert.deepEqual(r.timings, { load: 3, prompt: 1.5, reply: 0.75, tokens: 30 });
    assert.deepEqual(steps, [
      { name: 'search_books', args: { query: 'Language' }, round: 1 },
      { name: 'find', args: { id: 'B1', words: 'Ottawa' }, round: 2 },
    ]);
    assert.deepEqual(m.sent[0].messages, [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'Where did Sapir sign his preface?' }]);
    assert.deepEqual(m.sent[0].tools, ['search_books', 'search_articles', 'read', 'find']);
    assert.deepEqual(m.sent[1].messages.slice(2), [
      { role: 'assistant', content: '', tool_calls: [call('search_books', { query: 'Language' })] },
      { role: 'tool', tool_name: 'search_books', content: 'One book:\n[B1] Language: An Introduction to the Study of Speech, by Edward Sapir (Gutenberg)' },
    ]);
  });

  it('sends back an answer given before any search', async () => {
    const m = model([
      { content: 'Edward Sapir wrote it.' },
      { tool_calls: [call('search_books', { query: 'Language' })] },
      { content: 'Edward Sapir wrote Language [B1].' },
    ]);
    const r = await readFor('Who wrote Language?', { chat: m.chat, tools: new LibraryTools(access()) });
    assert.deepEqual(m.sent[1].messages.slice(2), [
      { role: 'assistant', content: 'Edward Sapir wrote it.' },
      { role: 'user', content: 'You have not searched the library yet. Search it first, then answer only with what the passages say.' },
    ]);
    assert.equal(r.text, 'Edward Sapir wrote Language.');
  });

  it('asks for the answer on the last turn, with no tools', async () => {
    const m = model([
      { tool_calls: [call('search_books', { query: 'Emma' })] },
      { content: 'Emma is by Jane Austen [B1].', tool_calls: [call('read', { id: 'B1' })] },
    ]);
    const r = await readFor('Who wrote Emma?', { chat: m.chat, tools: new LibraryTools(access()), rounds: 2 });
    assert.deepEqual(m.sent[1].tools, []);
    assert.match(m.sent[1].messages.at(-1).content, /^Answer now/);
    assert.equal(r.text, 'Emma is by Jane Austen.');
    assert.deepEqual(r.calls.map((c) => c.name), ['search_books']);
    assert.equal(r.rounds, 2);
  });

  it('takes tool calls a model writes as text, if they name its tools', async () => {
    const m = model([
      { content: '```json\n{"name": "search_books", "arguments": {"query": "Emma"}}\n```' },
      { content: '[{"name": "search_articles", "parameters": {"query": "Insulin"}}]' },
      { content: '{"name": "delete_everything", "arguments": {}}' },
    ]);
    const r = await readFor('Who wrote Emma?', { chat: m.chat, tools: new LibraryTools(access()) });
    assert.deepEqual(r.calls, [{ name: 'search_books', args: { query: 'Emma' } }, { name: 'search_articles', args: { query: 'Insulin' } }]);
    assert.deepEqual(m.sent[1].messages[2], { role: 'assistant', content: '', tool_calls: [call('search_books', { query: 'Emma' })] });
    assert.equal(r.nothing, true);
    assert.equal(r.text, NOTHING);
    assert.deepEqual(r.dropped.map((d) => d.why), ['cites nothing']);
  });

  it('runs at most MAX_CALLS calls of a turn', async () => {
    const m = model([
      { tool_calls: Array.from({ length: MAX_CALLS + 2 }, (_, i) => call('search_books', { query: `Tale ${i + 1}` })) },
      { content: NOTHING },
    ]);
    const r = await readFor('Which tales?', { chat: m.chat, tools: new LibraryTools(access()) });
    assert.equal(r.calls.length, MAX_CALLS);
    assert.equal(m.sent[1].messages[2].tool_calls.length, MAX_CALLS);
    assert.equal(m.sent[1].messages.filter((x) => x.role === 'tool').length, MAX_CALLS);
    assert.deepEqual([r.nothing, r.text, r.sources, r.dropped], [true, NOTHING, [], []]);
  });

  it('stops when asked to', async () => {
    const stopped = new AbortController();
    stopped.abort();
    await assert.rejects(readFor('Who?', { chat: model([]).chat, tools: new LibraryTools(access()), signal: stopped.signal }), { name: 'AbortError' });
    const later = new AbortController();
    const tools = new LibraryTools(access());
    const m = model([() => {
      later.abort();
      return { tool_calls: [call('search_books', { query: 'Emma' })] };
    }]);
    await assert.rejects(readFor('Who wrote Emma?', { chat: m.chat, tools, signal: later.signal }), { name: 'AbortError' });
    assert.deepEqual(tools.calls, []);
  });

  it('warms the model with its instructions and tools', () => {
    const tools = new LibraryTools(access());
    assert.deepEqual(warmTurn(tools), { messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'Hello.' }], tools: tools.defs });
  });

  it('says it found nothing when nothing is left', () => {
    const r = finish('Who?', 'Somebody wrote it [B4].', new LibraryTools(access()), { calls: [], rounds: 1, timings: { load: 0, prompt: 0, reply: 0, tokens: 0 } });
    assert.deepEqual([r.nothing, r.text, r.madeUp, r.raw], [true, NOTHING, ['B4'], 'Somebody wrote it [B4].']);
  });
});
