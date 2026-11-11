// @ts-check
// "Mentioned here" on a screen (docs/LIBRARIAN.md, experiment 3 step 2; SPEC §5.10): the
// librarian's button beside the open book, and the list it opens. The library card is not there
// while a book is read, so this is his own: a button in the bar at the page's foot (beside "Text
// view"), or in the text view's toolbar while that is open, and over the view's corner a small
// panel with his answer, said once, and the articles he found, each a "Take me there".
// The panel keeps its own keys (data-own-keys: the view's page turns wait): Esc closes it, and so
// does the focus leaving it, a turned page or the book put back (librarian.js). On a TV the
// remote reaches the button in the foot's row and steps through the finds; Back, walking again,
// closes it.
// It is also where the question is asked and answered whatever shows it (step 4): in a headset
// his panel beside the book (here-vr.js) asks through it and follows it (onLooking, onStep,
// onAnswer), as his desk's panel follows the card, so the two always say the same; and his voice
// says the answer it ends with (librarian.js).

import { fillImages, findList, FAILED } from './card.js';

/** ms before "Looking…" is shown and said: a quick answer comes alone. */
const LOOKING_AFTER = 400;

export class HerePanel {
  /**
   * @param {object} o
   * @param {(o: { onStep: (step: string) => void }) => Promise<import('./ask.js').Answer>} o.look
   *   what the open pages mention (here.js lookHere, over the page's reader and catalogue)
   * @param {(find: import('./ask.js').Find) => unknown} o.take takes the reader to a find
   * @param {() => unknown} [o.pages] what the open pages are now: another value once they change
   *   (the spread shown; null with no book open)
   * @param {boolean} [o.tv] a TV: closed, its button has the focus again
   * @param {() => boolean} [o.presenting] whether the view is a headset's: the page is not seen
   *   then, and where its focus is closes nothing
   */
  constructor({ look, take, pages = () => null, tv = false, presenting = () => false }) {
    this._look = look;
    this._take = take;
    this._pages = pages;
    this.tv = tv;
    this._presenting = presenting;
    /** The asking being answered (a newer one, or closing, wins). */
    this._token = 0;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this._lookingTimer = undefined;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this._sayTimer = undefined;
    /** The answer shown. @type {import('./ask.js').Answer | null} */
    this.answer = null;
    /** What the pages were when asked (sync closes the list as they change). @type {unknown} */
    this.asked = null;
    /** Whether an answer is on its way. */
    this.looking = false;
    /** What he is doing meanwhile ('' for nothing to say of it). */
    this.step = '';
    /** Told as an asking begins (the list opens, or is asked again). @type {(() => void) | null} */
    this.onLooking = null;
    /** Told what he is doing meanwhile. @type {((step: string) => void) | null} */
    this.onStep = null;
    /** Told the answer as it comes, and null as the list closes. @type {((answer: import('./ask.js').Answer | null) => void) | null} */
    this.onAnswer = null;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lb-here-btn';
    button.textContent = 'Mentioned here';
    button.title = 'The articles of other libraries that these pages name (L)';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'lb-here');
    button.addEventListener('click', () => this.toggle());
    /** The button, put where the book is read (place). */
    this.button = button;

    const panel = document.createElement('section');
    panel.className = 'lb-here';
    panel.id = 'lb-here';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Mentioned here');
    panel.setAttribute('data-own-keys', '');
    panel.innerHTML = `
      <header class="lb-here-head"><h2 class="lb-here-title">Mentioned here</h2><button class="lb-here-close" type="button" aria-label="Close">×</button></header>
      <p class="lb-answer" role="status"></p>
      <p class="lb-step" aria-hidden="true" hidden></p>
      <ul class="lb-finds" aria-label="What the librarian found" hidden></ul>`;
    /** The list it opens. */
    this.panel = panel;
    this._answerEl = /** @type {HTMLElement} */ (panel.querySelector('.lb-answer'));
    this._stepEl = /** @type {HTMLElement} */ (panel.querySelector('.lb-step'));
    this._closeEl = /** @type {HTMLElement} */ (panel.querySelector('.lb-here-close'));
    this._closeEl.addEventListener('click', () => this.close({ back: true }));
    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      this.close({ back: true });
    });
    // The focus gone elsewhere (a click on the view, a TV's Back walking again): the list closes.
    // Not in a headset, where the page is not what is seen or pointed at.
    panel.addEventListener('focusout', () => {
      setTimeout(() => {
        const a = document.activeElement;
        if (this.open && !this._presenting() && !panel.contains(a) && a !== button) this.close();
      }, 0);
    });
  }

  /**
   * Takes the reader to a find of the list, which closes (its buttons; in a headset his panel's
   * rows).
   * @param {import('./ask.js').Find} find
   */
  take(find) {
    this.close();
    return this._take(find);
  }

  /** Whether the list is open. */
  get open() {
    return !this.panel.hidden;
  }

  /** The list of finds shown. */
  get _list() {
    return /** @type {HTMLElement} */ (this.panel.querySelector('.lb-finds'));
  }

  /**
   * Puts the button and the list where the book is read: the button in a bar (before `before`,
   * else at its end), the list in the layer over the view.
   * @param {Element} bar
   * @param {Element} layer
   * @param {Element | null} [before]
   */
  place(bar, layer, before = null) {
    const focused = document.activeElement === this.button;
    if (before?.parentNode === bar) before.before(this.button);
    else bar.append(this.button);
    if (this.panel.parentNode !== layer) layer.append(this.panel);
    if (focused) this.button.focus({ preventScroll: true });
  }

  /** The button pressed, or L: the list opened with what the pages mention now, or closed. */
  toggle() {
    if (this.open) this.close({ back: true });
    else this.ask();
  }

  /**
   * Opens the list and asks what the open pages mention: "Looking…" while the answer is on its
   * way (said only when it takes a while), what he is doing under it, then the answer, said once,
   * and its finds, the first with the focus.
   */
  async ask() {
    const pages = this._pages();
    if (pages === null) return; // no book open: nothing to ask of
    const token = ++this._token;
    this.asked = pages;
    this.answer = null;
    this.looking = true;
    clearTimeout(this._lookingTimer);
    this._say('');
    this._setStep('');
    const empty = this._list;
    empty.replaceChildren();
    empty.hidden = true;
    empty.setAttribute('aria-busy', 'true');
    this.panel.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    this._closeEl.focus({ preventScroll: true });
    this._lookingTimer = setTimeout(() => {
      if (token === this._token) this._say('Looking…');
    }, LOOKING_AFTER);
    this.onLooking?.();
    /** @type {import('./ask.js').Answer} */
    let answer;
    try {
      answer = await this._look({
        onStep: (step) => {
          if (token !== this._token) return;
          this._setStep(step);
          this.onStep?.(step);
        },
      });
    } catch (err) {
      console.warn('[librarian] here', err);
      answer = { text: FAILED, finds: [], search: null };
    }
    if (token !== this._token) return; // closed, or asked again
    clearTimeout(this._lookingTimer);
    this._setStep('');
    this.looking = false;
    this.answer = answer;
    const list = findList(document, answer.finds, { multi: true, take: (find) => this.take(find) });
    list.hidden = !answer.finds.length;
    this._list.replaceWith(list);
    fillImages(list);
    this._say(answer.text);
    // The first find takes the focus, where it is still in the list (the reader has not left it).
    if (this.panel.contains(document.activeElement)) list.querySelector('button')?.focus({ preventScroll: true });
    this.onAnswer?.(answer);
  }

  /**
   * Closes the list. `back`: closed from within (Esc, its ×, the button): on a TV the button has
   * the focus again, elsewhere nothing has, so the view's keys turn pages again.
   * @param {{ back?: boolean }} [o]
   */
  close({ back = false } = {}) {
    if (!this.open) return;
    this._token++;
    clearTimeout(this._lookingTimer);
    clearTimeout(this._sayTimer);
    const within = this.panel.contains(document.activeElement) || document.activeElement === this.button;
    this.panel.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    this.answer = null;
    this.asked = null;
    this.looking = false;
    this._answerEl.textContent = '';
    this._setStep('');
    this._list.replaceChildren();
    if (within) {
      if (back && this.tv) this.button.focus({ preventScroll: true });
      else /** @type {HTMLElement | null} */ (document.activeElement)?.blur?.();
    }
    this.onAnswer?.(null);
  }

  /**
   * Called each frame while the page runs (it makes nothing): the list closes once the pages it
   * was asked of are no longer the ones shown (a turned page, a link followed, the book put back).
   */
  sync() {
    if (!this.panel.hidden && this._pages() !== this.asked) this.close();
  }

  /** What he is doing meanwhile ('' for nothing): seen, not said. @param {string} text */
  _setStep(text) {
    this.step = text;
    this._stepEl.textContent = text;
    this._stepEl.hidden = !text;
  }

  /** The answer in its status, said once by a screen reader (emptied first). @param {string} text */
  _say(text) {
    clearTimeout(this._sayTimer);
    this._answerEl.textContent = '';
    if (!text) return;
    this._sayTimer = setTimeout(() => {
      this._answerEl.textContent = text;
    }, 50);
  }

  /** Shown or not, with the librarian (the help's "Show the librarian"). @param {boolean} on */
  setShown(on) {
    if (!on) this.close();
    this.button.hidden = !on;
  }
}
