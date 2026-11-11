// @ts-check
// The librarian in the library card (SPEC §5.10; docs/LIBRARIAN.md, experiments 1 and 2): "Ask the
// librarian", a question box and its Ask button; the answer under them, a polite status said once,
// when it is complete; and what was found, each a button that takes you there. When he reads the
// books for his answers (experiment 2: librarian.js), what the library's own search found comes
// first, at once (when it found something), and what he is doing shows under it while he reads on;
// his reading's answer then replaces it, its sentences carrying the numbers of their sources,
// which are the finds. A newer question stops the reading, and so does taking one of the first
// answer's finds.
// On a TV the remote steps through it as through the rest of the card (ui/remote.js); an answer's
// first find takes the focus from its question there, so OK takes you to it. A find with the focus
// as the answer is replaced keeps it, or gives it to the first of the new.

import { imageSource } from '../api.js';
import { findLines, PROMPT, PROMPT_READING } from './ask.js';

/** ms before "Looking…" is shown and said: a quick answer comes alone. */
const LOOKING_AFTER = 400;

/** What the librarian says when the looking itself failed. */
export const FAILED = 'I could not look just now.';

/**
 * @param {Pick<Document, 'createElement' | 'createTextNode'>} doc
 * @param {string} cls
 * @param {string} text
 */
function span(doc, cls, text) {
  const el = doc.createElement('span');
  el.setAttribute('class', cls);
  el.append(doc.createTextNode(text));
  return el;
}

/**
 * The finds as a list, each a button holding its title, the line under it and "Take me there": one
 * stop for a TV's remote, one target for a finger. A cover (a book's) or its library's picture is
 * named by data-src and loaded once the list is in the page (fillImages). A reading's sources are
 * numbered, as his sentences cite them.
 * @param {Pick<Document, 'createElement' | 'createTextNode'>} doc
 * @param {import('./ask.js').Find[]} finds
 * @param {{ multi: boolean, numbered?: boolean, take: (find: import('./ask.js').Find, button: HTMLElement) => void }} o
 *   multi: more than one library has books (a book's line names its library)
 */
export function findList(doc, finds, { multi, numbered = false, take }) {
  const list = doc.createElement('ul');
  list.setAttribute('class', 'lb-finds');
  list.setAttribute('aria-label', numbered ? 'Where the librarian read it' : 'What the librarian found');
  for (const [i, find] of finds.entries()) {
    const { title, line, snippet } = findLines(find, multi);
    const button = doc.createElement('button');
    button.setAttribute('type', 'button');
    button.setAttribute('class', 'lb-find');
    if (numbered) button.append(span(doc, 'lb-num', String(i + 1)));
    // A book's cover, or a blank; a place in one, its cover or its library's picture.
    const cover = find.kind === 'book' ? find.book.cover : find.kind === 'passage' ? find.cover : null;
    const picture = find.kind === 'book' ? cover : cover || find.lib.illustration;
    if (picture) {
      const img = doc.createElement('img');
      img.setAttribute('class', cover ? 'lb-cover' : 'lb-icon');
      img.setAttribute('alt', '');
      img.setAttribute('width', '34');
      img.setAttribute('height', cover ? '48' : '34');
      img.setAttribute('data-src', String(picture));
      button.append(img);
    } else {
      button.append(span(doc, 'lb-nocover', ''));
    }
    const text = doc.createElement('span');
    text.setAttribute('class', 'lb-find-text');
    text.append(span(doc, 'lb-find-title', title));
    if (line) text.append(span(doc, 'lb-find-line', line));
    if (snippet) {
      const words = span(doc, 'lb-find-snip', '');
      for (const [part, hit] of snippet) {
        if (!hit) {
          words.append(doc.createTextNode(part));
          continue;
        }
        const b = doc.createElement('b');
        b.append(doc.createTextNode(part));
        words.append(b);
      }
      text.append(words);
    }
    button.append(text, span(doc, 'lb-find-go', 'Take me there'));
    button.addEventListener('click', () => take(find, button));
    const item = doc.createElement('li');
    item.append(button);
    list.append(item);
  }
  return list;
}

/**
 * Loads the pictures a list names (data-src): a local library's through api.imageSource (a blob
 * URL, let go of once loaded), as the search's results do.
 * @param {HTMLElement} root
 */
export function fillImages(root) {
  for (const img of /** @type {NodeListOf<HTMLImageElement>} */ (root.querySelectorAll('img[data-src]'))) {
    const url = img.dataset.src ?? '';
    img.removeAttribute('data-src');
    imageSource(url).then((source) => {
      if (!source.url) return;
      img.onload = img.onerror = () => source.release();
      img.src = source.url;
    }).catch(() => {});
  }
}

/** Whether the screen is touched (a phone's keyboard covers the answer while the box has the focus). */
const coarse = () => !!globalThis.matchMedia?.('(pointer: coarse)').matches;

/** Whether two answers' finds are the same finds, in the same order (the list shown can stay). @param {readonly unknown[]} a @param {readonly unknown[]} b */
const sameFinds = (a, b) => a.length === b.length && a.every((f, i) => f === b[i]);

/** Said after a first answer, not seen (the line under it shows what he is doing). */
const READING_ON = 'I am reading for an answer.';

/** The question box's hint: what to ask him; with his reading, a question too. */
const PLACEHOLDER = 'A title, an author or a subject';
const PLACEHOLDER_READING = 'A question, a title, an author or a subject';

/**
 * How the card asks: the question, a signal that stops it (a newer question), what he is doing
 * meanwhile (his reading's steps), and an answer to show at once while he reads on (onFirst: the
 * library's own search's), which the one it resolves to replaces.
 * @typedef {(text: string, o: { signal: AbortSignal, onStep: (text: string) => void, onFirst: (answer: import('./ask.js').Answer) => void }) => Promise<import('./ask.js').Answer>} Ask
 */

export class LibrarianCard {
  /**
   * @param {object} o
   * @param {Ask} o.ask
   * @param {(find: import('./ask.js').Find) => unknown} o.take takes the visitor to a find
   * @param {() => boolean} o.multi whether more than one library has books
   * @param {boolean} [o.tv] a TV: an answer's first find takes the focus from its question
   */
  constructor({ ask, take, multi, tv = false }) {
    this._ask = ask;
    this._take = take;
    this._multi = multi;
    this.tv = tv;
    /** The question being answered (a newer one wins). */
    this._token = 0;
    /** Stops the question being answered (its reading). @type {AbortController | null} */
    this._asking = null;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this._lookingTimer = undefined;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this._sayTimer = undefined;
    /** @type {import('./ask.js').Answer | null} the answer shown */
    this.answer = null;
    /**
     * Told as a question goes off, and as its answer is shown (or taken away: null): the
     * librarian's panel in VR (desk.js), which says the same.
     * @type {(() => void) | null}
     */
    this.onLooking = null;
    /** @type {((answer: import('./ask.js').Answer | null) => void) | null} */
    this.onAnswer = null;
    /** Told what he is doing while he reads ('' as it ends). @type {((step: string) => void) | null} */
    this.onStep = null;
    const el = document.createElement('div');
    el.className = 'lb-ask';
    el.innerHTML = `
      <form class="lb-form">
        <label class="lb-label" for="lb-q">Ask the librarian</label>
        <div class="lb-row">
          <input class="lb-q" id="lb-q" type="search" name="q" enterkeyhint="search" autocomplete="off" spellcheck="false"
            placeholder="${PLACEHOLDER}">
          <button class="lb-go" type="submit">Ask</button>
        </div>
      </form>
      <p class="lb-answer" role="status"></p>
      <p class="lb-step" aria-hidden="true" hidden></p>
      <ul class="lb-finds" aria-label="What the librarian found" hidden></ul>`;
    /** The card's part: put into the library card by librarian.js. */
    this.el = el;
    this.input = /** @type {HTMLInputElement} */ (el.querySelector('.lb-q'));
    this._answerEl = /** @type {HTMLElement} */ (el.querySelector('.lb-answer'));
    // What he is doing while he reads: seen, not said (the status says "Looking…" once).
    this._stepEl = /** @type {HTMLElement} */ (el.querySelector('.lb-step'));
    /** What he is doing now ('' when not reading), for his panel too. */
    this.step = '';
    /** Whether he reads on for the question, the answer shown a first one (his panel and voice follow). */
    this.reading = false;
    /** What he says to ask him (a greeting's answer; his panel before a question): a question too while he reads. */
    this.prompt = PROMPT;
    /** @type {HTMLFormElement} */ (el.querySelector('.lb-form')).addEventListener('submit', (e) => {
      e.preventDefault();
      this.askNow(this.input.value);
    });
  }

  /** The list of finds shown. */
  get _list() {
    return /** @type {HTMLElement} */ (this.el.querySelector('.lb-finds'));
  }

  /**
   * Asks a question, as Ask does: "Looking…" while the answer is on its way (said only when it
   * takes a while), then the answer, said once, and its finds. While he reads, a first answer
   * comes at once, and his reading's replaces it.
   * @param {string} text
   */
  async askNow(text) {
    const token = ++this._token;
    this._asking?.abort();
    const asking = new AbortController();
    this._asking = asking;
    clearTimeout(this._lookingTimer);
    this._list.setAttribute('aria-busy', 'true');
    this._setStep('');
    this.reading = false;
    this.onLooking?.();
    this._lookingTimer = setTimeout(() => {
      if (token === this._token) this._say('Looking…');
    }, LOOKING_AFTER);
    /** @type {import('./ask.js').Answer} */
    let answer;
    try {
      answer = await this._ask(text, {
        signal: asking.signal,
        onStep: (step) => {
          if (token === this._token) this._setStep(step);
        },
        onFirst: (first) => {
          if (token === this._token && this._asking === asking) this._show(first, { first: true });
        },
      });
    } catch (err) {
      if (token !== this._token) return; // a newer question stopped it
      console.warn('[librarian] ask', err);
      answer = { text: FAILED, finds: [], search: null };
    }
    if (token !== this._token) return;
    this._asking = null;
    this._show(answer);
  }

  /**
   * His reading stopped, the first answer staying as the answer (one of its finds taken: the
   * visitor has what they came for). Nothing while he is not reading.
   */
  stopReading() {
    if (!this.reading) return;
    this._token++;
    this._asking?.abort();
    this._asking = null;
    this.reading = false;
    this._setStep('');
    this._answerEl.querySelector('.ov-sr')?.remove(); // not reading on (a removal is not said)
  }

  /** What he is doing while he reads ('' for nothing). @param {string} text */
  _setStep(text) {
    if (text === this.step) return;
    this.step = text;
    this._stepEl.textContent = text;
    this._stepEl.hidden = !text;
    this.onStep?.(text);
  }

  /**
   * Shows an answer: its words in the status, said once, and its finds. A first one (`first`: the
   * library's own search's, while he reads on) has what he is doing under it, and is replaced by
   * his reading's. Finds the same as those shown stay as they are (his reading found nothing, or
   * could not read); a find with the focus keeps it in the new list, or gives it to the first.
   * @param {import('./ask.js').Answer} answer
   * @param {{ first?: boolean }} [o]
   */
  _show(answer, { first = false } = {}) {
    clearTimeout(this._lookingTimer);
    const before = this.answer;
    this.answer = answer;
    this.reading = first;
    if (!first) this._setStep('');
    const focused = document.activeElement;
    const had = this.el.contains(focused);
    const old = this._list;
    const buttons = [...old.querySelectorAll('button')];
    const at = had ? buttons.indexOf(/** @type {HTMLButtonElement} */ (focused)) : -1;
    const numbered = !!answer.statements;
    let list = old;
    if (before && sameFinds(before.finds, answer.finds) && !!before.statements === numbered) {
      old.removeAttribute('aria-busy');
    } else {
      list = findList(document, answer.finds, {
        multi: this._multi(),
        numbered,
        take: (find, button) => {
          // As the search's results: the book's keys are the view's again (Enter reads it, not this
          // button), and on a TV the remote walks again, the book in hand. A first answer's find
          // taken: he stops reading.
          button.blur();
          this.stopReading();
          this._take(find);
        },
      });
      list.hidden = !answer.finds.length;
      old.replaceWith(list);
      fillImages(list);
    }
    this._say(answer.text, answer.statements, first);
    this.onAnswer?.(answer);
    if (!had) return;
    const shown = /** @type {NodeListOf<HTMLElement>} */ (list.querySelectorAll('button'));
    if (at >= 0) {
      // The find with the focus as its list went: the same find in the new one, else its first.
      if (list === old) return;
      const j = answer.finds.indexOf(/** @type {import('./ask.js').Find} */ (before?.finds[at]));
      (shown[Math.max(0, j)] ?? this.input).focus();
    } else if (this.tv && shown.length) shown[0].focus();
    else if (coarse() && document.activeElement === this.input) this.input.blur(); // the keyboard down, the answer seen
  }

  /**
   * The answer in its status, said once by a screen reader (emptied first, so the same words are
   * said again). A reading's sentences each end with the numbers of their sources, which are seen,
   * not said: the list of sources under it is numbered. After a first answer, while he reads on,
   * that is said too (the line under it, seen, is not).
   * @param {string} text
   * @param {Array<{ text: string, cites: number[] }>} [statements]
   * @param {boolean} [readingOn]
   */
  _say(text, statements, readingOn = false) {
    clearTimeout(this._sayTimer);
    this._answerEl.textContent = '';
    this._sayTimer = setTimeout(() => {
      /** @type {Node[]} */
      const parts = [];
      if (!statements) parts.push(document.createTextNode(text));
      else {
        for (const [i, s] of statements.entries()) {
          parts.push(document.createTextNode(`${i ? ' ' : ''}${s.text}`));
          if (!s.cites.length) continue;
          const sup = document.createElement('sup');
          sup.className = 'lb-cite';
          sup.setAttribute('aria-hidden', 'true');
          sup.textContent = s.cites.join(',');
          parts.push(sup);
        }
      }
      if (readingOn && this.reading) {
        const more = document.createElement('span');
        more.className = 'ov-sr';
        more.textContent = ` ${READING_ON}`;
        parts.push(more);
      }
      this._answerEl.replaceChildren(...parts);
    }, 50);
  }

  /** His reading chosen or not (librarian.js): the box, and he, ask for a question too. @param {boolean} on */
  setReading(on) {
    this.input.placeholder = on ? PLACEHOLDER_READING : PLACEHOLDER;
    this.prompt = on ? PROMPT_READING : PROMPT;
  }

  /** No question, no answer. */
  clear() {
    this._token++;
    this._asking?.abort();
    this._asking = null;
    clearTimeout(this._lookingTimer);
    clearTimeout(this._sayTimer);
    this.reading = false;
    this._setStep('');
    this.answer = null;
    this._answerEl.textContent = '';
    const list = this._list;
    list.replaceChildren();
    list.hidden = true;
    list.removeAttribute('aria-busy');
    this.onAnswer?.(null);
  }

  /** Shown or not (the help dialog's "Show the librarian"). @param {boolean} on */
  setShown(on) {
    this.el.hidden = !on;
  }

  get shown() {
    return !this.el.hidden;
  }

  /** The question box with the focus, its words selected to be asked again or replaced (L). */
  focus() {
    this.input.focus();
    this.input.select();
  }

  /**
   * Where a TV's Menu lands while no book is out: Ask, while the librarian is shown and the card
   * open (a collapsed card hides it: Menu then lands where it did without the librarian).
   */
  startStop() {
    const visible = this.shown && this.el.checkVisibility?.() !== false;
    return visible ? /** @type {HTMLElement} */ (this.el.querySelector('.lb-go')) : null;
  }

  /** The question and the answer shown, for the page's state (debug reports, scenes). */
  uiState() {
    return { q: this.input.value, answer: this.answer?.text ?? null };
  }

  /**
   * Puts back a uiState(): the question, asked again when it had been answered.
   * @param {{ q?: string, answer?: string | null } | null | undefined} ui
   */
  restoreUi(ui) {
    if (!ui) return;
    this.input.value = ui.q ?? '';
    if (ui.answer && ui.q) this.askNow(ui.q);
    else this.clear();
  }
}
