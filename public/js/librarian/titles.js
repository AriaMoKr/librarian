// @ts-check
// The libraries' titles at hand (docs/LIBRARIAN.md, experiment 3 steps 2 and 4; SPEC §5.10). To
// tell what a page names that another library has an article on (xref.js), every run of words on
// it is tried against the other libraries' titles: some 1,300 runs for two pages, far too many to
// ask a library about one by one. So a library's titles are got once, when first wanted, and kept
// (those of two words or more: a topic's are a few hundred kB), and nothing is asked of it after.
// Nothing is got before someone asks what a page mentions.
// - Where they are kept: an engine (xref-engine.js), in a module worker where one starts
//   (xref-worker.js), so that in a headset neither a list's parsing nor the keeping takes a frame's
//   time, and the titles are no weight on the page's memory; else in the page, in slices.
// - How they are got is the keeper's (librarian.js): the address of a static site's list of them,
//   else volume by volume, a volume's contents being its articles' titles: the address of its
//   contents (the engine gets it), or the titles themselves where only the page can read them (a
//   library opened in this browser).

import { XrefEngine } from './xref-engine.js';

/** A library with more articles than this is left out: its titles would be no short list. */
export const MOST_ARTICLES = 200000;
/** Volumes whose titles are got at once. */
const AT_ONCE = 4;
/** ms a worker gets to say it has started, before the page keeps the titles itself. */
const START_WAIT = 5000;

/** @typedef {import('./xref-engine.js').Engine} Engine */
/** @typedef {import('./xref-engine.js').Part} Part */

/**
 * @typedef {{ id: string, kind?: string, title?: string, articles?: number, indexing?: unknown }} Lib
 *   a library of the catalogue
 */

/**
 * @typedef {object} TitlesAccess how a library's article titles are got (the page's: librarian.js)
 * @property {(lib: Lib) => string | null} list the address of all of them in the library's order,
 *   where the site keeps such a list (a static site's titles.json: { volumeSize, titles }); null
 *   where it keeps none
 * @property {(lib: Lib) => Array<{ id: string }> | Promise<Array<{ id: string }>>} volumes its
 *   volumes, in order
 * @property {(lib: Lib, volume: string) => string | Promise<string[]>} volume a volume's articles'
 *   titles, in order: the address of its contents (the server's book route, whose `toc` has
 *   them), or the titles themselves
 */

/**
 * @typedef {object} AtHand the libraries whose titles are at hand for an answer
 * @property {Lib[]} libs those got, in the order asked for: where two have an article of one name,
 *   the first is the one offered
 * @property {Lib[]} failed those whose titles could not be got
 * @property {number} count how many titles are at hand
 */

/**
 * @typedef {object} Named an article the pages name
 * @property {string} key the name's words in lower case (xref.js keyOf)
 * @property {string} text the words as the page has them
 * @property {string} context the words round them there
 * @property {Lib} lib the article's library
 * @property {{ title: string, book: string, n: number }} article its volume and its chunk there
 */

/**
 * A pause for the page between slices of the engine's work, where they share a thread.
 * @type {() => Promise<void>}
 */
const breathe = () => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

/** The engine in this thread, pausing between slices of its keeping. */
export const inlineEngine = () => new XrefEngine({ breathe });

/**
 * The engine in a worker: its calls as messages ({ id, method, args }), answered later.
 * @implements {Engine}
 */
export class RemoteEngine {
  /** @param {Worker} worker xref-worker.js */
  constructor(worker) {
    this.worker = worker;
    /** @type {Map<number, { resolve: (value: any) => void, reject: (err: Error) => void }>} */
    this.pending = new Map();
    this.seq = 0;
    /** Set once the worker has failed: it answers no more. @type {Error | null} */
    this.failed = null;
    /** Told once it has started, or failed. @type {((ok: boolean) => void) | null} */
    this.onStart = null;
    worker.onmessage = ({ data }) => {
      if (data?.ready) {
        this.onStart?.(true);
        return;
      }
      const p = this.pending.get(data?.id);
      if (!p) return;
      this.pending.delete(data.id);
      if ('error' in data) p.reject(new Error(data.error));
      else p.resolve(data.value);
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      this.failed = new Error(e.message || 'the titles’ worker stopped');
      for (const p of this.pending.values()) p.reject(this.failed);
      this.pending.clear();
      this.onStart?.(false);
    };
  }

  /**
   * @param {string} method
   * @param {unknown[]} args
   * @returns {Promise<any>}
   */
  call(method, args) {
    if (this.failed) return Promise.reject(this.failed);
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, method, args });
    });
  }

  /** @param {string} lib @param {string} url @returns {Promise<number>} */
  list(lib, url) {
    return this.call('list', [lib, url]);
  }

  /** @param {string} lib @param {number} k @param {string} id @param {string} url @returns {Promise<number>} */
  volume(lib, k, id, url) {
    return this.call('volume', [lib, k, id, url]);
  }

  /** @param {string} lib @param {number} k @param {string} id @param {string[]} titles @returns {Promise<number>} */
  put(lib, k, id, titles) {
    return this.call('put', [lib, k, id, titles]);
  }

  /** @param {string} lib @returns {Promise<number>} */
  build(lib) {
    return this.call('build', [lib]);
  }

  /** @param {string[]} libs @returns {Promise<void>} */
  keep(libs) {
    return this.call('keep', [libs]);
  }

  /** @param {{ libs: string[], own?: string | null, parts: Part[] }} o @returns {Promise<import('./xref-engine.js').Looked[]>} */
  look(o) {
    return this.call('look', [o]);
  }

  /** Stops the worker; what it was asked is answered with a failure. */
  stop() {
    this.failed ??= new Error('the titles’ worker was stopped');
    for (const p of this.pending.values()) p.reject(this.failed);
    this.pending.clear();
    this.worker.terminate();
  }
}

/**
 * Starts the engine: in a module worker where one starts and says so in time, else in this thread.
 * @param {object} [o]
 * @param {(() => Worker) | null} [o.make] makes the worker (a test's stand-in); null: none
 * @param {number} [o.wait] ms it gets to say it has started
 * @returns {Promise<Engine>}
 */
export function startEngine({
  make = typeof Worker === 'undefined' ? null : () => new Worker(new URL('./xref-worker.js', import.meta.url), { type: 'module' }),
  wait = START_WAIT,
} = {}) {
  if (!make) return Promise.resolve(inlineEngine());
  return new Promise((resolve) => {
    /** @type {RemoteEngine} */
    let remote;
    try {
      remote = new RemoteEngine(make());
    } catch {
      resolve(inlineEngine());
      return;
    }
    const timer = setTimeout(() => remote.onStart?.(false), wait);
    remote.onStart = (ok) => {
      remote.onStart = null;
      clearTimeout(timer);
      if (ok) return resolve(remote);
      remote.stop();
      resolve(inlineEngine());
    };
  });
}

export class TitleShelf {
  /**
   * @param {TitlesAccess} access
   * @param {object} [options]
   * @param {number} [options.most] the most articles a library may have
   * @param {() => Engine | Promise<Engine>} [options.engine] starts where the titles are kept, the
   *   first time they are wanted (librarian.js: startEngine, a worker); this thread's otherwise
   */
  constructor(access, { most = MOST_ARTICLES, engine = inlineEngine } = {}) {
    this.access = access;
    this.most = most;
    this._start = engine;
    /** The engine, once started. @type {Promise<Engine> | null} */
    this._engine = null;
    /** @type {Map<string, Promise<number>>} got, or being got: how many titles */
    this._held = new Map();
    /** @type {Set<string>} got */
    this._ready = new Set();
  }

  /**
   * The engine, started when first wanted. One that has stopped (a worker's failure) is replaced
   * by this thread's, and the titles are got again.
   * @returns {Promise<Engine>}
   */
  async engine() {
    let engine = await (this._engine ??= Promise.resolve(this._start()));
    if (engine.failed) {
      this._held.clear();
      this._ready.clear();
      engine = inlineEngine();
      this._engine = Promise.resolve(engine);
    }
    return engine;
  }

  /**
   * Whether a library has articles whose titles can be kept: a Wikipedia, its index made, not too
   * large.
   * @param {Lib} lib
   */
  canHold(lib) {
    return lib.kind === 'wikipedia' && !lib.indexing && (lib.articles ?? 0) <= this.most;
  }

  /** Whether a library's titles are at hand already. @param {Lib} lib */
  has(lib) {
    return this._ready.has(lib.id);
  }

  /**
   * Lets go of the titles of libraries no longer in the catalogue.
   * @param {Lib[]} libraries the catalogue's
   */
  keep(libraries) {
    const ids = new Set(libraries.map((l) => l.id));
    for (const id of [...this._held.keys()]) {
      if (ids.has(id)) continue;
      this._held.delete(id);
      this._ready.delete(id);
    }
    // The engine lets go of them too, and of any it came to keep for a library that had gone
    // meanwhile; one that has not started keeps none.
    this._engine?.then((engine) => engine.keep([...ids])).catch(() => {});
  }

  /**
   * Has the titles of libraries at hand, those not there yet got first, all at once (a library
   * read over the network takes a while).
   * @param {Lib[]} libraries
   * @param {{ onGetting?: (libraries: Lib[]) => void }} [options] onGetting: told, once, which
   *   libraries' titles are waited for (not when all are at hand)
   * @returns {Promise<AtHand>}
   */
  async of(libraries, { onGetting } = {}) {
    const waited = libraries.filter((lib) => !this._ready.has(lib.id));
    if (waited.length) onGetting?.(waited);
    const getting = libraries.map((lib) => {
      const had = this._held.get(lib.id);
      if (had) return had;
      const made = this._get(lib);
      this._held.set(lib.id, made);
      // Not got: asked for again the next time.
      made.catch(() => {
        if (this._held.get(lib.id) === made) this._held.delete(lib.id);
      });
      return made;
    });
    /** @type {Lib[]} */
    const libs = [];
    /** @type {Lib[]} */
    const failed = [];
    let count = 0;
    for (let i = 0; i < libraries.length; i++) {
      const lib = libraries[i];
      try {
        count += await getting[i];
        // Let go of meanwhile (keep): at hand for this answer all the same.
        if (this._held.get(lib.id) === getting[i]) this._ready.add(lib.id);
        libs.push(lib);
      } catch (err) {
        console.warn('[librarian] titles', lib.id, /** @type {Error} */ (err)?.message ?? err);
        failed.push(lib);
      }
    }
    return { libs, failed, count };
  }

  /**
   * The articles that pages name (xref.js's rule), each once, in the pages' order.
   * @param {Lib[]} libs the libraries whose titles are at hand (of), in the order to offer them
   * @param {Part[]} parts the pages' blocks with the text round them (here.js)
   * @param {{ own?: string | null }} [options] own: the id of the book's own library, when its
   *   titles are among them
   * @returns {Promise<Named[]>}
   */
  async mentions(libs, parts, { own = null } = {}) {
    if (!libs.length || !parts.length) return [];
    const engine = await this.engine();
    const byId = new Map(libs.map((l) => [l.id, l]));
    /** @type {Named[]} */
    const out = [];
    for (const m of await engine.look({ libs: libs.map((l) => l.id), own, parts })) {
      const lib = byId.get(m.lib);
      if (lib) out.push({ key: m.key, text: m.text, context: m.context, lib, article: { title: m.title, book: m.book, n: m.n } });
    }
    return out;
  }

  /**
   * Gets a library's titles into the engine: the site's list of them, else its volumes' contents,
   * a few volumes at a time; then they are kept, in the library's order.
   * @param {Lib} lib
   * @returns {Promise<number>} how many are kept
   */
  async _get(lib) {
    const engine = await this.engine();
    const list = this.access.list(lib);
    if (list) await engine.list(lib.id, list);
    else {
      const volumes = await this.access.volumes(lib);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(AT_ONCE, volumes.length) }, async () => {
        while (next < volumes.length) {
          const k = next++;
          const id = volumes[k].id;
          const from = this.access.volume(lib, id);
          if (typeof from === 'string') await engine.volume(lib.id, k, id, from);
          else await engine.put(lib.id, k, id, await from);
        }
      }));
    }
    return engine.build(lib.id);
  }
}
