// @ts-check
// The librarian's way across the room (docs/LIBRARIAN.md, experiment 1 step 3; SPEC §5.10): a
// grid over the floor that says where one can stand (Floor), made once per room from its walls,
// its furniture and its bookcases; the way from one spot to another over it, round what stands
// there, as straight lines between corners; and the point a distance along such a way. Pure: the
// room comes in as shapes.
//
// Costs: a hall of 200 bookcases is ~10,000 cells of 25 cm. Making the grid asks the room's
// walkable five times a cell and marks each bookcase's cells, with no object made per cell; a
// search reuses the grid's arrays.

/** @typedef {{ x: number, z: number }} Spot */
/** @typedef {{ minX: number, maxX: number, minZ: number, maxZ: number }} Bounds */
/** Furniture, and anyone to keep clear of. @typedef {{ x: number, z: number, r: number }} Circle */
/** A bookcase's footprint (shelves.footprints()): its centre, yaw and half sizes. @typedef {{ position: Spot, yaw: number, halfW: number, halfD: number }} Box */
/** A place on a way and the way's direction there (unit; 0, 0 on a way of one spot). @typedef {{ x: number, z: number, dx: number, dz: number }} Along */

/** The 8 neighbours of a cell: di, dk and the step's length in cells. */
const DI = [1, -1, 0, 0, 1, 1, -1, -1];
const DK = [0, 0, 1, -1, 1, -1, 1, -1];
const DL = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
/** How far (cells) a start or an end that is not free looks for one that is. */
const SNAP = 12;

/** A small binary min-heap of cell numbers by key, emptied for each search and kept. */
class Heap {
  constructor() {
    /** @type {number[]} */ this.cells = [];
    /** @type {number[]} */ this.keys = [];
  }

  get size() {
    return this.cells.length;
  }

  clear() {
    this.cells.length = 0;
    this.keys.length = 0;
  }

  /** @param {number} cell @param {number} key */
  push(cell, key) {
    const { cells, keys } = this;
    let i = cells.length;
    cells.push(cell);
    keys.push(key);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (keys[up] <= key) break;
      cells[i] = cells[up];
      keys[i] = keys[up];
      i = up;
    }
    cells[i] = cell;
    keys[i] = key;
  }

  pop() {
    const { cells, keys } = this;
    const top = cells[0];
    const cell = /** @type {number} */ (cells.pop());
    const key = /** @type {number} */ (keys.pop());
    const n = cells.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const c = l + 1 < n && keys[l + 1] < keys[l] ? l + 1 : l;
        if (keys[c] >= key) break;
        cells[i] = cells[c];
        keys[i] = keys[c];
        i = c;
      }
      cells[i] = cell;
      keys[i] = key;
    }
    return top;
  }
}

/**
 * Where one can stand in a room: a grid of `cell` m over `bounds` (coarser when that would be more
 * than `maxCells` cells), a cell open when its centre is on the floor with `wallClearance` m to
 * spare (walkable there and that far either way) and `clearance` m from every circle and box.
 */
export class Floor {
  /**
   * @param {object} o
   * @param {Bounds} o.bounds the floor to cover
   * @param {(x: number, z: number) => boolean} o.walkable the room's floor within its walls (room.walkable)
   * @param {Circle[]} [o.circles] its furniture (room.colliders)
   * @param {Box[]} [o.boxes] its bookcases (shelves.footprints())
   * @param {number} [o.clearance] how far (m) a way keeps from furniture and bookcases
   * @param {number} [o.wallClearance] and from where walkable ends
   * @param {number} [o.cell] the grid's cell, m
   * @param {number} [o.maxCells]
   */
  constructor({ bounds, walkable, circles = [], boxes = [], clearance = 0.35, wallClearance = 0.25, cell = 0.25, maxCells = 160000 }) {
    const width = Math.max(0, bounds.maxX - bounds.minX);
    const depth = Math.max(0, bounds.maxZ - bounds.minZ);
    if ((width / cell) * (depth / cell) > maxCells) cell = Math.sqrt((width * depth) / maxCells);
    this.cell = cell;
    this.minX = bounds.minX;
    this.minZ = bounds.minZ;
    this.nx = Math.max(1, Math.ceil(width / cell));
    this.nz = Math.max(1, Math.ceil(depth / cell));
    const n = this.nx * this.nz;
    /** 1 where one can stand. */
    this.open = new Uint8Array(n);
    const w = wallClearance;
    for (let k = 0; k < this.nz; k++) {
      const z = this.cz(k);
      for (let i = 0; i < this.nx; i++) {
        const x = this.cx(i);
        if (walkable(x, z) && walkable(x + w, z) && walkable(x - w, z) && walkable(x, z + w) && walkable(x, z - w)) this.open[k * this.nx + i] = 1;
      }
    }
    for (const c of circles) this._closeCircle(c.x, c.z, c.r + clearance);
    for (const b of boxes) this._closeBox(b, clearance);
    /** @private The search's own arrays, kept for the next. */
    this._cost = new Float32Array(n);
    /** @private */ this._parent = new Int32Array(n);
    /** @private */ this._closed = new Uint8Array(n);
    /** @private */ this._heap = new Heap();
    /** @private A circle the search at hand keeps out of too. @type {Circle | null} */
    this._avoid = null;
  }

  /** A column's centre x. @param {number} i */
  cx(i) {
    return this.minX + (i + 0.5) * this.cell;
  }

  /** A row's centre z. @param {number} k */
  cz(k) {
    return this.minZ + (k + 0.5) * this.cell;
  }

  /** The cells whose centres are within r of (x, z) closed. @private @param {number} x @param {number} z @param {number} r */
  _closeCircle(x, z, r) {
    this._closeWithin(x - r, x + r, z - r, z + r, (cx, cz) => (cx - x) ** 2 + (cz - z) ** 2 < r * r);
  }

  /** A box's cells closed, `pad` m round it, as world.js's _collides sees it. @private @param {Box} b @param {number} pad */
  _closeBox(b, pad) {
    const c = Math.cos(b.yaw);
    const s = Math.sin(b.yaw);
    const hw = b.halfW + pad;
    const hd = b.halfD + pad;
    const ex = Math.abs(c) * hw + Math.abs(s) * hd;
    const ez = Math.abs(s) * hw + Math.abs(c) * hd;
    const px = b.position.x;
    const pz = b.position.z;
    this._closeWithin(px - ex, px + ex, pz - ez, pz + ez, (x, z) => {
      const dx = x - px;
      const dz = z - pz;
      return Math.abs(dx * c - dz * s) < hw && Math.abs(dx * s + dz * c) < hd;
    });
  }

  /**
   * The cells within an area whose centres `inside` says are in it, closed.
   * @private
   * @param {number} x0 @param {number} x1 @param {number} z0 @param {number} z1
   * @param {(x: number, z: number) => boolean} inside
   */
  _closeWithin(x0, x1, z0, z1, inside) {
    const i0 = Math.max(0, Math.floor((x0 - this.minX) / this.cell));
    const i1 = Math.min(this.nx - 1, Math.floor((x1 - this.minX) / this.cell));
    const k0 = Math.max(0, Math.floor((z0 - this.minZ) / this.cell));
    const k1 = Math.min(this.nz - 1, Math.floor((z1 - this.minZ) / this.cell));
    for (let k = k0; k <= k1; k++) {
      for (let i = i0; i <= i1; i++) if (inside(this.cx(i), this.cz(k))) this.open[k * this.nx + i] = 0;
    }
  }

  /** Whether a cell is open (and out of the search's circle to avoid). @param {number} i @param {number} k */
  isOpen(i, k) {
    if (i < 0 || k < 0 || i >= this.nx || k >= this.nz || !this.open[k * this.nx + i]) return false;
    const a = this._avoid;
    return !a || (this.cx(i) - a.x) ** 2 + (this.cz(k) - a.z) ** 2 >= a.r * a.r;
  }

  /** Whether one can stand at (x, z). @param {number} x @param {number} z */
  free(x, z) {
    return this.isOpen(Math.floor((x - this.minX) / this.cell), Math.floor((z - this.minZ) / this.cell));
  }

  /** Whether a straight line from a to b stays on open cells (a sample every half cell, its ends left out). @param {Spot} a @param {Spot} b */
  lineFree(a, b) {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (this.cell / 2));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (!this.free(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }

  /** The open cell nearest a spot (its own when open), at most 12 cells away; or -1. @private @param {Spot} p */
  _snap(p) {
    const clamp = (/** @type {number} */ v, /** @type {number} */ max) => Math.max(0, Math.min(max - 1, v));
    const i0 = clamp(Math.floor((p.x - this.minX) / this.cell), this.nx);
    const k0 = clamp(Math.floor((p.z - this.minZ) / this.cell), this.nz);
    for (let r = 0; r <= SNAP; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let k = k0 - r; k <= k0 + r; k++) {
        for (let i = i0 - r; i <= i0 + r; i++) {
          if (Math.max(Math.abs(i - i0), Math.abs(k - k0)) !== r || !this.isOpen(i, k)) continue;
          const d = (this.cx(i) - p.x) ** 2 + (this.cz(k) - p.z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = k * this.nx + i;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /**
   * The way from `from` to `to`: A* over the open cells, each to its 8 neighbours (a diagonal only
   * where both cells beside it are open too), from the cell nearest `from` to the one nearest `to`;
   * then pulled straight, each corner joined to the farthest one after it that a straight line
   * reaches over open cells. It starts at `from` and ends at `to` themselves.
   * @param {Spot} from
   * @param {Spot} to
   * @param {Circle | null} [avoid] a circle to keep out of too (the viewer, for his own ways)
   * @returns {Spot[] | null} the corners, from the start to the end; null when there is no way
   */
  path(from, to, avoid = null) {
    this._avoid = avoid;
    try {
      return this._search(from, to);
    } finally {
      this._avoid = null;
    }
  }

  /** @private @param {Spot} from @param {Spot} to */
  _search(from, to) {
    const start = this._snap(from);
    const goal = this._snap(to);
    if (start < 0 || goal < 0) return null;
    const { nx, _cost: cost, _parent: parent, _closed: closed, _heap: open } = this;
    const gi = goal % nx;
    const gk = (goal - gi) / nx;
    const h = (/** @type {number} */ i, /** @type {number} */ k) => {
      const di = Math.abs(i - gi);
      const dk = Math.abs(k - gk);
      return Math.max(di, dk) + (Math.SQRT2 - 1) * Math.min(di, dk);
    };
    cost.fill(Infinity);
    parent.fill(-1);
    closed.fill(0);
    open.clear();
    cost[start] = 0;
    open.push(start, h(start % nx, Math.floor(start / nx)));
    while (open.size) {
      const c = open.pop();
      if (closed[c]) continue;
      if (c === goal) break;
      closed[c] = 1;
      const i = c % nx;
      const k = (c - i) / nx;
      for (let d = 0; d < 8; d++) {
        const di = DI[d];
        const dk = DK[d];
        const ni = i + di;
        const nk = k + dk;
        if (!this.isOpen(ni, nk) || (di && dk && (!this.isOpen(i + di, k) || !this.isOpen(i, k + dk)))) continue;
        const nc = nk * nx + ni;
        if (closed[nc]) continue;
        const g = cost[c] + DL[d];
        if (g < cost[nc]) {
          cost[nc] = g;
          parent[nc] = c;
          open.push(nc, g + h(ni, nk));
        }
      }
    }
    if (cost[goal] === Infinity) return null;
    /** @type {Spot[]} */
    const cells = [];
    for (let c = goal; c >= 0; c = parent[c]) cells.push({ x: this.cx(c % nx), z: this.cz(Math.floor(c / nx)) });
    cells.reverse();
    cells.unshift({ x: from.x, z: from.z });
    cells.push({ x: to.x, z: to.z });
    const corners = [cells[0]];
    for (let i = 0; i < cells.length - 1;) {
      let j = i + 1;
      while (j + 1 < cells.length && this.lineFree(cells[i], cells[j + 1])) j++;
      corners.push(cells[j]);
      i = j;
    }
    return corners;
  }
}

/**
 * How far along a way each of its corners is, from its first.
 * @param {Spot[]} way
 */
export function pathLengths(way) {
  const lengths = new Float64Array(way.length);
  for (let i = 1; i < way.length; i++) lengths[i] = lengths[i - 1] + Math.hypot(way[i].x - way[i - 1].x, way[i].z - way[i - 1].z);
  return lengths;
}

/**
 * The spot `s` m along a way (held to its ends) and the way's direction there, into `out`.
 * Allocates nothing: it runs every frame of a walk.
 * @param {Spot[]} way
 * @param {Float64Array} lengths its pathLengths
 * @param {number} s
 * @param {Along} out
 */
export function along(way, lengths, s, out) {
  const last = way.length - 1;
  if (last < 1) {
    out.x = way[0].x;
    out.z = way[0].z;
    out.dx = 0;
    out.dz = 0;
    return out;
  }
  const total = lengths[last];
  if (!(s > 0)) s = 0;
  else if (s > total) s = total;
  let i = 1;
  while (i < last && lengths[i] < s) i++;
  const a = way[i - 1];
  const b = way[i];
  const seg = lengths[i] - lengths[i - 1];
  const t = seg > 0 ? (s - lengths[i - 1]) / seg : 1;
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.dx = seg > 0 ? (b.x - a.x) / seg : 0;
  out.dz = seg > 0 ? (b.z - a.z) / seg : 0;
  return out;
}
