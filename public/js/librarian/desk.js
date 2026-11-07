// @ts-check
// The librarian at the desk (docs/LIBRARIAN.md; SPEC §5.10), experiment 1 step 2: his figure
// beside the catalogue stand, facing where you arrive, turning towards you as you come near; and in
// VR his panel. In a headset you point at him and pull the trigger: the panel has the stand's
// on-screen keyboard, then his answer and what he found, each a way there. On a screen he is a way
// into the card's question box (a click, a tap, a TV's OK with the dot on him). The question is
// asked and answered through the card (card.js), so the two always say the same.
//
// The figure is one draw call, the panel one more while it is open; nothing done every frame makes
// an object.

import * as THREE from 'three';
import { Panel, UI } from '../../vendor/common/panel.js';
import { findLines, PROMPT } from './ask.js';
import { Figure, FIGURE, rayUpright } from './figure.js';

/** The on-screen keyboard's rows: the catalogue stand's (interaction.js SEARCH_KEYS). */
const KEYS = ['1234567890', 'qwertyuiop', "asdfghjkl'", 'zxcvbnm-.,'];
const MAX_QUESTION = 80;
/** Where he stands: this far (m) from the stand's centre, to its left as seen from in front of it. */
const BESIDE = 0.95;
/** His panel: this far (m) from the eyes, turned this far (rad) off the line to him, away from the stand. */
const PANEL_AT = 0.95;
const PANEL_OFF = 0.45;
const PANEL_Y = 1.47; // its centre's height (m), as the stand's
/** Turning towards the viewer: at most this fast (rad/s), this far (rad) either way from rest, from this near (m). */
const TURN_RATE = 1.6;
const TURN_MAX = 1.3;
const NOTICE_RANGE = 6;

const _eye = new THREE.Vector3();

/** a − b as an angle in (−π, π]. @param {number} a @param {number} b */
function angleDiff(a, b) {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

export class Desk {
  /**
   * @param {object} o
   * @param {any} o.interaction the room's (interaction.js): its scene, world, camera, controls,
   *   addPanel, addTarget and onFrame
   * @param {import('./card.js').LibrarianCard} o.card the card's part, through which a question is
   *   asked and answered
   * @param {(find: import('./ask.js').Find) => void} o.take Take me there
   * @param {() => boolean} o.multi whether more than one library has books (a find's line names its library)
   * @param {() => void} o.intoBox on a screen: into the card's question box
   */
  constructor({ interaction, card, take, multi, intoBox }) {
    this.interaction = interaction;
    this.card = card;
    this.take = take;
    this.multi = multi;
    this.intoBox = intoBox;
    this.shown = true;
    this.figure = new Figure();
    interaction.scene.add(this.figure.mesh);
    this.panel = new Panel({ width: 0.9, height: 1.0, pxPerMeter: 1000 });
    this.panel.mesh.name = 'librarian-panel';
    this.panel.visible = false;
    interaction.scene.add(this.panel.mesh);
    interaction.addPanel(this.panel);
    /** The question being typed on the panel's keyboard. */
    this.q = '';
    this._looking = false;
    /** Where he stands and which way he faces: at rest (home) and now (yaw). */
    this.x = 0;
    this.z = 0;
    this.home = 0;
    this.yaw = 0;
    /** The room he was placed in (world.room): another means a rebuild, and a new place by the stand. */
    this._room = null;
    /** His collider among the room's (world.room.colliders): walks go round him, the laser stops. */
    this._collider = { type: 'circle', x: 0, z: 0, r: FIGURE.radius, h: FIGURE.height };
    interaction.addTarget({
      hit: (/** @type {THREE.Ray} */ ray) => (this.shown ? rayUpright(ray, this.x, this.z, FIGURE.hitRadius, FIGURE.hitHeight) : Infinity),
      select: () => this.select(),
      hover: (/** @type {boolean} */ on) => this.figure.setHover(on),
    });
    interaction.onFrame((/** @type {number} */ dt) => this.update(dt));
    card.onLooking = () => {
      this._looking = true;
      this._refill();
    };
    card.onAnswer = () => {
      this._looking = false;
      this._refill();
    };
    this._place();
  }

  /** Shown or not (the help's "Show the librarian"): hidden, he is not in the room at all. @param {boolean} on */
  setShown(on) {
    this.shown = on;
    this.figure.mesh.visible = on;
    if (!on) this.close();
    this._fence();
  }

  /** Pointed at and chosen: in a headset his panel opens (or closes); on a screen, the card's box. */
  select() {
    if (!this.interaction.controls.presenting) this.intoBox();
    else if (this.panel.visible) this.close();
    else this.open();
  }

  /** His panel, in front of the viewer beside him, with the card's question and answer. */
  open() {
    if (!this.shown) return;
    this.q = this.card.input.value.slice(0, MAX_QUESTION);
    this._placePanel();
    this._fill();
    this.panel.visible = true;
  }

  close() {
    this.panel.visible = false;
  }

  /** Per frame: placed again after a rebuild; turned towards a viewer nearby. Makes no objects. @param {number} dt */
  update(dt) {
    const ia = this.interaction;
    if (ia.world.room !== this._room) this._place();
    if (!this.shown) return;
    let want = this.home;
    if (ia.reduced) {
      // With less motion he stands still.
      this.yaw = want;
    } else {
      ia.camera.getWorldPosition(_eye);
      const dx = _eye.x - this.x;
      const dz = _eye.z - this.z;
      if (dx * dx + dz * dz < NOTICE_RANGE * NOTICE_RANGE) {
        const off = angleDiff(Math.atan2(dx, dz), this.home);
        if (Math.abs(off) <= TURN_MAX) want = this.home + off; // not round to someone behind him
      }
      const d = angleDiff(want, this.yaw);
      const step = TURN_RATE * dt;
      this.yaw += Math.abs(d) <= step ? d : Math.sign(d) * step;
    }
    this.figure.mesh.rotation.y = this.yaw;
  }

  /** By the stand (world.kiosk), to its left as seen from in front of it, facing the spawn point. */
  _place() {
    const world = this.interaction.world;
    this._room = world.room;
    const k = world.kiosk;
    // The stand's left as seen from in front: its local −X.
    this.x = k.position.x - BESIDE * Math.cos(k.yaw);
    this.z = k.position.z + BESIDE * Math.sin(k.yaw);
    const sp = world.spawn.position;
    this.home = Math.atan2(sp.x - this.x, sp.z - this.z);
    this.yaw = this.home;
    this.figure.mesh.position.set(this.x, 0, this.z);
    this.figure.mesh.rotation.set(0, this.yaw, 0);
    this._collider.x = this.x;
    this._collider.z = this.z;
    this._fence();
    this.close(); // the room changed round the viewer: the panel would hang where it no longer belongs
  }

  /** His collider in the room's while he is shown, out of it while not. */
  _fence() {
    const list = this.interaction.world.room?.colliders;
    if (!Array.isArray(list)) return;
    const i = list.indexOf(this._collider);
    if (this.shown && i < 0) list.push(this._collider);
    else if (!this.shown && i >= 0) list.splice(i, 1);
  }

  /**
   * The panel in front of the viewer, a little off the line to him on the side away from the stand,
   * so he stands beside it: turned to the viewer and leaning back, as the stand's.
   */
  _placePanel() {
    const ia = this.interaction;
    ia.camera.getWorldPosition(_eye);
    let dx = this.x - _eye.x;
    let dz = this.z - _eye.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    // Looking at him, the viewer's right is (−dz, dx) and their left (dz, −dx): the panel turns
    // off the line to him to the left when the stand is on the right, else to the right.
    const k = ia.world.kiosk.position;
    const standRight = (k.z - _eye.z) * dx - (k.x - _eye.x) * dz;
    const c = Math.cos(PANEL_OFF);
    const s = Math.sin(PANEL_OFF) * (standRight > 0 ? 1 : -1);
    const px = _eye.x + PANEL_AT * (c * dx + s * dz);
    const pz = _eye.z + PANEL_AT * (c * dz - s * dx);
    const m = this.panel.mesh;
    m.position.set(px, PANEL_Y, pz);
    m.rotation.set(0, Math.atan2(_eye.x - px, _eye.z - pz), 0, 'YXZ');
    m.rotateX(-0.12);
  }

  /** The panel again, while it is open (the card's answer came, or is on its way). */
  _refill() {
    if (this.panel.visible) this._fill();
  }

  /** A key of the panel's keyboard: a character, 'backspace', or null (clear). @param {string | null} ch */
  type(ch) {
    if (ch === null) this.q = '';
    else if (ch === 'backspace') this.q = this.q.slice(0, -1);
    else if (this.q.length < MAX_QUESTION && !(ch === ' ' && (!this.q || this.q.endsWith(' ')))) this.q += ch;
    this.panel.set('q', this._questionLine());
    this.panel.set('ask', { active: !!this.q.trim() });
  }

  /** Ask: through the card, which shows it too, and whose answer comes back here (onAnswer). */
  askNow() {
    if (!this.q.trim()) return;
    this.card.input.value = this.q;
    this.card.askNow(this.q);
  }

  /** The question field's text and colour: what is typed and the caret, or what to type. */
  _questionLine() {
    return this.q ? { text: `${this.q}|`, color: UI.text } : { text: '| A title, an author or a subject', color: UI.muted };
  }

  _fill() {
    const p = this.panel;
    const W = p.w;
    const pad = 36;
    p.clear();
    p.add({ type: 'text', x: pad, y: 26, w: W - 2 * pad - 80, h: 54, text: 'Ask the librarian', size: 44, weight: '600', serif: true, color: UI.accent });
    p.add({ id: 'close', type: 'button', x: W - pad - 64, y: 22, w: 64, h: 56, label: '✕', size: 30, onClick: () => this.close() });
    p.add({ type: 'rect', x: pad, y: 96, w: W - 2 * pad, h: 60, radius: 14, color: 'rgba(255,255,255,0.08)' });
    p.add({ id: 'q', type: 'text', x: pad + 18, y: 109, w: W - 2 * pad - 36, h: 40, size: 30, maxLines: 1, ...this._questionLine() });
    const gap = 8;
    const kw = (W - 2 * pad - 9 * gap) / 10;
    const kh = 56;
    let y = 172;
    KEYS.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        p.add({ type: 'button', x: pad + c * (kw + gap), y: y + r * (kh + gap), w: kw, h: kh, label: ch.toUpperCase(), size: 28, onClick: () => this.type(ch) });
      });
    });
    y += KEYS.length * (kh + gap);
    p.add({ type: 'button', x: pad, y, w: 4 * (kw + gap) - gap, h: kh, label: 'Space', size: 24, onClick: () => this.type(' ') });
    p.add({ type: 'button', x: pad + 4 * (kw + gap), y, w: 2 * (kw + gap) - gap, h: kh, label: '⌫', size: 30, onClick: () => this.type('backspace') });
    p.add({ type: 'button', x: pad + 6 * (kw + gap), y, w: 2 * (kw + gap) - gap, h: kh, label: 'Clear', size: 24, onClick: () => this.type(null) });
    p.add({ id: 'ask', type: 'button', x: pad + 8 * (kw + gap), y, w: 2 * (kw + gap) - gap, h: kh, label: 'Ask', size: 26, active: !!this.q.trim(), onClick: () => this.askNow() });
    y += kh + 22;
    const answer = this.card.answer;
    const said = this._looking ? 'Looking…' : answer ? answer.text : PROMPT;
    p.add({ id: 'answer', type: 'text', x: pad, y, w: W - 2 * pad, h: 104, text: said, size: 28, maxLines: 3, color: !this._looking && answer ? UI.text : UI.muted });
    y += 112;
    const finds = !this._looking && answer ? answer.finds : [];
    if (!finds.length) return;
    const multi = this.multi();
    p.add({
      id: 'finds', type: 'list', x: pad, y, w: W - 2 * pad, h: p.h - y - 30, rowH: 70, size: 26,
      items: finds.map((find) => {
        const { title, line } = findLines(find, multi);
        return {
          label: title, sub: line, right: 'Take me there',
          onClick: () => {
            this.close();
            this.take(find);
          },
        };
      }),
    });
  }

  /** For the page's state (debug reports, scenes): whether the panel is open. */
  uiState() {
    return this.panel.visible ? { panel: true } : {};
  }
}
