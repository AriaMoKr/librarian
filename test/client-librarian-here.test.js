// "Mentioned here" (public/js/librarian/, SPEC §5.10; docs/LIBRARIAN.md, experiment 3 step 2): the
// libraries' titles kept at hand (titles.js), the mentions on the open pages and his answer
// (here.js), what the card says to the question typed there, a mention's lines, and a mention
// taken to as a link is (librarian.js takeThere). The button and its list (here-panel.js) are
// checked in a browser.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ask, findLines, HERE_HOW, MAX_FINDS, parseQuestion } from '../public/js/librarian/ask.js';
import { lookHere, mentionsOn, partsOf } from '../public/js/librarian/here.js';
import { MOST_ARTICLES, TitleShelf } from '../public/js/librarian/titles.js';
import { entryTokens, NEAR, Titles, windowOf } from '../public/js/librarian/xref.js';
import './helpers/vendor.js'; // librarian.js → desk.js → the page's ../../vendor/common/panel.js

const { takeThere } = await import('../public/js/librarian/librarian.js');

const p = (...runs) => ({ t: 'p', r: runs.map((r) => (typeof r === 'string' ? [r, 0] : r)) });
const h = (l, text) => ({ t: 'h', l, r: [[text, 0]] });
const li = (text) => ({ t: 'li', r: [[text, 0]], d: 1, m: '•' });

const pg = { id: 'pg', kind: 'gutenberg', title: 'Gutenberg' };
const top = { id: 'top', kind: 'wikipedia', title: 'Wikipedia 100', articles: 3 };
const med = { id: 'med', kind: 'wikipedia', title: 'WikiMed', articles: 6 };
const phys = { id: 'phys', kind: 'wikipedia', title: 'Physics', articles: 4 };

/** Each library's articles, in volumes of 3. */
const ARTICLES = {
  top: ['Alcoholism', 'The New York Times', 'Solar eclipse'],
  med: ['Atrial fibrillation', 'Blood', 'Heart failure', 'High blood pressure', 'Isaac Newton', 'Soft palate'],
  phys: ['Electric field', 'Heart failure', 'Nuclear fusion', 'Solar eclipse'],
};
const volumesOf = (id) => Array.from({ length: Math.ceil(ARTICLES[id].length / 3) }, (_, k) => ({ id: `v${k + 1}` }));

/** How the titles are got, counted: a site's list (static) or volume by volume. */
function access({ list = false, fail = [] } = {}) {
  const calls = { list: [], volume: [] };
  return {
    calls,
    list: async (lib) => {
      calls.list.push(lib.id);
      if (fail.includes(lib.id)) throw new Error('no titles');
      return list ? { volumeSize: 3, titles: ARTICLES[lib.id] } : null;
    },
    volumes: (lib) => volumesOf(lib.id),
    volume: async (lib, id) => {
      calls.volume.push(`${lib.id}/${id}`);
      const k = Number(id.slice(1)) - 1;
      return ARTICLES[lib.id].slice(k * 3, k * 3 + 3);
    },
  };
}

describe('the titles at hand', () => {
  it('keeps titles of two words or more, each alone until its words are met', () => {
    const titles = new Titles();
    assert.ok(titles.add('med', 'Heart failure', 7));
    assert.ok(!titles.add('med', 'Blood', 8)); // one word: never a match
    assert.ok(titles.add('phys', 'Heart failure', 9));
    assert.equal(titles.count, 2);
    const entries = titles.get('heart failure');
    assert.deepEqual(entries, [{ lib: 'med', title: 'Heart failure', ref: 7 }, { lib: 'phys', title: 'Heart failure', ref: 9 }]);
    assert.equal(titles.get('blood'), undefined);
    assert.deepEqual(entryTokens(entries[0]).words, ['Heart', 'failure']);
    assert.equal(entryTokens(entries[0]), entries[0].tokens); // taken once
    // Counting what the rule leaves out keeps single words too.
    const all = new Titles({ single: true });
    assert.ok(all.add('med', 'Blood'));
    assert.deepEqual(all.get('blood'), [{ lib: 'med', title: 'Blood' }]);
  });

  it('gets a library\'s titles volume by volume, once, and knows each one\'s article', async () => {
    const a = access();
    const shelf = new TitleShelf(a);
    const getting = [];
    const at = await shelf.of([med, phys], { onGetting: (libs) => getting.push(libs.map((l) => l.id)) });
    assert.deepEqual(getting, [['med', 'phys']]); // told once, of both: they are got at once
    assert.deepEqual(a.calls.volume, ['med/v1', 'med/v2', 'phys/v1', 'phys/v2']);
    assert.equal(at.count, 9); // all but "Blood", one word
    assert.deepEqual(at.failed, []);
    // The first library given is the first offered.
    const entries = at.get('heart failure');
    assert.deepEqual(entries.map((e) => e.lib), ['med', 'phys']);
    assert.deepEqual(at.articleOf(entries[0]), { lib: med, article: { title: 'Heart failure', book: 'v1', n: 2 } });
    assert.deepEqual(at.articleOf(at.get('soft palate')[0]), { lib: med, article: { title: 'Soft palate', book: 'v2', n: 2 } });
    assert.deepEqual(at.articleOf(at.get('solar eclipse')[0]), { lib: phys, article: { title: 'Solar eclipse', book: 'v2', n: 0 } });
    assert.equal(at.get('nothing here'), undefined);
    // Asked again: at hand, nothing got and nobody told to wait.
    assert.ok(shelf.has(med) && shelf.has(phys) && !shelf.has(top));
    const again = await shelf.of([phys], { onGetting: (libs) => getting.push(libs.map((l) => l.id)) });
    assert.equal(a.calls.volume.length, 4);
    assert.equal(getting.length, 1);
    assert.deepEqual(again.get('heart failure').map((e) => e.lib), ['phys']);
    // One more library wanted: only that one is waited for.
    await shelf.of([top, med], { onGetting: (libs) => getting.push(libs.map((l) => l.id)) });
    assert.deepEqual(getting[1], ['top']);
  });

  it('takes a site\'s list of them where it keeps one', async () => {
    const a = access({ list: true });
    const at = await new TitleShelf(a).of([med]);
    assert.deepEqual(a.calls.volume, []);
    assert.deepEqual(at.articleOf(at.get('isaac newton')[0]), { lib: med, article: { title: 'Isaac Newton', book: 'v2', n: 1 } });
    assert.deepEqual(at.articleOf(at.get('atrial fibrillation')[0]).article, { title: 'Atrial fibrillation', book: 'v1', n: 0 });
  });

  it('says which libraries\' titles could not be got, and asks for them again', async () => {
    const a = access({ fail: ['phys'] });
    const shelf = new TitleShelf(a);
    const warn = console.warn;
    console.warn = () => {};
    try {
      const at = await shelf.of([med, phys]);
      assert.deepEqual(at.failed, [phys]);
      assert.ok(at.get('heart failure').every((e) => e.lib === 'med'));
      assert.ok(!shelf.has(phys));
      await shelf.of([phys]);
      assert.deepEqual(a.calls.list, ['med', 'phys', 'phys']);
    } finally {
      console.warn = warn;
    }
  });

  it('holds a Wikipedia whose index is made and that is not too large, and lets go of those gone', async () => {
    const shelf = new TitleShelf(access());
    assert.ok(shelf.canHold(med));
    assert.ok(!shelf.canHold(pg));
    assert.ok(!shelf.canHold({ ...med, indexing: { stage: 'sizes' } }));
    assert.ok(!shelf.canHold({ ...med, articles: MOST_ARTICLES + 1 }));
    assert.ok(new TitleShelf(access(), { most: 5 }).canHold(phys));
    await shelf.of([med, phys]);
    shelf.keep([med, pg]);
    assert.ok(shelf.has(med) && !shelf.has(phys));
  });
});

describe('the pages shown', () => {
  /** A reader whose pages' blocks are known. */
  const reader = (pages) => ({ blocksOn: (ref) => pages[`${ref.c}/${ref.p}`] ?? null });

  it('are their parts of the book, with the blocks some of which are on them', () => {
    const r = reader({ '2/0': { first: 0, last: 4 }, '2/1': { first: 4, last: 9 }, '3/0': { first: 0, last: 2 } });
    assert.deepEqual(partsOf({ left: { c: 2, p: 0 }, right: { c: 2, p: 1 } }, r), { parts: [{ c: 2, first: 0, last: 9 }], pages: 2 });
    assert.deepEqual(partsOf({ left: { c: 2, p: 1 }, right: { c: 3, p: 0 } }, r), { parts: [{ c: 2, first: 4, last: 9 }, { c: 3, first: 0, last: 2 }], pages: 2 });
    // One page at a time: the left is blank, or the page before.
    assert.deepEqual(partsOf({ left: 'blank', right: { c: 2, p: 0 } }, r), { parts: [{ c: 2, first: 0, last: 4 }], pages: 1 });
    assert.deepEqual(partsOf({ left: 'ex', right: { c: 3, p: 0 } }, r), { parts: [{ c: 3, first: 0, last: 2 }], pages: 1 });
    // A page whose blocks are not known yet has none; no spread, no pages.
    assert.deepEqual(partsOf({ left: { c: 9, p: 0 }, right: null }, r), { parts: [], pages: 1 });
    assert.deepEqual(partsOf(null, r), { parts: [], pages: 0 });
  });

  it('give the blocks round them, under a heading of sources where they begin under one', () => {
    const blocks = [h(1, 'Title'), p('a'.repeat(200)), p('b'.repeat(200)), p('c'.repeat(200)), h(2, 'References'), li('one'), li('two'), h(2, 'See also'), li('three')];
    assert.deepEqual(windowOf(blocks, 2, 2, 0), { blocks: [blocks[2]], start: 2, lead: 0 });
    // 150 characters each way: the block before and the block after, of 200 each.
    assert.deepEqual(windowOf(blocks, 2, 2, 150), { blocks: blocks.slice(1, 4), start: 1, lead: 0 });
    // 250: a block of 200 is not enough, so on to the part's ends (the blocks after are short).
    const round = windowOf(blocks, 2, 2, 250);
    assert.deepEqual([round.start, round.blocks.length, round.lead], [0, blocks.length, 0]);
    // Beginning under "References": a heading of sources leads, at that heading's level.
    const under = windowOf(blocks, 6, 6, 0);
    assert.deepEqual(under.blocks, [{ t: 'h', l: 2, r: [['References', 0]] }, blocks[6]]);
    assert.deepEqual([under.start, under.lead], [6, 1]);
    // Past the next heading of that level, none.
    assert.deepEqual(windowOf(blocks, 8, 8, 0), { blocks: [blocks[8]], start: 8, lead: 0 });
    assert.deepEqual(windowOf([], 0, 3, 100), { blocks: [], start: 0, lead: 0 });
    // Clamped to the part; beginning at the heading that ends the sources, they are still led by one.
    assert.deepEqual(windowOf(blocks, 7, 99, 0), { blocks: [h(2, 'References'), blocks[7], blocks[8]], start: 7, lead: 1 });
  });
});

describe('the mentions on the open pages', () => {
  const titles = () => {
    const t = new Titles();
    for (const [lib, list] of Object.entries(ARTICLES)) for (const title of list) t.add(lib, title);
    return t;
  };
  const filler = (n) => 'word '.repeat(n / 5);

  it('are the matches on them that stand, in their order, with the words round them there', () => {
    const blocks = [
      h(1, 'Alcoholism'),
      p('It raises the risk of high blood pressure and of heart failure, said The New York Times.'),
      p('Much later it names heart failure again, and atrial fibrillation with it.'),
    ];
    const on = mentionsOn(blocks, 2, 2, titles(), { own: 'top' });
    assert.deepEqual(on.map((m) => [m.entries[0].title, m.block, m.blocks, m.text]), [
      ['Heart failure', 2, [2], 'heart failure'], ['Atrial fibrillation', 2, [2], 'atrial fibrillation'],
    ]);
    assert.equal(on[0].context, 'Much later it names heart failure again, and atrial fibrillation with it.');
    // The page before: its own mentions, and "The New York Times" is the book's own library's.
    assert.deepEqual(mentionsOn(blocks, 1, 1, titles(), { own: 'top' }).map((m) => m.entries[0].title), ['High blood pressure', 'Heart failure']);
    assert.deepEqual(mentionsOn(blocks, 0, 0, titles(), { own: 'top' }), []);
  });

  it('count the company a mention has on the page before or after', () => {
    const blocks = [p(`${filler(600)}It causes high blood pressure.`), p(`Then heart failure. ${filler(600)}`), p('Nuclear fusion in the ascus, alone.')];
    // "heart failure" stands by "high blood pressure", which is on the page before.
    assert.deepEqual(mentionsOn(blocks, 1, 1, titles()).map((m) => m.entries[0].title), ['Heart failure']);
    // Too far from any company, and no name: held back.
    assert.deepEqual(mentionsOn(blocks, 2, 2, titles()), []);
    assert.ok(filler(600).length > NEAR);
  });

  it('leave a list of sources alone, on the page it begins on and after', () => {
    const blocks = [p('Heart failure and high blood pressure.'), h(2, 'References'), li('On heart failure and high blood pressure, again.'), li('And atrial fibrillation.')];
    assert.deepEqual(mentionsOn(blocks, 0, 2, titles()).map((m) => [m.entries[0].title, m.blocks]), [['Heart failure', [0]], ['High blood pressure', [0]]]);
    assert.deepEqual(mentionsOn(blocks, 2, 3, titles()), []);
  });
});

describe('his answer', () => {
  const libraries = [pg, top, med, phys];
  /** What he is asked of: a book of `lib`, its pages the whole of its one part. */
  const here = (lib, blocks, extra = {}) => ({
    book: { libId: lib.id, id: 'b1' }, parts: [{ c: 0, first: 0, last: blocks.length - 1 }], pages: 2, blocksOf: async () => blocks, libraries,
    shelf: new TitleShelf(access()), ...extra,
  });

  it('names the articles of other libraries the pages name, the first library that has one', async () => {
    const steps = [];
    // "A solar eclipse" stands alone, far from any other article of its libraries: held back.
    const blocks = [p('It raises the risk of high blood pressure and heart failure, as Isaac Newton knew.'), p(`${'word '.repeat(120)}A solar eclipse, seen alone.`)];
    const answer = await lookHere(here(pg, blocks, { onStep: (s) => steps.push(s) }));
    assert.equal(answer.text, 'These pages name 3 articles of other libraries.');
    assert.deepEqual(answer.finds.map((f) => [f.kind, f.lib.id, f.article]), [
      ['article', 'med', { title: 'High blood pressure', book: 'v2', n: 0 }],
      ['article', 'med', { title: 'Heart failure', book: 'v1', n: 2 }], // WikiMed's, before Physics'
      ['article', 'med', { title: 'Isaac Newton', book: 'v2', n: 1 }],
    ]);
    assert.deepEqual(answer.finds[0].mention, { text: 'high blood pressure', context: 'It raises the risk of high blood pressure and heart failure, as Isaac Newton knew.' });
    assert.deepEqual(steps, ['Getting the titles of 3 libraries…', 'Reading these pages…']);
    assert.equal(answer.search, null);
    // One library's titles to get: it is named.
    const one = [];
    await lookHere(here(pg, blocks, { libraries: [pg, med], onStep: (s) => one.push(s) }));
    assert.deepEqual(one, ['Getting the titles of WikiMed…', 'Reading these pages…']);
  });

  it('says so when they name one, or none, and counts a single page as one', async () => {
    const one = await lookHere(here(pg, [p('He admired Isaac Newton.')], { pages: 1 }));
    assert.equal(one.text, 'This page names one article of another library.');
    assert.equal(one.finds.length, 1);
    const none = await lookHere(here(pg, [p('Nothing of the kind, only a solar eclipse.')]));
    assert.equal(none.text, 'I see nothing on these pages that another library has an article on.');
    assert.deepEqual(none.finds, []);
    assert.equal((await lookHere(here(pg, [p('Nothing.')], { pages: 1 }))).text, 'I see nothing on this page that another library has an article on.');
  });

  it('leaves the book\'s own library\'s articles alone, and gets its titles to know them', async () => {
    // In Physics, "heart failure" and "solar eclipse" are its own articles; WikiMed's others are not.
    const blocks = [p('Heart failure, high blood pressure and atrial fibrillation; then a solar eclipse.')];
    const a = access();
    const answer = await lookHere(here(phys, blocks, { shelf: new TitleShelf(a) }));
    assert.deepEqual(answer.finds.map((f) => f.article.title), ['High blood pressure', 'Atrial fibrillation']);
    assert.ok(a.calls.volume.includes('phys/v1'));
  });

  it('gives the first five of more', async () => {
    const many = ['Alpha beta', 'Gamma delta', 'Epsilon zeta', 'Eta theta', 'Iota kappa', 'Lambda mu', 'Nu xi'];
    const a = access();
    a.volume = async () => many;
    a.volumes = () => [{ id: 'v1' }];
    const blocks = [p(`${many.map((t) => t.toLowerCase()).join(', ')}.`)];
    const answer = await lookHere(here(pg, blocks, { libraries: [pg, { ...med, articles: 7 }], shelf: new TitleShelf(a) }));
    assert.equal(answer.finds.length, MAX_FINDS);
    assert.equal(answer.text, 'These pages name 7 articles of other libraries; here are the first 5.');
  });

  it('says what it could not look in, and why', async () => {
    const blocks = [p('He admired Isaac Newton.')];
    const big = { id: 'all', kind: 'wikipedia', title: 'Wikipedia', articles: 6800000 };
    const busy = { id: 'new', kind: 'wikipedia', title: 'Chemistry', articles: 9000, indexing: { stage: 'sizes' } };
    const answer = await lookHere(here(pg, blocks, { libraries: [pg, med, big, busy] }));
    assert.equal(answer.text, 'These pages name one article of another library. Wikipedia is too large for me to look in. Chemistry is still being indexed.');
    assert.equal((await lookHere(here(pg, blocks, { libraries: [pg] }))).text, 'No other library here has articles for me to look in.');
    assert.equal((await lookHere(here(pg, blocks, { libraries: [pg, big] }))).text, 'I cannot look in the other libraries here. Wikipedia is too large for me to look in.');
    // The open book's own library too large: its own articles cannot be told from the others'.
    assert.equal((await lookHere(here(big, blocks, { libraries: [big, med] }))).text, 'Wikipedia is too large for me to tell what its pages name elsewhere.');
    const warn = console.warn;
    console.warn = () => {};
    try {
      const failing = await lookHere(here(pg, blocks, { shelf: new TitleShelf(access({ fail: ['phys'] })) }));
      assert.equal(failing.text, 'These pages name one article of another library. I could not get the titles of Physics.');
      const all = await lookHere(here(pg, blocks, { libraries: [pg, med], shelf: new TitleShelf(access({ fail: ['med'] })) }));
      assert.equal(all.text, 'I could not get the titles of WikiMed.');
      const own = await lookHere(here(phys, blocks, { shelf: new TitleShelf(access({ fail: ['phys'] })) }));
      assert.equal(own.text, 'I could not get the titles of Physics, so I cannot tell what its pages name elsewhere.');
    } finally {
      console.warn = warn;
    }
  });
});

describe('in the card', () => {
  it('knows the question, with or without a greeting', () => {
    for (const q of ['What does this page mention?', 'what do these pages mention', 'Which articles does this book mention?', 'Mentioned here', 'What is mentioned here?',
      'Hello, what is mentioned on this page?', 'what\'s named on these pages']) assert.ok(parseQuestion(q).here, q);
    for (const q of ['What is insulin?', 'Emma', 'what does the fox say', 'a book called Mentioned Here Today', 'Hello']) assert.ok(!parseQuestion(q).here, q);
  });

  it('says where to ask it, and searches for nothing', async () => {
    let searched = 0;
    const library = { libraries: [pg], index: () => { searched++; return []; }, findArticles: async () => { searched++; return []; }, findInText: async () => [] };
    assert.deepEqual(await ask('What does this page mention?', library), { text: HERE_HOW, finds: [], search: null });
    assert.equal(searched, 0);
    assert.match(HERE_HOW, /Mentioned here/);
  });

  it('shows a mention by the page\'s words round its name, the name stressed and near the front', () => {
    const find = (context, text = 'atrial fibrillation') => ({ kind: 'article', article: { title: 'Atrial fibrillation', book: 'v3', n: 4 }, lib: med, mention: { text, context } });
    assert.deepEqual(findLines(find('The risk of atrial fibrillation rises.'), true), {
      title: 'Atrial fibrillation', line: 'WikiMed · Volume 3', snippet: [['The risk of ', false], ['atrial fibrillation', true], [' rises.', false]],
    });
    // Many words before it: cut at a word, so the name shows in the snippet's two lines.
    const long = `… ${'word '.repeat(16)}the risk of atrial fibrillation and stroke.`;
    const { snippet } = findLines(find(long), true);
    assert.equal(snippet[1][0], 'atrial fibrillation');
    assert.ok(snippet[0][0].startsWith('… ') && snippet[0][0].endsWith('the risk of ') && snippet[0][0].length <= 44, snippet[0][0]);
    assert.equal(snippet[2][0], ' and stroke.');
    // A name not found in its words (it should be): the words alone.
    assert.deepEqual(findLines(find('Other words.'), true).snippet, [['Other words.', false]]);
    // An article a search found has no snippet, as before.
    assert.equal(findLines({ kind: 'article', article: { title: 'Paris', book: 'v2', n: 1 }, lib: top }, true).snippet, null);
  });
});

describe('a mention taken to', () => {
  const calls = [];
  const interaction = (state) => ({
    state,
    searchPick: (...a) => calls.push(['searchPick', ...a]),
    openArticle: (...a) => calls.push(['openArticle', ...a]),
    openText: (...a) => calls.push(['openText', ...a]),
    openAt: (...a) => calls.push(['openAt', ...a]),
    followTo: (...a) => calls.push(['followTo', ...a]),
  });
  const mention = { kind: 'article', article: { title: 'Heart failure', book: 'v1', n: 2 }, lib: med, mention: { text: 'heart failure', context: 'Then heart failure.' } };

  it('is followed as a link of the open book is, so Back comes back', () => {
    calls.length = 0;
    takeThere(interaction('read'), mention);
    assert.deepEqual(calls, [['followTo', { libId: 'med', id: 'v1', at: { c: 2, b: 0 } }]]);
  });

  it('opens as any article with no book open, and so does an article a search found', () => {
    calls.length = 0;
    takeThere(interaction('browse'), mention);
    takeThere(interaction('read'), { kind: 'article', article: mention.article, lib: med });
    assert.deepEqual(calls, [['openArticle', 'med', 'v1', 2], ['openArticle', 'med', 'v1', 2]]);
  });
});
