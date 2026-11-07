// @ts-check
// The librarian's walk (docs/LIBRARIAN.md, experiment 1 step 3; SPEC §5.10): he goes ahead, the
// viewer follows along a way to the shelf, and a soft line on the floor shows the way while they
// go. `Walk` says where each of them is at each moment, allocating nothing per frame; desk.js moves
// them. The line is one mesh with one material: 1 draw call, only while walking.

import * as THREE from 'three';
import { along, pathLengths } from './path.js';

/** @typedef {import('./path.js').Spot} Spot */
/** @typedef {import('./path.js').Along} Along */

export const WALK = {
  /** How far (m) he keeps ahead of the viewer along the way. */
  lead: 1.3,
  /** His own pace (m/s), going back to the desk; and coming to his place ahead of the viewer, who waits for him. */
  pace: 1.4,
  hurry: 2.0,
  /** The viewer's acceleration (m/s²) on a screen and in VR. */
  accel: { screen: 2.6, vr: 1.8 },
  /** Their cruising speed (m/s): the way's walked length over `time`, held to these. */
  speed: { screen: [2.4, 6], vr: [1.6, 2.6] },
  time: 4.5,
  /** In VR a way longer than this (m) skips its middle with a blink: only its first `blinkFrom` m and its last `blinkLast` m are walked. */
  blinkOver: 14,
  blinkFrom: 3,
  blinkLast: 6,
};

/**
 * How long (s) a move of `len` m takes: up to `v` at `a`, on, and down to a stop at `a` (or, too
 * short to reach `v`, up and down).
 * @param {number} len @param {number} v @param {number} a
 */
export function travelTime(len, v, a) {
  if (!(len > 0)) return 0;
  if (len >= (v * v) / a) return len / v + v / a;
  return 2 * Math.sqrt(len / a);
}

/**
 * How far (m) that move has gone after `t` s, and how fast it goes then, into `out`.
 * @param {number} len @param {number} v @param {number} a @param {number} t
 * @param {{ s: number, v: number }} out
 */
export function travelAt(len, v, a, t, out) {
  const T = travelTime(len, v, a);
  if (!(t > 0) || T === 0) {
    out.s = 0;
    out.v = 0;
  } else if (t >= T) {
    out.s = len;
    out.v = 0;
  } else {
    const top = Math.min(v, Math.sqrt(len * a)); // the speed it reaches
    const up = top / a; // how long it takes to get there, and to stop from it
    if (t < up) {
      out.s = (a * t * t) / 2;
      out.v = a * t;
    } else if (t > T - up) {
      const r = T - t;
      out.s = len - (a * r * r) / 2;
      out.v = a * r;
    } else {
      out.s = (top * up) / 2 + top * (t - up);
      out.v = top;
    }
  }
  return out;
}

/** Holds `v` within [lo, hi]. @param {number} v @param {number} lo @param {number} hi */
const within = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * One walk. First, unless he is put there, he goes to his place `lead` m ahead of the viewer on
 * their way (`join`, hurrying) while they wait; then they both go, the viewer from the way's
 * start to its end, eased in and out, he along `ahead` as far as they have come, so he keeps ahead
 * and arrives first; in VR a long way's middle is skipped with a blink (`blinking`, then
 * `resume()`). `step(dt)` moves it on; `viewer` and `him` say where they are.
 */
export class Walk {
  /**
   * @param {object} o
   * @param {Spot[]} o.way the viewer's way, from where they stand to where they will stand
   * @param {Spot[] | null} o.join his way to his place ahead of them; null: he is put there
   * @param {Spot[]} o.ahead his way from there, ending beside the shelf
   * @param {boolean} o.vr
   */
  constructor({ way, join, ahead, vr }) {
    this.way = way;
    this.wayL = pathLengths(way);
    this.length = this.wayL[way.length - 1];
    this.join = join && join.length > 1 ? join : null;
    this.joinL = this.join ? pathLengths(this.join) : null;
    this.joinTime = this.joinL ? this.joinL[this.joinL.length - 1] / WALK.hurry : 0;
    this.ahead = ahead;
    this.aheadL = pathLengths(ahead);
    const aheadLength = this.aheadL[ahead.length - 1];
    /** He goes this much further than the viewer per metre: at least 1, so he arrives first. */
    this.herRatio = this.length > 0 ? Math.max(1, aheadLength / this.length) : 1;
    const mode = vr ? 'vr' : 'screen';
    /** The way's middle that is skipped (VR, a long way): from `from` to `to` m along it. */
    this.skip = vr && this.length > WALK.blinkOver ? { from: WALK.blinkFrom, to: this.length - WALK.blinkLast } : null;
    this.walked = this.skip ? this.length - (this.skip.to - this.skip.from) : this.length;
    this.a = WALK.accel[mode];
    this.v = within(this.walked / WALK.time, WALK.speed[mode][0], WALK.speed[mode][1]);
    this.duration = travelTime(this.walked, this.v, this.a);
    /** 'join' | 'walk' | 'done' */
    this.phase = this.join ? 'join' : 'walk';
    /** Waiting for the blink: the view dark, then resume(). */
    this.blinking = false;
    this.skipped = false;
    this.t = 0;
    /** The viewer: where they are on the floor, the way's direction there, their speed (m/s), how far along (m). @type {Along & { speed: number, s: number }} */
    this.viewer = { x: way[0].x, z: way[0].z, dx: 0, dz: 0, speed: 0, s: 0 };
    /** He: where, which way he goes, whether he moves, how far along his way. @type {Along & { moving: boolean, s: number }} */
    this.him = { x: 0, z: 0, dx: 0, dz: 0, moving: false, s: 0 };
    /** @private */ this._at = { s: 0, v: 0 };
    this.step(0);
  }

  /** Moves it on by `dt` s: the phase it is in then. @param {number} dt */
  step(dt) {
    if (this.phase === 'done' || this.blinking) return this.phase;
    this.t += dt;
    const V = this.viewer;
    const H = this.him;
    if (this.phase === 'join') {
      const join = /** @type {Spot[]} */ (this.join);
      const s = Math.min(this.t * WALK.hurry, /** @type {Float64Array} */ (this.joinL)[join.length - 1]);
      along(join, /** @type {Float64Array} */ (this.joinL), s, H);
      H.moving = true;
      H.s = 0;
      along(this.way, this.wayL, 0, V);
      V.speed = 0;
      V.s = 0;
      if (this.t < this.joinTime) return this.phase;
      this.phase = 'walk';
      this.t = 0;
    }
    travelAt(this.walked, this.v, this.a, this.t, this._at);
    let s = this._at.s;
    if (this.skip) {
      if (!this.skipped && s >= this.skip.from) {
        this.blinking = true;
        s = this.skip.from;
      } else if (this.skipped) {
        s += this.skip.to - this.skip.from;
      }
    }
    along(this.way, this.wayL, s, V);
    V.speed = this.blinking ? 0 : this._at.v;
    V.s = s;
    const hs = Math.min(s * this.herRatio, this.aheadL[this.ahead.length - 1]);
    along(this.ahead, this.aheadL, hs, H);
    H.moving = hs < this.aheadL[this.ahead.length - 1] - 1e-6 && this._at.v > 0;
    H.s = hs;
    if (this.t >= this.duration && !this.blinking) this.phase = 'done';
    return this.phase;
  }

  /** After the blink's dark: on from the far side of the skipped middle. */
  resume() {
    this.blinking = false;
    this.skipped = true;
  }

  /** At once to the end (the viewer skipped it): both where they would stop. */
  finish() {
    this.phase = 'walk';
    this.blinking = false;
    this.skipped = true;
    this.t = this.duration;
    this.step(0);
    this.phase = 'done';
  }
}

/**
 * His place beside the end of the viewer's way: `side` m to its right or left (facing the
 * shelf), a little nearer the shelf; the first `free`, else none.
 * @param {Spot} end where the viewer will stand
 * @param {number} yaw the viewer's yaw there (looking along (−sin, −cos))
 * @param {(x: number, z: number) => boolean} free
 * @param {Spot} [from] where he comes from: that side is tried first
 * @returns {Spot | null}
 */
export function besideEnd(end, yaw, free, from) {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const first = from && (from.x - end.x) * rx + (from.z - end.z) * rz < 0 ? -1 : 1;
  for (const [side, ahead] of [[0.9, 0.35], [0.9, -0.2], [1.2, 0.6]]) {
    for (const sign of [first, -first]) {
      const x = end.x + sign * side * rx + ahead * fx;
      const z = end.z + sign * side * rz + ahead * fz;
      if (free(x, z)) return { x, z };
    }
  }
  return null;
}

/**
 * His way from his place ahead of the viewer: theirs from `lead` m on, stopping short of its end,
 * then to his place beside it (by its end, where the straight line there is not `lineFree`).
 * @param {Spot[]} way @param {Float64Array} lengths its pathLengths
 * @param {number} lead @param {Spot} beside
 * @param {(a: Spot, b: Spot) => boolean} [lineFree] whether a straight line stays on the floor
 * @returns {Spot[]}
 */
export function aheadWay(way, lengths, lead, beside, lineFree = () => true) {
  const total = lengths[way.length - 1];
  const stop = Math.max(lead, total - 1.0);
  const start = along(way, lengths, lead, { x: 0, z: 0, dx: 0, dz: 0 });
  const part = [{ x: start.x, z: start.z }];
  for (let i = 1; i < way.length; i++) if (lengths[i] > lead && lengths[i] < stop) part.push({ x: way[i].x, z: way[i].z });
  if (stop > lead + 0.05) {
    const end = along(way, lengths, stop, { x: 0, z: 0, dx: 0, dz: 0 });
    part.push({ x: end.x, z: end.z });
  }
  const last = part[part.length - 1];
  if (!lineFree(last, beside)) {
    const end = way[way.length - 1];
    part.push({ x: end.x, z: end.z });
  }
  part.push({ x: beside.x, z: beside.z });
  return part;
}

/** The line on the floor: its width (m), height over the floor, colour and how opaque at most. */
const LINE = { width: 0.11, y: 0.022, color: 0xe2bd6a, opacity: 0.7, fadeIn: 0.35, fadeOut: 0.6 };

/**
 * The way shown on the floor while walking: a soft line (opaque along its middle, clear at its
 * edges and its ends), drawn over the floor but under everything standing on it.
 */
export class WayLine {
  constructor() {
    this.material = new THREE.MeshBasicMaterial({
      color: LINE.color, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.name = 'librarian-way';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    /** 1 while showing, 0 while going; the opacity follows it. */
    this._target = 0;
  }

  /** Shows a way (made once per walk). @param {Spot[]} way */
  show(way) {
    const lengths = pathLengths(way);
    const total = lengths[way.length - 1];
    const n = Math.max(2, Math.ceil(total / 0.2) + 1);
    const pos = new Float32Array(n * 3 * 3);
    const col = new Float32Array(n * 3 * 4);
    const p = { x: 0, z: 0, dx: 0, dz: 0 };
    const half = LINE.width / 2;
    for (let i = 0; i < n; i++) {
      const s = (total * i) / (n - 1);
      along(way, lengths, s, p);
      // Across it: the left edge, the middle, the right edge.
      const nx = -p.dz;
      const nz = p.dx;
      const ends = Math.min(1, s / 0.5, (total - s) / 0.5);
      for (let j = 0; j < 3; j++) {
        const off = (j - 1) * half;
        pos.set([p.x + nx * off, LINE.y, p.z + nz * off], (i * 3 + j) * 3);
        col.set([1, 1, 1, j === 1 ? ends : 0], (i * 3 + j) * 4);
      }
    }
    const index = [];
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < 2; j++) {
        const a = i * 3 + j;
        const b = a + 3;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.setIndex(index);
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
    this.mesh.visible = true;
    this._target = 1;
  }

  /** Lets it fade away. */
  hide() {
    this._target = 0;
  }

  /** Per frame: its opacity towards shown or gone. Allocates nothing. @param {number} dt */
  update(dt) {
    if (!this.mesh.visible) return;
    const m = this.material;
    const to = this._target * LINE.opacity;
    const rate = LINE.opacity / (this._target ? LINE.fadeIn : LINE.fadeOut);
    const step = rate * dt;
    m.opacity = Math.abs(to - m.opacity) <= step ? to : m.opacity + Math.sign(to - m.opacity) * step;
    if (!this._target && m.opacity === 0) this.mesh.visible = false;
  }
}
