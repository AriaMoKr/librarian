// @ts-check
// The Librarian's model as the page reaches it (docs/LIBRARIAN.md, experiment 2; SPEC §4, §5.10):
// the server's GET api/librarian (which model answers, and whether it can now) and POST
// api/librarian/chat (one turn of a reading: read.js). Only a server started with --ollama has a
// model; a static site (GitHub Pages) has none and is never asked (librarian.js).

/** The site's root, from this module's own URL (js/librarian/model.js), as api.js finds it. */
const ROOT = new URL('../../', import.meta.url);

/**
 * A warm-up at most this often: Ollama keeps a model loaded 30 minutes after a turn
 * (server/librarian.js KEEP_ALIVE).
 */
export const WARM_EVERY = 10 * 60 * 1000;

/** How long after asking about the model, at least, it is asked again (it could not answer then). */
export const ASK_AGAIN_AFTER = 10 * 1000;

/**
 * The server's model.
 * @typedef {{ model: string, ready: boolean, error?: string }} ModelInfo
 */

export class ServerModel {
  /**
   * @param {object} [o]
   * @param {typeof fetch} [o.fetch]
   * @param {URL | string} [o.root] the site's root
   * @param {() => number} [o.now]
   */
  constructor({ fetch = (...a) => globalThis.fetch(...a), root = ROOT, now = () => Date.now() } = {}) {
    this._fetch = fetch;
    this.root = String(root);
    this._now = now;
    /** When the last warm-up went (0: none, or it failed). */
    this._warmedAt = 0;
    /** When the model was last asked about. */
    this._askedAt = -Infinity;
  }

  /**
   * The server's model: null where there is none (a server without --ollama answers 404), or when
   * the server cannot be reached.
   * @returns {Promise<ModelInfo | null>}
   */
  async info() {
    this._askedAt = this._now();
    try {
      const res = await this._fetch(new URL('api/librarian', this.root), { cache: 'no-store' });
      if (!res.ok) return null;
      const info = await res.json();
      return typeof info?.model === 'string' ? { model: info.model, ready: !!info.ready, ...(info.error ? { error: String(info.error) } : {}) } : null;
    } catch {
      return null;
    }
  }

  /** Whether the model may be asked about again now (it could not answer when last asked). */
  get mayAskAgain() {
    return this._now() - this._askedAt >= ASK_AGAIN_AFTER;
  }

  /**
   * One turn of a reading (read.js Chat): the model's reply, or an Error saying what failed (the
   * server's words: never the question).
   * @param {object[]} messages
   * @param {object[]} tools
   * @param {{ signal?: AbortSignal }} [o]
   * @returns {Promise<import('./read.js').Turn>}
   */
  async chat(messages, tools, { signal } = {}) {
    return this._post({ messages, tools }, signal);
  }

  /**
   * The instructions and the tools read before the first question (one token written), at most
   * every WARM_EVERY: as the question box takes the focus, and as reading is chosen.
   * @param {{ messages: object[], tools: object[] }} turn read.js warmTurn
   * @returns {Promise<boolean>} whether it went (false: too soon after the last, or it failed)
   */
  async warm(turn) {
    if (this._warmedAt && this._now() - this._warmedAt < WARM_EVERY) return false;
    this._warmedAt = this._now();
    try {
      await this._post({ ...turn, warm: true });
      return true;
    } catch (err) {
      this._warmedAt = 0; // the next focus tries again
      console.warn('[librarian] warm-up', /** @type {Error} */ (err).message);
      return false;
    }
  }

  /** @param {object} body @param {AbortSignal} [signal] */
  async _post(body, signal) {
    const res = await this._fetch(new URL('api/librarian/chat', this.root), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const text = await res.text();
    /** @type {any} */
    let value = null;
    try {
      value = JSON.parse(text);
    } catch { /* not JSON */ }
    if (!res.ok) throw new Error(`the model could not answer (${res.status}${value?.error ? `: ${value.error}` : ''})`);
    if (!value?.message) throw new Error('the model\'s answer was not understood');
    return value;
  }
}
