// Where the libraries' titles are kept (public/js/librarian/, SPEC §5.10; docs/LIBRARIAN.md,
// experiment 3 step 4): the engine (xref-engine.js: a list of titles or volumes' contents got and
// kept, the mentions on pages, libraries let go of, its pauses where it shares the page's thread),
// its worker (xref-worker.js itself, loaded here on a stand-in for a worker's scope, its messages
// copied as a browser copies them), the page's side of it (titles.js RemoteEngine, startEngine:
// the worker where one starts, else the page's thread), and the titles' keeper over it.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lookHere } from '../public/js/librarian/here.js';
import { RemoteEngine, startEngine, TitleShelf } from '../public/js/librarian/titles.js';
import { PLACES, XrefEngine } from '../public/js/librarian/xref-engine.js';

const p = (text) => ({ t: 'p', r: [[text, 0]] });
const pagesOf = (...blocks) => [{ blocks, first: 0, last: blocks.length - 1 }];

/** What the site answers, by address: a list of titles, or a volume's contents. */
const SITE = {
  'med/titles.json': { volumeSize: 2, titles: ['Atrial fibrillation', 'Blood', 'Heart failure', 'High blood pressure', 'Isaac Newton'] },
  'phys/v1': { title: 'Volume 1', toc: [{ title: 'Electric field' }, { title: 'Heart failure' }] },
  'phys/v2': { title: 'Volume 2', toc: [{ title: 'Nuclear fusion' }, { title: 'Solar eclipse' }] },
};
const got = [];
const fetchJSON = async (url) => {
  got.push(url);
  if (!(url in SITE)) throw new Error(`404 ${url}`);
  return structuredClone(SITE[url]);
};

/** An engine with WikiMed's list and Physics' two volumes kept. */
async function filled(options = {}) {
  const engine = new XrefEngine({ fetchJSON, ...options });
  assert.equal(await engine.list('med', 'med/titles.json'), 5);
  assert.equal(await engine.build('med'), 4); // "Blood" is one word
  assert.equal(await engine.volume('phys', 1, 'v2', 'phys/v2'), 2); // in any order
  assert.equal(await engine.volume('phys', 0, 'v1', 'phys/v1'), 2);
  assert.equal(await engine.build('phys'), 4);
  return engine;
}

describe('the titles\' engine', () => {
  it('keeps a list of titles by its volumes, and volumes\' contents, each title with its article\'s place', async () => {
    const engine = await filled();
    assert.deepEqual([...engine.held.keys()], ['med', 'phys']);
    assert.equal(engine.pending.size, 0);
    const med = engine.held.get('med');
    assert.deepEqual(med.books, ['v1', 'v2', 'v3']); // volumes of 2
    assert.deepEqual(med.titles.get('heart failure'), [{ lib: 'med', title: 'Heart failure', ref: PLACES + 0 }]);
    assert.deepEqual(med.titles.get('isaac newton'), [{ lib: 'med', title: 'Isaac Newton', ref: 2 * PLACES + 0 }]);
    const phys = engine.held.get('phys');
    assert.deepEqual(phys.books, ['v1', 'v2']);
    assert.deepEqual(phys.titles.get('solar eclipse'), [{ lib: 'phys', title: 'Solar eclipse', ref: PLACES + 1 }]);
    // Titles given, as the page has them of a library opened in the browser.
    assert.equal(engine.put('own', 0, 'v1', ['Soft palate', 'Hard palate']), 2);
    assert.equal(await engine.build('own'), 2);
    assert.deepEqual(engine.held.get('own').books, ['v1']);
    // Built again, a library's titles are replaced; with nothing got, it has none.
    assert.equal(await engine.build('own'), 0);
  });

  it('finds what pages mention, the first library given offered first, each with its article', async () => {
    const engine = await filled();
    const words = 'Then heart failure and high blood pressure, under a solar eclipse.';
    assert.deepEqual(engine.look({ libs: ['med', 'phys'], parts: pagesOf(p(words)) }), [
      { key: 'heart failure', text: 'heart failure', context: words, lib: 'med', title: 'Heart failure', book: 'v2', n: 0 },
      { key: 'high blood pressure', text: 'high blood pressure', context: words, lib: 'med', title: 'High blood pressure', book: 'v2', n: 1 },
      { key: 'solar eclipse', text: 'solar eclipse', context: words, lib: 'phys', title: 'Solar eclipse', book: 'v2', n: 1 },
    ]);
    assert.deepEqual(engine.look({ libs: ['phys', 'med'], parts: pagesOf(p(words)) }).map((m) => [m.lib, m.book, m.n]), [['phys', 'v1', 1], ['med', 'v2', 1], ['phys', 'v2', 1]]);
    // The book's own library's articles are no link to another; a library not kept is not looked in.
    assert.deepEqual(engine.look({ libs: ['med', 'phys'], own: 'phys', parts: pagesOf(p(words)) }).map((m) => m.title), []);
    assert.deepEqual(engine.look({ libs: ['med', 'phys'], own: 'phys', parts: pagesOf(p('He admired Isaac Newton.')) }).map((m) => m.title), ['Isaac Newton']);
    assert.deepEqual(engine.look({ libs: ['gone', 'phys'], parts: pagesOf(p(words)) }).map((m) => m.lib), ['phys', 'phys']);
    // Each once, whatever part it is on; and only what is on the pages (the text round them counts
    // as company only).
    const two = [{ blocks: [p('Heart failure.'), p('And high blood pressure.')], first: 1, last: 1 }, { blocks: [p('High blood pressure, as Isaac Newton had.')], first: 0, last: 0 }];
    assert.deepEqual(engine.look({ libs: ['med'], parts: two }).map((m) => m.title), ['High blood pressure', 'Isaac Newton']);
    assert.deepEqual(engine.look({ libs: ['med'], parts: [] }), []);
  });

  it('lets go of the libraries that have gone', async () => {
    const engine = await filled();
    engine.put('half', 0, 'v1', ['Soft palate']); // got, not yet kept
    engine.put('gone', 0, 'v1', ['Hard palate']);
    engine.keep(['phys', 'half', 'never']);
    assert.deepEqual([...engine.held.keys()], ['phys']);
    assert.deepEqual([...engine.pending.keys()], ['half']);
  });

  it('says what could not be got', async () => {
    const engine = new XrefEngine({ fetchJSON: async (url) => (url === 'none' ? { volumeSize: 3 } : url === 'meta' ? { title: 'x' } : fetchJSON(url)) });
    await assert.rejects(engine.list('a', 'none'), /no titles in none/);
    await assert.rejects(engine.volume('a', 0, 'v1', 'meta'), /no contents in meta/);
    await assert.rejects(engine.list('a', 'nowhere'), /404 nowhere/);
    assert.equal(engine.held.size, 0);
  });

  it('pauses between slices of its keeping where it shares the page\'s thread, and keeps the same', async () => {
    const titles = Array.from({ length: 40000 }, (_, i) => `Thing ${i} of ${i % 97}`);
    let pauses = 0;
    let longest = 0;
    let since = performance.now();
    const breathe = async () => {
      longest = Math.max(longest, performance.now() - since);
      pauses++;
      await new Promise((r) => setImmediate(r));
      since = performance.now();
    };
    const sliced = new XrefEngine({ fetchJSON: async () => ({ volumeSize: 1000, titles }), breathe });
    await sliced.list('big', 'big');
    since = performance.now();
    assert.equal(await sliced.build('big'), 40000);
    assert.ok(pauses >= 2, `${pauses} pauses`);
    assert.ok(longest < 60, `a slice of ${longest.toFixed(1)} ms`); // 4 ms, and whatever else the machine was doing
    const whole = new XrefEngine({ fetchJSON: async () => ({ volumeSize: 1000, titles }) });
    await whole.list('big', 'big');
    await whole.build('big');
    assert.equal(whole.held.get('big').books.length, 40);
    assert.deepEqual(sliced.held.get('big').books, whole.held.get('big').books);
    assert.deepEqual(sliced.held.get('big').titles.get('thing 39999 of 35'), whole.held.get('big').titles.get('thing 39999 of 35'));
    assert.equal(whole.held.get('big').titles.get('thing 39999 of 35')[0].ref, 39 * PLACES + 999);
  });
});

// ------------------------------------------------------------------------------------------------
// The worker itself, on a stand-in for its scope: what it posts goes to the page's side, and the
// page's messages to it, each copied as a browser copies a message (a function would not go).

const posted = [];
/** Whose call each of the worker's answers is: the one worker serves every page's side made here. */
const calls = new Map();
let callSeq = 0;
const scope = {
  onmessage: null,
  postMessage(message) {
    posted.push(message);
    const call = calls.get(message.id);
    if (!call) return;
    calls.delete(message.id);
    const data = structuredClone({ ...message, id: call.id });
    setImmediate(() => {
      if (call.worker.live) call.worker.onmessage?.({ data });
    });
  },
};

/**
 * A worker as the page sees it, over the real worker's scope. `silent` never says it has started;
 * `fail` cannot be loaded (a browser without module workers).
 */
class FakeWorker {
  constructor({ silent = false, fail = false } = {}) {
    this.onmessage = null;
    this.onerror = null;
    this.live = !silent && !fail;
    this.terminated = false;
    // Loaded: it says so (the real one did as it was loaded here, before any page's side was).
    if (this.live) setImmediate(() => this.onmessage?.({ data: { ready: true } }));
    if (fail) setImmediate(() => this.onerror?.({ message: 'SyntaxError: import declarations may only appear at top level of a module', preventDefault() {} }));
  }

  postMessage(message) {
    const token = `call ${++callSeq}`;
    calls.set(token, { worker: this, id: message.id });
    const data = structuredClone({ ...message, id: token });
    setImmediate(() => {
      if (this.live) scope.onmessage?.({ data });
    });
  }

  terminate() {
    this.terminated = true;
    this.live = false;
  }
}

describe('the titles\' worker', () => {
  const realFetch = globalThis.fetch;
  const realSelf = globalThis.self;
  before(async () => {
    globalThis.fetch = /** @type {any} */ (async (url) => {
      got.push(String(url));
      const data = SITE[String(url)];
      return { ok: !!data, status: data ? 200 : 404, json: async () => structuredClone(data) };
    });
    globalThis.self = /** @type {any} */ (scope);
    await import('../public/js/librarian/xref-worker.js');
  });
  after(() => {
    globalThis.fetch = realFetch;
    globalThis.self = realSelf;
  });

  it('says it has started, and answers the engine\'s calls by message', async () => {
    assert.deepEqual(posted[0], { ready: true });
    const remote = new RemoteEngine(/** @type {any} */ (new FakeWorker()));
    const started = await new Promise((resolve) => { remote.onStart = resolve; });
    assert.equal(started, true);
    assert.equal(await remote.list('med', 'med/titles.json'), 5);
    assert.equal(await remote.build('med'), 4);
    await Promise.all([remote.volume('phys', 0, 'v1', 'phys/v1'), remote.volume('phys', 1, 'v2', 'phys/v2')]);
    assert.equal(await remote.build('phys'), 4);
    assert.equal(await remote.put('own', 0, 'v1', ['Soft palate']), 1);
    assert.equal(await remote.build('own'), 1);
    const words = 'Then heart failure and high blood pressure, under a solar eclipse.';
    assert.deepEqual(await remote.look({ libs: ['med', 'phys'], parts: pagesOf(p(words)) }), [
      { key: 'heart failure', text: 'heart failure', context: words, lib: 'med', title: 'Heart failure', book: 'v2', n: 0 },
      { key: 'high blood pressure', text: 'high blood pressure', context: words, lib: 'med', title: 'High blood pressure', book: 'v2', n: 1 },
      { key: 'solar eclipse', text: 'solar eclipse', context: words, lib: 'phys', title: 'Solar eclipse', book: 'v2', n: 1 },
    ]);
    assert.equal(await remote.keep(['med']), undefined);
    assert.deepEqual((await remote.look({ libs: ['med', 'phys', 'own'], parts: pagesOf(p(words)) })).map((m) => m.lib), ['med', 'med']);
    // What fails says so; what is no call of the engine's is refused.
    await assert.rejects(remote.list('x', 'nowhere'), /404 nowhere/);
    await assert.rejects(remote.call('constructor', []), /no such call: constructor/);
    await assert.rejects(remote.call('held', []), /no such call/);
    remote.stop();
    await assert.rejects(remote.build('med'), /stopped/);
  });

  it('keeps the titles for the page, which gets the same answers as from its own thread', async () => {
    const pg = { id: 'pg', kind: 'gutenberg', title: 'Gutenberg' };
    const med = { id: 'med', kind: 'wikipedia', title: 'WikiMed', articles: 5 };
    const phys = { id: 'phys', kind: 'wikipedia', title: 'Physics', articles: 4 };
    const own = { id: '~own', kind: 'wikipedia', title: 'Opened here', articles: 2 };
    const access = {
      list: (lib) => (lib.id === 'med' ? 'med/titles.json' : null),
      volumes: (lib) => (lib.id === 'phys' ? [{ id: 'v1' }, { id: 'v2' }] : [{ id: 'v1' }]),
      volume: (lib, id) => (lib.id === '~own' ? Promise.resolve(['Soft palate', 'Hard palate']) : `${lib.id}/${id}`),
    };
    const blocks = [p('It raises the risk of high blood pressure and heart failure, as Isaac Newton knew, between the soft palate and the hard palate.')];
    const ask = (shelf) => lookHere({
      book: { libId: 'pg', id: 'b1' }, parts: [{ c: 0, first: 0, last: 0 }], pages: 2, blocksOf: async () => blocks, libraries: [pg, med, phys, own], shelf,
    });
    /** @type {FakeWorker | null} */
    let worker = null;
    const remote = new TitleShelf(access, { engine: () => startEngine({ make: () => (worker = new FakeWorker()) }) });
    const answer = await ask(remote);
    assert.ok(worker && (await remote.engine()) instanceof RemoteEngine);
    assert.equal(answer.text, 'These pages name 5 articles of other libraries.');
    assert.deepEqual(answer.finds.map((f) => [f.lib.id, f.article]), [
      ['med', { title: 'High blood pressure', book: 'v2', n: 1 }], ['med', { title: 'Heart failure', book: 'v2', n: 0 }], ['med', { title: 'Isaac Newton', book: 'v3', n: 0 }],
      ['~own', { title: 'Soft palate', book: 'v1', n: 0 }], ['~own', { title: 'Hard palate', book: 'v1', n: 1 }],
    ]);
    const local = new TitleShelf(access, { engine: () => new XrefEngine({ fetchJSON }) });
    assert.deepEqual(await ask(local), answer);
    // Asked again: nothing more is got.
    const before = got.length;
    assert.deepEqual(await ask(remote), answer);
    assert.equal(got.length, before);
  });

  it('is left for the page\'s thread where none starts, where it fails, and where it stays silent', async () => {
    assert.ok((await startEngine({ make: null })) instanceof XrefEngine);
    assert.ok((await startEngine({ make: () => { throw new Error('no workers here'); } })) instanceof XrefEngine);
    /** @type {FakeWorker[]} */
    const made = [];
    const make = (o) => () => {
      made.push(new FakeWorker(o));
      return /** @type {any} */ (made.at(-1));
    };
    assert.ok((await startEngine({ make: make({ fail: true }) })) instanceof XrefEngine);
    assert.ok((await startEngine({ make: make({ silent: true }), wait: 20 })) instanceof XrefEngine);
    assert.deepEqual(made.map((w) => w.terminated), [true, true]);
    assert.ok((await startEngine({ make: make({}) })) instanceof RemoteEngine);
    // In the page's thread it pauses between slices: it was given the page's breath.
    assert.equal(typeof (/** @type {XrefEngine} */ (await startEngine({ make: null }))).breathe, 'function');
  });

  it('that stops later is replaced by the page\'s thread, and the titles got again', async () => {
    const med = { id: 'med', kind: 'wikipedia', title: 'WikiMed', articles: 5 };
    /** @type {any} */
    let worker = null;
    const shelf = new TitleShelf({ list: () => 'med/titles.json', volumes: () => [], volume: () => '' }, { engine: () => startEngine({ make: () => (worker = new FakeWorker()) }) });
    const at = await shelf.of([med]);
    assert.equal(at.count, 4);
    assert.ok(shelf.has(med));
    worker.onerror({ message: 'out of memory', preventDefault() {} });
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.ok((await shelf.engine()) instanceof XrefEngine);
      assert.ok(!shelf.has(med));
      const again = await shelf.of([med]); // the page's own fetch now (this test's)
      assert.equal(again.count, 4);
      assert.deepEqual((await shelf.mentions(again.libs, pagesOf(p('He admired Isaac Newton.')))).map((m) => m.article.title), ['Isaac Newton']);
    } finally {
      console.warn = warn;
    }
  });

  it('loads only relative modules (a module worker has no import map): itself, the engine and the rule', () => {
    const seen = new Set();
    const visit = (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = fs.readFileSync(file, 'utf8');
      for (const [, spec] of src.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)) {
        assert.ok(spec.startsWith('.'), `${path.basename(file)} imports ${spec}`);
        visit(path.resolve(path.dirname(file), spec));
      }
    };
    visit(fileURLToPath(new URL('../public/js/librarian/xref-worker.js', import.meta.url)));
    assert.deepEqual([...seen].map((f) => path.basename(f)).sort(), ['xref-engine.js', 'xref-worker.js', 'xref.js']);
    // The page names it so that the Pages build tags its address (tools/build-pages.mjs).
    const titles = fs.readFileSync(fileURLToPath(new URL('../public/js/librarian/titles.js', import.meta.url)), 'utf8');
    assert.match(titles, /new Worker\(new URL\('\.\/xref-worker\.js', import\.meta\.url\), \{ type: 'module' \}\)/);
  });
});
