// @ts-check
// The librarian in the library card (SPEC §5.10; docs/LIBRARIAN.md, experiment 1): "Ask the
// librarian", a question box and its Ask button; the answer under them, a polite status said once,
// when it is complete; and what was found, each a button that takes you there. On a TV the remote
// steps through it as through the rest of the card (ui/remote.js); an answer's first find takes the
// focus from its question there, so OK takes you to it.

import { imageSource } from '../api.js';
import { findLines } from './ask.js';

/** ms before "Looking…" is shown and said: a quick answer comes alone. */
const LOOKING_AFTER = 400;

/** What the librarian says when the looking itself failed. */
const FAILED = 'I could not look just now.';

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
 * named by data-src and loaded once the list is in the page (fillImages).
 * @param {Pick<Document, 'createElement' | 'createTextNode'>} doc
 * @param {import('./ask.js').Find[]} finds
 * @param {{ multi: boolean, take: (find: import('./ask.js').Find, button: HTMLElement) => void }} o
 *   multi: more than one library has books (a book's line names its library)
 */
export function findList(doc, finds, { multi, take }) {
  const list = doc.createElement('ul');
  list.setAttribute('class', 'lb-finds');
  list.setAttribute('aria-label', 'What the librarian found');
  for (const find of finds) {
    const { title, line, snippet } = findLines(find, multi);
    const button = doc.createElement('button');
    button.setAttribute('type', 'button');
    button.setAttribute('class', 'lb-find');
    const book = find.kind === 'book';
    const picture = book ? find.book.cover : find.lib.illustration;
    if (picture) {
      const img = doc.createElement('img');
      img.setAttribute('class', book ? 'lb-cover' : 'lb-icon');
      img.setAttribute('alt', '');
      img.setAttribute('width', '34');
      img.setAttribute('height', book ? '48' : '34');
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
function fillImages(root) {
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

export class LibrarianCard {
  /**
   * @param {object} o
   * @param {(text: string) => Promise<import('./ask.js').Answer>} o.ask
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
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this._lookingTimer = undefined;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this._sayTimer = undefined;
    /** @type {import('./ask.js').Answer | null} the answer shown */
    this.answer = null;
    const el = document.createElement('div');
    el.className = 'lb-ask';
    el.innerHTML = `
      <form class="lb-form">
        <label class="lb-label" for="lb-q">Ask the librarian</label>
        <div class="lb-row">
          <input class="lb-q" id="lb-q" type="search" name="q" enterkeyhint="search" autocomplete="off" spellcheck="false"
            placeholder="A title, an author or a subject">
          <button class="lb-go" type="submit">Ask</button>
        </div>
      </form>
      <p class="lb-answer" role="status"></p>
      <ul class="lb-finds" aria-label="What the librarian found" hidden></ul>`;
    /** The card's part: put into the library card by librarian.js. */
    this.el = el;
    this.input = /** @type {HTMLInputElement} */ (el.querySelector('.lb-q'));
    this._answerEl = /** @type {HTMLElement} */ (el.querySelector('.lb-answer'));
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
   * takes a while), then the answer, said once, and its finds.
   * @param {string} text
   */
  async askNow(text) {
    const token = ++this._token;
    clearTimeout(this._lookingTimer);
    this._list.setAttribute('aria-busy', 'true');
    this._lookingTimer = setTimeout(() => {
      if (token === this._token) this._say('Looking…');
    }, LOOKING_AFTER);
    /** @type {import('./ask.js').Answer} */
    let answer;
    try {
      answer = await this._ask(text);
    } catch (err) {
      console.warn('[librarian] ask', err);
      answer = { text: FAILED, finds: [], search: null };
    }
    if (token !== this._token) return;
    clearTimeout(this._lookingTimer);
    this._show(answer);
  }

  /** @param {import('./ask.js').Answer} answer */
  _show(answer) {
    this.answer = answer;
    const had = this.el.contains(document.activeElement);
    const list = findList(document, answer.finds, {
      multi: this._multi(),
      take: (find, button) => {
        // As the search's results: the book's keys are the view's again (Enter reads it, not this
        // button), and on a TV the remote walks again, the book in hand.
        button.blur();
        this._take(find);
      },
    });
    list.hidden = !answer.finds.length;
    this._list.replaceWith(list);
    fillImages(list);
    this._say(answer.text);
    if (!had) return;
    if (this.tv && answer.finds.length) /** @type {HTMLElement} */ (list.querySelector('button')).focus();
    else if (coarse() && document.activeElement === this.input) this.input.blur(); // the keyboard down, the answer seen
  }

  /**
   * The answer in its status, said once by a screen reader (emptied first, so the same words are
   * said again).
   * @param {string} text
   */
  _say(text) {
    clearTimeout(this._sayTimer);
    this._answerEl.textContent = '';
    this._sayTimer = setTimeout(() => { this._answerEl.textContent = text; }, 50);
  }

  /** No question, no answer. */
  clear() {
    this._token++;
    clearTimeout(this._lookingTimer);
    clearTimeout(this._sayTimer);
    this.answer = null;
    this._answerEl.textContent = '';
    const list = this._list;
    list.replaceChildren();
    list.hidden = true;
    list.removeAttribute('aria-busy');
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
