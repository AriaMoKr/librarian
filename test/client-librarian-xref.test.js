// Links between libraries (public/js/librarian/xref.js, SPEC §5.10; docs/LIBRARIAN.md, experiment
// 3): the rule for words that are another library's article, an author's names and a book's
// titles as articles, and the rule held to the matches read by hand
// (tools/librarian-xref-checked.json).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import {
  asWritten, authorNames, isName, keyOf, LITTLE, matchesIn, MAX_WORDS, mayBeMention, mentionsIn, NEAR, nearestOf, piecesOf,
  plain, stands, surnameOf, titleForms, Titles, tokensOf,
} from '../public/js/librarian/xref.js';

const p = (...runs) => ({ t: 'p', r: runs.map((r) => (typeof r === 'string' ? [r, 0] : r)) });
const h = (l, text) => ({ t: 'h', l, r: [[text, 0]] });
const li = (text) => ({ t: 'li', r: [[text, 0]], d: 1, m: '•' });

/** Titles of libraries: { math: ['Fourier transform'], … }. */
function titlesOf(libs) {
  const titles = new Titles();
  for (const [lib, list] of Object.entries(libs)) for (const title of list) titles.add(lib, title);
  return titles;
}
/** The titles matched in a text of the library `own` (as written; a match need not stand yet). */
const found = (text, libs, own = 'own') => matchesIn([typeof text === 'string' ? p(text) : text].flat(), titlesOf(libs), { own })
  .map((m) => m.entries[0].title);
/** The titles mentioned in it: the matches that stand. */
const mentioned = (text, libs, own = 'own') => mentionsIn([typeof text === 'string' ? p(text) : text].flat(), titlesOf(libs), { own })
  .map((m) => m.entries[0].title);

describe('a text as words', () => {
  it('makes hyphens, quotes and spaces one kind each', () => {
    assert.equal(plain('Epstein–Barr  virus\u00a0infection'), 'Epstein-Barr virus infection');
    assert.equal(plain('Adam’s apple'), "Adam's apple");
    assert.equal(plain('a\u00adb\u200bc'), 'abc');
    assert.equal(plain('one\ttwo\nthree'), 'one two three');
    assert.equal(plain('theory—which'), 'theory—which'); // a long dash parts words
  });

  it('keeps the words, what stands between them and where they begin', () => {
    const t = tokensOf('Washington, D.C. and St. Louis (AdS/CFT)');
    assert.deepEqual(t.words, ['Washington', 'D', 'C', 'and', 'St', 'Louis', 'AdS', 'CFT']);
    assert.deepEqual(t.gaps, [', ', '.', '. ', ' ', '. ', ' (', '/']);
    assert.equal(t.at[5], 'Washington, D.C. and St. '.length);
    assert.deepEqual(tokensOf("Newton's two-photon COVID-19").words, ["Newton's", 'two-photon', 'COVID-19']);
    assert.deepEqual(tokensOf('theory—which').words, ['theory', 'which']);
    assert.deepEqual(tokensOf('').words, []);
    assert.equal(keyOf(['Fourier', 'Transform']), 'fourier transform');
  });

  it('knows a title as written, the first letter aside', () => {
    const is = (text, title) => {
      const t = tokensOf(text);
      const e = tokensOf(title);
      return asWritten(t, 0, t.words.length, e);
    };
    assert.ok(is('probability density function', 'Probability density function'));
    assert.ok(is('Molar mass', 'Molar mass'));
    assert.ok(is('Fourier transform', 'fourier transform'));
    assert.ok(!is('Fourier Transform', 'Fourier transform'));
    assert.ok(!is('fourier Transform', 'Fourier transform'));
    assert.ok(!is('Nova scotia', 'NOvA scotia'));
    assert.ok(!is('heart, muscle', 'Heart muscle'));
    assert.ok(is('Washington, D.C', 'Washington, D.C.'));
    assert.ok(!is('Washington D C', 'Washington, D.C.'));
    assert.ok(is('épée fencing', 'Épée fencing'));
  });

  it('counts little words out', () => {
    const may = (s) => mayBeMention(s.split(' '));
    assert.ok(may('probability density function'));
    assert.ok(may('The New York Times'));
    assert.ok(may('in vitro fertilisation'));
    assert.ok(may('Of Mice and Men'));
    assert.ok(may('up quark') && may('Down syndrome'));
    assert.ok(may('Vitamin A') && may('World War I') && may('Hepatitis B'));
    assert.ok(!may('up to') && !may('a value') && !may('A value') && !may('almost all') && !may('of the form'));
    assert.ok(!may('The Tradition') && !may('one half') && !may('in vitro'));
    assert.ok(!may('theory of') && !may('speech and'));
    assert.ok(!may('vitamin a')); // "a" in lower case is the little word
    assert.ok(!may('Mass'));
    assert.ok(LITTLE.has('the') && !LITTLE.has('new') && !LITTLE.has('up'));
    assert.ok(mayBeMention(['x', 'gauge', 'theory', 'of'], 1, 2) && !mayBeMention(['x', 'gauge', 'theory', 'of'], 1, 3));
  });
});

describe('the running text of blocks', () => {
  it('is paragraphs and list items, parted at links, raised text and line ends', () => {
    const blocks = [
      h(1, 'Boltzmann equation'),
      p('It is a ', ['probability density function', 0, { href: 'C/Probability_density_function' }], ' of position', ['[1]', 8], ' and momentum.'),
      { t: 'tr', c: [[['Molar mass', 2]], [['18 g/mol', 0]]], g: 0 },
      { t: 'img', src: '/zim/x/I/a.png', alt: 'Fourier transform' },
      { t: 'pre', r: [['signal processing', 4]] },
      li('fluid dynamics'),
      p('first line\nsecond line', ['\ufffc', 0, { src: '/zim/x/I/f.svg', w: 10, h: 10 }], ' after the formula'),
      p('H', ['2', 16], 'O and ', ['italic', 1], ' words'),
    ];
    assert.deepEqual(piecesOf(blocks), [
      { block: 1, text: 'It is a ' }, { block: 1, text: ' of position' }, { block: 1, text: ' and momentum.' },
      { block: 5, text: 'fluid dynamics' },
      { block: 6, text: 'first line' }, { block: 6, text: 'second line' }, { block: 6, text: ' after the formula' },
      { block: 7, text: 'H' }, { block: 7, text: 'O and italic words' },
    ]);
  });

  it('leaves out what stands under a heading of sources', () => {
    const blocks = [
      h(1, 'Luke Donald'), p('He had back pain.'),
      h(2, 'References'), li('Archived at the Wayback Machine.'), h(3, 'Notes'), li('More notes.'),
      h(2, 'See also'), li('Golf swing'),
      h(2, 'External links'), li('Official site'),
      h(1, 'Next'), p('Running text again.'),
    ];
    assert.deepEqual(piecesOf(blocks).map((x) => x.text), ['He had back pain.', 'Golf swing', 'Running text again.']);
    assert.deepEqual(piecesOf([h(2, 'FOOTNOTES'), p('A note.'), h(2, 'Chapter II'), p('Text.')]).map((x) => x.text), ['Text.']);
    assert.deepEqual(piecesOf([null, {}, { t: 'p' }, p('')]), []);
  });
});

describe('the rule for words', () => {
  const libs = {
    math: ['Probability density function', 'Fourier transform', 'Up to', 'A value', 'A-group', 'Almost all', 'B*', 'Cardinal', 'Field theory', 'Of the form'],
    physics: ['NOvA', 'Mass', 'Gauge theory', 'Vapor pressure', 'P wave', 'AdS/CFT correspondence', 'Nuclear fusion', 'Nuclear fusion of the'],
    medicine: ['Early Stage', 'Epstein–Barr virus infection', "Adam's apple", 'COVID-19 pandemic', 'COVID-19 pandemic in California', 'Heart muscle', 'In vitro fertilisation', 'Vitamin A', 'Nervous system'],
    top: ['The New York Times', 'Washington, D.C.', 'World War I', 'The Tradition', 'Tiger', 'London'],
    own: ['Quantum field theory', 'Molar mass'],
  };

  it('finds a title as written, of two words or more', () => {
    assert.deepEqual(found('It is a probability density function of position.', libs), ['Probability density function']);
    assert.deepEqual(found('Vapor pressure rises with heat, as vapor pressure does.', libs), ['Vapor pressure']);
    assert.deepEqual(found('Epstein-Barr virus infection and Adam’s apple, said The New York Times.', libs),
      ['Epstein–Barr virus infection', "Adam's apple", 'The New York Times']);
    assert.deepEqual(found('Born in Washington, D.C. after World War I.', libs), ['Washington, D.C.', 'World War I']);
    assert.deepEqual(found('By in vitro fertilisation, with Vitamin A and the AdS/CFT correspondence.', libs),
      ['In vitro fertilisation', 'Vitamin A', 'AdS/CFT correspondence']);
  });

  it('finds nothing that merely resembles a title', () => {
    for (const text of [
      'A Nova was seen.', // NOvA
      'At an early stage of it.', // Early Stage
      'He led a group up to the top, and almost all of the form came.', // A-group, Up to, Almost all, Of the form
      'A value of 5 was found; such a value is rare.', // A value
      'The Mass, the Cardinal and Tiger Woods in London.', // single words
      'The tradition holds, and the Tradition too.', // The Tradition: one word in all but name
      'In the heart, muscle cells contract.', // Heart muscle: a comma between
      'The heart. Muscle cells contract.',
      'The Fourier Transform and the FOURIER TRANSFORM.', // not as written
      'Type B* stars.',
      'Washington D C and the nervous systems.',
      'The vapor-pressure curve.', // one word, not two
    ]) assert.deepEqual(found(text, libs), [], text);
  });

  it('looks only at running text', () => {
    const fourier = ['Fourier transform', 0, { href: 'C/Fourier_transform' }];
    assert.deepEqual(found([h(2, 'Gauge theory'), p('Text.')], libs), []);
    assert.deepEqual(found([{ t: 'tr', c: [[['Vapor pressure', 2]]], g: 0 }], libs), []);
    assert.deepEqual(found([p('See the ', fourier, ' here.')], libs), []);
    assert.deepEqual(found([p('gauge ', ['theory', 0, { at: [0, 4] }])], libs), []); // parted by a link
    assert.deepEqual(found([p('gauge', ['1', 8], ' theory')], libs), []);
    assert.deepEqual(found([p('gauge\ntheory')], libs), []);
    assert.deepEqual(found([h(2, 'References'), li('On gauge theory, at the Wayback Machine.')], libs), []);
    assert.deepEqual(found([p('A ', ['gauge', 1], ' theory in italics.')], libs), ['Gauge theory']);
    assert.deepEqual(found([li('See gauge theory.')], libs), ['Gauge theory']);
  });

  it('leaves its own library\'s articles alone, and what is inside them', () => {
    assert.deepEqual(found('A quantum field theory has a molar mass.', libs), []);
    assert.deepEqual(found('A quantum field theory has a molar mass.', libs, 'other'), ['Quantum field theory', 'Molar mass']);
    assert.deepEqual(found('A classical field theory.', { math: ['Field theory'], own: ['Field theory'] }), []);
    // Without a library of its own (a Gutenberg book), every library's articles count.
    assert.deepEqual(matchesIn([p('A quantum field theory.')], titlesOf(libs)).map((m) => m.entries[0].lib), ['own']);
  });

  it('takes the longest run, and one that may be a mention', () => {
    assert.deepEqual(found('The COVID-19 pandemic in California closed it.', libs), ['COVID-19 pandemic in California']);
    assert.deepEqual(found('The COVID-19 pandemic in Wales closed it.', libs), ['COVID-19 pandemic']);
    // "Nuclear fusion of the" is a title too (a silly one), ending in a little word.
    assert.deepEqual(found('By nuclear fusion of the lightest elements.', libs), ['Nuclear fusion']);
  });

  it('gives each match once, with where and how often', () => {
    const first = 'The Boltzmann equation gives a probability density function; see the Fourier transform.';
    const blocks = [
      h(1, 'Boltzmann equation'),
      p(first),
      p('That probability density function is over six dimensions, and the heart’s P wave is not an earthquake’s.'),
    ];
    const matches = matchesIn(blocks, titlesOf({ ...libs, chemistry: ['Fourier transform'] }), { own: 'own' });
    assert.deepEqual(matches.map((m) => [m.text, m.key, m.block, m.count, m.entries.map((e) => e.lib)]), [
      ['probability density function', 'probability density function', 1, 2, ['math']],
      ['Fourier transform', 'fourier transform', 1, 1, ['math', 'chemistry']],
      ['P wave', 'p wave', 2, 1, ['physics']],
    ]);
    // Where: the characters of running text before it, each time, and the block.
    assert.deepEqual(matches[0].at, [first.indexOf('probability'), first.length + 1 + 'That '.length]);
    assert.deepEqual(matches[0].blocks, [1, 2]);
    assert.deepEqual(matches.map((m) => m.near), [null, null, null]); // not looked for yet
    assert.equal(matches[0].context, first);
    const long = `${'word '.repeat(60)}the gauge theory ${'more '.repeat(60)}`;
    const [m] = matchesIn([p(long)], titlesOf(libs), { own: 'own' });
    assert.ok(m.context.startsWith('… word') && m.context.endsWith('more …') && m.context.includes(' the gauge theory '), m.context);
    assert.ok(m.context.length < 220);
  });

  it('keeps titles by their words, up to the longest looked for', () => {
    const titles = new Titles();
    assert.ok(titles.add('a', 'Newton\'s law of universal gravitation', { book: 'v1', n: 3 }));
    assert.ok(titles.add('b', 'Newton’s law of universal gravitation'));
    assert.ok(!titles.add('a', '…'));
    assert.ok(!titles.add('a', Array.from({ length: MAX_WORDS + 1 }, (_, i) => `w${i}`).join(' ')));
    assert.equal(titles.count, 2);
    const entries = titles.get("newton's law of universal gravitation");
    assert.deepEqual(entries?.map((e) => [e.lib, e.ref]), [['a', { book: 'v1', n: 3 }], ['b', undefined]]);
    assert.equal(titles.get('nothing'), undefined);
  });
});

describe('a match that stands', () => {
  const libs = {
    medicine: ['Atrial fibrillation', 'High blood pressure', 'Heart failure', 'Caesarean section', 'COVID-19 vaccine', 'Secondary treatment'],
    math: ['Large numbers', 'Isaac Newton'],
    physics: ['Manhattan Project', 'Nuclear fusion'],
  };

  it('knows a name by a capital that grammar does not ask for', () => {
    const name = (text, run) => {
      const t = tokensOf(text);
      const { words } = tokensOf(run);
      return isName(t, t.words.indexOf(words[0]), words.length);
    };
    assert.ok(name('He met Isaac Newton there.', 'Isaac Newton'));
    assert.ok(name('It was the Manhattan Project.', 'Manhattan Project'));
    assert.ok(name('Born by Caesarean section.', 'Caesarean section'));
    assert.ok(name('The COVID-19 vaccine came.', 'COVID-19 vaccine'));
    assert.ok(name('An mRNA vaccine came.', 'mRNA vaccine'));
    assert.ok(name('Isaac Newton was there.', 'Isaac Newton')); // "Newton", past the first word
    assert.ok(name('There were Large numbers of them.', 'Large numbers')); // written so, in mid sentence
    assert.ok(!name('Large numbers of bats fly.', 'Large numbers')); // a sentence's first word
    assert.ok(!name('They fly. Large numbers of them.', 'Large numbers'));
    assert.ok(!name('He said: "Large numbers of them."', 'Large numbers'));
    assert.ok(!name('It causes atrial fibrillation.', 'atrial fibrillation'));
  });

  it('measures how near the next match of the same library stands', () => {
    const filler = (n) => `${'x'.repeat(n - 1)} `;
    const text = `atrial fibrillation ${filler(100)}high blood pressure ${filler(500)}heart failure and large numbers`;
    const matches = nearestOf(matchesIn([p(text)], titlesOf(libs)));
    assert.deepEqual(matches.map((m) => [m.key, m.near]), [
      ['atrial fibrillation', 120], ['high blood pressure', 120], ['heart failure', 520], ['large numbers', null],
    ]);
    // Its own other places are no company: only another article's.
    const twice = nearestOf(matchesIn([p('The heart failure got worse; heart failure it stayed. Then atrial fibrillation.')], titlesOf(libs)));
    assert.deepEqual(twice.map((m) => [m.key, m.count, m.near]), [['heart failure', 2, 30], ['atrial fibrillation', 1, 30]]);
  });

  it('stands as a name, or in the company of its library', () => {
    assert.ok(stands({ name: true, near: null }));
    assert.ok(stands({ name: false, near: NEAR }));
    assert.ok(!stands({ name: false, near: NEAR + 1 }));
    assert.ok(!stands({ name: false, near: null }));
    assert.equal(NEAR, 300);
  });

  it('gives the mentions: the matches that stand', () => {
    // In company: both WikiMed's, a few words apart.
    assert.deepEqual(mentioned('It raises the risk of high blood pressure, atrial fibrillation and stroke.', libs),
      ['High blood pressure', 'Atrial fibrillation']);
    // Alone, and no name: one sense or another, and the text does not show which.
    assert.deepEqual(mentioned('Large numbers of bats fly at dusk.', libs), []);
    assert.deepEqual(mentioned('In the ascus the nuclear fusion occurs.', libs), []);
    assert.deepEqual(found('In the ascus the nuclear fusion occurs.', libs), ['Nuclear fusion']); // a match all the same
    // Another library's article beside it is no company.
    assert.deepEqual(mentioned('The secondary treatment costs came in large numbers.', libs), []);
    // A name stands alone.
    assert.deepEqual(mentioned('He worked on the Manhattan Project for a year.', libs), ['Manhattan Project']);
    assert.deepEqual(mentioned('A footnote on Isaac Newton, born in 1642.', libs), ['Isaac Newton']);
    // Company too far off is none; in the next paragraph it is near; a name is company too.
    const far = 'word '.repeat(80);
    assert.deepEqual(mentioned(`He had heart failure. ${far}Then atrial fibrillation came.`, libs), []);
    assert.deepEqual(mentioned([p('He had heart failure.'), p('Then atrial fibrillation came.')], libs), ['Heart failure', 'Atrial fibrillation']);
    assert.deepEqual(mentioned('After the COVID-19 vaccine, no heart failure.', libs), ['COVID-19 vaccine', 'Heart failure']);
  });
});

describe('an author and a title as articles', () => {
  it('names an author as Project Gutenberg writes them', () => {
    assert.deepEqual(authorNames('F. Max (Friedrich Max) Müller'), ['Friedrich Max Müller', 'F. Max Müller', 'Max Müller']);
    assert.deepEqual(authorNames('A. H. (Archibald Henry) Sayce'), ['Archibald Henry Sayce', 'A. H. Sayce']);
    assert.deepEqual(authorNames('Herbert A. (Herbert Augustus) Strong'), ['Herbert Augustus Strong', 'Herbert A. Strong', 'Herbert Strong']);
    assert.deepEqual(authorNames('Otto F. Ege'), ['Otto F. Ege', 'Otto Ege']);
    assert.deepEqual(authorNames('M. Moncalm'), ['M. Moncalm']);
    assert.deepEqual(authorNames('Edward Sapir'), ['Edward Sapir']);
    assert.deepEqual(authorNames('Ernest Thompson Seton'), ['Ernest Thompson Seton']);
    assert.deepEqual(authorNames('Saki (H. H. Munro)'), ['Saki', 'H. H. Munro']);
  });

  it('turns a name round, and drops years and what stands before a name', () => {
    assert.deepEqual(authorNames('Austen, Jane, 1775-1817'), ['Jane Austen']);
    assert.deepEqual(authorNames('Twain, Mark'), ['Mark Twain']);
    assert.deepEqual(authorNames('Müller, F. Max (Friedrich Max)'), ['Friedrich Max Müller', 'F. Max Müller', 'Max Müller']);
    assert.deepEqual(authorNames('Sir Walter Scott'), ['Sir Walter Scott', 'Walter Scott']);
    assert.deepEqual(authorNames('Martin Luther King, Jr.'), ['Martin Luther King, Jr.']);
    assert.deepEqual(authorNames('Homer (750? BCE-650? BCE)'), ['Homer']);
    for (const no of ['', null, undefined, 'Anonymous', 'Various', 'Unknown', 'Wikipedia']) assert.deepEqual(authorNames(no), []);
  });

  it('knows a surname', () => {
    assert.equal(surnameOf('F. Max (Friedrich Max) Müller'), 'Müller');
    assert.equal(surnameOf('Edward Sapir'), 'Sapir');
    assert.equal(surnameOf('Martin Luther King, Jr.'), 'King');
    assert.equal(surnameOf('Anonymous'), '');
  });

  it('names a book as Wikipedia may', () => {
    assert.deepEqual(titleForms({ title: 'Language: An Introduction to the Study of Speech', author: 'Edward Sapir' }), [
      'Language', 'Language (novel)', 'Language (Sapir novel)', 'Language (book)', 'Language (Sapir book)', 'Language (play)',
      'Language (poem)', 'Language: An Introduction to the Study of Speech',
    ]);
    assert.deepEqual(titleForms({ title: 'Introduction to the science of language, Volume 1 (of 2)', author: 'A. H. (Archibald Henry) Sayce' }).slice(0, 2),
      ['Introduction to the science of language', 'Introduction to the science of language (novel)']);
    assert.equal(titleForms({ title: 'Moby Dick; Or, The Whale', author: 'Herman Melville' })[0], 'Moby Dick');
    assert.equal(titleForms({ title: 'Frankenstein, or, The Modern Prometheus' })[0], 'Frankenstein');
    assert.equal(titleForms({ title: 'Poems — Volume 2' })[0], 'Poems');
    assert.equal(titleForms({ title: 'The Jungle Book 2' })[0], 'The Jungle Book 2');
    assert.deepEqual(titleForms({ title: 'Emma', author: 'Anonymous' }), ['Emma', 'Emma (novel)', 'Emma (book)', 'Emma (play)', 'Emma (poem)']);
    assert.deepEqual(titleForms({ title: '' }), []);
  });
});

describe('the rule, over the matches read by hand', () => {
  const file = new URL('../tools/librarian-xref-checked.json', import.meta.url);
  const { matches } = JSON.parse(fs.readFileSync(file, 'utf8'));
  /** The rule's matches of an entry's title in its sentence. */
  const matchesOf = (m) => {
    const titles = new Titles();
    titles.add(m.to, m.title);
    return matchesIn([p(m.context)], titles, { own: m.lib });
  };

  it('finds each of its matches again, and none of what it leaves out', () => {
    for (const m of matches) {
      const [match] = matchesOf(m);
      if (m.kind === 'words') {
        assert.ok(match, `${m.text} → ${m.title} (in ${m.from})`);
        // A name in its sentence is a name (elsewhere in its text it may be one too).
        if (match.name) assert.ok(m.name, `${m.text}: a name in its sentence`);
      } else {
        // The words as they stand there are no match (the same words written as the title, further
        // on in the sentence, may be).
        assert.ok(match?.text !== plain(m.text), `${m.kind}: ${m.text} → ${m.title} (in ${m.from})`);
      }
    }
  });

  it('is right 19 times in 20 where it lets a match stand', () => {
    const standing = matches.filter((m) => m.kind === 'words' && stands(m));
    const right = standing.filter((m) => m.right).length;
    assert.ok(standing.length >= 150, `only ${standing.length} mentions read`);
    assert.ok(right / standing.length >= 0.95, `${right} right of ${standing.length}: ${((right / standing.length) * 100).toFixed(1)} %`);
    // What it holds back is wrong more often: that is what holding back is for.
    const held = matches.filter((m) => m.kind === 'words' && !stands(m));
    assert.ok(held.length >= 50 && held.filter((m) => m.right).length / held.length < right / standing.length);
  });

  it('holds matches of each kind, each with its sentence and a verdict', () => {
    assert.deepEqual([...new Set(matches.map((m) => m.kind))].sort(), ['loose', 'single', 'words']);
    for (const m of matches) {
      assert.equal(typeof m.right, 'boolean', m.text);
      for (const k of ['lib', 'from', 'text', 'title', 'to', 'context']) assert.ok(typeof m[k] === 'string' && m[k], `${k} of ${m.text}`);
      assert.ok(plain(m.context).toLowerCase().includes(plain(m.text).toLowerCase()), `${m.text} in its sentence`);
      if (m.kind !== 'words') continue;
      assert.ok(typeof m.name === 'boolean' && (m.near === null || Number.isInteger(m.near)), `${m.text}: its signs`);
      if (!m.right) assert.ok(m.why, `${m.text}: why it is not the article`);
    }
    const ids = matches.map((m) => `${m.kind}|${m.lib}|${m.from}|${m.text}|${m.title}`);
    assert.equal(new Set(ids).size, ids.length, 'each match once');
  });
});
