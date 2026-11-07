// @ts-check
// The librarian (docs/LIBRARIAN.md; SPEC §5.10) in the page: its part of the library card
// (card.js), answering through ask.js with the search box's own searches (search.js); its choice in
// the help dialog, "Show the librarian" (kept under `librarian` in this site's storage: without it
// the library is as it was); the L key, which puts you in its question box; on a TV, Menu landing on
// its Ask; and its question in the page's state (debug reports, scenes). Experiment 1, step 1: the
// words, in the card.

import { bookIndex, findArticles, findInText } from '../search.js';
import { load, save } from '../util/storage.js';
import { ask, MAX_FINDS } from './ask.js';
import { LibrarianCard } from './card.js';

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
 * @param {any} o.interaction its catalogue (libraries, booksByLib), state and ways to a book
 * @param {boolean} [o.tv] a TV (common's tvMode)
 * @returns {LibrarianCard}
 */
export function startLibrarian({ overlay, interaction, tv = false }) {
  const prefs = { shown: true, ...load(KEY, {}) };
  const catalogue = () => ({ libraries: interaction.libraries ?? [], booksByLib: interaction.booksByLib ?? {} });
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
    take: (find) => takeThere(interaction, find),
    multi: () => {
      const { libraries, booksByLib } = catalogue();
      return libraries.filter((/** @type {{ id: string }} */ l) => booksByLib[l.id]?.length).length > 1;
    },
    tv,
  });
  // At the top of the card, under its header (and a shared session's line), above the libraries.
  overlay.root.querySelector('.ov-card .ov-libs')?.before(card.el);

  // "Show the librarian", in the help dialog with the page's other choices.
  const pref = document.createElement('label');
  pref.className = 'ov-update-pref lb-pref';
  pref.innerHTML = '<input type="checkbox"> Show the librarian (ask it for a book in the card, or press L)';
  overlay.root.querySelector('.ov-textview-pref')?.after(pref);
  const box = /** @type {HTMLInputElement} */ (pref.querySelector('input'));
  box.checked = prefs.shown !== false;
  box.onchange = () => {
    prefs.shown = box.checked;
    save(KEY, prefs);
    card.setShown(box.checked);
  };
  card.setShown(box.checked);

  // L: into the question box, from the view (not from a field, a dialog or the text view, nor in
  // VR), the card opened if it was collapsed. Before the view's own keys (controls.js, on window),
  // which leave a key alone once it is taken.
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyL' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (!card.shown || typing(e.target) || overlay.dialog?.()) return;
    if (!['browse', 'inspect'].includes(interaction.state)) return;
    if (interaction.textView?.isOpen || interaction.controls?.presenting || interaction.controls?.textEntry) return;
    e.preventDefault();
    if (overlay.root.querySelector('.ov-card')?.classList.contains('collapsed')) overlay.setCardCollapsed(false);
    card.focus();
  });
  // A TV's Menu with no book out: on Ask, where its question box is one ↑ away.
  overlay.onRemoteStart?.(() => card.startStop());
  // The question and its answer in the page's state: debug reports and scenes (overlay.uiState).
  overlay.addUiPart?.('librarian', { state: () => card.uiState(), restore: (/** @type {any} */ ui) => card.restoreUi(ui) });
  return card;
}
