// @ts-check
// "Mentioned here" in a headset (docs/LIBRARIAN.md, experiment 3 step 4; SPEC §5.10). The page's
// button and list (here-panel.js) are not seen there, so beside the open book are
// - his button, "Mentioned here", at the right end of the book's toolbar, and
// - his panel: the answer and the articles the pages name, each a way there, to the right of the
//   pages (the contents are to their left), turned towards the reader as they are.
// Both ask and answer through the page's list (HerePanel), as his desk's panel does through the
// card, so a headset and a screen always say the same. A row chosen is followed as a link of the
// book is (librarian.js takeThere: interaction.followTo), and the pages turned close the list.
//
// One of the two is shown at a time: 1 draw call (for each eye) while a book is read in a
// headset, none on a screen and none while browsing. They are made the first time a headset shows
// a book being read. What runs each frame (update) compares a few numbers and makes nothing; a
// panel is drawn again only when its words change (fill, Panel.set) or a pointer lights a row.

import { Panel, UI, wrapText } from '../../vendor/common/panel.js';
import { findLines } from './ask.js';

/** Canvas pixels to a metre, as the book's toolbar and contents have. */
const PX_PER_M = 1300;
/** The button: its size (m), how far from the toolbar's end, and how far below the toolbar's middle (its row of buttons). */
const BUTTON_W = 0.25;
const BUTTON_H = 0.07;
const BUTTON_GAP = 0.02;
const BUTTON_DROP = 0.02;
/** The list: its size (m); beside the page's edge by this much, raised, nearer and turned as the contents are on the other side. */
const LIST_W = 0.5;
const LIST_H = 0.54;
const LIST_GAP = 0.03;
const LIST_UP = 0.04;
const LIST_Z = 0.08;
const LIST_TURN = 0.45;
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

export class HereVR {
  /**
   * @param {object} o
   * @param {any} o.interaction the room's (interaction.js): the open book's frame (holder), its
   *   toolbar and book, its state and controls; addPanel
   * @param {import('./here-panel.js').HerePanel} o.here where the question is asked and answered
   * @param {import('./desk.js').Speech} [o.speech] his voice, as the visitor chose it
   * @param {() => void} [o.onOpen] the list opens (librarian.js: his desk's panel closes, one of
   *   his panels at a time)
   */
  constructor({ interaction, here, speech, onOpen }) {
    this.interaction = interaction;
    this.here = here;
    this.speech = speech;
    this.onOpen = onOpen;
    /** Whether he is shown at all (the help's "Show the librarian"). */
    this.shown = true;
    /** The button and the list, once made. @type {Panel | null} */
    this.button = null;
    /** @type {Panel | null} */
    this.list = null;
    /** Whether a headset is showing a book being read (update). */
    this._on = false;
    /** The open book the panels were placed by, and its page's width (its pageSize makes an object). */
    this._book = null;
    this._pageW = 0;
    /** What they were last placed by: the toolbar's place and size, the page's edge. */
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

  /** The button and the list, in the open book's frame: pointed at and drawn as its toolbar is. */
  _make() {
    const ia = this.interaction;
    const button = new Panel({ width: BUTTON_W, height: BUTTON_H, pxPerMeter: PX_PER_M });
    button.mesh.name = 'librarian-here-button';
    button.visible = false;
    button.add({
      id: 'here', type: 'button', x: 6, y: 6, w: button.w - 12, h: button.h - 12, label: 'Mentioned here', size: 28,
      onClick: () => this.here.toggle(),
    });
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
   * Each frame (it makes nothing): in a headset with a book being read, the button, or the list
   * once asked, where the book is now; else neither.
   */
  update() {
    const ia = this.interaction;
    const on = this.shown && !!ia.controls?.presenting && ia.state === 'read' && !!ia.book3d;
    if (!on) {
      if (this._on) this._hide();
      return;
    }
    if (!this.button || !this.list) this._make();
    this._on = true;
    this._show(this.here.open);
    // Where the book and its toolbar are now (a distance or a size changed, one page or two).
    const b3 = ia.book3d;
    if (b3 !== this._book) {
      this._book = b3;
      this._pageW = b3.pageSize.w;
    }
    const bar = ia.toolbar.mesh;
    const s = bar.scale.x;
    // The right-hand page's edge: one page is shown in the middle, two either side of the spine.
    const edge = (b3.single ? this._pageW / 2 : this._pageW) * b3.group.scale.x;
    if (bar.position.y === this._barY && s === this._barS && edge === this._edge) return;
    this._barY = bar.position.y;
    this._barS = s;
    this._edge = edge;
    const m = /** @type {Panel} */ (this.button).mesh;
    m.position.copy(bar.position);
    m.quaternion.copy(bar.quaternion);
    m.scale.copy(bar.scale);
    m.translateX((ia.toolbar.width / 2 + BUTTON_GAP + BUTTON_W / 2) * s);
    m.translateY(-BUTTON_DROP * s);
    const l = /** @type {Panel} */ (this.list).mesh;
    l.position.set(edge + LIST_GAP + LIST_W / 2, LIST_UP, LIST_Z);
    l.rotation.set(0, -LIST_TURN, 0);
  }

  /**
   * The list shown (asked) or the button (not), whichever is not yet: the list filled as it
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
   * The page's list changed (asked, a step, answered, closed), or his voice was chosen: the list
   * again, where it is shown. Closed, it goes at once (not a frame later).
   */
  refresh() {
    if (!this._on || !this.list) return;
    const open = this.here.open;
    const was = this.list.visible;
    this._show(open);
    if (open && was) this.fill();
  }

  /** The list: its heading, Voice and ✕, his words (what he is doing until they come), and the finds. */
  fill() {
    const p = this.list;
    if (!p) return;
    const here = this.here;
    const W = p.w;
    const pad = 24;
    p.clear();
    const speech = this.speech;
    const voiceW = speech ? VOICE_W + 10 : 0;
    p.add({ type: 'text', x: pad, y: 22, w: W - 2 * pad - 70 - voiceW, h: 46, text: 'Mentioned here', size: 36, weight: '600', serif: true, color: UI.accent, maxLines: 1 });
    p.add({ id: 'close', type: 'button', x: W - pad - 60, y: 16, w: 60, h: 52, label: '✕', size: 28, onClick: () => here.close({ back: true }) });
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
    const answer = here.looking ? null : here.answer;
    // What is shown: his answer's text (aloud he names the articles too, which the rows show).
    const words = answer ? answer.text : here.step || 'Looking…';
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
        // An article's library alone under its name: with its volume too the line would be cut
        // ("WikiMed Medical Encyclopedia (introductions) · Volume 71" beside "Take me there").
        const sub = find.kind === 'article' ? String(find.lib.title ?? '') : line;
        return { label: title, sub, right: 'Take me there', onClick: () => here.take(find) };
      }),
    });
  }
}
