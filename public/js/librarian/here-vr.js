// @ts-check
// The librarian beside a book in a headset (docs/LIBRARIAN.md, experiment 3 steps 3 and 4; SPEC
// §5.10). The page's buttons and lists (here-panel.js) are not seen there, so beside the book are
// - his buttons: "Also in the library" with a book in hand, and under it "Mentioned here" once
//   the book is open; at the right end of an open book's toolbar, under a closed book's own panel;
// - his panel: the answer and what he found, each a way there, to the right of an open book's
//   pages (the contents are to their left), to the left of a closed book (its panel is to its
//   right), turned towards the reader.
// They ask and answer through the page's lists (HerePanel), as his desk's panel does through the
// card, so a headset and a screen always say the same. A row chosen is taken as on a screen
// (librarian.js), and what a list was asked of going (the pages turned, the book put back) closes
// it.
//
// The buttons are one panel and the list another, one of the two shown at a time: 1 draw call
// (for each eye) while a book is in hand in a headset, none on a screen and none while browsing.
// They are made the first time a headset shows a book in hand. What runs each frame (update)
// compares a few numbers and makes nothing; a panel is drawn again only when its words change
// (fill, Panel.set) or a pointer lights a row.

import { Panel, UI, wrapText } from '../../vendor/common/panel.js';
import { ALSO, findLines } from './ask.js';

/** Canvas pixels to a metre, as the book's toolbar and contents have. */
const PX_PER_M = 1300;
/**
 * The buttons: the panel's size (m; two rows, as high as the toolbar), how far from the toolbar's
 * end, and how far under a closed book's panel.
 */
const BUTTONS_W = 0.25;
const BUTTONS_H = 0.14;
const BUTTONS_GAP = 0.02;
const BUTTONS_UNDER = 0.01;
/** The list: its size (m); beside the page's edge by this much, raised, nearer and turned as the contents are on the other side. */
const LIST_W = 0.5;
const LIST_H = 0.54;
const LIST_GAP = 0.03;
const LIST_UP = 0.04;
const LIST_Z = 0.08;
const LIST_TURN = 0.45;
/** Beside a closed book: as its own panel is on the other side (interaction.js pick). */
const HAND_AT = 0.62;
const HAND_UP = 0.02;
const HAND_Z = 0.02;
const HAND_TURN = 0.25;
/** The list's Voice button's width (px), beside its ✕. */
const VOICE_W = 150;
/** His words on it: their size (px) and a line's height, as Panel draws text; at most this many lines. */
const ANSWER_SIZE = 26;
const ANSWER_LINE = ANSWER_SIZE * 1.25;
const ANSWER_LINES = 6;
/** A find's row (px). */
const ROW_H = 76;

/**
 * The lines his words take on the list, as Panel wraps them, from 1 to ANSWER_LINES.
 * @param {CanvasRenderingContext2D} g the panel's
 * @param {string} text
 * @param {number} width
 */
export function hereLines(g, text, width) {
  g.font = `${ANSWER_SIZE}px ${UI.font}`;
  return Math.max(1, Math.min(ANSWER_LINES, wrapText(g, text, width).length));
}

/** @typedef {import('./here-panel.js').HerePanel} HerePanel */

export class HereVR {
  /**
   * @param {object} o
   * @param {any} o.interaction the room's (interaction.js): the book in hand's frame (holder), its
   *   own panel (inspectPanel), an open book's toolbar, the book, its state and controls; addPanel
   * @param {HerePanel} o.here "Mentioned here": asked of an open book's pages
   * @param {HerePanel | null} [o.also] "Also in the library": asked of a book in hand, open or not
   * @param {import('./desk.js').Speech} [o.speech] his voice, as the visitor chose it
   * @param {() => void} [o.onOpen] the list opens (librarian.js: his desk's panel closes, one of
   *   his panels at a time)
   */
  constructor({ interaction, here, also = null, speech, onOpen }) {
    this.interaction = interaction;
    this.here = here;
    this.also = also;
    this.speech = speech;
    this.onOpen = onOpen;
    /** Whether he is shown at all (the help's "Show the librarian"). */
    this.shown = true;
    /** The buttons and the list, once made. @type {Panel | null} */
    this.button = null;
    /** @type {Panel | null} */
    this.list = null;
    /** Whether a headset is showing a book in hand (update), and whether it is open. */
    this._on = false;
    this._reading = false;
    /** The book the panels were placed by, and its page's width (its pageSize makes an object). */
    this._book = null;
    this._pageW = 0;
    /** What they were last placed by: an open book's toolbar and page's edge, or a closed book's panel. */
    this._barY = NaN;
    this._barS = NaN;
    this._edge = NaN;
  }

  /** Shown or not, with the librarian. @param {boolean} on */
  setShown(on) {
    this.shown = on;
  }

  /** Whether the list is shown beside the book. */
  get open() {
    return !!this.list?.visible;
  }

  /** The page's list that is open, if one is: what his panel shows. @returns {HerePanel | null} */
  get asked() {
    return this.here.open ? this.here : this.also?.open ? this.also : null;
  }

  /** The buttons and the list, in the book's frame: pointed at and drawn as its toolbar is. */
  _make() {
    const ia = this.interaction;
    // No ground of its own: with a book in hand but not open only its upper button is there.
    const button = new Panel({ width: BUTTONS_W, height: BUTTONS_H, pxPerMeter: PX_PER_M, background: null });
    button.mesh.name = 'librarian-here-button';
    button.visible = false;
    const row = Math.floor((button.h - 12) / 2);
    const also = this.also;
    if (also) {
      button.add({ id: 'also', type: 'button', x: 3, y: 3, w: button.w - 6, h: row, label: also.label, size: 26, onClick: () => also.toggle() });
    }
    button.add({ id: 'here', type: 'button', x: 3, y: button.h - 3 - row, w: button.w - 6, h: row, label: this.here.label, size: 28, onClick: () => this.here.toggle() });
    const list = new Panel({ width: LIST_W, height: LIST_H, pxPerMeter: PX_PER_M });
    list.mesh.name = 'librarian-here';
    list.visible = false;
    ia.holder.add(button.mesh, list.mesh);
    ia.addPanel(button);
    ia.addPanel(list);
    this.button = button;
    this.list = list;
  }

  /**
   * Each frame (it makes nothing): in a headset with a book in hand, his buttons, or his list once
   * asked, where the book is now; else neither.
   */
  update() {
    const ia = this.interaction;
    const reading = ia.state === 'read';
    const on = this.shown && !!ia.controls?.presenting && !!ia.book3d && (reading || (ia.state === 'inspect' && !!this.also));
    if (!on) {
      if (this._on) this._hide();
      return;
    }
    if (!this.button || !this.list) this._make();
    const button = /** @type {Panel} */ (this.button);
    const list = /** @type {Panel} */ (this.list);
    const moved = !this._on || reading !== this._reading;
    if (moved) {
      this._on = true;
      this._reading = reading;
      button.set('here', { hidden: !reading }); // of an open book's pages only
    }
    this._show(this.here.open || !!this.also?.open);
    const b3 = ia.book3d;
    if (b3 !== this._book) {
      this._book = b3;
      this._pageW = b3.pageSize.w;
    }
    if (reading) {
      // Beside the toolbar and the right-hand page: where they are now (a distance or a size
      // changed, one page or two). One page is shown in the middle, two either side of the spine.
      const bar = ia.toolbar.mesh;
      const s = bar.scale.x;
      const edge = (b3.single ? this._pageW / 2 : this._pageW) * b3.group.scale.x;
      if (!moved && bar.position.y === this._barY && s === this._barS && edge === this._edge) return;
      this._barY = bar.position.y;
      this._barS = s;
      this._edge = edge;
      const m = button.mesh;
      m.position.copy(bar.position);
      m.quaternion.copy(bar.quaternion);
      m.scale.copy(bar.scale);
      m.translateX((ia.toolbar.width / 2 + BUTTONS_GAP + BUTTONS_W / 2) * s);
      list.mesh.position.set(edge + LIST_GAP + LIST_W / 2, LIST_UP, LIST_Z);
      list.mesh.rotation.set(0, -LIST_TURN, 0);
      return;
    }
    // A closed book in hand: the buttons under its own panel, the list on the book's other side.
    const own = ia.inspectPanel;
    const x = own.mesh.position.x;
    if (!moved && x === this._edge) return;
    this._edge = x;
    this._barY = NaN;
    const m = button.mesh;
    m.position.set(x, own.mesh.position.y - own.height / 2 - BUTTONS_UNDER - BUTTONS_H / 2, own.mesh.position.z);
    m.rotation.copy(own.mesh.rotation);
    m.scale.setScalar(1);
    list.mesh.position.set(-(b3.dims.d * HAND_AT + LIST_GAP + LIST_W / 2), HAND_UP, HAND_Z);
    list.mesh.rotation.set(0, HAND_TURN, 0);
  }

  /**
   * The list shown (asked) or the buttons (not), whichever is not yet: the list filled as it
   * comes. It makes nothing when nothing changes.
   * @param {boolean} open
   */
  _show(open) {
    const button = /** @type {Panel} */ (this.button);
    const list = /** @type {Panel} */ (this.list);
    if (list.visible !== open) {
      if (open) {
        this.onOpen?.();
        this.fill();
      }
      list.visible = open;
    }
    if (button.visible === open) button.visible = !open;
  }

  /** Neither is shown: out of the headset, the book put back, or he is hidden. */
  _hide() {
    this._on = false;
    if (this.button?.visible) this.button.visible = false;
    if (this.list?.visible) this.list.visible = false;
  }

  /**
   * A page's list changed (asked, a step, answered, closed), or his voice was chosen: his list
   * again, where it is shown. Closed, it goes at once (not a frame later).
   */
  refresh() {
    if (!this._on || !this.list) return;
    const open = !!this.asked;
    const was = this.list.visible;
    this._show(open);
    if (open && was) this.fill();
  }

  /** The list: its heading, Voice and ✕, his words (what he is doing until they come), and the finds. */
  fill() {
    const p = this.list;
    const asked = this.asked;
    if (!p || !asked) return;
    const W = p.w;
    const pad = 24;
    p.clear();
    const speech = this.speech;
    const voiceW = speech ? VOICE_W + 10 : 0;
    p.add({ type: 'text', x: pad, y: 22, w: W - 2 * pad - 70 - voiceW, h: 46, text: asked.label, size: 36, weight: '600', serif: true, color: UI.accent, maxLines: 1 });
    p.add({ id: 'close', type: 'button', x: W - pad - 60, y: 16, w: 60, h: 52, label: '✕', size: 28, onClick: () => asked.close({ back: true }) });
    // Whether he speaks his answers, as on his desk's panel; "No voice" where the device has none.
    if (speech) {
      const ok = speech.available();
      const on = ok && speech.on();
      p.add({
        id: 'voice', type: 'button', x: W - pad - 60 - 10 - VOICE_W, y: 16, w: VOICE_W, h: 52, size: 22,
        label: !ok ? 'No voice' : on ? 'Voice: on' : 'Voice: off', active: on, disabled: !ok,
        onClick: () => speech.set(!speech.on()),
      });
    }
    const answer = asked.looking ? null : asked.answer;
    // What is shown: his answer's text (aloud he may say more, which the rows show).
    const words = answer ? answer.text : asked.step || 'Looking…';
    let y = 84;
    const lines = hereLines(p.ctx, words, W - 2 * pad);
    p.add({ id: 'answer', type: 'text', x: pad, y, w: W - 2 * pad, h: lines * ANSWER_LINE, text: words, size: ANSWER_SIZE, maxLines: lines, color: answer ? UI.text : UI.muted });
    y += lines * ANSWER_LINE + 12;
    const finds = answer ? answer.finds : [];
    if (!finds.length) return;
    p.add({
      id: 'finds', type: 'list', x: pad - 8, y, w: W - 2 * pad + 16, h: Math.min(finds.length * ROW_H, Math.floor((p.h - y - 16) / ROW_H) * ROW_H), rowH: ROW_H, size: 26,
      items: finds.map((find) => {
        const { title, line } = findLines(find, true);
        // Under its name: what it is to the book in hand and its library ("About its author ·
        // Wikipedia"); an article the pages name, its library alone (with its volume too the
        // line would be cut beside "Take me there").
        const lib = String(find.lib.title ?? '');
        const what = (find.kind === 'book' || find.kind === 'article') && find.also ? ALSO[find.also] : '';
        const sub = what ? `${what} · ${lib}` : find.kind === 'article' ? lib : line;
        return { label: title, sub, right: 'Take me there', onClick: () => asked.take(find) };
      }),
    });
  }
}
