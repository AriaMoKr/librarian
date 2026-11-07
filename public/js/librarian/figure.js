// @ts-check
// The Librarian's figure (docs/LIBRARIAN.md; SPEC §5.10), after Snow Crash's: a pleasant,
// fiftyish man with silver hair and beard and bright blue eyes, in a V-neck sweater over a work
// shirt and a tweedy wool tie, a book in his hand. Simple shapes merged into one geometry,
// coloured per vertex, with one material lit as the room's furniture is (Lambert): one draw call.
// He stands on the floor at his origin and faces +Z.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * His size (m): how tall he is; the upright cylinder a walk goes round (`radius`, a collider of the
 * room's: the laser stops there too); and the slightly larger one a pointer finds him by (`hit`,
 * over his arms and his book), so it is met before the collider.
 */
export const FIGURE = { height: 1.8, radius: 0.25, hitRadius: 0.33, hitHeight: 1.86 };

const COLORS = {
  skin: 0xd8a585,
  hair: 0xd2d2cc, // silver
  sweater: 0x3c4865, // heathered navy
  shirt: 0xc9d5e4, // a pale blue work shirt
  tie: 0x8a5c3b, // tweedy rust-brown wool
  trousers: 0x4b4642,
  shoes: 0x32251b,
  eyes: 0x2c5ca6, // bright blue
  book: 0x6a2323, // an oxblood binding
  pages: 0xeee2c6,
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * One part: placed (scale, then rotation, then position) and painted.
 * @param {THREE.BufferGeometry} geo
 * @param {number} color
 * @param {{ x?: number, y?: number, z?: number, rx?: number, ry?: number, rz?: number, sx?: number, sy?: number, sz?: number }} [at]
 */
function part(geo, color, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  geo.applyMatrix4(_m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz)));
  _c.setHex(color); // into the working (linear) colour space
  const n = geo.attributes.position.count;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i += 3) {
    rgb[i] = _c.r;
    rgb[i + 1] = _c.g;
    rgb[i + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  return geo;
}

/**
 * A flat triangle facing +Z (the shirt in the sweater's V), with what the other parts have.
 * @param {number[]} a @param {number[]} b @param {number[]} c its corners, counter-clockwise from the front
 */
function triangle(a, b, c) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a, ...b, ...c]), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 0.5, 0, 1, 1]), 2));
  geo.setIndex([0, 1, 2]);
  geo.computeVertexNormals();
  return geo;
}

/** His geometry: every part merged, one colour per vertex. */
export function figureGeometry() {
  const { skin, hair, sweater, shirt, tie, trousers, shoes, eyes, book, pages } = COLORS;
  // The head's ellipsoid: hair and beard follow it, a little larger.
  const head = { y: 1.69, z: 0.005, sx: 0.9, sy: 1.1, sz: 0.97 };
  const parts = [];
  for (const side of [-1, 1]) {
    parts.push(
      part(new THREE.BoxGeometry(0.1, 0.075, 0.26), shoes, { x: side * 0.095, y: 0.0375, z: 0.035 }),
      part(new THREE.CylinderGeometry(0.072, 0.062, 0.82, 12), trousers, { x: side * 0.095, y: 0.485 }),
      // Arms hanging a little away from him, then the hands.
      part(new THREE.CapsuleGeometry(0.058, 0.5, 4, 12), sweater, { x: side * 0.245, y: 1.14, rz: side * 0.06 }),
      part(new THREE.SphereGeometry(0.048, 12, 8), skin, { x: side * 0.264, y: 0.8, sx: 0.8, sy: 1.15, sz: 0.9 }),
      part(new THREE.SphereGeometry(0.026, 8, 6), skin, { x: side * 0.094, y: 1.685, sx: 0.5, sz: 0.8 }), // ears
      part(new THREE.SphereGeometry(0.0115, 8, 6), eyes, { x: side * 0.034, y: 1.703, z: 0.093 }),
      part(new THREE.BoxGeometry(0.032, 0.008, 0.012), hair, { x: side * 0.035, y: 1.727, z: 0.094, rz: -side * 0.1 }), // brows
    );
  }
  parts.push(
    part(new THREE.CylinderGeometry(0.175, 0.165, 0.18, 16), trousers, { y: 0.94, sz: 0.72 }), // hips
    part(new THREE.CylinderGeometry(0.205, 0.18, 0.56, 20), sweater, { y: 1.2, sz: 0.68 }), // the sweater
    part(new THREE.SphereGeometry(0.205, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2), sweater, { y: 1.47, sy: 0.36, sz: 0.68 }), // shoulders
    part(new THREE.CylinderGeometry(0.052, 0.058, 0.12, 12), skin, { y: 1.55, z: -0.005 }), // neck
    part(triangle([-0.07, 1.475, 0.142], [0, 1.29, 0.137], [0.07, 1.475, 0.142]), shirt), // the shirt in the V
    part(new THREE.BoxGeometry(0.036, 0.145, 0.01), tie, { y: 1.372, z: 0.147 }),
    part(new THREE.BoxGeometry(0.034, 0.03, 0.016), tie, { y: 1.46, z: 0.148 }), // its knot
    part(new THREE.SphereGeometry(0.104, 20, 16), skin, { y: head.y, z: head.z, sx: head.sx, sy: head.sy, sz: head.sz }),
    part(new THREE.SphereGeometry(0.019, 8, 6), skin, { y: 1.675, z: 0.103, sx: 0.85, sy: 1.1 }), // nose
    // Silver hair: a cap tipped back (a high forehead), and the back of the head down to the nape.
    part(new THREE.SphereGeometry(0.109, 20, 8, 0, Math.PI * 2, 0, 1.15), hair, { y: head.y, z: head.z, rx: -0.35, sx: head.sx, sy: head.sy, sz: head.sz }),
    part(new THREE.SphereGeometry(0.109, 20, 6, Math.PI, Math.PI, 1.0, 1.1), hair, { y: head.y, z: head.z, sx: head.sx, sy: head.sy, sz: head.sz }),
    // The beard: the front of the jaw, from under the nose to below the chin.
    part(new THREE.SphereGeometry(0.109, 20, 8, 0, Math.PI, 1.78, 0.97), hair, { y: head.y, z: head.z, sx: head.sx, sy: head.sy, sz: head.sz * 1.08 }),
    // A book in his left hand (+X: he faces +Z), its fore-edge towards you.
    part(new THREE.BoxGeometry(0.035, 0.235, 0.165), book, { x: 0.302, y: 0.83, z: 0.03 }),
    part(new THREE.BoxGeometry(0.027, 0.22, 0.006), pages, { x: 0.302, y: 0.83, z: 0.1125 }),
  );
  const geo = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!geo) throw new Error('figure: the parts could not be merged');
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Distance along a world-space ray (unit direction) to an upright cylinder standing on the floor
 * at (x, z), through its side or onto its top; Infinity when it misses or starts inside. Makes no
 * objects (it runs every frame).
 * @param {THREE.Ray} ray
 * @param {number} x @param {number} z @param {number} r @param {number} h
 */
export function rayUpright(ray, x, z, r, h) {
  const o = ray.origin;
  const d = ray.direction;
  const ox = o.x - x;
  const oz = o.z - z;
  const c0 = ox * ox + oz * oz - r * r;
  let best = Infinity;
  const a = d.x * d.x + d.z * d.z;
  if (a > 1e-12 && c0 > 0) {
    const b = ox * d.x + oz * d.z;
    const disc = b * b - a * c0;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a; // entering the side
      const y = o.y + t * d.y;
      if (t > 0 && y >= 0 && y <= h) best = t;
    }
  }
  if (d.y < -1e-6 && o.y > h) {
    const t = (h - o.y) / d.y; // onto the top
    const px = ox + t * d.x;
    const pz = oz + t * d.z;
    if (px * px + pz * pz <= r * r) best = Math.min(best, t);
  }
  return best;
}

/** The figure in the room: its mesh, and a glow while a pointer is on him. */
export class Figure {
  constructor() {
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mesh = new THREE.Mesh(figureGeometry(), this.material);
    this.mesh.name = 'librarian';
    this._hover = false;
  }

  /** A pointer on him (true) or not: a faint warm glow, as the door's frame lights. @param {boolean} on */
  setHover(on) {
    if (on === this._hover) return;
    this._hover = on;
    this.material.emissive.setHex(on ? 0x2a1f12 : 0x000000);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
