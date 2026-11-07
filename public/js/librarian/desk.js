// @ts-check
// The librarian at the desk (docs/LIBRARIAN.md; SPEC §5.10), experiment 1 steps 2 to 4: his
// figure beside the catalogue stand, facing where you arrive and turning towards you as you come
// near; his panel in VR; his walk to what he found; and his voice.
// - In a headset you point at him and pull the trigger: the panel has the stand's on-screen
//   keyboard, then his answer and what he found, each a way there. On a screen he is a way into
//   the card's question box (a click, a tap, a TV's OK with the dot on him). The question is asked
//   and answered through the card (card.js), so the two always say the same.
// - Take me there (the card's or the panel's): he goes ahead along a way round what stands in the
//   room (path.js), you follow, eased (walk.js), with the comfort vignette in VR, where a long
//   way's middle is skipped in a blink, and the turn to the shelf at the end is a blink too; he
//   stands beside the shelf as the book comes out to you. A click, a tap, the trigger, a pad's A,
//   Enter, Esc or a TV's OK (librarian.js) is there at once. With less motion, or with him hidden,
//   it is the cut to the shelf it was. Once the book is back and you have gone on (or after a
//   while) he walks back to the desk.
// - When the visitor has chosen it (the help dialog, or his panel's Voice button), he says each
//   answer aloud (voice.js, through librarian.js); a new question, or hiding him, stops it.
//
// The figure is one draw call, the panel one more while it is open, the way on the floor one more
// while walking; nothing done every frame makes an object. A walk's planning is a grid over the
// floor, made once per room, and a search over it (perf events `librarian-floor`, `librarian-way`).

import * as THREE from 'three';
import { VIGNETTE } from '../../vendor/common/access.js';
import { Panel, UI } from '../../vendor/common/panel.js';
import { perf } from '../perf.js';
import { findLines, PROMPT } from './ask.js';
import { Figure, FIGURE, rayUpright } from './figure.js';
import { along, Floor, pathLengths } from './path.js';
import { aheadWay, besideEnd, Walk, WALK, WayLine } from './walk.js';

/** @typedef {import('./path.js').Spot} Spot */
/** @typedef {import('./path.js').Along} Along */

/**
 * His voice, as the visitor chose it (librarian.js, over voice.js).
 * @typedef {object} Speech
 * @property {() => boolean} available whether the device has a voice for him
 * @property {() => boolean} on whether he speaks his answers: chosen, and a voice here
 * @property {(on: boolean) => void} set chooses it (his panel's Voice button)
 * @property {(text: string) => void} say says it, stopping what he was saying
 * @property {() => void} stop
 */

/** The on-screen keyboard's rows: the catalogue stand's (interaction.js SEARCH_KEYS). */
const KEYS = ['1234567890', 'qwertyuiop', "asdfghjkl'", 'zxcvbnm-.,'];
const MAX_QUESTION = 80;
/** Where he stands: this far (m) from the stand's centre, to its left as seen from in front of it. */
const BESIDE = 0.95;
/** His panel: this far (m) from the eyes, turned this far (rad) off the line to him, away from the stand. */
const PANEL_AT = 0.95;
const PANEL_OFF = 0.45;
const PANEL_Y = 1.47; // its centre's height (m), as the stand's
/** The panel's Voice button's width (px), beside its ✕. */
const VOICE_W = 180;
/** Turning towards the viewer: at most this fast (rad/s), this far (rad) either way from rest, from this near (m). */
const TURN_RATE = 1.6;
const TURN_MAX = 1.3;
const NOTICE_RANGE = 6;
/** The walks: a way shorter than this (m) is not walked; he comes from this far (m) at most, else he is put ahead of the viewer. */
const MIN_WALK = 0.8;
const JOIN_MAX = 4;
/**
 * A way keeps this far (m) from furniture and bookcases, and this much further from the walls than
 * the room's own margin: so far at the floor grid's cells, a straight line between them at most
 * half a cell's diagonal (0.18 m) nearer.
 */
const CLEARANCE = 0.4;
const WALL_CLEARANCE = 0.25;
/** He keeps clear of the viewer's middle by this much (m) on his own ways: by 0.6 m at least, their two widths. */
const CLEAR_OF_VIEWER = 0.8;
/** On a screen the view turns at most this fast (rad/s) while walking; he turns this fast (rad/s) as he goes. */
const VIEW_TURN = 2.2;
const WALK_TURN = 5;
/** His steps: a bob this high (m), one per this far (m). */
const BOB = 0.012;
const STRIDE = 0.7;
/** Back to the desk once the viewer is this far from him (m), or after this long (s) of browsing. */
const BACK_AWAY = 3.5;
const BACK_AFTER = 20;

const _eye = new THREE.Vector3();
const _feet = new THREE.Vector3();

/** a − b as an angle in (−π, π]. @param {number} a @param {number} b */
function angleDiff(a, b) {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * The book a find is in: the book itself, an article's volume, a passage's book; null when the
 * catalogue has no such book.
 * @param {import('./ask.js').Find} find
 * @param {Record<string, any[]> | undefined} booksByLib
 */
export function bookOf(find, booksByLib) {
  if (find.kind === 'book') return find.book;
  const id = find.kind === 'article' ? find.article.book : find.hit.to.book;
  return (booksByLib?.[find.lib.id] || []).find((b) => b.id === id) ?? null;
}

/**
 * One walk under way: the walk itself, where the viewer will stand and look, which way he faces
 * the shelf, and the way to show.
 * @typedef {{ walk: Walk, way: Spot[], end: Spot, endYaw: number, shelfYaw: number }} Plan
 */

export class Desk {
  /**
   * @param {object} o
   * @param {any} o.interaction the room's (interaction.js): its scene, world, camera, controls,
   *   state, reduced, putBack, ensureShelved, booksByLib and _fadeTo; addPanel, addTarget and onFrame
   * @param {import('./card.js').LibrarianCard} o.card the card's part, through which a question is
   *   asked and answered
   * @param {(find: import('./ask.js').Find) => any} o.take the way there without him: a cut to
   *   the shelf, the book out (librarian.js takeThere)
   * @param {() => boolean} o.multi whether more than one library has books (a find's line names its library)
   * @param {() => void} o.intoBox on a screen: into the card's question box
   * @param {(on: boolean) => void} [o.onWalk] true as he starts to lead the way, false once the
   *   book is out (or the walk ended without it): the page's card fades meanwhile (librarian.js)
   * @param {Speech} [o.speech] his voice, as the visitor chose it
   */
  constructor({ interaction, card, take, multi, intoBox, onWalk, speech }) {
    this.interaction = interaction;
    this.card = card;
    this.take = take;
    this.multi = multi;
    this.intoBox = intoBox;
    this.onWalk = onWalk;
    this.speech = speech;
    this.shown = true;
    this.figure = new Figure();
    interaction.scene.add(this.figure.mesh);
    this.panel = new Panel({ width: 0.9, height: 1.0, pxPerMeter: 1000 });
    this.panel.mesh.name = 'librarian-panel';
    this.panel.visible = false;
    interaction.scene.add(this.panel.mesh);
    interaction.addPanel(this.panel);
    this.line = new WayLine();
    interaction.scene.add(this.line.mesh);
    /** The question being typed on the panel's keyboard. */
    this.q = '';
    this._looking = false;
    /** Where he stands and which way he faces: at rest (home) and now (yaw). */
    this.x = 0;
    this.z = 0;
    this.home = 0;
    this.yaw = 0;
    /** His place at the desk, and which way he faces there (the spawn point). */
    this.deskX = 0;
    this.deskZ = 0;
    this.deskHome = 0;
    /** Away from the desk (beside a shelf he led the viewer to), and how long the viewer has browsed since. */
    this.away = false;
    this._awayFor = 0;
    /** His walk back to the desk: its way, how far along. @type {{ way: Spot[], lengths: Float64Array, s: number, at: Along } | null} */
    this._back = null;
    /** The walk under way. @type {Plan | null} */
    this._plan = null;
    /** Resolves the walk's promise: true there, false when the room changed under it. @type {((arrived: boolean) => void) | null} */
    this._walkDone = null;
    /** The controls' choices the walk set aside. @type {{ loco: boolean, look: boolean } | null} */
    this._saved = null;
    /** A blink under way, and whether it ends the walk (a skip in VR). */
    this._blinking = false;
    this._skip = false;
    /** The view's fades (interaction's), one after another, never two at once. @type {Promise<unknown>} */
    this._fading = Promise.resolve();
    /** Where the viewer's way had them a frame ago: the walk moves them by the difference. */
    this._lastX = 0;
    this._lastZ = 0;
    /** How far he has walked (his steps' bob), and the bob now. */
    this._stride = 0;
    this._bob = 0;
    /** The room he was placed in (world.room): another means a rebuild, and a new place by the stand. */
    this._room = null;
    /** Where one can stand in that room, made at its first walk. @type {{ room: any, floor: Floor } | null} */
    this._floor = null;
    /** His collider among the room's (world.room.colliders): the viewer and the laser stop at him. */
    this._collider = { type: 'circle', x: 0, z: 0, r: FIGURE.radius, h: FIGURE.height };
    interaction.addTarget({
      hit: (/** @type {THREE.Ray} */ ray) => (this.shown ? rayUpright(ray, this.x, this.z, FIGURE.hitRadius, FIGURE.hitHeight) : Infinity),
      select: () => this.select(),
      hover: (/** @type {boolean} */ on) => this.figure.setHover(on),
    });
    interaction.onFrame((/** @type {number} */ dt) => this.update(dt));
    // A click, a tap, the trigger or a pad's A while walking: there at once.
    interaction.controls?.addEventListener?.('select', () => this.skipWalk());
    card.onLooking = () => {
      this._looking = true;
      this.speech?.stop(); // a new question stops the last answer
      this._refill();
    };
    card.onAnswer = (answer) => {
      this._looking = false;
      if (answer && this.shown && this.speech?.on()) this.speech.say(answer.text);
      else if (!answer) this.speech?.stop();
      this._refill();
    };
    this._place();
  }

  /** His panel again, while it is open: his voice chosen or not elsewhere (the help dialog), or the voices come. */
  refresh() {
    this._refill();
  }

  /** Shown or not (the help's "Show the librarian"): hidden, he is not in the room at all. @param {boolean} on */
  setShown(on) {
    this.shown = on;
    this.figure.mesh.visible = on;
    if (!on) {
      this.close();
      this.skipWalk(); // it ends at once; shown again, he is at the desk
      this.speech?.stop();
    }
    if (!this._plan) this._toDesk();
    else this._fence();
  }

  /** Whether he is leading the viewer somewhere now. */
  get walking() {
    return !!this._plan;
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

  /**
   * Take me there, with him: he leads the viewer to the find's shelf, then it comes out as without
   * him (take). Without a walk (the cut it was) when he is hidden, with less motion, when the
   * viewer is there already or no way is found.
   * @param {import('./ask.js').Find} find
   */
  async takeThere(find) {
    const ia = this.interaction;
    if (this._plan) return;
    if (!this.shown || ia.reduced) return this.take(find);
    if (ia.state === 'inspect' || ia.state === 'read') await ia.putBack();
    if (ia.state !== 'browse' || this._plan) return;
    const book = bookOf(find, ia.booksByLib);
    // Not on the shelves: the take says so.
    if (!book || !(await ia.ensureShelved(book)) || ia.state !== 'browse' || this._plan) return this.take(find);
    if (ia.world.room !== this._room) this._place();
    const loc = ia.world.shelves.locate(book);
    const plan = loc ? this._planWalk(loc) : null;
    if (!plan) return this.take(find);
    this.onWalk?.(true);
    try {
      if (!(await this._start(plan))) return; // the room changed under it
      if (!ia.controls.presenting) return await this.take(find); // the view already turned to the shelf
      // In a headset the take's turn to the shelf is a blink, as the room's own steps back are.
      await this._fade(1, 0.12);
      const taking = this.take(find);
      await this._fade(0, 0.2);
      return await taking;
    } finally {
      this.onWalk?.(false);
    }
  }

  /** There at once (a click, the trigger, Enter or Esc while walking); in a headset in a blink. */
  skipWalk() {
    const plan = this._plan;
    if (!plan || plan.walk.phase === 'done') return;
    if (!this.interaction.controls.presenting) {
      plan.walk.finish();
      return;
    }
    this._skip = true;
    if (!this._blinking) this._blink();
  }

  /** Per frame: placed again after a rebuild; a walk; turned towards a viewer nearby. Makes no objects. @param {number} dt */
  update(dt) {
    const ia = this.interaction;
    if (ia.world.room !== this._room) this._place();
    this.line.update(dt);
    if (this._plan) return this._stepWalk(dt);
    if (!this.shown) return;
    if (this._back) return this._stepBack(dt);
    if (this.away) {
      if (ia.reduced) return this._toDesk();
      if (ia.state === 'browse') {
        this._awayFor += dt;
        ia.camera.getWorldPosition(_eye);
        const far = (_eye.x - this.x) ** 2 + (_eye.z - this.z) ** 2 > BACK_AWAY * BACK_AWAY;
        if (far || this._awayFor > BACK_AFTER) {
          this._goBack();
          if (this._back) return;
        }
      }
    }
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
      this._turnTo(want, TURN_RATE, dt);
    }
    this.figure.mesh.rotation.y = this.yaw;
  }

  /** Turns him towards `want` (rad) at most `rate` rad/s. @param {number} want @param {number} rate @param {number} dt */
  _turnTo(want, rate, dt) {
    const d = angleDiff(want, this.yaw);
    const step = rate * dt;
    this.yaw += Math.abs(d) <= step ? d : Math.sign(d) * step;
  }

  /** Moves him to (x, z), his steps' bob with it while he walks. @param {number} x @param {number} z @param {boolean} moving */
  _moveTo(x, z, moving) {
    this._stride += Math.hypot(x - this.x, z - this.z);
    this.x = x;
    this.z = z;
    this._bob = moving ? BOB * Math.abs(Math.sin((Math.PI * this._stride) / STRIDE)) : 0;
  }

  /** His mesh and collider where he is now. */
  _show() {
    this.figure.mesh.position.set(this.x, this._bob, this.z);
    this.figure.mesh.rotation.y = this.yaw;
    this._collider.x = this.x;
    this._collider.z = this.z;
  }

  /** By the stand (world.kiosk), to its left as seen from in front of it, facing the spawn point. */
  _place() {
    const world = this.interaction.world;
    this._room = world.room;
    if (this._plan) this._endWalk(false); // the room changed under the walk: it stops there
    const k = world.kiosk;
    // The stand's left as seen from in front: its local −X.
    this.deskX = k.position.x - BESIDE * Math.cos(k.yaw);
    this.deskZ = k.position.z + BESIDE * Math.sin(k.yaw);
    const sp = world.spawn.position;
    this.deskHome = Math.atan2(sp.x - this.deskX, sp.z - this.deskZ);
    this._toDesk();
    this.close(); // the room changed round the viewer: the panel would hang where it no longer belongs
  }

  /** At the desk at once; facing the way he rests there, unless he walked there (he turns to it). @param {boolean} [turned] */
  _toDesk(turned = true) {
    this.x = this.deskX;
    this.z = this.deskZ;
    this.home = this.deskHome;
    if (turned) this.yaw = this.home;
    this.away = false;
    this._back = null;
    this._awayFor = 0;
    this._bob = 0;
    this._show();
    this._fence();
  }

  /** His collider in the room's while he is shown, out of it while not. */
  _fence() {
    const list = this.interaction.world.room?.colliders;
    if (!Array.isArray(list)) return;
    const i = list.indexOf(this._collider);
    if (this.shown && i < 0) list.push(this._collider);
    else if (!this.shown && i >= 0) list.splice(i, 1);
  }

  /** Where one can stand in the room now, for his ways: made at the room's first walk, then kept. */
  _floorNow() {
    const world = this.interaction.world;
    const room = world.room;
    if (this._floor?.room === room) return this._floor.floor;
    const t = performance.now();
    const R = room?.R ?? 15;
    const floor = new Floor({
      bounds: room?.bounds ?? { minX: -R, maxX: R, minZ: -R, maxZ: R },
      walkable: room?.walkable ?? (() => true),
      circles: (room?.colliders ?? []).filter((/** @type {any} */ c) => c !== this._collider), // not himself
      boxes: world.shelves?.footprints?.() ?? [],
      clearance: CLEARANCE,
      wallClearance: WALL_CLEARANCE,
    });
    perf.event('librarian-floor', { t, ms: performance.now() - t, cells: floor.nx * floor.nz });
    this._floor = { room, floor };
    return floor;
  }

  /**
   * A walk to a standing spot before a shelf (shelves.locate): the viewer's way there, his place
   * beside its end, his way there ahead of them, and his way to join them; null for none.
   * @param {{ position: { x: number, z: number }, yaw: number }} loc
   * @returns {Plan | null}
   */
  _planWalk(loc) {
    const ia = this.interaction;
    const floor = this._floorNow();
    const t = performance.now();
    const feet = ia.controls.viewerPosition(_feet);
    const from = { x: feet.x, z: feet.z };
    const way = floor.path(from, { x: loc.position.x, z: loc.position.z });
    const lengths = way ? pathLengths(way) : null;
    const total = lengths ? lengths[lengths.length - 1] : 0;
    const end = way ? way[way.length - 1] : null;
    // His place beside the end, the side he comes from first.
    const beside = end && total >= MIN_WALK ? besideEnd(end, loc.yaw, (x, z) => floor.free(x, z), { x: this.x, z: this.z }) : null;
    let plan = null;
    if (way && lengths && end && beside) {
      const ahead = aheadWay(way, lengths, Math.min(WALK.lead, total / 2), beside, (a, b) => floor.lineFree(a, b));
      const start = ahead[0];
      const d = Math.hypot(start.x - this.x, start.z - this.z);
      // To his place ahead of the viewer, round them, when it is near; else he is put there.
      const join = d > 0.05 && d < JOIN_MAX ? floor.path({ x: this.x, z: this.z }, start, { x: from.x, z: from.z, r: CLEAR_OF_VIEWER }) : null;
      const walk = new Walk({ way, join, ahead, vr: !!ia.controls.presenting });
      // Beside the shelf he faces it, as the viewer will.
      plan = { walk, way, end, endYaw: loc.yaw, shelfYaw: Math.atan2(-Math.sin(loc.yaw), -Math.cos(loc.yaw)) };
    }
    perf.event('librarian-way', { t, ms: performance.now() - t, m: Math.round(total * 10) / 10, corners: way?.length ?? 0, walked: !!plan });
    return plan;
  }

  /**
   * Starts a walk: the room's state busy (nothing else picked or opened meanwhile), the viewer's
   * own moving and looking set aside, the way shown. Resolves true once there, false when the room
   * changed under it.
   * @param {Plan} plan
   * @returns {Promise<boolean>}
   */
  _start(plan) {
    const ia = this.interaction;
    const C = ia.controls;
    this.close();
    this._back = null;
    this.away = true;
    this._plan = plan;
    this._skip = false;
    this._saved = { loco: C.locomotionEnabled, look: C.lookEnabled };
    ia.state = 'busy';
    C.locomotionEnabled = false;
    if (!C.presenting) C.lookEnabled = false; // the walk turns a screen's view; a headset's is the head's
    this._lastX = plan.walk.viewer.x;
    this._lastZ = plan.walk.viewer.z;
    this._stride = 0;
    this.line.show(plan.way);
    return new Promise((resolve) => {
      this._walkDone = resolve;
    });
  }

  /** A walk's frame: the viewer moved by what their way moved (their own steps in VR kept), and he. @param {number} dt */
  _stepWalk(dt) {
    const plan = /** @type {Plan} */ (this._plan);
    const C = this.interaction.controls;
    const w = plan.walk;
    const phase = w.step(dt);
    if (w.blinking && !this._blinking) this._blink();
    const V = w.viewer;
    C.rig.position.x += V.x - this._lastX;
    C.rig.position.z += V.z - this._lastZ;
    this._lastX = V.x;
    this._lastZ = V.z;
    if (C.presenting) {
      // The comfort vignette closes with the speed, as for walking with the stick (left as it is
      // while the view goes dark for a blink).
      if (C.vignette?.enabled && !w.blinking) C.vignette.set(Math.min(1, V.speed / VIGNETTE.fullSpeed));
    } else {
      // A screen's view looks the way they go, then at the shelf as they come to it, level.
      let want = V.dx || V.dz ? Math.atan2(-V.dx, -V.dz) : C.yaw;
      const left = w.length - V.s;
      if (left < 1.5) want += angleDiff(plan.endYaw, want) * (1 - left / 1.5);
      const d = angleDiff(want, C.yaw);
      const step = VIEW_TURN * dt;
      C.yaw += Math.abs(d) <= step ? d : Math.sign(d) * step;
      C.rig.rotation.y = C.yaw;
      C.pitch -= C.pitch * Math.min(1, 2 * dt);
    }
    C.rig.updateMatrixWorld(true);
    const H = w.him;
    this._moveTo(H.x, H.z, H.moving);
    if (H.moving && (H.dx || H.dz)) this._turnTo(Math.atan2(H.dx, H.dz), WALK_TURN, dt);
    else if (!H.moving) this._turnTo(plan.shelfYaw, WALK_TURN / 2, dt);
    this._show();
    if (phase === 'done') this._endWalk(true);
  }

  /** The view's fade (interaction's _fadeTo), after the one under way. @param {number} target @param {number} duration */
  _fade(target, duration) {
    const ia = this.interaction;
    this._fading = this._fading.then(() => ia._fadeTo?.(target, duration)).catch(() => {});
    return this._fading;
  }

  /**
   * A blink (VR): dark, then across the way's skipped middle and light again; or, skipping the
   * walk, to its end, left dark for the turn to the shelf (takeThere).
   */
  async _blink() {
    this._blinking = true;
    try {
      await this._fade(1, 0.15);
    } finally {
      this._blinking = false;
    }
    const walk = this._plan?.walk;
    if (this._skip) {
      this._skip = false;
      walk?.finish();
      return;
    }
    walk?.resume();
    await this._fade(0, 0.25);
  }

  /**
   * A walk's end: the controls and the room's state as they were, the way fading, he at rest
   * beside the shelf turned to where the viewer stands.
   * @param {boolean} arrived false when the room changed under it (the rebuild has the state)
   */
  _endWalk(arrived) {
    const ia = this.interaction;
    const C = ia.controls;
    const plan = this._plan;
    this._plan = null;
    this._skip = false;
    if (this._saved) {
      C.locomotionEnabled = this._saved.loco;
      C.lookEnabled = this._saved.look;
      this._saved = null;
    }
    if (arrived && ia.state === 'busy') ia.state = 'browse';
    this.line.hide();
    if (plan) this.home = Math.atan2(plan.end.x - this.x, plan.end.z - this.z);
    this._awayFor = 0;
    this._bob = 0;
    this._show();
    const done = this._walkDone;
    this._walkDone = null;
    done?.(arrived);
  }

  /** Back to the desk, at his pace round what stands there (and the viewer); at once when there is no way. */
  _goBack() {
    const ia = this.interaction;
    if (ia.reduced) return this._toDesk();
    const feet = ia.controls.viewerPosition(_feet);
    const way = this._floorNow().path({ x: this.x, z: this.z }, { x: this.deskX, z: this.deskZ }, { x: feet.x, z: feet.z, r: CLEAR_OF_VIEWER });
    if (!way || way.length < 2) return this._toDesk();
    this._back = { way, lengths: pathLengths(way), s: 0, at: { x: 0, z: 0, dx: 0, dz: 0 } };
    this._stride = 0;
  }

  /** His walk back's frame. @param {number} dt */
  _stepBack(dt) {
    const b = /** @type {{ way: Spot[], lengths: Float64Array, s: number, at: Along }} */ (this._back);
    const total = b.lengths[b.lengths.length - 1];
    b.s = Math.min(total, b.s + WALK.pace * dt);
    along(b.way, b.lengths, b.s, b.at);
    if (b.s >= total) return this._toDesk(false);
    this._moveTo(b.at.x, b.at.z, true);
    if (b.at.dx || b.at.dz) this._turnTo(Math.atan2(b.at.dx, b.at.dz), WALK_TURN, dt);
    this._show();
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
    p.add({ type: 'text', x: pad, y: 26, w: W - 2 * pad - 80 - VOICE_W, h: 54, text: 'Ask the librarian', size: 44, weight: '600', serif: true, color: UI.accent });
    p.add({ id: 'close', type: 'button', x: W - pad - 64, y: 22, w: 64, h: 56, label: '✕', size: 30, onClick: () => this.close() });
    // Whether he speaks his answers (the help dialog's choice too); "No voice" where the device has none.
    const speech = this.speech;
    if (speech) {
      const ok = speech.available();
      const on = ok && speech.on();
      p.add({
        id: 'voice', type: 'button', x: W - pad - 64 - 12 - VOICE_W, y: 22, w: VOICE_W, h: 56, size: 26,
        label: !ok ? 'No voice' : on ? 'Voice: on' : 'Voice: off', active: on, disabled: !ok,
        onClick: () => speech.set(!speech.on()),
      });
    }
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
            this.takeThere(find);
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
