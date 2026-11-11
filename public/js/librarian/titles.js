// @ts-check
// The libraries' titles at hand (docs/LIBRARIAN.md, experiment 3 step 2; SPEC §5.10). To tell what
// a page names that another library has an article on (xref.js), every run of words on it is tried
// against the other libraries' titles: some 1,300 runs for two pages, far too many to ask a library
// about one by one. So a library's titles are got once, when first wanted, and kept (those of two
// words or more: a topic's are a few hundred kB), and nothing is asked of it after.
// How they are got is the keeper's (librarian.js): a static site's list of them, else volume by
// volume, a volume's contents being its articles' titles. Nothing is got before someone asks what
// a page mentions.

import { Titles } from './xref.js';

/** A library with more articles than this is left out: its titles would be no short list. */
export const MOST_ARTICLES = 200000;
/** Volumes whose titles are got at once. */
const AT_ONCE = 4;
/** A title's place, kept as one number: its volume's index times this, plus its chunk. */
const PLACES = 65536;

/**
 * @typedef {{ id: string, kind?: string, title?: string, articles?: number, indexing?: unknown }} Lib
 *   a library of the catalogue
 */

/**
 * @typedef {object} TitlesAccess how a library's article titles are got (the page's: librarian.js)
 * @property {(lib: Lib) => Promise<{ volumeSize: number, titles: string[] } | null>} list all of
 *   them in the library's order, where the site keeps such a list (a static site's titles.json);
 *   null where it keeps none
 * @property {(lib: Lib) => Array<{ id: string }> | Promise<Array<{ id: string }>>} volumes its
 *   volumes, in order
 * @property {(lib: Lib, volume: string) => Promise<string[]>} volume a volume's articles' titles,
 *   in order: its chunks'
 */

/**
 * @typedef {object} Held a library's titles, each with where its article is
 * @property {Lib} lib
 * @property {Titles} titles each title's ref: its volume's index in `books` × PLACES + its chunk
 * @property {string[]} books the volumes' ids
 */

/**
 * @typedef {object} AtHand the titles of some libraries, as xref.js's matchesIn takes them
 * @property {(key: string) => import('./xref.js').Entry[] | undefined} get the titles of those
 *   words, of every library at hand
 * @property {(entry: import('./xref.js').Entry) => { lib: Lib, article: { title: string, book: string, n: number } } | null} articleOf
 *   a title's article: its library, and its volume and chunk there
 * @property {Lib[]} failed the libraries whose titles could not be got
 * @property {number} count how many titles are at hand
 */

export class TitleShelf {
  /**
   * @param {TitlesAccess} access
   * @param {{ most?: number }} [options] most: the most articles a library may have
   */
  constructor(access, { most = MOST_ARTICLES } = {}) {
    this.access = access;
    this.most = most;
    /** @type {Map<string, Promise<Held>>} got, or being got */
    this._held = new Map();
    /** @type {Set<string>} got */
    this._ready = new Set();
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
  }

  /**
   * The titles of libraries, those not at hand yet got first, all at once (a library read over
   * the network takes a while). Kept in the order given: where two libraries have an article of
   * one name, the first is the one offered.
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
    /** @type {Held[]} */
    const held = [];
    /** @type {Lib[]} */
    const failed = [];
    for (let i = 0; i < libraries.length; i++) {
      const lib = libraries[i];
      try {
        const h = await getting[i];
        // Let go of meanwhile (keep): at hand for this answer all the same.
        if (this._held.get(lib.id) === getting[i]) this._ready.add(lib.id);
        held.push(h);
      } catch (err) {
        console.warn('[librarian] titles', lib.id, /** @type {Error} */ (err)?.message ?? err);
        failed.push(lib);
      }
    }
    return {
      failed,
      count: held.reduce((n, h) => n + h.titles.count, 0),
      get(key) {
        /** @type {import('./xref.js').Entry[] | undefined} */
        let out;
        for (const h of held) {
          const entries = h.titles.get(key);
          if (entries) out = out ? out.concat(entries) : entries;
        }
        return out;
      },
      articleOf(entry) {
        const h = held.find((x) => x.lib.id === entry.lib);
        const book = h?.books[Math.floor(entry.ref / PLACES)];
        return h && book !== undefined ? { lib: h.lib, article: { title: entry.title, book, n: entry.ref % PLACES } } : null;
      },
    };
  }

  /**
   * Gets a library's titles: the site's list of them, else its volumes' contents, a few volumes at
   * a time.
   * @param {Lib} lib
   * @returns {Promise<Held>}
   */
  async _get(lib) {
    const titles = new Titles();
    /** @type {string[]} */
    const books = [];
    const list = await this.access.list(lib);
    if (list) {
      const size = Math.max(1, Math.min(PLACES, list.volumeSize | 0));
      for (let i = 0; i < list.titles.length; i++) {
        const k = Math.floor(i / size);
        if (books.length <= k) books.push(`v${k + 1}`);
        titles.add(lib.id, list.titles[i], k * PLACES + (i % size));
      }
      return { lib, titles, books };
    }
    const volumes = await this.access.volumes(lib);
    /** @type {string[][]} */
    const lists = new Array(volumes.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, volumes.length) }, async () => {
      while (next < volumes.length) {
        const k = next++;
        lists[k] = await this.access.volume(lib, volumes[k].id);
      }
    }));
    for (let k = 0; k < volumes.length; k++) {
      books.push(volumes[k].id);
      const of = lists[k];
      for (let n = 0; n < of.length && n < PLACES; n++) titles.add(lib.id, of[n], k * PLACES + n);
    }
    return { lib, titles, books };
  }
}
