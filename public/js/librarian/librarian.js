// @ts-check
// The librarian (docs/LIBRARIAN.md; SPEC §5.10) in the page:
// - his part of the library card (card.js), answering through ask.js with the search box's own
//   searches (search.js);
// - his figure beside the catalogue stand, in VR his panel, and his walk to what he found, which
//   the card's "Take me there" goes through too (desk.js);
// - his choices in the help dialog, "Show the librarian" and "The librarian speaks his answers"
//   (off at first; his panel's Voice button too), kept under `librarian` in this site's storage
//   (without him the library is as it was); his voice (voice.js);
// - the L key, and on a screen the figure, which put you in his question box; Enter or Esc while
//   he leads the way, which is there at once;
// - on a TV, Menu landing on his Ask;
// - his question in the page's state (debug reports, scenes);
// - his reading (experiment 2): where the server has a model (model.js; never asked on a static
//   site) and it is chosen in the help ("The librarian reads the books…", off at first), a
//   question goes to it, which reads the library through the tools (tools.js, over search.js and
//   api.js) and answers with what it read (read.js, cite.js); the answer's sources are its finds.
//   What the catalogue has (experiment 1's answer) comes first, at once, when it found something,
//   while he reads on; his reading's answer replaces it. Nothing he read says it, or the model
//   failed: that answer stays, with why. The model is warmed up as the question box takes the
//   focus and as his panel opens.
// - "Mentioned here" (experiment 3): beside the open book, his button (and L) lists the articles
//   of other libraries that the open pages name (here.js, by xref.js's rule), each a Take me
//   there: the article comes into the reader's hands as a link's page does, and Back brings the
//   book back. The other libraries' titles are got once, when first asked (titles.js): a static
//   site's list of them, else their volumes' contents.
// Experiment 1: step 1, the words in the card; step 2, the figure and his panel; step 3, the walk;
// step 4, his voice. Experiment 2: step 2, his reading in the card; step 3, on his panel and aloud.
// Experiment 3: step 2, "Mentioned here" on a screen.

import { findText, getBookMeta, getChunk } from '../api.js';
import * as local from '../local/local.js';
import { bookIndex, findArticles, findInText } from '../search.js';
import { fileName } from '../util/file-names.js';
import { load, save } from '../util/storage.js';
import { ask, MAX_FINDS, parseQuestion } from './ask.js';
import { FAILED, LibrarianCard } from './card.js';
import { Desk } from './desk.js';
import { HerePanel } from './here-panel.js';
import { lookHere, partsOf } from './here.js';
import { ServerModel } from './model.js';
import { answerOf, couldNotRead, readFor, warmTurn } from './read.js';
import { TitleShelf } from './titles.js';
import { FIRST_STEP, LibraryTools, stepText } from './tools.js';
import { Voice } from './voice.js';

/** Its storage key (util/storage.js): { shown, speaks, reads }. */
const KEY = 'librarian';
/** What he says as his voice is chosen, so it is heard at once. */
const VOICE_ON = 'I will say my answers aloud.';
/** The site's root, from this module's own address (js/librarian/librarian.js), as api.js finds it. */
const SITE = new URL('../../', import.meta.url);

/**
 * Takes the visitor to a find, as the search's results do: a book to its shelf and into their
 * hands (interaction.searchPick), an article's volume open at it (openArticle), a book open where
 * its text holds the words (openText); a place he read, its book open there (openAt). An article
 * the open pages name (its `mention`) is followed as a link of theirs is (followTo): Back brings
 * the book back at its page.
 * @param {{ state?: string, searchPick: Function, openArticle: Function, openText: Function, openAt: Function, followTo?: Function }} interaction
 * @param {import('./ask.js').Find} find
 */
export function takeThere(interaction, find) {
  if (find.kind === 'book') return interaction.searchPick(find.book, { take: true });
  if (find.kind === 'article') {
    if (find.mention && interaction.state === 'read' && interaction.followTo) {
      return interaction.followTo({ libId: find.lib.id, id: find.article.book, at: { c: find.article.n, b: 0 } });
    }
    return interaction.openArticle(find.lib.id, find.article.book, find.article.n);
  }
  if (find.kind === 'passage') return interaction.openAt(find.lib.id, find.bookId, find.at);
  return interaction.openText(find.lib.id, find.hit);
}

/**
 * Whether a key goes to a field (a box, a choice), whose keys are its own.
 * @param {any} t the key's target
 */
const inField = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

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
  // His reading (experiment 2): the server's model, where it has one. A static site has none.
  const model = interaction.staticSite ? null : new ServerModel();
  /** @type {import('./model.js').ModelInfo | null} what the server said of it (null: none) */
  let modelInfo = null;
  /** Whether he reads for his answers: chosen, and the model can answer. */
  const reads = () => !!prefs.reads && !!modelInfo?.ready;
  /** The library as the model's tools read it: the page's own searches and reading. @type {import('./tools.js').Access} */
  const access = {
    libraries: () => catalogue().libraries,
    index: () => {
      const { libraries, booksByLib } = catalogue();
      return bookIndex(libraries, booksByLib);
    },
    articles: (q, perLibrary) => findArticles(catalogue().libraries, q, perLibrary),
    texts: (q, perLibrary) => findInText(catalogue().libraries, q, perLibrary),
    meta: (libId, bookId) => getBookMeta(libId, bookId),
    chunk: (libId, bookId, n) => getChunk(libId, bookId, n),
    place: (libId, hit) => findText(libId, hit),
  };
  const card = new LibrarianCard({
    ask: async (text, { signal, onStep, onFirst }) => {
      const { libraries, booksByLib } = catalogue();
      // What the catalogue has (experiment 1): his answer without reading, the first one while he
      // reads, and the one that stays when his reading finds nothing.
      const plain = ask(text, {
        libraries,
        prompt: card.prompt, // a question too while he reads
        index: () => bookIndex(libraries, booksByLib), // the search box's, made at the first search
        findArticles: (q) => findArticles(libraries, q, MAX_FINDS + 1), // one more than shown: "and more"
        findInText: (q) => findInText(libraries, q, MAX_FINDS + 1),
      }).catch((err) => {
        console.warn('[librarian] ask', err);
        return { text: FAILED, finds: [], search: null };
      });
      // A greeting, or nothing asked yet: what to ask him, without the model. What the open pages
      // mention is his to tell beside the book, not the model's.
      const asked = parseQuestion(text);
      if (!model || !reads() || asked.empty || asked.here) return plain;
      const tools = new LibraryTools(access);
      onStep(FIRST_STEP);
      // Shown at once while he reads on, when it found something (card.js: his reading's answer
      // replaces it). One that found nothing ("I have nothing called …", as a question asked as a
      // question often gets) would only be contradicted: "Looking…" and his steps show instead.
      plain.then((first) => {
        if (!signal.aborted && first.finds.length) onFirst(first);
      });
      let reading;
      try {
        reading = await readFor(text, {
          chat: (messages, defs, o) => model.chat(messages, defs, o),
          tools,
          onStep: (step) => onStep(stepText(step, tools.sources)),
          signal,
        });
      } catch (err) {
        if (signal.aborted) throw err; // a newer question
        console.warn('[librarian] reading', /** @type {Error} */ (err)?.message ?? err);
        return couldNotRead(await plain);
      }
      return answerOf(reading, await plain, booksByLib);
    },
    // With him: he leads the way there (made below; the card's buttons are pressed only after).
    take: (find) => desk.takeThere(find),
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
  // While he leads the way the card, the search and the hint fade, as while reading (librarian.css):
  // on a phone the card would hide the walk, and a click or tap anywhere is there at once.
  const onWalk = (/** @type {boolean} */ on) => overlay.root.classList.toggle('lb-walking', on);
  // His voice: the device's own, said only once chosen (prefs.speaks).
  const voice = new Voice();
  /** @type {import('./desk.js').Speech} */
  const speech = {
    available: () => voice.available,
    on: () => !!prefs.speaks && voice.available,
    set: (on) => setSpeaks(on),
    say: (text) => voice.say(text),
    stop: () => voice.stop(),
  };
  // His panel opening warms up his reading's model, as the card's box taking the focus does (below).
  const desk = new Desk({ interaction, card, take, multi, intoBox, onWalk, speech, onOpen: () => warmUp() });

  // "Mentioned here" (experiment 3), beside the open book. The other libraries' titles, got when
  // first asked: a static site keeps each Wikipedia's as one list (the search's own, api.js);
  // elsewhere a volume's contents are its articles' titles (the server's, or for a library opened
  // here the worker's).
  /** @param {string} path a file or a route of the site (SPEC §4) */
  const fetchJSON = async (path) => {
    const res = await fetch(new URL(path, SITE));
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.json();
  };
  const enc = encodeURIComponent;
  const shelf = new TitleShelf({
    list: async (lib) => (interaction.staticSite && !local.isLocal(lib.id) ? fetchJSON(`api/library/${enc(fileName(lib.id))}/titles.json`) : null),
    volumes: (lib) => catalogue().booksByLib[lib.id] ?? [],
    volume: async (lib, id) => {
      const meta = local.isLocal(lib.id) ? await local.meta(lib.id, id) : await fetchJSON(`api/libraries/${enc(lib.id)}/books/${enc(id)}`);
      return (meta.toc ?? []).map((/** @type {{ title?: string }} */ e) => String(e.title ?? ''));
    },
  });
  const here = new HerePanel({
    look: ({ onStep }) => {
      const { libraries } = catalogue();
      shelf.keep(libraries);
      const { book, reader } = interaction;
      const spread = interaction.spreadShown;
      if (!book || !reader || !spread) return Promise.resolve({ text: 'No book is open.', finds: [], search: null });
      return lookHere({
        book: { libId: book.libId, id: book.id }, ...partsOf(spread, reader), blocksOf: (c) => getChunk(book.libId, book.id, c), libraries, shelf, onStep,
      });
    },
    pages: () => interaction.spreadShown ?? null,
    take, // no walk: the article comes into the reader's hands, as a link's page does
    tv,
  });
  // The button where the book is read: in the bar at the page's foot, after "Text view", or in the
  // text view's toolbar while that is open (the foot's bar is under it), the list over that view.
  const foot = overlay.root.querySelector('.ov-bottom');
  const placeHere = (/** @type {boolean} */ inText) => {
    const view = inText ? interaction.textView?.el : null;
    const bar = view?.querySelector('.tv-bar');
    if (view && bar) here.place(bar, view, bar.querySelector('.tv-putback'));
    else if (foot) here.place(foot, overlay.root, foot.querySelector('.ov-vr'));
  };
  let inText = false;
  placeHere(false);
  // Each frame (nothing made): the button follows the text view, and the list closes as the pages
  // it was asked of go (a turned page, a link followed, the book put back).
  interaction.onFrame?.(() => {
    const text = !!interaction.textView?.isOpen;
    if (text !== inText) {
      inText = text;
      placeHere(text);
    }
    here.sync();
  });

  // For the console and scripted checks: __vrlbry.interaction.librarian.
  interaction.librarian = { card, desk, voice, model, here, shelf };
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
    here.setShown(on);
  };
  box.checked = prefs.shown !== false;
  box.onchange = () => {
    prefs.shown = box.checked;
    save(KEY, prefs);
    show(box.checked);
  };
  show(box.checked);

  // "The librarian speaks his answers", after it: off at first, and only with a voice of the
  // device's own (voice.js), which may come after the page (the box then follows).
  const voicePref = document.createElement('label');
  voicePref.className = 'ov-update-pref lb-pref';
  voicePref.innerHTML = '<input type="checkbox"> <span></span>';
  pref.after(voicePref);
  const voiceBox = /** @type {HTMLInputElement} */ (voicePref.querySelector('input'));
  const voiceText = /** @type {HTMLElement} */ (voicePref.querySelector('span'));
  const showVoice = () => {
    voiceBox.disabled = !voice.available;
    voiceBox.checked = speech.on();
    voiceText.textContent = voice.available
      ? 'The librarian speaks his answers (in this device’s own voice)'
      : 'The librarian speaks his answers (this device has no English voice of its own)';
    desk.refresh();
  };
  /** Chosen in the help dialog or on his panel: kept, and heard at once. @param {boolean} on */
  function setSpeaks(on) {
    prefs.speaks = on;
    save(KEY, prefs);
    if (on) voice.say(VOICE_ON);
    else voice.stop();
    showVoice();
  }
  voiceBox.onchange = () => setSpeaks(voiceBox.checked);
  voice.onChange = showVoice;
  showVoice();
  window.addEventListener('pagehide', () => voice.stop());

  // "The librarian reads the books to answer questions", after it: shown only where the server has
  // a model, off at first; disabled, with why, while the model cannot answer.
  const readPref = document.createElement('label');
  readPref.className = 'ov-update-pref lb-pref';
  readPref.hidden = true;
  readPref.innerHTML = '<input type="checkbox"> <span></span>';
  voicePref.after(readPref);
  const readBox = /** @type {HTMLInputElement} */ (readPref.querySelector('input'));
  const readText = /** @type {HTMLElement} */ (readPref.querySelector('span'));
  const showReads = () => {
    card.setReading(reads());
    desk.refresh(); // his panel's hint as the box's
    readPref.hidden = !modelInfo;
    if (!modelInfo) return;
    readBox.disabled = !modelInfo.ready;
    readBox.checked = reads();
    readText.textContent = modelInfo.ready
      ? `The librarian reads the books to answer questions, and says where he read it (with ${modelInfo.model}, on this site’s server)`
      : `The librarian reads the books to answer questions (${modelInfo.model} cannot answer just now${modelInfo.error ? `: ${modelInfo.error}` : ''})`;
  };
  /** What the server says of its model now. */
  const askAboutModel = async () => {
    if (!model) return;
    modelInfo = await model.info();
    showReads();
  };
  /**
   * The model loaded and its instructions read before the first question (at most every 10
   * minutes: model.js), as the box takes the focus or reading is chosen; a model that could not
   * answer is asked about again first.
   */
  const warmUp = async () => {
    if (!model) return;
    if (modelInfo && !modelInfo.ready && model.mayAskAgain) await askAboutModel();
    if (reads()) model.warm(warmTurn(new LibraryTools(access)));
  };
  readBox.onchange = () => {
    prefs.reads = readBox.checked;
    save(KEY, prefs);
    showReads();
    warmUp();
  };
  card.input.addEventListener('focus', () => warmUp());
  askAboutModel();

  // L: into the question box, from the view (not from a field, a dialog or the text view, nor in
  // VR). Before the view's own keys (controls.js, on window), which leave a key alone once it is
  // taken.
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyL' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (!card.shown || overlay.dialog?.()) return;
    // Beside an open book (in the text view too, whose keys are otherwise its own): what its pages
    // mention, or that list closed.
    if (interaction.state === 'read') {
      if (inField(e.target) || interaction.controls?.presenting) return;
      e.preventDefault();
      here.toggle();
      return;
    }
    if (typing(e.target)) return;
    if (!['browse', 'inspect'].includes(interaction.state)) return;
    if (interaction.textView?.isOpen || interaction.controls?.presenting || interaction.controls?.textEntry) return;
    e.preventDefault();
    intoBox();
  });
  // While he leads the way: Enter, Esc or a TV's OK (Enter, after common's Remote has had it) is
  // there at once, as a click is (desk.js), and goes no further: the view's keys wait for the book.
  document.addEventListener('keydown', (e) => {
    if (!desk.walking || (e.key !== 'Enter' && e.key !== 'Escape') || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) desk.skipWalk();
  }, true);
  // A TV's Menu with no book out: on Ask, where its question box is one ↑ away.
  overlay.onRemoteStart?.(() => card.startStop());
  // The question, its answer and his panel in the page's state: debug reports and scenes
  // (overlay.uiState). The panel comes back only in a headset.
  overlay.addUiPart?.('librarian', {
    state: () => ({ ...card.uiState(), ...desk.uiState(), ...(here.open ? { here: true } : {}) }),
    restore: (/** @type {any} */ ui) => {
      card.restoreUi(ui);
      if (ui?.panel && interaction.controls?.presenting) desk.open();
      // "Mentioned here", where its book is open again already.
      if (ui?.here && interaction.spreadShown) here.ask();
    },
  });
  return { card, desk };
}
