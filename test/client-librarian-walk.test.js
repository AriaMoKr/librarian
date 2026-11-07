// The librarian's walk, its pure parts (public/js/librarian/path.js and walk.js, SPEC §5.10): the
// floor's grid and the way across it, the point along a way, the eased move, a walk's phases (he
// joins, goes ahead, the viewer follows; a long way's middle in a blink), his place beside the
// shelf, his way ahead, and the line on the floor.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { along, Floor, pathLengths } from '../public/js/librarian/path.js';
import { aheadWay, besideEnd, travelAt, travelTime, Walk, WALK, WayLine } from '../public/js/librarian/walk.js';

/** A square room of `half` m either way from the middle, its walls' own margin 0.35 m (room.js's hall). */
const square = (half = 5) => ({
  bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half },
  walkable: (x, z) => Math.abs(x) < half - 0.35 && Math.abs(z) < half - 0.35,
});

/** Whether two spots are the same, to a micrometre. */
const same = (a, b) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;
const sameSpot = (a, b, what = '') => assert.ok(same(a, b), `${what} ${JSON.stringify(a)} is not ${JSON.stringify(b)}`);

/** The least distance from a way's points (sampled every 5 cm, its ends left out) to (x, z). */
function nearest(way, x, z) {
  const L = pathLengths(way);
  const total = L[L.length - 1];
  const at = { x: 0, z: 0, dx: 0, dz: 0 };
  let best = Infinity;
  for (let s = 0.05; s < total - 0.05; s += 0.05) {
    along(way, L, s, at);
    best = Math.min(best, Math.hypot(at.x - x, at.z - z));
  }
  return best;
}

/** Whether (x, z) is within a bookcase's footprint grown by `pad`, as world.js's _collides sees it. */
function inBox(b, x, z, pad) {
  const dx = x - b.position.x;
  const dz = z - b.position.z;
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return Math.abs(dx * c - dz * s) < b.halfW + pad && Math.abs(dx * s + dz * c) < b.halfD + pad;
}

describe('the librarian: the floor', () => {
  it('is open within the walls with room to spare, and closed round furniture and bookcases', () => {
    const box = { position: { x: 2, z: -1 }, yaw: 0.6, halfW: 0.65, halfD: 0.23 };
    const floor = new Floor({ ...square(), circles: [{ x: -2, z: 1, r: 0.4 }], boxes: [box] });
    assert.equal(floor.nx, 40);
    assert.equal(floor.nz, 40);
    assert.equal(floor.free(0, 0), true);
    // Walkable ends at 4.65, and 0.25 m more is kept: the cell centred at 4.625 is closed, 4.375 open.
    assert.equal(floor.free(4.6, 0), false, 'too near the wall');
    assert.equal(floor.free(4.3, 0), true);
    assert.equal(floor.free(-2, 1.6), false, 'within 0.4 + 0.35 of the circle');
    assert.equal(floor.free(-2, 1.9), true);
    assert.equal(floor.free(9, 0), false, 'off the grid');
    // Every cell's centre: closed exactly where the box grown by the clearance is.
    for (let k = 0; k < floor.nz; k++) {
      for (let i = 0; i < floor.nx; i++) {
        const x = floor.cx(i);
        const z = floor.cz(k);
        if (Math.hypot(x + 2, z - 1) < 0.75 || Math.abs(x) > 4.4 || Math.abs(z) > 4.4) continue;
        assert.equal(floor.isOpen(i, k), !inBox(box, x, z, 0.35), `${x}, ${z}`);
      }
    }
  });

  it('is coarser when the room would take more cells than it may', () => {
    const floor = new Floor({ ...square(50), maxCells: 10000 });
    assert.ok(floor.nx * floor.nz <= 10201);
    assert.ok(Math.abs(floor.cell - 1) < 1e-9);
  });
});

describe('the librarian: a way across the room', () => {
  it('is a straight line across an open room, from where you stand to where you go', () => {
    const floor = new Floor(square());
    const way = floor.path({ x: -3.1, z: 2.9 }, { x: 3.2, z: -2.7 });
    assert.deepEqual(way, [{ x: -3.1, z: 2.9 }, { x: 3.2, z: -2.7 }]);
  });

  it('goes round a table in the way, keeping clear of it, in a few straight lines', () => {
    const floor = new Floor({ ...square(), circles: [{ x: 0, z: 0, r: 1 }] });
    const way = floor.path({ x: 0, z: 3.5 }, { x: 0.1, z: -3.5 });
    assert.ok(way && way.length >= 3 && way.length <= 6, `${way?.length} corners`);
    // Kept 0.35 m from it at the cells' centres; a straight line between them may pass half a cell nearer.
    assert.ok(nearest(way, 0, 0) > 1.1, `${nearest(way, 0, 0)} m from the table's middle`);
    const L = pathLengths(way);
    assert.ok(L[L.length - 1] < 8.6, `${L[L.length - 1]} m: round it, not a detour`);
  });

  it('goes round a row of bookcases, never through them', () => {
    // A hall's row (world.js _layoutHall): back to back, across the middle, open at its ends.
    const boxes = [];
    for (let k = 0; k < 5; k++) {
      for (const [z, yaw] of [[0.2, 0], [-0.2, Math.PI]]) boxes.push({ position: { x: -2.44 + k * 1.22, z }, yaw, halfW: 0.65, halfD: 0.23 });
    }
    const floor = new Floor({ ...square(), boxes });
    const way = floor.path({ x: 0, z: 3 }, { x: 0, z: -3 });
    assert.ok(way);
    const L = pathLengths(way);
    const at = { x: 0, z: 0, dx: 0, dz: 0 };
    for (let s = 0; s <= L[L.length - 1]; s += 0.05) {
      along(way, L, s, at);
      for (const b of boxes) assert.ok(!inBox(b, at.x, at.z, 0.2), `through a bookcase at ${at.x.toFixed(2)}, ${at.z.toFixed(2)}`);
    }
    assert.ok(way.length <= 6, `${way.length} corners`);
  });

  it('starts where you stand even beside a bookcase, and keeps out of a circle to avoid', () => {
    const box = { position: { x: 0, z: -1 }, yaw: 0, halfW: 0.65, halfD: 0.23 };
    const floor = new Floor({ ...square(), boxes: [box] });
    // 0.25 m from its front (a viewer's radius: as close as they can stand), nearer than the floor's 0.35.
    const from = { x: 0, z: -0.52 };
    assert.equal(floor.free(from.x, from.z), false);
    const way = floor.path(from, { x: 3, z: 3 });
    assert.deepEqual(way[0], from);
    assert.ok(floor.free(way[1].x, way[1].z), 'then to where one can stand');
    // Round the viewer, for his own ways: the circle's cells closed, so a line is at most half a
    // cell's diagonal (0.18 m) nearer.
    const avoid = { x: 0, z: 2, r: 0.5 };
    const round = floor.path({ x: -2, z: 2 }, { x: 2, z: 2 }, avoid);
    assert.ok(nearest(round, 0, 2) >= 0.5 - 0.18, `${nearest(round, 0, 2)}`);
    assert.equal(floor.free(0, 2), true, 'the circle only for that search');
  });

  it('is none where there is no way, or nowhere to stand near either end', () => {
    // A small room inside a ring of furniture.
    const circles = [];
    for (let a = 0; a < 2 * Math.PI; a += 0.1) circles.push({ x: 2.5 * Math.sin(a), z: 2.5 * Math.cos(a), r: 0.3 });
    const floor = new Floor({ ...square(), circles });
    assert.equal(floor.path({ x: 0, z: 0 }, { x: 4, z: 4 }), null);
    assert.equal(new Floor({ ...square(), walkable: () => false }).path({ x: 0, z: 0 }, { x: 1, z: 1 }), null);
  });
});

describe('the librarian: along a way', () => {
  it('measures a way and gives the point a distance along it, with its direction, held to its ends', () => {
    const way = [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 4 }];
    const L = pathLengths(way);
    assert.deepEqual([...L], [0, 3, 3, 7]);
    const out = { x: 0, z: 0, dx: 0, dz: 0 };
    assert.equal(along(way, L, 1.5, out), out);
    assert.deepEqual(out, { x: 1.5, z: 0, dx: 1, dz: 0 });
    assert.deepEqual(along(way, L, 5, out), { x: 3, z: 2, dx: 0, dz: 1 });
    assert.deepEqual(along(way, L, -1, out), { x: 0, z: 0, dx: 1, dz: 0 });
    assert.deepEqual(along(way, L, 99, out), { x: 3, z: 4, dx: 0, dz: 1 });
    assert.deepEqual(along([{ x: 1, z: 2 }], pathLengths([{ x: 1, z: 2 }]), 1, out), { x: 1, z: 2, dx: 0, dz: 0 });
  });
});

describe('the librarian: an eased move', () => {
  it('speeds up, keeps on and slows to a stop, or only up and down when too short', () => {
    assert.equal(travelTime(0, 2, 1), 0);
    assert.ok(Math.abs(travelTime(10, 2, 1) - 7) < 1e-9, '10/2 + 2/1');
    assert.ok(Math.abs(travelTime(1, 2, 1) - 2) < 1e-9, 'never reaching 2 m/s: 2·√(1/1)');
    for (const [len, v, a] of [[10, 2, 1], [1, 2, 1], [26.6, 2.4, 2.6]]) {
      const T = travelTime(len, v, a);
      const out = { s: 0, v: 0 };
      let last = 0;
      for (let t = 0; t <= T + 0.1; t += T / 200) {
        travelAt(len, v, a, t, out);
        assert.ok(out.s >= last - 1e-9 && out.s <= len + 1e-9, 'on, never back');
        assert.ok(out.v <= v + 1e-9 && out.v >= 0);
        last = out.s;
      }
      assert.equal(travelAt(len, v, a, T, out).s, len);
      assert.equal(out.v, 0);
      assert.deepEqual(travelAt(len, v, a, 0, out), { s: 0, v: 0 });
    }
  });
});

/** A walk's frames until done (or `max` s), calling `each` after each. */
function run(walk, each = () => {}, max = 30) {
  for (let t = 0; t < max && walk.phase !== 'done'; t += 1 / 72) {
    walk.step(1 / 72);
    if (walk.blinking) walk.resume();
    each(walk);
  }
}

describe('the librarian: a walk', () => {
  const way = [{ x: 0, z: 4 }, { x: 0, z: -4 }];
  const L = pathLengths(way);
  const beside = { x: 0.9, z: -4.35 };
  const ahead = aheadWay(way, L, WALK.lead, beside);

  it('has him join first while the viewer waits, then both go: he ahead, they to the end', () => {
    const join = [{ x: 2, z: 4 }, { x: 0, z: 4 - WALK.lead }];
    const walk = new Walk({ way, join, ahead, vr: false });
    assert.equal(walk.phase, 'join');
    sameSpot(walk.him, join[0]);
    let joining = 0;
    let gap = Infinity;
    run(walk, (w) => {
      if (w.phase === 'join') {
        joining++;
        assert.deepEqual({ x: w.viewer.x, z: w.viewer.z, speed: w.viewer.speed }, { x: 0, z: 4, speed: 0 }, 'they wait');
      } else if (w.viewer.s > 0.5 && w.viewer.s < 5) {
        gap = Math.min(gap, w.viewer.z - w.him.z);
      }
    });
    const joinTime = Math.hypot(2, WALK.lead) / WALK.hurry;
    assert.ok(Math.abs(joining / 72 - joinTime) < 0.05, `${joining / 72} s joining`);
    assert.ok(gap > WALK.lead - 0.05, `he keeps ${gap} m ahead`);
    sameSpot(walk.viewer, way[1], 'they at the end:');
    sameSpot(walk.him, beside, 'he beside it:');
    assert.equal(walk.him.moving, false);
  });

  it('goes at a speed for its length within the screen\'s and the headset\'s, eased', () => {
    const screen = new Walk({ way, join: null, ahead, vr: false });
    assert.equal(screen.phase, 'walk');
    assert.equal(screen.v, WALK.speed.screen[0], 'short: the slowest');
    let top = 0;
    let frames = 0;
    run(screen, (w) => {
      top = Math.max(top, w.viewer.speed);
      frames++;
    });
    assert.ok(Math.abs(top - screen.v) < 0.05);
    assert.ok(Math.abs(frames / 72 - screen.duration) < 0.03);
    const long = [{ x: 0, z: 30 }, { x: 0, z: -30 }];
    const fast = new Walk({ way: long, join: null, ahead: aheadWay(long, pathLengths(long), WALK.lead, { x: 0.9, z: -30.35 }), vr: false });
    assert.equal(fast.v, Math.min(WALK.speed.screen[1], 60 / WALK.time));
  });

  it('skips a long way\'s middle in a headset: it waits at the blink, then goes on from its far side', () => {
    const long = [{ x: 0, z: 13 }, { x: 0, z: -13 }];
    const Lg = pathLengths(long);
    const walk = new Walk({ way: long, join: null, ahead: aheadWay(long, Lg, WALK.lead, { x: 0.9, z: -13.35 }), vr: true });
    assert.deepEqual(walk.skip, { from: WALK.blinkFrom, to: 26 - WALK.blinkLast });
    assert.equal(walk.walked, WALK.blinkFrom + WALK.blinkLast);
    let blinks = 0;
    while (walk.phase !== 'done') {
      walk.step(1 / 72);
      if (walk.blinking) {
        blinks++;
        assert.equal(walk.viewer.s, WALK.blinkFrom);
        assert.equal(walk.viewer.speed, 0);
        const held = walk.viewer.z;
        walk.step(1 / 72);
        assert.equal(walk.viewer.z, held, 'held while dark');
        walk.resume();
        walk.step(1 / 72);
        assert.ok(walk.viewer.s > 26 - WALK.blinkLast, 'across');
      }
    }
    assert.equal(blinks, 1);
    assert.equal(walk.viewer.z, -13);
    // Not on a screen, nor a shorter way.
    assert.equal(new Walk({ way: long, join: null, ahead: aheadWay(long, Lg, WALK.lead, { x: 0.9, z: -13.35 }), vr: false }).skip, null);
    assert.equal(new Walk({ way, join: null, ahead, vr: true }).skip, null);
  });

  it('is there at once when finished: both where they would stop', () => {
    const walk = new Walk({ way, join: [{ x: 2, z: 4 }, { x: 0, z: 2.7 }], ahead, vr: false });
    walk.step(0.1);
    walk.finish();
    assert.equal(walk.phase, 'done');
    sameSpot(walk.viewer, way[1]);
    sameSpot(walk.him, beside);
    assert.equal(walk.step(1 / 72), 'done');
  });
});

describe('the librarian: beside the shelf', () => {
  // Facing a bookcase to the north (−z): the viewer's yaw 0.
  const end = { x: 0, z: 0 };

  it('stands to one side of where the viewer will stand, a little nearer the shelf: the side he comes from first', () => {
    const free = () => true;
    assert.deepEqual(besideEnd(end, 0, free, { x: 3, z: 1 }), { x: 0.9, z: -0.35 });
    assert.deepEqual(besideEnd(end, 0, free, { x: -3, z: 1 }), { x: -0.9, z: -0.35 });
    const right = besideEnd(end, Math.PI / 2, free, { x: 0, z: -3 }); // facing −x: their right is −z
    assert.ok(Math.abs(right.x + 0.35) < 1e-9 && Math.abs(right.z + 0.9) < 1e-9, JSON.stringify(right));
  });

  it('takes the other side, then spots further off, where one is taken; none when all are', () => {
    assert.deepEqual(besideEnd(end, 0, (x) => x < 0, { x: 3, z: 1 }), { x: -0.9, z: -0.35 });
    assert.deepEqual(besideEnd(end, 0, (x, z) => z > 0, { x: 3, z: 1 }), { x: 0.9, z: 0.2 });
    assert.equal(besideEnd(end, 0, () => false), null);
  });

  it('is reached along the viewer\'s way from his lead, by its end where a straight line will not do', () => {
    const way = [{ x: 0, z: 5 }, { x: 0, z: 2 }, { x: 3, z: 2 }, { x: 3, z: -2 }];
    const L = pathLengths(way);
    const b = { x: 3.9, z: -2.35 };
    const ahead = aheadWay(way, L, 1.3, b);
    sameSpot(ahead[0], { x: 0, z: 5 - 1.3 });
    sameSpot(ahead[1], way[1], 'the corners after it:');
    sameSpot(ahead[2], way[2]);
    sameSpot(ahead[3], { x: 3, z: -1 }, '1 m short of the end:');
    sameSpot(ahead.at(-1), b);
    assert.equal(ahead.length, 5);
    const round = aheadWay(way, L, 1.3, b, () => false);
    assert.deepEqual(round.slice(-2), [way.at(-1), b]);
  });
});

describe('the librarian: the way on the floor', () => {
  it('is one mesh with one material, shown along a way and fading in, then out and gone', () => {
    const line = new WayLine();
    assert.equal(line.mesh.visible, false);
    line.show([{ x: 0, z: 0 }, { x: 0, z: -4 }, { x: 2, z: -4 }]);
    const geo = line.mesh.geometry;
    const pos = geo.getAttribute('position');
    const col = geo.getAttribute('color');
    assert.equal(col.itemSize, 4);
    assert.equal(pos.count, col.count);
    assert.equal(pos.count % 3, 0, 'three across');
    for (let i = 0; i < pos.count; i++) assert.ok(Math.abs(pos.getY(i) - 0.022) < 1e-6, 'just over the floor');
    assert.equal(col.getW(0), 0, 'clear at its start');
    assert.equal(col.getW(pos.count - 2), 0, 'and its end');
    assert.ok(col.getW(3 * 10 + 1) > 0.99, 'opaque along its middle');
    assert.equal(col.getW(3 * 10), 0, 'clear at its edges');
    assert.equal(line.mesh.visible, true);
    assert.equal(line.material.opacity, 0);
    for (let i = 0; i < 72; i++) line.update(1 / 72);
    assert.equal(line.material.opacity, 0.7);
    line.hide();
    for (let i = 0; i < 72; i++) line.update(1 / 72);
    assert.equal(line.material.opacity, 0);
    assert.equal(line.mesh.visible, false, 'not drawn once gone');
    assert.equal(line.material.transparent, true);
    assert.equal(line.material.depthWrite, false);
  });
});
