// @ts-check
// Where the libraries' titles are kept and a page's words are tried against them (docs/LIBRARIAN.md,
// experiment 3 step 4; SPEC §5.10).
// In a headset nothing heavy may run in one frame (13.9 ms at 72 Hz), and the titles are heavy:
// measured on the development PC, keeping WikiMed's 71,518 takes 131 ms and parsing their list
// 8 ms, a spread's matching 3 ms, and the demo set's 110,000 are some 14 MB of small objects, which
// the page's garbage collector would walk at every full collection. So the engine runs in a module
// worker (xref-worker.js): it gets the lists itself, keeps the titles in its own memory and
// answers with the few mentions a page has. Where no module worker starts, the same engine runs
// in the page (titles.js startEngine), pausing between slices of its keeping (`breathe`).
// It imports xref.js alone: a module worker has no import map (a test checks).

import { mentionsOn, Titles } from './xref.js';

/** A title's place, kept as one number: its volume's index times this, plus its chunk. */
export const PLACES = 65536;
/** ms of keeping titles between two pauses, where the engine shares the page's thread. */
const SLICE_MS = 4;

/**
 * @typedef {object} Part some pages' blocks in one part of the book, with the text round them
 * @property {any[]} blocks §3.5 blocks: the pages' and their neighbours' (xref.js windowOf)
 * @property {number} first the pages' first block among them
 * @property {number} last their last
 */

/**
 * @typedef {object} Looked a mention found, with its article
 * @property {string} key the words in lower case (xref.js keyOf)
 * @property {string} text the words as the page has them
 * @property {string} context the words round them there
 * @property {string} lib the article's library: the first given that has one of that name
 * @property {string} title the article's title
 * @property {string} book its volume
 * @property {number} n its chunk there
 */

/**
 * @typedef {object} Engine the engine's calls: this class in the page, or a worker's answers to them
 *   (titles.js RemoteEngine), so each may answer at once or later
 * @property {(lib: string, url: string) => number | Promise<number>} list
 * @property {(lib: string, k: number, id: string, url: string) => number | Promise<number>} volume
 * @property {(lib: string, k: number, id: string, titles: string[]) => number | Promise<number>} put
 * @property {(lib: string) => number | Promise<number>} build
 * @property {(libs: string[]) => void | Promise<void>} keep
 * @property {(o: { libs: string[], own?: string | null, parts: Part[] }) => Looked[] | Promise<Looked[]>} look
 * @property {Error | null} [failed] set once it can answer no more (a worker that stopped)
 */

/** @param {string} url */
async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

export class XrefEngine {
  /**
   * @param {object} [o]
   * @param {(url: string) => Promise<any>} [o.fetchJSON] gets a list or a volume's contents
   * @param {(() => Promise<void>) | null} [o.breathe] a pause between slices of keeping titles,
   *   where the page's thread is shared; none in a worker
   */
  constructor({ fetchJSON = getJSON, breathe = null } = {}) {
    this.fetchJSON = fetchJSON;
    this.breathe = breathe;
    /** The titles kept, by library. @type {Map<string, { titles: Titles, books: string[] }>} */
    this.held = new Map();
    /**
     * Titles got and not yet kept: a library's whole list, or its volumes' as they come.
     * @type {Map<string, { size: number, list: string[] | null, volumes: Array<{ id: string, titles: string[] } | undefined> }>}
     */
    this.pending = new Map();
  }

  /** @param {string} lib */
  _pending(lib) {
    let p = this.pending.get(lib);
    if (!p) this.pending.set(lib, p = { size: 0, list: null, volumes: [] });
    return p;
  }

  /**
   * Gets a library's list of titles, all of them in its order (a static site's titles.json:
   * { volumeSize, titles }).
   * @param {string} lib its id
   * @param {string} url
   * @returns {Promise<number>} how many titles came
   */
  async list(lib, url) {
    const data = await this.fetchJSON(url);
    if (!Array.isArray(data?.titles)) throw new Error(`no titles in ${url}`);
    const p = this._pending(lib);
    p.list = data.titles;
    p.size = Math.max(1, Math.min(PLACES, data.volumeSize | 0));
    return data.titles.length;
  }

  /**
   * Gets a volume's titles: its contents are its articles' titles, in order (the server's book
   * route, SPEC §4: `toc`).
   * @param {string} lib
   * @param {number} k the volume's place among the library's
   * @param {string} id the volume's id
   * @param {string} url
   * @returns {Promise<number>}
   */
  async volume(lib, k, id, url) {
    const meta = await this.fetchJSON(url);
    if (!Array.isArray(meta?.toc)) throw new Error(`no contents in ${url}`);
    return this.put(lib, k, id, meta.toc.map((/** @type {{ title?: unknown }} */ e) => String(e?.title ?? '')));
  }

  /**
   * A volume's titles, given (a library opened in the browser: the page has them of its worker).
   * @param {string} lib
   * @param {number} k
   * @param {string} id
   * @param {string[]} titles
   * @returns {number}
   */
  put(lib, k, id, titles) {
    this._pending(lib).volumes[k] = { id, titles };
    return titles.length;
  }

  /**
   * Keeps the titles got of a library by their words, in its order (where two of its articles
   * have one name's words, the first is the first offered); what it held before is replaced.
   * @param {string} lib
   * @returns {Promise<number>} how many are kept (those of two words or more)
   */
  async build(lib) {
    const p = this.pending.get(lib);
    this.pending.delete(lib);
    const titles = new Titles();
    /** @type {string[]} */
    const books = [];
    // Where the thread is the page's: a pause once a slice has taken its time (looked at every
    // 64 titles), so no frame waits for a library's worth.
    const breathe = this.breathe;
    let since = performance.now();
    let done = 0;
    const due = () => !(++done % 64) && performance.now() - since >= SLICE_MS;
    if (p?.list) {
      for (let i = 0; i < p.list.length; i++) {
        const k = Math.floor(i / p.size);
        if (books.length <= k) books.push(`v${k + 1}`);
        titles.add(lib, p.list[i], k * PLACES + (i % p.size));
        if (breathe && due()) {
          await breathe();
          since = performance.now();
        }
      }
    } else if (p) {
      for (let k = 0; k < p.volumes.length; k++) {
        const v = p.volumes[k];
        books.push(v?.id ?? '');
        if (!v) continue;
        for (let n = 0; n < v.titles.length && n < PLACES; n++) {
          titles.add(lib, v.titles[n], k * PLACES + n);
          if (breathe && due()) {
            await breathe();
            since = performance.now();
          }
        }
      }
    }
    this.held.set(lib, { titles, books });
    return titles.count;
  }

  /**
   * Lets go of every library's titles but these (the catalogue's now).
   * @param {string[]} libs
   */
  keep(libs) {
    const ids = new Set(libs);
    for (const id of [...this.held.keys()]) if (!ids.has(id)) this.held.delete(id);
    for (const id of [...this.pending.keys()]) if (!ids.has(id)) this.pending.delete(id);
  }

  /**
   * The mentions on pages (xref.js mentionsOn), each once, in the pages' order, with the article
   * each leads to: of the libraries given, in their order, those whose titles are kept.
   * @param {object} o
   * @param {string[]} o.libs
   * @param {string | null} [o.own] the id of the book's own library, when its titles are among them
   * @param {Part[]} o.parts
   * @returns {Looked[]}
   */
  look({ libs, own = null, parts }) {
    const held = libs.map((id) => this.held.get(id)).filter((h) => !!h);
    const titles = {
      /** @param {string} key */
      get(key) {
        /** @type {import('./xref.js').Entry[] | undefined} */
        let out;
        for (const h of held) {
          const entries = h.titles.get(key);
          if (entries) out = out ? out.concat(entries) : entries;
        }
        return out;
      },
    };
    /** @type {Map<string, import('./xref.js').Mention>} */
    const found = new Map();
    for (const part of parts) {
      for (const m of mentionsOn(part.blocks, part.first, part.last, titles, { own })) {
        if (!found.has(m.key)) found.set(m.key, m);
      }
    }
    /** @type {Looked[]} */
    const out = [];
    for (const m of found.values()) {
      const e = m.entries[0];
      const book = this.held.get(e.lib)?.books[Math.floor(e.ref / PLACES)];
      if (book) out.push({ key: m.key, text: m.text, context: m.context, lib: e.lib, title: e.title, book, n: e.ref % PLACES });
    }
    return out;
  }
}
