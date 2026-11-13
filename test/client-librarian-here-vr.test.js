// The librarian beside a book in a headset (public/js/librarian/here-vr.js, SPEC §5.10;
// docs/LIBRARIAN.md, experiment 3 steps 3 and 4): his buttons ("Also in the library", and
// "Mentioned here" for an open book) at the end of an open book's toolbar or under a closed
// book's own panel, and his panel beside the book, which follow the page's lists (here-panel.js)
// and ask through them. Nothing of it on a screen; one of the two panels shown at a time; placed
// again only when the book moves; nothing made per frame. In Node, on a stand-in for the room
// (interaction.js) and a stub canvas for common's Panel.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import './helpers/vendor.js'; // here-vr.js's ../../vendor/common/panel.js

/** A canvas whose text is 13 px a letter, so lines wrap as they would. */
globalThis.document ??= /** @type {any} */ ({
  createElement: () => ({
    width: 0, height: 0, style: {},
    getContext: () => new Proxy({}, { get: (_, name) => (name === 'measureText' ? (/** @type {string} */ s) => ({ width: String(s).length * 13 }) : () => {}), set: () => true }),
  }),
});
const { HereVR, hereLines } = await import('../public/js/librarian/here-vr.js');
const { Panel, UI } = await import('../public/vendor/common/panel.js');

const near = (a, b, why = '') => assert.ok(Math.abs(a - b) < 1e-9, `${why} ${a} is not ${b}`);
const med = { id: 'med', title: 'WikiMed' };
const find = (title, n) => ({ kind: 'article', article: { title, book: 'v3', n }, lib: med, mention: { text: title.toLowerCase(), context: `About ${title.toLowerCase()}.` } });

/** One of the page's lists (HerePanel), as what it tells of itself. */
const pageList = (label) => /** @type {any} */ ({
  label, open: false, looking: false, step: '', answer: null, log: [],
  toggle() { this.log.push('toggle'); },
  take(/** @type {any} */ f) { this.log.push(['take', f.kind === 'book' ? f.book.title : f.article.title]); },
  close(/** @type {any} */ o) { this.log.push(['close', o]); },
});

/**
 * A stand-in for the room with a book in hand: its frame (holder) with the toolbar under an open
 * book's pages and a closed book's own panel beside it, as interaction.js places them in a
 * headset, and the book; the page's two lists; his voice as chosen.
 */
function reading({ presenting = true, voice = true, state = 'read', also = true } = {}) {
  const holder = new THREE.Group();
  const toolbar = new Panel({ width: 0.72, height: 0.13, pxPerMeter: 1300 });
  toolbar.mesh.position.set(0, -0.297, 0.03);
  toolbar.mesh.rotation.set(-0.35, 0, 0);
  const inspectPanel = new Panel({ width: 0.36, height: 0.41, pxPerMeter: 1580 });
  inspectPanel.mesh.position.set(0.2 * 0.62 + 0.21, 0.02, 0.02);
  inspectPanel.mesh.rotation.set(0, -0.25, 0);
  const group = new THREE.Group();
  group.scale.setScalar(1.5);
  holder.add(toolbar.mesh, inspectPanel.mesh, group);
  const seen = { sizes: 0 };
  const book3d = {
    group, single: false, dims: { d: 0.2 },
    get pageSize() {
      seen.sizes++;
      return { w: 0.2, h: 0.28 };
    },
  };
  /** @type {any[]} */
  const panels = [];
  const ia = { holder, toolbar, inspectPanel, book3d, state, controls: { presenting }, addPanel: (/** @type {any} */ p) => panels.push(p) };
  const here = pageList('Mentioned here');
  const more = also ? pageList('Also in the library') : null;
  const speech = voice ? {
    has: true, chosen: false, log: /** @type {any[]} */ ([]),
    available() { return this.has; },
    on() { return this.has && this.chosen; },
    set(/** @type {boolean} */ on) { this.chosen = on; this.log.push(on); },
    say() {}, stop() {},
  } : undefined;
  const opened = { n: 0 };
  const beside = new HereVR({ interaction: ia, here, also: more, speech, onOpen: () => { opened.n++; } });
  /** A list of the page's as an asking goes: opened and looking, then the answer, then closed. */
  const ask = (list = here) => {
    list.open = true;
    list.looking = true;
    list.step = '';
    list.answer = null;
    beside.refresh();
  };
  const answer = (/** @type {any} */ a, list = here) => {
    list.looking = false;
    list.step = '';
    list.answer = a;
    beside.refresh();
  };
  const close = (list = here) => {
    list.open = false;
    list.looking = false;
    list.answer = null;
    beside.refresh();
  };
  return { ia, holder, toolbar, inspectPanel, book3d, panels, here, also: more, speech, beside, opened, seen, ask, answer, close };
}

describe('the librarian beside a book in a headset', () => {
  it('is nothing on a screen: no panel made, none shown', () => {
    const r = reading({ presenting: false });
    for (let i = 0; i < 3; i++) r.beside.update();
    assert.equal(r.beside.button, null);
    assert.equal(r.beside.list, null);
    assert.equal(r.panels.length, 0);
    assert.equal(r.holder.children.length, 3);
    r.beside.refresh(); // the page's lists changing mean nothing to it
    assert.ok(!r.beside.open);
  });

  it('puts his buttons at the right end of an open book\'s toolbar, in its plane', () => {
    const r = reading();
    r.ia.state = 'browse';
    r.beside.update();
    assert.equal(r.beside.button, null, 'nothing made until a book is in hand in the headset');
    r.ia.state = 'read';
    r.beside.update();
    const { button, list } = r.beside;
    assert.ok(button && list);
    assert.deepEqual(r.panels, [button, list], 'pointed at and drawn as the room\'s panels are');
    assert.ok(button.mesh.parent === r.holder && list.mesh.parent === r.holder, 'in the book\'s frame');
    assert.ok(button.visible && !list.visible, 'one of the two at a time');
    assert.ok(!r.beside.open);
    // Beside the toolbar: 2 cm from its end, turned as it is, as high as it.
    r.holder.updateMatrixWorld(true);
    const at = r.toolbar.mesh.worldToLocal(button.mesh.getWorldPosition(new THREE.Vector3()));
    near(at.x, 0.36 + 0.02 + 0.125, 'x');
    near(at.y, 0, 'y');
    near(at.z, 0, 'z');
    assert.ok(button.mesh.quaternion.angleTo(r.toolbar.mesh.quaternion) < 1e-6, 'turned as the toolbar is');
    assert.equal([button.w, button.h].join('×'), '325×182');
    assert.equal(button.background, null, 'no ground of its own: two buttons');
    // "Also in the library" above, "Mentioned here" under it, level with the toolbar's buttons.
    const [also, here] = [button.get('also'), button.get('here')];
    assert.deepEqual([also.label, here.label], ['Also in the library', 'Mentioned here']);
    assert.ok(also.y + also.h < here.y && !also.hidden && !here.hidden);
    // Chosen: each asks through its list of the page; between them, nothing.
    assert.equal(button.click(0.5, 0.25), true);
    assert.equal(button.click(0.5, 0.75), true);
    assert.equal(button.click(0.5, 0.5), false);
    assert.deepEqual([r.here.log, r.also.log], [['toggle'], ['toggle']]);
  });

  it('with a book in hand and not open: "Also in the library" alone, under the book\'s own panel, his list on its other side', () => {
    const r = reading({ state: 'inspect' });
    r.beside.update();
    const { button, list } = r.beside;
    assert.ok(button.visible && !list.visible);
    assert.equal(button.get('here').hidden, true, 'its pages are not open');
    assert.ok(!button.get('also').hidden);
    assert.equal(button.click(0.5, 0.25), false);
    assert.equal(button.click(0.5, 0.75), true);
    assert.deepEqual([r.here.log, r.also.log], [[], ['toggle']]);
    // Under the book's panel, 1 cm from its foot, turned as it is.
    const own = r.inspectPanel.mesh;
    near(button.mesh.position.x, own.position.x, 'x');
    near(button.mesh.position.y, 0.02 - 0.205 - 0.01 - 0.07, 'y');
    near(button.mesh.position.z, 0.02, 'z');
    near(button.mesh.rotation.y, -0.25, 'turn');
    near(button.mesh.scale.x, 1, 'size');
    // His list left of the book, as far from it as the book's panel is on the right.
    near(list.mesh.position.x, -(0.2 * 0.62 + 0.03 + 0.25), 'list x');
    near(list.mesh.position.y, 0.02, 'list y');
    near(list.mesh.rotation.y, 0.25, 'list turn');
    // Asked there: his list, with what each find is to the book.
    r.ask(r.also);
    assert.ok(list.visible && !button.visible);
    r.answer({
      text: 'Also in the library: the article on its author and the same work in Wikisource.',
      finds: [
        { kind: 'article', article: { title: 'Mark Twain', book: 'v412', n: 7 }, lib: { id: 'wp', title: 'Wikipedia' }, also: 'author' },
        { kind: 'book', book: { id: 'h', title: 'Adventures of Huckleberry Finn', author: 'Mark Twain' }, lib: { id: 'ws', title: 'Wikisource' }, also: 'same' },
      ],
      search: null,
    }, r.also);
    assert.deepEqual(list.elements[0].text, 'Also in the library');
    assert.deepEqual(list.get('finds').items.map((/** @type {any} */ it) => [it.label, it.sub]), [
      ['Mark Twain', 'About its author · Wikipedia'], ['Adventures of Huckleberry Finn', 'The same work · Wikisource'],
    ]);
    list.get('finds').items[1].onClick();
    list.get('close').onClick();
    assert.deepEqual(r.also.log.slice(1), [['take', 'Adventures of Huckleberry Finn'], ['close', { back: true }]]);
    // The book opened with the list still asked: it is beside the pages now, and both buttons wait.
    r.ia.state = 'busy';
    r.beside.update();
    assert.ok(!list.visible && !button.visible);
    r.ia.state = 'read';
    r.beside.update();
    assert.ok(list.visible && !button.visible);
    near(list.mesh.position.x, 0.3 + 0.03 + 0.25, 'beside the right-hand page');
    near(list.mesh.rotation.y, -0.45, 'turned to the reader');
    r.close(r.also);
    assert.ok(button.visible && !button.get('here').hidden);
    r.holder.updateMatrixWorld(true);
    near(r.toolbar.mesh.worldToLocal(button.mesh.getWorldPosition(new THREE.Vector3())).x, 0.36 + 0.02 + 0.125, 'by the toolbar again');
    // Without "Also in the library" a book in hand has no button of his.
    const plain = reading({ state: 'inspect', also: false });
    plain.beside.update();
    assert.equal(plain.beside.button, null);
  });

  it('shows his panel beside the pages as it is asked: what he is doing, then his answer and the finds', () => {
    const r = reading();
    r.beside.update();
    const { button, list } = r.beside;
    r.ask();
    assert.ok(list.visible && !button.visible && r.beside.open);
    assert.equal(r.opened.n, 1);
    assert.equal(list.elements[0].text, 'Mentioned here');
    assert.equal(list.get('answer').text, 'Looking…');
    assert.equal(list.get('answer').color, UI.muted);
    assert.equal(list.get('finds'), undefined);
    r.here.step = 'Getting the titles of 6 libraries…';
    r.beside.refresh();
    assert.equal(list.get('answer').text, 'Getting the titles of 6 libraries…');
    assert.equal(r.opened.n, 1, 'opened once');
    const finds = [find('World Health Organization', 4), find('Immune system', 7), find('Hepatitis B', 9)];
    r.answer({ text: 'These pages name 3 articles of other libraries.', said: 'These pages name 3 articles of other libraries: A, B and C.', finds, search: null });
    const words = list.get('answer');
    assert.equal(words.text, 'These pages name 3 articles of other libraries.'); // what is shown, not what is said
    assert.equal(words.color, UI.text);
    const rows = list.get('finds');
    assert.deepEqual(rows.items.map((/** @type {any} */ it) => [it.label, it.sub, it.right]), [
      ['World Health Organization', 'WikiMed', 'Take me there'], ['Immune system', 'WikiMed', 'Take me there'], ['Hepatitis B', 'WikiMed', 'Take me there'],
    ]);
    // All of them show, under his words, within the panel.
    assert.equal(rows.h, 3 * 76);
    assert.ok(rows.y >= words.y + words.h && rows.y + rows.h <= list.h, `${rows.y} + ${rows.h} in ${list.h}`);
    // A row chosen is taken through the page's list (which closes it); ✕ closes it.
    rows.items[1].onClick();
    list.get('close').onClick();
    assert.deepEqual(r.here.log, [['take', 'Immune system'], ['close', { back: true }]]);
    // Closed (a page turned, an article taken): the buttons again, at once.
    r.close();
    assert.ok(!list.visible && button.visible);
    // Asked again, with five finds and a long answer: all five rows still fit.
    r.ask();
    assert.equal(r.opened.n, 2);
    const five = ['Alpha beta', 'Gamma delta', 'Epsilon zeta', 'Eta theta', 'Iota kappa'].map((t, i) => find(t, i));
    r.answer({ text: 'These pages name 7 articles of other libraries; here are the first 5. I could not get the titles of Physics. Wikipedia is too large for me to look in.', finds: five, search: null });
    const many = list.get('finds');
    assert.equal(many.items.length, 5);
    assert.equal(many.h, 5 * 76);
    assert.ok(many.y + many.h <= list.h, `${many.y} + ${many.h} in ${list.h}`);
    assert.ok(list.get('answer').maxLines >= 3);
    // The other list asked instead (the page closes the first): his panel is that one's.
    r.here.open = false;
    r.ask(r.also);
    assert.equal(list.elements[0].text, 'Also in the library');
    assert.equal(r.beside.asked, r.also);
  });

  it('says so with no finds, and has his Voice button where there is a voice to choose', () => {
    const r = reading();
    r.beside.update();
    const { list } = r.beside;
    r.ask();
    r.answer({ text: 'I see nothing on these pages that another library has an article on.', finds: [], search: null });
    assert.equal(list.get('finds'), undefined);
    const voice = list.get('voice');
    assert.deepEqual([voice.label, !!voice.active, !!voice.disabled], ['Voice: off', false, false]);
    voice.onClick();
    assert.deepEqual(r.speech.log, [true]);
    r.beside.refresh(); // as librarian.js does once it is chosen
    assert.deepEqual([list.get('voice').label, list.get('voice').active], ['Voice: on', true]);
    r.speech.has = false;
    r.beside.refresh();
    assert.deepEqual([list.get('voice').label, list.get('voice').disabled], ['No voice', true]);
    // Without his voice at all (none given), no such button.
    const mute = reading({ voice: false });
    mute.beside.update();
    mute.ask();
    assert.equal(mute.beside.list.get('voice'), undefined);
    assert.ok(mute.beside.list.get('close'));
  });

  it('goes with the book: hidden while it comes or goes, out of the headset, or with him hidden', () => {
    const r = reading();
    r.beside.update();
    const { button, list } = r.beside;
    const shown = () => [button.visible, list.visible];
    assert.deepEqual(shown(), [true, false]);
    r.ia.state = 'busy'; // another book coming into hand
    r.beside.update();
    assert.deepEqual(shown(), [false, false]);
    r.ia.state = 'read';
    r.beside.update();
    assert.deepEqual(shown(), [true, false]);
    r.ia.controls.presenting = false;
    r.beside.update();
    assert.deepEqual(shown(), [false, false]);
    r.ia.controls.presenting = true;
    r.beside.setShown(false);
    r.beside.update();
    assert.deepEqual(shown(), [false, false]);
    r.beside.setShown(true);
    r.ia.book3d = null; // put back
    r.ia.state = 'browse';
    r.beside.update();
    assert.deepEqual(shown(), [false, false]);
  });

  it('shows the list at once when it was asked on a screen before the headset', () => {
    const r = reading({ presenting: false });
    r.here.open = true;
    r.here.answer = { text: 'This page names one article of another library.', finds: [find('Isaac Newton', 2)], search: null };
    r.beside.refresh();
    r.beside.update();
    assert.equal(r.beside.list, null);
    r.ia.controls.presenting = true;
    r.beside.update();
    assert.ok(r.beside.list.visible && !r.beside.button.visible);
    assert.equal(r.opened.n, 1);
    assert.equal(r.beside.list.get('finds').items[0].label, 'Isaac Newton');
  });

  it('is placed beside the right-hand page, turned to the reader, and again only when the book moves', () => {
    const r = reading();
    r.beside.update();
    const { button, list } = r.beside;
    // Two pages: the right one ends 0.2 × 1.5 m from the spine; the list 3 cm beyond, as the
    // contents are on the other side.
    near(list.mesh.position.x, 0.3 + 0.03 + 0.25, 'x');
    near(list.mesh.position.y, 0.04, 'y');
    near(list.mesh.position.z, 0.08, 'z');
    near(list.mesh.rotation.y, -0.45, 'turn');
    assert.equal([list.w, list.h].join('×'), '650×702');
    // Frames with nothing changed: nothing placed, nothing drawn again, no object made of the page's size.
    button.update();
    list.update();
    const was = button.mesh.position.clone();
    button.mesh.position.x += 1; // a mark: it stays where nothing moved
    for (let i = 0; i < 5; i++) r.beside.update();
    near(button.mesh.position.x, was.x + 1, 'left alone');
    assert.ok(!button.dirty && !list.dirty);
    assert.equal(r.seen.sizes, 1, 'the page\'s size is asked once a book');
    // One page at a time: it is in the middle, its edge half a page out.
    r.book3d.single = true;
    r.beside.update();
    near(list.mesh.position.x, 0.15 + 0.03 + 0.25, 'one page');
    near(button.mesh.position.x, was.x, 'placed again');
    // The book made larger (the stick), the toolbar lower: both follow.
    r.book3d.single = false;
    r.book3d.group.scale.setScalar(2);
    r.toolbar.mesh.position.y = -0.4;
    r.beside.update();
    near(list.mesh.position.x, 0.4 + 0.03 + 0.25, 'larger');
    r.holder.updateMatrixWorld(true);
    near(r.toolbar.mesh.worldToLocal(button.mesh.getWorldPosition(new THREE.Vector3())).y, 0, 'lower');
    // Another book: its own page's size.
    r.ia.book3d = { group: r.book3d.group, single: false, dims: { d: 0.2 }, pageSize: { w: 0.1, h: 0.14 } };
    r.beside.update();
    near(list.mesh.position.x, 0.2 + 0.03 + 0.25, 'another book');
  });

  it('gives his words the lines they take, six at most', () => {
    const r = reading();
    r.beside.update();
    const g = r.beside.list.ctx;
    assert.equal(hereLines(g, 'Looking…', 602), 1);
    assert.equal(hereLines(g, 'These pages name 3 articles of other libraries.', 602), 2); // 47 letters of 13 px
    assert.equal(hereLines(g, 'word '.repeat(400), 602), 6);
  });
});
