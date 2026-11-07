// @ts-check
// The librarian (docs/LIBRARIAN.md; SPEC §5.10) in the page:
// - his part of the library card (card.js), answering through ask.js with the search box's own
//   searches (search.js);
// - his figure beside the catalogue stand, and in VR his panel (desk.js);
// - his choice in the help dialog, "Show the librarian", kept under `librarian` in this site's
//   storage (without him the library is as it was);
// - the L key, and on a screen the figure, which put you in his question box;
// - on a TV, Menu landing on his Ask;
// - his question in the page's state (debug reports, scenes).
// Experiment 1: step 1, the words in the card; step 2, the figure and his panel.

import { bookIndex, findArticles, findInText } from '../search.js';
import { load, save } from '../util/storage.js';
import { ask, MAX_FINDS } from './ask.js';
import { LibrarianCard } from './card.js';
import { Desk } from './desk.js';

/** Its storage key (util/storage.js): { shown }. */
const KEY = 'librarian';

/**
 * Takes the visitor to a find, as the search's results do: a book to its shelf and into their
 * hands (interaction.searchPick), an article's volume open at it (openArticle), a book open where
 * its text holds the words (openText).
 * @param {{ searchPick: Function, openArticle: Function, openText: Function }} interaction
 * @param {import('./ask.js').Find} find
 */
export function takeThere(interaction, find) {
  if (find.kind === 'book') return interaction.searchPick(find.book, { take: true });
  if (find.kind === 'article') return interaction.openArticle(find.lib.id, find.article.book, find.article.n);
  return interaction.openText(find.lib.id, find.hit);
}

/**
 * Whether a key goes to a field, or to something that keeps its own keys (the text view).
 * @param {any} t the key's target
 */
const typing = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest?.('[data-own-keys]'));

/**
 * Puts the librarian in the page.
 * @param {object} o
 * @param {any} o.overlay the page's card and dialogs (ui/overlay.js)
 * @param {any} o.interaction the room (interaction.js): its catalogue (libraries, booksByLib),
 *   state, scene and ways to a book
 * @param {boolean} [o.tv] a TV (common's tvMode)
 * @returns {{ card: LibrarianCard, desk: Desk }}
 */
export function startLibrarian({ overlay, interaction, tv = false }) {
  const prefs = { shown: true, ...load(KEY, {}) };
  const catalogue = () => ({ libraries: interaction.libraries ?? [], booksByLib: interaction.booksByLib ?? {} });
  const take = (/** @type {import('./ask.js').Find} */ find) => takeThere(interaction, find);
  const multi = () => {
    const { libraries, booksByLib } = catalogue();
    return libraries.filter((/** @type {{ id: string }} */ l) => booksByLib[l.id]?.length).length > 1;
  };
  const card = new LibrarianCard({
    ask: async (text) => {
      const { libraries, booksByLib } = catalogue();
      return ask(text, {
        libraries,
        index: () => bookIndex(libraries, booksByLib), // the search box's, made at the first search
        findArticles: (q) => findArticles(libraries, q, MAX_FINDS + 1), // one more than shown: "and more"
        findInText: (q) => findInText(libraries, q, MAX_FINDS + 1),
      });
    },
    take,
    multi,
    tv,
  });
  // At the top of the card, under its header (and a shared session's line), above the libraries.
  overlay.root.querySelector('.ov-card .ov-libs')?.before(card.el);

  /** Into the question box, the card opened if it was collapsed. */
  const openBox = () => {
    if (overlay.root.querySelector('.ov-card')?.classList.contains('collapsed')) overlay.setCardCollapsed(false);
    card.focus();
  };
  // A finger lifted (the view's own pointerup comes after this listener's, and chooses him there).
  let touchUp = -Infinity;
  document.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') touchUp = performance.now();
  }, true);
  /**
   * Into the question box (L, and the figure on a screen). A tap's mouse events come after the
   * pointerup that chose him, and would land on the card opening under the finger: the mousedown
   * taking the focus off the box, the click pressing whatever is there (a library's ×). So after a
   * tap the box opens at its click, once they are done, or soon if none comes.
   */
  const intoBox = () => {
    if (performance.now() - touchUp > 300) return openBox();
    let timer = 0;
    const go = () => {
      clearTimeout(timer);
      window.removeEventListener('click', go, true);
      openBox();
    };
    window.addEventListener('click', go, true);
    timer = window.setTimeout(go, 400);
  };
  const desk = new Desk({ interaction, card, take, multi, intoBox });
  // Out of VR his panel goes: on a screen the card is his.
  interaction.renderer?.xr?.addEventListener?.('sessionend', () => desk.close());

  // "Show the librarian", in the help dialog with the page's other choices.
  const pref = document.createElement('label');
  pref.className = 'ov-update-pref lb-pref';
  pref.innerHTML = '<input type="checkbox"> Show the librarian (ask him for a book in the card or at the stand, or press L)';
  overlay.root.querySelector('.ov-textview-pref')?.after(pref);
  const box = /** @type {HTMLInputElement} */ (pref.querySelector('input'));
  const show = (/** @type {boolean} */ on) => {
    card.setShown(on);
    desk.setShown(on);
  };
  box.checked = prefs.shown !== false;
  box.onchange = () => {
    prefs.shown = box.checked;
    save(KEY, prefs);
    show(box.checked);
  };
  show(box.checked);

  // L: into the question box, from the view (not from a field, a dialog or the text view, nor in
  // VR). Before the view's own keys (controls.js, on window), which leave a key alone once it is
  // taken.
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyL' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (!card.shown || typing(e.target) || overlay.dialog?.()) return;
    if (!['browse', 'inspect'].includes(interaction.state)) return;
    if (interaction.textView?.isOpen || interaction.controls?.presenting || interaction.controls?.textEntry) return;
    e.preventDefault();
    intoBox();
  });
  // A TV's Menu with no book out: on Ask, where its question box is one ↑ away.
  overlay.onRemoteStart?.(() => card.startStop());
  // The question, its answer and his panel in the page's state: debug reports and scenes
  // (overlay.uiState). The panel comes back only in a headset.
  overlay.addUiPart?.('librarian', {
    state: () => ({ ...card.uiState(), ...desk.uiState() }),
    restore: (/** @type {any} */ ui) => {
      card.restoreUi(ui);
      if (ui?.panel && interaction.controls?.presenting) desk.open();
    },
  });
  return { card, desk };
}
